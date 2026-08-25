import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import { CS_PORT, type BgToCs, type CsToBg } from '@lib/messaging/protocol';
import { detectAts } from '@lib/fill/adapters/detect';
import { discoverFields, observeFields, findByFieldId, FIELD_ID_ATTR } from '@lib/fill/discovery';
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

    const post = (msg: CsToBg) => {
      try {
        port?.postMessage(msg);
      } catch {
        // Port died mid-send; reconnect loop below handles it.
      }
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
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            const prevOutline = el.style.outline;
            const prevOffset = el.style.outlineOffset;
            el.style.outline = '2px solid #e8590c';
            el.style.outlineOffset = '2px';
            setTimeout(() => {
              el.style.outline = prevOutline;
              el.style.outlineOffset = prevOffset;
            }, 1600);
          }
          break;
        }
        case 'bg/identifyContext': {
          const target = lastContextTarget;
          if (!target) break;
          const stamped =
            target.closest<HTMLElement>(`[${FIELD_ID_ATTR}]`) ??
            target.closest('label, li, fieldset, div')?.querySelector<HTMLElement>(`[${FIELD_ID_ATTR}]`) ??
            null;
          const fieldId = stamped?.getAttribute(FIELD_ID_ATTR);
          if (fieldId) post({ t: 'cs/contextField', fieldId });
          break;
        }
        case 'bg/extractJd': {
          const main = document.querySelector<HTMLElement>('main, [role="main"], article');
          const text = (main ?? document.body)?.innerText ?? '';
          post({ t: 'cs/jdText', text: text.slice(0, 60_000), title: document.title });
          break;
        }
        case 'bg/wizardNext':
          // Wizard advancement is adapter work (Workday milestone).
          break;
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

    const connect = () => {
      port = browser.runtime.connect({ name: CS_PORT });
      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        stopObserving?.();
        stopObserving = null;
        // Service worker restarted or extension reloaded — reconnect shortly.
        setTimeout(connect, 500);
      });

      post({ t: 'cs/ready', atsId, url: location.href });
      scanAndReport();
      stopObserving = observeFields(scanAndReport);
    };

    connect();
  },
});
