import { canHostShadowRoot, type ShadowLookup } from '../../src/dom/segment.js';
import {
  WritingSuggestions,
  writingTarget,
  type PlacedSuggestion,
  type Suggestion,
  type TextField,
  type WritingTarget,
} from '../../src/dom/suggest.js';
import type { Change, Options } from '../../src/types.js';
import { Tip } from './tip.js';

const LISTENING: AddEventListenerOptions = { capture: true, passive: true };

/** How long typing has to pause before the text is read again, in milliseconds. */
const PAUSE = 300;

/** Must match the selectors in highlight.css. */
function nameOf(change: Change): string {
  return `deamericanise-suggest-${change.category}-${change.confidence}`;
}

/** A suggestion marked in the text being written. */
interface Mark {
  change: Change;
  /**
   * A live range, so the mark moves with the text as it is typed. For a text field, it
   * covers the copy of the field's text in the mirror.
   */
  range: Range;
  /** What Ignore stops suggesting, in lower case. */
  word: string;
  replace(): void;
}

/**
 * Marks what would change in the text field or editable element that has the focus, and
 * offers each change when it is clicked. It changes the text only when asked to, through
 * the browser's editing commands, so the page's editor sees an ordinary edit and undo works.
 */
export class Suggester {
  private suggestions: WritingSuggestions;
  private target: WritingTarget | null = null;
  private marks: Mark[] = [];
  private names = new Set<string>();
  /** Words not to suggest again until the page reloads. */
  private readonly ignored = new Set<string>();
  private readonly tip = new Tip();
  private readonly mirror = new Mirror();
  private readonly observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private placeFrame = 0;
  private composing = false;
  private stopped = false;

  constructor(
    options: Options,
    private readonly shadowRootOf: ShadowLookup,
  ) {
    this.suggestions = new WritingSuggestions(options);
    // An editor can change its text without an input event, as when it adds a signature.
    this.observer = new MutationObserver(this.changed);
    document.addEventListener('focusin', this.onFocus, LISTENING);
    document.addEventListener('focusout', this.onBlur, LISTENING);
    document.addEventListener('input', this.onInput, LISTENING);
    document.addEventListener('compositionstart', this.onCompositionStart, LISTENING);
    document.addEventListener('compositionend', this.onCompositionEnd, LISTENING);
    document.addEventListener('click', this.onClick, LISTENING);
    document.addEventListener('keydown', this.onKey, LISTENING);
    addEventListener('scroll', this.onScroll, LISTENING);
    addEventListener('resize', this.onScroll, LISTENING);
    this.onFocus();
  }

  /** Reads the text being written again with new options. Throws on options it rejects. */
  setOptions(options: Options): void {
    this.suggestions = new WritingSuggestions(options);
    this.unmark();
    this.scan();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('focusin', this.onFocus, LISTENING);
    document.removeEventListener('focusout', this.onBlur, LISTENING);
    document.removeEventListener('input', this.onInput, LISTENING);
    document.removeEventListener('compositionstart', this.onCompositionStart, LISTENING);
    document.removeEventListener('compositionend', this.onCompositionEnd, LISTENING);
    document.removeEventListener('click', this.onClick, LISTENING);
    document.removeEventListener('keydown', this.onKey, LISTENING);
    removeEventListener('scroll', this.onScroll, LISTENING);
    removeEventListener('resize', this.onScroll, LISTENING);
    this.follow(null);
    this.tip.remove();
    this.mirror.remove();
  }

  // ------------------------------- Following the focus -------------------------------

  /** The element with the focus, inside shadow roots too. */
  private focused(): Element | null {
    let element = document.activeElement;
    for (;;) {
      const root = element && canHostShadowRoot(element) ? this.shadowRootOf(element) : null;
      if (!root?.activeElement) return element;
      element = root.activeElement;
    }
  }

  private readonly onFocus = (): void => {
    if (this.stopped) return;
    const element = this.focused();
    this.follow(element ? writingTarget(element) : null);
  };

