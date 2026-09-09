import type { FillOutcome } from '../../messaging/protocol';
import { ariaLabelOf, cleanText, explicitLabelFor } from './labelFor';
import { setNativeChecked } from './setNativeValue';
import { containsTokens, normalizeForSignature } from '../signature';
import { isUnavailable } from './isUnavailable';

/**
 * Radio buttons are one QUESTION spread over several inputs. Discovery reports
 * a group as a single field whose options are the individual buttons, and the
 * executor selects a member by value or label. Groups are keyed by `name`
 * within the owning form (or the document / shadow root when there is none) —
 * the same rule the browser uses for mutual exclusion.
 */
export function radioGroupOf(radio: HTMLInputElement): HTMLInputElement[] {
  const name = radio.getAttribute('name');
  if (!name) return [radio];
  const scope: ParentNode = radio.getRootNode() as Document | ShadowRoot;
  const members = Array.from(
    scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escapeAttr(name)}"]`),
  ).filter((member) => member.form === radio.form);
  return members.length > 0 ? members : [radio];
}

/**
 * The text a human reads next to ONE button ("Yes", "No, I will not require
 * sponsorship"). Explicit associations only, then the text node that follows
 * the input, then the value attribute — never the container fallback, which
 * would return the whole question for every button.
 */
export function radioOptionLabel(radio: HTMLInputElement): string {
  const explicit = explicitLabelFor(radio);
  if (explicit) return explicit;

  let sibling: Node | null = radio.nextSibling;
  while (sibling && sibling.nodeType === Node.TEXT_NODE && !cleanText(sibling.textContent)) {
    sibling = sibling.nextSibling;
  }
  if (sibling && sibling.nodeType === Node.TEXT_NODE) {
    const text = cleanText(sibling.textContent);
    if (text) return text;
  }
  if (sibling instanceof Element && !sibling.matches('input, select, textarea, button')) {
    const text = cleanText(sibling.textContent);
    if (text && text.length <= 80) return text;
  }
  return radio.value;
}

/**
 * The question the group answers: a <fieldset>'s <legend>, a radiogroup's
 * ARIA label, or the common ancestor's text with the option labels removed.
 */
export function radioGroupLabel(radios: HTMLInputElement[], optionLabels: string[]): string {
  const first = radios[0];
  if (!first) return '';

  const fieldset = first.closest('fieldset');
  if (fieldset && radios.every((r) => fieldset.contains(r))) {
    const legend = cleanText(fieldset.querySelector('legend')?.textContent);
    if (legend) return legend;
  }

  const group = first.closest('[role="radiogroup"]');
  if (group && radios.every((r) => group.contains(r))) {
    const aria = ariaLabelOf(group);
    if (aria) return aria;
  }

  const ancestor = commonAncestor(radios);
  if (ancestor) {
    const clone = ancestor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button, svg').forEach((c) => c.remove());
    let text = cleanText(clone.textContent);
    for (const label of optionLabels) {
      if (!label) continue;
      text = text.replace(new RegExp(`(^|\\s)${escapeRegExp(label)}(?=\\s|$)`, 'g'), ' ');
    }
    text = cleanText(text);
    if (text && text.length <= 200) return text;
  }

  return '';
}

/**
 * Check the group member matching `wanted` — by value attribute first (what
 * the resolver emits from the discovered options), then by label. Verified by
 * reading `checked` back, like every other write.
 */
export function pickRadio(member: HTMLInputElement, wanted: string): FillOutcome {
  const group = radioGroupOf(member);
  const normWanted = normalizeForSignature(wanted);
  const target =
    group.find((r) => r.value === wanted) ??
    group.find((r) => normalizeForSignature(radioOptionLabel(r)) === normWanted) ??
    (normWanted
      ? group.find((r) => containsTokens(normalizeForSignature(radioOptionLabel(r)), normWanted))
      : undefined);
  if (!target) return { ok: false, error: `no radio option "${wanted}"` };
  if (isUnavailable(target)) return { ok: false, error: 'radio option is disabled' };

  setNativeChecked(target, true);
  if (!target.checked) return { ok: false, error: 'radio did not take the selection' };
  return { ok: true, verifiedValue: radioOptionLabel(target) };
}

function commonAncestor(nodes: Element[]): Element | null {
  let node: Element | null = nodes[0]?.parentElement ?? null;
  while (node && !nodes.every((n) => node!.contains(n))) node = node.parentElement;
  return node;
}

/** Escape for use inside a double-quoted CSS attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
