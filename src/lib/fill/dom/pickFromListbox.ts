import { deepQuerySelectorAll } from './deepQuery';
import { setNativeValue } from './setNativeValue';
import { normalizeForSignature } from '../signature';

export interface ListboxPickResult {
  ok: boolean;
  picked?: string;
  error?: string;
}

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
): Promise<ListboxPickResult> {
  if (trigger instanceof HTMLInputElement) {
    trigger.focus();
    setNativeValue(trigger, targetText);
  } else {
    click(trigger);
  }

  const option = await waitForBestOption(targetText, timeoutMs);
  if (!option) return { ok: false, error: 'no matching option appeared' };

  click(option);
  return { ok: true, picked: option.textContent?.trim() ?? '' };
}

function click(el: HTMLElement): void {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, composed: true }));
  }
}

function waitForBestOption(targetText: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = (): boolean => {
      const options = deepQuerySelectorAll<HTMLElement>('[role="option"], [role="listbox"] li');
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
    };

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
    else if (text.startsWith(target) || target.startsWith(text)) score = 2;
    else if (text.includes(target) || target.includes(text)) score = 1;
    if (score > 0 && (!best || score > best.score)) best = { el, score };
  }
  return best?.el ?? null;
}
