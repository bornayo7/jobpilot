/**
 * Scroll a control into view and flash an outline around it, restoring
 * whatever inline outline the page had. Used by the panel's row hover so the
 * user can see which control a review row refers to.
 */
export function flashField(el: HTMLElement, durationMs = 1600): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const { outline, outlineOffset } = el.style;
  el.style.outline = '2px solid #e8590c';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = outline;
    el.style.outlineOffset = outlineOffset;
  }, durationMs);
}
