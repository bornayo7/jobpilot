import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { gatherBackupPayload, restoreBackupPayload } from '@lib/util/backupStore';
import { loadProfile } from '@lib/storage/profileStore';

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
  expect(await gatherBackupPayload()).toEqual({ ...payload, exportedAt: expect.any(Number) });
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
  vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('storage failed'));
  await expect(restoreBackupPayload(replacement)).rejects.toThrow('storage failed');
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
