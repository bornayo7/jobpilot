import { newId } from '@lib/schema/profile';
import { EntryHeader, Text, listActions, type CardProps } from './fields';

export function EducationCard({ profile, update }: CardProps) {
  const education = listActions(profile.education, (next) => update({ education: next }));
  return (
    <section className="card">
      <h2>Education</h2>
      {profile.education.map((entry, i) => (
        <div className="entry" key={entry.id}>
          <EntryHeader title={entry.school || `School ${i + 1}`} onRemove={() => education.remove(i)} />
          <div className="grid-3">
            <Text label="School" value={entry.school} onChange={(school) => education.patch(i, { school })} />
            <Text label="Degree" value={entry.degree} onChange={(degree) => education.patch(i, { degree })} placeholder="B.S." />
            <Text label="Field of study" value={entry.field} onChange={(field) => education.patch(i, { field })} />
            <Text label="GPA" value={entry.gpa} onChange={(gpa) => education.patch(i, { gpa })} />
            <Text label="Start" value={entry.start} onChange={(start) => education.patch(i, { start })} placeholder="Aug 2023" />
            <Text label="End (or expected)" value={entry.end} onChange={(end) => education.patch(i, { end })} placeholder="May 2027" />
          </div>
        </div>
      ))}
      <button
        className="add-row"
        onClick={() => education.add({ id: newId(), school: '', degree: '', field: '', gpa: '', start: '', end: '' })}
      >
        + Add education
      </button>
    </section>
  );
}
