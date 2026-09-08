import type { Profile } from '@lib/schema/profile';
import { Text, type CardProps } from './fields';

export function EeoCard({ profile, update }: CardProps) {
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
