import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createProfile, deleteProfile, listProfiles, loadProfile, loadProfileSnapshot, saveProfileSnapshot, switchProfile, renameProfile, ProfileConflictError } from '@lib/storage/profileStore';
import { getDb } from '@lib/storage/db';

beforeEach(async () => { fakeBrowser.reset(); await (await getDb()).clear('recoveryJournal'); });
describe('identity-aware profile store', () => {
  it('migrates legacy data and revisions without losing content', async () => {
    await fakeBrowser.storage.local.set({ 'jobpilot:profile': { basics: { firstName: 'Ada' } } });
    const snapshot = await loadProfileSnapshot();
    expect(snapshot).toMatchObject({ id: 'default', revision: 0, profile: { basics: { firstName: 'Ada' } } });
    snapshot.profile.basics.firstName = 'Grace';
    const saved = await saveProfileSnapshot(snapshot, snapshot.profile);
    expect(saved.revision).toBe(1);
    expect((await loadProfile()).basics.firstName).toBe('Grace');
  });
  it('keeps the original save target when the active profile switches', async () => {
    const first = await loadProfileSnapshot();
    const second = await createProfile('ML roles');
    first.profile.basics.firstName = 'Ada';
    await saveProfileSnapshot(first, first.profile);
    expect((await loadProfile()).basics.firstName).toBe('');
    await switchProfile(first.id);
    expect((await loadProfile()).basics.firstName).toBe('Ada');
    expect(second).not.toBe(first.id);
  });
  it('preserves simultaneous creates with clone-faithful storage', async () => {
    await loadProfile();
    const [a,b] = await Promise.all([createProfile('A'),createProfile('B')]);
    expect((await listProfiles()).map((row) => row.id)).toEqual(expect.arrayContaining(['default', a, b]));
    expect(await listProfiles()).toHaveLength(3);
  });
  it('rejects a stale save without erasing the newer content', async () => {
    const base = await loadProfileSnapshot();
    const newer = structuredClone(base.profile); newer.basics.firstName = 'Newer';
    await saveProfileSnapshot(base, newer);
    base.profile.basics.firstName = 'Stale';
    await expect(saveProfileSnapshot(base, base.profile)).rejects.toBeInstanceOf(ProfileConflictError);
    expect((await loadProfile()).basics.firstName).toBe('Newer');
  });
  it('rename preserves the content revision so a dirty draft remains saveable', async () => {
    const base = await loadProfileSnapshot();
    await renameProfile(base.id, 'Renamed');
    base.profile.basics.firstName = 'Draft';
    expect(await saveProfileSnapshot(base, base.profile)).toMatchObject({ name: 'Renamed', revision: 1 });
  });
  it('repairs a dangling active id without replacing surviving profiles', async () => {
    await fakeBrowser.storage.local.set({ 'jobpilot:profiles': { activeId:'gone', profiles:{a:{name:'A',profile:{basics:{firstName:'Ada'}}},b:{name:'B',profile:{basics:{firstName:'Grace'}}}} } });
    expect((await loadProfile()).basics.firstName).toBe('Ada');
    expect(await listProfiles()).toHaveLength(2);
  });
  it('does not disguise unsupported stored content as an empty profile', async () => {
    const raw = { activeId:'a',profiles:{a:{name:'Future',profile:{schemaVersion:2,basics:{firstName:'Preserve'}}}} };
    await fakeBrowser.storage.local.set({ 'jobpilot:profiles':raw });
    await expect(loadProfile()).rejects.toThrow(/newer JobPilot/);
    expect((await fakeBrowser.storage.local.get('jobpilot:profiles'))['jobpilot:profiles']).toEqual(raw);
  });
  it('duplicates independently and refuses to delete the final profile', async () => {
    const base = await loadProfileSnapshot(); base.profile.basics.email = 'ada@example.com';
    await saveProfileSnapshot(base,base.profile);
    await createProfile('Copy',true);
    expect((await loadProfile()).basics.email).toBe('ada@example.com');
    for (const profile of await listProfiles()) await deleteProfile(profile.id);
    expect(await listProfiles()).toHaveLength(1);
  });
  it('test storage never gives callers the stored object reference', async () => {
    await fakeBrowser.storage.local.set({ example: { value: 'saved' } });
    const first = await fakeBrowser.storage.local.get<{ example: { value: string } }>('example'); first.example.value = 'mutated';
    expect((await fakeBrowser.storage.local.get<{ example: { value: string } }>('example')).example.value).toBe('saved');
  });
});
