import { browser } from '#imports';
import { getDb } from '../storage/db';
import { arrayBufferToBase64, base64ToUint8Array } from './base64';

/**
 * Gather/restore everything JobPilot stores. Restore is replace-all — the
 * options page confirms with the user before calling it.
 */
const LOCAL_KEYS = ['jobpilot:profiles', 'jobpilot:settings', 'jobpilot:mappingCache'] as const;
const IDB_STORES = ['blobs', 'resumeVersions', 'answers', 'trackerJobs', 'unmatchedLog'] as const;

export interface BackupPayload {
  exportedAt: number;
  local: Record<string, unknown>;
  idb: Record<string, unknown[]>;
}

export async function gatherBackupPayload(): Promise<BackupPayload> {
  const local = await browser.storage.local.get([...LOCAL_KEYS]);
  const db = await getDb();
  const idb: Record<string, unknown[]> = {};
  for (const store of IDB_STORES) {
    const rows = await db.getAll(store);
    idb[store] =
      store === 'blobs'
        ? rows.map((row: any) => ({ ...row, bytes: arrayBufferToBase64(row.bytes), __b64: true }))
        : rows;
  }
  return { exportedAt: Date.now(), local, idb };
}

export async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  if (!payload || typeof payload !== 'object' || !payload.idb || !payload.local) {
    throw new Error('Backup payload is malformed');
  }
  await browser.storage.local.set(payload.local);

  const db = await getDb();
  for (const store of IDB_STORES) {
    const rows = payload.idb[store] ?? [];
    const tx = db.transaction(store, 'readwrite');
    await tx.store.clear();
    for (const raw of rows) {
      const row: any = raw;
      const restored =
        store === 'blobs' && row.__b64
          ? { ...row, bytes: base64ToUint8Array(row.bytes).buffer, __b64: undefined }
          : row;
      delete restored.__b64;
      await tx.store.put(restored);
    }
    await tx.done;
  }
}
