import type { FileRef, FillInstruction, FillOutcome, FillResult, SerializedFile } from '../messaging/protocol';
import { findByFieldId } from './discovery';
import { setNativeChecked, setNativeValue } from './dom/setNativeValue';
import { attachFileToInput } from './dom/attachFile';
import { pickFromListbox } from './dom/pickFromListbox';
import { pickRadio } from './dom/radioGroup';
import { isUnavailable } from './dom/isUnavailable';

/**
 * Runs in the content script. Executes fill instructions against stamped
 * elements and VERIFIES each write by reading the value back — a fill that a
 * framework reverted is a failure, not a success.
 */
export async function executeInstructions(
  instructions: FillInstruction[],
  files: SerializedFile[] = [],
): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const fileByName = new Map(files.map((f) => [f.name, f]));

  for (const instruction of instructions) {
    results.push(await executeOne(instruction, fileByName));
  }
  return results;
}

async function executeOne(
  instruction: FillInstruction,
  fileByName: Map<string, SerializedFile>,
): Promise<FillResult> {
  const { fieldId } = instruction;
  const el = findByFieldId(fieldId);
  if (!el) return { fieldId, ok: false, error: 'element not found' };
  if (isUnavailable(el)) return { fieldId, ok: false, error: 'control is disabled or read-only' };

  try {
    return { fieldId, ...(await fill(el, instruction, fileByName)) };
  } catch (err) {
    return { fieldId, ok: false, error: String(err) };
  }
}

async function fill(
  el: HTMLElement,
  instruction: FillInstruction,
  fileByName: Map<string, SerializedFile>,
): Promise<FillOutcome> {
  switch (instruction.action) {
    case 'setText':
      return setText(el, instruction.value);
    case 'selectOption':
      // A radio group is discovered as one field with the buttons as options.
      return isRadio(el) ? pickRadio(el, instruction.value) : selectOption(el, instruction.value);
    case 'setChecked':
      return setChecked(el, instruction.value);
    case 'attachFile':
      return attachFile(el, instruction.value, fileByName);
    case 'pickListbox':
      // Typing into a radio would overwrite its value attribute — pick instead.
      return isRadio(el) ? pickRadio(el, instruction.value) : pickFromListbox(el, instruction.value);
  }
}

/** Input types that carry a `value` but are not text entry. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'file', 'password', 'hidden', 'submit', 'button', 'reset', 'image']);

function setText(el: HTMLElement, value: string): FillOutcome {
  if (el instanceof HTMLInputElement && NON_TEXT_INPUTS.has(el.type)) {
    return { ok: false, error: 'not a text control' };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, value, { blur: true });
    return verified(el.value, value);
  }
  if (el.getAttribute('contenteditable') === 'true') {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return verified(el.textContent ?? '', value);
  }
  return { ok: false, error: 'not a text control' };
}

function selectOption(el: HTMLElement, wanted: string): FillOutcome {
  if (!(el instanceof HTMLSelectElement)) return { ok: false, error: 'not a select' };
  const optionLabel = (o: HTMLOptionElement) => (o.label || o.text || '').trim().toLowerCase();
  const option =
    Array.from(el.options).find((o) => o.value === wanted) ??
    Array.from(el.options).find((o) => optionLabel(o) === wanted.toLowerCase());
  if (!option) return { ok: false, error: `no option "${wanted}"` };
  if (isUnavailable(option)) return { ok: false, error: 'option is disabled' };
  setNativeValue(el, option.value);
  return { ok: el.value === option.value, verifiedValue: el.value };
}

function setChecked(el: HTMLElement, wanted: boolean): FillOutcome {
  if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) {
    return { ok: false, error: 'not a checkbox/radio' };
  }
  setNativeChecked(el, wanted);
  return { ok: el.checked === wanted, verifiedValue: String(el.checked) };
}

function attachFile(el: HTMLElement, ref: FileRef, fileByName: Map<string, SerializedFile>): FillOutcome {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
    return { ok: false, error: 'not a file input' };
  }
  const file = fileByName.get(ref.filename);
  if (!file) return { ok: false, error: 'file payload missing' };
  attachFileToInput(el, file);
  return { ok: el.files !== null && el.files.length > 0, verifiedValue: el.files?.[0]?.name };
}

function verified(readback: string, wanted: string): FillOutcome {
  return readback === wanted
    ? { ok: true, verifiedValue: readback }
    : { ok: false, verifiedValue: readback, error: 'value reverted by page' };
}

function isRadio(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio';
}
