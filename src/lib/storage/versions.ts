import { getDb } from './db';
import { newId } from '../schema/profile';
import type { ResumeVersion } from '../schema/resumeVersion';

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

export async function saveVersion(record: Omit<VersionRecord, 'id' | 'createdAt'>): Promise<VersionRecord> {
  const full: VersionRecord = { ...record, id: newId(), createdAt: Date.now() };
  const db = await getDb();
  await db.put('resumeVersions', full);
  return full;
}

export async function listVersions(): Promise<VersionRecord[]> {
  const db = await getDb();
  const all = (await db.getAll('resumeVersions')) as VersionRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteVersion(id: string): Promise<void> {
  const db = await getDb();
  const record = (await db.get('resumeVersions', id)) as VersionRecord | undefined;
  await db.delete('resumeVersions', id);
  // Clean orphaned rendered blobs.
  for (const blobId of [record?.pdfBlobId, record?.docxBlobId]) {
    if (blobId) await db.delete('blobs', blobId).catch(() => undefined);
  }
}

export async function storeRenderedBlob(name: string, type: string, bytes: ArrayBuffer): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.put('blobs', { id, name, type, bytes, createdAt: Date.now() });
  return id;
}
