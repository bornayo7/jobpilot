import { browser } from '#imports';
import type { Profile } from '../schema/profile';
import { migrateProfile } from '../schema/migrations';

const KEY = 'jobpilot:profile';
const BACKUP_KEY = 'jobpilot:profile:backup';

export async function loadProfile(): Promise<Profile> {
  const stored = await browser.storage.local.get(KEY);
  return migrateProfile(stored[KEY]);
}

export async function saveProfile(profile: Profile): Promise<void> {
  // Keep the previous value as a one-deep backup so a bad save is recoverable.
  const prev = await browser.storage.local.get(KEY);
  await browser.storage.local.set({
    [KEY]: profile,
    ...(prev[KEY] !== undefined ? { [BACKUP_KEY]: prev[KEY] } : {}),
  });
}

export function watchProfile(cb: (profile: Profile) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area === 'local' && changes[KEY]) {
      cb(migrateProfile(changes[KEY].newValue));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
