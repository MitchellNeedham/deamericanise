// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DomRewriter, deamericaniseDom } from '../src/dom/index.js';
import type { DomOptions } from '../src/dom/index.js';
import { distribute } from '../src/dom/distribute.js';
import type { Change } from '../src/index.js';

// A path, not a URL: under jsdom `URL` is jsdom's own, which `node:fs` rejects.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'html');
/** Fixtures where trusting `lang` gives a different answer, so both are kept. */
const BOTH_VERDICTS = new Set(['wordpress', 'multilingual']);

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function page(body: string, lang = 'en-US'): Document {
  return parse(`<!doctype html><html lang="${lang}"><head><title>t</title></head><body>${body}</body></html>`);
}

/** The body of a page after one pass. */
function rewrite(body: string, options: DomOptions = {}, lang = 'en-US'): string {
  const doc = page(body, lang);
  deamericaniseDom(doc, options);
  return doc.body.innerHTML;
}

function serialise(doc: Document): string {
  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
}

/** The text each highlight covers, next to the replacement it should be covering. */
function covered(rewriter: DomRewriter): Array<[string, string]> {
  return rewriter
    .highlights()
    .map(({ change, range }): [string, string] => [
      (range.startContainer as Text).data.slice(range.startOffset, range.endOffset),
      change.after,
    ])
    .sort();
}

/** The text nodes under `node` in document order, each open root's after its host's. */
function textNodes(node: Node, out: Node[] = []): Node[] {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) out.push(child);
    textNodes(child, out);
    const root = child.nodeType === 1 ? (child as Element).shadowRoot : null;
    if (root) textNodes(root, out);
  }
  return out;
}

/** The page's HTML, then the HTML of each open root in document order. */
function serialiseDeep(doc: Document): string {
  const parts = [serialise(doc)];
  const visit = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
      const root = child.nodeType === 1 ? (child as Element).shadowRoot : null;
      if (root) {
        parts.push(root.innerHTML);
        visit(root);
      }
    }
  };
  visit(doc);
  return parts.join('\n');
}

/** Each highlight by text node position, so two copies of a page can be compared. */
function located(doc: Document, rewriter: DomRewriter): string[] {
  const index = new Map(textNodes(doc).map((node, i) => [node, i]));
  return rewriter
    .highlights()
    .map(({ change, range }) => {
      const at = `${index.get(range.startContainer)}:${range.startOffset}-${range.endOffset}`;
      return `${at} ${change.ruleId} ${change.after}`;
    })
    .sort();
}

