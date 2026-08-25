import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  switchProfile,
} from '@lib/storage/profileStore';

describe('multi-profile store', () => {
  beforeEach(() => fakeBrowser.reset());

  it('migrates a legacy single profile into the container', async () => {
    await fakeBrowser.storage.local.set({
      'jobpilot:profile': { schemaVersion: 1, basics: { firstName: 'Ada' } },
    });
    const profile = await loadProfile();
    expect(profile.basics.firstName).toBe('Ada');
    const metas = await listProfiles();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ name: 'Default', active: true });
  });

  it('save/load operate on the active profile; switching swaps contents', async () => {
    const first = await loadProfile();
    first.basics.firstName = 'Ada';
    await saveProfile(first);

    const secondId = await createProfile('ML roles');
    const blank = await loadProfile();
    expect(blank.basics.firstName).toBe(''); // new profile is empty and active
    blank.basics.firstName = 'Grace';
    await saveProfile(blank);

    const metas = await listProfiles();
    const defaultId = metas.find((m) => m.name === 'Default')!.id;
    await switchProfile(defaultId);
    expect((await loadProfile()).basics.firstName).toBe('Ada');
    await switchProfile(secondId);
    expect((await loadProfile()).basics.firstName).toBe('Grace');
  });

  it('duplicate copies the active profile; delete refuses to remove the last one', async () => {
    const active = await loadProfile();
    active.basics.email = 'ada@example.com';
    await saveProfile(active);

    await createProfile('Copy', true);
    expect((await loadProfile()).basics.email).toBe('ada@example.com');

    const metas = await listProfiles();
    for (const meta of metas) await deleteProfile(meta.id);
    // One must survive.
    expect(await listProfiles()).toHaveLength(1);
  });
});