  /** The focus has not moved anywhere yet when it leaves an element. */
  private readonly onBlur = (): void => {
    setTimeout(this.onFocus, 0);
  };

  private follow(target: WritingTarget | null): void {
    if (target?.element === this.target?.element) return;
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.unmark();
    this.tip.hide();
    this.mirror.hide();
    this.target = target;
    if (!target) return;
    if (target.kind === 'editable') {
      const text = { childList: true, subtree: true, characterData: true };
      this.observer.observe(target.element, text);
    }
    this.scan();
  }

  private readonly onInput = (): void => {
    if (this.target?.kind !== 'field') return;
    // Before the next paint, so the marks never sit over the wrong characters.
    this.mirror.follow(this.target.element.value);
    this.changed();
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
    this.changed();
  };

  private readonly onCompositionEnd = (): void => {
    this.composing = false;
    this.changed();
  };

  /** The marks move with the text, and the text is read again once typing pauses. */
  private readonly changed = (): void => {
    clearTimeout(this.timer);
    this.tip.hide();
    if (!this.composing) this.timer = setTimeout(this.scan, PAUSE);
  };

  // ------------------------------- Marking -------------------------------

  private readonly scan = (): void => {
    this.timer = undefined;
    const target = this.target;
    if (!target) return;
    if (!target.element.isConnected) {
      this.follow(null);
      return;
    }
    if (target.kind === 'field') {
      const field = target.element;
      const value = field.value;
      const found = this.suggestions.inText(value).filter((s) => !this.ignored.has(wordOf(s)));
      if (found.length === 0) {
        this.mirror.hide();
        this.paint([]);
        return;
      }
      const text = this.mirror.show(field, value);
      this.paint(found.map((suggestion) => this.fieldMark(field, text, suggestion)));
    } else {
      const found = this.suggestions
        .inEditable(target.element, this.shadowRootOf)
        .filter((s) => !this.ignored.has(wordOf(s)));
      this.paint(found.flatMap((suggestion) => this.editableMark(suggestion) ?? []));
    }
  };

  private paint(marks: Mark[]): void {
    this.marks = marks;
    const groups = new Map<string, Highlight>();
    for (const mark of marks) {
      const name = nameOf(mark.change);
      let group = groups.get(name);
      if (!group) groups.set(name, (group = new Highlight()));
      group.add(mark.range);
    }
    for (const name of this.names) {
      if (!groups.has(name)) CSS.highlights.delete(name);
    }
    for (const [name, group] of groups) CSS.highlights.set(name, group);
    this.names = new Set(groups.keys());
  }

  private unmark(): void {
    if (this.marks.length > 0 || this.names.size > 0) this.paint([]);
  }

  private fieldMark(field: TextField, text: Text, suggestion: Suggestion): Mark {
    const { change } = suggestion;
    const range = document.createRange();
    range.setStart(text, change.start);
    range.setEnd(text, change.end);
    const replace = () => this.replaceInField(field, change, range);
    return { change, range, word: wordOf(suggestion), replace };
  }

  /** Null when the page has changed the text since it was read. */
  private editableMark(suggestion: PlacedSuggestion): Mark | null {
    const { change } = suggestion;
    const range = live(suggestion.range);
    const edits = suggestion.edits.map(({ range, after }) => ({ range: live(range), after }));
    if (!range || edits.some((edit) => !edit.range)) return null;
    const replace = () => this.replaceInEditable(change, range, edits as LiveEdit[]);
    return { change, range, word: wordOf(suggestion), replace };
  }

  // ------------------------------- Offering a change -------------------------------

  private readonly onClick = (event: MouseEvent): void => {
    if (this.tip.owns(event.target)) return;
    if (this.target?.kind === 'field') this.mirror.place();
    const found = this.markAt(event.clientX, event.clientY);
    if (!found) {
      this.tip.hide();
      return;
    }
    const [mark, line] = found;
    this.tip.show(
      mark.change,
      line,
      [
        { label: 'Replace', run: mark.replace },
        { label: 'Ignore', run: () => this.ignore(mark.word) },
      ],
      true,
    );
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.tip.hide();
  };

