import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { loadProfileSnapshot, saveProfileSnapshot, watchProfileSnapshot, type ProfileSnapshot } from '@lib/storage/profileStore';
import { loadSettingsSnapshot, patchSettings, watchSettingsSnapshot, type SettingsSnapshot } from '@lib/storage/settingsStore';

/**
 * The active profile as a live value: loaded once, then kept current by the
 * storage watcher. Saves name the originating profile and revision; editable
 * drafts stay in their editor until storage accepts them.
 */
export function useProfile() {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  const reload = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await loadProfileSnapshot();
      if (id === request.current) { setSnapshot(next); setError(''); }
    } catch (err) { if (id === request.current) setError(String(err)); }
  }, []);
  useEffect(() => {
    void reload();
    const stop = watchProfileSnapshot((next) => { request.current++; setSnapshot(next); setError(''); }, (err) => setError(String(err)));
    return () => { request.current++; stop(); };
  }, [reload]);
  const save = useCallback(async (next: Profile) => {
    if (!snapshot) throw new Error('The profile is still loading.');
    const saved = await saveProfileSnapshot(snapshot, next);
    setSnapshot((current) => current?.id === saved.id && current.revision <= saved.revision ? saved : current);
    return saved;
  }, [snapshot]);
  return { snapshot, profile: snapshot?.profile ?? null, save, error, reload };
}

/** Settings, live, on the same terms as useProfile. */
export function useSettings() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  const reload = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await loadSettingsSnapshot();
      if (id === request.current) { setSnapshot(next); setError(''); }
    } catch (err) { if (id === request.current) setError(String(err)); }
  }, []);
  useEffect(() => {
    void reload();
    const stop = watchSettingsSnapshot((next) => { request.current++; setSnapshot(next); setError(''); }, (err) => setError(String(err)));
    return () => { request.current++; stop(); };
  }, [reload]);
  const patch = useCallback(async (changes: Parameters<typeof patchSettings>[0]) => {
    const saved = await patchSettings(changes, snapshot ?? undefined);
    setSnapshot((current) => !current || current.revision <= saved.revision ? saved : current);
    return saved;
  }, [snapshot]);
  return { snapshot, settings: snapshot?.settings ?? null, patch, error, reload };
}
