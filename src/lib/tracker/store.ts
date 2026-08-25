import { getDb } from '../storage/db';
import { newId } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';

export type JobStatus = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'saved';

export interface TrackerJob {
  id: string;
  company: string;
  title: string;
  url: string;
  status: JobStatus;
  resumeVersionId?: string;
  /** Display name of the resume attached at submit time. */
  resumeName?: string;
  notes: string;
  appliedAt?: number;
  followUpAt?: number;
  createdAt: number;
}

const DEFAULT_FOLLOW_UP_DAYS = 7;

export async function createJob(
  input: Pick<TrackerJob, 'company' | 'title' | 'url'> & Partial<TrackerJob>,
): Promise<TrackerJob | null> {
  const db = await getDb();
  // Dedupe: same company+title inside 24h is one application.
  const all = (await db.getAll('trackerJobs')) as TrackerJob[];
  const key = normalizeForSignature(`${input.company} ${input.title}`);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (all.some((job) => normalizeForSignature(`${job.company} ${job.title}`) === key && job.createdAt > dayAgo)) {
    return null;
  }

  const now = Date.now();
  const job: TrackerJob = {
    status: 'applied',
    notes: '',
    appliedAt: now,
    followUpAt: now + DEFAULT_FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000,
    ...input,
    id: newId(),
    createdAt: now,
  };
  await db.put('trackerJobs', job);
  return job;
}

export async function listJobs(): Promise<TrackerJob[]> {
  const db = await getDb();
  const all = (await db.getAll('trackerJobs')) as TrackerJob[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateJob(job: TrackerJob): Promise<void> {
  const db = await getDb();
  await db.put('trackerJobs', job);
}

export async function deleteJob(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('trackerJobs', id);
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
