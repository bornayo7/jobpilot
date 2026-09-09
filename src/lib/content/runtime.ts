import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import { CS_PORT, type BgToCs, type CsEvent, type CsToBg, type FillProvenance } from '../messaging/protocol';
import { detectAts } from '../fill/adapters/detect';
import { discoverFields, observeFields, fieldIdAt, findByFieldId } from '../fill/discovery';
import { flashField } from '../fill/dom/highlight';
import { executeInstructions } from '../fill/executor';
import { captureAnswers } from '../fill/captureAnswers';
import { labelFor } from '../fill/dom/labelFor';
import { retainedAttachment } from '../fill/dom/attachFile';
import { deepQuerySelectorAll } from '../fill/dom/deepQuery';
import { looksLikeConfirmation, looksLikeSubmitButton } from '../tracker/detect';

/** One isolated-world runtime, shared by static and user-enabled declarations. */
export function startContentRuntime(): () => void {
  const globals = globalThis as typeof globalThis & { __jobpilotDispose?: () => void };
  globals.__jobpilotDispose?.();
  let disposed = false;
  let port: Browser.runtime.Port | null = null;
  let stopObserving: (() => void) | null = null;
  let documentId: string = crypto.randomUUID();
  let announcedUrl = '';
  let previousControls: HTMLElement[] = [];
  let lastContextTarget: Element | null = null;
  let provenance: FillProvenance | undefined;
  let resumeAttachment: { input: HTMLInputElement; file: File; versionId?: string } | undefined;
  let active: { id: string; controller: AbortController } | null = null;
  let confirmationSent = false;
  const listeners = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
    timers.add(timer); return timer;
  };
  const post = (event: CsEvent, id = documentId) => {
    try { port?.postMessage({ ...event, documentId: id } satisfies CsToBg); }
    catch { /* reconnect repopulates page state */ }
  };
  const pageUrl = () => location.href.replace(/#.*$/, '');
  const announce = () => {
    announcedUrl = pageUrl();
    post({ t: 'cs/ready', atsId: detectAts(location.host, location.pathname), url: location.href });
  };
  const invalidate = () => {
    active?.controller.abort(); documentId = crypto.randomUUID();
    provenance = undefined; resumeAttachment = undefined; confirmationSent = false; announce();
  };
  const checkConfirmation = () => {
    if (confirmationSent) return;
    const text = document.body?.innerText ?? '';
    if (!looksLikeConfirmation(location.href, text)) return;
    confirmationSent = true;
    post({ t: 'cs/submitDetected', url: location.href, title: document.title, confirmationText: text.slice(0, 6000) });
  };
  const scanAndReport = () => {
    const fields = discoverFields(detectAts(location.host, location.pathname));
    const controls = fields.map((f) => findByFieldId(f.fieldId)).filter((el): el is HTMLElement => !!el);
    const replaced = previousControls.length > 0 && !previousControls.some((el) => controls.includes(el));
    if (pageUrl() !== announcedUrl || replaced) invalidate();
    previousControls = controls; post({ t: 'cs/fields', fields }); checkConfirmation();
  };
  const handleMessage = async (raw: unknown) => {
    const msg = raw as BgToCs;
    switch (msg.t) {
      case 'bg/scan': scanAndReport(); break;
      case 'bg/cancel':
        if (msg.documentId === documentId && active?.id === msg.runId) active.controller.abort();
        break;
      case 'bg/execute': {
        scanAndReport();
        if (msg.documentId !== documentId || active) {
          post({ t: 'cs/fillResults', runId: msg.runId, results: msg.instructions.map((i) => ({ fieldId: i.fieldId, ok: false, error: active ? 'Another fill is running' : 'The application page changed' })) }, msg.documentId);
          break;
        }
        const run = { id: msg.runId, controller: new AbortController() }; active = run;
        try {
          const results = await executeInstructions(msg.instructions, msg.files ?? [], run.controller.signal);
          if (msg.documentId === documentId && results.some((r) => r.ok)) {
            provenance = { profileId: msg.provenance?.profileId, profileRevision: msg.provenance?.profileRevision };
            for (const instruction of msg.instructions) {
              if (instruction.kind !== 'docs.resume' || instruction.action !== 'attachFile' || !results.some((r) => r.fieldId === instruction.fieldId && r.ok)) continue;
              const input = findByFieldId(instruction.fieldId);
              const file = input instanceof HTMLInputElement ? retainedAttachment(input) : undefined;
              if (input instanceof HTMLInputElement && file) {
                resumeAttachment = { input, file, versionId: file.name === msg.provenance?.resumeName ? msg.provenance?.resumeVersionId : undefined };
              }
            }
          }
          post({ t: 'cs/fillResults', runId: msg.runId, results }, msg.documentId);
        } catch (error) {
          post({ t: 'cs/fillResults', runId: msg.runId, results: msg.instructions.map((i) => ({ fieldId: i.fieldId, ok: false, error: String(error) })) }, msg.documentId);
        } finally {
          if (active === run) active = null;
          scanAndReport();
        }
        break;
      }
      case 'bg/highlight': { const el = findByFieldId(msg.fieldId); if (el) flashField(el); break; }
      case 'bg/identifyContext': {
        const fieldId = lastContextTarget ? fieldIdAt(lastContextTarget) : null;
        if (fieldId) post({ t: 'cs/contextField', fieldId });
        break;
      }
      case 'bg/extractJd': {
        const main = document.querySelector<HTMLElement>('main, [role="main"], article');
        post({ t: 'cs/jdText', text: ((main ?? document.body)?.innerText ?? '').slice(0, 60_000), title: document.title });
        break;
      }
    }
  };
  const snapshotAttempt = (root: ParentNode) => {
    const inputs = deepQuerySelectorAll<HTMLInputElement>('input[type="file"]', root);
    const attached = resumeAttachment && inputs.includes(resumeAttachment.input) && retainedAttachment(resumeAttachment.input) === resumeAttachment.file ? resumeAttachment : undefined;
    const resume = attached?.file ?? inputs
      .filter((el) => /resume|\bcv\b|curriculum vitae/i.test(`${labelFor(el)} ${el.name}`))
      .flatMap((el) => [...(el.files ?? [])]).find((file) => /\.(pdf|docx?)$/i.test(file.name));
    post({ t: 'cs/submitAttempt', url: location.href, title: document.title, answers: captureAnswers(root),
      provenance: { ...provenance, resumeName: resume?.name, resumeVersionId: attached?.versionId } });
    later(checkConfirmation, 1200); later(checkConfirmation, 4000);
  };
  document.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement) snapshotAttempt(event.target);
  }, { capture: true, signal: listeners.signal });
  document.addEventListener('click', (event) => {
    const target = event.composedPath().find((node): node is Element => node instanceof Element);
    const control = target?.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
    if (!control || !looksLikeSubmitButton(control.textContent?.trim() || (control as HTMLInputElement).value || control.getAttribute('aria-label') || '')) return;
    const form = control.closest('form');
    if (form || control.getAttribute('type') === 'submit' || /submit|send|finish/i.test(control.textContent ?? '')) snapshotAttempt(form ?? document);
  }, { capture: true, signal: listeners.signal });
  document.addEventListener('contextmenu', (event) => {
    lastContextTarget = event.composedPath().find((node): node is Element => node instanceof Element) ?? null;
  }, { capture: true, signal: listeners.signal });
  let reconnectAttempt = 0;
  const reconnectDelays = [500, 1000, 2000, 5000, 10000];
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  const reconnect = () => { const delay = reconnectDelays[reconnectAttempt++]; if (delay !== undefined) later(connect, delay); };
  function connect() {
    if (disposed) return;
    let connected: Browser.runtime.Port;
    try { connected = browser.runtime.connect({ name: CS_PORT }); }
    catch { reconnect(); return; }
    port = connected; connected.onMessage.addListener(handleMessage);
    connected.onDisconnect.addListener(() => {
      if (port !== connected) return;
      clearTimeout(stableTimer); active?.controller.abort(); port = null;
      stopObserving?.(); stopObserving = null;
      if (!disposed) reconnect();
    });
    stableTimer = later(() => { reconnectAttempt = 0; }, 5000);
    announce(); scanAndReport(); stopObserving?.(); stopObserving = observeFields(scanAndReport);
  }
  const navigationTimer = setInterval(() => { if (pageUrl() !== announcedUrl) scanAndReport(); }, 250);
  const dispose = () => {
    if (disposed) return;
    disposed = true; active?.controller.abort(); listeners.abort(); stopObserving?.();
    for (const timer of timers) clearTimeout(timer);
    clearInterval(navigationTimer); port?.disconnect(); port = null;
    if (globals.__jobpilotDispose === dispose) delete globals.__jobpilotDispose;
  };
  globals.__jobpilotDispose = dispose;
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
  connect(); return dispose;
}
