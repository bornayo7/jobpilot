import { useEffect, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { loadProfile } from '@lib/storage/profileStore';
import { loadSettings, type Settings } from '@lib/storage/settingsStore';
import {
  deleteJob,
  dueFollowUps,
  listJobs,
  updateJob,
  type JobStatus,
  type TrackerJob,
} from '@lib/tracker/store';
import { buildFollowUpPrompt } from '@lib/prompts/promptStudio/builders';

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
  const [jobs, setJobs] = useState<TrackerJob[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const refresh = () => void listJobs().then(setJobs);
  // The tab stays mounted while hidden; reload when it comes into view so
  // applications recorded meanwhile show up.
  useEffect(() => {
    if (!active) return;
    refresh();
    void loadProfile().then(setProfile);
    void loadSettings().then(setSettings);
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
    await navigator.clipboard.writeText(prompt);
    setCopiedId(`${job.id}:${variant}`);
    setTimeout(() => setCopiedId(''), 1800);
  };

  const patch = async (job: TrackerJob, changes: Partial<TrackerJob>) => {
    await updateJob({ ...job, ...changes });
    refresh();
  };

  if (jobs.length === 0) {
    return (
      <div className="placeholder">
        <h2>Job tracker</h2>
        <p>
          Applications are captured automatically when you click Submit and the site confirms.
          Nothing here yet — go apply to something.
        </p>
      </div>
    );
  }

  return (
    <div className="tracker-tab">
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
                onPatch={(changes) => void patch(job, changes)}
                onDelete={async () => {
                  await deleteJob(job.id);
                  refresh();
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
  onPatch: (changes: Partial<TrackerJob>) => void;
  onDelete: () => void;
  onDraft: (variant: 'followUp' | 'thankYou') => void;
}) {
  const [notes, setNotes] = useState(job.notes);

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
          <select value={job.status} onChange={(e) => onPatch({ status: e.target.value as JobStatus })}>
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <button className="entry-remove" onClick={onDelete}>✕</button>
        </div>
      </div>
      <textarea
        className="paste-area"
        rows={1}
        placeholder="Notes (interviewers, next steps…)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== job.notes) onPatch({ notes });
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
