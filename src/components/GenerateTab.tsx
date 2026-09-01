import { useEffect, useMemo, useRef, useState } from 'react';
import type { PanelState } from '@hooks/useBackgroundPort';
import type { PanelToBg } from '@lib/messaging/protocol';
import type { Profile } from '@lib/schema/profile';
import { loadProfile, saveProfile, watchProfile } from '@lib/storage/profileStore';
import { loadSettings, saveSettings, type Settings } from '@lib/storage/settingsStore';
import {
  buildAnswerPrompt,
  buildCoverLetterPrompt,
  buildResumePrompt,
  type JobContext,
} from '@lib/prompts/promptStudio/builders';
import { importResumePaste, type ImportOutcome } from '@lib/generation/importResult';
import { renderResumePdf } from '@lib/generation/renderPdf';
import { renderResumeDocx } from '@lib/generation/renderDocx';
import { renderCoverLetterPdf } from '@lib/generation/renderCoverLetterPdf';
import { validateResumePdf } from '@lib/generation/validatePdf';
import {
  deleteVersion,
  listVersions,
  saveVersion,
  storeRenderedBlob,
  type VersionRecord,
} from '@lib/storage/versions';
import { getDb } from '@lib/storage/db';
import { computeMatchGap } from '@lib/memory/matchGap';
import { saveAnswer } from '@lib/memory/answers';
import { companyFromUrl } from '@lib/tracker/detect';

interface Actions {
  send(msg: PanelToBg): void;
  extractJd(tabId: number): void;
}

type PromptType = 'resume' | 'coverLetter' | 'answer';

