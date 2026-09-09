import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { validateProfile } from '@lib/schema/migrations';
import { saveProfileSnapshot, type ProfileSnapshot } from '@lib/storage/profileStore';
import { useProfile } from '@hooks/useStores';
import type { ProfilePatch } from '@components/profile/fields';
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
 * draft, Save writes it back with its identity and base revision. Each profile
 * keeps its open draft; metadata notifications cannot replace dirty content.
 */
export function OptionsApp() {
  const { snapshot, error: loadError, reload } = useProfile();
  const savedRef = useRef(snapshot); savedRef.current = snapshot;
  const [drafts, setDrafts] = useState<Map<string, { base: ProfileSnapshot; profile: Profile; dirty: boolean; edit: number }>>(new Map());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!snapshot) return;
    setDrafts((prev) => {
      const current = prev.get(snapshot.id);
      const next = new Map(prev);
      if (!current || !current.dirty) next.set(snapshot.id, { base: snapshot, profile: snapshot.profile, dirty: false, edit: current?.edit ?? 0 });
      else if (current.base.revision === snapshot.revision && JSON.stringify(current.base.profile) === JSON.stringify(snapshot.profile)) next.set(snapshot.id, { ...current, base: snapshot });
      return next;
    });
  }, [snapshot]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ([...draftsRef.current.values()].some((draft) => draft.dirty)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const entry = snapshot ? drafts.get(snapshot.id) : undefined;
  if (!snapshot || !entry) return <div className="options"><h1>JobPilot profile</h1><p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading profile…'}</p>{loadError && <><button onClick={() => void reload()}>Retry loading</button><p className="hint">Keep a recovery export of the current data, or inspect a known good backup below.</p><BackupCard /></>}</div>;
  const { profile, dirty } = entry;
  const profileId = snapshot.id;
  const conflict = entry.base.revision !== snapshot.revision || JSON.stringify(entry.base.profile) !== JSON.stringify(snapshot.profile);

  const update = (patch: ProfilePatch) => {
    const current = draftsRef.current.get(profileId);
    if (current?.base.revision !== entry.base.revision || (savedRef.current?.id === profileId && savedRef.current.revision !== snapshot.revision)) {
      setError('The saved profile changed during this action. Your current draft was preserved. Repeat the action on the latest profile.');
      return;
    }
    setDrafts((prev) => {
      const current = prev.get(profileId);
      if (!current || current.base.revision !== entry.base.revision) return prev;
      const fields = typeof patch === 'function' ? patch(current.profile) : patch;
      if (Object.keys(fields).length === 0) return prev;
      const next = new Map(prev);
      next.set(profileId, { ...current, profile: { ...current.profile, ...fields }, dirty: true, edit: current.edit + 1 });
      return next;
    });
    setMessage('');
  };

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const saved = await saveProfileSnapshot(entry.base, profile);
      setDrafts((prev) => {
        const current = prev.get(profileId);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(profileId, { ...current, base: saved, dirty: current.edit !== entry.edit });
        return next;
      });
      setMessage(`Saved ${saved.name}.`);
    } catch (err) { setError(`Profile was not saved. ${String(err)}`); }
    finally { setSaving(false); }
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
      setError(`Import failed: ${String(err)}`);
      return;
    }
    const result = validateProfile(raw);
    if (!result.ok) {
      setError(`Import failed — not a JobPilot profile: ${result.errors.join('; ')}`);
      return;
    }
    if (draftsRef.current.get(profileId)?.edit !== entry.edit) { setError('Your profile changed while the file was being read. Import it again to replace the latest draft.'); return; }
    update(result.profile);
    setError('');
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

      <p className="hint">Your facts stay on this device. Changes are drafts until you save; switching profiles keeps each open draft.</p>
      {(error || loadError) && <div className="warn-box" role="alert">{error || loadError}</div>}
      {conflict && <div className="warn-box" role="alert"><div>This profile changed in another page. Your draft is preserved. Export it before replacing it with the saved profile.</div><button onClick={exportJson}>Export draft</button><button onClick={() => setDrafts((prev) => new Map(prev).set(profileId, { base: snapshot, profile: snapshot.profile, dirty: false, edit: entry.edit + 1 }))}>Use saved profile</button></div>}

      <ImportProfileCard key={`import:${profileId}`} profile={profile} update={update} />
      <BasicsCard profile={profile} update={update} />
      <DocumentsCard key={`documents:${profileId}`} profile={profile} update={update} />
      <LinksCard profile={profile} update={update} />
      <WorkCard profile={profile} update={update} />
      <EducationCard profile={profile} update={update} />
      <ProjectsCard profile={profile} update={update} />
      <SkillsCard key={`skills:${profileId}`} profile={profile} update={update} />
      <WorkAuthCard profile={profile} update={update} />
      <EeoCard profile={profile} update={update} />
      <PreferencesCard profile={profile} update={update} />
      <BackupCard />

      <div className="save-float">
        <span className="status" role="status">
          {dirty ? `Unsaved changes to ${snapshot.name}` : message || 'Profile is up to date'}
        </span>
        <button className="primary" onClick={() => void save()} disabled={!dirty || saving || conflict}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
