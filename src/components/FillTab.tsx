import { Fragment, useState } from 'react';
import { browser } from '#imports';
import type { PanelState } from '@hooks/useBackgroundPort';
import { useFillPlan, type FramePlan } from '@hooks/useFillPlan';
import { ATS_LABELS } from '@lib/fill/adapters/detect';
import { ALL_FIELD_KINDS, type FieldKind } from '@lib/schema/fieldKind';
import type { FillInstruction, PanelToBg, SerializedFile } from '@lib/messaging/protocol';
import type { ReviewRow } from '@lib/fill/resolver';
import { loadDocumentAsFile } from '@lib/storage/documents';

interface Actions {
  send(msg: PanelToBg): void;
  scan(tabId: number): void;
  execute(tabId: number, frameId: number, instructions: FillInstruction[], files?: SerializedFile[]): void;
  highlight(tabId: number, frameId: number, fieldId: string): void;
}

export function FillTab({ state, actions }: { state: PanelState; actions: Actions }) {
  const { profile, resume, plans, toggleInclude, editValue, editKind } = useFillPlan(state);
  const [filling, setFilling] = useState(false);
  const [enableHint, setEnableHint] = useState('');

  const { tabId, frames } = state;
  const frameEntries = [...frames.entries()].sort(([a], [b]) => a - b);
  const detected = frameEntries.find(([, f]) => f.atsId !== null)?.[1].atsId ?? null;

  if (tabId === null) {
    return <div className="placeholder"><p>No active tab.</p></div>;
  }

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
  onHover,
  onToggle,
  onValue,
  onKind,
}: {
  frameId: number;
  frameLabel: string | null;
  plan: FramePlan;
  fillResults: PanelState['fillResults'];
  onHover: (fieldId: string) => void;
  onToggle: (fieldId: string) => void;
  onValue: (fieldId: string, text: string) => void;
  onKind: (fieldId: string, kind: FieldKind) => void;
}) {
  const autoRows = plan.rows.filter((row) => !row.requiresReview);
  const reviewRows = plan.rows.filter((row) => row.requiresReview);

  return (
    <Fragment key={frameId}>
      {frameLabel && <div className="frame-header">{frameLabel}</div>}
      {autoRows.map((row) => (
        <RowView key={row.field.fieldId} row={row} result={fillResults.get(row.field.fieldId)} onHover={onHover} onToggle={onToggle} onValue={onValue} onKind={onKind} />
      ))}
      {reviewRows.length > 0 && <div className="frame-header">Needs your review</div>}
      {reviewRows.map((row) => (
        <RowView key={row.field.fieldId} row={row} result={fillResults.get(row.field.fieldId)} onHover={onHover} onToggle={onToggle} onValue={onValue} onKind={onKind} />
      ))}
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
  onHover,
  onToggle,
  onValue,
  onKind,
}: {
  row: ReviewRow;
  result?: { ok: boolean; error?: string };
  onHover: (fieldId: string) => void;
  onToggle: (fieldId: string) => void;
  onValue: (fieldId: string, text: string) => void;
  onKind: (fieldId: string, kind: FieldKind) => void;
}) {
  const fieldId = row.field.fieldId;
  const valueText = instructionDisplay(row);
  const fillable = row.instruction !== null;

  return (
    <div
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
