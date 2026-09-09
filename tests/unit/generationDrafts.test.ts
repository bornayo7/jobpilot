import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { loadGenerationDraft, saveGenerationDraft, deleteGenerationDraft } from '@lib/generation/draftStore';
beforeEach(async()=>{fakeBrowser.reset();const db=await getDb();await db.clear('generationDrafts');await db.clear('recoveryJournal');});
const key={applicationUrl:'https://jobs.example/123',profileId:'a'};
const draft={promptType:'resume' as const,question:'',pasted:'review me'};
it('isolates persisted drafts by application and profile',async()=>{
  const saved=await saveGenerationDraft(key,draft);
  expect(await loadGenerationDraft(key)).toEqual(saved);
  expect(await loadGenerationDraft({...key,profileId:'b'})).toBeNull();
  expect(await loadGenerationDraft({...key,applicationUrl:'https://jobs.example/456'})).toBeNull();
});
it('rejects conflicting writes from two pages without losing text',async()=>{
  const saved=await saveGenerationDraft(key,draft);
  await saveGenerationDraft(key,{...draft,pasted:'newer'},saved.revision);
  await expect(saveGenerationDraft(key,{...draft,pasted:'older'},saved.revision)).rejects.toThrow(/changed elsewhere/);
  expect((await loadGenerationDraft(key))?.pasted).toBe('newer');
});
it('clearing preserves revision history so an old base cannot overwrite recreated work',async()=>{
  const saved=await saveGenerationDraft(key,draft);
  const cleared=await deleteGenerationDraft(key,saved.revision);
  expect(cleared?.pasted).toBe('');
  const current=await saveGenerationDraft(key,{...draft,pasted:'new application draft'},cleared!.revision);
  await expect(saveGenerationDraft(key,draft,saved.revision)).rejects.toThrow(/changed elsewhere/);
  expect(await loadGenerationDraft(key)).toEqual(current);
});