describe('runs of text', () => {
  it('joins text across inline formatting', () => {
    expect(rewrite('<p>It is 6 feet <b>2</b> inches wide.</p>')).toBe(
      '<p>It is 1.88 metres<b></b> wide.</p>',
    );
  });

  it('keeps a change inside one node to that node', () => {
    expect(rewrite('<p>The <em>color</em> of the <a href="#">theater</a>.</p>')).toBe(
      '<p>The <em>colour</em> of the <a href="#">theatre</a>.</p>',
    );
  });

  it('never joins across a block or a line break', () => {
    expect(rewrite('<p>It is 6 feet</p><p>2 inches wide.</p>')).toBe(
      '<p>It is 1.8 metres</p><p>5.1 centimetres wide.</p>',
    );
    expect(rewrite('<p>It is 6 feet<br>2 inches wide.</p>')).toBe(
      '<p>It is 1.8 metres<br>5.1 centimetres wide.</p>',
    );
  });

  it('reads pretty-printed source the way it renders', () => {
    expect(rewrite('<p>\n  It is 6 feet\n  <b>2</b>\n  inches wide.\n</p>')).toBe(
      '<p>\n  It is 1.88 metres<b></b> wide.\n</p>',
    );
    expect(rewrite('<p>\n  Add 1\n  1/2 gallons, then walk two and a\n  half miles.\n</p>')).toBe(
      '<p>\n  Add 5.7 litres, then walk 4 kilometres.\n</p>',
    );
    expect(rewrite('<p>\n  It is 6\n\n  feet wide.\n</p>')).toBe('<p>\n  It is 1.8 metres wide.\n</p>');
  });

  it('keeps the line breaks a replacement repeats from the source', () => {
    expect(rewrite('<p>Plots are $40\n  for the year.</p>', { assumeAmerican: true })).toBe(
      '<p>Plots are US$40\n  for the year.</p>',
    );
  });

  it('skips a change that would move text into or out of a link', () => {
    expect(rewrite('<p>Stand <a href="#">6 feet</a> 2 inches away.</p>')).toBe(
      '<p>Stand <a href="#">6 feet</a> 2 inches away.</p>',
    );
  });

  it('applies a change that stays inside one link', () => {
    expect(rewrite('<p><a href="#">Stand 6 feet <b>2</b> inches away.</a></p>')).toBe(
      '<p><a href="#">Stand 1.88 metres<b></b> away.</a></p>',
    );
  });

  it('keeps the sentence stop of a time when the next sentence is in another element', () => {
    expect(rewrite('<p>It starts at <b>3 P.M.</b> <i>Bring</i> snacks.</p>')).toBe(
      '<p>It starts at <b>3pm.</b> <i>Bring</i> snacks.</p>',
    );
    expect(rewrite('<p>It starts at <b>3 P.M.</b> <i>with</i> snacks.</p>')).toBe(
      '<p>It starts at <b>3pm</b> <i>with</i> snacks.</p>',
    );
  });

  it('ends the sentence of a time at the end of a run', () => {
    expect(rewrite('<p>It starts at 3 P.M.</p><p>Bring snacks.</p>')).toBe(
      '<p>It starts at 3pm.</p><p>Bring snacks.</p>',
    );
    expect(rewrite('<p>It starts at 3 P.M.<br>with snacks.</p>')).toBe(
      '<p>It starts at 3pm.<br>with snacks.</p>',
    );
    expect(rewrite('<table><tr><td>3 P.M.</td></tr></table>')).toBe(
      '<table><tbody><tr><td>3pm</td></tr></tbody></table>',
    );
  });

  it('keeps the sentence stop of an initialism across elements and runs', () => {
    const localise: DomOptions = { preset: 'localise' };
    expect(rewrite('<p>She moved to the <b>U.S.</b> <i>It</i> was cold.</p>', localise)).toBe(
      '<p>She moved to the <b>US.</b> <i>It</i> was cold.</p>',
    );
    expect(rewrite('<p>She joined the <b>U.S.</b> <i>Army</i> in 2001.</p>', localise)).toBe(
      '<p>She joined the <b>US</b> <i>Army</i> in 2001.</p>',
    );
    expect(rewrite('<p>She moved to the U.K.</p><p>It was cold.</p>', localise)).toBe(
      '<p>She moved to the UK.</p><p>It was cold.</p>',
    );
  });

  it('drops the article fix that leaned on a skipped change', () => {
    const localise: DomOptions = { preset: 'localise' };
    expect(rewrite('<p>Press a gas pedal.</p>', localise)).toBe('<p>Press an accelerator.</p>');
    expect(rewrite('<p>Press a <a href="#">gas</a> pedal.</p>', localise)).toBe(
      '<p>Press a <a href="#">gas</a> pedal.</p>',
    );
  });

  it('fixes the article before a converted measurement, or drops it with the measurement', () => {
    expect(rewrite('<p>Build an 8 foot fence.</p>')).toBe('<p>Build a 2.4 metre fence.</p>');
    expect(rewrite('<p>Build an <b>8</b> foot fence.</p>')).toBe('<p>Build a <b>2.4 metre</b> fence.</p>');
    expect(rewrite('<p>Build an 8 <a href="#">foot</a> fence.</p>')).toBe(
      '<p>Build an 8 <a href="#">foot</a> fence.</p>',
    );
  });
});

describe('runs of text in a laid-out page', () => {
  // DOMParser documents have no window and so no styles, so these use the test's own document.
  function laidOut(body: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = body;
    document.body.append(host);
    return host;
  }
  const tab =
    '<button><span style="display: block">Customize actions</span>' +
    '<span style="display: block">Customize actions</span></button>';

  it('ends a run at an inline element laid out in a box of its own', () => {
    const host = laidOut(tab);
    deamericaniseDom(host);
    expect(host.innerHTML).toBe(tab.replaceAll('Customize', 'Customise'));
    host.remove();
  });

  it('joins across an element with display: contents', () => {
    const host = laidOut('<p>It is 6 feet <span style="display: contents">2</span> inches.</p>');
    deamericaniseDom(host);
    expect(host.innerHTML).toBe('<p>It is 1.88 metres<span style="display: contents"></span>.</p>');
    host.remove();
  });

  it('reads the layout again once the stylesheets have loaded', () => {
    const host = laidOut('<button><span>Customize actions</span><span>Customize actions</span></button>');
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'interactive' });
    const rewriter = new DomRewriter(host);
    rewriter.watch();
    Reflect.deleteProperty(document, 'readyState');
    expect(host.textContent).toBe('Customise actionsCustomise actions');

    for (const span of host.querySelectorAll('span')) span.style.display = 'block';
    window.dispatchEvent(new Event('load'));
    expect(host.innerHTML).toBe(
      '<button><span style="display: block;">Customise actions</span>' +
        '<span style="display: block;">Customise actions</span></button>',
    );
    rewriter.stop();
    host.remove();
  });
});

