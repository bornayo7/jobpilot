import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelState } from './useBackgroundPort';
import type { Profile } from '@lib/schema/profile';
import { loadProfile, watchProfile } from '@lib/storage/profileStore';
import { loadSettings, type Settings } from '@lib/storage/settingsStore';
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
  const [resume, setResume] = useState<ResumeMeta | null>(null);
  const [plans, setPlans] = useState<Map<number, FramePlan>>(new Map());
  const resolveKeys = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    void loadProfile().then(setProfile);
    void loadSettings().then(setSettings);
    return watchProfile(setProfile);
  }, []);

  // Resolve the default resume's display name once profile + docs are known.
  useEffect(() => {
    if (!profile) return;
    const id = profile.documents.defaultResumeId;
    if (!id) {
      setResume(null);
      return;
    }
    void listDocuments().then((docs) => {
      const doc = docs.find((d) => d.id === id) ?? docs[0] ?? null;
      setResume(doc ? { blobId: doc.id, filename: doc.name } : null);
    });
  }, [profile]);

  // Re-resolve a frame whenever its field set actually changes.
  useEffect(() => {
    if (!profile || !settings) return;
    // A key configured for the mapping provider (or a local provider) enables tier 4.
    const llmEnabled =
      (settings.routing.mapping.provider === 'anthropic' && !!settings.anthropicKey) ||
      (settings.routing.mapping.provider === 'openai' && !!settings.openaiKey) ||
      (settings.routing.mapping.provider === 'openrouter' && !!settings.openrouterKey) ||
      settings.routing.mapping.provider === 'ollama' ||
      settings.routing.mapping.provider === 'lmstudio';

    for (const [frameId, frame] of state.frames) {
      if (frame.fields.length === 0) continue;
      const key = frame.fields.map((f) => `${f.fieldId}:${f.signature}:${f.currentValue ?? ''}`).join('|');
      if (resolveKeys.current.get(frameId) === key) continue;
      resolveKeys.current.set(frameId, key);

      setPlans((prev) => {
        const next = new Map(prev);
        const existing = next.get(frameId);
        next.set(frameId, {
          rows: existing?.rows ?? [],
          unmatched: existing?.unmatched ?? [],
          resolving: true,
          llmCalls: existing?.llmCalls ?? 0,
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
          if (resolveKeys.current.get(frameId) !== key) return;
          setPlans((prev) => {
            const next = new Map(prev);
            next.set(frameId, { ...outcome, resolving: false });
            return next;
          });
          await logUnmatched(frame.atsId, frame.url, outcome);
        })
        .catch((err) => {
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
  }, [state.frames, profile, settings, resume]);

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
        if (!row.instruction) {
          // User is supplying a value where the profile had none.
          const instruction: FillInstruction = {
            fieldId,
            frameId,
            action: row.field.control === 'combobox' ? 'pickListbox' : 'setText',
            value: text,
            kind: row.kind,
            source: 'user',
            confidence: 1,
            requiresReview: false,
          };
          return { ...row, instruction, include: text.length > 0 };
        }
        let value: FillInstruction['value'] = text;
        let action = row.instruction.action;
        if (action === 'selectOption') {
          const option = row.field.options?.find(
            (o) => o.label.toLowerCase() === text.toLowerCase() || o.value === text,
          );
          value = option ? option.value : text;
        }
        if (action === 'setChecked') {
          value = /^(yes|true|checked|1)$/i.test(text);
        }
        return {
          ...row,
          instruction: { ...row.instruction, value, source: 'user', confidence: 1 },
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
        const resolved = valueFor(kind, row.field, profile, resume);
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

  return { profile, settings, resume, plans, toggleInclude, editValue, editKind };
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
