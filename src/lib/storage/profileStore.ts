import { browser } from '#imports';
import type { Profile } from '../schema/profile';
import { newId } from '../schema/profile';
import { migrateProfile } from '../schema/migrations';

/**
 * Multi-profile container (v2). `loadProfile`/`saveProfile`/`watchProfile`
 * keep their original single-profile semantics — they operate on the ACTIVE
 * profile — so every existing consumer works unchanged. Management functions
 * below handle switching/creating/renaming.
 */
const CONTAINER_KEY = 'jobpilot:profiles';
const LEGACY_KEY = 'jobpilot:profile';
const BACKUP_KEY = 'jobpilot:profile:backup';

export interface ProfileMeta {
  id: string;
  name: string;
  active: boolean;
}

interface ProfilesContainer {
  activeId: string;
  profiles: Record<string, { name: string; profile: Profile }>;
}

export async function loadContainer(): Promise<ProfilesContainer> {
  const stored = await browser.storage.local.get([CONTAINER_KEY, LEGACY_KEY]);
  const container = stored[CONTAINER_KEY] as ProfilesContainer | undefined;
  if (container && container.profiles && container.activeId in container.profiles) {
    return container;
  }
  // Migrate the single-profile era (or bootstrap fresh).
  const migrated: ProfilesContainer = {
    activeId: 'default',
    profiles: { default: { name: 'Default', profile: migrateProfile(stored[LEGACY_KEY]) } },
  };
  await browser.storage.local.set({ [CONTAINER_KEY]: migrated });
  return migrated;
}

async function saveContainer(container: ProfilesContainer): Promise<void> {
  await browser.storage.local.set({ [CONTAINER_KEY]: container });
}

export async function loadProfile(): Promise<Profile> {
  const container = await loadContainer();
  return migrateProfile(container.profiles[container.activeId]?.profile);
}

export async function saveProfile(profile: Profile): Promise<void> {
  const container = await loadContainer();
  const slot = container.profiles[container.activeId];
  if (slot) {
    await browser.storage.local.set({ [BACKUP_KEY]: slot.profile });
    slot.profile = profile;
  } else {
    container.profiles[container.activeId] = { name: 'Default', profile };
  }
  await saveContainer(container);
}

/** Fires on any change to the active profile, including profile switches. */
export function watchProfile(cb: (profile: Profile) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes[CONTAINER_KEY]) return;
    const container = changes[CONTAINER_KEY].newValue as ProfilesContainer | undefined;
    if (!container) return;
    cb(migrateProfile(container.profiles[container.activeId]?.profile));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/* ---------- management ---------- */

export async function listProfiles(): Promise<ProfileMeta[]> {
  const container = await loadContainer();
  return Object.entries(container.profiles).map(([id, slot]) => ({
    id,
    name: slot.name,
    active: id === container.activeId,
  }));
}

export async function switchProfile(id: string): Promise<void> {
  const container = await loadContainer();
  if (!(id in container.profiles)) return;
  container.activeId = id;
  await saveContainer(container);
}

export async function createProfile(name: string, duplicateActive = false): Promise<string> {
  const container = await loadContainer();
  const id = newId();
  const base = duplicateActive
    ? structuredClone(container.profiles[container.activeId]!.profile)
    : migrateProfile(null);
  container.profiles[id] = { name: name.trim() || 'Untitled', profile: base };
  container.activeId = id;
  await saveContainer(container);
  return id;
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const container = await loadContainer();
  const slot = container.profiles[id];
  if (!slot) return;
  slot.name = name.trim() || slot.name;
  await saveContainer(container);
}

export async function deleteProfile(id: string): Promise<void> {
  const container = await loadContainer();
  if (!(id in container.profiles) || Object.keys(container.profiles).length <= 1) return;
  delete container.profiles[id];
  if (container.activeId === id) {
    container.activeId = Object.keys(container.profiles)[0]!;
  }
  await saveContainer(container);
}
