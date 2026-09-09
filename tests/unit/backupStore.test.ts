import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { gatherBackupPayload, restoreBackupPayload, inspectBackupPayload } from '@lib/storage/backupStore';
import { loadProfile, loadProfileSnapshot, saveProfileSnapshot, createProfile, deleteProfile } from '@lib/storage/profileStore';
import { loadGenerationDraft, saveGenerationDraft } from '@lib/generation/draftStore';
import { deleteAnswer, patchAnswer } from '@lib/memory/answers';
import { deleteJob, patchJob } from '@lib/tracker/store';

beforeEach(async () => {
  fakeBrowser.reset();
  const db = await getDb();
  for (const store of [...db.objectStoreNames]) await db.clear(store);
  await loadProfile();
  await db.put('blobs', { id: 'original', name: 'resume.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]).buffer, createdAt: 1 });
  await db.put('resumeVersions', { id: 'letter', kind: 'coverLetter', label: 'Letter', company: 'Acme', data: { text: 'Dear team' }, pdfBlobId: 'original', createdAt: 1 });
  await db.put('answers', { id: 'answer', questionRaw: 'Why?', questionNormalized: 'why', answer: 'Because', company: 'Acme', jobId: 'job', reusable: false, createdAt: 1 });
  await db.put('trackerJobs', { id: 'job', company: 'Acme', title: 'Engineer', url: 'https://example.com', status: 'applied', notes: 'notes', appliedAt: 1, followUpAt: 2, createdAt: 1 });
  await db.put('unmatchedLog', { id: 'field', atsId: null, url: 'https://example.com', label: 'Question', control: 'text', signature: 's', seenAt: 1 });
});

it('roundtrips all stores and removes local keys absent from the backup', async () => {
  const payload = await gatherBackupPayload();
  await fakeBrowser.storage.local.set({ 'jobpilot:mappingCache': { stale: true } });
  await (await getDb()).clear('blobs');
  await restoreBackupPayload(payload);
  const restored = await gatherBackupPayload();
  // Restore intentionally advances edit revisions so an old open editor cannot
  // write its stale base over the restored data. Content still round-trips.
  const expected = structuredClone(payload);
  (expected.local['jobpilot:profiles'] as any).profiles.default.revision = 1;
  expected.local['jobpilot:settings:revision'] = 1;
  (expected.idb.answers![0] as any).revision = 1;
  (expected.idb.trackerJobs![0] as any).revision = 1;
  expect(restored).toEqual({ ...expected, exportedAt: expect.any(Number) });
  expect((await fakeBrowser.storage.local.get('jobpilot:mappingCache'))['jobpilot:mappingCache']).toBeUndefined();
});

it.each(['missing-store', 'bad-row', 'bad-base64', 'unknown-key', 'duplicate-id'])('rejects %s before changing any data', async (mode) => {
  const before = await gatherBackupPayload();
  const bad = structuredClone(before);
  if (mode === 'missing-store') delete bad.idb.answers;
  if (mode === 'bad-row') bad.idb.trackerJobs = [{ id: 'x' }];
  if (mode === 'bad-base64') (bad.idb.blobs![0] as any).bytes = '%%%';
  if (mode === 'unknown-key') bad.local.unrelated = 1;
  if (mode === 'duplicate-id') bad.idb.blobs!.push(bad.idb.blobs![0]);
  await expect(restoreBackupPayload(bad)).rejects.toThrow();
  expect(await gatherBackupPayload()).toEqual({ ...before, exportedAt: expect.any(Number) });
});

it('rolls back the database if local storage fails after the database replacement', async () => {
  const before = await gatherBackupPayload();
  const replacement = structuredClone(before); replacement.idb.blobs = [];
  const set = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
  let fail = true;
  let databaseWasReplaced = false;
  vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (values) => {
    if (fail && 'jobpilot:profiles' in values) {
      fail = false;
      databaseWasReplaced = await (await getDb()).count('blobs') === 0;
      throw new Error('storage failed');
    }
    return set(values);
  });
  await expect(restoreBackupPayload(replacement)).rejects.toThrow('storage failed');
  expect(databaseWasReplaced).toBe(true);
  expect(await gatherBackupPayload()).toEqual({ ...before, exportedAt: expect.any(Number) });
  vi.restoreAllMocks();
});

it('includes a legacy single profile when backing up for the first time', async () => {
  await fakeBrowser.storage.local.clear();
  await fakeBrowser.storage.local.set({ 'jobpilot:profile': { basics: { firstName: 'Legacy' } } });
  const payload = await gatherBackupPayload();
  await fakeBrowser.storage.local.clear();
  await restoreBackupPayload(payload);
  expect((await loadProfile()).basics.firstName).toBe('Legacy');
});

it('aborts all database stores if a later store write fails', async () => {
  const before = await gatherBackupPayload();
  const replacement = structuredClone(before); replacement.idb.blobs = [];
  const clear = IDBObjectStore.prototype.clear;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
    if (this.name === 'unmatchedLog') throw new Error('write failed');
    return clear.call(this);
  });
  await expect(restoreBackupPayload(replacement)).rejects.toThrow('write failed');
  spy.mockRestore();
  expect(await gatherBackupPayload()).toEqual({ ...before, exportedAt: expect.any(Number) });
});

