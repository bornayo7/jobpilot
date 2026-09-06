/** Native disabled states include disabled fieldsets and option groups. */
export function isUnavailable(el: Element): boolean {
  if (el.matches(':disabled') || el.hasAttribute('readonly') ||
    el.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]')) return true;
  if (el instanceof HTMLOptionElement && el.closest('optgroup[disabled]')) return true;
  // Some DOM implementations omit inherited disabled state from :disabled.
  // HTML exempts controls inside the disabled fieldset's first legend.
  let fieldset = el.closest('fieldset[disabled]');
  while (fieldset) {
    const legend = [...fieldset.children].find((child) => child.tagName === 'LEGEND');
    if (!legend?.contains(el)) return true;
    fieldset = fieldset.parentElement?.closest('fieldset[disabled]') ?? null;
  }
  return false;
}
