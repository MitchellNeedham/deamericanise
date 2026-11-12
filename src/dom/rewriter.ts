import { resolveOptions } from '../config.js';
import { detectAmerican, mergeSignals } from '../engine/detect.js';
import { findChanges } from '../transform.js';
import type { AmericanSignals, Change, Options, ResolvedOptions } from '../types.js';
import { distribute, type Placement } from './distribute.js';
import {
  attributesAllowed,
  canHostShadowRoot,
  containerOf,
  containersAndElementsIn,
  hostOf,
  joinsRun,
  lastRunIsOpen,
  namesCodeRole,
  ownAttributes,
  ownRuns,
  ownTextNodes,
  SCOPE_ATTRIBUTES,
  scopeOf,
  TEXT_ATTRIBUTES,
  textAllowed,
  type Scope,
  type Segment,
  type ShadowLookup,
} from './segment.js';

/**
 * How a page is judged American, which decides how an ambiguous `03/04/2024` is read and
 * whether a bare `$` is US dollars.
 *
 * - `detect`: from the page's own text, built up as it loads.
 * - `lang`: from the `lang` attribute. `en-US` is American, any other English region is
 *   not, and a bare `en` or no `lang` falls back to `detect`.
 * - `american`: always.
 */
export type Verdict = 'detect' | 'lang' | 'american';

export interface DomOptions extends Options {
  /** Defaults to `detect`. An explicit `assumeAmerican` wins over it. */
  verdict?: Verdict;
  /** Also rewrite `title`, `alt` and `placeholder`. Defaults to true. */
  attributes?: boolean;
  /**
   * Finds the shadow root an element hosts, so the text a web component renders is
   * rewritten too. Defaults to `element.shadowRoot`, which finds open roots only. A browser
   * extension can pass a lookup that finds closed roots as well. Return `null` to leave a
   * root alone, and `() => null` to stay out of shadow DOM altogether. Pass the same lookup
   * to `setOptions`: text already rewritten in a root that a new lookup no longer finds is
   * left as it is.
   */
  shadowRoot?: (host: Element) => ShadowRoot | null;
}

export interface DomResult {
  /** Offsets are into the run of text or the attribute value each change was found in. */
  changes: Change[];
  signals: AmericanSignals;
}

/** A change in the page's text, where it sits now. */
export interface HighlightedChange {
  change: Change;
  /** Covers the change's replacement in the text node that holds it. */
  range: StaticRange;
}

interface Written {
  original: string;
  written: string;
}

interface Cached {
  key: string;
  text: string;
  nodes: Text[];
  /** What was written, so a script putting anything else back is noticed. */
  outputs: string[];
  changes: Change[];
  placed: Placement[];
}

/** How many times a script may put back the original before the node is left to it. */
const MAX_REVERTS = 3;

const OBSERVED: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeOldValue: true,
  attributeFilter: [...TEXT_ATTRIBUTES, ...SCOPE_ATTRIBUTES],
};

const NO_EVIDENCE = detectAmerican('');

const SHOW_ELEMENT = 1;
const SHOW_TEXT = 4;

const openShadowRoot: ShadowLookup = (host) => host.shadowRoot;

/**
 * Rewrites the text of a document or element in place, and with `watch` keeps it
 * rewritten while the page loads and changes.
 *
 * Every node it writes keeps its original text. A run that grows is re-read from the
 * originals, never from its own output, and `stop({ restore: true })` puts the page back
 * as it was.
 */
export class DomRewriter {
  private readonly root: Node;
  private readonly document: Document;
  private options: DomOptions = {};
  private resolved = new Map<boolean | undefined, ResolvedOptions>();
  private generation = 0;

  /** Evidence per `lang` region, since a quote in another dialect is its own document. */
  private evidence = new Map<string, AmericanSignals>();
  private verdictBits = new Map<string, string>();

  private texts = new WeakMap<Text, Written>();
  private attributeValues = new WeakMap<Element, Map<string, Written>>();
  private runCache = new WeakMap<Text, Cached>();
  private attributeCache = new WeakMap<Element, Map<string, Cached>>();
  private reverts = new WeakMap<Text, number>();
  private abandoned = new WeakSet<Text>();
  private attributeReverts = new WeakMap<Element, Map<string, number>>();

  /** Runs with a change to highlight. Pruned when read, so it never walks the page. */
  private placedRuns = new Set<Cached>();
  private readonly listeners = new Set<() => void>();
  private rewrote = false;

