import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * IndexedDB stores for everything too large or too independent for
 * chrome.storage.local: document blobs, generated resume versions, the answers
 * bank, tracker jobs, and the local unmatched-field log that drives selector-map
 * repairs. The versioned profile itself stays in chrome.storage.local.
 */
export interface JobpilotDB extends DBSchema {
  blobs: {
    key: string;
    value: { id: string; name: string; type: string; bytes: ArrayBuffer; createdAt: number };
  };
  resumeVersions: {
    key: string;
    value: {
      id: string;
      label: string;
      jobUrl?: string;
      company?: string;
      /** ResumeVersion JSON (schema lands in M2). Immutable once stored. */
      data: unknown;
      pdfBlobId?: string;
      docxBlobId?: string;
      createdAt: number;
    };
    indexes: { byCreatedAt: number };
  };
  answers: {
    key: string;
    value: {
      id: string;
      questionRaw: string;
      questionNormalized: string;
      answer: string;
      jobId: string;
      company: string;
      /** Generated answers default to false — reuse requires an explicit flip. */
      reusable: boolean;
      createdAt: number;
    };
    indexes: { byNormalized: string };
  };
  trackerJobs: {
    key: string;
    value: {
      id: string;
      company: string;
      title: string;
      url: string;
      status: 'applied' | 'interviewing' | 'offer' | 'rejected' | 'saved';
      resumeVersionId?: string;
      notes: string;
      appliedAt?: number;
      followUpAt?: number;
      createdAt: number;
    };
    indexes: { byStatus: string; byCreatedAt: number };
  };
  unmatchedLog: {
    key: string;
    value: {
      id: string;
      atsId: string | null;
      url: string;
      label: string;
      control: string;
      signature: string;
      seenAt: number;
    };
  };
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