describe('spreading changes over nodes', () => {
  const change = (start: number, end: number, after: string, ruleId = 'test'): Change => ({
    start,
    end,
    before: '',
    after,
    ruleId,
    category: 'spelling',
    confidence: 'safe',
  });

  it('puts the replacement in the first node and empties the rest', () => {
    const sources = ['ab', 'cd', 'ef'];
    const result = distribute('abcdef', sources, [null, null, null], [false, false, false], [
      change(1, 5, 'X'),
    ]);
    expect(result.outputs).toEqual(['aX', '', 'f']);
  });

  it('ignores empty nodes at the edges of a change', () => {
    const result = distribute('abcd', ['ab', '', 'cd'], [null, null, null], [false, false, false], [
      change(0, 2, 'X'),
    ]);
    expect(result.outputs).toEqual(['X', '', 'cd']);
  });

  it('says where each replacement landed', () => {
    const result = distribute('abcdef', ['ab', 'cd', 'ef'], [null, null, null], [false, false, false], [
      change(0, 1, 'XY'),
      change(1, 5, 'Q'),
      change(5, 6, ''),
    ]);
    expect(result.outputs).toEqual(['XYQ', '', '']);
    expect(result.placed.map(({ node, start, end }) => [node, start, end])).toEqual([
      [0, 0, 2],
      [0, 2, 3],
    ]);
  });

  it('leaves a locked node alone', () => {
    const result = distribute('abcd', ['ab', 'cd'], [null, null], [false, true], [
      change(0, 1, 'X'),
      change(2, 3, 'Y'),
    ]);
    expect(result.outputs).toEqual(['Xb', 'cd']);
    expect(result.applied.map((c) => c.after)).toEqual(['X']);
  });
});

describe('what is left alone', () => {
  it.each([
    ['code', '<p>Set <code>color</code> here.</p>', '<p>Set <code>color</code> here.</p>'],
    ['pre', '<pre>the color</pre>', '<pre>the color</pre>'],
    ['kbd and samp', '<p><kbd>color</kbd> <samp>color</samp></p>', '<p><kbd>color</kbd> <samp>color</samp></p>'],
    ['textarea', '<textarea>the color</textarea>', '<textarea>the color</textarea>'],
    ['select', '<select><option>color</option></select>', '<select><option>color</option></select>'],
    ['script', '<script>var s = "color";</script>', '<script>var s = "color";</script>'],
    ['style', '<style>/* color */</style>', '<style>/* color */</style>'],
    ['editable', '<div contenteditable="true">the color</div>', '<div contenteditable="true">the color</div>'],
    ['translate="no"', '<p translate="no">the color</p>', '<p translate="no">the color</p>'],
    ['notranslate', '<p class="notranslate">the color</p>', '<p class="notranslate">the color</p>'],
    ['another language', '<p lang="fr">the color</p>', '<p lang="fr">the color</p>'],
    ['svg', '<svg><text>the color</text></svg>', '<svg><text>the color</text></svg>'],
  ])('%s', (_, input, expected) => {
    expect(rewrite(input)).toBe(expected);
  });

  it('splits a run around skipped inline text', () => {
    expect(rewrite('<p>It is 6 feet <code>x</code> 2 inches.</p>')).toBe(
      '<p>It is 1.8 metres <code>x</code> 5.1 centimetres.</p>',
    );
  });

  it('honours an opt-in inside an opt-out', () => {
    expect(rewrite('<div translate="no">color <span translate="yes">color</span></div>')).toBe(
      '<div translate="no">color <span translate="yes">colour</span></div>',
    );
    expect(rewrite('<div contenteditable>color <p contenteditable="false">color</p></div>')).toBe(
      '<div contenteditable="">color <p contenteditable="false">colour</p></div>',
    );
  });

  it('ignores an opt-out on the whole page', () => {
    const marked = (html: string, body: string) => {
      const content = '<p>the color</p><p translate="no">the color</p>';
      const doc = parse(`<!doctype html><html lang="en-US" ${html}><body ${body}>${content}</body></html>`);
      deamericaniseDom(doc);
      return doc.body.innerHTML;
    };
    const expected = '<p>the colour</p><p translate="no">the color</p>';
    expect(marked('translate="no"', '')).toBe(expected);
    expect(marked('class="notranslate"', '')).toBe(expected);
    expect(marked('', 'translate="no"')).toBe(expected);
    expect(marked('', 'class="notranslate"')).toBe(expected);
  });

  it('does not let an opt-in undo notranslate', () => {
    expect(rewrite('<div class="notranslate"><p translate="yes">color</p></div>')).toBe(
      '<div class="notranslate"><p translate="yes">color</p></div>',
    );
  });

  it('leaves a page in another language alone', () => {
    expect(rewrite('<p>the color</p>', {}, 'de')).toBe('<p>the color</p>');
    expect(rewrite('<p lang="en">the color</p>', {}, 'de')).toBe('<p lang="en">the colour</p>');
  });

  it('leaves a cookie banner alone and still localises the recipe beside it', () => {
    const banner =
      '<div role="dialog"><h2>Cookies</h2>' +
      '<p>We use cookies to improve your experience on our site.</p>' +
      '<div><button>Accept all cookies</button></div><div><button>Cookie settings</button></div>' +
      '<div><a href="#" title="Read our cookie policy">Cookie Policy</a></div></div>';
    const recipe = '<h1>Chocolate Chip Cookies</h1><p>Line a cookie sheet and bake the cookies.</p>';
    expect(rewrite(banner + recipe, { preset: 'localise', dialect: 'en-GB' })).toBe(
      banner +
        '<h1>Chocolate Chip Biscuits</h1><p>Line a baking tray and bake the biscuits.</p>',
    );
  });

  it('leaves a document in design mode alone', () => {
    const doc = page('<p>the color</p>');
    doc.designMode = 'on';
    deamericaniseDom(doc);
    expect(doc.body.innerHTML).toBe('<p>the color</p>');
  });
});

