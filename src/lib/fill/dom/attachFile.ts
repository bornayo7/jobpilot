import type { SerializedFile } from '../../messaging/protocol';
import { base64ToUint8Array } from '../../util/base64';

/**
 * Programmatic file upload: construct a File, put it in a DataTransfer, assign
 * to input.files, and dispatch `change`. File inputs are usually display:none
 * behind styled "Attach" buttons — clicking those opens an undriveable native
 * picker, so we always write the hidden input directly.
 */
export function attachFileToInput(input: HTMLInputElement, payload: SerializedFile): void {
  const file = new File([base64ToUint8Array(payload.dataBase64)], payload.name, { type: payload.type });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
