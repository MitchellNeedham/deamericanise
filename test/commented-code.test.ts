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
    ${'lisp'}       | ${'(setq color 1)'}
    ${'lisp'}       | ${'(defun pick (color) color)'}
    ${'lisp'}       | ${'(let* ((color 1))'}
    ${'lisp'}       | ${'(when (gray-p color)'}
    ${'lisp'}       | ${'  (pick color)))'}
    ${'lisp'}       | ${'  ((color 1)'}
    ${'clojure'}    | ${'(defn pick [color] color)'}
    ${'clojure'}    | ${'(ns color.core)'}
    ${'clojure'}    | ${'  [color]))'}
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
    ${'(see the color chart)'}
    ${'(When it is gray, center the dialog.)'}
    ${'(defaults to gray)'}
    ${'The color (gray (dark)).'}
    ${'The gray color :))'}
    ${'Pick the color (see [1])'}
    ${'The color ([1]) is gray.'}
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

describe('commented-out Lisp is left alone', () => {
  it.each`
    language     | source
    ${'lisp'}    | ${'; (setq color 1)'}
    ${'lisp'}    | ${';; (setq color 1)'}
    ${'lisp'}    | ${'; (defun pick (color) color)'}
    ${'lisp'}    | ${'; (let ((color 1)) color)'}
    ${'clojure'} | ${'; (def color "gray")'}
    ${'lisp'}    | ${';; (when (gray-p color)\n;;   (pick color)))'}
    ${'clojure'} | ${'; (let [color 1])'}
    ${'clojure'} | ${'; (defn pick [color] [color])'}
    ${'clojure'} | ${'; (def color {:a 1})'}
    ${'clojure'} | ${';   {:color "gray"}))'}
  `('$language leaves "$source" alone', ({ language, source }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(source);
  });

  it.each`
    language    | source                           | expected
    ${'lisp'}   | ${'; Pick the color.'}           | ${'; Pick the colour.'}
    ${'lisp'}   | ${';; Pick the color.'}          | ${';; Pick the colour.'}
    ${'lisp'}   | ${'; (See the color chart.)'}    | ${'; (See the colour chart.)'}
    ${'ts'}     | ${'// (see the color chart)'}    | ${'// (see the colour chart)'}
    ${'ts'}     | ${'// Set the default color.'}   | ${'// Set the default colour.'}
    ${'ts'}     | ${'// Pick the color (see [1])'}  | ${'// Pick the colour (see [1])'}
    ${'ts'}     | ${'// Pick the color [(see below)]'} | ${'// Pick the colour [(see below)]'}
    ${'ts'}     | ${'// The color ([1]) is gray.'}  | ${'// The colour ([1]) is grey.'}
  `('$language still rewrites "$source"', ({ language, source, expected }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(expected);
  });
});

describe('a line commented on top of a comment', () => {
  it.each`
    language     | source
    ${'ts'}      | ${'// // the color of the theater'}
    ${'ts'}      | ${'//// the color of the theater'}
    ${'python'}  | ${'# # the color of the theater'}
    ${'sql'}     | ${'-- -- the color of the theater'}
    ${'lisp'}    | ${'; ; the color of the theater'}
    ${'lisp'}    | ${';;; ;; the color of the theater'}
    ${'lisp'}    | ${';;;;; the color of the theater'}
    ${'vb'}      | ${"' ''' the color of the theater"}
    ${'vb'}      | ${"'''' the color of the theater"}
    ${'erlang'}  | ${'%%%% the color of the theater'}
    ${'fortran'} | ${'! !! the color of the theater'}
  `('$language leaves "$source" alone', ({ language, source }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(source);
  });
});

describe('a comment opened with the marker run its language writes by convention', () => {
  it.each`
    language     | source                                       | expected
    ${'lisp'}    | ${';; Pick the color.'}                      | ${';; Pick the colour.'}
    ${'lisp'}    | ${';;; Pick the color.'}                     | ${';;; Pick the colour.'}
    ${'lisp'}    | ${';;;; Pick the color.'}                    | ${';;;; Pick the colour.'}
    ${'lisp'}    | ${';;Pick the color.'}                       | ${';;Pick the colour.'}
    ${'lisp'}    | ${'(f\n  ;; Pick the\n  ;;\n  ;; color.\n  x)'} | ${'(f\n  ;; Pick the\n  ;;\n  ;; colour.\n  x)'}
    ${'vb'}      | ${"''' <summary>Pick the color.</summary>"}  | ${"''' <summary>Pick the colour.</summary>"}
    ${'vb'}      | ${"'''<summary>Pick the color.</summary>"}   | ${"'''<summary>Pick the colour.</summary>"}
    ${'matlab'}  | ${'%% Pick the color.'}                      | ${'%% Pick the colour.'}
    ${'erlang'}  | ${'%% Pick the color.'}                      | ${'%% Pick the colour.'}
    ${'erlang'}  | ${'%%% Pick the color.'}                     | ${'%%% Pick the colour.'}
    ${'fortran'} | ${'!! Pick the color.'}                      | ${'!! Pick the colour.'}
  `('$language rewrites "$source"', ({ language, source, expected }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(expected);
  });

  it.each`
    language    | source                     | expected
    ${'lisp'}   | ${'; Pick the color.'}     | ${'; Pick the colour.'}
    ${'vb'}     | ${"' Pick the color."}     | ${"' Pick the colour."}
    ${'matlab'} | ${'% Pick the color.'}     | ${'% Pick the colour.'}
    ${'rust'}   | ${'/// the color'}         | ${'/// the colour'}
  `('$language still rewrites "$source"', ({ language, source, expected }) => {
    expect(deamericaniseCode(source as string, { language: language as string }).text).toBe(expected);
  });

  it('reads a run as one text only with lines opened by the same run', () => {
    expect(deamericaniseCode(';;; Use `the\n;; color` here.', { language: 'lisp' }).text).toBe(
      ';;; Use `the\n;; colour` here.',
    );
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

  it('reads each line of a doc comment without its star', () => {
    const source = '/**\n * const color = 1;\n * The color.\n */';
    expect(deamericaniseCode(source, { language: 'ts' }).text).toBe('/**\n * const color = 1;\n * The colour.\n */');
  });

  it('reads each line of a run of line comments as a line', () => {
    const source = '// const color = 1;\n// The color.\n';
    expect(deamericaniseCode(source, { language: 'ts' }).text).toBe('// const color = 1;\n// The colour.\n');
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
