// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WritingSuggestions, writingTarget, type PlacedSuggestion } from '../src/dom/suggest.js';
import type { Options } from '../src/index.js';

const AMERICAN: Options = { assumeAmerican: true };

function editable(html: string): HTMLElement {
  document.body.innerHTML = `<div id="editor" contenteditable="true">${html}</div>`;
  return document.getElementById('editor')!;
}

function text(range: StaticRange): string {
  const live = document.createRange();
  live.setStart(range.startContainer, range.startOffset);
  live.setEnd(range.endContainer, range.endOffset);
  return live.toString();
}

/** Each suggestion as the text it marks and what it would write. */
function marked(found: PlacedSuggestion[]): Array<[string, string]> {
  return found
    .map(({ change, range }): [string, string] => {
      expect(text(range)).toBe(change.before);
      return [change.before, change.after];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

describe('suggestions: in the value of a text field', () => {
  it('reads what is written as American when told to', () => {
    const found = new WritingSuggestions(AMERICAN).inText('The color was nice on 03/04/2024, it cost $50.');
    expect(found.map(({ change }) => [change.before, change.after])).toEqual([
      ['color', 'colour'],
      ['03/04/2024', '2024-03-04'],
      ['$50', 'US$50'],
    ]);
  });

  it('gives offsets into the text', () => {
    const value = 'A gray day.';
    const { change, edits } = new WritingSuggestions(AMERICAN).inText(value)[0]!;
    expect(value.slice(change.start, change.end)).toBe('gray');
    expect(edits).toEqual([change]);
  });

  it('follows the categories it is given', () => {
    const found = new WritingSuggestions({ ...AMERICAN, categories: { spelling: false } }).inText('The color.');
    expect(found).toEqual([]);
  });

  it('offers an article fix with the word it agrees with', () => {
    const found = new WritingSuggestions({ ...AMERICAN, preset: 'localise' }).inText('Use an eraser.');
    expect(found).toHaveLength(1);
    const { change, found: word, edits } = found[0]!;
    expect(change).toMatchObject({ before: 'an eraser', after: 'a rubber', start: 4, end: 13 });
    expect(word.before).toBe('eraser');
    // Last in the text first, so the article's offsets still hold once the word is replaced.
    expect(edits.map((edit) => [edit.before, edit.after])).toEqual([
      ['eraser', 'rubber'],
      ['an', 'a'],
    ]);
  });
});

describe('suggestions: in an editable element', () => {
  it('places each suggestion in the text node that holds it', () => {
    const root = editable('<p>The color of <b>gray</b> paint.</p>');
    expect(marked(new WritingSuggestions(AMERICAN).inEditable(root))).toEqual([
      ['color', 'colour'],
      ['gray', 'grey'],
    ]);
  });

  it('marks a change that crosses inline elements, and replaces it in one edit', () => {
    const root = editable('He is 6 feet <b>2</b> inches tall.');
    const [found, ...rest] = new WritingSuggestions(AMERICAN).inEditable(root);
    expect(rest).toEqual([]);
    expect(text(found!.range)).toBe('6 feet 2 inches');
    expect(found!.range.startContainer).not.toBe(found!.range.endContainer);
    expect(found!.edits.map(({ range, after }) => [text(range), after])).toEqual([
      ['6 feet 2 inches', found!.change.after],
    ]);
  });

  it('leaves out a change that crosses the edge of a link', () => {
    const root = editable('He is <a href="#">6 feet</a> 2 inches tall, in color.');
    expect(marked(new WritingSuggestions(AMERICAN).inEditable(root))).toEqual([['color', 'colour']]);
  });

  it('replaces an article fix and its word in one edit inside one text node', () => {
    const root = editable('Use an eraser.');
    const [found] = new WritingSuggestions({ ...AMERICAN, preset: 'localise' }).inEditable(root);
    expect(found!.edits.map(({ range, after }) => [text(range), after])).toEqual([['an eraser', 'a rubber']]);
  });

  it('places an article fix beside its word in another element', () => {
    const root = editable('Use an <i>eraser</i>.');
    const [found] = new WritingSuggestions({ ...AMERICAN, preset: 'localise' }).inEditable(root);
    expect(found!.change).toMatchObject({ before: 'an eraser', after: 'a rubber' });
    expect(text(found!.range)).toBe('an eraser');
    expect(found!.edits.map(({ range, after }) => [text(range), after])).toEqual([
      ['eraser', 'rubber'],
      ['an', 'a'],
    ]);
  });

  it('skips what cannot be typed in, and what is not English prose', () => {
    const root = editable(
      '<p>The color.</p>' +
        '<p contenteditable="false">The color.</p>' +
        '<p><code>color</code></p>' +
        '<p spellcheck="false">The color.</p>' +
        '<p lang="fr">The color.</p>' +
        '<p translate="no">The color.</p>' +
        '<p class="notranslate">The color.</p>',
    );
    const found = new WritingSuggestions(AMERICAN).inEditable(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.range.startContainer.parentElement).toBe(root.querySelector('p'));
  });

  it.each([
    ['translate="no"', '<div translate="no"><div id="host" contenteditable="true" translate="no">gray</div></div>'],
    ['notranslate', '<div class="notranslate"><div id="host" contenteditable="true" class="notranslate">gray</div></div>'],
    ['spellcheck="false"', '<div spellcheck="false"><div id="host" contenteditable="true" spellcheck="false">gray</div></div>'],
  ])('ignores %s on the editor and around it', (_, html) => {
    document.body.innerHTML = html;
    const root = document.getElementById('host')!;
    expect(marked(new WritingSuggestions(AMERICAN).inEditable(root))).toEqual([['gray', 'grey']]);
  });

  it('turns suggestions back on in an editable element inside one that is not', () => {
    const root = editable('<div contenteditable="false"><p spellcheck="true" contenteditable="true">gray</p></div>');
    expect(marked(new WritingSuggestions(AMERICAN).inEditable(root))).toEqual([['gray', 'grey']]);
  });
});

describe('suggestions: where someone is writing', () => {
  function field(html: string): Element {
    document.body.innerHTML = html;
    return document.getElementById('field')!;
  }

  it.each([
    '<textarea id="field"></textarea>',
    '<input id="field">',
    '<input id="field" type="text">',
    '<input id="field" type="TEXT">',
    '<div lang="en-US"><textarea id="field"></textarea></div>',
    '<textarea id="field" translate="no"></textarea>',
    '<div class="notranslate"><input id="field"></div>',
  ])('suggests in %s', (html) => {
    const element = field(html);
    expect(writingTarget(element)).toEqual({ kind: 'field', element });
  });

  it.each([
    '<input id="field" type="password">',
    '<input id="field" type="search">',
    '<input id="field" type="email">',
    '<input id="field" type="url">',
    '<input id="field" type="tel">',
    '<input id="field" type="number">',
    '<textarea id="field" readonly></textarea>',
    '<textarea id="field" disabled></textarea>',
    '<textarea id="field" spellcheck="false"></textarea>',
    '<form spellcheck="false"><textarea id="field"></textarea></form>',
    '<textarea id="field" lang="fr"></textarea>',
    '<div lang="de"><input id="field"></div>',
    '<textarea id="field" role="code"></textarea>',
    '<pre><textarea id="field"></textarea></pre>',
  ])('leaves %s alone', (html) => {
    expect(writingTarget(field(html))).toBeNull();
  });

  it('finds the editing host from an element inside it', () => {
    const root = editable('<p><b id="inside">gray</b></p>');
    expect(writingTarget(document.getElementById('inside')!)).toEqual({ kind: 'editable', element: root });
  });

  it('finds the inner host of an editable element inside one that is not', () => {
    editable('<div contenteditable="false"><p id="inner" contenteditable="">gray</p></div>');
    const inner = document.getElementById('inner')!;
    expect(writingTarget(inner)).toEqual({ kind: 'editable', element: inner });
  });

  it('finds nothing in an element that is not editable', () => {
    document.body.innerHTML = '<p id="plain">gray</p>';
    expect(writingTarget(document.getElementById('plain')!)).toBeNull();
  });

  it('takes the body of a document in design mode', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<p id="p">gray</p>';
    (doc as { designMode: string }).designMode = 'on';
    expect(writingTarget(doc.getElementById('p')!)).toEqual({ kind: 'editable', element: doc.body });
  });
});