  private readonly onScroll = (): void => {
    this.tip.hide();
    if (this.target?.kind === 'field') this.placeFrame ||= requestAnimationFrame(this.place);
  };

  private readonly place = (): void => {
    this.placeFrame = 0;
    this.mirror.place();
  };

  /** The mark under a point, with the box of the line it is on. */
  private markAt(x: number, y: number): [Mark, DOMRect] | null {
    // Text scrolled out of view still has boxes, out past the edges of the field.
    const area = this.target?.element.getBoundingClientRect();
    if (!area || !within(area, x, y)) return null;
    for (const mark of this.marks) {
      for (const rect of mark.range.getClientRects()) {
        if (within(rect, x, y)) return [mark, rect];
      }
    }
    return null;
  }

  private ignore(word: string): void {
    this.ignored.add(word);
    this.paint(this.marks.filter((mark) => mark.word !== word));
  }

  /**
   * A field's text is plain, so one replacement covers an article fix and its word together.
   * The mark's range in the mirror says where the change sits now, after any typing.
   */
  private replaceInField(field: TextField, { before, after }: Change, range: Range): void {
    const { startOffset: start, endOffset: end } = range;
    if (field.value.slice(start, end) !== before) {
      this.changed();
      return;
    }
    field.focus();
    field.setSelectionRange(start, end);
    if (insert(after)) return;
    // Where the editing commands do not reach the field, the page still needs its input event.
    field.setRangeText(after, start, end, 'end');
    const inputType = 'insertReplacementText';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: after }));
  }

  /**
   * An editor keeps its own model of the text and expects every edit as an input event, so
   * its text nodes are never written directly.
   */
  private replaceInEditable(change: Change, whole: Range, edits: LiveEdit[]): void {
    const connected = edits.every(({ range }) => range.startContainer.isConnected);
    if (whole.toString() !== change.before || !connected) {
      this.changed();
      return;
    }
    const selection = getSelection();
    if (!selection) return;
    for (const { range, after } of edits) {
      const { startContainer, startOffset, endContainer, endOffset } = range;
      selection.setBaseAndExtent(startContainer, startOffset, endContainer, endOffset);
      if (!insert(after)) return;
    }
    // The last edit is the first in the text, and typing carries on after the whole change.
    if (edits.length > 1 && whole.endContainer.isConnected) {
      selection.collapse(whole.endContainer, whole.endOffset);
    }
  }
}

interface LiveEdit {
  range: Range;
  after: string;
}

/**
 * The single edit that turns `before` into `after`: where it starts, how many characters it
 * replaces and what it puts in their place. Typing makes one such edit at a time.
 */
export function textEdit(
  before: string,
  after: string,
): [start: number, count: number, data: string] {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  const same = (i: number) => before[before.length - 1 - i] === after[after.length - 1 - i];
  while (end < shorter - start && same(end)) end++;
  return [start, before.length - start - end, after.slice(start, after.length - end)];
}

