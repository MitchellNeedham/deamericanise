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

  it('drops the article fix that leaned on a skipped change', () => {
    const localise: DomOptions = { preset: 'localise' };
    expect(rewrite('<p>Press a gas pedal.</p>', localise)).toBe('<p>Press an accelerator.</p>');
    expect(rewrite('<p>Press a <a href="#">gas</a> pedal.</p>', localise)).toBe(
      '<p>Press a <a href="#">gas</a> pedal.</p>',
    );
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

  it('does not let an opt-in undo notranslate', () => {
    expect(rewrite('<div class="notranslate"><p translate="yes">color</p></div>')).toBe(
      '<div class="notranslate"><p translate="yes">color</p></div>',
    );
  });

  it('leaves a page in another language alone', () => {
    expect(rewrite('<p>the color</p>', {}, 'de')).toBe('<p>the color</p>');
    expect(rewrite('<p lang="en">the color</p>', {}, 'de')).toBe('<p lang="en">the colour</p>');
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

/**
 * Builds `source` into an empty document the way a parser would: every node is added at
 * the end, text arrives in pieces, and the observer gets to run at random points.
 */
function stream(source: Document, options: DomOptions, seed: number): Document {
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
    for (let child = element.firstChild; child; child = child.nextSibling) copy(child, clone);
  };

  copy(source.documentElement, doc);
  rewriter.flush();
  readyState = 'interactive';
  doc.dispatchEvent(new Event('DOMContentLoaded'));
  return doc;
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
      deamericaniseDom(whole, { verdict });
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(serialise(stream(parse(html), { verdict }, seed))).toBe(serialise(whole));
      }
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
