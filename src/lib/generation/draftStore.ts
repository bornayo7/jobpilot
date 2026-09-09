import { withStorageRead, withStorageWrite } from '../storage/coordination';
import type { GenerationDraftRecord } from '../storage/db';
export type { GenerationDraftRecord } from '../storage/db';
export interface DraftKey { applicationUrl: string; profileId: string }
export type GenerationDraftInput = Pick<GenerationDraftRecord, 'promptType' | 'question' | 'pasted'>;
export class DraftConflictError extends Error {
  constructor(public readonly current: GenerationDraftRecord | null) {
    super('This application draft changed elsewhere. Reload its latest version before saving.');
    this.name = 'DraftConflictError';
  }
}
function idFor(key: DraftKey): string { return JSON.stringify([key.profileId, key.applicationUrl]); }
export function loadGenerationDraft(key: DraftKey): Promise<GenerationDraftRecord | null> {
  return withStorageRead(async (db) => (await db.get('generationDrafts', idFor(key))) ?? null);
}
export function saveGenerationDraft(key: DraftKey, draft: GenerationDraftInput, baseRevision = 0): Promise<GenerationDraftRecord> {
  return withStorageWrite(async (db) => {
    const id = idFor(key);
    const current = await db.get('generationDrafts', id);
    if ((current?.revision ?? 0) !== baseRevision) throw new DraftConflictError(current ?? null);
    const next = { ...draft, id, revision: baseRevision + 1, updatedAt: Date.now() };
    await db.put('generationDrafts', next);
    return next;
  });
}
export function deleteGenerationDraft(key: DraftKey, baseRevision = 0): Promise<GenerationDraftRecord | null> {
  return withStorageWrite(async (db) => {
    const id = idFor(key);
    const current = await db.get('generationDrafts', id);
    if (!current) return null;
    if (current.revision !== baseRevision) throw new DraftConflictError(current);
    // Keep the revision counter after clearing sensitive draft text; otherwise
    // delete/recreate would reuse revision 1 and accept an old page's base.
    const cleared: GenerationDraftRecord = { ...current, question: '', pasted: '', revision: current.revision + 1, updatedAt: Date.now() };
    await db.put('generationDrafts', cleared);
    return cleared;
  });
}