  private observer: MutationObserver | null = null;
  /** Shadow roots whose content has been walked, each observed while watching. */
  private known = new WeakSet<ShadowRoot>();
  private loading = false;
  private readonly deferred = new Set<Node>();
  private readonly dirtyContainers = new Set<Node>();
  private readonly dirtySubtrees = new Set<Node>();
  private readonly dirtyElements = new Set<Element>();

  constructor(root: Node, options: DomOptions = {}) {
    this.root = root;
    this.document = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
    this.configure(options);
  }

  /** Rewrites everything under the root once. */
  run(): void {
    this.rescan();
  }

  /**
   * Rewrites everything now, then follows the page as it loads and changes. Call it as
   * early as possible: while the document is still loading, text is rewritten as the
   * parser adds it, before it is painted.
   */
  watch(): void {
    if (this.observer) return;
    this.loading = this.document.readyState === 'loading';
    if (this.loading) this.document.addEventListener('DOMContentLoaded', this.onLoaded);
    // Stylesheets that arrive after the HTML can change which elements sit inline or read as code.
    if (this.document.readyState !== 'complete') {
      this.document.defaultView?.addEventListener('load', this.onStyled);
    }
    // The caller's own global first: in a Firefox content script the page's constructor
    // sits behind an Xray wrapper.
    const View = globalThis.MutationObserver ?? this.document.defaultView!.MutationObserver;
    this.observer = new View((records) => this.onRecords(records));
    this.observer.observe(this.root, OBSERVED);
    // Roots walked without this observer are not observed by it, so the rescan finds them again.
    this.known = new WeakSet();
    this.rescan();
  }

  /** Handles any changes the observer has queued but not yet delivered. */
  flush(): void {
    if (this.observer) this.onRecords(this.observer.takeRecords());
  }

  /**
   * Re-reads every run with new options, from the original text. Options the library rejects
   * throw and leave the rewriter following the page under the options it had.
   */
  setOptions(options: DomOptions): void {
    this.flush();
    this.configure(options);
    this.rescan();
  }

  /** Stops following the page. With `restore`, puts back every original it replaced. */
  stop({ restore = false }: { restore?: boolean } = {}): void {
    this.flush();
    this.observer?.disconnect();
    this.observer = null;
    this.document.removeEventListener('DOMContentLoaded', this.onLoaded);
    this.document.defaultView?.removeEventListener('load', this.onStyled);
    this.loading = false;
    this.deferred.clear();

    if (restore) {
      for (const node of this.walk(SHOW_ELEMENT | SHOW_TEXT)) {
        if (node.nodeType === 3) this.restoreText(node as Text);
        else if (node.nodeType === 1) this.restoreAttributes(node as Element);
      }
      this.texts = new WeakMap();
      this.attributeValues = new WeakMap();
      this.runCache = new WeakMap();
      this.attributeCache = new WeakMap();
      this.placedRuns = new Set();
    }
    this.notify();
  }

  /** The changes in place right now. */
  changes(): Change[] {
    const out: Change[] = [];
    const [containers, elements] = this.everything(this.findShadowRoot);
    for (const [container, scope] of containers) {
      for (const run of ownRuns(container, scope)) {
        const cached = this.runCache.get(run.nodes[0]!);
        if (cached && sameNodes(cached.nodes, run.nodes) && this.intact(cached)) {
          out.push(...cached.changes);
        }
      }
    }
    for (const [element] of elements) {
      for (const cached of this.attributeCache.get(element)?.values() ?? []) {
        out.push(...cached.changes);
      }
    }
    return out;
  }

  /**
   * Where each change in the text sits now, in no particular order. Changes to attributes
   * have no place in the text and are left out, as are changes that only remove text.
   */
  highlights(): HighlightedChange[] {
    // The caller's own global first, for the same reason as in `watch`.
    const Static = globalThis.StaticRange ?? this.document.defaultView!.StaticRange;
    const out: HighlightedChange[] = [];
    for (const cached of this.placedRuns) {
      const first = cached.nodes[0]!;
      if (this.runCache.get(first) !== cached || !this.holds(first) || !this.intact(cached)) {
        this.placedRuns.delete(cached);
        continue;
      }
      for (const { change, node, start, end } of cached.placed) {
        const text = cached.nodes[node]!;
        const range = new Static({
          startContainer: text,
          startOffset: start,
          endContainer: text,
          endOffset: end,
        });
        out.push({ change, range });
      }
    }
    return out;
  }

