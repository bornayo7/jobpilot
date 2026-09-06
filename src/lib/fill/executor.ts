import type { FillInstruction, FillResult, SerializedFile } from '../messaging/protocol';
import { findByFieldId } from './discovery';
import { setNativeChecked, setNativeValue } from './dom/setNativeValue';
import { attachFileToInput } from './dom/attachFile';
import { pickFromListbox } from './dom/pickFromListbox';
import { pickRadio, type RadioPickResult } from './dom/radioGroup';
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
  const el = findByFieldId(instruction.fieldId);
  if (!el) return { fieldId: instruction.fieldId, ok: false, error: 'element not found' };
  if (isUnavailable(el)) return { fieldId: instruction.fieldId, ok: false, error: 'control is disabled or read-only' };

  try {
    switch (instruction.action) {
      case 'setText': {
        const value = String(instruction.value);
        if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'file', 'password', 'hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) {
          return { fieldId: instruction.fieldId, ok: false, error: 'not a text control' };
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          setNativeValue(el, value, { blur: true });
          const readback = el.value;
          return {
            fieldId: instruction.fieldId,
            ok: readback === value,
            verifiedValue: readback,
            ...(readback !== value ? { error: 'value reverted by page' } : {}),
          };
        }
        if (el.getAttribute('contenteditable') === 'true') {
          el.textContent = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { fieldId: instruction.fieldId, ok: (el.textContent ?? '') === value, verifiedValue: el.textContent ?? '' };
        }
        return { fieldId: instruction.fieldId, ok: false, error: 'not a text control' };
      }

      case 'selectOption': {
        const wanted = String(instruction.value);
        // A radio group is discovered as one field with the buttons as options.
        if (isRadio(el)) return radioResult(instruction.fieldId, pickRadio(el, wanted));
        if (!(el instanceof HTMLSelectElement)) {
          return { fieldId: instruction.fieldId, ok: false, error: 'not a select' };
        }
        const optionLabel = (o: HTMLOptionElement) => (o.label || o.text || '').trim().toLowerCase();
        const option =
          Array.from(el.options).find((o) => o.value === wanted) ??
          Array.from(el.options).find((o) => optionLabel(o) === wanted.toLowerCase());
        if (!option) return { fieldId: instruction.fieldId, ok: false, error: `no option "${wanted}"` };
        if (isUnavailable(option)) return { fieldId: instruction.fieldId, ok: false, error: 'option is disabled' };
        setNativeValue(el, option.value);
        return { fieldId: instruction.fieldId, ok: el.value === option.value, verifiedValue: el.value };
      }

      case 'setChecked': {
        if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) {
          return { fieldId: instruction.fieldId, ok: false, error: 'not a checkbox/radio' };
        }
        const wanted = instruction.value === true || instruction.value === 'true';
        setNativeChecked(el, wanted);
        return { fieldId: instruction.fieldId, ok: el.checked === wanted, verifiedValue: String(el.checked) };
      }

      case 'attachFile': {
        if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
          return { fieldId: instruction.fieldId, ok: false, error: 'not a file input' };
        }
        const ref = instruction.value as { blobKey: string; filename: string };
        const file = fileByName.get(ref.filename);
        if (!file) return { fieldId: instruction.fieldId, ok: false, error: 'file payload missing' };
        attachFileToInput(el, file);
        const ok = el.files !== null && el.files.length > 0;
        return { fieldId: instruction.fieldId, ok, verifiedValue: el.files?.[0]?.name };
      }

      case 'pickListbox': {
        const target = String(instruction.value);
        // Typing into a radio would overwrite its value attribute — pick instead.
        if (isRadio(el)) return radioResult(instruction.fieldId, pickRadio(el, target));
        const result = await pickFromListbox(el, target);
        if (!result.ok) return { fieldId: instruction.fieldId, ok: false, error: result.error };
        return { fieldId: instruction.fieldId, ok: true, verifiedValue: result.picked };
      }

      case 'setDate':
        // Split month/year widgets are a Workday-adapter strategy (M4).
        return { fieldId: instruction.fieldId, ok: false, error: 'setDate not implemented yet' };
    }
  } catch (err) {
    return { fieldId: instruction.fieldId, ok: false, error: String(err) };
  }
}

function isRadio(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio';
}

function radioResult(fieldId: string, result: RadioPickResult): FillResult {
  return result.ok
    ? { fieldId, ok: true, verifiedValue: result.picked }
    : { fieldId, ok: false, error: result.error };
}
