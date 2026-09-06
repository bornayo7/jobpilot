import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from './useBackgroundPort';
import type { Profile } from '@lib/schema/profile';
import { loadProfile, watchProfile } from '@lib/storage/profileStore';
import { loadSettings, watchSettings, type Settings } from '@lib/storage/settingsStore';
import { listDocuments } from '@lib/storage/documents';
import { getDb } from '@lib/storage/db';
import { resolveFields, type ResolveOutcome, type ReviewRow } from '@lib/fill/resolver';
import { valueFor, type ResumeMeta } from '@lib/fill/valueFor';
import type { FieldKind } from '@lib/schema/fieldKind';
import { SENSITIVE_KINDS } from '@lib/schema/fieldKind';
import { cacheSet } from '@lib/storage/mappingCache';
import type { FillInstruction } from '@lib/messaging/protocol';

export interface FramePlan {
  rows: ReviewRow[];
  unmatched: ResolveOutcome['unmatched'];
  resolving: boolean;
  llmCalls: number;
}

export function useFillPlan(state: PanelState) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  /** `undefined` = lookup for the current profile still in flight. */
  const [resumeLookup, setResumeLookup] = useState<{ profile: Profile; value: ResumeMeta | null } | null>(null);
  const resume = resumeLookup?.profile === profile ? resumeLookup?.value : undefined;
  const [plans, setPlans] = useState<Map<number, FramePlan>>(new Map());
  const resolveKeys = useRef<Map<number, { key: string; token: symbol }>>(new Map());
  const resolveInputs = useRef<unknown[]>([]);

  useEffect(() => () => resolveKeys.current.clear(), []);

  useEffect(() => {
    void loadProfile().then(setProfile);
    void loadSettings().then(setSettings);
    const unwatchProfile = watchProfile(setProfile);
    // Settings saved in the Settings tab (a key added, routing changed, a
    // dealbreaker toggled) must reach the plan without reopening the panel.
    const unwatchSettings = watchSettings(setSettings);
    return () => {
      unwatchProfile();
      unwatchSettings();
    };
  }, []);

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
    void listDocuments().then((docs) => {
      if (cancelled) return;
      // No fallback to "some other document": the blob store also holds
      // generated cover letters and DOCX twins, and attaching one of those to a
      // real application is worse than attaching nothing. A dangling default
      // surfaces as the "no default resume" warning instead.
      const doc = docs.find((d) => d.id === id) ?? null;
      setResumeLookup({ profile, value: doc ? { blobId: doc.id, filename: doc.name } : null });
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
    const inputs = [state.tabId, profile, settings, resume];
    if (inputs.some((value, index) => resolveInputs.current[index] !== value)) {
      resolveInputs.current = inputs;
      resolveKeys.current.clear();
      setPlans(new Map());
    }
    // Invalidate even while a replacement profile's resume is loading.
    for (const frameId of resolveKeys.current.keys()) {
      if (!state.frames.get(frameId)?.fields.length) resolveKeys.current.delete(frameId);
    }
    setPlans((prev) => {
      const next = new Map([...prev].filter(([id]) => state.frames.get(id)?.fields.length));
      return next.size === prev.size ? prev : next;
    });
    if (!profile || !settings || resume === undefined) return;
    // A key configured for the mapping provider (or a local provider) enables tier 4.
    const llmEnabled =
      (settings.routing.mapping.provider === 'anthropic' && !!settings.anthropicKey) ||
      (settings.routing.mapping.provider === 'openai' && !!settings.openaiKey) ||
      (settings.routing.mapping.provider === 'openrouter' && !!settings.openrouterKey) ||
      settings.routing.mapping.provider === 'ollama' ||
      settings.routing.mapping.provider === 'lmstudio';

    for (const [frameId, frame] of state.frames) {
      if (frame.fields.length === 0) continue;
      const key = JSON.stringify([frame.url, frame.atsId, frame.fields]);
      if (resolveKeys.current.get(frameId)?.key === key) continue;
      const token = Symbol();
      resolveKeys.current.set(frameId, { key, token });
      const isCurrent = () => resolveKeys.current.get(frameId)?.token === token;

      setPlans((prev) => {
        const next = new Map(prev);
        next.set(frameId, {
          rows: [],
          unmatched: [],
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
            next.set(frameId, { ...outcome, resolving: false });
            return next;
          });
          await logUnmatched(frame.atsId, frame.url, outcome);
        })
        .catch((err) => {
          if (!isCurrent()) return;
          console.error('[jobpilot] resolve failed', err);
          setPlans((prev) => {
            const next = new Map(prev);
            next.set(frameId, { rows: [], unmatched: [], resolving: false, llmCalls: 0 });
            return next;
          });
        });
    }

    // Drop plans for frames that disappeared.
    setPlans((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const frameId of next.keys()) {
        if (!state.frames.has(frameId)) {
          next.delete(frameId);
          resolveKeys.current.delete(frameId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state.tabId, state.frames, profile, settings, resume]);

  const mutateRow = useCallback(
    (frameId: number, fieldId: string, mutate: (row: ReviewRow) => ReviewRow) => {
      setPlans((prev) => {
        const plan = prev.get(frameId);
        if (!plan) return prev;
        const next = new Map(prev);
        next.set(frameId, {
          ...plan,
          rows: plan.rows.map((row) => (row.field.fieldId === fieldId ? mutate(row) : row)),
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
      mutateRow(frameId, fieldId, (row) => {
        const resolved = valueFor(kind, row.field, profile, resume ?? null);
        const sensitive = SENSITIVE_KINDS.has(kind);
        const requiresReview =
          sensitive || kind === 'question.freeText' || kind === 'question.choice' || (resolved?.requiresReview ?? false);
        const instruction: FillInstruction | null = resolved
          ? {
              fieldId,
              frameId,
              action: resolved.action,
              value: resolved.value,
              kind,
              source: 'user',
              confidence: 1,
              requiresReview,
            }
          : null;
        return { ...row, kind, source: 'user', confidence: 1, instruction, requiresReview, sensitive, include: instruction !== null && !requiresReview };
      });
      // A manual correction permanently shadows any LLM cache entry.
      const row = plans.get(frameId)?.rows.find((r) => r.field.fieldId === fieldId);
      if (row) {
        void cacheSet([
          { signature: row.field.signature, entry: { kind, confidence: 1, source: 'user-correction' } },
        ]);
      }
    },
    [mutateRow, profile, resume, plans],
  );

  return { profile, settings, resume: resume ?? null, plans, toggleInclude, editValue, editKind };
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

async function logUnmatched(
  atsId: string | null,
  url: string,
  outcome: ResolveOutcome,
): Promise<void> {
  if (outcome.unmatched.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('unmatchedLog', 'readwrite');
    for (const field of outcome.unmatched) {
      await tx.store.put({
        id: field.signature, // dedupe: one row per unique field shape
        atsId,
        url,
        label: field.label || field.name || '(unlabeled)',
        control: field.control,
        signature: field.signature,
        seenAt: Date.now(),
      });
    }
    await tx.done;
  } catch (err) {
    console.warn('[jobpilot] unmatched log write failed', err);
  }
}
