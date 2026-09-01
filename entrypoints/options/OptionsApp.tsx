import { useEffect, useRef, useState } from 'react';
import {
  newId,
  ProfileSchema,
  type EduEntry,
  type Profile,
  type ProjectEntry,
  type WorkEntry,
} from '@lib/schema/profile';
import { migrateProfile } from '@lib/schema/migrations';
import { loadProfile, saveProfile, watchProfile } from '@lib/storage/profileStore';
import { DocumentsCard } from '@components/DocumentsCard';
import { ImportProfileCard } from '@components/ImportProfileCard';
import { BackupCard } from '@components/BackupCard';
import { ProfileSwitcher } from '@components/ProfileSwitcher';

export function OptionsApp() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadProfile().then(setProfile);
    // Profile switches (from the switcher) swap the whole editor contents.
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

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobpilot-profile.json';
    a.click();
    // Revoking synchronously races the download the click just started.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = migrateProfile(JSON.parse(await file.text()));
      // Validate hard on import — bad files should fail loudly, not half-load.
      setProfile(ProfileSchema.parse(parsed));
      setDirty(true);
    } catch (err) {
      alert(`Import failed: ${String(err)}`);
    }
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

type CardProps = { profile: Profile; update: (patch: Partial<Profile>) => void };

function Text({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function BasicsCard({ profile, update }: CardProps) {
  const b = profile.basics;
  const set = (patch: Partial<Profile['basics']>) => update({ basics: { ...b, ...patch } });
  const setLoc = (patch: Partial<Profile['basics']['location']>) =>
    set({ location: { ...b.location, ...patch } });
  return (
    <section className="card">
      <h2>Basics</h2>
      <div className="grid-2">
        <Text label="First name" value={b.firstName} onChange={(v) => set({ firstName: v })} />
        <Text label="Last name" value={b.lastName} onChange={(v) => set({ lastName: v })} />
        <Text label="Email" value={b.email} onChange={(v) => set({ email: v })} />
        <Text label="Phone" value={b.phone} onChange={(v) => set({ phone: v })} />
      </div>
      <div className="grid-3" style={{ marginTop: 10 }}>
        <Text label="City" value={b.location.city} onChange={(v) => setLoc({ city: v })} />
        <Text label="State / region" value={b.location.state} onChange={(v) => setLoc({ state: v })} />
        <Text label="Country" value={b.location.country} onChange={(v) => setLoc({ country: v })} />
        <Text label="Postal code" value={b.location.postal} onChange={(v) => setLoc({ postal: v })} />
      </div>
    </section>
  );
}

function LinksCard({ profile, update }: CardProps) {
  const l = profile.links;
  const set = (patch: Partial<Profile['links']>) => update({ links: { ...l, ...patch } });
  return (
    <section className="card">
      <h2>Links</h2>
      <div className="grid-3">
        <Text label="LinkedIn" value={l.linkedin} onChange={(v) => set({ linkedin: v })} placeholder="https://linkedin.com/in/…" />
        <Text label="GitHub" value={l.github} onChange={(v) => set({ github: v })} placeholder="https://github.com/…" />
        <Text label="Portfolio" value={l.portfolio} onChange={(v) => set({ portfolio: v })} />
      </div>
    </section>
  );
}

function WorkCard({ profile, update }: CardProps) {
  const entries = profile.work;
  const setEntry = (i: number, patch: Partial<WorkEntry>) => {
    const next = entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry));
    update({ work: next });
  };
  return (
    <section className="card">
      <h2>Work experience</h2>
      <p className="hint">
        Bullets can carry tags (comma-separated) — tailoring selects bullets whose tags cover a
        job's requirements.
      </p>
      {entries.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <div className="entry-header">
            <span className="title">{entry.title || entry.company || `Position ${i + 1}`}</span>
            <button className="entry-remove" onClick={() => update({ work: entries.filter((_, idx) => idx !== i) })}>
              Remove
            </button>
          </div>
          <div className="grid-2">
            <Text label="Company" value={entry.company} onChange={(v) => setEntry(i, { company: v })} />
            <Text label="Title" value={entry.title} onChange={(v) => setEntry(i, { title: v })} />
            <Text label="Location" value={entry.location} onChange={(v) => setEntry(i, { location: v })} />
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={entry.current}
                onChange={(e) => setEntry(i, { current: e.target.checked })}
              />
              I currently work here
            </label>
            <Text label="Start (Month YYYY)" value={entry.start} onChange={(v) => setEntry(i, { start: v })} placeholder="Jun 2024" />
            {!entry.current && (
              <Text label="End (Month YYYY)" value={entry.end} onChange={(v) => setEntry(i, { end: v })} placeholder="Aug 2026" />
            )}
          </div>
          <BulletsEditor
            bullets={entry.bullets}
            onChange={(bullets) => setEntry(i, { bullets })}
          />
        </div>
      ))}
      <button
        className="add-row"
        onClick={() =>
          update({
            work: [
              ...entries,
              { id: newId(), company: '', title: '', location: '', start: '', end: '', current: false, bullets: [] },
            ],
          })
        }
      >
        + Add position
      </button>
    </section>
  );
}

