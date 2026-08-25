import type { CapturedAnswer } from '../messaging/protocol';
import { deepQuerySelectorAll } from './dom/deepQuery';
import { labelFor } from './dom/labelFor';
import { FIELD_ID_ATTR } from './discovery';

const QUESTION_LABEL = /\?|^(why|what|how|describe|tell us|tell me|explain|share)\b/i;

/**
 * Snapshot what the user actually wrote into free-text fields, taken at
 * submit-click time (the form is gone once navigation starts). Feeds the
 * answers bank so answering a question once means never retyping it.
 */
export function captureAnswers(root: ParentNode = document): CapturedAnswer[] {
  const answers: CapturedAnswer[] = [];
  const seen = new Set<string>();

  for (const el of deepQuerySelectorAll<HTMLElement>(
    `textarea, input[type="text"], input:not([type]), [contenteditable="true"][${FIELD_ID_ATTR}]`,
    root,
  )) {
    const value = valueOf(el).trim();
    if (!value) continue;

    const label = labelFor(el).trim();
    const isTextarea = el instanceof HTMLTextAreaElement || el.getAttribute('contenteditable') === 'true';
    // Textareas with real content are answers; text inputs only when the label
    // reads like a question (skips name/email/phone noise).
    const qualifies = isTextarea ? value.length >= 25 : QUESTION_LABEL.test(label) && value.length >= 15;
    if (!qualifies || !label) continue;

    const key = `${label}::${value.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    answers.push({ label: label.slice(0, 300), value: value.slice(0, 5000) });
    if (answers.length >= 20) break;
  }
  return answers;
}

function valueOf(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.textContent ?? '';
}
