import { resolveOptions } from '../config.js';
import { findChanges, signalsFor } from '../transform.js';
import type { AmericanSignals, Change, Options, ResolvedOptions } from '../types.js';
import {
  canHostShadowRoot,
  containersAndElementsIn,
  editingHost,
  enter,
  namesCodeRole,
  ownRuns,
  scopeOf,
  suggestionsAllowed,
  type Scope,
  type ShadowLookup,
  type TextRun,
} from './segment.js';

/** A change offered for text someone is writing, in offsets into that text. */
export interface Suggestion {
  /**
   * What to show: the change found, widened over an article fix that goes with it, as in
   * `an eraser → a rubber`.
   */
  change: Change;
  /** The change found. */
  found: Change;
  /** Each replacement it makes, last in the text first, so earlier offsets still hold. */
  edits: Change[];
}

/** A suggestion in the text nodes of an editable element. */
export interface PlacedSuggestion {
  change: Change;
  found: Change;
  /** Covers `change.before`. */
  range: StaticRange;
  /**
   * Each replacement it makes, last in the text first. A suggestion inside one text node
   * makes a single replacement over the whole of `range`.
   */
  edits: Array<{ range: StaticRange; after: string }>;
}

export type TextField = HTMLTextAreaElement | HTMLInputElement;

/** Where someone is writing: a text field, or the editing host of editable content. */
export type WritingTarget =
  | { kind: 'field'; element: TextField }
  | { kind: 'editable'; element: Element };

const openShadowRoot: ShadowLookup = (host) => host.shadowRoot;

/**
 * Finds what would change in text someone is writing, and changes nothing. The suggestions
 * cover the same ground as a rewrite with the same options.
 */
export class WritingSuggestions {
  private readonly resolved: ResolvedOptions;

  /** Throws on options the library rejects. */
  constructor(options: Options = {}) {
    this.resolved = resolveOptions(options);
  }

  /** Suggestions for the value of a text field. */
  inText(text: string): Suggestion[] {
    return this.find(text, signalsFor(text, this.resolved));
  }

  /**
   * Suggestions in the text of an editable element and the shadow roots `shadowRootOf`
   * finds below it, in no particular order. A change that crosses the edge of a link, button
   * or label is left out. `translate="no"` and `notranslate` count only inside the element.
   */
  inEditable(root: Element, shadowRootOf: ShadowLookup = openShadowRoot): PlacedSuggestion[] {
    const lookup: ShadowLookup = (host) => (canHostShadowRoot(host) ? shadowRootOf(host) : null);
    const containers: Array<[Node, Scope]> = [];
    containersAndElementsIn(root, translatable(scopeOf(root)), containers, [], lookup, false);
    const runs = containers.flatMap(([node, scope]) => ownRuns(node, scope, suggestionsAllowed));
    const texts = runs.map((run) => run.nodes.map((node) => node.data).join(''));
    // The whole area is one piece of writing, so its dates are read the same way throughout.
    const signals = signalsFor(texts.join('\n'), this.resolved);

    const Static = globalThis.StaticRange ?? root.ownerDocument.defaultView!.StaticRange;
    const out: PlacedSuggestion[] = [];
    runs.forEach((run, i) => {
      for (const suggestion of this.find(texts[i]!, signals)) {
        const placed = place(run, suggestion, Static);
        if (placed) out.push(placed);
      }
    });
    return out;
  }

  private find(text: string, signals: AmericanSignals): Suggestion[] {
    if (!/[A-Za-z0-9$]/.test(text)) return [];
    return group(text, findChanges({ text, options: this.resolved, signals }));
  }
}

/**
 * Pairs each change with the article fixes that agree with it. A suggestion that only
 * removes or inserts text has nothing to mark, so it is left out.
 */
