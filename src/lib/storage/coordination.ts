import { browser } from '#imports';
import type { IDBPDatabase, StoreNames } from 'idb';
import { getDb, type JobpilotDB, type RecoveryJournal } from './db';

const LOCK = 'jobpilot:storage';
const COLLECTION_EVENT = 'jobpilot:collections';
let pending: Promise<unknown> = Promise.resolve();
type Database = IDBPDatabase<JobpilotDB>;
export type DataStore = Exclude<StoreNames<JobpilotDB>, 'recoveryJournal'>;
export type StoreRows = Partial<Record<DataStore, unknown[]>>;

export class StorageRecoveryError extends Error {
  constructor(public override readonly cause: unknown) {
    super('An interrupted storage change needs recovery. Your recovery copy is retained. Retry when storage is available.');
    this.name = 'StorageRecoveryError';
  }
}

async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return navigator.locks.request(LOCK, operation);
  const result = pending.then(operation, operation);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

/** The callback owns the lock: use its db directly, never call another
 * coordinated public operation from inside it. Readers use the same lock so
 * no extension context can observe half of a cross-store change. */
export function withStorageRead<T>(operation: (db: Database) => Promise<T>): Promise<T> {
  return exclusive(async () => {
    const db = await getDb();
    await recover(db);
    return operation(db);
  });
}

export function withStorageWrite<T>(operation: (db: Database) => Promise<T>): Promise<T> {
  return withStorageRead(async (db) => {
    const value = await operation(db);
    // Collection notification is advisory; a committed write must not be
    // reported as failed merely because this refresh signal could not save.
    await publishCollections();
    return value;
  });
}

function publishCollections(): Promise<void> {
  return browser.storage.local.set({ [COLLECTION_EVENT]: `${Date.now()}:${Math.random()}` })
    .catch((error) => console.warn('[jobpilot] collection notification failed', error));
}

export function watchCollections(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && changes[COLLECTION_EVENT]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export function recoverStorage(): Promise<void> {
  return withStorageRead(async () => undefined);
}

/** Internal cross-store primitive. Call only while holding withStorageWrite.
 * The IDB replacement and rollback copy commit together. A crash then resumes
 * the local-store commit; an observed write failure switches durably to rollback.
 * A failed recovery keeps the journal, blocking normal reads until retried. */
export async function replaceAcrossStores(
  db: Database, rows: StoreRows, local: Record<string, unknown>, localKeys: string[],
): Promise<void> {
  const beforeLocal = await browser.storage.local.get(localKeys);
  const stores = Object.keys(rows) as DataStore[];
  const tx = db.transaction([...stores, 'recoveryJournal'], 'readwrite');
  void tx.done.catch(() => undefined);
  try {
    const beforeIdb: Record<string, unknown[]> = {};
    for (const name of stores) beforeIdb[name] = await tx.objectStore(name).getAll();
    await tx.objectStore('recoveryJournal').put({ id: 'active', phase: 'commit', beforeIdb,
      beforeLocal, afterLocal: local, localKeys });
    for (const name of stores) {
      const store = tx.objectStore(name);
      await store.clear();
      for (const row of rows[name]!) await store.put(row as never);
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
  try {
    await replaceLocal(local, localKeys);
  } catch (error) {
    // Persist rollback intent before attempting compensation; recovery can
    // itself fail or the service worker can be stopped at any subsequent await.
    try {
      const journal = (await db.get('recoveryJournal', 'active'))!;
      await db.put('recoveryJournal', { ...journal, phase: 'rollback' });
    } catch (markerError) {
      // Without durable rollback intent, recovery must still honor the last
      // committed journal. Do not incorrectly report that rollback completed.
      throw new StorageRecoveryError(markerError);
    }
    await recover(db);
    throw error;
  }
  try { await db.delete('recoveryJournal', 'active'); }
  catch (error) { throw new StorageRecoveryError(error); }
}

async function replaceLocal(values: Record<string, unknown>, keys: string[]): Promise<void> {
  await browser.storage.local.set(Object.fromEntries(keys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]])));
  await browser.storage.local.remove(keys.filter((key) => values[key] === undefined));
}

async function recover(db: Database): Promise<void> {
  const journal = await db.get('recoveryJournal', 'active');
  if (!journal) return;
  try {
    if (journal.phase === 'rollback') {
      await restoreIdb(db, journal);
      await replaceLocal(journal.beforeLocal, journal.localKeys);
    } else {
      await replaceLocal(journal.afterLocal, journal.localKeys);
    }
    await db.delete('recoveryJournal', 'active');
    await publishCollections();
  } catch (error) {
    throw new StorageRecoveryError(error);
  }
}

async function restoreIdb(db: Database, journal: RecoveryJournal): Promise<void> {
  const stores = Object.keys(journal.beforeIdb) as DataStore[];
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  void tx.done.catch(() => undefined);
  try {
    for (const name of stores) {
      const store = tx.objectStore(name);
      await store.clear();
      for (const row of journal.beforeIdb[name]!) await store.put(row as never);
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
