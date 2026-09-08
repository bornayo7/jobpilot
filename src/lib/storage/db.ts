import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ResumeVersion } from '../schema/resumeVersion';

/**
 * IndexedDB stores for everything too large or too independent for
 * chrome.storage.local: document blobs, generated resume versions, the answers
 * bank, tracker jobs, and the local unmatched-field log that drives selector-map
 * repairs. The versioned profile itself stays in chrome.storage.local.
 *
 * Each stored shape is declared exactly once, here. The modules that read and
 * write a store import their record type from this file rather than restating
 * it and casting the rows back.
 */

/** An uploaded document or a rendered PDF/DOCX twin of a generated version. */
export interface StoredBlob {
  id: string;
  name: string;
  type: string;
  bytes: ArrayBuffer;
  createdAt: number;
}

export interface VersionRecord {
  id: string;
  kind: 'resume' | 'coverLetter';
  label: string;
  company: string;
  jobUrl?: string;
  /** Immutable once stored: ResumeVersion JSON, or { text } for cover letters. */
  data: ResumeVersion | { text: string };
  pdfBlobId?: string;
  docxBlobId?: string;
  createdAt: number;
}

export interface AnswerRecord {
  id: string;
  questionRaw: string;
  questionNormalized: string;
  answer: string;
  /** Tracker job id (or '' for manually added general answers). */
  jobId: string;
  company: string;
  /** Cross-job reuse gate. Hand-typed/captured answers default true;
   *  AI-generated ones must be flipped deliberately. */
  reusable: boolean;
  createdAt: number;
}

export const JOB_STATUSES = ['applied', 'interviewing', 'offer', 'rejected', 'saved'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

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

/** A field no resolver tier could classify, kept so adapter gaps can be found later. */
export interface UnmatchedLogEntry {
  /** The field signature — one row per unique field shape. */
  id: string;
  atsId: string | null;
  url: string;
  label: string;
  control: string;
  signature: string;
  seenAt: number;
}

export interface JobpilotDB extends DBSchema {
  blobs: { key: string; value: StoredBlob };
  resumeVersions: { key: string; value: VersionRecord; indexes: { byCreatedAt: number } };
  answers: { key: string; value: AnswerRecord; indexes: { byNormalized: string } };
  trackerJobs: { key: string; value: TrackerJob; indexes: { byStatus: string; byCreatedAt: number } };
  unmatchedLog: { key: string; value: UnmatchedLogEntry };
}

let dbPromise: Promise<IDBPDatabase<JobpilotDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<JobpilotDB>> {
  dbPromise ??= openDB<JobpilotDB>('jobpilot', 1, {
    upgrade(db) {
      db.createObjectStore('blobs', { keyPath: 'id' });
      const versions = db.createObjectStore('resumeVersions', { keyPath: 'id' });
      versions.createIndex('byCreatedAt', 'createdAt');
      const answers = db.createObjectStore('answers', { keyPath: 'id' });
      answers.createIndex('byNormalized', 'questionNormalized');
      const tracker = db.createObjectStore('trackerJobs', { keyPath: 'id' });
      tracker.createIndex('byStatus', 'status');
      tracker.createIndex('byCreatedAt', 'createdAt');
      db.createObjectStore('unmatchedLog', { keyPath: 'id' });
    },
  });
  return dbPromise;
}
