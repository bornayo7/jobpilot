import type { Profile } from '@lib/schema/profile';
import { Text, type CardProps } from './fields';

export function PreferencesCard({ profile, update }: CardProps) {
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
