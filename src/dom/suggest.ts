import { resolveOptions } from '../config.js';
import { applyChanges, offsetChanges } from '../engine/apply.js';
import { agreesWith } from '../engine/articles.js';
import { detectAmerican, evidenceKey, mergeSignals } from '../engine/detect.js';
import { findChanges, overruled, signalsFor } from '../transform.js';
import type { AmericanSignals, Change, Options, ResolvedOptions } from '../types.js';
import {
  containerOf,
  containersAndElementsIn,
  editingHost,
  enter,
  hostOf,
  hostsOnly,
  joinsRun,
  namesCodeRole,
  openShadowRoot,
  ownRuns,
  scopeBelow,
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
   * Each replacement it makes, last in the text first. A suggestion whose text nodes share one
   * parent makes a single replacement over the whole of `range`.
   */
  edits: Array<{ range: StaticRange; after: string }>;
}

export type TextField = HTMLTextAreaElement | HTMLInputElement;

/** Where someone is writing: a text field, or the editing host of editable content. */
export type WritingTarget =
  | { kind: 'field'; element: TextField }
  | { kind: 'editable'; element: Element };

const NO_EVIDENCE = detectAmerican('');

/**
 * Finds what would change in text someone is writing, and changes nothing. A line break is
 * read as written, never as a space: an editor that keeps white space draws it as a new line.
 */
export class WritingSuggestions {
  readonly resolved: ResolvedOptions;

  /** Throws on options the library rejects. */
  constructor(options: Options = {}) {
    this.resolved = resolveOptions(options);
  }

  /** Suggestions for the value of a text field. */
  inText(text: string): Suggestion[] {
    return suggestionsIn(text, this.resolved, signalsFor(text, this.resolved));
  }

  /** Suggestions in an editable element, read once. `EditableSuggestions` follows one. */
  inEditable(root: Element, shadowRootOf: ShadowLookup = openShadowRoot): PlacedSuggestion[] {
    return new EditableSuggestions(root, this, shadowRootOf).read().suggestions;
  }
}

/** A container's runs as last read, and what was found in them. */
interface ContainerRead {
  runs: TextRun[];
  texts: string[];
  signals: AmericanSignals;
  /** Null until the runs are read against the evidence of the whole element. */
  suggestions: PlacedSuggestion[] | null;
}

/**
 * The suggestions in one editable element and the shadow roots `shadowRootOf` finds below it,
 * kept up to date as the element changes. After the first read, only the containers that
 * `note` heard about are read again, so a read costs as much as the edit, not the document.
 * A read can stop part way and carry on in the next call.
 *
 * `translate="no"`, `notranslate` and `spellcheck="false"` count only inside the element. A
 * change that crosses the edge of a link, button or label is left out.
 */
export class EditableSuggestions {
  private readonly lookup: ShadowLookup;
  private readonly scope: Scope;
  private readonly reads = new Map<Node, ContainerRead>();
  private readonly dirty = new Set<Node>();
  private readonly added = new Set<Node>();
  private first = true;
  private key: string | null = null;
  private signals = NO_EVIDENCE;

  constructor(
    private readonly root: Element,
    private readonly writing: WritingSuggestions,
    shadowRootOf: ShadowLookup = openShadowRoot,
  ) {
    this.lookup = hostsOnly(shadowRootOf);
    // An editor that checks spelling itself turns the browser's off on its root, as Draft.js does.
    this.scope = { ...translatable(scopeOf(root)), spellcheck: true };
  }

