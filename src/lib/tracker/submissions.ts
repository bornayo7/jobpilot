import type { CapturedAnswer } from '../messaging/protocol';
import { cleanJobTitle, companyFromUrl } from './detect';
import { createJob } from './store';
import { saveAnswer } from '../memory/answers';
import { loadProfile } from '../storage/profileStore';
import { getDocumentMeta } from '../storage/documents';

/** What the content script snapshotted when a submit-looking control was activated. */
export interface SubmitAttempt {
  url: string;
  title: string;
  answers: CapturedAnswer[];
}

const ATTEMPT_TTL_MS = 20 * 60 * 1000;

/**
 * Pairs a submit click with the confirmation page that follows it, per tab.
 * The click snapshots the free-text answers (the form is gone once navigation
 * starts); the confirmation is what proves the application went through, and
 * only then is a tracker job written and the answers filed under it.
 *
 * Attempts expire. Tab ids are reused, so a stale snapshot must never attach
 * to a later application's confirmation in the same tab.
 */
export class SubmissionTracker {
  private readonly attempts = new Map<number, SubmitAttempt & { at: number }>();

  constructor(
    private readonly ttlMs = ATTEMPT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** A submit-looking control was activated in this tab. */
  attempted(tabId: number, attempt: SubmitAttempt): void {
    this.prune();
    this.attempts.set(tabId, { ...attempt, at: this.now() });
  }

  /** The tab closed; it can never produce the confirmation its attempt waits for. */
  forget(tabId: number): void {
    this.attempts.delete(tabId);
  }

  /** A confirmation page appeared in this tab: record the application. */
  async confirmed(tabId: number, detected: { url: string; title: string }): Promise<void> {
    const attempt = this.take(tabId);
    const sourceUrl = attempt?.url ?? detected.url;
    const job = await createJob({
      company: companyFromUrl(sourceUrl),
      title: cleanJobTitle(attempt?.title || detected.title),
      url: sourceUrl,
      resumeName: await defaultResumeName(),
    }).catch(() => null);
    if (!job) return; // duplicate within 24h, or storage failure

    for (const answer of attempt?.answers ?? []) {
      await saveAnswer({
        questionRaw: answer.label,
        answer: answer.value,
        jobId: job.id,
        company: job.company,
        reusable: true, // hand-typed by the user — safe to resurface (review-gated)
      }).catch(() => undefined);
    }
  }

  /** Remove and return the tab's attempt, unless it has expired. */
  private take(tabId: number): SubmitAttempt | null {
    const attempt = this.attempts.get(tabId);
    this.attempts.delete(tabId);
    return attempt && this.now() - attempt.at < this.ttlMs ? attempt : null;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [tabId, attempt] of this.attempts) {
      if (attempt.at < cutoff) this.attempts.delete(tabId);
    }
  }
}

/** Best-effort: the active profile's default resume name, for the tracker row. */
async function defaultResumeName(): Promise<string | undefined> {
  try {
    const id = (await loadProfile()).documents.defaultResumeId;
    return id ? (await getDocumentMeta(id))?.name : undefined;
  } catch {
    return undefined;
  }
}
