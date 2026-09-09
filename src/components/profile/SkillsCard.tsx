import type { CardProps } from './fields';
import { useEffect, useState } from 'react';

export function SkillsCard({ profile, update }: CardProps) {
  const skillsText = profile.skills.map((s) => (s.category ? `${s.name} [${s.category}]` : s.name)).join(', ');
  const [text, setText] = useState(skillsText);
  useEffect(() => {
    if (JSON.stringify(parseSkills(text)) !== JSON.stringify(profile.skills)) setText(skillsText);
  }, [skillsText, profile.skills, text]);
  return (
    <section className="card">
      <h2>Skills</h2>
      <p className="hint">Comma-separated. Optional category in brackets: React [frontend], Python [ML].</p>
      <label className="field">
        Skills
        <textarea
          rows={3}
          value={text}
          onChange={(e) => { setText(e.target.value); update({ skills: parseSkills(e.target.value) }); }}
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