describe('attributes', () => {
  it('rewrites title, alt and placeholder', () => {
    expect(
      rewrite('<abbr title="favorite color">fc</abbr><img alt="a gray cat"><input placeholder="Your favorite">'),
    ).toBe('<abbr title="favourite colour">fc</abbr><img alt="a grey cat"><input placeholder="Your favourite">');
  });

  it('leaves a stylesheet title alone', () => {
    const doc = parse('<html lang="en-US"><head><link rel="alternate stylesheet" title="Gray"></head></html>');
    deamericaniseDom(doc);
    expect(doc.head.innerHTML).toBe('<link rel="alternate stylesheet" title="Gray">');
  });

  it('follows the same opt-outs as text', () => {
    expect(rewrite('<p translate="no"><img alt="gray"></p>')).toBe('<p translate="no"><img alt="gray"></p>');
  });

  it('can be switched off', () => {
    expect(rewrite('<img alt="gray">', { attributes: false })).toBe('<img alt="gray">');
  });

  it('rewrites the document title', () => {
    const doc = parse('<html lang="en-US"><head><title>Favorite colors</title></head></html>');
    deamericaniseDom(doc);
    expect(doc.title).toBe('Favourite colours');
  });
});

describe('deciding whether the page is American', () => {
  const dates = '<p>Due 03/04/2024 at $500.</p>';
  const american = '<p>The color of the theater was gray, and they canceled.</p>';

  it('detects from the text by default', () => {
    expect(rewrite(dates)).toBe(dates);
    expect(rewrite(american + dates)).toContain('Due 2024-03-04 at US$500.');
  });

  it('pools evidence from the whole page', () => {
    expect(rewrite('<p>Filed 3/14/2024.</p><div>Due 03/04/2024.</div>')).toContain('Due 2024-03-04.');
    expect(rewrite(american + '<p>Filed 25/12/2023.</p><div>Due 03/04/2024.</div>')).toContain(
      'Due 03/04/2024.',
    );
  });

  it('judges each lang region on its own text', () => {
    const quote = `<blockquote lang="en-US">${american}<p>Filed 3/14/2024.</p></blockquote>`;
    expect(rewrite(quote + dates, {}, 'en-GB')).toContain('Due 03/04/2024 at $500.');
    expect(rewrite(quote + `<p lang="en-US">Due 03/04/2024.</p>`, {}, 'en-GB')).toContain('Due 2024-03-04.');
  });

  it('trusts lang when asked', () => {
    expect(rewrite(dates, { verdict: 'lang' }, 'en-US')).toContain('Due 2024-03-04 at US$500.');
    expect(rewrite(american + dates, { verdict: 'lang' }, 'en-GB')).toContain('Due 03/04/2024 at $500.');
    expect(rewrite(american + dates, { verdict: 'lang' }, 'en')).toContain('Due 2024-03-04 at US$500.');
    expect(rewrite(dates, { verdict: 'lang' }, 'en')).toBe(dates);
  });

  it('reads lang on each element', () => {
    expect(rewrite(`<div lang="en-GB">${dates}</div>`, { verdict: 'lang' }, 'en-US')).toContain(
      'Due 03/04/2024 at $500.',
    );
  });

  it('can always assume American', () => {
    expect(rewrite(dates, { verdict: 'american' }, 'en-GB')).toContain('Due 2024-03-04 at US$500.');
  });

  it('lets an explicit assumeAmerican win', () => {
    expect(rewrite(dates, { verdict: 'american', assumeAmerican: false })).toBe(dates);
  });
});

