import { browser } from '#imports';
import { z } from 'zod';
import { JOB_STATUSES, type DocumentMeta } from './db';
import { arrayBufferToBase64, base64ToUint8Array } from '../util/base64';
import { ResumeVersionSchema } from '../schema/resumeVersion';
import { SETTINGS_KEY, SETTINGS_REVISION_KEY, SettingsSchema } from './settingsStore';
import { PROFILES_KEY, parseProfilesContainer, readProfileContainer } from './profileStore';
import { MAPPING_CACHE_KEY } from './mappingCache';
import { ALL_FIELD_KINDS, type FieldKind } from '../schema/fieldKind';
import { replaceAcrossStores, withStorageRead, withStorageWrite, type StoreRows } from './coordination';
import { nextRestoreRevision } from './revisions';

const LOCAL_KEYS = [PROFILES_KEY, SETTINGS_KEY, SETTINGS_REVISION_KEY, MAPPING_CACHE_KEY];
const BACKUP_STORES = ['blobs', 'resumeVersions', 'answers', 'trackerJobs', 'unmatchedLog', 'generationDrafts'] as const;
export interface BackupPayload { exportedAt: number; local: Record<string, unknown>; idb: Record<string, unknown[]> }
export interface BackupReport { warnings: string[] }

export function gatherBackupPayload(): Promise<BackupPayload> {
  return withStorageRead(async (db) => {
    const local = await browser.storage.local.get(LOCAL_KEYS);
    if (local[PROFILES_KEY] === undefined) {
      const legacy = (await browser.storage.local.get('jobpilot:profile'))['jobpilot:profile'];
      // Export must preserve even unsupported raw data for recovery. Migration
      // is validated on import, never by discarding values while exporting.
      local[PROFILES_KEY] = legacy == null ? await readProfileContainer() : {
        schemaVersion: 1, activeId: 'default', profiles: { default: { name: 'Default', revision: 0, profile: legacy } },
      };
    }
    const idb: Record<string, unknown[]> = {};
    // The common lock prevents concurrent ordinary writes; one readonly IDB
    // transaction also gives a consistent view if a future reader gains concurrency.
    const tx = db.transaction([...BACKUP_STORES], 'readonly');
    for (const name of BACKUP_STORES) {
      if (name === 'blobs') idb[name] = (await tx.objectStore(name).getAll()).map(({ bytes, ...row }) => ({ ...row, bytes: arrayBufferToBase64(bytes), __b64: true }));
      else idb[name] = await tx.objectStore(name).getAll();
    }
    await tx.done;
    return { exportedAt: Date.now(), local, idb };
  });
}

/** Report legacy missing targets without destroying their historical identity. */
export function inspectBackupPayload(payload: unknown): BackupReport {
  return { warnings: validatePayload(payload).warnings };
}

export async function restoreBackupPayload(payload: BackupPayload): Promise<BackupReport> {
  const validated = validatePayload(payload); // before any bootstrap or destructive write
  return withStorageWrite(async (db) => {
    const current = (await browser.storage.local.get(PROFILES_KEY))[PROFILES_KEY] as
      { profiles?: Record<string, { revision?: unknown }> } | undefined;
    const next = structuredClone(validated);
    const oldSettings = await browser.storage.local.get(SETTINGS_REVISION_KEY);
    const revisions = [Number(oldSettings[SETTINGS_REVISION_KEY]) || 0, Number(next.local[SETTINGS_REVISION_KEY]) || 0];
    if (current?.profiles && typeof current.profiles === 'object') {
      for (const slot of Object.values(current.profiles)) if (slot && typeof slot === 'object') revisions.push(Number(slot.revision) || 0);
    }
    for (const slot of Object.values(next.profiles.profiles)) revisions.push(slot.revision);
    for (const name of ['answers', 'trackerJobs', 'generationDrafts'] as const) {
      for (const row of await db.getAll(name)) revisions.push(row.revision ?? 0);
      for (const row of next.idb[name] as { revision?: number }[]) revisions.push(row.revision ?? 0);
    }
    // Also exceed deleted records and earlier restores that omitted an id.
    // Reserving before the journal is safe: failure only leaves a revision gap.
    const restoredRevision = await nextRestoreRevision(revisions);
    for (const slot of Object.values(next.profiles.profiles)) slot.revision = restoredRevision;
    next.local[PROFILES_KEY] = next.profiles;
    next.local[SETTINGS_REVISION_KEY] = restoredRevision;
    for (const name of ['answers', 'trackerJobs', 'generationDrafts'] as const) {
      for (const row of next.idb[name] as { revision?: number }[]) row.revision = restoredRevision;
    }
    await replaceAcrossStores(db, next.idb, next.local, LOCAL_KEYS);
    return { warnings: next.warnings };
  });
}

