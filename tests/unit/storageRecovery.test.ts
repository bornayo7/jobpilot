import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb, type RecoveryJournal } from '@lib/storage/db';
import { loadProfileSnapshot, loadProfile, saveProfileSnapshot, PROFILES_KEY, type ProfilesContainer } from '@lib/storage/profileStore';
import { gatherBackupPayload, restoreBackupPayload } from '@lib/storage/backupStore';
import { recoverStorage, StorageRecoveryError, withStorageWrite } from '@lib/storage/coordination';

beforeEach(async () => {
  vi.restoreAllMocks(); fakeBrowser.reset();
  const db = await getDb();
  for (const name of [...db.objectStoreNames]) await db.clear(name);
  await loadProfile();
});
const blob = (id: string) => ({id,name:`${id}.pdf`,type:'application/pdf',bytes:new Uint8Array([1,2,3]).buffer,createdAt:1});

async function interrupted(phase: RecoveryJournal['phase'], localAlreadyApplied: boolean) {
  const db = await getDb();
  const before = await fakeBrowser.storage.local.get<Record<string, ProfilesContainer>>(PROFILES_KEY);
  const after = structuredClone(before);
  const container = after[PROFILES_KEY]!;
  container.profiles.default!.profile.basics.firstName = 'Restored';
  container.profiles.default!.revision += 1;
  await db.put('blobs',blob('replacement'));
  await db.put('recoveryJournal',{id:'active',phase,beforeIdb:{blobs:[blob('original')]},beforeLocal:before,afterLocal:after,localKeys:[PROFILES_KEY]});
  if (localAlreadyApplied) await fakeBrowser.storage.local.set(after);
}

it.each([false,true])('resumes a committed IDB replacement from its journal (local applied: %s)', async (applied) => {
  await interrupted('commit',applied);
  // No operation object is kept: a later normal read reconstructs recovery
  // solely from the persistent journal, as a fresh extension context does.
  expect((await loadProfile()).basics.firstName).toBe('Restored');
  const db = await getDb();
  expect((await db.getAll('blobs')).map((row) => row.id)).toEqual(['replacement']);
  expect(await db.count('recoveryJournal')).toBe(0);
});

it.each([false,true])('resumes durable rollback intent (local applied: %s)', async (applied) => {
  await interrupted('rollback',applied);
  expect((await loadProfile()).basics.firstName).toBe('');
  const db = await getDb();
  expect((await db.getAll('blobs')).map((row) => row.id)).toEqual(['original']);
  expect(await db.count('recoveryJournal')).toBe(0);
});

it('blocks reads and retains the journal when compensation fails, then retries idempotently', async () => {
  await interrupted('rollback',true);
  const spy = vi.spyOn(fakeBrowser.storage.local,'set').mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(loadProfile()).rejects.toBeInstanceOf(StorageRecoveryError);
  expect(await (await getDb()).get('recoveryJournal','active')).toMatchObject({phase:'rollback'});
  spy.mockRestore();
  await recoverStorage();
  expect((await loadProfile()).basics.firstName).toBe('');
  expect((await (await getDb()).getAll('blobs')).map((row) => row.id)).toEqual(['original']);
});

it('recovers after the final journal cleanup fails without reverting a completed restore', async () => {
  const payload = await gatherBackupPayload();
  const profiles = payload.local[PROFILES_KEY] as any;
  profiles.profiles.default.profile.basics.firstName = 'Committed';
  const remove = IDBObjectStore.prototype.delete;
  const spy = vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,...args) {
    if (this.name === 'recoveryJournal') throw new Error('interrupted cleanup');
    return remove.apply(this,args);
  });
  await expect(restoreBackupPayload(payload)).rejects.toBeInstanceOf(StorageRecoveryError);
  expect(await (await getDb()).count('recoveryJournal')).toBe(1);
  spy.mockRestore();
  expect((await loadProfile()).basics.firstName).toBe('Committed');
  expect(await (await getDb()).count('recoveryJournal')).toBe(0);
});

it('reports pending recovery if rollback intent itself cannot be persisted', async () => {
  const payload = await gatherBackupPayload();
  (payload.local[PROFILES_KEY] as ProfilesContainer).profiles.default!.profile.basics.firstName = 'Committed';
  const set = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
  const localSpy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (values) => {
    if (PROFILES_KEY in values) throw new Error('local write unavailable');
    return set(values);
  });
  const put = IDBObjectStore.prototype.put;
  const idbSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, ...args) {
    if (this.name === 'recoveryJournal' && value.phase === 'rollback') throw new Error('rollback intent unavailable');
    return put.call(this, value, ...args);
  });
  await expect(restoreBackupPayload(payload)).rejects.toBeInstanceOf(StorageRecoveryError);
  expect(await (await getDb()).get('recoveryJournal', 'active')).toMatchObject({ phase: 'commit' });
  idbSpy.mockRestore(); localSpy.mockRestore();
  // Recovery honors the last durable intent, rather than guessing a rollback
  // that never persisted. The user was told this operation needed recovery.
  expect((await loadProfile()).basics.firstName).toBe('Committed');
  expect(await (await getDb()).count('recoveryJournal')).toBe(0);
});

it('serializes backup snapshots and editors behind ordinary coordinated writers', async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release=resolve; });
  const write = withStorageWrite(async (db) => { await barrier; await db.put('blobs',blob('pending')); });
  const backup = gatherBackupPayload();
  release();
  await write;
  expect((await backup).idb.blobs).toEqual([expect.objectContaining({id:'pending'})]);
});

it('does not let an editor based before an interrupted restore overwrite recovered data', async () => {
  const old = await loadProfileSnapshot();
  await interrupted('commit',false);
  await expect(saveProfileSnapshot(old, old.profile)).rejects.toThrow(/changed elsewhere/);
  expect((await loadProfile()).basics.firstName).toBe('Restored');
});