  /**
   * Calls `listener` after each batch of rewrites, from inside the observer callback, so
   * anything slow belongs in a later frame. Returns a function that removes it.
   */
  onRewrite(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** What the page has shown so far about whether it is American, across every region. */
  get signals(): AmericanSignals {
    return [...this.evidence.values()].reduce(mergeSignals, NO_EVIDENCE);
  }

  // ------------------------------- Configuration -------------------------------

  private configure(options: DomOptions): void {
    const { verdict, attributes, shadowRoot, ...rest } = options;
    // Resolved before anything is assigned, so options that throw leave the old ones in force.
    const resolved = new Map<boolean | undefined, ResolvedOptions>();
    for (const assume of [undefined, true, false]) {
      resolved.set(assume, resolveOptions({ ...rest, assumeAmerican: assume }));
    }
    this.options = options;
    this.resolved = resolved;
    this.generation++;
    this.verdictBits = new Map([...this.evidence.keys()].map((lang) => [lang, this.bits(lang)]));
  }

  private assumeFor(lang: string): boolean | undefined {
    if (this.options.assumeAmerican !== undefined) return this.options.assumeAmerican;
    if (this.options.verdict === 'american') return true;
    if (this.options.verdict !== 'lang') return undefined;
    if (lang === 'en-us' || lang.startsWith('en-us-')) return true;
    if (lang.startsWith('en-')) return false;
    return undefined;
  }

  private evidenceFor(lang: string): AmericanSignals {
    return this.evidence.get(lang) ?? NO_EVIDENCE;
  }

  /** Everything about a region's evidence that a rule can read. */
  private bits(lang: string): string {
    const s = this.evidenceFor(lang);
    const min = this.resolved.get(undefined)!.minAmericanConfidence;
    return [
      s.confidence >= min,
      s.unambiguousMonthFirstDates > 0,
      s.unambiguousDayFirstDates > 0,
      s.namedMonthFirstDates > 0,
      s.namedDayFirstDates > 0,
    ]
      .map(Number)
      .join('');
  }

  // ------------------------------- Following the page -------------------------------

  private readonly onLoaded = (): void => {
    this.flush();
    this.loading = false;
    const containers = new Map<Node, Scope>();
    const elements = new Map<Element, Scope>();
    for (const container of this.deferred) {
      if (this.holds(container)) containers.set(container, scopeOf(container));
    }
    this.deferred.clear();
    // A custom element defined by a script at the end of the page upgrades where it stands,
    // and nothing reports the root it attaches.
    for (const node of this.walk(SHOW_ELEMENT)) {
      if (node.nodeType === 11 && node !== this.root && !this.known.has(node as ShadowRoot)) {
        this.adopt(node as ShadowRoot);
        this.collect(node, containers, elements);
      }
    }
    this.process(containers, elements);
  };

  private readonly onStyled = (): void => {
    this.flush();
    this.rescan();
  };

  private onRecords(records: MutationRecord[]): void {
    for (const record of records) {
      const target = record.target;
      if (record.type === 'characterData') {
        const written = this.texts.get(target as Text);
        if (written && (target as Text).data === written.written) continue;
        this.dirtyContainers.add(containerOf(target, this.root));
      } else if (record.type === 'childList') {
        const inline = target.nodeType === 1 && target !== this.root && joinsRun(target as Element);
        this.dirtyContainers.add(inline ? containerOf(target, this.root) : target);
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) this.dirtySubtrees.add(node);
        });
      } else {
        this.onAttribute(record);
      }
    }
    this.processDirty();
  }

  private onAttribute(record: MutationRecord): void {
    const element = record.target as Element;
    const name = record.attributeName!;
    if (TEXT_ATTRIBUTES.includes(name)) {
      const written = this.attributeValues.get(element)?.get(name);
      if (written && element.getAttribute(name) === written.written) return;
      this.dirtyElements.add(element);
      return;
    }
    if (name === 'class') {
      const before = (record.oldValue ?? '').split(/\s+/).includes('notranslate');
      if (before === element.classList.contains('notranslate')) return;
    }
    if (name === 'role' && namesCodeRole(record.oldValue) === namesCodeRole(element.getAttribute('role'))) {
      return;
    }
    this.dirtySubtrees.add(element);
    if (element !== this.root) this.dirtyContainers.add(containerOf(element, this.root));
  }

  private processDirty(): void {
    const containers = new Map<Node, Scope>();
    const elements = new Map<Element, Scope>();
    for (const subtree of this.dirtySubtrees) {
      if (this.holds(subtree)) this.collect(subtree, containers, elements);
    }
    for (const container of [...this.dirtyContainers, ...this.deferred]) {
      if (!this.holds(container)) this.deferred.delete(container);
      else if (!containers.has(container)) containers.set(container, scopeOf(container));
    }
    for (const element of this.dirtyElements) {
      if (!elements.has(element) && this.holds(element)) elements.set(element, scopeOf(element));
    }
    this.dirtySubtrees.clear();
    this.dirtyContainers.clear();
    this.dirtyElements.clear();
    this.process(containers, elements);
  }

  /** Whether every node of a run still holds what was written to it. */
  private intact(cached: Cached): boolean {
    return cached.nodes.every((node, i) => node.data === cached.outputs[i]);
  }

  /** Whether `node` is in the part of the page this rewriter walks, shadow roots included. */
  private holds(node: Node): boolean {
    for (let n = node; ; ) {
      if (n === this.root || this.root.contains(n)) return true;
      const top = n.getRootNode();
      const host = hostOf(top);
      if (!host || this.findShadowRoot(host) !== top) return false;
      n = host;
    }
  }

  // ------------------------------- Shadow roots -------------------------------

  private readonly findShadowRoot: ShadowLookup = (host) => {
    if (!canHostShadowRoot(host)) return null;
    return (this.options.shadowRoot ?? openShadowRoot)(host);
  };

  /** Finds a root while walking its host, and follows it from then on. */
  private readonly enterShadowRoot: ShadowLookup = (host) => {
    const root = this.findShadowRoot(host);
    if (root && !this.known.has(root)) this.adopt(root);
    return root;
  };

  private adopt(root: ShadowRoot): void {
    this.known.add(root);
    this.observer?.observe(root, OBSERVED);
  }

  /**
   * Every element, and every node `show` asks for, under the root and in the shadow roots
   * below it. Each tree's own root comes first, so the shadow roots are listed too.
   */
  private *walk(show: number): Generator<Node> {
    const trees: Node[] = [this.root];
    for (let tree = trees.pop(); tree; tree = trees.pop()) {
      const walker = this.document.createTreeWalker(tree, show | SHOW_ELEMENT);
      for (let node: Node | null = tree; node; node = walker.nextNode()) {
        const root = node.nodeType === 1 ? this.findShadowRoot(node as Element) : null;
        if (root) trees.push(root);
        yield node;
      }
    }
  }

  // ------------------------------- Rewriting -------------------------------

  private everything(
    shadowRootOf: ShadowLookup = this.enterShadowRoot,
  ): [Map<Node, Scope>, Map<Element, Scope>] {
    const containers = new Map<Node, Scope>();
    const elements = new Map<Element, Scope>();
    this.collect(this.root, containers, elements, shadowRootOf);
    return [containers, elements];
  }

  /**
   * Gathers what is at or below `node`. Walking with `enterShadowRoot` follows each root
   * it finds, so only a walk that goes on to rewrite what it found should use it.
   */
  private collect(
    node: Node,
    containers: Map<Node, Scope>,
    elements: Map<Element, Scope>,
    shadowRootOf: ShadowLookup = this.enterShadowRoot,
  ): void {
    const foundContainers: Array<[Node, Scope]> = [];
    const foundElements: Array<[Element, Scope]> = [];
    containersAndElementsIn(node, scopeOf(node), foundContainers, foundElements, shadowRootOf);
    for (const [container, s] of foundContainers) containers.set(container, s);
    for (const [element, s] of foundElements) elements.set(element, s);
  }

  private rescan(): void {
    this.deferred.clear();
    const [containers, elements] = this.everything();
    this.process(containers, elements);
  }

  private process(containers: Map<Node, Scope>, elements: Map<Element, Scope>): void {
    const segments: Segment[] = [];

    for (const [container, scope] of containers) {
      if (!textAllowed(scope)) {
        for (const node of ownTextNodes(container)) this.restoreText(node);
        continue;
      }
      const runs = ownRuns(container, scope);
      if (
        this.loading &&
        runs.length > 0 &&
        lastRunIsOpen(container, this.document, this.findShadowRoot)
      ) {
        runs.pop();
        this.deferred.add(container);
      } else {
        this.deferred.delete(container);
      }
      segments.push(...runs);
    }

    for (const [element, scope] of elements) {
      if (this.options.attributes === false || !attributesAllowed(scope)) {
        this.restoreAttributes(element);
      } else {
        segments.push(...ownAttributes(element, scope));
      }
    }

    // All the new evidence goes in before anything is rewritten, so every segment in this
    // batch is read against the same verdict.
    const texts = segments.map((segment) => this.read(segment));
    segments.forEach((segment, i) => {
      if (this.cachedText(segment) !== texts[i]) {
        const found = detectAmerican(texts[i]!);
        this.evidence.set(segment.lang, mergeSignals(this.evidenceFor(segment.lang), found));
      }
    });

    let changed = false;
    for (const lang of this.evidence.keys()) {
      const bits = this.bits(lang);
      const before = this.verdictBits.get(lang);
      if (before !== undefined && before !== bits) changed = true;
      this.verdictBits.set(lang, bits);
    }
    if (changed) {
      // A verdict that changes can change how runs already rewritten should read.
      this.rescan();
      return;
    }

    segments.forEach((segment, i) => {
      const text = texts[i]!;
      if (segment.kind === 'text') this.rewriteRun(segment.nodes, segment.anchors, segment.lang, text);
      else this.rewriteAttribute(segment.element, segment.name, segment.lang, text);
    });
    this.notify();
  }

  private notify(): void {
    if (!this.rewrote) return;
    this.rewrote = false;
    for (const listener of this.listeners) listener();
  }

  private read(segment: Segment): string {
    if (segment.kind === 'text') return segment.nodes.map((node) => this.sourceOfText(node)).join('');
    return this.sourceOfAttribute(segment.element, segment.name);
  }

  private cachedText(segment: Segment): string | undefined {
    if (segment.kind === 'text') return this.runCache.get(segment.nodes[0]!)?.text;
    return this.attributeCache.get(segment.element)?.get(segment.name)?.text;
  }

  private keyFor(lang: string): [string, boolean | undefined] {
    const assume = this.assumeFor(lang);
    return [`${this.generation}|${String(assume)}|${this.verdictBits.get(lang) ?? ''}`, assume];
  }

  private find(text: string, lang: string, assume: boolean | undefined): Change[] {
    if (!/[A-Za-z0-9$]/.test(text)) return [];
    const options = this.resolved.get(assume)!;
    return findChanges({ text, options, signals: this.evidenceFor(lang) });
  }

  private rewriteRun(nodes: Text[], anchors: Array<Element | null>, lang: string, text: string): void {
    const [key, assume] = this.keyFor(lang);
    const cached = this.runCache.get(nodes[0]!);
    const fresh =
      cached?.key === key &&
      cached.text === text &&
      sameNodes(cached.nodes, nodes) &&
      this.intact(cached);
    if (fresh) {
      // A run moved out of the page and back is dropped from the registry while it is out.
      if (cached.placed.length > 0) this.placedRuns.add(cached);
      return;
    }

    const sources = nodes.map((node) => this.sourceOfText(node));
    const locked = nodes.map((node) => this.abandoned.has(node));
    const laidOut = asLaidOut(text);
    const changes = inSource(text, laidOut, this.find(laidOut, lang, assume));
    const { outputs, applied, placed } = distribute(text, sources, anchors, locked, changes);
    nodes.forEach((node, i) => this.writeText(node, sources[i]!, outputs[i]!));

    // A node that used to start a run and is now inside this one leaves its old entry behind.
    for (const node of nodes) this.forgetRun(node);
    const entry: Cached = { key, text, nodes, outputs, changes: applied, placed };
    this.runCache.set(nodes[0]!, entry);
    if (placed.length > 0) this.placedRuns.add(entry);
    if (placed.length > 0 || (cached?.placed.length ?? 0) > 0) this.rewrote = true;
  }

  private forgetRun(node: Text): void {
    const cached = this.runCache.get(node);
    if (!cached) return;
    this.placedRuns.delete(cached);
    this.runCache.delete(node);
  }

  private rewriteAttribute(element: Element, name: string, lang: string, text: string): void {
    const [key, assume] = this.keyFor(lang);
    let cache = this.attributeCache.get(element);
    const cached = cache?.get(name);
    const current = element.getAttribute(name);
    if (cached && cached.key === key && cached.text === text && current === cached.outputs[0]) return;

    const changes = this.find(text, lang, assume);
    const locked = (this.attributeReverts.get(element)?.get(name) ?? 0) >= MAX_REVERTS;
    const { outputs, applied } = distribute(text, [text], [null], [locked], changes);
    this.writeAttribute(element, name, text, outputs[0]!);
    if (!cache) this.attributeCache.set(element, (cache = new Map()));
    cache.set(name, { key, text, nodes: [], outputs, changes: applied, placed: [] });
  }

  // ------------------------------- Originals -------------------------------

  private sourceOfText(node: Text): string {
    const written = this.texts.get(node);
    if (!written) return node.data;
    if (node.data === written.written) return written.original;

    // Something else rewrote the node. What it wrote is the new original.
    this.texts.delete(node);
    if (node.data === written.original) {
      const reverts = (this.reverts.get(node) ?? 0) + 1;
      this.reverts.set(node, reverts);
      if (reverts >= MAX_REVERTS) this.abandoned.add(node);
    }
    return node.data;
  }

  private writeText(node: Text, source: string, output: string): void {
    if (node.data !== output) {
      node.data = output;
      this.rewrote = true;
    }
    if (output === source) this.texts.delete(node);
    else this.texts.set(node, { original: source, written: output });
  }

  private restoreText(node: Text): void {
    const written = this.texts.get(node);
    if (!written) return;
    if (node.data === written.written) node.data = written.original;
    this.texts.delete(node);
    this.forgetRun(node);
    this.rewrote = true;
  }

  private sourceOfAttribute(element: Element, name: string): string {
    const value = element.getAttribute(name) ?? '';
    const values = this.attributeValues.get(element);
    const written = values?.get(name);
    if (!written) return value;
    if (value === written.written) return written.original;
    values!.delete(name);
    if (value === written.original) {
      let reverts = this.attributeReverts.get(element);
      if (!reverts) this.attributeReverts.set(element, (reverts = new Map()));
      reverts.set(name, (reverts.get(name) ?? 0) + 1);
    }
    return value;
  }

  private writeAttribute(element: Element, name: string, source: string, output: string): void {
    let values = this.attributeValues.get(element);
    if (element.getAttribute(name) !== output) {
      element.setAttribute(name, output);
      this.rewrote = true;
    }
    if (output === source) {
      values?.delete(name);
      return;
    }
    if (!values) this.attributeValues.set(element, (values = new Map()));
    values.set(name, { original: source, written: output });
  }

  private restoreAttributes(element: Element): void {
    const values = this.attributeValues.get(element);
    if (!values) return;
    for (const [name, written] of values) {
      if (element.getAttribute(name) === written.written) element.setAttribute(name, written.original);
    }
    this.attributeValues.delete(element);
    this.attributeCache.delete(element);
    this.rewrote = true;
  }
}

