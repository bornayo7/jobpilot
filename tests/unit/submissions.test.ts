import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { SubmissionTracker } from '@lib/tracker/submissions';
import { listJobs } from '@lib/tracker/store';
import { listAnswers } from '@lib/memory/answers';

let clock = 0;
const tracker = () => new SubmissionTracker(60_000, () => clock);
const attempt = {
  url: 'https://jobs.lever.co/acme/123/apply',
  title: 'Engineer - Job Application',
  answers: [{ label: 'Why Acme?', value: 'Because of the mission and the team.' }],
};
const confirmation = { url: 'https://jobs.lever.co/acme/123/thanks', title: 'Thanks for applying' };

beforeEach(async () => {
  fakeBrowser.reset();
  clock = 1_000_000;
  const db = await getDb();
  for (const store of [...db.objectStoreNames]) await db.clear(store);
});

it('records the application and files the captured answers under it once the confirmation follows', async () => {
  const submissions = tracker();
  submissions.attempted(7, attempt);
  expect(await listJobs()).toEqual([]); // the click alone proves nothing

  await submissions.confirmed(7, confirmation);
  const [job] = await listJobs();
  expect(job).toMatchObject({ company: 'Acme', title: 'Engineer', url: attempt.url, status: 'applied' });
  const [answer] = await listAnswers();
  expect(answer).toMatchObject({ questionRaw: 'Why Acme?', jobId: job!.id, company: 'Acme', reusable: true });
});

it('records a confirmation that had no attempt from the page itself, with no answers', async () => {
  await tracker().confirmed(7, confirmation);
  const [job] = await listJobs();
  expect(job).toMatchObject({ company: 'Acme', title: 'Thanks for applying', url: confirmation.url });
  expect(await listAnswers()).toEqual([]);
});

it('drops an attempt that expired before its confirmation, so a reused tab id cannot leak answers', async () => {
  const submissions = tracker();
  submissions.attempted(7, attempt);
  clock += 61_000;
  await submissions.confirmed(7, confirmation);
  expect((await listJobs())[0]!.url).toBe(confirmation.url);
  expect(await listAnswers()).toEqual([]);
});

it('forgets an attempt when its tab closes', async () => {
  const submissions = tracker();
  submissions.attempted(7, attempt);
  submissions.forget(7);
  await submissions.confirmed(7, confirmation);
  expect(await listAnswers()).toEqual([]);
});

it('spends each attempt on one confirmation only', async () => {
  const submissions = tracker();
  submissions.attempted(7, attempt);
  await submissions.confirmed(7, confirmation);
  await submissions.confirmed(7, { ...confirmation, title: 'A different role' });
  expect(await listJobs()).toHaveLength(2);
  expect(await listAnswers()).toHaveLength(1);
});
