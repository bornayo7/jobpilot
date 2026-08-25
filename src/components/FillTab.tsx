import { Fragment, useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import type { PanelState } from '@hooks/useBackgroundPort';
import { useFillPlan, type FramePlan } from '@hooks/useFillPlan';
import { ATS_LABELS } from '@lib/fill/adapters/detect';
import { ALL_FIELD_KINDS, type FieldKind } from '@lib/schema/fieldKind';
import type { FillInstruction, PanelToBg, SerializedFile } from '@lib/messaging/protocol';
import type { ReviewRow } from '@lib/fill/resolver';
import { loadDocumentAsFile } from '@lib/storage/documents';
import { checkDealbreakers, type DealbreakerWarning } from '@lib/memory/dealbreakers';
import { listAnswers, rankAnswers, type AnswerRecord } from '@lib/memory/answers';
import { companyFromUrl } from '@lib/tracker/detect';
import { findPreviousApplications, listJobs, type TrackerJob } from '@lib/tracker/store';

interface Actions {
  send(msg: PanelToBg): void;
  scan(tabId: number): void;
  execute(tabId: number, frameId: number, instructions: FillInstruction[], files?: SerializedFile[]): void;
  highlight(tabId: number, frameId: number, fieldId: string): void;
  extractJd(tabId: number): void;
}

export function FillTab({ state, actions }: { state: PanelState; actions: Actions }) {
  const { profile, settings, resume, plans, toggleInclude, editValue, editKind } = useFillPlan(state);
  const [filling, setFilling] = useState(false);
  const [enableHint, setEnableHint] = useState('');
  const [answerBank, setAnswerBank] = useState<AnswerRecord[]>([]);
  const [previousApps, setPreviousApps] = useState<TrackerJob[]>([]);
  const jdRequestedFor = useRef<number | null>(null);

  const { tabId, frames } = state;
  const frameEntries = [...frames.entries()].sort(([a], [b]) => a - b);
  const detected = frameEntries.find(([, f]) => f.atsId !== null)?.[1].atsId ?? null;

  useEffect(() => {
    void listAnswers().then(setAnswerBank);
  }, []);

  // Auto-extract the JD once per tab: powers dealbreaker warnings here and
  // pre-fills the Generate tab's scan step.
  useEffect(() => {
    if (tabId === null || state.jd !== null || frameEntries.length === 0) return;
    if (jdRequestedFor.current === tabId) return;
    jdRequestedFor.current = tabId;
    actions.extractJd(tabId);
  }, [tabId, state.jd, frameEntries.length, actions]);

  // Duplicate-application guard: have you applied to this company before?
  useEffect(() => {
    const { company } = companyFromUrl(state.tabUrl);
    if (!company) {
      setPreviousApps([]);
      return;
    }
    void listJobs().then((jobs) => setPreviousApps(findPreviousApplications(jobs, company)));
  }, [state.tabUrl]);

  // Right-click "fix this field" → scroll the matching row into view.
  useEffect(() => {
    if (!state.focusField) return;
    const el = document.getElementById(`row-${state.focusField.fieldId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      const timer = setTimeout(() => el.classList.remove('flash'), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.focusField]);

  if (tabId === null) {
    return <div className="placeholder"><p>No active tab.</p></div>;
  }

  const dealbreakers: DealbreakerWarning[] =
    state.jd && settings ? checkDealbreakers(state.jd.text, settings) : [];

  const profileReady = !!profile && (!!profile.basics.email || !!profile.basics.firstName);
  const includedCount = [...plans.values()].reduce(
    (n, plan) => n + plan.rows.filter((row) => row.include && row.instruction).length,
    0,
  );
  const resolving = [...plans.values()].some((plan) => plan.resolving);

  const fillAll = async () => {
    setFilling(true);
    try {
      for (const [frameId, plan] of plans) {
        const instructions = plan.rows
          .filter((row) => row.include && row.instruction)
          .map((row) => row.instruction!);
        if (instructions.length === 0) continue;
        const files = await collectFiles(instructions);
        actions.execute(tabId, frameId, instructions, files);
      }
    } finally {
      setFilling(false);
    }
  };

  const enableSite = async () => {
    // activeTab (granted by opening the panel from the toolbar) exposes the url.
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      setEnableHint('Open the job page, then click the JobPilot toolbar icon and try again.');
      return;
    }
    const origin = new URL(tab.url).origin;
    const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      setEnableHint('Permission declined — JobPilot cannot see this site without it.');
      return;
    }
    actions.send({ t: 'panel/registerSite', origin, tabId });
    setEnableHint(`Enabled on ${origin} — reloading the page…`);
  };

  return (
    <div className="fill-tab">
      <div className="status-row">
        {detected ? (
          <span className="badge ats">{ATS_LABELS[detected]} detected</span>
        ) : frameEntries.length > 0 ? (
          <span className="badge">Generic site</span>
        ) : (
          <span className="badge muted">Not enabled on this site</span>
        )}
        <button onClick={() => actions.scan(tabId)} disabled={frameEntries.length === 0}>
          Rescan
        </button>
      </div>

      {state.tabUrl && <div className="url" title={state.tabUrl}>{state.tabUrl}</div>}

      {previousApps.length > 0 && (
        <div className="warn-box">
          You already applied to {previousApps[0]!.company} on{' '}
          {new Date(previousApps[0]!.createdAt).toLocaleDateString()}
          {previousApps[0]!.title ? ` (${previousApps[0]!.title})` : ''}
          {previousApps.length > 1 ? ` — and ${previousApps.length - 1} more time(s)` : ''}. Check the
          Tracker tab before re-applying.
        </div>
      )}

      {dealbreakers.map((warning) => (
        <div className="warn-box" key={warning.id}>
          <div>
            <strong>⚠ {warning.message}.</strong>
            {warning.excerpt && <div className="hint">“{warning.excerpt}”</div>}
          </div>
        </div>
      ))}

      {frameEntries.length === 0 && (
        <div className="enable-site">
          <p className="hint">
            JobPilot runs automatically on the major ATS platforms (Greenhouse, Lever, Ashby,
            Workday, iCIMS, SmartRecruiters). For a company's own careers site, enable it once:
          </p>
          <button className="primary" onClick={enableSite}>Enable JobPilot on this site</button>
          {enableHint && <p className="hint">{enableHint}</p>}
        </div>
      )}

      {!profileReady && frameEntries.length > 0 && (
        <div className="warn-box">
          Your profile is empty — nothing to fill with.{' '}
          <button onClick={() => browser.runtime.openOptionsPage()}>Set up profile</button>
        </div>
      )}

      {profileReady && frameEntries.length > 0 && !resume && (
        <div className="warn-box">
          No default resume uploaded — file uploads will be skipped.{' '}
          <button onClick={() => browser.runtime.openOptionsPage()}>Upload resume</button>
        </div>
      )}

      {resolving && <div className="hint">Matching fields…</div>}

      {frameEntries.map(([frameId, frame]) => {
        const plan = plans.get(frameId);
        if (!plan || plan.rows.length + plan.unmatched.length === 0) return null;
        return (
          <FramePlanView
            key={frameId}
            frameId={frameId}
            frameLabel={frameEntries.length > 1 ? `frame ${frameId}${frame.atsId ? ` · ${ATS_LABELS[frame.atsId]}` : ''}` : null}
            plan={plan}
            fillResults={state.fillResults}
            answerBank={answerBank}
            onHover={(fieldId) => actions.highlight(tabId, frameId, fieldId)}
            onToggle={(fieldId) => toggleInclude(frameId, fieldId)}
            onValue={(fieldId, text) => editValue(frameId, fieldId, text)}
            onKind={(fieldId, kind) => editKind(frameId, fieldId, kind)}
          />
        );
      })}

      {includedCount > 0 && (
        <div className="save-bar">
          <button className="primary" onClick={fillAll} disabled={filling}>
            {filling ? 'Filling…' : `Fill ${includedCount} field${includedCount === 1 ? '' : 's'}`}
          </button>
          <span className="hint" style={{ alignSelf: 'center' }}>
            You review and click Submit yourself — always.
          </span>
        </div>
      )}
    </div>
  );
}

async function collectFiles(instructions: FillInstruction[]): Promise<SerializedFile[] | undefined> {
  const blobKeys = new Set<string>();
  for (const instruction of instructions) {
    if (instruction.action === 'attachFile' && typeof instruction.value === 'object') {
      blobKeys.add(instruction.value.blobKey);
    }
  }
  if (blobKeys.size === 0) return undefined;
  const files: SerializedFile[] = [];
  for (const key of blobKeys) {
    const file = await loadDocumentAsFile(key);
    if (file) files.push(file);
  }
  return files;
}

function FramePlanView({
  frameId,
  frameLabel,
  plan,
  fillResults,
  answerBank,
  onHover,
  onToggle,
  onValue,
  onKind,
}: {
  frameId: number;
  frameLabel: string | null;
  plan: FramePlan;
  fillResults: PanelState['fillResults'];
  answerBank: AnswerRecord[];
  onHover: (fieldId: string) => void;
  onToggle: (fieldId: string) => void;
  onValue: (fieldId: string, text: string) => void;
  onKind: (fieldId: string, kind: FieldKind) => void;
}) {
  const autoRows = plan.rows.filter((row) => !row.requiresReview);
  const reviewRows = plan.rows.filter((row) => row.requiresReview);

  const renderRow = (row: ReviewRow) => (
    <RowView
      key={row.field.fieldId}
      row={row}
      result={fillResults.get(row.field.fieldId)}
      answerBank={answerBank}
      onHover={onHover}
      onToggle={onToggle}
      onValue={onValue}
      onKind={onKind}
    />
  );

  return (
    <Fragment key={frameId}>
      {frameLabel && <div className="frame-header">{frameLabel}</div>}
      {autoRows.map(renderRow)}
      {reviewRows.length > 0 && <div className="frame-header">Needs your review</div>}
      {reviewRows.map(renderRow)}
      {plan.unmatched.length > 0 && (
        <>
          <div className="frame-header">Unrecognized (fill by hand)</div>
          {plan.unmatched.map((field) => (
            <div className="field-row unmatched" key={field.fieldId} onMouseEnter={() => onHover(field.fieldId)}>
              <div className="field-main">
                <span className="field-label">{field.label || field.name || '(unlabeled)'}</span>
              </div>
              <div className="field-meta">
                <span className="chip">{field.control}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </Fragment>
  );
}

function RowView({
  row,
  result,
  answerBank,
  onHover,
  onToggle,
  onValue,
  onKind,
}: {
  row: ReviewRow;
  result?: { ok: boolean; error?: string };
  answerBank: AnswerRecord[];
  onHover: (fieldId: string) => void;
  onToggle: (fieldId: string) => void;
  onValue: (fieldId: string, text: string) => void;
  onKind: (fieldId: string, kind: FieldKind) => void;
}) {
  const fieldId = row.field.fieldId;
  const valueText = instructionDisplay(row);
  const fillable = row.instruction !== null;
  const isQuestion = row.kind === 'question.freeText' || row.kind === 'question.choice';
  const suggestions = isQuestion
    ? rankAnswers(row.field.label || row.field.ariaLabel || '', answerBank, '')
    : [];

  return (
    <div
      id={`row-${fieldId}`}
      className={`review-row${row.sensitive ? ' sensitive' : ''}${row.include ? '' : ' excluded'}`}
      onMouseEnter={() => onHover(fieldId)}
    >
      <div className="review-top">
        <label className="include">
          <input type="checkbox" checked={row.include} disabled={!fillable} onChange={() => onToggle(fieldId)} />
          <span className="field-label" title={row.field.label}>
            {row.field.label || row.field.name || '(unlabeled)'}
          </span>
          {row.field.required && <span className="req">*</span>}
        </label>
        <div className="field-meta">
          <span className={`chip source-${row.source}`}>{row.source}</span>
          {row.sensitive && <span className="chip warn">verify</span>}
          {result && (
            <span className={result.ok ? 'chip ok' : 'chip fail'} title={result.error}>
              {result.ok ? '✓ filled' : `✗ ${result.error ?? 'failed'}`}
            </span>
          )}
        </div>
      </div>
      <div className="review-controls">
        {row.field.control === 'file' || row.instruction?.action === 'attachFile' ? (
          <span className="value-static">{valueText || 'no file'}</span>
        ) : row.field.control === 'checkbox' ? (
          <select
            value={valueText === 'checked' ? 'checked' : 'unchecked'}
            onChange={(e) => onValue(fieldId, e.target.value === 'checked' ? 'yes' : 'no')}
          >
            <option value="checked">checked</option>
            <option value="unchecked">unchecked</option>
          </select>
        ) : row.field.control === 'select' && row.field.options ? (
          <select
            value={typeof row.instruction?.value === 'string' ? row.instruction.value : ''}
            onChange={(e) => onValue(fieldId, e.target.value)}
          >
            <option value="">(leave blank)</option>
            {row.field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : isQuestion ? (
          <textarea
            className="paste-area"
            rows={2}
            value={valueText}
            placeholder="(type an answer, or use a saved one below)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        ) : (
          <input
            value={valueText}
            placeholder="(no value — type to fill)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        )}
        <select className="kind-select" value={row.kind} onChange={(e) => onKind(fieldId, e.target.value as FieldKind)}>
          {ALL_FIELD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>
      {suggestions.length > 0 && (
        <div className="suggestion-row">
          {suggestions.map(({ record, score }) => (
            <button
              key={record.id}
              className="suggestion"
              title={record.answer}
              onClick={() => onValue(fieldId, record.answer)}
            >
              ↳ {Math.round(score * 100)}% · {record.company || 'saved'} · {record.answer.slice(0, 44)}…
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function instructionDisplay(row: ReviewRow): string {
  const value = row.instruction?.value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'checked' : 'unchecked';
  if (typeof value === 'object') return value.filename;
  return value;
}