const id = z.string().min(1);
const timestamp = z.number().finite().nonnegative();
const revision = z.number().int().nonnegative();
const record = { id, createdAt: timestamp };
const schemas = {
  blobs: z.object({ ...record, name: z.string(), type: z.string(), bytes: z.string(), __b64: z.literal(true) }),
  resumeVersions: z.object({
    ...record, kind: z.enum(['resume', 'coverLetter']), label: z.string(), company: z.string(),
    jobUrl: z.string().optional(), pdfBlobId: id.optional(), docxBlobId: id.optional(),
    profileId: id.optional(), profileRevision: revision.optional(),
    data: z.union([ResumeVersionSchema, z.object({ text: z.string() })]),
  }).refine((row) => row.kind === 'resume' ? ResumeVersionSchema.safeParse(row.data).success : z.object({ text: z.string() }).safeParse(row.data).success, 'Version data does not match its kind'),
  answers: z.object({
    ...record, questionRaw: z.string(), questionNormalized: z.string(), answer: z.string(),
    jobId: z.string(), company: z.string(), reusable: z.boolean(), revision: revision.optional(),
    applicationId: z.string().optional(), origin: z.enum(['captured', 'manual', 'generated']).optional(), reuseConfirmed: z.boolean().optional(),
    profileId: id.optional(), profileRevision: revision.optional(),
  }),
  trackerJobs: z.object({
    ...record, company: z.string(), title: z.string(), url: z.string(), notes: z.string(), status: z.enum(JOB_STATUSES),
    resumeVersionId: id.optional(), resumeName: z.string().optional(), appliedAt: timestamp.optional(), followUpAt: timestamp.optional(),
    revision: revision.optional(), applicationId: z.string().optional(), attemptId: z.string().optional(), profileId: z.string().optional(), profileRevision: revision.optional(),
  }),
  unmatchedLog: z.object({ id, atsId: z.string().nullable(), url: z.string(), label: z.string(), control: z.string(), signature: z.string(), seenAt: timestamp }),
  generationDrafts: z.object({ id, revision, promptType: z.enum(['resume', 'coverLetter', 'answer']), question: z.string(), pasted: z.string(), updatedAt: timestamp }),
};

function validatePayload(raw: unknown) {
  const parsed = z.object({
    exportedAt: timestamp,
    local: z.object({
      [PROFILES_KEY]: z.unknown(), [SETTINGS_KEY]: SettingsSchema.optional(), [SETTINGS_REVISION_KEY]: revision.optional(),
      [MAPPING_CACHE_KEY]: z.record(z.object({
        kind: z.string().refine((kind) => ALL_FIELD_KINDS.includes(kind as FieldKind)),
        confidence: z.number().min(0).max(1), source: z.enum(['llm', 'user-correction']),
        model: z.string().optional(), createdAt: timestamp, lastHit: timestamp, hits: timestamp,
      })).optional(),
    }).strict(),
    idb: z.object({
      blobs: z.array(schemas.blobs), resumeVersions: z.array(schemas.resumeVersions), answers: z.array(schemas.answers),
      trackerJobs: z.array(schemas.trackerJobs), unmatchedLog: z.array(schemas.unmatchedLog), generationDrafts: z.array(schemas.generationDrafts).default([]),
    }).strict(),
  }).safeParse(raw);
  if (!parsed.success) throw new Error(`Backup payload is malformed: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const profiles = parseProfilesContainer(parsed.data.local[PROFILES_KEY]);
  const rawProfiles = parsed.data.local[PROFILES_KEY] as { activeId?: unknown };
  if (profiles.activeId !== rawProfiles.activeId) throw new Error('Backup active profile is missing.');
  for (const name of BACKUP_STORES) {
    const rows = parsed.data.idb[name];
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(`Duplicate ids in backup store: ${name}`);
  }
  const blobs = parsed.data.idb.blobs.map(({ __b64, bytes, ...row }) => ({ ...row, bytes: base64ToUint8Array(bytes).buffer }));
  const blobIds = new Set(blobs.map((blob) => blob.id));
  const versions = parsed.data.idb.resumeVersions;
  const versionIds = new Set(versions.map((row) => row.id));
  const jobIds = new Set(parsed.data.idb.trackerJobs.map((row) => row.id));
  const owners = new Map<string, string>();
  const warnings: string[] = [];
  for (const version of versions) {
    for (const blobId of [version.pdfBlobId, version.docxBlobId]) {
      if (!blobId) continue;
      if (owners.has(blobId) && owners.get(blobId) !== version.id) throw new Error('Multiple versions claim the same generated artifact.');
      owners.set(blobId, version.id);
      if (!blobIds.has(blobId)) warnings.push(`Version "${version.label}" references a missing document. Its history is preserved.`);
    }
  }
  for (const slot of Object.values(profiles.profiles)) {
    for (const docId of [slot.profile.documents.defaultResumeId, slot.profile.documents.defaultCoverLetterId]) {
      if (docId && !blobIds.has(docId)) warnings.push(`Profile "${slot.name}" has a missing default document. Choose a replacement in the profile editor.`);
    }
  }
  for (const job of parsed.data.idb.trackerJobs) if (job.resumeVersionId && !versionIds.has(job.resumeVersionId)) warnings.push(`Application "${job.title}" keeps a historical version reference whose file was removed.`);
  for (const answer of parsed.data.idb.answers) if (answer.jobId && !jobIds.has(answer.jobId)) warnings.push('An answer keeps a historical reference to a removed application.');
  const documentMeta: DocumentMeta[] = blobs.map(({ bytes, ...row }) => ({ ...row, size: bytes.byteLength,
    source: owners.has(row.id) ? 'generated' : 'upload', ...(owners.has(row.id) ? { versionId: owners.get(row.id)! } : {}) }));
  const idb: StoreRows = { ...parsed.data.idb, blobs, documentMeta, submissionAttempts: [] };
  return { local: { ...parsed.data.local, [PROFILES_KEY]: profiles } as Record<string, unknown>, profiles, idb, warnings: [...new Set(warnings)] };
}
