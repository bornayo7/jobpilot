import type { FormFieldDescriptor } from '../messaging/protocol';
import type { AtsId } from './adapters/ids';
import { deepQuerySelectorAll } from './dom/deepQuery';
import { labelFor } from './dom/labelFor';
import { fieldSignature } from './signature';

export const FIELD_ID_ATTR = 'data-jobpilot-id';

const CANDIDATE_SELECTOR =
  'input, textarea, select, [role="combobox"], [contenteditable="true"]';

let idCounter = 0;
function nextFieldId(): string {
  return `jp-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/**
 * Scan the document (descending into open shadow roots) for fillable controls
 * and describe them. Each element is stamped with data-jobpilot-id so later
 * FillInstructions can address it without brittle selectors. Safe to call
 * repeatedly — already-stamped elements keep their id.
 */
export function discoverFields(atsId: AtsId | null, root: ParentNode = document): FormFieldDescriptor[] {
  const descriptors: FormFieldDescriptor[] = [];

  for (const el of deepQuerySelectorAll<HTMLElement>(CANDIDATE_SELECTOR, root)) {
    const control = classifyControl(el);
    if (!control) continue;
    if (!isVisible(el) && control !== 'file') continue; // file inputs hide behind styled buttons

    const fieldId = el.getAttribute(FIELD_ID_ATTR) ?? nextFieldId();
    el.setAttribute(FIELD_ID_ATTR, fieldId);

    const label = labelFor(el);
    const name = el.getAttribute('name') ?? undefined;
    const autocomplete = el.getAttribute('autocomplete') ?? undefined;
    const options = extractOptions(el);
    // Unlabeled, unnamed controls are decorative/search widgets — skip.
    if (!label && !name && !el.getAttribute('aria-label') && control !== 'file') continue;

    const descriptor: FormFieldDescriptor = {
      fieldId,
      control,
      label,
      name,
      id: el.getAttribute('id') ?? undefined,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      ariaLabel: el.getAttribute('aria-label') ?? undefined,
      autocomplete,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      options,
      atsFieldKey: atsFieldKeyFor(el, name),
      signature: '',
      currentValue: currentValueOf(el),
    };
    descriptor.signature = fieldSignature(atsId, descriptor);
    descriptors.push(descriptor);
  }

  return descriptors;
}

/**
 * Watch for SPA re-renders and call back (debounced) when the form changes.
 * Returns a disposer.
 */
export function observeFields(onChange: () => void, debounceMs = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (m) => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0),
    );
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}

export function findByFieldId(fieldId: string): HTMLElement | null {
  return (
    deepQuerySelectorAll<HTMLElement>(`[${FIELD_ID_ATTR}="${fieldId}"]`).at(0) ?? null
  );
}

function classifyControl(el: HTMLElement): FormFieldDescriptor['control'] | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    switch (type) {
      case 'hidden':
      case 'submit':
      case 'button':
      case 'image':
      case 'reset':
        return null;
      case 'file':
        return 'file';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'date':
      case 'month':
        return 'date';
      default:
        return el.getAttribute('role') === 'combobox' ? 'combobox' : 'text';
    }
  }
  if (el.getAttribute('role') === 'combobox') return 'combobox';
  if (el.getAttribute('contenteditable') === 'true') return 'textarea';
  return null;
}

function extractOptions(el: HTMLElement): { value: string; label: string }[] | undefined {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .filter((o) => o.value !== '')
      .map((o) => ({ value: o.value, label: (o.label || o.text || '').trim() }));
  }
  return undefined;
}

function currentValueOf(el: HTMLElement): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'true' : 'false';
    if (el.type === 'file') return undefined;
    return el.value || undefined;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value || undefined;
  if (el.getAttribute('contenteditable') === 'true') return el.textContent?.trim() || undefined;
  return undefined;
}

/** Platform-stable key an adapter can classify on (Workday's data-automation-id,
 *  Ashby's _systemfield_* names, Greenhouse's stable names). */
function atsFieldKeyFor(el: HTMLElement, name: string | undefined): string | undefined {
  const automationId =
    el.getAttribute('data-automation-id') ??
    el.closest('[data-automation-id]')?.getAttribute('data-automation-id');
  return automationId ?? name ?? el.getAttribute('data-testid') ?? undefined;
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  // Layout-based check only where a layout engine exists — happy-dom (tests)
  // reports every rect as 0x0, including the document root.
  const hasLayout = el.ownerDocument.documentElement.getBoundingClientRect().width > 0;
  if (!hasLayout) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}
