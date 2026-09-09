import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { saveAnswer, patchAnswer, listAnswers } from '@lib/memory/answers';
import { createJob, patchJob, listJobs } from '@lib/tracker/store';
import { applicationId } from '@lib/tracker/applicationId';

beforeEach(async () => {
  fakeBrowser.reset(); const db = await getDb();
  for (const store of [...db.objectStoreNames]) await db.clear(store);
});

it('merges distinct answer edits but rejects concurrent edits to the same text', async () => {
  const base = await saveAnswer({ questionRaw: 'Why?', answer: 'Original', reusable: false, jobId: '', company: '' });
  await patchAnswer(base.id, { reusable: true }, base);
  await patchAnswer(base.id, { answer: 'First editor' }, base);
  await expect(patchAnswer(base.id, { answer: 'Second editor' }, base)).rejects.toThrow('another editor');
  await patchAnswer(base.id, { answer: 'First editor' }, base);
  expect((await listAnswers())[0]).toMatchObject({ answer: 'First editor', reusable: true, reuseConfirmed: true });
});
it('merges notes and status but rejects a stale notes overwrite', async () => {
  const base = await createJob({ company: 'Acme', title: 'Engineer', url: 'https://careers.example.com/job?id=1' });
  if (!base) throw Error('new job expected');
  await patchJob(base.id, { status: 'interviewing' }, base);
  await patchJob(base.id, { notes: 'First editor' }, base);
  await expect(patchJob(base.id, { notes: 'Second editor' }, base)).rejects.toThrow('another editor');
  expect((await listJobs())[0]).toMatchObject({ status: 'interviewing', notes: 'First editor' });
});
it('preserves unknown requisition query identifiers while removing attribution noise', () => {
  expect(applicationId('https://careers.example.com/job?id=1&utm_source=mail')).toBe(applicationId('https://careers.example.com/job?id=1'));
  expect(applicationId('https://careers.example.com/job?id=1')).not.toBe(applicationId('https://careers.example.com/job?id=2'));
});
