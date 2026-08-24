/**
 * Set a form control's value the way frameworks can't ignore.
 *
 * React (and friends) intercept the `value` property on the element instance,
 * so a naive `el.value = x` updates the DOM but not component state — the fill
 * looks right and then validation fails on submit. The fix: call the PROTOTYPE
 * value setter, then dispatch bubbled `input` + `change` events. Some widgets
 * (Workday fields with frontend validation) only commit state on `blur`, so
 * callers can request that too.
 */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
  { blur = false }: { blur?: boolean } = {},
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    (el as { value: string }).value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (blur) {
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    el.dispatchEvent(new Event('focusout', { bubbles: true }));
  }
}

/** Check/uncheck the same way: prototype setter + click semantics. */
export function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  // click() drives both DOM state and framework handlers for checkbox/radio.
  el.click();
  if (el.checked !== checked) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    setter?.call(el, checked);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
