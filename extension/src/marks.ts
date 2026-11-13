export const LISTENING: AddEventListenerOptions = { capture: true, passive: true };

export function within(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** A live range for a static one, or null when the page has since changed the text under it. */
export function live(range: StaticRange): Range | null {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const fits = (node: Node, offset: number) => node.isConnected && offset <= (node as Text).length;
  if (!fits(startContainer, startOffset) || !fits(endContainer, endOffset)) return null;
  const out = document.createRange();
  out.setStart(startContainer, startOffset);
  out.setEnd(endContainer, endOffset);
  return out;
}

/**
 * Puts each group of ranges on the page under its name with the CSS Custom Highlight API, and
 * takes down the names in `previous` that no group uses now. Returns the names in use.
 */
export function publish(groups: Map<string, Highlight>, previous: Set<string>): Set<string> {
  for (const name of previous) {
    if (!groups.has(name)) CSS.highlights.delete(name);
  }
  for (const [name, group] of groups) CSS.highlights.set(name, group);
  return new Set(groups.keys());
}