function within(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The word Ignore stops suggesting. */
function wordOf(suggestion: Suggestion | PlacedSuggestion): string {
  return suggestion.found.before.toLowerCase();
}

/** Replaces the selection through the browser's editing commands, which keep the undo history. */
function insert(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  if (text === '') return document.execCommand('delete');
  return document.execCommand('insertText', false, text);
}

/** A live range for a static one, or null when the page has since changed the text under it. */
function live(range: StaticRange): Range | null {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  const fits = (node: Node, offset: number) => node.isConnected && offset <= (node as Text).length;
  if (!fits(startContainer, startOffset) || !fits(endContainer, endOffset)) return null;
  const out = document.createRange();
  out.setStart(startContainer, startOffset);
  out.setEnd(endContainer, endOffset);
  return out;
}

/** The styles that decide where each character of a field's text is laid out. */
const LAYOUT = [
  'direction',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'hyphens',
  'letter-spacing',
  'line-height',
  'overflow-wrap',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'tab-size',
  'text-align',
  'text-indent',
  'text-rendering',
  'text-transform',
  'word-break',
  'word-spacing',
];

/**
 * A copy of a text field's text, laid over the field. The CSS Custom Highlight API paints
 * nothing over the value of a field, so the marks go on the copy. The copy's text is
 * transparent and lets every pointer event through to the field.
 *
 * It sits in the light DOM, where the `::highlight` rules in highlight.css reach it in every
 * browser, and in the top layer, so a field in a modal dialogue is not drawn over it.
 */
class Mirror {
  private host: HTMLElement | null = null;
  private box!: HTMLElement;
  private text!: Text;
  private field: TextField | null = null;
  private readonly resizes = new ResizeObserver(() => this.place());

  /** Shows `value` over `field`, and returns the text node that holds it. */
  show(field: TextField, value: string): Text {
    this.mount();
    if (field !== this.field) {
      this.resizes.disconnect();
      this.resizes.observe(field);
      this.field = field;
    }
    this.sync(value);
    if (!this.box.matches(':popover-open')) this.box.showPopover();
    this.place();
    return this.text;
  }

  /** Takes the field's new value while the copy is shown, as the field took it: as one edit. */
  follow(value: string): void {
    if (!this.field) return;
    this.sync(value);
    this.place();
  }

  /** Changes only what differs, so a live range over the rest of the copy keeps its place. */
  private sync(value: string): void {
    // A final line break starts a line of its own only when something follows it.
    const shown = value.endsWith('\n') ? `${value} ` : value;
    const [start, count, data] = textEdit(this.text.data, shown);
    if (count > 0 || data !== '') this.text.replaceData(start, count, data);
  }

  hide(): void {
    this.resizes.disconnect();
    this.field = null;
    if (this.host && this.box.matches(':popover-open')) this.box.hidePopover();
  }

  remove(): void {
    this.hide();
    this.host?.remove();
    this.host = null;
  }

  /** Lays the copy over the field's padding box, and scrolls it the way the field is scrolled. */
  place(): void {
    const field = this.field;
    if (!field || !this.host) return;
    const style = getComputedStyle(field);
    const rect = field.getBoundingClientRect();
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    const declarations = [
      'position: fixed',
      `left: ${rect.left + px('border-left-width')}px`,
      `top: ${rect.top + px('border-top-width')}px`,
      // The client size leaves out a scroll bar, so the copy wraps where the field does.
      `width: ${field.clientWidth}px`,
      `height: ${field.clientHeight}px`,
      'box-sizing: border-box',
      'margin: 0',
      'border: 0',
      'overflow: hidden',
      'background: transparent',
      'color: transparent',
      'pointer-events: none',
      'user-select: none',
      ...LAYOUT.map((name) => `${name}: ${style.getPropertyValue(name)}`),
    ];
    if (field.localName === 'input') {
      // An input draws its one line in the middle of its height, as a line box that tall does.
      const height = field.clientHeight - px('padding-top') - px('padding-bottom');
      declarations.push('white-space: pre', `line-height: ${height}px`);
    } else {
      declarations.push(`white-space: ${style.whiteSpace}`);
    }
    // Important, so no rule on the page can move a character of the copy. No `display` is
    // set, since one would keep the box on screen while the popover is closed.
    this.box.style.cssText = declarations.map((style) => `${style} !important`).join(';');
    this.box.scrollTop = field.scrollTop;
    this.box.scrollLeft = field.scrollLeft;
  }

  private mount(): void {
    if (this.host?.isConnected) return;
    if (!this.host) {
      this.host = document.createElement('deamericanise-mirror');
      // Keeps the rewriter from rewriting the copy of what is being written.
      this.host.setAttribute('translate', 'no');
      this.box = document.createElement('div');
      this.box.popover = 'manual';
      this.text = document.createTextNode('');
      this.box.append(this.text);
      this.host.append(this.box);
    }
    document.documentElement.append(this.host);
  }
}
