import type { VersionRecord } from './db';
import { newId } from '../schema/profile';
import { withStorageRead, withStorageWrite } from './coordination';
import { removeArtifacts, type RemovalOptions } from './documentRemoval';
export type { VersionRecord } from './db';
export { DocumentInUseError } from './documentRemoval';

export interface PreparedVersion {
  record: Omit<VersionRecord, 'id' | 'createdAt' | 'pdfBlobId' | 'docxBlobId'>;
  artifacts: { format: 'pdf' | 'docx'; name: string; type: string; bytes: ArrayBuffer }[];
}

/** All expensive preparation happens before the writer lock/IDB transaction. */
export function commitVersion(prepared: PreparedVersion): Promise<VersionRecord> {
  const formats = prepared.artifacts.map((item) => item.format);
  if (!formats.includes('pdf') || new Set(formats).size !== formats.length ||
    (prepared.record.kind === 'resume' && !formats.includes('docx'))) throw new Error('The prepared version is missing required formats.');
  return withStorageWrite(async (db) => {
    const record: VersionRecord = { ...prepared.record, id: newId(), createdAt: Date.now() };
    const tx = db.transaction(['blobs', 'documentMeta', 'resumeVersions'], 'readwrite');
    void tx.done.catch(() => undefined);
    try {
      for (const artifact of prepared.artifacts) {
        const id = newId();
        await tx.objectStore('blobs').put({ id, name: artifact.name, type: artifact.type, bytes: artifact.bytes, createdAt: record.createdAt });
        await tx.objectStore('documentMeta').put({ id, name: artifact.name, type: artifact.type, size: artifact.bytes.byteLength,
          createdAt: record.createdAt, source: 'generated', versionId: record.id });
        if (artifact.format === 'pdf') record.pdfBlobId = id;
        else record.docxBlobId = id;
      }
      await tx.objectStore('resumeVersions').put(record);
      await tx.done;
      return record;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  });
}
export function listVersions(): Promise<VersionRecord[]> {
  return withStorageRead(async (db) => (await db.getAll('resumeVersions')).sort((a, b) => b.createdAt - a.createdAt));
}
export function deleteVersion(id: string, options: RemovalOptions = {}): Promise<void> {
  return withStorageWrite(async (db) => {
    const record = await db.get('resumeVersions', id);
    if (!record) return;
    const ids = [record.pdfBlobId, record.docxBlobId].filter((id): id is string => !!id);
    await removeArtifacts(db, ids, id, options);
  });
}
