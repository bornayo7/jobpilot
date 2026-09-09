import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from './useBackgroundPort';
import { useProfile, useSettings } from './useStores';
import type { Profile } from '@lib/schema/profile';
import { getDocumentMeta } from '@lib/storage/documents';
import { recordUnmatched } from '@lib/storage/unmatchedLog';
import { resolveFields, reviewRow, unmatchedRow, type ResolveOutcome, type ReviewRow } from '@lib/fill/resolver';
import type { ResumeMeta } from '@lib/fill/valueFor';
import type { FieldKind } from '@lib/schema/fieldKind';
import { cacheSet } from '@lib/storage/mappingCache';
import { taskConfigured } from '@lib/providers/router';
import type { FillInstruction } from '@lib/messaging/protocol';

export interface FramePlan {
  documentId: string;
  error?: string;
  rows: ReviewRow[];
  unmatched: ResolveOutcome['unmatched'];
  resolving: boolean;
  llmCalls: number;
}

export function useFillPlan(state: PanelState) {
  const { profile, snapshot } = useProfile();
  // Settings saved in the Settings tab (a key added, routing changed, a
  // dealbreaker toggled) reach the plan live, without reopening the panel.
  const { settings } = useSettings();
  /** `undefined` = lookup for the current profile still in flight. */
  const [resumeLookup, setResumeLookup] = useState<{ profile: Profile; value: ResumeMeta | null } | null>(null);
  const resume = resumeLookup?.profile === profile ? resumeLookup?.value : undefined;
  const [plans, setPlans] = useState<Map<number, FramePlan>>(new Map());
  const resolveKeys = useRef<Map<number, { key: string; token: symbol }>>(new Map());
  const resolveInputs = useRef<unknown[]>([]);
  const manual = useRef(new Map<number, Map<string, { documentId: string; signature: string; row: ReviewRow }>>());
  const profileKey = JSON.stringify([snapshot?.id, profile]);
  const mappingKey = settings ? JSON.stringify([settings.routing.mapping, settings.anthropicKey, settings.openaiKey,
    settings.openrouterKey, settings.ollamaBaseUrl, settings.lmstudioBaseUrl]) : '';

  useEffect(() => () => resolveKeys.current.clear(), []);

  // Resolve the default resume's display name once profile + docs are known.
  useEffect(() => {
    if (!profile) return;
    const id = profile.documents.defaultResumeId;
    if (!id) {
      setResumeLookup({ profile, value: null });
      return;
    }
    // Hold resolution until the lookup lands: resolving with a not-yet-loaded
    // resume would produce a plan with no file attachment.
    let cancelled = false;
    // No fallback to "some other document": the blob store also holds
    // generated cover letters and DOCX twins, and attaching one of those to a
    // real application is worse than attaching nothing. A dangling default
    // surfaces as the "no default resume" warning instead.
    void getDocumentMeta(id).then((doc) => {
      if (cancelled) return;
      setResumeLookup({ profile, value: doc ? { blobId: doc.id, filename: doc.name, versionId: doc.versionId } : null });
    }).catch((err) => {
      console.error('[jobpilot] resume lookup failed', err);
      if (!cancelled) setResumeLookup({ profile, value: null });
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Re-resolve a frame whenever its field set actually changes — or whenever
  // the inputs the plan was computed from (profile, settings, default resume)
  // change. The original version keyed only on the fields, so the plan built
  // before the resume lookup finished kept "no default resume" until the page
  // happened to re-render its form, and profile edits made in the options page
  // never reached an open panel.
  useEffect(() => {
    const inputs = [state.tabId, profileKey];
    if (inputs.some((value, index) => resolveInputs.current[index] !== value)) {
      resolveInputs.current = inputs;
      resolveKeys.current.clear();
      manual.current.clear();
      setPlans(new Map());
    }
    // A frame that went away, or lost its fields, has no plan — even while a
    // replacement profile's resume is still loading.
    for (const frameId of resolveKeys.current.keys()) {
      if (!state.frames.get(frameId)?.fields.length) resolveKeys.current.delete(frameId);
    }
    setPlans((prev) => {
      const next = new Map([...prev].filter(([id]) => state.frames.get(id)?.fields.length));
      return next.size === prev.size ? prev : next;
    });
    if (!profile || !settings || resume === undefined) return;
    const llmEnabled = taskConfigured(settings, 'mapping');

    for (const [frameId, frame] of state.frames) {
      if (frame.fields.length === 0) continue;
      const key = JSON.stringify([frame.documentId, frame.url, frame.atsId, frame.fields, mappingKey, resume]);
      if (resolveKeys.current.get(frameId)?.key === key) continue;
      const token = Symbol();
      resolveKeys.current.set(frameId, { key, token });
      const isCurrent = () => resolveKeys.current.get(frameId)?.token === token;

      setPlans((prev) => {
        const next = new Map(prev);
        next.set(frameId, {
          rows: prev.get(frameId)?.documentId === frame.documentId ? prev.get(frameId)!.rows : [],
          unmatched: prev.get(frameId)?.documentId === frame.documentId ? prev.get(frameId)!.unmatched : [],
          documentId: frame.documentId,
          resolving: true,
          llmCalls: 0,
        });
        return next;
      });

      void resolveFields({
        atsId: frame.atsId,
        frameId,
        frameUrl: frame.url,
        fields: frame.fields,
        profile,
        settings,
        resume,
        llmEnabled,
      })
        .then(async (outcome) => {
          // Stale check: fields changed again while resolving.
          if (!isCurrent()) return;
          setPlans((prev) => {
            const next = new Map(prev);
            const overrides = manual.current.get(frameId);
            const applyManual = (row: ReviewRow) => {
              const saved = overrides?.get(row.field.fieldId);
              return saved?.documentId === frame.documentId && saved.signature === row.field.signature ? { ...saved.row, field: row.field } : row;
            };
            const promoted = outcome.unmatched.filter((field) => {
              const saved = overrides?.get(field.fieldId);
              return saved?.documentId === frame.documentId && saved.signature === field.signature;
            });
            next.set(frameId, { ...outcome, documentId: frame.documentId, rows: [...outcome.rows.map(applyManual), ...promoted.map((field) => applyManual(unmatchedRow(field)))],
              unmatched: outcome.unmatched.filter((field) => !promoted.includes(field)), resolving: false });
            return next;
          });
          await recordUnmatched(frame.atsId, frame.url, outcome.unmatched).catch((error) => {
            if (!isCurrent()) return;
            setPlans((prev) => {
              const next = new Map(prev); const current = next.get(frameId);
              if (current) next.set(frameId, { ...current, error: `The fill plan is ready, but unmatched fields could not be logged: ${String(error)}` });
              return next;
            });
          });
        })
        .catch((err) => {
          if (!isCurrent()) return;
          console.error('[jobpilot] resolve failed', err);
          setPlans((prev) => {
            const next = new Map(prev);
            next.set(frameId, { rows: [], unmatched: [], documentId: frame.documentId, resolving: false, llmCalls: 0, error: `Could not match fields: ${String(err)}` });
            return next;
          });
        });
    }
  }, [state.tabId, state.frames, profileKey, mappingKey, resume]);

  const mutateRow = useCallback(
    (frameId: number, fieldId: string, mutate: (row: ReviewRow) => ReviewRow) => {
      setPlans((prev) => {
        const plan = prev.get(frameId);
        if (!plan) return prev;
        const unmatched = plan.unmatched.find((field) => field.fieldId === fieldId);
        const promoted = unmatched ? unmatchedRow(unmatched) : null;
        const apply = (row: ReviewRow) => {
          const changed = mutate(row);
          const overrides = manual.current.get(frameId) ?? new Map();
          overrides.set(fieldId, { documentId: plan.documentId, signature: row.field.signature, row: changed });
          manual.current.set(frameId, overrides);
          return changed;
        };
        const next = new Map(prev);
        next.set(frameId, {
          ...plan,
          rows: promoted ? [...plan.rows, apply(promoted)] : plan.rows.map((row) => (row.field.fieldId === fieldId ? apply(row) : row)),
          unmatched: plan.unmatched.filter((field) => field.fieldId !== fieldId),
        });
        return next;
      });
    },
    [],
  );

  const toggleInclude = useCallback(
    (frameId: number, fieldId: string) => {
      mutateRow(frameId, fieldId, (row) => ({ ...row, include: !row.include && row.instruction !== null }));
    },
    [mutateRow],
  );

  const editValue = useCallback(
    (frameId: number, fieldId: string, text: string) => {
      mutateRow(frameId, fieldId, (row) => {
        const instruction = userInstruction(row, frameId, text);
        if (!instruction) return row; // file inputs take documents, not typed text
        if (!row.instruction) {
          // User is supplying a value where the profile had none.
          return { ...row, instruction, include: text.length > 0 };
        }
        return {
          ...row,
          instruction: { ...instruction, requiresReview: row.instruction.requiresReview },
          include: text.length > 0 ? row.include || !row.requiresReview : false,
        };
      });
    },
    [mutateRow],
  );

  const editKind = useCallback(
    (frameId: number, fieldId: string, kind: FieldKind) => {
      if (!profile) return;
      mutateRow(frameId, fieldId, (row) =>
        reviewRow({ field: row.field, kind, source: 'user', confidence: 1, frameId, profile, resume: resume ?? null }),
      );
      // A manual correction permanently shadows any LLM cache entry.
      const plan = plans.get(frameId);
      const field = plan?.rows.find((r) => r.field.fieldId === fieldId)?.field ?? plan?.unmatched.find((f) => f.fieldId === fieldId);
      if (field) {
        void cacheSet([
          { signature: field.signature, entry: { kind, confidence: 1, source: 'user-correction' } },
        ]).catch((error) => setPlans((prev) => {
          const next = new Map(prev); const current = next.get(frameId);
          if (current) next.set(frameId, { ...current, error: `The correction works for this page but could not be remembered: ${String(error)}` });
          return next;
        }));
      }
    },
    [mutateRow, profile, resume, plans],
  );

  return { profile, snapshot, settings, resume: resume ?? null, plans, toggleInclude, editValue, editKind };
}

/**
 * Build the instruction for a value the user typed into a review row. The
 * action follows the CONTROL, not whatever the profile-derived instruction
 * happened to be: a checkbox takes setChecked, a select/radio group takes the
 * option whose label or value matches, a combobox goes through the listbox
 * picker. The earlier version emitted setText for every control the profile
 * had no value for, which on a checkbox or radio wrote the typed text into
 * the element's `value` attribute — the form then submitted "yes" as the
 * option value while the box stayed unchecked, and the readback reported ok.
 */
function userInstruction(row: ReviewRow, frameId: number, text: string): FillInstruction | null {
  const base = {
    fieldId: row.field.fieldId,
    frameId,
    kind: row.kind,
    source: 'user' as const,
    confidence: 1,
    requiresReview: false,
  };
  switch (row.field.control) {
    case 'file':
      return null;
    case 'checkbox':
      return { ...base, action: 'setChecked', value: /^(yes|true|checked|1)$/i.test(text) };
    case 'select':
    case 'radio': {
      const options = row.field.options ?? [];
      if (options.length === 0) return { ...base, action: 'pickListbox', value: text };
      const option = options.find((o) => o.value === text || o.label.toLowerCase() === text.toLowerCase());
      return { ...base, action: 'selectOption', value: option ? option.value : text };
    }
    case 'combobox':
      return { ...base, action: 'pickListbox', value: text };
    default:
      return { ...base, action: 'setText', value: text };
  }
}
