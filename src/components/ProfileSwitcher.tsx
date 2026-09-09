import { useEffect, useState } from 'react';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  renameProfile,
  switchProfile,
  watchProfileSnapshot,
  type ProfileMeta,
} from '@lib/storage/profileStore';

/**
 * Multiple profiles (e.g. "SWE" vs "ML roles") — each has its own bullets,
 * default resume, and answers defaults. Switching changes what every tab
 * reads, live (they all watch the container).
 */
export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => void listProfiles().then(setProfiles).catch((err) => setError(String(err)));
  useEffect(() => { refresh(); return watchProfileSnapshot(refresh); }, []);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); refresh(); }
    catch (err) { setError(`Profile change failed. ${String(err)}`); }
    finally { setBusy(false); }
  };

  const active = profiles.find((p) => p.active);

  const onSwitch = async (id: string) => {
    await run(() => switchProfile(id));
  };

  const onCreate = async (duplicate: boolean) => {
    const name = prompt(duplicate ? 'Name for the copy:' : 'Name for the new profile:');
    if (name === null) return;
    await run(() => createProfile(name, duplicate));
  };

  const onRename = async () => {
    if (!active) return;
    const name = prompt('New name:', active.name);
    if (name === null) return;
    await run(() => renameProfile(active.id, name));
  };

  const onDelete = async () => {
    if (!active || profiles.length <= 1) return;
    if (!confirm(`Delete saved profile "${active.name}"? This cannot be undone.`)) return;
    await run(() => deleteProfile(active.id));
  };

  return (
    <div className="profile-switcher">
      <select aria-label="Active profile" disabled={busy} value={active?.id ?? ''} onChange={(e) => void onSwitch(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button disabled={busy} onClick={() => void onCreate(false)} title="New blank profile">New</button>
      <button disabled={busy} onClick={() => void onCreate(true)} title="Duplicate saved profile">Duplicate</button>
      <button disabled={busy} onClick={() => void onRename()}>Rename</button>
      {profiles.length > 1 && (
        <button disabled={busy} className="entry-remove" onClick={() => void onDelete()}>
          Delete
        </button>
      )}
      {error && <span role="alert" className="error-text">{error}</span>}
    </div>
  );
}
