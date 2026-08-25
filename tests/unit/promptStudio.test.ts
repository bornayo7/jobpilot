import { describe, expect, it } from 'vitest';
import {
  buildAnswerPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
} from '@lib/prompts/promptStudio/builders';
import { RESUME_JSON_SPEC, ResumeVersionSchema } from '@lib/schema/resumeVersion';
import { emptyProfile } from '@lib/schema/profile';

const JOB = {
  title: 'Frontend Engineer',
  url: 'https://jobs.lever.co/acme/123/apply',
  text: 'Acme is hiring a Frontend Engineer. Must have: React, TypeScript, testing.',
};
const STYLE = { tone: 'plain and direct', notes: '' };

function profileFixture() {
  const profile = emptyProfile();
  profile.basics.firstName = 'Ada';
  profile.basics.email = 'ada@example.com';
  profile.eeo.veteran = 'I am not a protected veteran';
  profile.eeo.race = 'Prefer not to say';
  return profile;
}

describe('prompt builders', () => {
  const profile = profileFixture();

  it('resume prompt carries the JD, the profile, the style guide, and the output schema', () => {
    const prompt = buildResumePrompt(profile, JOB, STYLE);
    expect(prompt).toContain('Acme is hiring a Frontend Engineer');
    expect(prompt).toContain('"firstName": "Ada"');
    expect(prompt).toContain('WRITING STYLE REQUIREMENTS');
    expect(prompt).toContain('"experience": [');
    expect(prompt).toContain('SINGLE fenced json code block');
    expect(prompt).toContain('inventing facts is forbidden');
  });

  it('NEVER leaks EEO/demographic data into any prompt', () => {
    for (const prompt of [
      buildResumePrompt(profile, JOB, STYLE),
      buildCoverLetterPrompt(profile, JOB, STYLE),
      buildAnswerPrompt(profile, JOB, STYLE, 'Why Acme?'),
    ]) {
      expect(prompt).not.toContain('protected veteran');
      expect(prompt).not.toContain('Prefer not to say');
      expect(prompt).not.toContain('"eeo"');
    }
  });

  it('answer prompt includes the question and length guidance', () => {
    const prompt = buildAnswerPrompt(profile, JOB, STYLE, 'Why do you want to work at Acme?');
    expect(prompt).toContain('Why do you want to work at Acme?');
    expect(prompt).toContain('60 to 150 words');
  });

  it('the JSON spec shown to the model is itself valid against the importer schema', () => {
    const parsed = JSON.parse(RESUME_JSON_SPEC);
    const result = ResumeVersionSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
