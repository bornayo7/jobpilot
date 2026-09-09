import { browser } from '#imports';
import { newId, type Profile } from '../schema/profile';
import { validateProfile } from '../schema/migrations';
import { withStorageRead, withStorageWrite } from './coordination';
import { retainRevisionFloor } from './revisions';

export const PROFILES_KEY = 'jobpilot:profiles';
const LEGACY_KEY = 'jobpilot:profile';

export interface ProfileSnapshot { id: string; name: string; revision: number; profile: Profile }
export interface ProfileMeta { id: string; name: string; active: boolean }
export interface ProfilesContainer {
  schemaVersion: 1;
  activeId: string;
  profiles: Record<string, { name: string; revision: number; profile: Profile }>;
}
export class ProfileConflictError extends Error {
  constructor(public readonly current: ProfileSnapshot | null) {
    super(current ? 'This profile changed elsewhere. Review the latest saved version before saving your draft.' : 'This profile was removed. Save the draft to another profile.');
    this.name = 'ProfileConflictError';
  }
}

/** Strict storage/import validation. Defaults never turn unsupported data into
 * an apparently normal blank profile; the untouched raw value stays recoverable. */
export function parseProfilesContainer(raw: unknown): ProfilesContainer {
  if (!raw || typeof raw !== 'object') throw new Error('The saved profile container is invalid. Export a backup before repairing it.');
  const input = raw as Record<string, unknown>;
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('This profile container requires a newer JobPilot.');
  if (!input.profiles || typeof input.profiles !== 'object' || Array.isArray(input.profiles)) throw new Error('The profile list is invalid.');
  const profiles: ProfilesContainer['profiles'] = {};
  for (const [id, value] of Object.entries(input.profiles)) {
    if (!id || !value || typeof value !== 'object') throw new Error('An invalid profile entry needs recovery.');
    const slot = value as Record<string, unknown>;
    const result = validateProfile(slot.profile);
    if (!result.ok) throw new Error(`Profile ${id} cannot be loaded: ${result.errors.join('; ')}`);
    if (typeof slot.name !== 'string') throw new Error(`Profile ${id} has no valid name.`);
    const revision = slot.revision ?? 0;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error(`Profile ${id} has an invalid revision.`);
    Object.defineProperty(profiles, id, { value: { name: slot.name, revision, profile: result.profile }, enumerable: true, writable: true, configurable: true });
  }
  const ids = Object.keys(profiles);
  if (!ids.length) throw new Error('The profile list is empty. Recovery is required.');
  const activeId = typeof input.activeId === 'string' && Object.hasOwn(profiles, input.activeId) ? input.activeId : ids[0]!;
  return { schemaVersion: 1, activeId, profiles };
}

/** Internal: caller must hold the storage coordination lock. */
export async function readProfileContainer(): Promise<ProfilesContainer> {
  const stored = await browser.storage.local.get([PROFILES_KEY, LEGACY_KEY]);
  if (stored[PROFILES_KEY] !== undefined) {
    const container = parseProfilesContainer(stored[PROFILES_KEY]);
    if (JSON.stringify(container) !== JSON.stringify(stored[PROFILES_KEY])) await browser.storage.local.set({ [PROFILES_KEY]: container });
    return container;
  }
  let profile: Profile;
  if (stored[LEGACY_KEY] == null) {
    const { emptyProfile } = await import('../schema/profile');
    profile = emptyProfile();
  } else {
    const result = validateProfile(stored[LEGACY_KEY]);
    if (!result.ok) throw new Error(`Legacy profile needs recovery: ${result.errors.join('; ')}`);
    profile = result.profile;
  }
  const container: ProfilesContainer = { schemaVersion: 1, activeId: 'default', profiles: { default: { name: 'Default', revision: 0, profile } } };
  await browser.storage.local.set({ [PROFILES_KEY]: container });
  return container;
}

function snapshot(container: ProfilesContainer, id = container.activeId): ProfileSnapshot {
  const slot = container.profiles[id];
  if (!slot) throw new ProfileConflictError(null);
  return structuredClone({ id, ...slot });
}

export function loadContainer(): Promise<ProfilesContainer> { return withStorageRead(() => readProfileContainer()); }
export function loadProfileSnapshot(id?: string): Promise<ProfileSnapshot> {
  return withStorageRead(async () => snapshot(await readProfileContainer(), id));
}
export async function loadProfile(): Promise<Profile> { return (await loadProfileSnapshot()).profile; }

export function saveProfileSnapshot(base: ProfileSnapshot, next: Profile): Promise<ProfileSnapshot> {
  return withStorageWrite(async () => {
    const container = await readProfileContainer();
    const slot = container.profiles[base.id];
    if (!slot || slot.revision !== base.revision) throw new ProfileConflictError(slot ? snapshot(container, base.id) : null);
    const result = validateProfile(next);
    if (!result.ok) throw new Error(result.errors.join('; '));
    slot.profile = result.profile;
    slot.revision += 1;
    await browser.storage.local.set({ [PROFILES_KEY]: container });
    return snapshot(container, base.id);
  });
}

export function watchProfileSnapshot(callback: (next: ProfileSnapshot) => void, onError: (error: unknown) => void = console.error): () => void {
  let active = true;
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && changes[PROFILES_KEY]) void loadProfileSnapshot().then((value) => { if (active) callback(value); }, (error) => { if (active) onError(error); });
  };
  browser.storage.onChanged.addListener(listener);
  return () => { active = false; browser.storage.onChanged.removeListener(listener); };
}
export function watchProfile(callback: (profile: Profile) => void): () => void {
  return watchProfileSnapshot((value) => callback(value.profile));
}
export function listProfiles(): Promise<ProfileMeta[]> {
  return withStorageRead(async () => {
    const container = await readProfileContainer();
    return Object.entries(container.profiles).map(([id, slot]) => ({ id, name: slot.name, active: id === container.activeId }));
  });
}
export function switchProfile(id: string): Promise<void> {
  return withStorageWrite(async () => {
    const container = await readProfileContainer();
    if (!Object.hasOwn(container.profiles, id)) throw new ProfileConflictError(null);
    container.activeId = id;
    await browser.storage.local.set({ [PROFILES_KEY]: container });
  });
}
export function createProfile(name: string, duplicateActive = false): Promise<string> {
  return withStorageWrite(async () => {
    const container = await readProfileContainer();
    const { emptyProfile } = await import('../schema/profile');
    const id = newId();
    container.profiles[id] = { name: name.trim() || 'Untitled', revision: 0,
      profile: duplicateActive ? structuredClone(container.profiles[container.activeId]!.profile) : emptyProfile() };
    container.activeId = id;
    await browser.storage.local.set({ [PROFILES_KEY]: container });
    return id;
  });
}
export function renameProfile(id: string, name: string): Promise<void> {
  return withStorageWrite(async () => {
    const container = await readProfileContainer();
    const slot = container.profiles[id];
    if (!slot) throw new ProfileConflictError(null);
    slot.name = name.trim() || slot.name;
    await browser.storage.local.set({ [PROFILES_KEY]: container });
  });
}
export function deleteProfile(id: string): Promise<void> {
  return withStorageWrite(async () => {
    const container = await readProfileContainer();
    if (!Object.hasOwn(container.profiles, id) || Object.keys(container.profiles).length <= 1) return;
    await retainRevisionFloor(container.profiles[id]!.revision);
    delete container.profiles[id];
    if (container.activeId === id) container.activeId = Object.keys(container.profiles)[0]!;
    await browser.storage.local.set({ [PROFILES_KEY]: container });
  });
}
