const HTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Elements that sit inside a line of text, unless the page lays them out otherwise. Any other
 * element ends the run of text.
 */
const INLINE = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'button', 'cite', 'data', 'dfn', 'em',
  'font', 'i', 'label', 'mark', 'nobr', 'output', 'q', 's', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

/** Elements whose text is never rewritten. Attributes on them still can be. */
const SKIPPED = new Set([
  'audio', 'canvas', 'code', 'datalist', 'iframe', 'input', 'kbd', 'listing', 'noscript',
  'object', 'plaintext', 'pre', 'samp', 'script', 'select', 'style', 'template', 'textarea',
  'tt', 'video', 'xmp',
]);

/** Generic font families that draw every character at the same width. */
const MONOSPACE = new Set(['monospace', 'ui-monospace']);

/**
 * `white-space` values that keep every space as written, and the `white-space-collapse` values
 * a browser may list there when no single keyword names the pair.
 */
const KEEPS_SPACES = new Set(['pre', 'pre-wrap', 'break-spaces', 'preserve', 'preserve-spaces']);

/** A change that crosses the edge of one of these would move words into or out of it. */
const ANCHORS = new Set(['a', 'button', 'label']);

/**
 * Elements where `translate="no"` and `notranslate` are ignored. Apps mark the whole page to
 * stop Google Translate replacing their text nodes, and rewriting in place never does that.
 */
const PAGE_ELEMENTS = new Set(['html', 'body']);

/**
 * The built-in elements `attachShadow` accepts, as the DOM standard lists them. No other
 * element can host a root, so no other element costs a lookup.
 */
const SHADOW_HOSTS = new Set([
  'article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'main', 'nav', 'p', 'section', 'span',
]);

/** Elements whose `title` is not prose: a stylesheet set name, for one. */
const NO_TITLE = new Set(['base', 'link', 'meta', 'script', 'style', 'template']);

const ATTRIBUTES: Array<[name: string, on: Set<string> | null]> = [
  ['title', null],
  ['alt', new Set(['area', 'img', 'input'])],
  ['placeholder', new Set(['input', 'textarea'])],
];

/** Attributes whose change can move a boundary or open and close a scope. */
export const SCOPE_ATTRIBUTES = ['lang', 'xml:lang', 'translate', 'contenteditable', 'class', 'role'];
export const TEXT_ATTRIBUTES = ATTRIBUTES.map(([name]) => name);

/** What applies at a point in the tree. */
export interface Scope {
  /** The nearest `lang`, lower-cased. Empty when nothing says. */
  lang: string;
  translate: boolean;
  /** Under Google Translate's `notranslate`, which no `translate="yes"` below undoes. */
  notranslate: boolean;
  editable: boolean;
  foreign: boolean;
  /** Inside an element from `SKIPPED`, or one the page marks or draws as code. */
  skippedTag: boolean;
}

export interface TextRun {
  kind: 'text';
  nodes: Text[];
  /** The nearest link, button or label around each node, inside the run's container. */
  anchors: Array<Element | null>;
  lang: string;
}

export interface AttributeValue {
  kind: 'attribute';
  element: Element;
  name: string;
  lang: string;
}

export type Segment = TextRun | AttributeValue;

/** Finds the shadow root an element hosts, or null. */
export type ShadowLookup = (host: Element) => ShadowRoot | null;

/** Whether a page can attach a shadow root to `element`. */
export function canHostShadowRoot(element: Element): boolean {
  return (
    element.namespaceURI === HTML_NS &&
    (SHADOW_HOSTS.has(element.localName) || element.localName.includes('-'))
  );
}

/** The host of a shadow root, or null for any other node. */
export function hostOf(node: Node): Element | null {
  return node.nodeType === 11 ? ((node as ShadowRoot).host ?? null) : null;
}

export function isEnglish(lang: string): boolean {
  return lang === '' || lang === 'en' || lang.startsWith('en-');
}

export function textAllowed(scope: Scope): boolean {
  return attributesAllowed(scope) && !scope.skippedTag;
}

export function attributesAllowed(scope: Scope): boolean {
  return (
    scope.translate && !scope.notranslate && !scope.editable && !scope.foreign && isEnglish(scope.lang)
  );
}

export function rootScope(document: Document | null): Scope {
  return {
    lang: '',
    translate: true,
    notranslate: false,
    editable: document?.designMode === 'on',
    foreign: false,
    skippedTag: false,
  };
}

