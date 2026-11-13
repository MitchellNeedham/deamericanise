import type { DomRewriter, HighlightedChange } from '../../src/dom/index.js';
import type { Change } from '../../src/types.js';
import { LISTENING, live, publish, within } from './marks.js';
import { Tip, type TipAction } from './tip.js';

/** Switches off the rule behind a change from its description. */
export interface RuleSwitch {
  canSwitchOff(ruleId: string): boolean;
  switchOff(ruleId: string): void;
}

/** Must match the selectors in highlight.css. */
function nameOf(change: Change): string {
  return `deamericanise-${change.category}-${change.confidence}`;
}

/**
 * Paints each change with the CSS Custom Highlight API, which leaves the page's elements
 * as they are, and describes the change under the pointer.
 */
export class Highlighter {
  private readonly unsubscribe: () => void;
  private names = new Set<string>();
  private byNode = new Map<Node, HighlightedChange[]>();
  /** Every shadow root holding a change, and every root around those. */
  private shadowRoots: ShadowRoot[] = [];
  private refreshFrame = 0;
  private hoverFrame = 0;
  private pointer: [x: number, y: number] | null = null;
  private readonly tip = new Tip();

  constructor(
    private readonly rewriter: DomRewriter,
    private readonly rules: RuleSwitch,
  ) {
    this.unsubscribe = rewriter.onRewrite(this.scheduleRefresh);
    document.addEventListener('mousemove', this.onMove, LISTENING);
    document.addEventListener('mouseout', this.onOut, LISTENING);
    addEventListener('scroll', this.onScroll, LISTENING);
    this.refresh();
  }

  stop(): void {
    this.unsubscribe();
    cancelAnimationFrame(this.refreshFrame);
    cancelAnimationFrame(this.hoverFrame);
    document.removeEventListener('mousemove', this.onMove, LISTENING);
    document.removeEventListener('mouseout', this.onOut, LISTENING);
    removeEventListener('scroll', this.onScroll, LISTENING);
    this.names = publish(new Map(), this.names);
    this.byNode.clear();
    this.tip.remove();
  }

  private readonly scheduleRefresh = (): void => {
    this.refreshFrame ||= requestAnimationFrame(this.refresh);
  };

  private readonly refresh = (): void => {
    this.refreshFrame = 0;
    const groups = new Map<string, Highlight>();
    const byNode = new Map<Node, HighlightedChange[]>();
    const roots = new Set<ShadowRoot>();
    for (const highlighted of this.rewriter.highlights()) {
      const name = nameOf(highlighted.change);
      let group = groups.get(name);
      if (!group) groups.set(name, (group = new Highlight()));
      group.add(highlighted.range);

      const node = highlighted.range.startContainer;
      const list = byNode.get(node);
      if (list) {
        list.push(highlighted);
        continue;
      }
      byNode.set(node, [highlighted]);
      let top = node.getRootNode();
      while (isShadowRoot(top) && !roots.has(top)) {
        roots.add(top);
        top = top.host.getRootNode();
      }
    }

    this.names = publish(groups, this.names);
    this.byNode = byNode;
    this.shadowRoots = [...roots];
    if (this.tip.showing) this.hover();
  };

  private readonly onMove = (event: MouseEvent): void => {
    this.pointer = [event.clientX, event.clientY];
    this.hoverFrame ||= requestAnimationFrame(this.hover);
  };

  private readonly onOut = (event: MouseEvent): void => {
    // A null relatedTarget means the pointer left the window.
    if (event.relatedTarget) return;
    this.pointer = null;
    this.tip.hide();
  };

  private readonly onScroll = (): void => {
    this.tip.hide();
  };

  private readonly hover = (): void => {
    this.hoverFrame = 0;
    const found = this.pointer ? this.changeAt(...this.pointer) : null;
    if (found) this.tip.show(found[0].change, found[1], this.actionsFor(found[0].change));
    else this.tip.hideSoon();
  };

  private actionsFor({ ruleId }: Change): TipAction[] {
    if (!this.rules.canSwitchOff(ruleId)) return [];
    return [{ label: 'Switch off this rule', run: () => this.rules.switchOff(ruleId) }];
  }

  /** The change under a point, with the box of the line it is on. */
  private changeAt(x: number, y: number): [HighlightedChange, DOMRect] | null {
    const caret = caretAt(x, y, this.shadowRoots);
    if (!caret) return null;
    const [node, offset] = caret;
    for (const highlighted of this.byNode.get(node) ?? []) {
      const { startOffset, endOffset } = highlighted.range;
      if (offset < startOffset || offset > endOffset) continue;
      for (const rect of live(highlighted.range)?.getClientRects() ?? []) {
        if (within(rect, x, y)) return [highlighted, rect];
      }
    }
    return null;
  }
}

function caretAt(x: number, y: number, shadowRoots: ShadowRoot[]): [Node, number] | null {
  // Chrome and Edge before 128 have only the older, non-standard call.
  if (document.caretPositionFromPoint) {
    // A caret inside a root left off this list is reported at the root's host.
    const position = document.caretPositionFromPoint(x, y, { shadowRoots });
    return position ? [position.offsetNode, position.offset] : null;
  }
  const range = document.caretRangeFromPoint(x, y);
  return range ? [range.startContainer, range.startOffset] : null;
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && Boolean((node as ShadowRoot).host);
}
