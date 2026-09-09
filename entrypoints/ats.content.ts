import { startContentRuntime } from '@lib/content/runtime';

export default defineContentScript({
  matches: [
    'https://*.greenhouse.io/*',
    'https://jobs.lever.co/*',
    'https://jobs.eu.lever.co/*',
    'https://jobs.ashbyhq.com/*',
    'https://*.myworkdayjobs.com/*',
    'https://*.myworkdaysite.com/*',
    'https://*.icims.com/*',
    'https://jobs.smartrecruiters.com/*',
    'https://careers.smartrecruiters.com/*',
    'https://smartapply.indeed.com/*',
  ],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',
  main: startContentRuntime,
});
