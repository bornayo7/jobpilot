import { describe, expect, it } from 'vitest';
import { computeMatchGap } from '@lib/memory/matchGap';
import { emptyProfile } from '@lib/schema/profile';

describe('computeMatchGap', () => {
  const profile = emptyProfile();
  profile.skills = [
    { name: 'React', category: '' },
    { name: 'TypeScript', category: '' },
    { name: 'Rust', category: '' },
  ];
  profile.work.push({
    id: 'w',
    company: 'Acme',
    title: 'Frontend Intern',
    location: '',
    start: '',
    end: '',
    current: false,
    bullets: [{ text: 'Built dashboards in React with TypeScript', tags: [] }],
  });

  const jd = `We need a Frontend Engineer. Requirements: React, TypeScript, and GraphQL.
    Experience with GraphQL APIs is required. Kubernetes experience with Kubernetes deployments preferred.`;

  it('splits skills into covered and unused', () => {
    const gap = computeMatchGap(jd, profile);
    expect(gap.coveredSkills).toEqual(expect.arrayContaining(['React', 'TypeScript']));
    expect(gap.unusedSkills).toContain('Rust');
  });

  it('surfaces recurring JD terms the profile lacks', () => {
    const gap = computeMatchGap(jd, profile);
    expect(gap.missingTerms.join(' ')).toContain('graphql');
    expect(gap.missingTerms.join(' ')).toContain('kubernetes');
    // Terms the profile HAS are not gaps.
    expect(gap.missingTerms.join(' ')).not.toContain('react');
  });
});
