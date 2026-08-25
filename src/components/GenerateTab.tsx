import { useEffect, useMemo, useState } from 'react';
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
import { validateResumePdf } from '@lib/generation/validatePdf';
import {
  deleteVersion,
  listVersions,
  saveVersion,
  storeRenderedBlob,
  type VersionRecord,
} from '@lib/storage/versions';
import { getDb } from '@lib/storage/db';

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

  useEffect(() => {
    void loadProfile().then(setProfile);
    void loadSettings().then(setSettings);
    void listVersions().then(setVersions);
    return watchProfile(setProfile);
  }, []);

  const job: JobContext | null = state.jd
    ? { title: state.jd.title, text: state.jd.text, url: state.tabUrl }
    : null;

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

  const runImport = () => {
    if (!profile) return;
    setRenderProblems([]);
    if (promptType === 'resume') {
      setOutcome(importResumePaste(pasted, profile));
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
    setBusy('Rendering PDF…');
    try {
      const pdfBytes = await renderResumePdf(version);
      setBusy('Validating ATS parseability…');
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
      setVersions(await listVersions());
    } finally {
      setBusy('');
    }
  };

  const approveText = async () => {
    if (!job || promptType === 'resume') return;
    const text = pasted.trim();
    if (!text) return;
    await saveVersion({
      kind: 'coverLetter',
      label: promptType === 'coverLetter' ? 'Cover letter' : `Answer: ${question.slice(0, 48)}`,
      company: job.title,
      jobUrl: job.url,
      data: { text },
    });
    setOutcome(null);
    setPasted('');
    setVersions(await listVersions());
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
          <button onClick={runImport} disabled={!pasted.trim()}>
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
            <ResumeReview outcome={outcome} busy={busy} problems={renderProblems} onApprove={approveResume} />
          )}

          {outcome?.ok && promptType !== 'resume' && (
            <div style={{ marginTop: 8 }}>
              <p className="hint">Read it above — edits you make in the box are what gets saved.</p>
              <button className="primary" onClick={approveText}>
                Save to library
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
  onApprove,
}: {
  outcome: Extract<ImportOutcome, { ok: true }>;
  busy: string;
  problems: string[];
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
        {busy || 'Approve → render PDF + DOCX'}
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
        {record.pdfBlobId && <button onClick={() => void downloadBlob(record.pdfBlobId!)}>PDF</button>}
        {record.docxBlobId && <button onClick={() => void downloadBlob(record.docxBlobId!)}>DOCX</button>}
        {record.kind === 'coverLetter' && (
          <button onClick={() => void navigator.clipboard.writeText((record.data as { text: string }).text)}>
            Copy text
          </button>
        )}
        {record.pdfBlobId &&
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

async function downloadBlob(blobId: string): Promise<void> {
  const db = await getDb();
  const doc = await db.get('blobs', blobId);
  if (!doc) return;
  const url = URL.createObjectURL(new Blob([doc.bytes], { type: doc.type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.name;
  a.click();
  URL.revokeObjectURL(url);
}

function fileBaseName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return cleaned || 'resume';
}
