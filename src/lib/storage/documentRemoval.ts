import type { IDBPDatabase } from 'idb';
import type { JobpilotDB } from './db';
import { replaceAcrossStores } from './coordination';
import { PROFILES_KEY, readProfileContainer } from './profileStore';

export interface DocumentReference { profileId: string; profileName: string; kind: 'resume' | 'coverLetter' }
export interface RemovalOptions { clearDefaults?: boolean }
export class DocumentInUseError extends Error {
  constructor(public readonly references: DocumentReference[]) {
    super(`This document is a default for ${references.map((ref) => ref.profileName).join(', ')}. Confirm clearing those defaults before removing it.`);
    this.name = 'DocumentInUseError';
  }
}
export class GeneratedDocumentError extends Error {
  constructor(public readonly versionId: string) {
    super('This file belongs to a generated version. Remove the complete version from the version library.');
    this.name = 'GeneratedDocumentError';
  }
}

/** Internal: caller holds the coordinated writer lock. Historical tracker
 * links remain valid provenance even when their document no longer exists. */
export async function removeArtifacts(db: IDBPDatabase<JobpilotDB>, ids: string[], versionId: string | undefined, options: RemovalOptions): Promise<void> {
  const removed = new Set(ids);
  const container = await readProfileContainer();
  const references: DocumentReference[] = [];
  for (const [profileId, slot] of Object.entries(container.profiles)) {
    for (const [key, kind] of [['defaultResumeId', 'resume'], ['defaultCoverLetterId', 'coverLetter']] as const) {
      const id = slot.profile.documents[key];
      if (id && removed.has(id)) {
        references.push({ profileId, profileName: slot.name, kind });
        slot.profile.documents[key] = null;
      }
    }
    if (references.some((ref) => ref.profileId === profileId)) slot.revision += 1;
  }
  if (references.length && !options.clearDefaults) throw new DocumentInUseError(references);
  if (references.length) {
    await replaceAcrossStores(db, {
      blobs: (await db.getAll('blobs')).filter((row) => !removed.has(row.id)),
      documentMeta: (await db.getAll('documentMeta')).filter((row) => !removed.has(row.id)),
      resumeVersions: (await db.getAll('resumeVersions')).filter((row) => row.id !== versionId),
    }, { [PROFILES_KEY]: container }, [PROFILES_KEY]);
    return;
  }
  const tx = db.transaction(['blobs', 'documentMeta', 'resumeVersions'], 'readwrite');
  void tx.done.catch(() => undefined);
  try {
    for (const id of removed) {
      await tx.objectStore('blobs').delete(id);
      await tx.objectStore('documentMeta').delete(id);
    }
    if (versionId) await tx.objectStore('resumeVersions').delete(versionId);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