export function GenerateTab({ state, actions }: { state: PanelState; actions: Actions }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [promptType, setPromptType] = useState<PromptType>('resume');
  const [question, setQuestion] = useState('');
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState('');
  const [renderProblems, setRenderProblems] = useState<string[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const previewBytes = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    void loadProfile().then(setProfile);
    void loadSettings().then(setSettings);
    void listVersions().then(setVersions);
    return watchProfile(setProfile);
  }, []);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const job: JobContext | null = state.jd
    ? { title: state.jd.title, text: state.jd.text, url: state.tabUrl }
    : null;

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

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    previewBytes.current = null;
  };

  const runImport = async () => {
    if (!profile) return;
    setRenderProblems([]);
    clearPreview();
    if (promptType === 'resume') {
      const result = importResumePaste(pasted, profile);
      setOutcome(result);
      if (result.ok) {
        // Render immediately so the review includes seeing the actual page.
        setBusy('Rendering preview…');
        try {
          const bytes = await renderResumePdf(result.version);
          previewBytes.current = bytes;
          setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
        } catch (err) {
          setRenderProblems([`Preview render failed: ${String(err).slice(0, 200)}`]);
        } finally {
          setBusy('');
        }
      }
    } else {
      const text = pasted.trim();
      setOutcome(
        text
          ? { ok: true, version: null as never, diff: null as never }
          : { ok: false, errors: ['Nothing pasted yet.'] },
      );
    }
  };

  const approveResume = async () => {
    if (!outcome?.ok || !job || promptType !== 'resume') return;
    const version = outcome.version;
    setBusy('Validating ATS parseability…');
    try {
      const pdfBytes = previewBytes.current ?? (await renderResumePdf(version));
      const validation = await validateResumePdf(pdfBytes, version);
      if (!validation.ok) {
        setRenderProblems(validation.problems);
        return;
      }
      setBusy('Rendering DOCX…');
      const docxBytes = await renderResumeDocx(version);

      const baseName = fileBaseName(version.meta.company || job.title || 'resume');
      const pdfBlobId = await storeRenderedBlob(`${baseName}.pdf`, 'application/pdf', pdfBytes);
      const docxBlobId = await storeRenderedBlob(
        `${baseName}.docx`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBytes,
      );
      await saveVersion({
        kind: 'resume',
        label: version.meta.label || version.meta.role || baseName,
        company: version.meta.company,
        jobUrl: job.url,
        data: version,
        pdfBlobId,
        docxBlobId,
      });
      setOutcome(null);
      setPasted('');
      clearPreview();
      setVersions(await listVersions());
    } finally {
      setBusy('');
    }
  };

  const approveText = async () => {
    if (!job || !profile || promptType === 'resume') return;
    const text = pasted.trim();
    if (!text) return;

    // job.title is the page title ("Software Engineer Intern — Careers"), not
    // the employer. Derive the company from the ATS URL the way the tracker
    // does, and keep the page title only as a fallback.
    const company = companyFromUrl(job.url).company || job.title;

    if (promptType === 'answer') {
      // Generated answers live in the bank, jobless and NON-reusable by
      // default — flipping the flag is a deliberate act (anti-answer-bleed).
      await saveAnswer({
        questionRaw: question.trim() || 'Custom answer',
        answer: text,
        jobId: '',
        company,
        reusable: false,
      });
      setOutcome(null);
      setPasted('');
      return;
    }

    // Cover letter: store text + a rendered PDF twin.
    setBusy('Rendering PDF…');
    try {
      const basics = profile.basics;
      const contactLine = [
        [basics.location.city, basics.location.state].filter(Boolean).join(', '),
        basics.email,
        basics.phone,
      ]
        .filter(Boolean)
        .join('  |  ');
      const pdfBytes = await renderCoverLetterPdf({
        name: `${basics.firstName} ${basics.lastName}`.trim() || 'Cover letter',
        contactLine,
        company,
        date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        body: text,
      });
      const pdfBlobId = await storeRenderedBlob(
        `${fileBaseName(company || 'cover-letter')}-cover-letter.pdf`,
        'application/pdf',
        pdfBytes,
      );
      await saveVersion({
        kind: 'coverLetter',
        label: 'Cover letter',
        company,
        jobUrl: job.url,
        data: { text },
        pdfBlobId,
      });
      setOutcome(null);
      setPasted('');
      setVersions(await listVersions());
    } finally {
      setBusy('');
    }
  };

  const setDefaultResume = async (record: VersionRecord) => {
    if (!profile || !record.pdfBlobId) return;
    await saveProfile({
      ...profile,
      documents: { ...profile.documents, defaultResumeId: record.pdfBlobId },
    });
  };

  const updateTone = async (tone: string) => {
    if (!settings) return;
    const next = { ...settings, promptStyle: { ...settings.promptStyle, tone } };
    setSettings(next);
    await saveSettings(next);
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
                  setOutcome(null);
                  clearPreview();
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
            onChange={(e) => setPasted(e.target.value)}
          />
          <button onClick={() => void runImport()} disabled={!pasted.trim() || !!busy}>
            {promptType === 'resume' ? 'Validate & review' : 'Review'}
          </button>

          {outcome && !outcome.ok && (
            <div className="warn-box" style={{ marginTop: 8 }}>
              <div>
                <strong>Import rejected:</strong>
                <ul className="problem-list">
                  {outcome.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {outcome?.ok && promptType === 'resume' && (
            <ResumeReview
              outcome={outcome}
              busy={busy}
              problems={renderProblems}
              previewUrl={previewUrl}
              onApprove={() => void approveResume()}
            />
          )}

          {outcome?.ok && promptType !== 'resume' && (
            <div style={{ marginTop: 8 }}>
              <p className="hint">Read it above — edits you make in the box are what gets saved.</p>
              <button className="primary" onClick={() => void approveText()} disabled={!!busy}>
                {busy ||
                  (promptType === 'answer' ? 'Save to answers bank' : 'Save + render PDF')}
              </button>
            </div>
          )}
        </section>
      )}

      {versions.length > 0 && (
        <section>
          <h2 className="gen-h">Version library</h2>
          {versions.map((record) => (
            <VersionRow
              key={record.id}
              record={record}
              isDefault={profile?.documents.defaultResumeId === record.pdfBlobId && !!record.pdfBlobId}
              onSetDefault={() => void setDefaultResume(record)}
              onDelete={async () => {
                await deleteVersion(record.id);
                setVersions(await listVersions());
              }}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function ResumeReview({
  outcome,
  busy,
  problems,
  previewUrl,
  onApprove,
}: {
  outcome: Extract<ImportOutcome, { ok: true }>;
  busy: string;
  problems: string[];
  previewUrl: string;
  onApprove: () => void;
}) {
  const { version, diff } = outcome;
  const rewritten = [...diff.known.entries()].filter(([, kept]) => !kept).map(([text]) => text);

  return (
    <div className="resume-review">
      <div className="hint" style={{ margin: '8px 0 4px' }}>
        {version.experience.length} positions · {diff.keptCount} bullets kept verbatim ·{' '}
        {diff.rewrittenCount} rewritten
      </div>
      {rewritten.length > 0 && (
        <div className="diff-box">
          <div className="diff-title">Rewritten bullets — read each one, this is where models invent things:</div>
          <ul className="problem-list">
            {rewritten.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {previewUrl && (
        <iframe className="pdf-preview" src={previewUrl} title="Resume preview" />
      )}
      {problems.length > 0 && (
        <div className="warn-box" style={{ marginTop: 8 }}>
          <div>
            <strong>Validation failed — version not stored:</strong>
            <ul className="problem-list">
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <button className="primary" style={{ marginTop: 8 }} onClick={onApprove} disabled={!!busy}>
        {busy || 'Approve → validate + store PDF & DOCX'}
      </button>
    </div>
  );
}

function VersionRow({
  record,
  isDefault,
  onSetDefault,
  onDelete,
}: {
  record: VersionRecord;
  isDefault: boolean;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="version-row">
      <div className="version-main">
        <span className="field-label">{record.label}</span>
        <span className="hint">
          {record.company} · {new Date(record.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="field-meta">
        {record.pdfBlobId && <button onClick={() => void openBlob(record.pdfBlobId!)}>Preview</button>}
        {record.pdfBlobId && <button onClick={() => void downloadBlob(record.pdfBlobId!)}>PDF</button>}
        {record.docxBlobId && <button onClick={() => void downloadBlob(record.docxBlobId!)}>DOCX</button>}
        {record.kind === 'coverLetter' && (
          <button onClick={() => void navigator.clipboard.writeText((record.data as { text: string }).text)}>
            Copy text
          </button>
        )}
        {record.pdfBlobId &&
          record.kind === 'resume' &&
          (isDefault ? (
            <span className="chip ok">default</span>
          ) : (
            <button onClick={onSetDefault}>Set default</button>
          ))}
        <button className="entry-remove" onClick={onDelete}>
          ✕
        </button>
      </div>
    </div>
  );
}

async function blobUrlFor(blobId: string): Promise<{ url: string; name: string } | null> {
  const db = await getDb();
  const doc = await db.get('blobs', blobId);
  if (!doc) return null;
  return { url: URL.createObjectURL(new Blob([doc.bytes], { type: doc.type })), name: doc.name };
}

/**
 * Object URLs handed to the browser (a new tab, a download) must outlive the
 * call: revoking synchronously after click()/open() races the fetch and can
 * produce an empty tab or a cancelled download. Revoke on a timer instead —
 * long enough for the browser to have read the blob, short enough not to pin
 * a resume-sized buffer in memory.
 */
const OBJECT_URL_TTL_MS = 60_000;

function revokeLater(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS);
}

async function openBlob(blobId: string): Promise<void> {
  const found = await blobUrlFor(blobId);
  if (!found) return;
  window.open(found.url, '_blank');
  revokeLater(found.url);
}

async function downloadBlob(blobId: string): Promise<void> {
  const found = await blobUrlFor(blobId);
  if (!found) return;
  const a = document.createElement('a');
  a.href = found.url;
  a.download = found.name;
  a.click();
  revokeLater(found.url);
}

function fileBaseName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return cleaned || 'resume';
}