function BulletsEditor({
  bullets,
  onChange,
}: {
  bullets: { text: string; tags: string[] }[];
  onChange: (bullets: { text: string; tags: string[] }[]) => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      {bullets.map((bullet, i) => (
        <div className="grid-2" key={i} style={{ marginBottom: 6, gridTemplateColumns: '2fr 1fr auto' }}>
          <label className="field">
            Bullet
            <textarea
              rows={2}
              value={bullet.text}
              onChange={(e) => onChange(bullets.map((b, idx) => (idx === i ? { ...b, text: e.target.value } : b)))}
            />
          </label>
          <label className="field">
            Tags
            <input
              value={bullet.tags.join(', ')}
              placeholder="react, testing"
              onChange={(e) =>
                onChange(
                  bullets.map((b, idx) =>
                    idx === i
                      ? { ...b, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }
                      : b,
                  ),
                )
              }
            />
          </label>
          <button className="entry-remove" onClick={() => onChange(bullets.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...bullets, { text: '', tags: [] }])}>+ Add bullet</button>
    </div>
  );
}

function EducationCard({ profile, update }: CardProps) {
  const entries = profile.education;
  const setEntry = (i: number, patch: Partial<EduEntry>) =>
    update({ education: entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)) });
  return (
    <section className="card">
      <h2>Education</h2>
      {entries.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <div className="entry-header">
            <span className="title">{entry.school || `School ${i + 1}`}</span>
            <button className="entry-remove" onClick={() => update({ education: entries.filter((_, idx) => idx !== i) })}>
              Remove
            </button>
          </div>
          <div className="grid-3">
            <Text label="School" value={entry.school} onChange={(v) => setEntry(i, { school: v })} />
            <Text label="Degree" value={entry.degree} onChange={(v) => setEntry(i, { degree: v })} placeholder="B.S." />
            <Text label="Field of study" value={entry.field} onChange={(v) => setEntry(i, { field: v })} />
            <Text label="GPA" value={entry.gpa} onChange={(v) => setEntry(i, { gpa: v })} />
            <Text label="Start" value={entry.start} onChange={(v) => setEntry(i, { start: v })} placeholder="Aug 2023" />
            <Text label="End (or expected)" value={entry.end} onChange={(v) => setEntry(i, { end: v })} placeholder="May 2027" />
          </div>
        </div>
      ))}
      <button
        className="add-row"
        onClick={() =>
          update({
            education: [...entries, { id: newId(), school: '', degree: '', field: '', gpa: '', start: '', end: '' }],
          })
        }
      >
        + Add education
      </button>
    </section>
  );
}

function ProjectsCard({ profile, update }: CardProps) {
  const entries = profile.projects;
  const setEntry = (i: number, patch: Partial<ProjectEntry>) =>
    update({ projects: entries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)) });
  return (
    <section className="card">
      <h2>Projects</h2>
      {entries.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <div className="entry-header">
            <span className="title">{entry.name || `Project ${i + 1}`}</span>
            <button className="entry-remove" onClick={() => update({ projects: entries.filter((_, idx) => idx !== i) })}>
              Remove
            </button>
          </div>
          <div className="grid-2">
            <Text label="Name" value={entry.name} onChange={(v) => setEntry(i, { name: v })} />
            <Text label="URL" value={entry.url} onChange={(v) => setEntry(i, { url: v })} />
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            Description
            <textarea
              rows={2}
              value={entry.description}
              onChange={(e) => setEntry(i, { description: e.target.value })}
            />
          </label>
          <BulletsEditor bullets={entry.bullets} onChange={(bullets) => setEntry(i, { bullets })} />
        </div>
      ))}
      <button
        className="add-row"
        onClick={() =>
          update({ projects: [...entries, { id: newId(), name: '', url: '', description: '', bullets: [] }] })
        }
      >
        + Add project
      </button>
    </section>
  );
}

