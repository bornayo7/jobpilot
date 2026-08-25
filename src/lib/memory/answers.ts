import { getDb } from '../storage/db';
import { newId } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';
import { questionSimilarity } from '../util/fuzzy';

export interface AnswerRecord {
  id: string;
  questionRaw: string;
  questionNormalized: string;
  answer: string;
  /** Tracker job id (or '' for manually added general answers). */
  jobId: string;
  company: string;
  /** Cross-job reuse gate. Hand-typed/captured answers default true;
   *  AI-generated ones must be flipped deliberately. */
  reusable: boolean;
  createdAt: number;
}

export async function saveAnswer(
  input: Omit<AnswerRecord, 'id' | 'createdAt' | 'questionNormalized'>,
): Promise<AnswerRecord> {
  const record: AnswerRecord = {
    ...input,
    id: newId(),
    questionNormalized: normalizeForSignature(input.questionRaw),
    createdAt: Date.now(),
  };
  const db = await getDb();
  // Dedupe: same normalized question + same answer text = one record.
  const existing = await db.getAllFromIndex('answers', 'byNormalized', record.questionNormalized);
  if (existing.some((e) => e.answer.trim() === record.answer.trim())) return record;
  await db.put('answers', record);
  return record;
}

export async function listAnswers(): Promise<AnswerRecord[]> {
  const db = await getDb();
  const all = (await db.getAll('answers')) as AnswerRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateAnswer(record: AnswerRecord): Promise<void> {
  const db = await getDb();
  await db.put('answers', {
    ...record,
    questionNormalized: normalizeForSignature(record.questionRaw),
  });
}

export async function deleteAnswer(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('answers', id);
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
    .filter((record) => record.reusable || (currentJobId !== '' && record.jobId === currentJobId))
    .map((record) => ({ record, score: questionSimilarity(question, record.questionRaw) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
