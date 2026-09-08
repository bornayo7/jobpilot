import type { Profile } from '@lib/schema/profile';
import type { CardProps } from './fields';

export function WorkAuthCard({ profile, update }: CardProps) {
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
