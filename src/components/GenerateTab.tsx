import { useEffect, useMemo, useRef, useState } from 'react';
import type { PanelActions, PanelState } from '@hooks/useBackgroundPort';
import { useProfile, useSettings } from '@hooks/useStores';
import {
  buildAnswerPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  type JobContext,
} from '@lib/prompts/promptStudio/builders';
import { importResumePaste, type BulletDiff } from '@lib/generation/importResult';
import type { ResumeVersion } from '@lib/schema/resumeVersion';
import { renderResumePdf } from '@lib/generation/renderPdf';
import { renderResumeDocx } from '@lib/generation/renderDocx';
import { validateResumePdf } from '@lib/generation/validatePdf';
import { storeCoverLetter, storeResumeVersion } from '@lib/generation/storeVersion';
import { deleteVersion, listVersions, type VersionRecord } from '@lib/storage/versions';
import { computeMatchGap } from '@lib/memory/matchGap';
import { saveAnswer } from '@lib/memory/answers';
import { companyFromUrl } from '@lib/tracker/detect';
import { ResumeReview } from './ResumeReview';
import { VersionLibrary } from './VersionLibrary';

type PromptType = 'resume' | 'coverLetter' | 'answer';

/** What the Review step established about the pasted text. */
type Review =
  | { kind: 'rejected'; errors: string[] }
  | { kind: 'resume'; version: ResumeVersion; diff: BulletDiff }
  | { kind: 'text' };

