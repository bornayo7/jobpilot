import type { TrackerJob } from '../storage/db';
import { withStorageRead, withStorageWrite } from '../storage/coordination';
import { applicationId } from './applicationId';
import { newId } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';
import { retainRevisionFloor } from '../storage/revisions';
import { completeTransaction } from '../storage/transaction';

export type { JobStatus, TrackerJob } from '../storage/db';

const DEFAULT_FOLLOW_UP_DAYS = 7;

export async function createJob(
  input: Pick<TrackerJob, 'company' | 'title' | 'url'> & Partial<TrackerJob>,
): Promise<TrackerJob | null> {
  return withStorageWrite(async (db) => {
    const identity = input.applicationId ?? applicationId(input.url) ?? undefined;
    const tx = db.transaction('trackerJobs', 'readwrite');
    return completeTransaction(tx, async () => {
      const all = await tx.store.getAll();
      if (identity && all.some((job) => (job.applicationId ?? applicationId(job.url)) === identity)) return null;
      const now = Date.now();
      const job: TrackerJob = {
        status: 'applied', notes: '', appliedAt: now,
        followUpAt: now + DEFAULT_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000,
        ...input, id: newId(), createdAt: now, revision: 1, applicationId: identity,
      };
      await tx.store.put(job);
      return job;
    });
  });
}

export async function listJobs(): Promise<TrackerJob[]> {
  return withStorageRead(async (db) => (await db.getAll('trackerJobs')).sort((a, b) => b.createdAt - a.createdAt));
}

export async function updateJob(job: TrackerJob): Promise<void> {
  await patchJob(job.id, job, job.revision ?? 0);
}

type JobEdits = Partial<Pick<TrackerJob, 'company' | 'title' | 'url' | 'status' | 'notes' | 'followUpAt'>>;

export function patchJob(id: string, patch: JobEdits, base?: number | JobEdits): Promise<TrackerJob> {
  return withStorageWrite(async (db) => {
    const tx = db.transaction('trackerJobs', 'readwrite');
    return completeTransaction(tx, async () => {
      const current = await tx.store.get(id);
      if (!current) throw new Error('This application was removed. Reload the tracker.');
      const changed = typeof base === 'number' ? base !== (current.revision ?? 0) : base !== undefined &&
        (Object.keys(patch) as (keyof JobEdits)[]).some((key) => current[key] !== base[key] && current[key] !== patch[key]);
      if (changed) throw new Error('This application changed in another editor. Reload before saving.');
      const next = { ...current, ...patch, id: current.id, revision: (current.revision ?? 0) + 1 };
      await tx.store.put(next); return next;
    });
  });
}

export async function deleteJob(id: string): Promise<void> {
  await withStorageWrite(async (db) => {
    const current = await db.get('trackerJobs', id);
    if (!current) return;
    await retainRevisionFloor(current.revision ?? 0);
    await db.delete('trackerJobs', id);
  });
}

/** Pure helpers (unit-tested). */

export function findPreviousApplications(jobs: TrackerJob[], company: string): TrackerJob[] {
  if (!company) return [];
  const key = normalizeForSignature(company);
  return jobs.filter((job) => normalizeForSignature(job.company) === key);
}

export function dueFollowUps(jobs: TrackerJob[], now = Date.now()): TrackerJob[] {
  return jobs
    .filter((job) => job.status === 'applied' && job.followUpAt !== undefined && job.followUpAt <= now)
    .sort((a, b) => (a.followUpAt ?? 0) - (b.followUpAt ?? 0));
}
