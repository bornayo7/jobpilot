/**
 * querySelectorAll that descends into open shadow roots (SmartRecruiters,
 * LinkedIn's SDUI flow render inputs inside nested web components).
 * Same-document only — cross-origin iframes get their own content script via
 * all_frames, so no frame traversal happens here.
 */
export function deepQuerySelectorAll<E extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): E[] {
  const results: E[] = [];
  const visit = (node: ParentNode) => {
    results.push(...node.querySelectorAll<E>(selector));
    const walker = node.querySelectorAll<Element>('*');
    for (const el of walker) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return results;
}

/** First match across shadow boundaries, or null. */
export function deepQuerySelector<E extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): E | null {
  const direct = root.querySelector<E>(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll<Element>('*')) {
    if (el.shadowRoot) {
      const found = deepQuerySelector<E>(selector, el.shadowRoot);
      if (found) return found;
    }
  }
  return null;
}
