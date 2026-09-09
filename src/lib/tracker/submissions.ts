import type { CapturedAnswer, FillProvenance } from '../messaging/protocol';
import { cleanJobTitle, companyFromUrl, looksLikeConfirmation } from './detect';
import { applicationId } from './applicationId';
import { withStorageWrite } from '../storage/coordination';
import type { SubmissionAttemptRecord, TrackerJob, AnswerRecord } from '../storage/db';
import { newId } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';
import { completeTransaction } from '../storage/transaction';

export interface SubmitAttempt extends FillProvenance {
  documentId: string;
  url: string;
  title: string;
  answers: CapturedAnswer[];
}
export type RecordingResult = { status: 'recorded'; job: TrackerJob } | { status: 'ignored' | 'duplicate' | 'failed'; reason: string };
const ATTEMPT_TTL_MS = 20 * 60 * 1000;

/** Durable evidence survives worker restarts. One transaction consumes that
 * evidence and writes the application and its answers, or changes nothing. */
export class SubmissionTracker {
  constructor(private readonly ttlMs = ATTEMPT_TTL_MS, private readonly now: () => number = () => Date.now()) {}

  attempted(tabId: number, attempt: SubmitAttempt): Promise<void> {
    return withStorageWrite(async (db) => {
      const identity = applicationId(attempt.url);
      if (!identity) return;
      const id = `${tabId}:${identity}`;
      const tx = db.transaction('submissionAttempts', 'readwrite');
      return completeTransaction(tx, async () => {
        const prior = await tx.store.get(id);
        for (const old of await tx.store.getAll()) if (this.now() - old.at >= this.ttlMs) await tx.store.delete(old.id);
        const record: SubmissionAttemptRecord = { ...attempt, id, tabId, applicationId: identity,
          attemptId: prior && prior.documentId === attempt.documentId && this.now() - prior.at < this.ttlMs ? prior.attemptId : newId(), at: this.now() };
        await tx.store.put(record);
      });
    });
  }

  forget(tabId: number): Promise<void> {
    return withStorageWrite(async (db) => {
      const tx = db.transaction('submissionAttempts', 'readwrite');
      return completeTransaction(tx, async () => {
        for (const attempt of await tx.store.getAll()) if (attempt.tabId === tabId) await tx.store.delete(attempt.id);
      });
    });
  }

  async confirmed(tabId: number, detected: { url: string; title: string; confirmationText?: string }): Promise<RecordingResult> {
    const identity = applicationId(detected.url);
    if (!identity || !looksLikeConfirmation(detected.url, detected.confirmationText ?? '')) return { status: 'ignored', reason: 'No specific application confirmation evidence' };
    try {
      return await withStorageWrite(async (db): Promise<RecordingResult> => {
        const tx = db.transaction(['submissionAttempts', 'trackerJobs', 'answers'], 'readwrite');
        return completeTransaction(tx, async (): Promise<RecordingResult> => {
          const attempts = tx.objectStore('submissionAttempts');
          const attempt = await attempts.get(`${tabId}:${identity}`);
          if (!attempt) return { status: 'ignored', reason: 'No matching application attempt; record manually if needed' };
          if (this.now() - attempt.at >= this.ttlMs) {
            await attempts.delete(attempt.id);
            return { status: 'ignored', reason: 'The application attempt expired' };
          }
          const jobs = tx.objectStore('trackerJobs');
          const duplicate = await jobs.index('byAttempt').get(attempt.attemptId);
          if (duplicate) { await attempts.delete(attempt.id); return { status: 'duplicate', reason: 'This attempt was already recorded' }; }
          const now = this.now();
          const job: TrackerJob = { id: newId(), applicationId: identity, attemptId: attempt.attemptId,
            company: companyFromUrl(attempt.url), title: cleanJobTitle(attempt.title || detected.title), url: attempt.url,
            profileId: attempt.profileId, profileRevision: attempt.profileRevision, resumeName: attempt.resumeName,
            resumeVersionId: attempt.resumeVersionId, status: 'applied', notes: '', appliedAt: now,
            followUpAt: now + 7 * 24 * 60 * 60 * 1000, createdAt: now, revision: 1 };
          await jobs.put(job);
          for (const answer of attempt.answers) {
            const record: AnswerRecord = { id: newId(), questionRaw: answer.label, questionNormalized: normalizeForSignature(answer.label),
              answer: answer.value, jobId: job.id, company: job.company, applicationId: identity,
              origin: 'captured', reusable: false, reuseConfirmed: false, createdAt: now, revision: 1 };
            record.profileId = attempt.profileId; record.profileRevision = attempt.profileRevision;
            await tx.objectStore('answers').put(record);
          }
          await attempts.delete(attempt.id);
          return { status: 'recorded', job };
        });
      });
    } catch (error) { return { status: 'failed', reason: `Application was not recorded; its evidence is retained for retry: ${String(error)}` }; }
  }
}
