import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import { CS_PORT, type BgToCs, type CsToBg } from '@lib/messaging/protocol';
import { detectAts } from '@lib/fill/adapters/detect';
import { discoverFields, observeFields, fieldIdAt, findByFieldId } from '@lib/fill/discovery';
import { flashField } from '@lib/fill/dom/highlight';
import { executeInstructions } from '@lib/fill/executor';
import { captureAnswers } from '@lib/fill/captureAnswers';
import { looksLikeConfirmation, looksLikeSubmitButton } from '@lib/tracker/detect';

/**
 * The only code that touches job-site DOMs. Deliberately dumb: report field
 * descriptors, execute fill instructions, extract JD text, snapshot answers at
 * submit time. It never sees the profile, keys, or any model — those live in
 * the side panel.
 */
export default defineContentScript({
  matches: [
    'https://*.greenhouse.io/*',
    'https://jobs.lever.co/*',
    'https://jobs.eu.lever.co/*',
    'https://jobs.ashbyhq.com/*',
    'https://*.myworkdayjobs.com/*',
    'https://*.myworkdaysite.com/*',
    'https://*.icims.com/*',
    'https://jobs.smartrecruiters.com/*',
    'https://careers.smartrecruiters.com/*',
    'https://smartapply.indeed.com/*',
    'https://www.linkedin.com/jobs/*',
  ],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',

  main() {
    const atsId = detectAts(location.host, location.pathname);
    let port: Browser.runtime.Port | null = null;
    let stopObserving: (() => void) | null = null;
    let confirmationSent = false;
    let lastContextTarget: Element | null = null;
    /** URL (minus hash) last reported to the hub. SPAs change it without a
     *  reload, so it is re-checked on every scan. */
    let announcedUrl = '';

    const post = (msg: CsToBg) => {
      try {
        port?.postMessage(msg);
      } catch {
        // Port died mid-send; reconnect loop below handles it.
      }
    };

    const pageUrl = () => location.href.replace(/#.*$/, '');

    const announce = () => {
      announcedUrl = pageUrl();
      post({ t: 'cs/ready', atsId, url: location.href });
    };

    const checkConfirmation = () => {
      if (confirmationSent) return;
      const bodyText = document.body?.innerText ?? '';
      if (looksLikeConfirmation(location.href, bodyText)) {
        confirmationSent = true;
        post({
          t: 'cs/submitDetected',
          url: location.href,
          title: document.title,
          confirmationText: bodyText.slice(0, 300),
        });
      }
    };

    const scanAndReport = () => {
      if (pageUrl() !== announcedUrl) {
        // Client-side navigation. To the panel this is a new page: the JD
        // text and fill results belonged to the old one, and a second
        // application in the same tab needs its own confirmation.
        confirmationSent = false;
        announce();
      }
      const fields = discoverFields(atsId);
      post({ t: 'cs/fields', fields });
      checkConfirmation();
    };

    const handleMessage = async (raw: unknown) => {
      const msg = raw as BgToCs;
      switch (msg.t) {
        case 'bg/scan':
          scanAndReport();
          break;
        case 'bg/execute': {
          const results = await executeInstructions(msg.instructions, msg.files ?? []);
          post({ t: 'cs/fillResults', results });
          // Filling often triggers re-renders; refresh the panel's view.
          scanAndReport();
          break;
        }
        case 'bg/highlight': {
          const el = findByFieldId(msg.fieldId);
          if (el) flashField(el);
          break;
        }
        case 'bg/identifyContext': {
          const fieldId = lastContextTarget ? fieldIdAt(lastContextTarget) : null;
          if (fieldId) post({ t: 'cs/contextField', fieldId });
          break;
        }
        case 'bg/extractJd': {
          const main = document.querySelector<HTMLElement>('main, [role="main"], article');
          const text = (main ?? document.body)?.innerText ?? '';
          post({ t: 'cs/jdText', text: text.slice(0, 60_000), title: document.title });
          break;
        }
      }
    };

    // Snapshot answers the moment a submit-looking control is activated — the
    // form is unreachable once navigation starts.
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null;
        const control = target?.closest<HTMLElement>('button, input[type="submit"], [role="button"]');
        if (!control) return;
        const text =
          control.textContent?.trim() ||
          (control as HTMLInputElement).value?.trim?.() ||
          control.getAttribute('aria-label') ||
          '';
        if (!looksLikeSubmitButton(text)) return;
        post({
          t: 'cs/submitAttempt',
          url: location.href,
          title: document.title,
          answers: captureAnswers(),
        });
        // Confirmation may render without a DOM burst; check again shortly.
        setTimeout(checkConfirmation, 2500);
        setTimeout(checkConfirmation, 6000);
      },
      true,
    );

    // Track what the user right-clicked so "fix this field's mapping" can
    // resolve it — Chrome's context-menu API never identifies the element.
    document.addEventListener(
      'contextmenu',
      (event) => {
        lastContextTarget = event.target as Element | null;
      },
      true,
    );

    // A service-worker restart is transient and reconnects immediately. An
    // extension reload/uninstall invalidates this context permanently: connect()
    // then throws on every call, so back off and give up rather than spinning at
    // 500ms forever on a page the user is still reading.
    const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
    // A connection only counts as healthy once it has stayed up this long.
    // connect() can succeed synchronously and then disconnect a moment later
    // (worker failing to start, extension mid-update); resetting the backoff
    // on connect alone turned that into a 500ms loop with no exit.
    const STABLE_AFTER_MS = 5_000;
    let reconnectAttempt = 0;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
      if (delay === undefined) return; // context gone for good
      reconnectAttempt += 1;
      setTimeout(connect, delay);
    };

    function connect(): void {
      try {
        port = browser.runtime.connect({ name: CS_PORT });
      } catch {
        // "Extension context invalidated" — the old content script is orphaned.
        port = null;
        scheduleReconnect();
        return;
      }
      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(() => {
        clearTimeout(stableTimer);
        port = null;
        stopObserving?.();
        stopObserving = null;
        scheduleReconnect();
      });

      clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        reconnectAttempt = 0;
      }, STABLE_AFTER_MS);
      announce();
      scanAndReport();
      stopObserving = observeFields(scanAndReport);
    }

    connect();
  },
});
