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