describe('following a page', () => {
  function watched(body: string, options: DomOptions = {}): [Document, DomRewriter] {
    const doc = page(body);
    const rewriter = new DomRewriter(doc, options);
    rewriter.watch();
    return [doc, rewriter];
  }

  it('rewrites content added later', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    const added = doc.createElement('div');
    added.innerHTML = 'the <i>theater</i> <img alt="gray">';
    doc.body.append(added);
    rewriter.flush();
    expect(doc.body.innerHTML).toBe('<p>the colour</p><div>the <i>theatre</i> <img alt="grey"></div>');
  });

  it('re-reads a run from its original text when it grows', () => {
    const [doc, rewriter] = watched('<p>It is 6 feet</p>');
    const p = doc.querySelector('p')!;
    expect(p.textContent).toBe('It is 1.8 metres');
    p.append(' 2 inches wide.');
    rewriter.flush();
    expect(p.textContent).toBe('It is 1.88 metres wide.');
  });

  it('gives an attribute back to a script that keeps reverting it', () => {
    const [doc, rewriter] = watched('<img alt="gray">');
    const img = doc.querySelector('img')!;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      img.setAttribute('alt', 'gray');
      rewriter.flush();
      seen.push(img.alt);
    }
    expect(seen).toEqual(['grey', 'grey', 'gray', 'gray', 'gray']);
  });

  it('takes text a script writes as the new original', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    const text = doc.querySelector('p')!.firstChild as Text;
    text.data = 'the theater';
    rewriter.flush();
    expect(text.data).toBe('the theatre');
    rewriter.stop({ restore: true });
    expect(text.data).toBe('the theater');
  });

  it('gives a node back to a script that keeps reverting it', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    const text = doc.querySelector('p')!.firstChild as Text;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      text.data = 'the color';
      rewriter.flush();
      seen.push(text.data);
    }
    expect(seen).toEqual(['the colour', 'the colour', 'the color', 'the color', 'the color']);
  });

  it('puts the original back when text becomes editable', () => {
    const [doc, rewriter] = watched('<div><p>the color</p></div>');
    expect(doc.body.innerHTML).toBe('<div><p>the colour</p></div>');
    doc.querySelector('div')!.setAttribute('contenteditable', 'true');
    rewriter.flush();
    expect(doc.body.innerHTML).toBe('<div contenteditable="true"><p>the color</p></div>');
    doc.querySelector('div')!.classList.add('notranslate');
    doc.querySelector('div')!.removeAttribute('contenteditable');
    rewriter.flush();
    expect(doc.body.innerHTML).toBe('<div class="notranslate"><p>the color</p></div>');
  });

  it('re-reads every run with new options', () => {
    const [doc, rewriter] = watched('<p>Fill the gas tank.</p>');
    expect(doc.body.innerHTML).toBe('<p>Fill the gas tank.</p>');
    rewriter.setOptions({ preset: 'localise' });
    expect(doc.body.innerHTML).toBe('<p>Fill the petrol tank.</p>');
    rewriter.setOptions({ preset: 'read' });
    expect(doc.body.innerHTML).toBe('<p>Fill the gas tank.</p>');
  });

  it('re-reads earlier runs when the verdict changes', () => {
    const [doc, rewriter] = watched('<p>Due 03/04/2024.</p>');
    expect(doc.body.innerHTML).toBe('<p>Due 03/04/2024.</p>');
    doc.body.insertAdjacentHTML('beforeend', '<p>Filed 3/14/2024.</p>');
    rewriter.flush();
    expect(doc.body.innerHTML).toBe('<p>Due 2024-03-04.</p><p>Filed 2024-03-14.</p>');
  });

  it('puts everything back on stop', () => {
    const body = '<p title="gray">the color <b>6 feet</b></p><img alt="favorite">';
    const [doc, rewriter] = watched(body);
    expect(doc.body.innerHTML).not.toBe(body);
    rewriter.stop({ restore: true });
    expect(doc.body.innerHTML).toBe(body);
    doc.body.append('the color');
    expect(doc.body.lastChild!.textContent).toBe('the color');
  });

  it('counts the changes in place', () => {
    const [doc, rewriter] = watched('<p>the color</p><img alt="gray">');
    expect(rewriter.changes().map((c) => c.after)).toEqual(['colour', 'grey']);
    doc.querySelector('p')!.remove();
    rewriter.flush();
    expect(rewriter.changes().map((c) => c.after)).toEqual(['grey']);
  });
});

describe('highlighting', () => {
  function watched(body: string): [Document, DomRewriter] {
    const doc = page(body);
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    return [doc, rewriter];
  }

  it('covers each replacement where it now reads', () => {
    const [, rewriter] = watched('<p>the color of <b>the theater</b></p>');
    expect(covered(rewriter)).toEqual([
      ['colour', 'colour'],
      ['theatre', 'theatre'],
    ]);
  });

  it('covers a change across nodes in the node that holds it', () => {
    const [doc, rewriter] = watched('<p>Bake at 300 <abbr>°F</abbr> for an hour</p>');
    const [highlight] = rewriter.highlights();
    expect(highlight!.range.startContainer).toBe(doc.querySelector('p')!.firstChild);
    expect(covered(rewriter)).toEqual([['150°C', '150°C']]);
  });

  it('leaves out attributes', () => {
    const [, rewriter] = watched('<img alt="gray">');
    expect(rewriter.changes()).toHaveLength(1);
    expect(rewriter.highlights()).toEqual([]);
  });

  it('follows text the page changes', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    const text = doc.querySelector('p')!.firstChild as Text;
    text.data = 'the gray sky';
    rewriter.flush();
    expect(covered(rewriter)).toEqual([['grey', 'grey']]);
    text.data = 'plain words';
    rewriter.flush();
    expect(covered(rewriter)).toEqual([]);
  });

  it('keeps a run the page moves, even when read while it is out', () => {
    const [doc, rewriter] = watched('<p>the color</p><div>other words</div>');
    const p = doc.querySelector('p')!;
    p.remove();
    rewriter.flush();
    expect(covered(rewriter)).toEqual([]);
    doc.body.append(p);
    rewriter.flush();
    expect(covered(rewriter)).toEqual([['colour', 'colour']]);
  });

  it('forgets the old run when text arrives in front of it', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    const p = doc.querySelector('p')!;
    p.prepend('Look at ');
    rewriter.flush();
    expect(p.innerHTML).toBe('Look at the colour');
    expect(covered(rewriter)).toEqual([['colour', 'colour']]);
  });

  it('drops everything when the page is put back', () => {
    const [, rewriter] = watched('<p>the color</p>');
    rewriter.stop({ restore: true });
    expect(rewriter.highlights()).toEqual([]);
  });

  it('tells a listener after each batch of rewrites', () => {
    const [doc, rewriter] = watched('<p>the color</p>');
    let calls = 0;
    const remove = rewriter.onRewrite(() => calls++);
    doc.body.append('the gray');
    rewriter.flush();
    expect(calls).toBe(1);
    const quiet = doc.createElement('p');
    quiet.textContent = 'nothing to change';
    doc.body.append(quiet);
    rewriter.flush();
    expect(calls).toBe(1);
    remove();
    doc.body.append('the gray');
    rewriter.flush();
    expect(calls).toBe(1);
  });
});

