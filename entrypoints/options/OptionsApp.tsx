import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { validateProfile } from '@lib/schema/migrations';
import { loadProfile, saveProfile, watchProfile } from '@lib/storage/profileStore';
import { downloadFile } from '@lib/util/download';
import { BackupCard } from '@components/BackupCard';
import { ProfileSwitcher } from '@components/ProfileSwitcher';
import { BasicsCard } from '@components/profile/BasicsCard';
import { DocumentsCard } from '@components/profile/DocumentsCard';
import { EducationCard } from '@components/profile/EducationCard';
import { EeoCard } from '@components/profile/EeoCard';
import { ImportProfileCard } from '@components/profile/ImportProfileCard';
import { LinksCard } from '@components/profile/LinksCard';
import { PreferencesCard } from '@components/profile/PreferencesCard';
import { ProjectsCard } from '@components/profile/ProjectsCard';
import { SkillsCard } from '@components/profile/SkillsCard';
import { WorkAuthCard } from '@components/profile/WorkAuthCard';
import { WorkCard } from '@components/profile/WorkCard';

/**
 * The profile editor. Holds a draft of the active profile: cards patch the
 * draft, Save writes it back. The draft is replaced wholesale when the stored
 * profile changes underneath it (a switch in the ProfileSwitcher).
 */
export function OptionsApp() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadProfile().then(setProfile);
    return watchProfile((next) => {
      setProfile(next);
      setDirty(false);
    });
  }, []);

  if (!profile) return <div className="options"><p>Loading…</p></div>;

  const update = (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch });
    setDirty(true);
  };

  const save = async () => {
    await saveProfile(profile);
    setDirty(false);
    setSavedAt(Date.now());
  };

  const exportJson = () =>
    downloadFile(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }), 'jobpilot-profile.json');

  const importJson = async (file: File) => {
    // Validate hard on import — a bad file must fail loudly, not load as an
    // empty profile that one click on Save would write over the real one.
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch (err) {
      alert(`Import failed: ${String(err)}`);
      return;
    }
    const result = validateProfile(raw);
    if (!result.ok) {
      alert(`Import failed — not a JobPilot profile:\n${result.errors.join('\n')}`);
      return;
    }
    setProfile(result.profile);
    setDirty(true);
  };

  return (
    <div className="options">
      <header className="options-header">
        <h1>JobPilot profile</h1>
        <ProfileSwitcher />
        <div className="actions">
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()}>Import JSON</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <ImportProfileCard profile={profile} update={update} />
      <BasicsCard profile={profile} update={update} />
      <DocumentsCard profile={profile} update={update} />
      <LinksCard profile={profile} update={update} />
      <WorkCard profile={profile} update={update} />
      <EducationCard profile={profile} update={update} />
      <ProjectsCard profile={profile} update={update} />
      <SkillsCard profile={profile} update={update} />
      <WorkAuthCard profile={profile} update={update} />
      <EeoCard profile={profile} update={update} />
      <PreferencesCard profile={profile} update={update} />
      <BackupCard />

      <div className="save-float">
        <span className="status">
          {dirty ? 'Unsaved changes' : savedAt ? 'Saved' : ''}
        </span>
        <button className="primary" onClick={save} disabled={!dirty}>
          Save profile
        </button>
      </div>
    </div>
  );
}