function group(text: string, changes: Change[]): Suggestion[] {
  const articles = changes.filter((change) => change.agreesWith);
  const out: Suggestion[] = [];
  for (const change of changes) {
    if (change.agreesWith) continue;
    const fixes = articles.filter(
      ({ agreesWith }) => agreesWith!.start === change.start && agreesWith!.end === change.end,
    );
    const edits = [change, ...fixes].sort((a, b) => b.start - a.start);
    const start = Math.min(...edits.map((edit) => edit.start));
    const end = Math.max(...edits.map((edit) => edit.end));
    if (start === end) continue;
    if (fixes.length === 0) {
      out.push({ change, found: change, edits });
      continue;
    }
    let after = text.slice(start, end);
    for (const edit of edits) {
      after = after.slice(0, edit.start - start) + edit.after + after.slice(edit.end - start);
    }
    const shown = { ...change, start, end, before: text.slice(start, end), after };
    out.push({ change: shown, found: change, edits });
  }
  return out;
}

type StaticRangeConstructor = typeof StaticRange;

/** Places a suggestion found in a run's text in the run's nodes. */
function place(
  run: TextRun,
  suggestion: Suggestion,
  Static: StaticRangeConstructor,
): PlacedSuggestion | null {
  const starts: number[] = [];
  let length = 0;
  for (const node of run.nodes) {
    starts.push(length);
    length += node.data.length;
  }

  /** The node and offset at `offset` in the run, leaning into the text after it or before it. */
  const point = (offset: number, leanBack: boolean): [index: number, offset: number] => {
    for (let i = 0; i < run.nodes.length; i++) {
      const from = starts[i]!;
      const to = from + run.nodes[i]!.data.length;
      const holds = leanBack ? from < offset && offset <= to : from <= offset && offset < to;
      if (holds) return [i, offset - from];
    }
    const last = run.nodes.length - 1;
    return leanBack || offset === 0 ? [0, 0] : [last, run.nodes[last]!.data.length];
  };

  const range = (start: number, end: number): StaticRange | null => {
    const [first, from] = point(start, start === end && start > 0);
    const [last, to] = start === end ? [first, from] : point(end, true);
    // An edit across the edge of a link would move words into it or out of it.
    for (let i = first + 1; i <= last; i++) if (run.anchors[i] !== run.anchors[first]) return null;
    return new Static({
      startContainer: run.nodes[first]!,
      startOffset: from,
      endContainer: run.nodes[last]!,
      endOffset: to,
    });
  };

  const marked = range(suggestion.change.start, suggestion.change.end);
  if (!marked) return null;
  // One edit is all an editor that applies edits later than asked can be relied on to take.
  if (marked.startContainer === marked.endContainer) {
    const edits = [{ range: marked, after: suggestion.change.after }];
    return { change: suggestion.change, found: suggestion.found, range: marked, edits };
  }
  const edits: PlacedSuggestion['edits'] = [];
  for (const edit of suggestion.edits) {
    const at = range(edit.start, edit.end);
    if (!at) return null;
    edits.push({ range: at, after: edit.after });
  }
  return { change: suggestion.change, found: suggestion.found, range: marked, edits };
}

/**
 * Where someone writing in `element` is writing, or null when suggestions do not belong
 * there. A field must be a `textarea`, or an `input` of type `text`, that can be typed in.
 * Anything marked `spellcheck="false"`, not English or drawn as code is left alone.
 */
export function writingTarget(element: Element): WritingTarget | null {
  const name = element.localName;
  if (name === 'textarea' || (name === 'input' && (element as HTMLInputElement).type === 'text')) {
    const field = element as TextField;
    const allowed = !field.readOnly && !field.disabled && fieldAllowed(field);
    return allowed ? { kind: 'field', element: field } : null;
  }
  const host = editingHost(element);
  return host ? { kind: 'editable', element: host } : null;
}

function fieldAllowed(field: TextField): boolean {
  const parent = field.parentNode;
  if (!parent) return false;
  const outer = scopeOf(parent);
  // Every field is a tag whose own text is skipped, but the value typed into it is prose.
  return suggestionsAllowed({
    ...translatable(enter(outer, field)),
    editable: true,
    skippedTag: outer.skippedTag || namesCodeRole(field.getAttribute('role')),
  });
}

/**
 * Editors mark their whole root `translate="no"` or `notranslate`, as ProseMirror and
 * Draft.js do, to stop Google Translate replacing their nodes. Suggestions replace nothing
 * unasked, so those markers count only inside the text.
 */
function translatable(scope: Scope): Scope {
  return { ...scope, translate: true, notranslate: false };
}
