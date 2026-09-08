import { newId } from '@lib/schema/profile';
import { BulletsEditor, EntryHeader, Text, listActions, type CardProps } from './fields';

export function WorkCard({ profile, update }: CardProps) {
  const work = listActions(profile.work, (next) => update({ work: next }));
  return (
    <section className="card">
      <h2>Work experience</h2>
      <p className="hint">
        Bullets can carry tags (comma-separated) — tailoring selects bullets whose tags cover a
        job's requirements.
      </p>
      {profile.work.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <EntryHeader title={entry.title || entry.company || `Position ${i + 1}`} onRemove={() => work.remove(i)} />
          <div className="grid-2">
            <Text label="Company" value={entry.company} onChange={(company) => work.patch(i, { company })} />
            <Text label="Title" value={entry.title} onChange={(title) => work.patch(i, { title })} />
            <Text label="Location" value={entry.location} onChange={(location) => work.patch(i, { location })} />
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={entry.current}
                onChange={(e) => work.patch(i, { current: e.target.checked })}
              />
              I currently work here
            </label>
            <Text label="Start (Month YYYY)" value={entry.start} onChange={(start) => work.patch(i, { start })} placeholder="Jun 2024" />
            {!entry.current && (
              <Text label="End (Month YYYY)" value={entry.end} onChange={(end) => work.patch(i, { end })} placeholder="Aug 2026" />
            )}
          </div>
          <BulletsEditor bullets={entry.bullets} onChange={(bullets) => work.patch(i, { bullets })} />
        </div>
      ))}
      <button
        className="add-row"
        onClick={() =>
          work.add({ id: newId(), company: '', title: '', location: '', start: '', end: '', current: false, bullets: [] })
        }
      >
        + Add position
      </button>
    </section>
  );
}