describe('a page that is still loading', () => {
  function loading(): [Document, DomRewriter, () => void] {
    const doc = page('');
    let state: DocumentReadyState = 'loading';
    Object.defineProperty(doc, 'readyState', { configurable: true, get: () => state });
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    const finish = () => {
      state = 'interactive';
      doc.dispatchEvent(new Event('DOMContentLoaded'));
    };
    return [doc, rewriter, finish];
  }

  it('waits for the run the parser is still adding to', () => {
    const [doc, rewriter, finish] = loading();
    const p = doc.createElement('p');
    doc.body.append(p);
    p.append('It is 6 feet');
    rewriter.flush();
    expect(p.textContent).toBe('It is 6 feet');

    p.append(doc.createElement('b'));
    rewriter.flush();
    expect(p.textContent).toBe('It is 6 feet');

    doc.body.append(doc.createElement('p'));
    rewriter.flush();
    expect(p.textContent).toBe('It is 1.8 metres');

    const last = doc.body.lastElementChild!;
    last.append('the color');
    rewriter.flush();
    expect(last.textContent).toBe('the color');
    finish();
    expect(last.textContent).toBe('the colour');
  });

  it('does not wait for runs the parser has moved past', () => {
    const [doc, rewriter] = loading();
    const p = doc.createElement('p');
    doc.body.append(p);
    p.append('the color', doc.createElement('br'), 'the theater');
    rewriter.flush();
    expect(p.innerHTML).toBe('the colour<br>the theater');
  });
});

