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

export interface DocumentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  source: 'upload' | 'generated';
  versionId?: string;
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
  profileId?: string;
  profileRevision?: number;
}

export interface AnswerRecord {
  id: string;
  questionRaw: string;
  questionNormalized: string;
  answer: string;
  /** Tracker job id (or '' for manually added general answers). */
  jobId: string;
  company: string;
  /** Cross-job reuse requires both this flag and a confirmed user choice.
   * Missing reuseConfirmed identifies legacy rows needing explicit review. */
  reusable: boolean;
  createdAt: number;
  revision?: number;
  applicationId?: string;
  origin?: 'captured' | 'manual' | 'generated';
  reuseConfirmed?: boolean;
  profileId?: string;
  profileRevision?: number;
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
  revision?: number;
  applicationId?: string;
  attemptId?: string;
  profileId?: string;
  profileRevision?: number;
}

export interface SubmissionAttemptRecord {
  id: string;
  tabId: number;
  documentId: string;
  applicationId: string;
  attemptId: string;
  url: string;
  title: string;
  answers: { label: string; value: string; sensitive?: boolean }[];
  profileId?: string;
  profileRevision?: number;
  resumeName?: string;
  resumeVersionId?: string;
  at: number;
}

export interface GenerationDraftRecord {
  id: string;
  revision: number;
  promptType: 'resume' | 'coverLetter' | 'answer';
  question: string;
  pasted: string;
  updatedAt: number;
}

/** Only coordination.ts reads this. An interrupted cross-store change is
 * completed or rolled back before any normal operation can access storage. */
export interface RecoveryJournal {
  id: 'active';
  phase: 'commit' | 'rollback';
  beforeIdb: Record<string, unknown[]>;
  beforeLocal: Record<string, unknown>;
  afterLocal: Record<string, unknown>;
  localKeys: string[];
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
  trackerJobs: { key: string; value: TrackerJob; indexes: { byStatus: string; byCreatedAt: number; byApplication: string; byAttempt: string } };
  unmatchedLog: { key: string; value: UnmatchedLogEntry };
  documentMeta: { key: string; value: DocumentMeta };
  recoveryJournal: { key: string; value: RecoveryJournal };
  submissionAttempts: { key: string; value: SubmissionAttemptRecord };
  generationDrafts: { key: string; value: GenerationDraftRecord };
}

let dbPromise: Promise<IDBPDatabase<JobpilotDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<JobpilotDB>> {
  dbPromise ??= openDB<JobpilotDB>('jobpilot', 2, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('blobs', { keyPath: 'id' });
        const versions = db.createObjectStore('resumeVersions', { keyPath: 'id' });
        versions.createIndex('byCreatedAt', 'createdAt');
        const answers = db.createObjectStore('answers', { keyPath: 'id' });
        answers.createIndex('byNormalized', 'questionNormalized');
        const tracker = db.createObjectStore('trackerJobs', { keyPath: 'id' });
        tracker.createIndex('byStatus', 'status');
        tracker.createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('unmatchedLog', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('documentMeta', { keyPath: 'id' });
        db.createObjectStore('recoveryJournal', { keyPath: 'id' });
        db.createObjectStore('submissionAttempts', { keyPath: 'id' });
        db.createObjectStore('generationDrafts', { keyPath: 'id' });
        const jobs = tx.objectStore('trackerJobs');
        jobs.createIndex('byApplication', 'applicationId');
        jobs.createIndex('byAttempt', 'attemptId');
        // The one-time upgrade reads bytes to create the metadata store.
        // Subsequent listings never load those bytes.
        void (async () => {
          const versions = await tx.objectStore('resumeVersions').getAll();
          const owners = new Map<string, string>();
          for (const version of versions) {
            for (const id of [version.pdfBlobId, version.docxBlobId]) if (id) owners.set(id, version.id);
          }
          let cursor = await tx.objectStore('blobs').openCursor();
          while (cursor) {
            const { bytes, ...meta } = cursor.value;
            const versionId = owners.get(meta.id);
            await tx.objectStore('documentMeta').put({ ...meta, size: bytes.byteLength,
              source: versionId ? 'generated' : 'upload', ...(versionId ? { versionId } : {}) });
            cursor = await cursor.continue();
          }
        })().catch(() => tx.abort());
      }
    },
    blocking() { void dbPromise?.then((db) => db.close()); dbPromise = null; },
    terminated() { dbPromise = null; },
  }).catch((error) => { dbPromise = null; throw error; });
  return dbPromise;
}