function sameNodes(a: Text[], b: Text[]): boolean {
  return a.length === b.length && a.every((node, i) => node === b[i]);
}

/**
 * A run's text with each line break in its source turned into a space, one for one so every
 * offset holds. A page lays such a break out as a space unless a style preserves it, but the
 * rules never join a number across a line break, nor a measurement across a blank line.
 */
function asLaidOut(text: string): string {
  return text.replace(/[\n\r\f]/g, ' ');
}

/**
 * Puts the source's line breaks back into changes found in its laid-out text, including into
 * a replacement that repeats the matched text, as `$40` followed by a line break does.
 */
function inSource(text: string, laidOut: string, changes: Change[]): Change[] {
  return changes.map((change) => {
    const before = text.slice(change.start, change.end);
    const seen = laidOut.slice(change.start, change.end);
    if (seen === before) return change;
    // A match of nothing but spaces could stand for any space in the replacement.
    const after = /\S/.test(seen) ? change.after.split(seen).join(before) : change.after;
    return { ...change, before, after };
  });
}

/** Rewrites a document or element in place, once. */
export function deamericaniseDom(root: Node, options: DomOptions = {}): DomResult {
  const rewriter = new DomRewriter(root, options);
  rewriter.run();
  return { changes: rewriter.changes(), signals: rewriter.signals };
}
