import { browser } from '#imports';
import { getDb, JOB_STATUSES } from '../storage/db';
import { arrayBufferToBase64, base64ToUint8Array } from './base64';
import { z } from 'zod';
import { ProfileSchema } from '../schema/profile';
import { ResumeVersionSchema } from '../schema/resumeVersion';
import { SETTINGS_KEY, SettingsSchema } from '../storage/settingsStore';
import { PROFILES_KEY, loadContainer } from '../storage/profileStore';
import { MAPPING_CACHE_KEY } from '../storage/mappingCache';
import { ALL_FIELD_KINDS, type FieldKind } from '../schema/fieldKind';

/**
 * Gather/restore everything JobPilot stores. Restore is replace-all — the
 * options page confirms with the user before calling it.
 */
const LOCAL_KEYS = [PROFILES_KEY, SETTINGS_KEY, MAPPING_CACHE_KEY] as const;
const IDB_STORES = ['blobs', 'resumeVersions', 'answers', 'trackerJobs', 'unmatchedLog'] as const;

export interface BackupPayload {
  exportedAt: number;
  local: Record<string, unknown>;
  idb: Record<string, unknown[]>;
}

export async function gatherBackupPayload(): Promise<BackupPayload> {
  // Include the legacy profile on the first export, before any editor opens.
  await loadContainer();
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
  // Decode and validate EVERY store before the first destructive write.
  const next = validatePayload(payload);
  const previous = await gatherBackupPayload();
  const db = await getDb();
  await replaceIdb(next.idb);
  try {
    await replaceLocal(next.local);
  } catch (error) {
    // IndexedDB and chrome.storage cannot share a transaction. Compensate for
    // a local-storage failure so an ordinary failed restore keeps the old data.
    await replaceIdb(decodeBlobs(previous.idb));
    await replaceLocal(previous.local);
    throw error;
  }

  async function replaceIdb(rows: Record<string, unknown[]>) {
    const tx = db.transaction([...IDB_STORES], 'readwrite');
    // An abort may reject done while an individual request is still awaited.
    void tx.done.catch(() => undefined);
    try {
      for (const store of IDB_STORES) {
        const target = tx.objectStore(store);
        await target.clear();
        for (const row of rows[store]!) await target.put(row as never);
      }
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
}

async function replaceLocal(local: Record<string, unknown>) {
  await browser.storage.local.set(Object.fromEntries(Object.entries(local).filter(([, value]) => value !== undefined)));
  await browser.storage.local.remove(LOCAL_KEYS.filter((key) => local[key] === undefined));
}

const id = z.string().min(1);
const timestamp = z.number().finite().nonnegative();
const record = { id, createdAt: timestamp };
const schemas = {
  blobs: z.object({ ...record, name: z.string(), type: z.string(), bytes: z.string(), __b64: z.literal(true) }),
  resumeVersions: z.object({
    ...record, kind: z.enum(['resume', 'coverLetter']), label: z.string(), company: z.string(),
    jobUrl: z.string().optional(), pdfBlobId: id.optional(), docxBlobId: id.optional(),
    data: z.union([ResumeVersionSchema, z.object({ text: z.string() })]),
  }).refine((row) => row.kind === 'resume'
    ? ResumeVersionSchema.safeParse(row.data).success
    : z.object({ text: z.string() }).safeParse(row.data).success, 'Version data does not match its kind'),
  answers: z.object({
    ...record, questionRaw: z.string(), questionNormalized: z.string(), answer: z.string(),
    jobId: z.string(), company: z.string(), reusable: z.boolean(),
  }),
  trackerJobs: z.object({
    ...record, company: z.string(), title: z.string(), url: z.string(), notes: z.string(),
    status: z.enum(JOB_STATUSES),
    resumeVersionId: id.optional(), resumeName: z.string().optional(),
    appliedAt: timestamp.optional(), followUpAt: timestamp.optional(),
  }),
  unmatchedLog: z.object({
    id, atsId: z.string().nullable(), url: z.string(), label: z.string(),
    control: z.string(), signature: z.string(), seenAt: timestamp,
  }),
};

function validatePayload(raw: unknown) {
  const parsed = z.object({
    exportedAt: timestamp,
    local: z.object({
      [PROFILES_KEY]: z.object({
        activeId: id,
        profiles: z.record(z.object({ name: z.string(), profile: ProfileSchema })),
      }).refine((c) => Object.hasOwn(c.profiles, c.activeId), 'Active profile is missing'),
      [SETTINGS_KEY]: SettingsSchema.optional(),
      [MAPPING_CACHE_KEY]: z.record(z.object({
        kind: z.string().refine((kind) => ALL_FIELD_KINDS.includes(kind as FieldKind)),
        confidence: z.number().min(0).max(1), source: z.enum(['llm', 'user-correction']),
        model: z.string().optional(), createdAt: timestamp, lastHit: timestamp, hits: timestamp,
      })).optional(),
    }).strict(),
    idb: z.object({
      blobs: z.array(schemas.blobs), resumeVersions: z.array(schemas.resumeVersions),
      answers: z.array(schemas.answers), trackerJobs: z.array(schemas.trackerJobs),
      unmatchedLog: z.array(schemas.unmatchedLog),
    }).strict(),
  }).safeParse(raw);
  if (!parsed.success) throw new Error(`Backup payload is malformed: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  for (const store of IDB_STORES) {
    const rows = parsed.data.idb[store];
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(`Duplicate ids in backup store: ${store}`);
  }
  return { local: parsed.data.local, idb: decodeBlobs(parsed.data.idb) };
}

function decodeBlobs(idb: Record<string, unknown[]>): Record<string, unknown[]> {
  return {
    ...idb,
    blobs: idb.blobs!.map((raw) => {
      const { __b64, bytes, ...meta } = raw as z.infer<typeof schemas.blobs>;
      return { ...meta, bytes: base64ToUint8Array(bytes).buffer };
    }),
  };
}
