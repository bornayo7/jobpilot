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
import { prepareCoverLetter, storePreparedVersion, storeResumeVersion } from '@lib/generation/storeVersion';
import { deleteVersion, listVersions, type VersionRecord } from '@lib/storage/versions';
import { computeMatchGap } from '@lib/memory/matchGap';
import { saveAnswer } from '@lib/memory/answers';
import { companyFromUrl } from '@lib/tracker/detect';
import { ResumeReview } from './ResumeReview';
import { VersionLibrary } from './VersionLibrary';
import { useCollection } from './useCollection';
import { useGenerationDraft } from './useGenerationDraft';
import { DocumentInUseError } from '@lib/storage/documents';
import { applicationId } from '@lib/tracker/applicationId';

type PromptType = 'resume' | 'coverLetter' | 'answer';

/** What the Review step established about the pasted text. */
type Review =
  | { kind: 'rejected'; errors: string[] }
  | { kind: 'resume'; version: ResumeVersion; diff: BulletDiff }
  | { kind: 'text' };

export function GenerateTab({ state, actions }: { state: PanelState; actions: Pick<PanelActions, 'extractJd'> }) {
  const { profile, snapshot, save: saveProfile, error: profileError } = useProfile();
  const { settings, patch: patchSettings, error: settingsError } = useSettings();
  const draft = useGenerationDraft(state.tabUrl, snapshot?.id ?? null);
  const { promptType, question, pasted } = draft.value;
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const { items: versions, error: versionsError, refresh: refreshVersions } = useCollection(listVersions);
  const [notice, setNotice] = useState('');
  const [tone, setTone] = useState('');
  const [toneDirty, setToneDirty] = useState(false);
  const [toneSaving, setToneSaving] = useState(false);
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
    setBusy('');
    previewBytes.current = null;
  };

  const context = JSON.stringify([state.tabId, state.tabUrl, snapshot?.id, snapshot?.revision, state.jd?.text, draft.id, promptType, question, pasted]);
  const liveContext = useRef(context);
  if (liveContext.current !== context) { liveContext.current = context; reviewRevision.current++; }
  useEffect(discardReview, [context]);
  useEffect(() => () => { reviewRevision.current++; }, []);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => { if (settings && !toneDirty) setTone(settings.promptStyle.tone); }, [settings, toneDirty]);

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
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) { setNotice(`Prompt could not be copied. ${String(err)}`); }
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
      const { renderResumePdf } = await import('@lib/generation/renderPdf');
      const bytes = await renderResumePdf(result.version);
      if (reviewRevision.current !== revision) return;
      previewBytes.current = bytes;
      setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    } catch (err) {
      if (reviewRevision.current !== revision) return;
      setProblems([`Preview render failed: ${String(err).slice(0, 200)}`]);
    } finally {
      if (reviewRevision.current === revision) setBusy('');
    }
  };

  const approveResume = async () => {
    if (review?.kind !== 'resume' || !job || busy) return;
    const { version } = review;
    const revision = reviewRevision.current;
    setBusy('Validating ATS parseability…');
    try {
      const [{ renderResumePdf }, { validateResumePdf }] = await Promise.all([import('@lib/generation/renderPdf'), import('@lib/generation/validatePdf')]);
      const pdfBytes = previewBytes.current ?? (await renderResumePdf(version));
      const validation = await validateResumePdf(pdfBytes, version);
      if (reviewRevision.current !== revision) return;
      if (!validation.ok) {
        setProblems(validation.problems);
        return;
      }
      setBusy('Rendering DOCX…');
      const { renderResumeDocx } = await import('@lib/generation/renderDocx');
      const docxBytes = await renderResumeDocx(version);
      if (reviewRevision.current !== revision) return;
      await storeResumeVersion({ version, jobUrl: job.url, fallbackName: job.title, pdfBytes, docxBytes, profileId: snapshot?.id, profileRevision: snapshot?.revision });
      await refreshVersions();
      if (reviewRevision.current !== revision) return;
      discardReview();
      draft.change({ pasted: '' });
      setNotice(`Resume saved for ${version.meta.company || job.title}.`);
    } catch (err) {
      // Without this the rejection is unhandled and the button just goes idle,
      // leaving the user unsure whether the version was stored.
      if (reviewRevision.current === revision) setProblems([`Could not store this version: ${String(err).slice(0, 200)}`]);
    } finally {
      if (reviewRevision.current === revision) setBusy('');
    }
  };

  const approveText = async () => {
    if (review?.kind !== 'text' || !job || !profile || busy) return;
    const text = pasted.trim();
    if (!text) return;

    // job.title is the page title ("Software Engineer Intern — Careers"), not
    // the employer. Derive the company from the ATS URL the way the tracker
    // does, and keep the page title only as a fallback.
    const company = companyFromUrl(job.url) || job.title;
    const revision = reviewRevision.current;
    setProblems([]);

    if (promptType === 'answer') {
      // Generated answers live in the bank, jobless and NON-reusable by
      // default — flipping the flag is a deliberate act (anti-answer-bleed).
      try {
        setBusy('Saving answer…');
        await saveAnswer({ questionRaw: question.trim() || 'Custom answer', answer: text, jobId: '', company, reusable: false, origin: 'generated', applicationId: applicationId(job.url) ?? undefined, profileId: snapshot?.id, profileRevision: snapshot?.revision });
        if (reviewRevision.current !== revision) return;
        discardReview();
        draft.change({ pasted: '' });
        setNotice('Answer saved for review in the answers bank.');
      } catch (err) {
        if (reviewRevision.current === revision) setProblems([`Could not save this answer: ${String(err).slice(0, 200)}`]);
      } finally { if (reviewRevision.current === revision) setBusy(''); }
      return;
    }

    setBusy('Rendering PDF…');
    try {
      const prepared = await prepareCoverLetter({ text, profile, company, jobUrl: job.url, profileId: snapshot?.id, profileRevision: snapshot?.revision });
      if (reviewRevision.current !== revision) return;
      await storePreparedVersion(prepared);
      await refreshVersions();
      if (reviewRevision.current !== revision) return;
      discardReview();
      draft.change({ pasted: '' });
      setNotice(`Cover letter saved for ${company}.`);
    } catch (err) {
      if (reviewRevision.current === revision) setProblems([`Could not store this cover letter: ${String(err).slice(0, 200)}`]);
    } finally {
      if (reviewRevision.current === revision) setBusy('');
    }
  };

  const setDefaultResume = async (record: VersionRecord) => {
    if (!profile || !record.pdfBlobId) return;
    try { await saveProfile({ ...profile, documents: { ...profile.documents, defaultResumeId: record.pdfBlobId } }); setNotice(`${record.label} is now the default resume for ${snapshot?.name || 'this profile'}.`); }
    catch (err) { setNotice(`Default resume was not changed. ${String(err)}`); }
  };

  const saveTone = async () => {
    if (!settings || !toneDirty || toneSaving) return;
    setToneSaving(true);
    try { await patchSettings({ promptStyle: { tone } }); setToneDirty(false); }
    catch (err) { setNotice(`Writing tone was not saved. ${String(err)}`); }
    finally { setToneSaving(false); }
  };

  if (state.tabId === null) return <div className="placeholder"><p>No active tab.</p></div>;

  return (
    <div className="generate-tab">
      {(notice || profileError || settingsError || versionsError) && <p className="notice" role="status">{notice || profileError || settingsError || versionsError}</p>}
      {draft.error && <div className="warn-box" role="alert">{draft.error}<button onClick={() => void draft.reload()}>Reload saved draft</button></div>}
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
                disabled={draft.loading}
                className={promptType === value ? 'primary' : ''}
                onClick={() => {
                  draft.change({ promptType: value });
                  discardReview();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {promptType === 'answer' && (
            <textarea
              aria-label="Application question"
              disabled={draft.loading}
              className="paste-area"
              rows={2}
              placeholder="Paste the application question here…"
              value={question}
              onChange={(e) => { draft.change({ question: e.target.value }); discardReview(); }}
            />
          )}
          <label className="field" style={{ margin: '8px 0' }}>
            Writing tone
            <input disabled={toneSaving} value={tone} onChange={(e) => { setTone(e.target.value); setToneDirty(true); }} onBlur={() => void saveTone()} />
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
            aria-label="Generated result"
            disabled={draft.loading}
            className="paste-area"
            rows={6}
            placeholder={
              promptType === 'resume'
                ? 'Paste the full reply (the ```json block) here…'
                : 'Paste the generated text here…'
            }
            value={pasted}
            onChange={(e) => {
              draft.change({ pasted: e.target.value });
              discardReview();
            }}
          />
          <p className="hint" role="status">{draft.loading ? 'Loading this application’s draft…' : draft.saving ? 'Saving draft…' : draft.error ? 'Draft needs attention' : 'Draft saved on this device for this application and profile.'}</p>
          <button onClick={() => void runReview()} disabled={draft.loading || !pasted.trim() || !!busy}>
            {promptType === 'resume' ? 'Validate & review' : 'Review'}
          </button>

          {review?.kind === 'rejected' && (
            <div className="warn-box" role="alert" style={{ marginTop: 8 }}>
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
              <p className="hint">Review the text above. Editing it starts a fresh review.</p>
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
        onSetDefault={setDefaultResume}
        onDelete={async (record) => {
          try {
            try { await deleteVersion(record.id); }
            catch (err) {
              if (!(err instanceof DocumentInUseError)) throw err;
              if (!confirm(`This version is selected by ${err.references.map((ref) => ref.profileName).join(', ')}. Delete it and clear those selections?`)) return;
              await deleteVersion(record.id, { clearDefaults: true });
            }
            await refreshVersions(); setNotice('Version deleted.');
          } catch (err) { setNotice(`Version was not deleted. ${String(err)}`); }
        }}
      />
    </div>
  );
}
