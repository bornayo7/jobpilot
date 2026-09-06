/**
 * Extract the human-readable label for a form control. Fallback chain, most
 * reliable first: <label for>, wrapping <label>, aria-labelledby, aria-label,
 * placeholder, then nearest preceding text. SmartRecruiters-style slotted
 * labels are covered by aria-labelledby resolution inside shadow roots.
 */
export function labelFor(el: Element): string {
  const explicit = explicitLabelFor(el);
  if (explicit) return explicit;

  // Last resort: closest container's leading text (custom-widget layouts where
  // the "label" is just a div above the input).
  const container = el.closest('[class*="field"], [class*="Field"], fieldset, li, div');
  if (container) {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select, button, svg, [role="listbox"]').forEach((c) => c.remove());
    const text = cleanText(clone.textContent);
    if (text && text.length <= 160) return text;
  }

  return '';
}

/**
 * The label the page itself associates with the control — <label for>,
 * wrapping <label>, aria-labelledby, aria-label, placeholder — with no
 * container guessing. Radio-group discovery uses this for the individual
 * buttons, where the container fallback would return the whole question.
 */
export function explicitLabelFor(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;

  const id = el.getAttribute('id');
  if (id) {
    // CSS.escape guards ids with dots/brackets (Lever's urls[GitHub] style).
    const explicit = root.querySelector?.(`label[for="${cssEscape(id)}"]`);
    const text = cleanText(explicit?.textContent);
    if (text) return text;
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select').forEach((child) => child.remove());
    const text = cleanText(clone.textContent);
    if (text) return text;
  }

  const aria = ariaLabelOf(el);
  if (aria) return aria;

  return cleanText(el.getAttribute('placeholder'));
}

/** aria-labelledby (resolved in the element's root) first, then aria-label. */
export function ariaLabelOf(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((refId) => cleanText((root.getElementById?.(refId) ?? el.ownerDocument.getElementById(refId))?.textContent))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return cleanText(el.getAttribute('aria-label'));
}

export function cleanText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
}

export function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\\]]/g, '\\$&');
}