describe('shadow roots', () => {
  function attach(host: Element, html: string, mode: ShadowRootMode = 'open'): ShadowRoot {
    const root = host.attachShadow({ mode });
    root.innerHTML = html;
    return root;
  }

  it('rewrites the text a component renders itself', () => {
    const doc = page('<p>Light color</p><x-card><span>Slotted color</span></x-card>');
    const root = attach(doc.querySelector('x-card')!, '<p>Shadow color</p><slot></slot>');
    deamericaniseDom(doc);
    expect(doc.body.innerHTML).toBe('<p>Light colour</p><x-card><span>Slotted colour</span></x-card>');
    expect(root.innerHTML).toBe('<p>Shadow colour</p><slot></slot>');
  });

  it('enters nested roots, and the root of the element it starts from', () => {
    const doc = page('<x-outer></x-outer>');
    const outer = attach(doc.querySelector('x-outer')!, 'the color<x-inner></x-inner>');
    const inner = attach(outer.querySelector('x-inner')!, '<p title="gray">the theater</p>');
    deamericaniseDom(doc.querySelector('x-outer')!);
    expect(outer.innerHTML).toBe('the colour<x-inner></x-inner>');
    expect(inner.innerHTML).toBe('<p title="grey">the theatre</p>');
  });

  it('enters a closed root only through a lookup that can find it', () => {
    const doc = page('<x-card></x-card>');
    const host = doc.querySelector('x-card')!;
    const root = attach(host, '<p>the color</p>', 'closed');
    deamericaniseDom(doc);
    expect(root.innerHTML).toBe('<p>the color</p>');
    deamericaniseDom(doc, { shadowRoot: (element) => (element === host ? root : element.shadowRoot) });
    expect(root.innerHTML).toBe('<p>the colour</p>');
  });

  it('stays out of every root when the lookup finds none', () => {
    const doc = page('<x-card></x-card>');
    const root = attach(doc.querySelector('x-card')!, '<p>the color</p>');
    deamericaniseDom(doc, { shadowRoot: () => null });
    expect(root.innerHTML).toBe('<p>the color</p>');
  });

  it('asks only the elements that can host a root', () => {
    const asked = new Set<string>();
    const doc = page(
      '<p>a <b>b</b> <a href="#">c</a></p><ul><li>d</li></ul><input><video></video>' +
        '<details><summary>e</summary></details><svg><g></g></svg><x-card></x-card><div></div><span></span>',
    );
    deamericaniseDom(doc, {
      shadowRoot: (host) => {
        asked.add(host.localName);
        return null;
      },
    });
    expect([...asked].sort()).toEqual(['body', 'div', 'p', 'span', 'x-card']);
  });

  it.each([
    ['lang', '<x-card lang="fr"></x-card>'],
    ['translate="no"', '<x-card translate="no"></x-card>'],
    ['notranslate', '<div class="notranslate"><x-card></x-card></div>'],
    ['editable', '<div contenteditable="true"><x-card></x-card></div>'],
    ['code', '<code><x-card></x-card></code>'],
  ])("carries the host's %s into its root", (_, body) => {
    const doc = page(body);
    const root = attach(doc.querySelector('x-card')!, '<p>Couleur color</p>');
    deamericaniseDom(doc);
    expect(root.innerHTML).toBe('<p>Couleur color</p>');
  });

  it("reads the host's scope when started from a root", () => {
    const doc = page('<x-card lang="fr"></x-card>');
    const root = attach(doc.querySelector('x-card')!, '<p>Couleur color</p>');
    new DomRewriter(root).run();
    expect(root.innerHTML).toBe('<p>Couleur color</p>');
  });

  it('never joins a run across the edge of a root', () => {
    const doc = page('<x-size>2 inches</x-size>');
    const root = attach(doc.querySelector('x-size')!, 'It is 6 feet <slot></slot>');
    deamericaniseDom(doc);
    expect(root.innerHTML).toBe('It is 1.8 metres <slot></slot>');
    expect(doc.body.innerHTML).toBe('<x-size>5.1 centimetres</x-size>');
  });

  it('counts and highlights changes inside a root', () => {
    const doc = page('<p>the color</p><x-card></x-card>');
    const root = attach(doc.querySelector('x-card')!, '<p>the theater</p>');
    const rewriter = new DomRewriter(doc);
    rewriter.run();
    expect(rewriter.changes().map((c) => c.after)).toEqual(['colour', 'theatre']);
    expect(covered(rewriter)).toEqual([
      ['colour', 'colour'],
      ['theatre', 'theatre'],
    ]);
    const [, inside] = rewriter.highlights().sort((a, b) => a.change.after.localeCompare(b.change.after));
    expect(inside!.range.startContainer.getRootNode()).toBe(root);
  });

  it('follows text that changes inside a root', () => {
    const doc = page('<x-card></x-card>');
    const root = attach(doc.querySelector('x-card')!, '<p>the color</p>');
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    root.querySelector('p')!.append(' and gray');
    root.append('the theater');
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the colour and grey</p>the theatre');
  });

  it('finds the root of a component added later', () => {
    const doc = page('<p>the color</p>');
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    const card = doc.createElement('x-card');
    const root = attach(card, '<p>the theater</p>');
    doc.body.append(card);
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the theatre</p>');
    root.querySelector('p')!.append(' is gray');
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the theatre is grey</p>');
  });

  it("follows the host's scope as it changes", () => {
    const doc = page('<x-card></x-card>');
    const host = doc.querySelector('x-card')!;
    const root = attach(host, '<p>the color</p>');
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    expect(root.innerHTML).toBe('<p>the colour</p>');
    host.setAttribute('lang', 'fr');
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the color</p>');
  });

  it('leaves a root alone once its host is out of the page', () => {
    const doc = page('<x-card></x-card>');
    const host = doc.querySelector('x-card')!;
    const root = attach(host, '<p>the color</p>');
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    host.remove();
    rewriter.flush();
    root.append('the theater');
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the colour</p>the theater');
  });

  it('finds roots attached while the page loads once the document has loaded', () => {
    const doc = page('');
    let state: DocumentReadyState = 'loading';
    Object.defineProperty(doc, 'readyState', { configurable: true, get: () => state });
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    const card = doc.createElement('x-card');
    doc.body.append(card);
    rewriter.flush();
    const root = attach(card, '<p>the color</p>');
    doc.body.append(doc.createElement('p'));
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the color</p>');
    expect(rewriter.changes()).toEqual([]);
    state = 'interactive';
    doc.dispatchEvent(new Event('DOMContentLoaded'));
    expect(root.innerHTML).toBe('<p>the colour</p>');
    root.append('the theater');
    rewriter.flush();
    expect(root.innerHTML).toBe('<p>the colour</p>the theatre');
  });

  it('puts the text of every root back on stop', () => {
    const doc = page('<p>the color</p><x-outer></x-outer>');
    const outer = attach(doc.querySelector('x-outer')!, '<p title="gray">the color</p><x-inner></x-inner>');
    const inner = attach(outer.querySelector('x-inner')!, 'It is 6 feet <b>2</b> inches');
    const before = [doc.body.innerHTML, outer.innerHTML, inner.innerHTML];
    const rewriter = new DomRewriter(doc);
    rewriter.watch();
    expect(inner.innerHTML).toBe('It is 1.88 metres<b></b>');
    rewriter.stop({ restore: true });
    expect([doc.body.innerHTML, outer.innerHTML, inner.innerHTML]).toEqual(before);
    expect(rewriter.highlights()).toEqual([]);
  });
});

/**
 * Builds `source` into an empty document the way a parser would: every node is added at
 * the end, text arrives in pieces, and the observer gets to run at random points.
 */
