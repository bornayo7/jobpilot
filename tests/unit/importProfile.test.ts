import { describe, expect, it } from 'vitest';
import { mergeProfileImport, parseProfilePaste } from '@lib/generation/importProfile';
import { buildProfileImportPrompt, PROFILE_JSON_SPEC } from '@lib/prompts/promptStudio/builders';
import { emptyProfile } from '@lib/schema/profile';

const IMPORT_JSON = {
  basics: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '',
    location: { city: 'Austin', state: 'TX', country: '', postal: '' },
  },
  links: { linkedin: 'linkedin.com/in/ada', github: '', portfolio: '', other: [] },
  work: [
    {
      company: 'Orchard',
      title: 'Intern',
      location: '',
      start: 'Jun 2025',
      end: '',
      current: true,
      bullets: [{ text: 'Built CI cache', tags: ['ci'] }],
    },
  ],
  education: [{ school: 'UT Austin', degree: 'B.S.', field: 'CS', gpa: '3.8', start: '2023', end: '2027' }],
  projects: [],
  skills: [{ name: 'TypeScript', category: 'Languages' }],
};

describe('parseProfilePaste', () => {
  it('parses a fenced JSON reply and summarizes it', () => {
    const outcome = parseProfilePaste('Here you go:\n```json\n' + JSON.stringify(IMPORT_JSON) + '\n```');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.summary).toContain('1 positions');
      expect(outcome.imported.basics.firstName).toBe('Ada');
    }
  });

  it('rejects junk with readable errors', () => {
    const outcome = parseProfilePaste('```json\n{"work": "nope"}\n```');
    expect(outcome.ok).toBe(false);
  });

  it('the spec shown to the model is itself importable', () => {
    const outcome = parseProfilePaste('```json\n' + PROFILE_JSON_SPEC + '\n```');
    expect(outcome.ok).toBe(true);
  });

  it('the prompt never asks for eeo, visa, or salary data', () => {
    const prompt = buildProfileImportPrompt();
    expect(prompt).not.toContain('eeo');
    expect(prompt).not.toContain('workAuth');
    expect(prompt).not.toContain('expectedSalary');
  });
});

describe('mergeProfileImport', () => {
  it('replaces lists, assigns fresh ids, and preserves eeo/workAuth/documents', () => {
    const current = emptyProfile();
    current.eeo.veteran = 'I am not a protected veteran';
    current.workAuth.needsSponsorship = true;
    current.documents.defaultResumeId = 'blob-1';
    current.work.push({
      id: 'old',
      company: 'Old Co',
      title: 'x',
      location: '',
      start: '',
      end: '',
      current: false,
      bullets: [],
    });

    const outcome = parseProfilePaste(JSON.stringify(IMPORT_JSON));
    if (!outcome.ok) throw new Error('parse failed');
    const merged = mergeProfileImport(current, outcome.imported);

    expect(merged.work).toHaveLength(1);
    expect(merged.work[0]!.company).toBe('Orchard');
    expect(merged.work[0]!.id).not.toBe('old');
    expect(merged.basics.firstName).toBe('Ada');
    // Never touched by import:
    expect(merged.eeo.veteran).toBe('I am not a protected veteran');
    expect(merged.workAuth.needsSponsorship).toBe(true);
    expect(merged.documents.defaultResumeId).toBe('blob-1');
  });

  it('keeps existing data where the import is empty', () => {
    const current = emptyProfile();
    current.basics.phone = '555';
    current.skills = [{ name: 'Python', category: '' }];
    const outcome = parseProfilePaste(JSON.stringify({ ...IMPORT_JSON, skills: [], basics: { ...IMPORT_JSON.basics, phone: '' } }));
    if (!outcome.ok) throw new Error('parse failed');
    const merged = mergeProfileImport(current, outcome.imported);
    expect(merged.basics.phone).toBe('555');
    expect(merged.skills[0]!.name).toBe('Python');
  });
});
