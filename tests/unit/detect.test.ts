import { describe, expect, it } from 'vitest';
import { detectAts } from '@lib/fill/adapters/detect';

describe('detectAts', () => {
  it.each([
    ['job-boards.greenhouse.io', '/acme/jobs/123', 'greenhouse'],
    ['boards.greenhouse.io', '/acme/jobs/123', 'greenhouse'],
    ['jobs.lever.co', '/acme/uuid/apply', 'lever'],
    ['jobs.eu.lever.co', '/acme/uuid', 'lever'],
    ['jobs.ashbyhq.com', '/acme/uuid/application', 'ashby'],
    ['acme.wd5.myworkdayjobs.com', '/en-US/careers', 'workday'],
    ['acme.wd1.myworkdaysite.com', '/careers', 'workday'],
    ['careers-acme.icims.com', '/jobs/123/login', 'icims'],
    ['jobs.smartrecruiters.com', '/Acme/123-role', 'smartrecruiters'],
    ['smartapply.indeed.com', '/beta/indeedapply/form/contact-info', 'indeed'],
    ['www.linkedin.com', '/jobs/view/123', 'linkedin'],
  ])('%s%s -> %s', (host, path, expected) => {
    expect(detectAts(host, path)).toBe(expected);
  });

  it('returns null for unrelated sites and non-jobs linkedin pages', () => {
    expect(detectAts('example.com', '/careers')).toBeNull();
    expect(detectAts('www.linkedin.com', '/feed')).toBeNull();
    expect(detectAts('www.indeed.com', '/viewjob')).toBeNull();
  });
});
