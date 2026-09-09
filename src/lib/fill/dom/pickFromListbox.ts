import type { FillOutcome } from '../../messaging/protocol';
import { deepQuerySelectorAll } from './deepQuery';
import { setNativeValue } from './setNativeValue';
import { containsTokens, normalizeForSignature } from '../signature';
import { isUnavailable } from './isUnavailable';
import { waitForCommitted } from './settle';

/**
 * Drive an ARIA combobox / custom dropdown: open it (click, or type into the
 * typeahead input to trigger suggestions), wait for the portal listbox to
 * mount, then CLICK the best-matching option. Setting a combobox's value as a
 * string never works — react-aria and friends only commit state on option
 * activation (and typeaheads like Greenhouse's location field populate hidden
 * lat/long inputs only on click).
 */
export async function pickFromListbox(
  trigger: HTMLElement,
  targetText: string,
  timeoutMs = 3000,
  signal?: AbortSignal,
): Promise<FillOutcome> {
  if (signal?.aborted || !trigger.isConnected || isUnavailable(trigger)) return { ok: false, error: 'Fill cancelled or control unavailable' };
  if (trigger instanceof HTMLInputElement) {
    trigger.focus();
    setNativeValue(trigger, targetText);
  } else {
    click(trigger);
  }

  const option = await waitForBestOption(trigger, targetText, timeoutMs, signal);
  if (!option) return { ok: false, error: 'no matching option appeared' };

  if (signal?.aborted || !trigger.isConnected || isUnavailable(trigger) || !option.isConnected || isUnavailable(option)) return { ok: false, error: 'Fill cancelled or control unavailable' };
  const selectedText = option.textContent?.trim() ?? '';
  click(option);
  const committed = await waitForCommitted(() => {
    if (!trigger.isConnected || isUnavailable(trigger)) return false;
    const readback = normalizeForSignature(trigger instanceof HTMLInputElement ? trigger.value : trigger.textContent ?? '');
    const matches = readback === normalizeForSignature(selectedText) || readback === normalizeForSignature(targetText);
    // Typing into a typeahead already changes its value. Require evidence
    // that activation committed its option as well as matching visible text.
    return matches && (!(trigger instanceof HTMLInputElement) || option.getAttribute('aria-selected') === 'true' || !option.isConnected || trigger.getAttribute('aria-expanded') === 'false');
  }, signal);
  return committed ? { ok: true, verifiedValue: selectedText } : { ok: false, error: signal?.aborted ? 'Fill cancelled' : 'Option activation was not confirmed by the page' };
}

function click(el: HTMLElement): void {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, composed: true }));
  }
}

function waitForBestOption(trigger: HTMLElement, targetText: string, timeoutMs: number, signal?: AbortSignal): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = (): boolean => {
      if (signal?.aborted || !trigger.isConnected || isUnavailable(trigger)) {
        cleanup(); resolve(null); return true;
      }
      const ids = `${trigger.getAttribute('aria-controls') ?? ''} ${trigger.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean);
      const root = trigger.getRootNode();
      if (root !== trigger.ownerDocument && !(root instanceof ShadowRoot)) { cleanup(); resolve(null); return true; }
      const ownerRoot = root as Document | ShadowRoot;
      // A mounted dropdown belonging to a different field must never win.
      const scopes: ParentNode[] = ids.length
        ? ids.map((id) => ownerRoot.getElementById(id) ?? document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
        : [document];
      const options = scopes.flatMap((scope) => deepQuerySelectorAll<HTMLElement>('[role="option"], [role="listbox"] li', scope))
        .filter((el) => !isUnavailable(el) && isVisibleOption(el));
      const best = rankOptions(options, targetText);
      if (best) {
        cleanup();
        resolve(best);
        return true;
      }
      return false;
    };

    const observer = new MutationObserver(() => {
      if (Date.now() > deadline) {
        cleanup();
        resolve(null);
        return;
      }
      attempt();
    });

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        cleanup();
        resolve(null);
        return;
      }
      attempt();
    }, 250);

    const cleanup = () => {
      observer.disconnect();
      clearInterval(timer);
      signal?.removeEventListener('abort', cancelled);
    };
    const cancelled = () => { cleanup(); resolve(null); };
    signal?.addEventListener('abort', cancelled, { once: true });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Options may already be mounted.
    attempt();
  });
}

function rankOptions(options: HTMLElement[], targetText: string): HTMLElement | null {
  const target = normalizeForSignature(targetText);
  if (!target) return null;

  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of options) {
    const text = normalizeForSignature(el.textContent ?? '');
    if (!text) continue;
    let score = 0;
    if (text === target) score = 3;
    else if (text.startsWith(`${target} `) || target.startsWith(`${text} `)) score = 2;
    else if (containsTokens(text, target) || containsTokens(target, text)) score = 1;
    if (score > 0 && (!best || score > best.score)) best = { el, score };
  }
  return best?.el ?? null;
}

function isVisibleOption(el: HTMLElement): boolean {
  let node: Element | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null);
  }
  return true;
}
