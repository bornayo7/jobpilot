import { useEffect, useRef, useState } from 'react';
import { useProfile, useSettings } from '@hooks/useStores';
import {
  deleteJob,
  dueFollowUps,
  listJobs,
  patchJob,
  type JobStatus,
  type TrackerJob,
} from '@lib/tracker/store';
import { buildFollowUpPrompt } from '@lib/prompts/promptStudio/builders';
import { useCollection } from './useCollection';

const STATUSES: { value: JobStatus; label: string }[] = [
  { value: 'applied', label: 'Applied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'saved', label: 'Saved' },
];

/**
 * Applications are captured automatically when a confirmation page appears
 * after you click Submit — grouped by status with follow-up reminders on top.
 * Follow-up/thank-you drafts go through the Prompt Studio copy-paste flow.
 */
export function TrackerTab({ active = true }: { active?: boolean }) {
  const { items: jobs, loading, error: loadError, refresh } = useCollection(listJobs);
  const [error, setError] = useState('');
  const { profile } = useProfile();
  const { settings } = useSettings();
  const [copiedId, setCopiedId] = useState('');

  // The tab stays mounted while hidden; reload when it comes into view so
  // applications recorded meanwhile show up.
  useEffect(() => {
    if (active) void refresh();
  }, [active]);

  const due = dueFollowUps(jobs);

  const copyDraft = async (job: TrackerJob, variant: 'followUp' | 'thankYou') => {
    if (!profile || !settings) return;
    const prompt = buildFollowUpPrompt(
      profile,
      { company: job.company, title: job.title, url: job.url, appliedAt: job.appliedAt },
      settings.promptStyle,
      variant,
    );
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedId(`${job.id}:${variant}`);
      setTimeout(() => setCopiedId(''), 1800);
    } catch (err) { setError(`Prompt could not be copied. ${String(err)}`); }
  };

  const patch = async (job: TrackerJob, changes: Partial<TrackerJob>, base: Partial<TrackerJob> = job) => {
    setError('');
    try { await patchJob(job.id, changes, base); await refresh(); return true; }
    catch (err) { setError(`Application was not updated. ${String(err)}`); return false; }
  };

  if (jobs.length === 0) {
    return (
      <div className="placeholder">
        <h2>Job tracker</h2>
        <p>
          Applications are captured automatically when you click Submit and the site confirms.
          {loading ? 'Loading applications…' : 'Your confirmed applications will appear here.'}
        </p>
        {(error || loadError) && <div role="alert">{error || loadError}<button onClick={() => void refresh()}>Retry</button></div>}
      </div>
    );
  }

  return (
    <div className="tracker-tab">
      {(error || loadError) && <div className="warn-box" role="alert">{error || loadError}<button onClick={() => void refresh()}>Refresh applications</button></div>}
      {due.length > 0 && (
        <>
          <div className="frame-header">Follow-ups due</div>
          {due.map((job) => (
            <div className="warn-box" key={`due-${job.id}`}>
              <div style={{ flex: 1 }}>
                <strong>{job.company}</strong> — {job.title || 'application'} ·{' '}
                {daysAgo(job.appliedAt)} days since applying
              </div>
              <button onClick={() => void copyDraft(job, 'followUp')}>
                {copiedId === `${job.id}:followUp` ? 'Prompt copied ✓' : 'Draft follow-up'}
              </button>
              <button onClick={() => void patch(job, { followUpAt: Date.now() + 7 * 86_400_000 })}>
                Snooze 7d
              </button>
            </div>
          ))}
        </>
      )}

      {STATUSES.map(({ value, label }) => {
        const group = jobs.filter((job) => job.status === value);
        if (group.length === 0) return null;
        return (
          <div key={value}>
            <div className="frame-header">
              {label} ({group.length})
            </div>
            {group.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                copiedId={copiedId}
                onPatch={(changes, base) => patch(job, changes, base)}
                onDelete={async () => {
                  try { await deleteJob(job.id); await refresh(); }
                  catch (err) { setError(`Application was not removed. ${String(err)}`); }
                }}
                onDraft={(variant) => void copyDraft(job, variant)}
              />
            ))}
          </div>
        );
      })}
      <p className="hint" style={{ marginTop: 8 }}>
        Drafts are Prompt Studio prompts — paste into claude.ai / ChatGPT, then send the result from
        your own email.
      </p>
    </div>
  );
}

