import type { Change } from '../../src/types.js';

/** A button on the description of a change. */
export interface TipAction {
  label: string;
  run(): void;
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
export class Tip {
  private host: HTMLElement | null = null;
  private box!: HTMLElement;
  private card!: HTMLElement;
  private shown: Change | null = null;
  private hovered = false;
  private sticky = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  get showing(): boolean {
    return this.shown !== null;
  }

  /** Whether an event's target is this description. Its own elements are hidden from the page. */
  owns(target: EventTarget | null): boolean {
    return target !== null && target === this.host;
  }

  /**
   * Shows a change below the line it is on. A sticky description stays open when the pointer
   * leaves it, and keeps the focus where it was when it is clicked.
   */
  show(change: Change, line: DOMRect, actions: TipAction[] = [], sticky = false): void {
    this.cancelHide();
    if (change === this.shown) return;
    this.mount();
    this.fill(change, actions);
    if (!this.box.matches(':popover-open')) this.box.showPopover();
    this.shown = change;
    this.sticky = sticky;

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
    // The rewriter enters closed roots too, and the card quotes each American original.
    this.host.setAttribute('translate', 'no');
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
      if (!this.sticky) this.hideSoon();
    });
    // A click would otherwise move the focus, and the selection with it, out of the editor.
    this.card.addEventListener('mousedown', (event) => {
      if (this.sticky) event.preventDefault();
    });
    this.box.append(this.card);
    root.append(this.box);
    document.documentElement.append(this.host);
  }

  private fill(change: Change, actions: TipAction[]): void {
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

    const buttons = document.createElement('span');
    buttons.style.cssText = 'display: flex; gap: 14px; margin-top: 6px;';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.style.cssText =
        `all: initial; font: inherit; color: ${colours.accent}; ` +
        `text-decoration: underline; cursor: pointer;`;
      button.addEventListener('click', () => {
        this.hide();
        action.run();
      });
      buttons.append(button);
    }

    this.card.replaceChildren(
      code(change.before),
      ' → ',
      code(change.after),
      line(`${change.ruleId} · ${change.confidence}`),
      ...(change.note ? [line(change.note)] : []),
      ...(actions.length > 0 ? [buttons] : []),
    );
  }
}
