import { getDb, type StoredBlob } from './db';
import { newId } from '../schema/profile';
import type { SerializedFile } from '../messaging/protocol';
import { arrayBufferToBase64 } from '../util/base64';

export interface StoredDocMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export async function storeDocument(file: File): Promise<StoredDocMeta> {
  const doc: StoredBlob = {
    id: newId(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    bytes: await file.arrayBuffer(),
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.put('blobs', doc);
  return metaOf(doc);
}

export async function listDocuments(): Promise<StoredDocMeta[]> {
  const db = await getDb();
  const all = await db.getAll('blobs');
  return all.map(metaOf).sort((a, b) => b.createdAt - a.createdAt);
}

/** One stored document with its bytes, or null when the id is dangling. */
export async function getDocument(id: string): Promise<StoredBlob | null> {
  const db = await getDb();
  return (await db.get('blobs', id)) ?? null;
}

export async function getDocumentMeta(id: string): Promise<StoredDocMeta | null> {
  const doc = await getDocument(id);
  return doc ? metaOf(doc) : null;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('blobs', id);
}

/** Load a stored document as the transferable shape the executor consumes. */
export async function loadDocumentAsFile(id: string): Promise<SerializedFile | null> {
  const doc = await getDocument(id);
  if (!doc) return null;
  return { name: doc.name, type: doc.type, dataBase64: arrayBufferToBase64(doc.bytes) };
}

function metaOf(doc: StoredBlob): StoredDocMeta {
  return { id: doc.id, name: doc.name, type: doc.type, size: doc.bytes.byteLength, createdAt: doc.createdAt };
}
