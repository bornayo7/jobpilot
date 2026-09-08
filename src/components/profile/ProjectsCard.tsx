import { newId } from '@lib/schema/profile';
import { BulletsEditor, EntryHeader, Text, listActions, type CardProps } from './fields';

export function ProjectsCard({ profile, update }: CardProps) {
  const projects = listActions(profile.projects, (next) => update({ projects: next }));
  return (
    <section className="card">
      <h2>Projects</h2>
      {profile.projects.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <EntryHeader title={entry.name || `Project ${i + 1}`} onRemove={() => projects.remove(i)} />
          <div className="grid-2">
            <Text label="Name" value={entry.name} onChange={(name) => projects.patch(i, { name })} />
            <Text label="URL" value={entry.url} onChange={(url) => projects.patch(i, { url })} />
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            Description
            <textarea
              rows={2}
              value={entry.description}
              onChange={(e) => projects.patch(i, { description: e.target.value })}
            />
          </label>
          <BulletsEditor bullets={entry.bullets} onChange={(bullets) => projects.patch(i, { bullets })} />
        </div>
      ))}
      <button
        className="add-row"
        onClick={() => projects.add({ id: newId(), name: '', url: '', description: '', bullets: [] })}
      >
        + Add project
      </button>
    </section>
  );
}
