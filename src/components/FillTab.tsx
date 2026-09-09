import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import type { PanelActions, PanelState } from '@hooks/useBackgroundPort';
import { useFillPlan } from '@hooks/useFillPlan';
import { ATS_LABELS } from '@lib/fill/adapters/detect';
import type { FillInstruction, SerializedFile } from '@lib/messaging/protocol';
import { loadDocumentAsFile } from '@lib/storage/documents';
import { checkDealbreakers, type DealbreakerWarning } from '@lib/memory/dealbreakers';
import { listAnswers, type AnswerRecord } from '@lib/memory/answers';
import { companyFromUrl } from '@lib/tracker/detect';
import { findPreviousApplications, listJobs, type TrackerJob } from '@lib/tracker/store';
import { FramePlanView } from './FramePlanView';
import { watchCollections } from '@lib/storage/coordination';
import { applicationId } from '@lib/tracker/applicationId';
import { enableCurrentSite } from '@lib/content/registerSite';

export function FillTab({ state, actions }: { state: PanelState; actions: PanelActions }) {
  const { profile, snapshot, settings, resume, plans, toggleInclude, editValue, editKind } = useFillPlan(state);
  const [filling, setFilling] = useState(false);
  const [runStatus, setRunStatus] = useState('');
  const activeRun = useRef<AbortController | null>(null);
  const context = JSON.stringify([state.tabId, [...state.frames].map(([id, frame]) => [id, frame.documentId]), snapshot?.id, snapshot?.revision]);
  const currentContext = useRef(context); currentContext.current = context;
  useEffect(() => () => { activeRun.current?.abort(); }, [context]);
  const [enableHint, setEnableHint] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [answerBank, setAnswerBank] = useState<AnswerRecord[]>([]);
  const [previousApps, setPreviousApps] = useState<TrackerJob[]>([]);
  /** `${tabId}|${url}` the JD was last requested for — once per page, not per tab. */
  const jdRequestedFor = useRef<string | null>(null);

  const { tabId, frames } = state;
  const frameEntries = [...frames.entries()].sort(([a], [b]) => a - b);
  const detected = frameEntries.find(([, f]) => f.atsId !== null)?.[1].atsId ?? null;

  // Reload the bank per page: the tab stays mounted across tab switches now,
  // and answers saved in the Answers tab should suggest on the next form.
  useEffect(() => {
    let disposed = false;
    const refresh = () => void listAnswers().then((answers) => { if (!disposed) setAnswerBank(answers); }).catch((error) => { if (!disposed) setRunStatus(`Could not load saved answers: ${String(error)}`); });
    refresh(); const stop = watchCollections(refresh);
    return () => { disposed = true; stop(); };
  }, [state.tabUrl]);

  // Auto-extract the JD once per page: powers dealbreaker warnings here and
  // pre-fills the Generate tab's scan step. Keyed on the URL as well as the
  // tab so navigating to another posting in the same tab extracts again.
  useEffect(() => {
    if (tabId === null || frameEntries.length === 0) {
      jdRequestedFor.current = null;
      return;
    }
    if (state.jd !== null) return;
    const key = JSON.stringify([tabId, state.tabUrl, frameEntries.map(([id, frame]) => [id, frame.url])]);
    if (jdRequestedFor.current === key) return;
    jdRequestedFor.current = key;
    actions.extractJd(tabId);
  }, [tabId, state.tabUrl, state.jd, state.frames, actions]);

  // Duplicate-application guard: have you applied to this company before?
  useEffect(() => {
    const company = companyFromUrl(state.tabUrl);
    if (!company) {
      setPreviousApps([]);
      return;
    }
    let disposed = false;
    const refresh = () => void listJobs().then((jobs) => { if (!disposed) setPreviousApps(findPreviousApplications(jobs, company)); }).catch((error) => { if (!disposed) setRunStatus(`Could not load previous applications: ${String(error)}`); });
    refresh(); const stop = watchCollections(refresh);
    return () => { disposed = true; stop(); };
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
    if (activeRun.current) return;
    const controller = new AbortController(); activeRun.current = controller;
    const origin = context;
    setFilling(true);
    setRunStatus('Preparing reviewed fields…');
    try {
      const results = [];
      for (const [frameId, plan] of plans) {
        const instructions = plan.rows
          .filter((row) => row.include && row.instruction)
          .map((row) => row.instruction!);
        if (instructions.length === 0) continue;
        const files = await collectFiles(instructions);
        if (controller.signal.aborted || currentContext.current !== origin) throw new Error('Fill cancelled because its application or profile changed');
        setRunStatus(`Waiting for ${instructions.length} fields to finish…`);
        results.push(...await actions.execute(tabId, frameId, plan.documentId, instructions, files,
          { profileId: snapshot?.id, profileRevision: snapshot?.revision, resumeName: resume?.filename, resumeVersionId: resume?.versionId }, controller.signal));
      }
      const failed = results.filter((result) => !result.ok).length;
      setRunStatus(`${results.length - failed} fields verified${failed ? `; ${failed} need attention` : ''}. Review the application before submitting.`);
    } catch (error) {
      setRunStatus(String(error instanceof Error ? error.message : error));
    } finally {
      if (activeRun.current === controller) activeRun.current = null;
      setFilling(false);
    }
  };

  const enableSite = async () => {
    setEnabling(true); setEnableHint('Waiting for site permission and registration…');
    try {
      const origin = await enableCurrentSite(tabId, actions.registerSite);
      setEnableHint(`Enabled on ${origin}. The page is reloading.`);
    } catch (error) {
      setEnableHint(String(error instanceof Error ? error.message : error));
    } finally { setEnabling(false); }
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
          <button className="primary" onClick={enableSite} disabled={enabling}>{enabling ? 'Enabling…' : 'Enable JobPilot on this site'}</button>
          {enableHint && <p className="hint" role="status">{enableHint}</p>}
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
      {[...plans.values()].map((plan, index) => plan.error && <p className="warn-box" role="alert" key={index}>{plan.error}</p>)}
      {(runStatus || state.trackerNotice) && <p className="run-status" role="status">{runStatus || state.trackerNotice}</p>}

      {frameEntries.map(([frameId, frame]) => {
        const plan = plans.get(frameId);
        if (!plan || plan.rows.length + plan.unmatched.length === 0) return null;
        return (
          <FramePlanView
            key={frameId}
            frameLabel={frameEntries.length > 1 ? `frame ${frameId}${frame.atsId ? ` · ${ATS_LABELS[frame.atsId]}` : ''}` : null}
            plan={plan}
            fillResults={state.fillResults}
            answerBank={answerBank}
            applicationId={applicationId(frame.url) ?? ''}
            disabled={filling}
            onHover={(fieldId) => actions.highlight(tabId, frameId, fieldId)}
            onToggle={(fieldId) => toggleInclude(frameId, fieldId)}
            onValue={(fieldId, text) => editValue(frameId, fieldId, text)}
            onKind={(fieldId, kind) => editKind(frameId, fieldId, kind)}
          />
        );
      })}

      {(includedCount > 0 || filling) && (
        <div className="save-bar">
          <button className="primary" onClick={fillAll} disabled={filling || resolving}>
            {filling ? 'Filling…' : `Fill ${includedCount} field${includedCount === 1 ? '' : 's'}`}
          </button>
          {filling && <button onClick={() => activeRun.current?.abort()}>Cancel fill</button>}
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
    if (instruction.action === 'attachFile') blobKeys.add(instruction.value.blobKey);
  }
  if (blobKeys.size === 0) return undefined;
  const files: SerializedFile[] = [];
  for (const key of blobKeys) {
    const file = await loadDocumentAsFile(key);
    if (!file) throw new Error('A selected document was removed. Select a resume and review again.');
    files.push({ ...file, blobKey: key });
  }
  return files;
}