function SkillsCard({ profile, update }: CardProps) {
  const skillsText = profile.skills.map((s) => (s.category ? `${s.name} [${s.category}]` : s.name)).join(', ');
  return (
    <section className="card">
      <h2>Skills</h2>
      <p className="hint">Comma-separated. Optional category in brackets: React [frontend], Python [ML].</p>
      <label className="field">
        Skills
        <textarea
          // Uncontrolled (commits on blur) so typing isn't re-parsed per
          // keystroke — but keyed on the stored value so a profile switch or a
          // resume import remounts it. Without the key the box kept showing the
          // previous profile's skills and blurring wrote them back over the new
          // ones.
          key={skillsText}
          rows={3}
          defaultValue={skillsText}
          onBlur={(e) => {
            const skills = e.target.value
              .split(',')
              .map((raw) => raw.trim())
              .filter(Boolean)
              .map((raw) => {
                const match = raw.match(/^(.*?)\s*\[(.+)\]$/);
                return match ? { name: match[1]!.trim(), category: match[2]!.trim() } : { name: raw, category: '' };
              });
            update({ skills });
          }}
        />
      </label>
    </section>
  );
}

function WorkAuthCard({ profile, update }: CardProps) {
  const wa = profile.workAuth;
  const set = (patch: Partial<Profile['workAuth']>) => update({ workAuth: { ...wa, ...patch } });
  return (
    <section className="card">
      <h2>Work authorization</h2>
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={wa.authorizedUS}
          onChange={(e) => set({ authorizedUS: e.target.checked })}
        />
        Authorized to work in the US
      </label>
      <label className="field checkbox">
        <input
          type="checkbox"
          checked={wa.needsSponsorship}
          onChange={(e) => set({ needsSponsorship: e.target.checked })}
        />
        Will require visa sponsorship now or in the future
      </label>
      <label className="field" style={{ marginTop: 8 }}>
        Visa note (optional)
        <input value={wa.visaNote} onChange={(e) => set({ visaNote: e.target.value })} placeholder="F-1 OPT, STEM extension eligible…" />
      </label>
    </section>
  );
}

function EeoCard({ profile, update }: CardProps) {
  const eeo = profile.eeo;
  const set = (patch: Partial<Profile['eeo']>) => update({ eeo: { ...eeo, ...patch } });
  return (
    <section className="card">
      <h2>Voluntary self-identification (EEO)</h2>
      <p className="sensitive-note">
        Sensitive — stored only on this machine, never sent to any model, and always flagged for
        review before filling. Leave blank to always answer these by hand.
      </p>
      <div className="grid-2">
        <Text label="Gender" value={eeo.gender} onChange={(v) => set({ gender: v })} placeholder="e.g. Male / Female / Decline to answer" />
        <Text label="Race / ethnicity" value={eeo.race} onChange={(v) => set({ race: v })} />
        <Text label="Veteran status" value={eeo.veteran} onChange={(v) => set({ veteran: v })} placeholder="I am not a protected veteran" />
        <Text label="Disability status" value={eeo.disability} onChange={(v) => set({ disability: v })} placeholder="No, I do not have a disability" />
        <Text label="Pronouns" value={eeo.pronouns} onChange={(v) => set({ pronouns: v })} />
      </div>
    </section>
  );
}

function PreferencesCard({ profile, update }: CardProps) {
  const p = profile.preferences;
  const set = (patch: Partial<Profile['preferences']>) => update({ preferences: { ...p, ...patch } });
  return (
    <section className="card">
      <h2>Preferences</h2>
      <div className="grid-2">
        <Text label="Expected salary" value={p.expectedSalary} onChange={(v) => set({ expectedSalary: v })} placeholder="$95,000 / negotiable" />
        <Text label="Available start date" value={p.availableStart} onChange={(v) => set({ availableStart: v })} placeholder="Immediately / Jun 2027" />
      </div>
    </section>
  );
}
