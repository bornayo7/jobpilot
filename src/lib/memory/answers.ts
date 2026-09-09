import type { AnswerRecord } from '../storage/db';
import { withStorageRead, withStorageWrite } from '../storage/coordination';
import { newId } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';
import { questionSimilarity } from '../util/fuzzy';
import { applicationId } from '../tracker/applicationId';
import { retainRevisionFloor } from '../storage/revisions';
import { completeTransaction } from '../storage/transaction';

export type { AnswerRecord } from '../storage/db';

export async function saveAnswer(
  input: Omit<AnswerRecord, 'id' | 'createdAt' | 'questionNormalized'>,
): Promise<AnswerRecord> {
  const record: AnswerRecord = {
    ...input,
    id: newId(),
    questionNormalized: normalizeForSignature(input.questionRaw),
    createdAt: Date.now(),
    revision: 1,
    origin: input.origin ?? 'manual',
    reuseConfirmed: input.origin === 'captured' || input.origin === 'generated' ? false : input.reusable,
  };
  // Dedupe: same normalized question + same answer text = one record. Return
  // the record that is actually in the store — handing back the freshly minted
  // one would give the caller an id that resolves to nothing.
  return withStorageWrite(async (db) => {
    const tx = db.transaction('answers', 'readwrite');
    return completeTransaction(tx, async () => {
      const existing = await tx.store.index('byNormalized').getAll(record.questionNormalized);
      const duplicate = existing.find((e) => e.answer.trim() === record.answer.trim() && e.jobId === record.jobId && e.applicationId === record.applicationId);
      if (duplicate) return duplicate;
      await tx.store.put(record);
      return record;
    });
  });
}

export async function listAnswers(): Promise<AnswerRecord[]> {
  return withStorageRead(async (db) => {
    const [answers, jobs] = await Promise.all([db.getAll('answers'), db.getAll('trackerJobs')]);
    const identities = new Map(jobs.map((job) => [job.id, job.applicationId ?? applicationId(job.url) ?? undefined]));
    return answers.map((answer) => ({ ...answer, applicationId: answer.applicationId ?? identities.get(answer.jobId) })).sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function updateAnswer(record: AnswerRecord): Promise<void> {
  await patchAnswer(record.id, record, record.revision ?? 0);
}

type AnswerEdits = Partial<Pick<AnswerRecord, 'questionRaw' | 'answer' | 'reusable'>>;

export async function patchAnswer(id: string, patch: AnswerEdits, base?: number | AnswerEdits): Promise<AnswerRecord> {
  return withStorageWrite(async (db) => {
    const tx = db.transaction('answers', 'readwrite');
    return completeTransaction(tx, async () => {
      const current = await tx.store.get(id);
      if (!current) throw new Error('This answer was removed. Reload the answers list.');
      const changed = typeof base === 'number' ? base !== (current.revision ?? 0) : base !== undefined &&
        (Object.keys(patch) as (keyof AnswerEdits)[]).some((key) => current[key] !== base[key] && current[key] !== patch[key]);
      if (changed) throw new Error('This answer changed in another editor. Reload before saving.');
      const next = { ...current, ...patch, id: current.id, revision: (current.revision ?? 0) + 1,
        questionNormalized: normalizeForSignature(patch.questionRaw ?? current.questionRaw),
        reuseConfirmed: patch.reusable !== undefined ? patch.reusable : current.reuseConfirmed };
      await tx.store.put(next); return next;
    });
  });
}

export async function deleteAnswer(id: string): Promise<void> {
  await withStorageWrite(async (db) => {
    const current = await db.get('answers', id);
    if (!current) return;
    await retainRevisionFloor(current.revision ?? 0);
    await db.delete('answers', id);
  });
}

export interface AnswerSuggestion {
  record: AnswerRecord;
  score: number;
}

/**
 * Rank saved answers against a question. Pure so it's unit-testable — the
 * FillTab loads the bank once and calls this per question row.
 *
 * Cross-application scoping (the anti-answer-bleed rule): an answer written
 * for another job is only suggested when `reusable` is true; same-job answers
 * always qualify. Suggestions are ranked, never auto-inserted.
 */
export function rankAnswers(
  question: string,
  bank: AnswerRecord[],
  currentJobId: string | '',
  { minScore = 0.4, limit = 3 }: { minScore?: number; limit?: number } = {},
): AnswerSuggestion[] {
  return bank
    .filter((record) => record.reusable && record.reuseConfirmed === true || (currentJobId !== '' && (record.jobId === currentJobId || record.applicationId === currentJobId)))
    .map((record) => ({ record, score: questionSimilarity(question, record.questionRaw) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
