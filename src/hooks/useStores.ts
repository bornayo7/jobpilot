import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { loadProfile, saveProfile, watchProfile } from '@lib/storage/profileStore';
import { loadSettings, saveSettings, watchSettings, type Settings } from '@lib/storage/settingsStore';

/**
 * The active profile as a live value: loaded once, then kept current by the
 * storage watcher, so an edit in the options page or a profile switch reaches
 * every open panel without reopening it. `save` applies the change locally
 * first so a controlled input never lags the storage round-trip.
 */
export function useProfile(): { profile: Profile | null; save: (next: Profile) => Promise<void> } {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    void loadProfile().then(setProfile);
    return watchProfile(setProfile);
  }, []);
  const save = useCallback(async (next: Profile) => {
    setProfile(next);
    await saveProfile(next);
  }, []);
  return { profile, save };
}

/** Settings, live, on the same terms as useProfile. */
export function useSettings(): { settings: Settings | null; save: (next: Settings) => Promise<void> } {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
    return watchSettings(setSettings);
  }, []);
  const save = useCallback(async (next: Settings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);
  return { settings, save };
}
