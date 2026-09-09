import type { FormFieldDescriptor } from '../messaging/protocol';
import type { AtsId } from './adapters/detect';
import { deepQuerySelectorAll } from './dom/deepQuery';
import { labelFor } from './dom/labelFor';
import { radioGroupLabel, radioGroupOf, radioOptionLabel } from './dom/radioGroup';
import { fieldSignature } from './signature';
import { isUnavailable } from './dom/isUnavailable';

export const FIELD_ID_ATTR = 'data-jobpilot-id';

const CANDIDATE_SELECTOR =
  'input, textarea, select, [role="combobox"], [contenteditable="true"]';

let idCounter = 0;
// A copied DOM attribute is not an element identity. Frameworks clone form
// markup, including our stamp; only the actual element keeps its old id.
const fieldIds = new WeakMap<HTMLElement, string>();
function nextFieldId(): string {
  return `jp-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/**
 * Scan the document (descending into open shadow roots) for fillable controls
 * and describe them. Each element is stamped with data-jobpilot-id so later
 * FillInstructions can address it without brittle selectors. Safe to call
 * repeatedly — already-stamped elements keep their id.
 *
 * Named radio buttons are reported once per GROUP, with the buttons as the
 * field's options, because that is the shape the resolver already matches
 * profile answers against for selects.
 */
export function discoverFields(atsId: AtsId | null, root: ParentNode = document): FormFieldDescriptor[] {
  const descriptors: FormFieldDescriptor[] = [];
  const groupedRadios = new Set<Element>();

  for (const el of deepQuerySelectorAll<HTMLElement>(CANDIDATE_SELECTOR, root)) {
    const control = classifyControl(el);
    if (!control) continue;
    if (isUnavailable(el)) continue;

    if (control === 'radio' && el instanceof HTMLInputElement && el.getAttribute('name')) {
      if (groupedRadios.has(el)) continue;
      const group = radioGroupOf(el);
      for (const member of group) groupedRadios.add(member);
      const descriptor = describeRadioGroup(atsId, group);
      if (descriptor) descriptors.push(descriptor);
      continue;
    }

    if (!isVisible(el) && control !== 'file') continue; // file inputs hide behind styled buttons

    const fieldId = fieldIds.get(el) ?? nextFieldId();
    fieldIds.set(el, fieldId);
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
    const relevant = mutations.some((m) => m.type === 'attributes' || m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0));
    if (!relevant) return;
    observeRoots(document);
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  const observed = new WeakSet<Node>();
  const observeRoots = (root: Document | ShadowRoot) => {
    if (!observed.has(root)) {
      observed.add(root);
      observer.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['disabled', 'readonly', 'hidden', 'aria-hidden', 'aria-disabled', 'aria-readonly', 'name', 'type', 'role', 'class', 'style'] });
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) observeRoots(el.shadowRoot);
  };
  observeRoots(document);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}

export function findByFieldId(fieldId: string): HTMLElement | null {
  const matches = deepQuerySelectorAll<HTMLElement>(`[${FIELD_ID_ATTR}]`).filter((el) => fieldIds.get(el) === fieldId);
  return matches.find((el) => !isUnavailable(el)) ?? matches[0] ?? null;
}

/**
 * The discovered field a right-click landed on: the stamped control itself,
 * or the one inside the label/row the click hit. Chrome's context-menu API
 * never identifies the element, so the content script remembers the target.
 */
export function fieldIdAt(target: Element): string | null {
  const stamped =
    target.closest<HTMLElement>(`[${FIELD_ID_ATTR}]`) ??
    target.closest('label, li, fieldset, div')?.querySelector<HTMLElement>(`[${FIELD_ID_ATTR}]`) ??
    null;
  return stamped?.getAttribute(FIELD_ID_ATTR) ?? null;
}

/** One descriptor for a whole radio group; every member carries the same id so
 *  the right-click "fix this field" flow resolves from any button. */
function describeRadioGroup(atsId: AtsId | null, group: HTMLInputElement[]): FormFieldDescriptor | null {
  group = group.filter((r) => !isUnavailable(r));
  if (!group.some((r) => isVisible(r))) return null;
  const first = group[0];
  if (!first) return null;

  const fieldId =
    group.map((r) => fieldIds.get(r)).find(Boolean) ?? nextFieldId();
  for (const member of group) { fieldIds.set(member, fieldId); member.setAttribute(FIELD_ID_ATTR, fieldId); }

  const options = group.map((r) => ({ value: r.value, label: radioOptionLabel(r) }));
  const name = first.getAttribute('name') ?? undefined;
  const descriptor: FormFieldDescriptor = {
    fieldId,
    control: 'radio',
    label: radioGroupLabel(group, options.map((o) => o.label)),
    name,
    id: first.getAttribute('id') ?? undefined,
    required: group.some((r) => r.hasAttribute('required') || r.getAttribute('aria-required') === 'true'),
    options,
    atsFieldKey: atsFieldKeyFor(first, name),
    signature: '',
    currentValue: group.find((r) => r.checked)?.value,
  };
  descriptor.signature = fieldSignature(atsId, descriptor);
  return descriptor;
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
      case 'password':
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
      .filter((o) => o.value !== '' && !isUnavailable(o))
      .map((o) => ({ value: o.value, label: (o.label || o.text || '').trim() }));
  }
  return undefined;
}

function currentValueOf(el: HTMLElement): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked ? 'true' : 'false';
    // An unchecked (nameless, ungrouped) radio has no value yet — reporting
    // 'false' made the resolver treat it as already filled.
    if (el.type === 'radio') return el.checked ? el.value || 'true' : undefined;
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
