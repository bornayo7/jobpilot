import { describe, expect, it } from 'vitest';
import { extractJsonBlock, importResumePaste } from '@lib/generation/importResult';
import { emptyProfile } from '@lib/schema/profile';

const VALID_VERSION = {
  meta: { label: 'Acme SWE', company: 'Acme', role: 'Software Engineer' },
  basics: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '', location: 'Austin, TX', links: [] },
  experience: [
    {
      company: 'Orchard',
      title: 'Intern',
      location: '',
      dates: 'Jun 2025 - Aug 2025',
      bullets: ['Built a CI cache that cut build times from 12 to 4 minutes', 'Wrote the deploy runbook'],
    },
  ],
  projects: [],
  education: [{ school: 'UT Austin', degree: 'B.S. CS', dates: '2023 - 2027', details: '' }],
  skills: [{ category: 'Languages', items: ['TypeScript'] }],
};

function profileWithBullet(text: string) {
  const profile = emptyProfile();
  profile.work.push({
    id: 'w1',
    company: 'Orchard',
    title: 'Intern',
    location: '',
    start: '',
    end: '',
    current: false,
    bullets: [{ text, tags: [] }],
  });
  return profile;
}

describe('extractJsonBlock', () => {
  it('prefers a fenced json block', () => {
    const text = `Here you go!\n\`\`\`json\n{"a": 1}\n\`\`\`\nGood luck!`;
    expect(extractJsonBlock(text)).toBe('{"a": 1}');
  });

  it('falls back to the first balanced object, respecting strings with braces', () => {
    const text = `preamble {"a": "brace } inside", "b": {"c": 2}} trailing`;
    expect(JSON.parse(extractJsonBlock(text)!)).toEqual({ a: 'brace } inside', b: { c: 2 } });
  });

  it('returns null when there is no object', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
  });
});

describe('importResumePaste', () => {
  it('accepts a chatty paste wrapping a valid fenced block', () => {
    const paste = `Sure — here is the tailored resume:\n\`\`\`json\n${JSON.stringify(VALID_VERSION)}\n\`\`\`\nLet me know if you want changes.`;
    const outcome = importResumePaste(paste, emptyProfile());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.version.basics.name).toBe('Ada Lovelace');
  });

  it('rejects malformed JSON with a readable error, never half-stores', () => {
    const outcome = importResumePaste('```json\n{"basics": }\n```', emptyProfile());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]).toMatch(/does not parse/i);
  });

  it('rejects schema violations with field paths', () => {
    const bad = { ...VALID_VERSION, basics: { email: 'x' } }; // name missing
    const outcome = importResumePaste(JSON.stringify(bad), emptyProfile());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(' ')).toContain('basics.name');
  });

  it('classifies bullets as kept vs rewritten against the master profile', () => {
    const profile = profileWithBullet('Built a CI cache that cut build times from 12 to 4 minutes');
    const outcome = importResumePaste(JSON.stringify(VALID_VERSION), profile);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.diff.keptCount).toBe(1);
      expect(outcome.diff.rewrittenCount).toBe(1);
      expect(outcome.diff.known.get('Wrote the deploy runbook')).toBe(false);
    }
  });
});
