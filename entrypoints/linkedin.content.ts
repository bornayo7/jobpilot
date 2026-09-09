import { startContentRuntime } from '@lib/content/runtime';

// Origin fallback requires /* paths. LinkedIn access stays restricted to jobs.
export default defineContentScript({
  matches: ['https://www.linkedin.com/jobs/*'],
  allFrames: true,
  runAt: 'document_idle',
  main: startContentRuntime,
});