function JobCard({
  job,
  copiedId,
  onPatch,
  onDelete,
  onDraft,
}: {
  job: TrackerJob;
  copiedId: string;
  onPatch: (changes: Partial<TrackerJob>, base?: Partial<TrackerJob>) => Promise<boolean>;
  onDelete: () => void;
  onDraft: (variant: 'followUp' | 'thankYou') => void;
}) {
  const [notes, setNotes] = useState(job.notes);
  const [dirty, setDirty] = useState(false);
  const baseNotes = useRef(job.notes);
  const edit = useRef(0);
  useEffect(() => { if (!dirty) setNotes(job.notes); }, [job.notes, dirty]);

  return (
    <div className="review-row" style={{ marginBottom: 8 }}>
      <div className="review-top">
        <div className="version-main">
          <a className="field-label" href={job.url} target="_blank" rel="noreferrer" title={job.url}>
            {job.company} — {job.title || 'application'}
          </a>
          <span className="hint">
            {job.appliedAt ? new Date(job.appliedAt).toLocaleDateString() : ''}
            {job.resumeName ? ` · ${job.resumeName}` : ''}
          </span>
        </div>
        <div className="field-meta">
          <select aria-label={`Status for ${job.company} ${job.title}`} value={job.status} onChange={(e) => void onPatch({ status: e.target.value as JobStatus })}>
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <button className="entry-remove" aria-label={`Delete application to ${job.company}`} onClick={onDelete}>Delete</button>
        </div>
      </div>
      <textarea
        aria-label={`Notes for ${job.company} ${job.title}`}
        className="paste-area"
        rows={1}
        placeholder="Notes (interviewers, next steps…)"
        value={notes}
        onChange={(e) => { if (!dirty) baseNotes.current = job.notes; edit.current++; setNotes(e.target.value); setDirty(true); }}
        onBlur={async () => {
          const revision = edit.current;
          if (dirty && await onPatch({ notes }, { notes: baseNotes.current })) {
            baseNotes.current = notes;
            if (edit.current === revision) setDirty(false);
          }
        }}
      />
      <div className="copy-row">
        <button onClick={() => onDraft('followUp')}>
          {copiedId === `${job.id}:followUp` ? 'Copied ✓' : 'Follow-up draft'}
        </button>
        {job.status === 'interviewing' && (
          <button onClick={() => onDraft('thankYou')}>
            {copiedId === `${job.id}:thankYou` ? 'Copied ✓' : 'Thank-you draft'}
          </button>
        )}
        <label className="hint" style={{ marginLeft: 'auto' }}>
          follow up{' '}
          <input
            type="date"
            value={job.followUpAt ? toLocalDateInput(job.followUpAt) : ''}
            onChange={(e) => onPatch({ followUpAt: fromLocalDateInput(e.target.value) })}
            style={{ width: 130 }}
          />
        </label>
      </div>
    </div>
  );
}

function daysAgo(timestamp?: number): number {
  if (!timestamp) return 0;
  return Math.max(0, Math.round((Date.now() - timestamp) / 86_400_000));
}

/**
 * <input type="date"> speaks calendar dates in the USER's zone. The previous
 * code formatted with toISOString (UTC) and parsed with new Date('YYYY-MM-DD')
 * (also UTC midnight), so any evening user west of Greenwich saw tomorrow's
 * date in the box and a follow-up set for "the 12th" came due at 7pm on the
 * 11th. Format and parse as local calendar dates instead.
 */
function toLocalDateInput(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromLocalDateInput(value: string): number | undefined {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 9).getTime(); // 9am local: due during the working day
}