export function GenerateTab({ state, actions }: { state: PanelState; actions: Pick<PanelActions, 'extractJd'> }) {
  const { profile, save: saveProfile } = useProfile();
  const { settings, save: saveSettings } = useSettings();
  const [promptType, setPromptType] = useState<PromptType>('resume');
  const [question, setQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const previewBytes = useRef<ArrayBuffer | null>(null);
  /** Bumped whenever the review is discarded, so an async render or approval
   *  that started before the bump knows to drop its result. */
  const reviewRevision = useRef(0);

  /** Whatever was reviewed described a different paste, posting, or profile. */
  const discardReview = () => {
    reviewRevision.current += 1;
    setReview(null);
    setProblems([]);
    setPreviewUrl('');
    previewBytes.current = null;
  };

  useEffect(discardReview, [state.tabId, state.tabUrl, profile]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    void listVersions().then(setVersions);
  }, []);

  // Memoized on its inputs: the match gap tokenizes up to 60k characters and
  // the prompt serializes the whole profile, and both are keyed on this
  // object. Rebuilding it every render made each keystroke in the paste box
  // redo that work.
  const job = useMemo<JobContext | null>(
    () => (state.jd ? { title: state.jd.title, text: state.jd.text, url: state.tabUrl } : null),
    [state.jd, state.tabUrl],
  );

  const matchGap = useMemo(
    () => (job && profile ? computeMatchGap(job.text, profile) : null),
    [job, profile],
  );

  const prompt = useMemo(() => {
    if (!profile || !settings || !job) return '';
    const style = settings.promptStyle;
    if (promptType === 'resume') return buildResumePrompt(profile, job, style);
    if (promptType === 'coverLetter') return buildCoverLetterPrompt(profile, job, style);
    return question.trim() ? buildAnswerPrompt(profile, job, style, question) : '';
  }, [profile, settings, job, promptType, question]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const runReview = async () => {
    if (!profile) return;
    discardReview();
    if (promptType !== 'resume') {
      setReview(pasted.trim() ? { kind: 'text' } : { kind: 'rejected', errors: ['Nothing pasted yet.'] });
      return;
    }
    const result = importResumePaste(pasted, profile);
    if (!result.ok) {
      setReview({ kind: 'rejected', errors: result.errors });
      return;
    }
    setReview({ kind: 'resume', version: result.version, diff: result.diff });
    // Render immediately so the review includes seeing the actual page.
    const revision = reviewRevision.current;
    setBusy('Rendering preview…');
    try {
      const bytes = await renderResumePdf(result.version);
      if (reviewRevision.current !== revision) return;
      previewBytes.current = bytes;
      setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    } catch (err) {
      if (reviewRevision.current !== revision) return;
      setProblems([`Preview render failed: ${String(err).slice(0, 200)}`]);
    } finally {
      setBusy('');
    }
  };

  const approveResume = async () => {
    if (review?.kind !== 'resume' || !job || busy) return;
    const { version } = review;
    const revision = reviewRevision.current;
    setBusy('Validating ATS parseability…');
    try {
      const pdfBytes = previewBytes.current ?? (await renderResumePdf(version));
      const validation = await validateResumePdf(pdfBytes, version);
      if (reviewRevision.current !== revision) return;
      if (!validation.ok) {
        setProblems(validation.problems);
        return;
      }
      setBusy('Rendering DOCX…');
      const docxBytes = await renderResumeDocx(version);
      if (reviewRevision.current !== revision) return;
      await storeResumeVersion({ version, jobUrl: job.url, fallbackName: job.title, pdfBytes, docxBytes });
      discardReview();
      setPasted('');
      setVersions(await listVersions());
    } catch (err) {
      // Without this the rejection is unhandled and the button just goes idle,
      // leaving the user unsure whether the version was stored.
      setProblems([`Could not store this version: ${String(err).slice(0, 200)}`]);
    } finally {
      setBusy('');
    }
  };

  const approveText = async () => {
    if (review?.kind !== 'text' || !job || !profile) return;
    const text = pasted.trim();
    if (!text) return;

    // job.title is the page title ("Software Engineer Intern — Careers"), not
    // the employer. Derive the company from the ATS URL the way the tracker
    // does, and keep the page title only as a fallback.
    const company = companyFromUrl(job.url) || job.title;
    setProblems([]);

    if (promptType === 'answer') {
      // Generated answers live in the bank, jobless and NON-reusable by
      // default — flipping the flag is a deliberate act (anti-answer-bleed).
      try {
        await saveAnswer({ questionRaw: question.trim() || 'Custom answer', answer: text, jobId: '', company, reusable: false });
      } catch (err) {
        setProblems([`Could not save this answer: ${String(err).slice(0, 200)}`]);
        return;
      }
      discardReview();
      setPasted('');
      return;
    }

    setBusy('Rendering PDF…');
    try {
      await storeCoverLetter({ text, profile, company, jobUrl: job.url });
      discardReview();
      setPasted('');
      setVersions(await listVersions());
    } catch (err) {
      setProblems([`Could not store this cover letter: ${String(err).slice(0, 200)}`]);
    } finally {
      setBusy('');
    }
  };

  const setDefaultResume = async (record: VersionRecord) => {
    if (!profile || !record.pdfBlobId) return;
    await saveProfile({ ...profile, documents: { ...profile.documents, defaultResumeId: record.pdfBlobId } });
  };

  const updateTone = async (tone: string) => {
    if (!settings) return;
    await saveSettings({ ...settings, promptStyle: { ...settings.promptStyle, tone } });
  };

  if (state.tabId === null) return <div className="placeholder"><p>No active tab.</p></div>;

  return (
    <div className="generate-tab">
      <section>
        <h2 className="gen-h">1 · Scan the job posting</h2>
        <button className="primary" onClick={() => actions.extractJd(state.tabId!)}>
          {state.jd ? 'Rescan posting' : 'Scan this page'}
        </button>
        {state.jd && (
          <div className="hint" style={{ marginTop: 6 }}>
            Captured “{state.jd.title || 'untitled'}” — {state.jd.text.length.toLocaleString()} chars
          </div>
        )}
        {matchGap && (matchGap.coveredSkills.length > 0 || matchGap.missingTerms.length > 0) && (
          <div className="match-gap">
            {matchGap.coveredSkills.length > 0 && (
              <div className="gap-line">
                <span className="gap-label ok-text">Posting mentions your skills:</span>{' '}
                {matchGap.coveredSkills.join(', ')}
              </div>
            )}
            {matchGap.missingTerms.length > 0 && (
              <div className="gap-line">
                <span className="gap-label warn-text">Recurring terms your profile lacks:</span>{' '}
                {matchGap.missingTerms.join(', ')}
                <div className="hint">
                  Gaps to address in the tailored resume where honest — a list, not a score.
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {job && profile && settings && (
        <section>
          <h2 className="gen-h">2 · Build the prompt</h2>
          <div className="prompt-type-row">
            {(
              [
                ['resume', 'Tailored resume'],
                ['coverLetter', 'Cover letter'],
                ['answer', 'Custom answer'],
              ] as [PromptType, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={promptType === value ? 'primary' : ''}
                onClick={() => {
                  setPromptType(value);
                  discardReview();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {promptType === 'answer' && (
            <textarea
              className="paste-area"
              rows={2}
              placeholder="Paste the application question here…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          )}
          <label className="field" style={{ margin: '8px 0' }}>
            Writing tone
            <input value={settings.promptStyle.tone} onChange={(e) => void updateTone(e.target.value)} />
          </label>
          <div className="copy-row">
            <button className="primary" onClick={copyPrompt} disabled={!prompt}>
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer">Open claude.ai</a>
            <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Open ChatGPT</a>
          </div>
          <p className="hint">
            Paste it into your Claude or ChatGPT subscription — the strong models you already pay
            for do the writing, at zero API cost.
          </p>
        </section>
      )}

      {job && (
        <section>
          <h2 className="gen-h">3 · Paste the result back</h2>
          <textarea
            className="paste-area"
            rows={6}
            placeholder={
              promptType === 'resume'
                ? 'Paste the full reply (the ```json block) here…'
                : 'Paste the generated text here…'
            }
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              // A text review stands for "you read what is in the box", so
              // edits are what gets saved; a resume review is of parsed JSON
              // and must be redone once that JSON changes.
              if (promptType === 'resume') discardReview();
            }}
          />
          <button onClick={() => void runReview()} disabled={!pasted.trim() || !!busy}>
            {promptType === 'resume' ? 'Validate & review' : 'Review'}
          </button>

          {review?.kind === 'rejected' && (
            <div className="warn-box" style={{ marginTop: 8 }}>
              <div>
                <strong>Import rejected:</strong>
                <ul className="problem-list">
                  {review.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {review?.kind === 'resume' && (
            <ResumeReview
              version={review.version}
              diff={review.diff}
              busy={busy}
              problems={problems}
              previewUrl={previewUrl}
              onApprove={() => void approveResume()}
            />
          )}

          {review?.kind === 'text' && (
            <div style={{ marginTop: 8 }}>
              <p className="hint">Read it above — edits you make in the box are what gets saved.</p>
              <button className="primary" onClick={() => void approveText()} disabled={!!busy}>
                {busy ||
                  (promptType === 'answer' ? 'Save to answers bank' : 'Save + render PDF')}
              </button>
              {problems.length > 0 && (
                <div className="warn-box" style={{ marginTop: 8 }}>
                  <div>
                    <strong>Nothing was stored:</strong>
                    <ul className="problem-list">
                      {problems.map((problem, i) => (
                        <li key={i}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <VersionLibrary
        versions={versions}
        defaultResumeBlobId={profile?.documents.defaultResumeId ?? null}
        onSetDefault={(record) => void setDefaultResume(record)}
        onDelete={async (record) => {
          await deleteVersion(record.id);
          setVersions(await listVersions());
        }}
      />
    </div>
  );
}
