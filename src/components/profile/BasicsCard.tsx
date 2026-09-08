import type { Profile } from '@lib/schema/profile';
import { Text, type CardProps } from './fields';

export function BasicsCard({ profile, update }: CardProps) {
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
