import { describe, expect, it } from 'vitest';
import { deamericaniseCode, deamericaniseText } from '../src/index.js';
import { looksLikeCode } from '../src/engine/code-shape.js';

/**
 * Someone selects a whole file, hits ctrl+/, and every line becomes a comment. Nothing
 * in it should move, or the code breaks the moment they undo it.
 */
describe('lines that read as code, across languages', () => {
  it.each`
    language        | line
    ${'js'}         | ${'const color = "color";'}
    ${'js'}         | ${'let center = getCenter();'}
    ${'js'}         | ${'if (color === "gray") {'}
    ${'js'}         | ${'  theme.color = normalize(color);'}
    ${'js'}         | ${'}'}
    ${'js'}         | ${'});'}
    ${'js'}         | ${'return color;'}
    ${'js'}         | ${'export function normalizeColor(color) {'}
    ${'js'}         | ${'  color: "gray",'}
    ${'ts'}         | ${'interface Theme { color: string }'}
    ${'ts'}         | ${'const toGray = (c: Color): Color => c;'}
    ${'python'}     | ${'color = 1'}
    ${'python'}     | ${'def get_color():'}
    ${'python'}     | ${'    return self.color'}
    ${'python'}     | ${'import color_utils'}
    ${'go'}         | ${'color := theme.Color'}
    ${'php'}        | ${'$color = "red";'}
    ${'sql'}        | ${'SELECT color FROM theme;'}
    ${'sql'}        | ${'  WHERE color = 1'}
    ${'css'}        | ${'color: red;'}
    ${'css'}        | ${'.theater { color: gray }'}
    ${'ruby'}       | ${'theme.color = "gray"'}
    ${'rust'}       | ${'pub fn color() -> Color {'}
    ${'yaml'}       | ${'color: gray'}
    ${'shell'}      | ${'export COLOR=gray'}
  `('$language: "$line"', ({ line }) => {
    expect(looksLikeCode(line as string)).toBe(true);
  });
});

describe('prose comments are not mistaken for code', () => {
  it.each`
    line
    ${'Set the default color to gray and center the dialog.'}
    ${'Returns the color of the theater, canceled or not.'}
    ${'TODO: fix the color handling (see #123).'}
    ${'The color is red, the center is blue.'}
    ${'Note: this behavior is deliberate.'}
    ${'We organized the colors by favorite.'}
    ${'If the color is gray, the theater is closed.'}
    ${'Return the color to the caller when done.'}
    ${'See the note (below) about color.'}
    ${'This is 6 feet long and costs $50.'}
  `('"$line"', ({ line }) => {
    expect(looksLikeCode(line as string)).toBe(false);
  });
});

describe('a whole file commented out is left alone', () => {
  const source = [
    '// const color = "color";',
    '// let center = getCenter();',
    '// if (color === "gray") {',
    '//   theme.color = normalize(color);',
    '// }',
    '// return color;',
  ].join('\n');

  it('changes nothing', () => {
    const result = deamericaniseCode(source, { language: 'ts' });
    expect(result.text).toBe(source);
    expect(result.changes).toHaveLength(0);
  });

  it.each`
    language     | source
    ${'python'}  | ${'# color = "gray"\n# def get_color():\n#     return color'}
    ${'sql'}     | ${'-- SELECT color FROM theme;\n-- WHERE center = 1;'}
    ${'ruby'}    | ${'# theme.color = "gray"\n# puts theme.color'}
    ${'css'}     | ${'/* color: gray; */'}
  `('$language too', ({ language, source }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(source);
  });
});

describe('a line commented on top of a comment', () => {
  it.each`
    language     | source
    ${'ts'}      | ${'// // the color of the theater'}
    ${'python'}  | ${'# # the color of the theater'}
    ${'sql'}     | ${'-- -- the color of the theater'}
  `('$language leaves "$source" alone', ({ language, source }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(source);
  });
});

describe('prose and code in the same comment', () => {
  it('rewrites the sentences and leaves the example', () => {
    const source = [
      '/**',
      ' * Normalizes the color and centers it.',
      ' * @param {string} color - the color to normalize',
      ' * @example',
      ' *   const c = normalize("color");',
      ' */',
    ].join('\n');

    expect(deamericaniseCode(source, { language: 'ts' }).text).toBe(
      [
        '/**',
        ' * Normalises the colour and centres it.',
        ' * @param {string} color - the colour to normalise',
        ' * @example',
        ' *   const c = normalize("color");',
        ' */',
      ].join('\n'),
    );
  });

  it('still rewrites a trailing comment beside real code', () => {
    expect(deamericaniseCode('const color = 1; // the color used everywhere', { language: 'ts' }).text)
      .toBe('const color = 1; // the colour used everywhere');
  });
});

describe('the guard can be turned off, and is off for prose', () => {
  it('is off by default for plain text', () => {
    expect(deamericaniseText('const color = "color";')).toBe('const colour = "colour";');
  });

  it('can be switched off for source files', () => {
    expect(
      deamericaniseCode('// const color = 1;', { language: 'ts', protectCommentedCode: false }).text,
    ).toBe('// const colour = 1;');
  });
});

describe('language names people actually type', () => {
  it.each`
    name              | why
    ${'ruby'}         | ${'not just the rb extension'}
    ${'shell'}        | ${'not just sh'}
    ${'golang'}       | ${'as well as go'}
    ${'c++'}          | ${'as well as cpp'}
    ${'c#'}           | ${'as well as cs'}
    ${'clojure'}      | ${'as well as clj'}
    ${'python3'}      | ${'as well as python'}
    ${'html'}         | ${'the markup lexer'}
    ${'dockerfile'}   | ${'a filename, used as a language'}
    ${'postgresql'}   | ${'the sql lexer'}
  `('$name resolves ($why)', ({ name }) => {
    expect(() => deamericaniseCode('// color', { language: name as string })).not.toThrow();
  });
});
