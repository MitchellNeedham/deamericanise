import { hostOf, hostsOnly, type ShadowLookup } from '../../src/dom/segment.js';
import {
  EditableSuggestions,
  WritingSuggestions,
  writingTarget,
  type PlacedSuggestion,
  type Suggestion,
  type TextField,
  type WritingTarget,
} from '../../src/dom/suggest.js';
import type { Change, Options } from '../../src/types.js';
import { LISTENING, live, publish, within } from './marks.js';
import { Tip, type TipAction } from './tip.js';

/** How long typing has to pause before the text is read again, in milliseconds. */
const PAUSE = 300;

/** How long one part of a long read may hold up the page, in milliseconds. */
const SLICE = 8;

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

interface LiveEdit {
  range: Range;
  after: string;
}

/**
 * Marks what would change in the text field or editable element that has the focus, and
 * offers each change when it is clicked. It changes the text only when asked to, through
 * the browser's editing commands, so the page's editor sees an ordinary edit and undo works.
 */
export class Suggester {
  private suggestions: WritingSuggestions;
  private readonly lookup: ShadowLookup;
  private target: WritingTarget | null = null;
  /** Follows the focused editable element as it changes. */
  private reader: EditableSuggestions | null = null;
  /** The mark of each suggestion already placed, which has moved with the text since. */
  private placed = new WeakMap<PlacedSuggestion, Mark | null>();
  /** A text field's value when last seen, so a value a script sets is noticed. */
  private value = '';
  private marks: Mark[] = [];
  private names = new Set<string>();
  /** Words not to suggest again while this suggester runs. */
  private readonly ignored = new Set<string>();
  private readonly tip = new Tip();
  private readonly mirror = new Mirror();
  private readonly observer: MutationObserver;
  /** The shadow roots around a text field, whose scrolling never reaches the window. */
  private scrollers: ShadowRoot[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private placeFrame = 0;
  private composing = false;
  private stopped = false;

  constructor(
    options: Options,
    private readonly shadowRootOf: ShadowLookup,
  ) {
    this.suggestions = new WritingSuggestions(options);
    this.lookup = hostsOnly(shadowRootOf);
    // An editor can change its text without an input event, as when it adds a signature.
    this.observer = new MutationObserver(this.onMutations);
    document.addEventListener('focusin', this.onFocus, LISTENING);
    document.addEventListener('focusout', this.onBlur, LISTENING);
    document.addEventListener('input', this.onInput, LISTENING);
    document.addEventListener('compositionstart', this.onCompositionStart, LISTENING);
    document.addEventListener('compositionend', this.onCompositionEnd, LISTENING);
    document.addEventListener('click', this.onClick, LISTENING);
    document.addEventListener('keydown', this.onKeyDown, LISTENING);
    document.addEventListener('keyup', this.check, LISTENING);
    document.addEventListener('reset', this.onReset, LISTENING);
    addEventListener('scroll', this.onViewport, LISTENING);
    addEventListener('resize', this.onViewport, LISTENING);
    this.onFocus();
  }

  /** Reads the text being written again with new options. Throws on options it rejects. */
  setOptions(options: Options): void {
    this.suggestions = new WritingSuggestions(options);
    const target = this.target;
    this.follow(null);
    this.follow(target);
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('focusin', this.onFocus, LISTENING);
    document.removeEventListener('focusout', this.onBlur, LISTENING);
    document.removeEventListener('input', this.onInput, LISTENING);
    document.removeEventListener('compositionstart', this.onCompositionStart, LISTENING);
    document.removeEventListener('compositionend', this.onCompositionEnd, LISTENING);
    document.removeEventListener('click', this.onClick, LISTENING);
    document.removeEventListener('keydown', this.onKeyDown, LISTENING);
    document.removeEventListener('keyup', this.check, LISTENING);
    document.removeEventListener('reset', this.onReset, LISTENING);
    removeEventListener('scroll', this.onViewport, LISTENING);
    removeEventListener('resize', this.onViewport, LISTENING);
    cancelAnimationFrame(this.placeFrame);
    this.follow(null);
    this.tip.remove();
    this.mirror.remove();
  }

  // ------------------------------- Following the focus -------------------------------

  /** The element with the focus, inside shadow roots too. */
  private focused(): Element | null {
    let element = document.activeElement;
    for (;;) {
      const root = element ? this.lookup(element) : null;
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
    this.timer = undefined;
    this.observer.disconnect();
    for (const root of this.scrollers) root.removeEventListener('scroll', this.onViewport, LISTENING);
    this.scrollers = [];
    this.unmark();
    this.tip.hide();
    this.mirror.hide();
    this.target = target;
    this.reader = null;
    this.placed = new WeakMap();
    if (!target) return;

    if (target.kind === 'editable') {
      this.reader = new EditableSuggestions(target.element, this.suggestions, this.shadowRootOf);
      const text = { childList: true, subtree: true, characterData: true };
      this.observer.observe(target.element, text);
    } else {
      this.value = target.element.value;
      for (let root = target.element.getRootNode(); hostOf(root); root = hostOf(root)!.getRootNode()) {
        this.scrollers.push(root as ShadowRoot);
        root.addEventListener('scroll', this.onViewport, LISTENING);
      }
    }
    this.scan();
  }

  private readonly onMutations = (records: MutationRecord[]): void => {
    this.reader?.note(records);
    this.schedule();
  };

  /** Typing closes the description. A change the page makes on its own leaves it open. */
  private readonly onInput = (): void => {
    if (this.target?.kind === 'field') this.fieldChanged();
    else if (this.target) this.tip.hide();
  };

  /** Notices a value a script set, which comes with no input event. */
  private readonly check = (): void => {
    if (this.target?.kind === 'field' && this.target.element.value !== this.value) this.fieldChanged();
  };

  /** A form's fields take their default values after the event. */
  private readonly onReset = (): void => {
    setTimeout(this.check, 0);
  };

  private fieldChanged(): void {
    if (this.target?.kind !== 'field') return;
    this.value = this.target.element.value;
    // Before the next paint, so the marks never sit over the wrong characters.
    this.mirror.update(this.value);
    this.tip.hide();
    this.schedule();
  }

  private readonly onCompositionStart = (): void => {
    this.composing = true;
    this.tip.hide();
    clearTimeout(this.timer);
  };

  private readonly onCompositionEnd = (): void => {
    this.composing = false;
    this.schedule();
  };

  /** The marks move with the text, and the text is read again once typing pauses. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = this.composing ? undefined : setTimeout(this.scan, PAUSE);
  }

  // ------------------------------- Marking -------------------------------

  private readonly scan = (): void => {
    this.timer = undefined;
    const target = this.target;
    if (!target) return;
    if (!target.element.isConnected) {
      this.follow(null);
      return;
    }
    if (target.kind === 'field') this.scanField(target.element);
    else this.scanEditable();
  };

  private scanField(field: TextField): void {
    this.value = field.value;
    const found = this.suggestions
      .inText(this.value)
      .filter(({ change }) => this.wanted(change) && fits(field, change.start, change.end, change.after));
    if (found.length === 0) {
      this.mirror.hide();
      this.paint([]);
      return;
    }
    const text = this.mirror.show(field, this.value);
    this.paint(found.map((suggestion) => this.fieldMark(field, text, suggestion)));
  }

  private scanEditable(): void {
    const end = performance.now() + SLICE;
    const { suggestions, done } = this.reader!.read(() => performance.now() < end);
    this.paint(suggestions.flatMap((suggestion) => this.editableMark(suggestion) ?? []));
    // A long read carries on in the next task, so the page can answer the reader in between.
    if (!done) this.timer = setTimeout(this.scan, 0);
  }

  private wanted(change: Change): boolean {
    return !this.ignored.has(wordOf(change));
  }

  private paint(marks: Mark[]): void {
    this.marks = marks;
    const groups = new Map<string, Highlight>();
    for (const mark of marks) {
      const name = nameOf(mark.change);
      let group = groups.get(name);
      if (!group) groups.set(name, (group = new Highlight()));
      group.add(mark.range);
    }
    this.names = publish(groups, this.names);
  }

  private unmark(): void {
    if (this.marks.length > 0 || this.names.size > 0) this.paint([]);
  }

  private fieldMark(field: TextField, text: Text, { change, found }: Suggestion): Mark {
    const range = document.createRange();
    range.setStart(text, change.start);
    range.setEnd(text, change.end);
    const replace = () => this.replaceInField(field, change, range);
    return { change, range, word: wordOf(found), replace };
  }

  /** Null for a suggestion that is ignored, or whose text the page has changed since. */
  private editableMark(suggestion: PlacedSuggestion): Mark | null {
    if (!this.wanted(suggestion.found)) return null;
    if (this.placed.has(suggestion)) return this.placed.get(suggestion)!;
    const { change, found } = suggestion;
    const range = live(suggestion.range);
    const edits = suggestion.edits.map(({ range, after }) => ({ range: live(range), after }));
    let mark: Mark | null = null;
    if (range && edits.every((edit) => edit.range)) {
      const replace = () => this.replaceInEditable(change, range, edits as LiveEdit[]);
      mark = { change, range, word: wordOf(found), replace };
    }
    this.placed.set(suggestion, mark);
    return mark;
  }

  // ------------------------------- Offering a change -------------------------------

  private readonly onClick = (event: MouseEvent): void => {
    if (this.tip.owns(event.target)) return;
    this.check();
    const target = this.target;
    if (target?.kind === 'field') this.mirror.place();
    const found = target ? this.markAt(target.element, event.clientX, event.clientY) : null;
    if (!found) {
      this.tip.hide();
      return;
    }
    const [mark, line] = found;
    const actions: TipAction[] = [
      { label: 'Replace', run: mark.replace },
      { label: 'Ignore', run: () => this.ignore(mark.word) },
    ];
    this.tip.show(mark.change, line, actions, { sticky: true, beside: target!.element });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.tip.hide();
  };

  private readonly onViewport = (): void => {
    this.tip.hide();
    if (this.target?.kind === 'field') this.placeFrame ||= requestAnimationFrame(this.place);
  };

  private readonly place = (): void => {
    this.placeFrame = 0;
    this.mirror.place();
  };

  /** The mark under a point, with the box of the line it is on. */
  private markAt(element: Element, x: number, y: number): [Mark, DOMRect] | null {
    // Text scrolled out of view still has boxes, out past the edges of the field.
    if (!within(element.getBoundingClientRect(), x, y)) return null;
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
    if (field.value.slice(start, end) !== before || !fits(field, start, end, after)) {
      this.schedule();
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
      this.schedule();
      return;
    }
    const selection = getSelection();
    if (!selection) return;
    let caret: Range | null = null;
    for (const { range, after } of edits) {
      const { startContainer, startOffset, endContainer, endOffset } = range;
      selection.setBaseAndExtent(startContainer, startOffset, endContainer, endOffset);
      if (!insert(after)) return;
      // The first edit is the last in the text, and typing carries on after the whole change.
      caret ??= selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    }
    if (edits.length > 1 && caret?.startContainer.isConnected) {
      selection.collapse(caret.startContainer, caret.startOffset);
    }
  }
}

/** The word Ignore stops suggesting. */
function wordOf(found: Change): string {
  return found.before.toLowerCase();
}

/**
 * Whether a field has room to replace the text from `start` to `end` with `after`. An edit
 * past a field's `maxlength` is cut short, and would leave half a word.
 */
export function fits(field: TextField, start: number, end: number, after: string): boolean {
  return field.maxLength < 0 || field.value.length - (end - start) + after.length <= field.maxLength;
}

/** Replaces the selection through the browser's editing commands, which keep the undo history. */
function insert(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  if (text === '') return document.execCommand('delete');
  return document.execCommand('insertText', false, text);
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

/**
 * Changes a mirror's text to a field's value in one edit, so a live range over the rest of it
 * keeps its place. A final line break starts a line of its own only when something follows it,
 * so a space goes after one.
 */
export function syncText(text: Text, value: string): void {
  const shown = value.endsWith('\n') ? `${value} ` : value;
  const [start, count, data] = textEdit(text.data, shown);
  if (count > 0 || data !== '') text.replaceData(start, count, data);
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

/** Styles a page's rules for popovers could set on the mirror's box, put back to their defaults. */
const NEUTRAL = [
  'right: auto',
  'bottom: auto',
  'margin: 0',
  'border: 0',
  'min-width: 0',
  'max-width: none',
  'min-height: 0',
  'max-height: none',
  'transform: none',
  'translate: none',
  'scale: none',
  'rotate: none',
  'zoom: 1',
  'filter: none',
  'opacity: 1',
  'visibility: visible',
  'outline: none',
  'box-shadow: none',
  'animation: none',
  'transition: none',
];

/**
 * A copy of a text field's text, laid over the field. The CSS Custom Highlight API paints
 * nothing over the value of a field, so the marks go on the copy. The copy's text is
 * transparent and lets every pointer event through to the field. Screen readers and find in
 * page leave it out.
 *
 * It sits in the light DOM, where the `::highlight` rules in highlight.css reach it in every
 * browser, and in the top layer, so a field in a modal dialogue is not drawn over it. It is
 * clipped to the field's scroll containers, but not hidden under anything else on the page
 * that covers the field.
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
    syncText(this.text, value);
    if (!this.box.matches(':popover-open')) this.box.showPopover();
    this.place();
    return this.text;
  }

  /** Takes the field's new value while the copy is shown. */
  update(value: string): void {
    if (!this.field) return;
    syncText(this.text, value);
    this.place();
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
    const borderX = px('border-left-width') + px('border-right-width');
    const borderY = px('border-top-width') + px('border-bottom-width');
    // The client size is rounded to whole pixels, and a line can wrap on a fraction of one.
    // Scroll bars are whole pixels wide, so the difference finds them.
    const width = rect.width - borderX - Math.round(field.offsetWidth - field.clientWidth - borderX);
    const height = rect.height - borderY - Math.round(field.offsetHeight - field.clientHeight - borderY);
    const box = { left: rect.left + px('border-left-width'), top: rect.top + px('border-top-width') };
    const declarations = [
      'position: fixed',
      `left: ${box.left}px`,
      `top: ${box.top}px`,
      `width: ${width}px`,
      `height: ${height}px`,
      'box-sizing: border-box',
      'overflow: hidden',
      'background: transparent',
      'color: transparent',
      'pointer-events: none',
      'user-select: none',
      `clip-path: ${clipOf(field, box.left, box.top, width, height)}`,
      ...NEUTRAL,
      ...LAYOUT.map((name) => `${name}: ${style.getPropertyValue(name)}`),
    ];
    if (field.localName === 'input') {
      // An input draws its one line in the middle of its height, as a line box that tall does.
      const inner = height - px('padding-top') - px('padding-bottom');
      declarations.push('white-space: pre', `line-height: ${inner}px`);
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
      this.host.setAttribute('aria-hidden', 'true');
      this.host.inert = true;
      this.box = document.createElement('div');
      this.box.popover = 'manual';
      this.text = document.createTextNode('');
      this.box.append(this.text);
      this.host.append(this.box);
    }
    document.documentElement.append(this.host);
  }
}

/**
 * How much of a box the scroll containers around a field hide, as a `clip-path`. In the top
 * layer, nothing around the field clips the copy.
 */
function clipOf(field: Element, left: number, top: number, width: number, height: number): string {
  let [visibleLeft, visibleTop, right, bottom] = [left, top, left + width, top + height];
  for (let n = parentOf(field); n; n = parentOf(n)) {
    // Their overflow belongs to the window, which clips the top layer too.
    if (n === document.documentElement || n === document.body) break;
    const style = getComputedStyle(n);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const rect = n.getBoundingClientRect();
    visibleLeft = Math.max(visibleLeft, rect.left + n.clientLeft);
    visibleTop = Math.max(visibleTop, rect.top + n.clientTop);
    right = Math.min(right, rect.left + n.clientLeft + n.clientWidth);
    bottom = Math.min(bottom, rect.top + n.clientTop + n.clientHeight);
  }
  const inset = [visibleTop - top, left + width - right, top + height - bottom, visibleLeft - left];
  return `inset(${inset.map((side) => `${Math.max(0, side)}px`).join(' ')})`;
}

/** The element around `node`, carrying on from a shadow root to its host. */
function parentOf(node: Node): Element | null {
  const parent = node.parentNode;
  if (!parent) return null;
  if (parent.nodeType === 1) return parent as Element;
  return hostOf(parent);
}