it.each(['future', 'unrelated'])('rejects a %s profile before replacing any stores', async (mode) => {
  const before = await gatherBackupPayload();
  const bad = structuredClone(before);
  const profiles = bad.local['jobpilot:profiles'] as any;
  profiles.profiles.default.profile = mode === 'future'
    ? { ...profiles.profiles.default.profile, schemaVersion: 2 }
    : { theme: 'dark' };
  await expect(restoreBackupPayload(bad)).rejects.toThrow();
  expect(await gatherBackupPayload()).toEqual({ ...before, exportedAt: expect.any(Number) });
});

it('preserves legacy dangling defaults and historical links while reporting them', async () => {
  const payload = await gatherBackupPayload();
  (payload.local['jobpilot:profiles'] as any).profiles.default.profile.documents.defaultResumeId = 'missing';
  (payload.idb.trackerJobs![0] as any).resumeVersionId = 'removed-version';
  (payload.idb.answers![0] as any).jobId = 'removed-application';
  const inspected = inspectBackupPayload(payload);
  expect(inspected.warnings).toHaveLength(3);
  expect((await restoreBackupPayload(payload)).warnings).toEqual(inspected.warnings);
  expect((await loadProfile()).documents.defaultResumeId).toBe('missing');
  expect((await getDb()).get('answers', 'answer')).resolves.toMatchObject({ jobId: 'removed-application' });
});

it('invalidates editor bases and clears transient submit attempts on restore', async () => {
  const oldBase = await loadProfileSnapshot();
  const payload = await gatherBackupPayload();
  await (await getDb()).put('submissionAttempts', { id:'attempt',tabId:1,documentId:'doc',applicationId:'app',attemptId:'attempt',url:'https://example.com',title:'Role',answers:[],at:1 });
  await restoreBackupPayload(payload);
  await expect(saveProfileSnapshot(oldBase, oldBase.profile)).rejects.toThrow(/changed elsewhere/);
  expect(await (await getDb()).count('submissionAttempts')).toBe(0);
});

it('can export unsupported current data intact and restore a compatible recovery copy', async () => {
  const good = await gatherBackupPayload();
  const unsupported = structuredClone(good.local['jobpilot:profiles']) as any;
  unsupported.profiles.default.profile.schemaVersion = 2;
  unsupported.profiles.default.profile.basics.firstName = 'Future content';
  await fakeBrowser.storage.local.set({ 'jobpilot:profiles': unsupported });
  expect((await gatherBackupPayload()).local['jobpilot:profiles']).toEqual(unsupported);
  await restoreBackupPayload(good);
  expect((await loadProfile()).schemaVersion).toBe(1);
});

it('never reuses the revision of a deleted profile when an older backup restores its id', async () => {
  const backup = await gatherBackupPayload();
  const original = await loadProfileSnapshot();
  const stale = await saveProfileSnapshot(original, original.profile);
  await createProfile('Keep');
  await deleteProfile(original.id);
  await restoreBackupPayload(backup);
  expect((await loadProfileSnapshot()).revision).toBeGreaterThan(stale.revision);
  await expect(saveProfileSnapshot(stale, stale.profile)).rejects.toThrow(/changed elsewhere/);
});

it('remembers omitted draft revisions across successive restores', async () => {
  const empty = await gatherBackupPayload();
  const key = { applicationUrl: 'https://jobs.example/123', profileId: 'default' };
  const input = { promptType: 'resume' as const, question: '', pasted: 'Original' };
  const first = await saveGenerationDraft(key, input);
  const backup = await gatherBackupPayload();
  const stale = await saveGenerationDraft(key, { ...input, pasted: 'Newer' }, first.revision);
  await restoreBackupPayload(empty);
  expect(await loadGenerationDraft(key)).toBeNull();
  await restoreBackupPayload(backup);
  expect((await loadGenerationDraft(key))!.revision).toBeGreaterThan(stale.revision);
  await expect(saveGenerationDraft(key, { ...input, pasted: 'Stale' }, stale.revision)).rejects.toThrow(/changed elsewhere/);
});

it('does not revive stale answer or application bases after deleting and restoring their ids', async () => {
  const backup = await gatherBackupPayload();
  const answer = await patchAnswer('answer', { answer: 'Newer answer' }, 0);
  const job = await patchJob('job', { notes: 'Newer notes' }, 0);
  await deleteAnswer(answer.id);
  await deleteJob(job.id);
  await restoreBackupPayload(backup);
  await expect(patchAnswer(answer.id, { answer: 'Stale answer' }, answer.revision)).rejects.toThrow(/changed/);
  await expect(patchJob(job.id, { notes: 'Stale notes' }, job.revision)).rejects.toThrow(/changed/);
});
