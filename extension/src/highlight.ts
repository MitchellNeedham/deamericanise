import type { DomRewriter, HighlightedChange } from '../../src/dom/index.js';
import type { Change } from '../../src/types.js';

const LISTENING: AddEventListenerOptions = { capture: true, passive: true };

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
  private refreshFrame = 0;
  private hoverFrame = 0;
  private pointer: [x: number, y: number] | null = null;
  private readonly tip: Tip;

  constructor(
    private readonly rewriter: DomRewriter,
    rules: RuleSwitch,
  ) {
    this.tip = new Tip(rules);
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
    for (const name of this.names) CSS.highlights.delete(name);
    this.names.clear();
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
    for (const highlighted of this.rewriter.highlights()) {
      const name = nameOf(highlighted.change);
      let group = groups.get(name);
      if (!group) groups.set(name, (group = new Highlight()));
      group.add(highlighted.range);

      const node = highlighted.range.startContainer;
      const list = byNode.get(node);
      if (list) list.push(highlighted);
      else byNode.set(node, [highlighted]);
    }

    for (const name of this.names) {
      if (!groups.has(name)) CSS.highlights.delete(name);
    }
    for (const [name, group] of groups) CSS.highlights.set(name, group);
    this.names = new Set(groups.keys());
    this.byNode = byNode;
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
    if (found) this.tip.show(found[0].change, found[1]);
    else this.tip.hideSoon();
  };

  /** The change under a point, with the box of the line it is on. */
  private changeAt(x: number, y: number): [HighlightedChange, DOMRect] | null {
    const caret = caretAt(x, y);
    if (!caret) return null;
    const [node, offset] = caret;
    for (const highlighted of this.byNode.get(node) ?? []) {
      const { startOffset, endOffset } = highlighted.range;
      // A static range is not kept up to date, so the page may have shortened the node.
      if (offset < startOffset || offset > endOffset || endOffset > (node as Text).length) continue;
      const range = document.createRange();
      range.setStart(node, startOffset);
      range.setEnd(node, endOffset);
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return [highlighted, rect];
        }
      }
    }
    return null;
  }
}

function caretAt(x: number, y: number): [Node, number] | null {
  // Chrome and Edge before 128 have only the older, non-standard call.
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? [position.offsetNode, position.offset] : null;
  }
  const range = document.caretRangeFromPoint(x, y);
  return range ? [range.startContainer, range.startOffset] : null;
}

const LIGHT = {
  background: '#ffffff',
  text: '#1c2421',
  muted: '#5d6b66',
  line: '#d9e0dd',
  accent: '#1d5c4f',
};
const DARK = {
  background: '#1e2522',
  text: '#e6ecea',
  muted: '#9aa8a3',
  line: '#2d3734',
  accent: '#5fbfa6',
};

/** Long enough to move the pointer across the gap between a change and its description. */
const HIDE_DELAY = 300;


/**
 * The description of one change. It sits in a closed shadow root so the page's styles
 * cannot reach it, and in the top layer so nothing on the page covers it.
 */
class Tip {
  private host: HTMLElement | null = null;
  private box!: HTMLElement;
  private card!: HTMLElement;
  private shown: Change | null = null;
  private hovered = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly rules: RuleSwitch) {}

  get showing(): boolean {
    return this.shown !== null;
  }

  show(change: Change, line: DOMRect): void {
    this.cancelHide();
    if (change === this.shown) return;
    this.mount();
    this.fill(change);
    if (!this.box.matches(':popover-open')) this.box.showPopover();
    this.shown = change;

    const width = this.box.offsetWidth;
    const height = this.box.offsetHeight;
    const left = Math.max(8, Math.min(line.left, innerWidth - width - 8));
    const below = line.bottom + 8;
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, line.top - height - 8);
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
  }

  /** Keeps the description open while the pointer is on its way to it, or on it. */
  hideSoon(): void {
    if (!this.shown || this.hovered || this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      if (!this.hovered) this.hide();
    }, HIDE_DELAY);
  }

  hide(): void {
    this.cancelHide();
    this.hovered = false;
    if (!this.shown) return;
    if (this.box.matches(':popover-open')) this.box.hidePopover();
    this.shown = null;
  }

  private cancelHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  remove(): void {
    this.cancelHide();
    this.host?.remove();
    this.host = null;
    this.shown = null;
  }

  private mount(): void {
    if (this.host?.isConnected) return;
    if (this.host) {
      document.documentElement.append(this.host);
      return;
    }

    this.host = document.createElement('deamericanise-tip');
    const root = this.host.attachShadow({ mode: 'closed' });
    this.box = document.createElement('div');
    this.box.popover = 'manual';
    // Styles are set through the CSSOM, which a page's content security policy allows.
    this.box.style.cssText =
      'position: fixed; inset: auto; margin: 0; padding: 0; border: 0; overflow: visible; ' +
      'background: transparent; pointer-events: none;';
    this.card = document.createElement('div');
    this.card.addEventListener('pointerenter', () => {
      this.hovered = true;
      this.cancelHide();
    });
    this.card.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.hideSoon();
    });
    this.box.append(this.card);
    root.append(this.box);
    document.documentElement.append(this.host);
  }

  private fill(change: Change): void {
    const colours = matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
    // `all: initial` keeps the page's inherited styles, such as its font, out of the card.
    this.card.style.cssText =
      `all: initial; display: block; max-width: 352px; padding: 7px 10px; ` +
      `font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; ` +
      `color: ${colours.text}; background: ${colours.background}; ` +
      `border: 1px solid ${colours.line}; border-radius: 8px; ` +
      `box-shadow: 0 6px 24px rgb(0 0 0 / 18%); pointer-events: auto;`;

    const code = (text: string) => {
      const element = document.createElement('b');
      element.textContent = text;
      element.style.cssText = 'font-family: ui-monospace, monospace; font-weight: 600;';
      return element;
    };
    const line = (text: string) => {
      const element = document.createElement('span');
      element.textContent = text;
      element.style.cssText = `display: block; margin-top: 4px; color: ${colours.muted};`;
      return element;
    };

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Switch off this rule';
    button.style.cssText =
      `all: initial; display: block; margin-top: 6px; font: inherit; color: ${colours.accent}; ` +
      `text-decoration: underline; cursor: pointer;`;
    button.addEventListener('click', () => {
      this.hide();
      this.rules.switchOff(change.ruleId);
    });

    this.card.replaceChildren(
      code(change.before),
      ' → ',
      code(change.after),
      line(`${change.ruleId} · ${change.confidence}`),
      ...(change.note ? [line(change.note)] : []),
      ...(this.rules.canSwitchOff(change.ruleId) ? [button] : []),
    );
  }
}
