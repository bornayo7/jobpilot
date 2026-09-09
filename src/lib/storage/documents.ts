import type { StoredBlob, DocumentMeta } from './db';
import { newId } from '../schema/profile';
import type { SerializedFile } from '../messaging/protocol';
import { arrayBufferToBase64 } from '../util/base64';
import { withStorageRead, withStorageWrite } from './coordination';
import { GeneratedDocumentError, removeArtifacts, type RemovalOptions } from './documentRemoval';
export { DocumentInUseError, GeneratedDocumentError } from './documentRemoval';
export type StoredDocMeta = DocumentMeta;

export async function storeDocument(file: File): Promise<StoredDocMeta> {
  const doc: StoredBlob = { id: newId(), name: file.name, type: file.type || 'application/octet-stream',
    bytes: await file.arrayBuffer(), createdAt: Date.now() };
  const meta: DocumentMeta = { id: doc.id, name: doc.name, type: doc.type, size: doc.bytes.byteLength,
    createdAt: doc.createdAt, source: 'upload' };
  return withStorageWrite(async (db) => {
    const tx = db.transaction(['blobs', 'documentMeta'], 'readwrite');
    void tx.done.catch(() => undefined);
    try {
      await tx.objectStore('blobs').put(doc);
      await tx.objectStore('documentMeta').put(meta);
      await tx.done;
      return meta;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  });
}
export function listDocuments(): Promise<StoredDocMeta[]> {
  return withStorageRead(async (db) => (await db.getAll('documentMeta')).sort((a, b) => b.createdAt - a.createdAt));
}
export function getDocument(id: string): Promise<StoredBlob | null> {
  return withStorageRead(async (db) => (await db.get('blobs', id)) ?? null);
}
export function getDocumentMeta(id: string): Promise<StoredDocMeta | null> {
  return withStorageRead(async (db) => (await db.get('documentMeta', id)) ?? null);
}
export function deleteDocument(id: string, options: RemovalOptions = {}): Promise<void> {
  return withStorageWrite(async (db) => {
    const owner = (await db.getAll('resumeVersions')).find((row) => row.pdfBlobId === id || row.docxBlobId === id);
    if (owner) throw new GeneratedDocumentError(owner.id);
    await removeArtifacts(db, [id], undefined, options);
  });
}
export async function loadDocumentAsFile(id: string): Promise<SerializedFile | null> {
  const doc = await getDocument(id);
  return doc ? { name: doc.name, type: doc.type, dataBase64: arrayBufferToBase64(doc.bytes) } : null;
}