/** Pass `joins` when `joinsRun(element)` is already known, so the style is read only once. */
export function enter(parent: Scope, element: Element, joins?: boolean): Scope {
  const lang = element.getAttribute('lang') ?? element.getAttribute('xml:lang');
  const wholePage = element.namespaceURI === HTML_NS && PAGE_ELEMENTS.has(element.localName);

  let translate = parent.translate;
  const translateValue = wholePage ? undefined : element.getAttribute('translate')?.toLowerCase();
  if (translateValue === '' || translateValue === 'yes') translate = true;
  if (translateValue === 'no') translate = false;

  let editable = parent.editable;
  const editableValue = element.getAttribute('contenteditable')?.toLowerCase();
  if (editableValue === '' || editableValue === 'true' || editableValue === 'plaintext-only') {
    editable = true;
  }
  if (editableValue === 'false') editable = false;

  const foreign = parent.foreign || element.namespaceURI !== HTML_NS;
  return {
    lang: lang === null ? parent.lang : lang.trim().toLowerCase(),
    translate,
    notranslate: parent.notranslate || (!wholePage && element.classList.contains('notranslate')),
    editable,
    foreign,
    skippedTag:
      parent.skippedTag ||
      SKIPPED.has(element.localName) ||
      namesCodeRole(element.getAttribute('role')) ||
      (!foreign && !(joins ?? joinsRun(element)) && drawnAsCode(element)),
  };
}

/** Whether a `role` value includes the ARIA `code` role. */
export function namesCodeRole(role: string | null): boolean {
  return role !== null && role.toLowerCase().split(/\s+/).includes('code');
}

/**
 * Whether the page draws an element the way it draws code: in a font that falls back to a
 * generic monospace family, with its white space kept or its lines left unwrapped. That finds
 * code views that lay out each line in a `div`, `td` or `span`, whatever their markup. A
 * document with no window has no styles, so nothing in it is drawn as code.
 */
function drawnAsCode(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  const whiteSpace = style.whiteSpace;
  if (whiteSpace === '' || whiteSpace === 'normal') return false;
  return inMonospace(style);
}

/**
 * Whether the page draws an inline element as inline code: in a font that falls back to a
 * generic monospace family, with every space kept. A page set wholly in a monospace font keeps
 * a phone number or a measurement on one line with `nowrap`, so that alone is not enough.
 */
function drawnAsInlineCode(style: CSSStyleDeclaration): boolean {
  const whiteSpace = style.whiteSpace;
  if (whiteSpace === '' || whiteSpace === 'normal') return false;
  return whiteSpace.split(' ').some((value) => KEEPS_SPACES.has(value)) && inMonospace(style);
}

function inMonospace(style: CSSStyleDeclaration): boolean {
  // A quoted name is a font called "monospace", not the generic family.
  const unquoted = style.fontFamily.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return unquoted.split(',').some((family) => MONOSPACE.has(family.trim().toLowerCase()));
}

/**
 * The scope inside `node`, worked out from its ancestors. Inside a shadow root it carries
 * on from the host, the way the browser inherits `lang`.
 */
export function scopeOf(node: Node): Scope {
  const chain: Element[] = [];
  for (let n: Node | null = node; n; n = n.parentNode ?? hostOf(n)) {
    if (n.nodeType === 1) chain.push(n as Element);
  }
  let scope = rootScope(node.ownerDocument ?? (node as Document));
  for (let i = chain.length - 1; i >= 0; i--) scope = enter(scope, chain[i]!);
  return scope;
}

/** Whether an element's text flows on from the text around it. */
export function joinsRun(element: Element): boolean {
  return (
    element.namespaceURI === HTML_NS &&
    INLINE.has(element.localName) &&
    !element.hasAttribute('lang') &&
    !element.hasAttribute('xml:lang') &&
    !element.hasAttribute('translate') &&
    !element.hasAttribute('contenteditable') &&
    !element.classList.contains('notranslate') &&
    !namesCodeRole(element.getAttribute('role')) &&
    laidOutInline(element)
  );
}

/**
 * Whether the browser lays the element out inside the line around it, drawn as part of the
 * text. A span that is a flex item, or styled as a block or an inline-block, sits in a box of
 * its own, so text on either side of its edge never reads as one word. A span drawn as inline
 * code ends the run the way `code` does. Without styles to go on, the tag decides.
 */
