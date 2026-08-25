import { describe, expect, it } from 'vitest';
import {
  cleanJobTitle,
  companyFromUrl,
  looksLikeConfirmation,
  looksLikeSubmitButton,
} from '@lib/tracker/detect';
import { dueFollowUps, findPreviousApplications, type TrackerJob } from '@lib/tracker/store';

describe('companyFromUrl', () => {
  it.each([
    ['https://jobs.lever.co/acme-corp/uuid/apply', 'Acme Corp'],
    ['https://jobs.ashbyhq.com/wander/123', 'Wander'],
    ['https://job-boards.greenhouse.io/discord/jobs/8599937002', 'Discord'],
    ['https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=1', 'Stripe'],
    ['https://acme.wd5.myworkdayjobs.com/en-US/External/job/x', 'Acme'],
    ['https://careers-nvidia.icims.com/jobs/123/apply', 'Nvidia'],
  ])('%s -> %s', (url, company) => {
    expect(companyFromUrl(url).company).toBe(company);
  });

  it('falls back to the host for unknown sites', () => {
    expect(companyFromUrl('https://www.example.com/careers/apply').company).toBe('example.com');
  });
});

describe('cleanJobTitle', () => {
  it('strips ATS boilerplate suffixes', () => {
    expect(cleanJobTitle('Software Engineer - Job Application')).toBe('Software Engineer');
    expect(cleanJobTitle('Frontend Engineer | Greenhouse')).toBe('Frontend Engineer');
    expect(cleanJobTitle('Apply for Backend Engineer')).toBe('Backend Engineer');
  });
});

describe('confirmation + submit detection', () => {
  it('recognizes confirmation pages by text or url', () => {
    expect(looksLikeConfirmation('https://jobs.lever.co/acme/uuid/thanks', '')).toBe(true);
    expect(looksLikeConfirmation('https://x.com', 'Thank you for applying to Acme! We will be in touch.')).toBe(true);
    expect(looksLikeConfirmation('https://x.com', 'Your application has been submitted.')).toBe(true);
    expect(looksLikeConfirmation('https://x.com', 'Please fill out the form below to apply.')).toBe(false);
  });

  it('recognizes submit buttons without matching navigation buttons', () => {
    expect(looksLikeSubmitButton('Submit application')).toBe(true);
    expect(looksLikeSubmitButton('Apply now')).toBe(true);
    expect(looksLikeSubmitButton('Next')).toBe(false);
    expect(looksLikeSubmitButton('Save and continue')).toBe(false);
  });
});

describe('tracker pure helpers', () => {
  const job = (partial: Partial<TrackerJob>): TrackerJob => ({
    id: 'j',
    company: 'Acme',
    title: 'SWE',
    url: 'https://x',
    status: 'applied',
    notes: '',
    createdAt: 0,
    ...partial,
  });

  it('finds previous applications case-insensitively', () => {
    const jobs = [job({ id: 'a', company: 'Acme Corp' }), job({ id: 'b', company: 'Other' })];
    expect(findPreviousApplications(jobs, 'acme corp').map((j) => j.id)).toEqual(['a']);
    expect(findPreviousApplications(jobs, '')).toEqual([]);
  });

  it('dueFollowUps returns only applied jobs past their follow-up date', () => {
    const now = 1_000_000;
    const jobs = [
      job({ id: 'due', followUpAt: now - 1 }),
      job({ id: 'future', followUpAt: now + 1 }),
      job({ id: 'moved-on', followUpAt: now - 1, status: 'interviewing' }),
    ];
    expect(dueFollowUps(jobs, now).map((j) => j.id)).toEqual(['due']);
  });
});
