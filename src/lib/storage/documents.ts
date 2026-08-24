import { getDb } from './db';
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
  const bytes = await file.arrayBuffer();
  const doc = {
    id: newId(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    bytes,
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.put('blobs', doc);
  return { id: doc.id, name: doc.name, type: doc.type, size: bytes.byteLength, createdAt: doc.createdAt };
}

export async function listDocuments(): Promise<StoredDocMeta[]> {
  const db = await getDb();
  const all = await db.getAll('blobs');
  return all
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type,
      size: doc.bytes.byteLength,
      createdAt: doc.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('blobs', id);
}

/** Load a stored document as the transferable shape the executor consumes. */
export async function loadDocumentAsFile(id: string): Promise<SerializedFile | null> {
  const db = await getDb();
  const doc = await db.get('blobs', id);
  if (!doc) return null;
  return { name: doc.name, type: doc.type, dataBase64: arrayBufferToBase64(doc.bytes) };
}