function stream(source: Document, options: DomOptions, seed: number): [Document, DomRewriter] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };

  const doc = document.implementation.createHTMLDocument('');
  doc.documentElement.remove();
  let readyState: DocumentReadyState = 'loading';
  Object.defineProperty(doc, 'readyState', { configurable: true, get: () => readyState });

  const rewriter = new DomRewriter(doc, options);
  rewriter.watch();
  const maybeFlush = () => {
    if (random() < 0.3) rewriter.flush();
  };

  const copy = (from: Node, into: Node) => {
    if (from.nodeType === 3) {
      const data = (from as Text).data;
      const text = doc.createTextNode('');
      let cut = 0;
      into.appendChild(text);
      while (cut < data.length) {
        const next = Math.min(data.length, cut + 1 + Math.floor(random() * 24));
        text.appendData(data.slice(cut, next));
        cut = next;
        maybeFlush();
      }
      return;
    }
    if (from.nodeType !== 1) return;
    const element = from as Element;
    const clone = doc.createElementNS(element.namespaceURI, element.localName);
    for (const attribute of element.attributes) clone.setAttribute(attribute.name, attribute.value);
    into.appendChild(clone);
    maybeFlush();
    // A parser fills a declarative shadow root before the host's own children.
    if (element.shadowRoot) {
      const root = clone.attachShadow({ mode: 'open' });
      for (let child = element.shadowRoot.firstChild; child; child = child.nextSibling) copy(child, root);
    }
    for (let child = element.firstChild; child; child = child.nextSibling) copy(child, clone);
  };

  copy(source.documentElement, doc);
  rewriter.flush();
  readyState = 'interactive';
  doc.dispatchEvent(new Event('DOMContentLoaded'));
  return [doc, rewriter];
}

describe('html documents', () => {
  const fixtures = readdirSync(FIXTURES).filter((name) => /^[a-z-]+\.html$/.test(name));

  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('%s', (name) => {
    const html = readFileSync(join(FIXTURES, name), 'utf8');
    const base = name.replace(/\.html$/, '');
    const verdicts = BOTH_VERDICTS.has(base) ? (['detect', 'lang'] as const) : (['detect'] as const);

    it.each(verdicts)('rewrites as expected with verdict %s', async (verdict) => {
      const doc = parse(html);
      deamericaniseDom(doc, { verdict });
      const suffix = verdict === 'detect' ? '' : `.${verdict}`;
      await expect(serialise(doc)).toMatchFileSnapshot(`./fixtures/html/out/${base}${suffix}.html`);
    });

    it.each(verdicts)('ends the same however the page streams in, with verdict %s', (verdict) => {
      const whole = parse(html);
      const once = new DomRewriter(whole, { verdict });
      once.run();
      for (const seed of [1, 2, 3, 4, 5]) {
        const [streamed, rewriter] = stream(parse(html), { verdict }, seed);
        expect(serialise(streamed)).toBe(serialise(whole));
        expect(located(streamed, rewriter)).toEqual(located(whole, once));
      }
    });

    it('highlights every change to the text, where it reads', () => {
      const doc = parse(html);
      const rewriter = new DomRewriter(doc, { verdict: 'american', attributes: false });
      rewriter.run();
      const highlights = rewriter.highlights();
      expect(highlights.length).toBeGreaterThan(0);
      for (const [text, after] of covered(rewriter)) expect(text).toBe(after);
      const visible = rewriter.changes().filter((change) => change.after !== '');
      expect(new Set(highlights.map((h) => h.change))).toEqual(new Set(visible));
    });

    it('puts the page back exactly', () => {
      const doc = parse(html);
      const before = serialise(doc);
      const rewriter = new DomRewriter(doc, { verdict: 'american' });
      rewriter.watch();
      expect(serialise(doc)).not.toBe(before);
      rewriter.stop({ restore: true });
      expect(serialise(doc)).toBe(before);
    });
  });
});

describe('a page with shadow roots', () => {
  function build(): Document {
    const doc = parse(
      '<!doctype html><html lang="en-US"><head><title>t</title></head><body>' +
        '<p>The color of the theater was gray, and they canceled.</p>' +
        '<x-card><span>About 5 miles away.</span></x-card>' +
        '<p>Due 03/04/2024.</p></body></html>',
    );
    const root = doc.querySelector('x-card')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>It is 6 feet <b>2</b> inches wide, filed 3/14/2024.</p><x-inner></x-inner><slot></slot>';
    const inner = root.querySelector('x-inner')!.attachShadow({ mode: 'open' });
    inner.innerHTML = '<p>Bake at 350 °F for an hour, my favorite.</p>';
    return doc;
  }

  it('ends the same however it streams in', () => {
    const whole = build();
    const once = new DomRewriter(whole);
    once.run();
    expect(serialiseDeep(whole)).toContain('It is 1.88 metres<b></b> wide, filed 2024-03-14.');
    expect(serialiseDeep(whole)).toContain('Due 2024-03-04.');
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [streamed, rewriter] = stream(build(), {}, seed);
      expect(serialiseDeep(streamed)).toBe(serialiseDeep(whole));
      expect(located(streamed, rewriter)).toEqual(located(whole, once));
    }
  });
});
