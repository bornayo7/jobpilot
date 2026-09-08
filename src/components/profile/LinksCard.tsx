import type { Profile } from '@lib/schema/profile';
import { Text, type CardProps } from './fields';

export function LinksCard({ profile, update }: CardProps) {
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
