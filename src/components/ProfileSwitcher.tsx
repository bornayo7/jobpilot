import { useEffect, useState } from 'react';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  renameProfile,
  switchProfile,
  type ProfileMeta,
} from '@lib/storage/profileStore';

/**
 * Multiple profiles (e.g. "SWE" vs "ML roles") — each has its own bullets,
 * default resume, and answers defaults. Switching changes what every tab
 * reads, live (they all watch the container).
 */
export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);

  const refresh = () => void listProfiles().then(setProfiles);
  useEffect(refresh, []);

  const active = profiles.find((p) => p.active);

  const onSwitch = async (id: string) => {
    await switchProfile(id);
    refresh();
  };

  const onCreate = async (duplicate: boolean) => {
    const name = prompt(duplicate ? 'Name for the copy:' : 'Name for the new profile:');
    if (name === null) return;
    await createProfile(name, duplicate);
    refresh();
  };

  const onRename = async () => {
    if (!active) return;
    const name = prompt('New name:', active.name);
    if (name === null) return;
    await renameProfile(active.id, name);
    refresh();
  };

  const onDelete = async () => {
    if (!active || profiles.length <= 1) return;
    if (!confirm(`Delete profile "${active.name}" and all its data? This cannot be undone.`)) return;
    await deleteProfile(active.id);
    refresh();
  };

  return (
    <div className="profile-switcher">
      <select value={active?.id ?? ''} onChange={(e) => void onSwitch(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button onClick={() => void onCreate(false)} title="New blank profile">+ New</button>
      <button onClick={() => void onCreate(true)} title="Duplicate current profile">Duplicate</button>
      <button onClick={() => void onRename()}>Rename</button>
      {profiles.length > 1 && (
        <button className="entry-remove" onClick={() => void onDelete()}>
          Delete
        </button>
      )}
    </div>
  );
}