function laidOutInline(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(element);
  const display = style.display;
  if (display !== '' && display !== 'inline' && display !== 'contents') return false;
  return !drawnAsInlineCode(style);
}

/**
 * The node whose runs of text include `node`: the nearest ancestor that is not inline, or
 * the root.
 */
export function containerOf(node: Node, root: Node): Node {
  let current = node.parentNode;
  while (current && current !== root && current.nodeType === 1 && joinsRun(current as Element)) {
    current = current.parentNode;
  }
  return current ?? root;
}

/**
 * Every container and every element at or below `node`, shadow roots included, with the
 * scope inside each. A shadow root is a container of its own, so no run reaches across its
 * edge.
 */
export function containersAndElementsIn(
  node: Node,
  scope: Scope,
  containers: Array<[Node, Scope]>,
  elements: Array<[Element, Scope]>,
  shadowRootOf: ShadowLookup,
  joins = node.nodeType === 1 && joinsRun(node as Element),
): void {
  const isElement = node.nodeType === 1;
  if (!isElement && node.nodeType !== 9 && node.nodeType !== 11) return;
  if (isElement) elements.push([node as Element, scope]);
  // The text of an inline element belongs to the runs of the container around it.
  if (!joins) containers.push([node, scope]);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const inline = joinsRun(element);
    containersAndElementsIn(element, enter(scope, element, inline), containers, elements, shadowRootOf, inline);
  }
  const root = isElement ? shadowRootOf(node as Element) : null;
  if (root) containersAndElementsIn(root, scope, containers, elements, shadowRootOf);
}

/**
 * The runs of text that belong to `container` itself. A run stops at any element that
 * does not join it, so a change can never reach across a paragraph, a line break or a
 * block of code.
 */
export function ownRuns(container: Node, scope: Scope): TextRun[] {
  const runs: TextRun[] = [];
  if (!textAllowed(scope)) return runs;

  let current: TextRun | null = null;
  const end = () => {
    if (current && current.nodes.length > 0) runs.push(current);
    current = null;
  };

  const visit = (parent: Node, anchor: Element | null) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        current ??= { kind: 'text', nodes: [], anchors: [], lang: scope.lang };
        current.nodes.push(child as Text);
        current.anchors.push(anchor);
      } else if (child.nodeType === 1) {
        const element = child as Element;
        if (joinsRun(element)) {
          visit(element, anchor ?? (ANCHORS.has(element.localName) ? element : null));
        } else {
          end();
        }
      }
    }
  };

  visit(container, null);
  end();
  return runs;
}

/** The text nodes that belong to `container`'s runs, whether or not text is allowed there. */
export function ownTextNodes(container: Node): Text[] {
  const nodes: Text[] = [];
  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) nodes.push(child as Text);
      else if (child.nodeType === 1 && joinsRun(child as Element)) visit(child);
    }
  };
  visit(container);
  return nodes;
}

/** The prose attributes on one element. */
export function ownAttributes(element: Element, scope: Scope): AttributeValue[] {
  if (!attributesAllowed(scope) || element.namespaceURI !== HTML_NS) return [];
  const out: AttributeValue[] = [];
  for (const [name, on] of ATTRIBUTES) {
    if (on ? !on.has(element.localName) : NO_TITLE.has(element.localName)) continue;
    if (element.hasAttribute(name)) out.push({ kind: 'attribute', element, name, lang: scope.lang });
  }
  return out;
}

/**
 * Whether the last run of `container` may still grow while the page is loading. The
 * parser only ever adds to the end of the document, so the run counts as open while the
 * last node in the document sits inside it.
 */
export function lastRunIsOpen(container: Node, root: Node, shadowRootOf: ShadowLookup): boolean {
  let last: Node = root;
  for (;;) {
    // The parser fills a declarative shadow root before the host's own children.
    const root = last.nodeType === 1 && !last.lastChild ? shadowRootOf(last as Element) : null;
    const next = last.lastChild ?? root?.lastChild;
    if (!next) break;
    last = next;
  }
  if (last === container) return false;

  for (let n: Node | null = last.nodeType === 1 ? last : last.parentNode; n; n = n.parentNode) {
    if (n === container) return true;
    if (n.nodeType !== 1 || !joinsRun(n as Element)) return false;
  }
  return false;
}
