import type { Profile, TaggedBullet } from '@lib/schema/profile';
import { CommaListInput } from '@components/CommaListInput';

/** Every profile-editor card edits the draft profile through one patch callback. */
export type ProfilePatch = Partial<Profile> | ((current: Profile) => Partial<Profile>);
export type CardProps = { profile: Profile; update: (patch: ProfilePatch) => void };

/**
 * Add/patch/remove for a list the profile holds, each committing the whole
 * list back through `commit`. The work, education, project and bullet lists
 * all edit the same way; this keeps that in one place.
 */
export function listActions<T>(items: T[], commit: (next: T[]) => void) {
  return {
    add: (item: T) => commit([...items, item]),
    patch: (index: number, patch: Partial<T>) =>
      commit(items.map((item, i) => (i === index ? { ...item, ...patch } : item))),
    remove: (index: number) => commit(items.filter((_, i) => i !== index)),
  };
}

export function Text({
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

export function EntryHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="entry-header">
      <span className="title">{title}</span>
      <button className="entry-remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

export function BulletsEditor({
  bullets,
  onChange,
}: {
  bullets: TaggedBullet[];
  onChange: (bullets: TaggedBullet[]) => void;
}) {
  const list = listActions(bullets, onChange);
  return (
    <div style={{ marginTop: 10 }}>
      {bullets.map((bullet, i) => (
        <div className="grid-2" key={i} style={{ marginBottom: 6, gridTemplateColumns: '2fr 1fr auto' }}>
          <label className="field">
            Bullet
            <textarea rows={2} value={bullet.text} onChange={(e) => list.patch(i, { text: e.target.value })} />
          </label>
          <label className="field">
            Tags
            <CommaListInput value={bullet.tags} placeholder="react, testing" onChange={(tags) => list.patch(i, { tags })} />
          </label>
          <button className="entry-remove" aria-label={`Remove bullet ${i + 1}`} onClick={() => list.remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button onClick={() => list.add({ text: '', tags: [] })}>+ Add bullet</button>
    </div>
  );
}
