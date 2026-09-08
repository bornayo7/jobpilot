import type { CardProps } from './fields';

export function SkillsCard({ profile, update }: CardProps) {
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
          onBlur={(e) => update({ skills: parseSkills(e.target.value) })}
        />
      </label>
    </section>
  );
}

/** "React [frontend], Python" -> [{ name: 'React', category: 'frontend' }, { name: 'Python', category: '' }] */
function parseSkills(text: string) {
  return text
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(.*?)\s*\[(.+)\]$/);
      return match ? { name: match[1]!.trim(), category: match[2]!.trim() } : { name: raw, category: '' };
    });
}