  /** Takes note of what a batch of mutations under the element touched. */
  note(records: MutationRecord[]): void {
    for (const record of records) {
      const target = record.target;
      if (record.type === 'characterData') {
        this.dirty.add(containerOf(target, this.root));
      } else if (record.type === 'childList') {
        const inline = target.nodeType === 1 && target !== this.root && joinsRun(target as Element);
        this.dirty.add(inline ? containerOf(target, this.root) : target);
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) this.added.add(node);
        });
      }
    }
  }

  /**
   * Reads what changed since the last read, or everything on the first, and returns every
   * suggestion in the element, in no particular order. Between containers it stops once `more`
   * returns false, and `done` says whether anything is left for the next call.
   */
  read(more: () => boolean = () => true): { suggestions: PlacedSuggestion[]; done: boolean } {
    this.measure();
    const resolved = this.writing.resolved;
    const signals = overruled(this.signals, resolved);
    const Static = globalThis.StaticRange ?? this.root.ownerDocument.defaultView!.StaticRange;
    const waiting = [...this.reads.values()].filter((read) => !read.suggestions);
    let done = true;
    for (const [i, read] of waiting.entries()) {
      if (i > 0 && !more()) {
        done = false;
        break;
      }
      read.suggestions = read.runs.flatMap((run, j) =>
        suggestionsIn(read.texts[j]!, resolved, signals).flatMap((s) => place(run, s, Static) ?? []),
      );
    }
    const suggestions = [...this.reads.values()].flatMap((read) => read.suggestions ?? []);
    return { suggestions, done };
  }

  /** Reads the text of each container that changed, and the evidence of the whole element. */
  private measure(): void {
    const containers = new Map<Node, Scope>();
    let removed = false;
    if (this.first) {
      this.first = false;
      this.collect(this.root, this.scope, containers);
    } else {
      for (const node of this.added) {
        if (this.holds(node)) this.collect(node, this.below(node), containers);
      }
      for (const node of this.dirty) {
        if (this.holds(node) && !containers.has(node)) containers.set(node, this.below(node));
      }
      for (const container of this.reads.keys()) {
        if (this.holds(container)) continue;
        this.reads.delete(container);
        removed = true;
      }
    }
    this.dirty.clear();
    this.added.clear();
    if (containers.size === 0 && !removed) return;

    for (const [container, scope] of containers) {
      const runs = ownRuns(container, scope, suggestionsAllowed);
      const texts = runs.map((run) => run.nodes.map((node) => node.data).join(''));
      this.reads.set(container, {
        runs,
        texts,
        signals: detectAmerican(texts.join('\n')),
        suggestions: runs.length > 0 ? null : [],
      });
    }
    // The whole element is one piece of writing, so its dates are read the same way throughout.
    this.signals = NO_EVIDENCE;
    for (const read of this.reads.values()) this.signals = mergeSignals(this.signals, read.signals);
    const resolved = this.writing.resolved;
    const key = evidenceKey(overruled(this.signals, resolved), resolved.minAmericanConfidence);
    if (this.key !== null && key !== this.key) {
      for (const read of this.reads.values()) {
        if (read.runs.length > 0) read.suggestions = null;
      }
    }
    this.key = key;
  }

  private collect(node: Node, scope: Scope, containers: Map<Node, Scope>): void {
    const found: Array<[Node, Scope]> = [];
    // The element is a container of its own even when it is an inline one.
    const joins = node === this.root ? false : undefined;
    containersAndElementsIn(node, scope, found, [], this.lookup, joins);
    for (const [container, inside] of found) containers.set(container, inside);
  }

  private below(node: Node): Scope {
    return scopeBelow(node, this.root, this.scope);
  }

  /** Whether `node` is in the element, or in a shadow root below it. */
  private holds(node: Node): boolean {
    for (let n = node; ; ) {
      if (n === this.root || this.root.contains(n)) return true;
      const host = hostOf(n.getRootNode());
      if (!host) return false;
      n = host;
    }
  }
}

function suggestionsIn(text: string, resolved: ResolvedOptions, signals: AmericanSignals): Suggestion[] {
  if (!/[A-Za-z0-9$]/.test(text)) return [];
  return group(text, findChanges({ text, options: resolved, signals }));
}

/**
 * Pairs each change with the article fixes that agree with it. A suggestion that only inserts
 * text has nothing to mark, so it is left out.
 */
function group(text: string, changes: Change[]): Suggestion[] {
  const articles = changes.filter((change) => change.agreesWith);
  const out: Suggestion[] = [];
  for (const change of changes) {
    if (change.agreesWith) continue;
    const fixes = articles.filter((article) => agreesWith(article, change));
    const edits = [change, ...fixes].sort((a, b) => b.start - a.start);
    const start = Math.min(...edits.map((edit) => edit.start));
    const end = Math.max(...edits.map((edit) => edit.end));
    if (start === end) continue;
    if (fixes.length === 0) {
      out.push({ change, found: change, edits });
      continue;
    }
    const after = applyChanges(text.slice(start, end), offsetChanges([...edits].reverse(), -start));
    const shown = { ...change, start, end, before: text.slice(start, end), after };
    out.push({ change: shown, found: change, edits });
  }
  return out;
}

type StaticRangeConstructor = typeof StaticRange;

/** Where a span of a run's text starts and ends in the run's nodes. */
type Span = [first: number, from: number, last: number, to: number];

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
  const span = (start: number, end: number): Span => {
    const [first, from] = point(start, start === end && start > 0);
    const [last, to] = start === end ? [first, from] : point(end, true);
    return [first, from, last, to];
  };
  const toRange = ([first, from, last, to]: Span): StaticRange =>
    new Static({
      startContainer: run.nodes[first]!,
      startOffset: from,
      endContainer: run.nodes[last]!,
      endOffset: to,
    });
  // An edit across the edge of a link would move words into it or out of it.
  const crossesAnchor = ([first, , last]: Span): boolean => {
    for (let i = first + 1; i <= last; i++) {
      if (run.nodes[i]!.data.length > 0 && run.anchors[i] !== run.anchors[first]) return true;
    }
    return false;
  };

  const { change, found } = suggestion;
  const whole = span(change.start, change.end);
  const range = toRange(whole);
  const nodes = run.nodes.slice(whole[0], whole[2] + 1);
  // One edit is all an editor that applies edits later than asked can be relied on to take,
  // and it undoes in one step. Text nodes that share a parent lose no formatting to it.
  if (nodes.every((node) => node.parentNode === nodes[0]!.parentNode)) {
    return { change, found, range, edits: [{ range, after: change.after }] };
  }
  const edits: PlacedSuggestion['edits'] = [];
  for (const edit of suggestion.edits) {
    const at = span(edit.start, edit.end);
    if (crossesAnchor(at)) return null;
    edits.push({ range: toRange(at), after: edit.after });
  }
  return { change, found, range, edits };
}

/**
 * Where someone writing in `element` is writing, or null when it is no place for suggestions.
 * A field must be a `textarea`, or an `input` of type `text`, that can be typed in and is not
 * marked `spellcheck="false"`, not English or code. Editable content is checked as it is read,
 * so only the parts of it that are not English or are code get no suggestions.
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
  // `spellcheck="false"` still counts: code editors type into hidden textareas marked so.
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
