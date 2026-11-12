import { describe, expect, it } from 'vitest';
import { UnknownLanguageError, deamericaniseCode, deamericaniseFile } from '../src/index.js';

const rewrite = (language: string, source: string) => deamericaniseCode(source, { language }).text;

describe('comments are rewritten, everything else is not', () => {
  it.each`
    language        | source                                          | expected
    ${'ts'}         | ${'// the color'}                               | ${'// the colour'}
    ${'ts'}         | ${'/* the color */'}                            | ${'/* the colour */'}
    ${'ts'}         | ${'const x = 1; // canceled'}                   | ${'const x = 1; // cancelled'}
    ${'python'}     | ${'# the color'}                                | ${'# the colour'}
    ${'sql'}        | ${'-- the color'}                               | ${'-- the colour'}
    ${'lua'}        | ${'-- the color'}                               | ${'-- the colour'}
    ${'lua'}        | ${'--[[ the color ]]'}                          | ${'--[[ the colour ]]'}
    ${'haskell'}    | ${'{- the color -}'}                            | ${'{- the colour -}'}
    ${'lisp'}       | ${'; the color'}                                | ${'; the colour'}
    ${'markup'}     | ${'<!-- the color -->'}                         | ${'<!-- the colour -->'}
    ${'php'}        | ${'# the color'}                                | ${'# the colour'}
    ${'powershell'} | ${'<# the color #>'}                            | ${'<# the colour #>'}
    ${'erlang'}     | ${'% the color'}                                | ${'% the colour'}
    ${'vb'}         | ${"' the color"}                                | ${"' the colour"}
    ${'fortran'}    | ${'! the color'}                                | ${'! the colour'}
    ${'rust'}       | ${'// the color'}                               | ${'// the colour'}
    ${'ini'}        | ${'; the color'}                                | ${'; the colour'}
  `('$language: $source -> $expected', ({ language, source, expected }) => {
    expect(rewrite(language, source)).toBe(expected);
  });
});

describe('string literals are never touched', () => {
  it.each`
    language     | unchanged                                              | why
    ${'ts'}      | ${'const c = "color";'}                                | ${'a double-quoted string'}
    ${'ts'}      | ${"const c = 'color';"}                                | ${'a single-quoted string'}
    ${'ts'}      | ${'const c = `color ${x}`;'}                           | ${'a template literal'}
    ${'ts'}      | ${'const s = "// color";'}                             | ${'a comment marker inside a string'}
    ${'ts'}      | ${'const s = "/* color */";'}                          | ${'same'}
    ${'python'}  | ${'c = "# color"'}                                     | ${'same'}
    ${'sql'}     | ${"SELECT 'color -- center';"}                         | ${'same'}
    ${'sql'}     | ${"SELECT 'it''s a color';"}                           | ${'a doubled quote escape'}
    ${'ts'}      | ${'const s = "he said \\"color\\"";'}                  | ${'an escaped quote'}
  `('$language: leaves $unchanged alone ($why)', ({ language, unchanged }) => {
    expect(rewrite(language, unchanged)).toBe(unchanged);
  });
});

describe('the awkward corners of each family', () => {
  it('does not read regex slashes as a comment', () => {
    const source = 'const re = /https:\\/\\/color/; // the color';
    expect(rewrite('ts', source)).toBe('const re = /https:\\/\\/color/; // the colour');
  });

  it('treats division as division, not a regex', () => {
    expect(rewrite('ts', 'const half = total / 2; // color')).toBe('const half = total / 2; // colour');
  });

  it('handles nested block comments in Rust', () => {
    expect(rewrite('rust', '/* color /* center */ gray */')).toBe('/* colour /* centre */ grey */');
  });

  it('leaves Python docstrings alone by default', () => {
    expect(rewrite('python', '"""The color."""')).toBe('"""The color."""');
  });

  it('rewrites Python docstrings when asked', () => {
    expect(deamericaniseCode('"""The color."""', { language: 'python', docstrings: true }).text)
      .toBe('"""The colour."""');
  });

  it('survives an unterminated block comment', () => {
    expect(rewrite('ts', '/* the color')).toBe('/* the colour');
  });

  it('survives an unterminated string', () => {
    expect(rewrite('ts', 'const s = "color; // the color')).toBe('const s = "color; // the colour');
  });
});

describe('identifiers inside comments survive', () => {
  const source = [
    '// Set backgroundColor and the --text-color flag; see theme.colors.gray.',
    '// Then pick the right color for the center of the dialog.',
  ].join('\n');

  it('rewrites the prose and not the references', () => {
    expect(rewrite('ts', source)).toBe(
      [
        '// Set backgroundColor and the --text-color flag; see theme.colors.gray.',
        '// Then pick the right colour for the centre of the dialogue.',
      ].join('\n'),
    );
  });
});

describe('an initialism in a comment is not a dotted name', () => {
  it.each`
    source                                  | options                   | expected
    ${'// Only ships to the U.S.\n'}        | ${{ preset: 'localise' }} | ${'// Only ships to the US.\n'}
    ${'// Ask a Ph.D. student.\n'}          | ${{ preset: 'localise' }} | ${'// Ask a PhD student.\n'}
    ${'// Two P.M.s and a Ph.D.\n'}         | ${{ preset: 'localise' }} | ${'// Two PMs and a PhD.\n'}
    ${'// Runs at 3 p.m. every day.\n'}     | ${{}}                     | ${'// Runs at 3pm every day.\n'}
    ${'// e.g. the color\n'}                | ${{}}                     | ${'// e.g. the colour\n'}
    ${'// see theme.colors.gray.\n'}        | ${{}}                     | ${'// see theme.colors.gray.\n'}
    ${'// call os.path.join() first\n'}     | ${{}}                     | ${'// call os.path.join() first\n'}
    ${'// read io.Color.Gray.\n'}           | ${{}}                     | ${'// read io.Color.Gray.\n'}
  `('$source -> $expected', ({ source, options, expected }) => {
    expect(deamericaniseCode(source, { language: 'ts', ...options }).text).toBe(expected);
  });
});

describe('inline code inside a comment', () => {
  it.each`
    source                                                              | expected                                                             | why
    ${'/* Use `the\n   color` here. */'}                                | ${'/* Use `the\n   color` here. */'}                                 | ${'a span that wraps in a block comment'}
    ${"/**\n * It's a `stray backtick.\n *\n * The color is `red`.\n */"} | ${"/**\n * It's a `stray backtick.\n *\n * The colour is `red`.\n */"} | ${'a bare star line ends the paragraph'}
    ${"/**\n * Don't use a ` here.\n *\n * Use `color`.\n */"}            | ${"/**\n * Don't use a ` here.\n *\n * Use `color`.\n */"}             | ${'a backtick does not pair across a bare star line'}
    ${"/**\n * Don't use a ` here.\n * Use `color` and `center`.\n */"}  | ${"/**\n * Don't use a ` here.\n * Use `colour` and `centre`.\n */"}  | ${'a stray backtick pairs within its paragraph, as in Markdown'}
    ${"/**\n * - Don't use a ` here.\n * - Use `color` and `center`.\n */"} | ${"/**\n * - Don't use a ` here.\n * - Use `color` and `center`.\n */"} | ${'a list item after the star ends the paragraph'}
    ${"/**\n * Don't use a ` here.\n * * Use `color` and `center`.\n */"} | ${"/**\n * Don't use a ` here.\n * * Use `color` and `center`.\n */"} | ${'so does a star bullet after the star'}
    ${'/**\n * Use `the\n * color` here.\n */\n'}                        | ${'/**\n * Use `the\n * color` here.\n */\n'}                        | ${'a span that wraps onto a line that starts with a star'}
    ${'/** Use `the\n *  color` here. */'}                              | ${'/** Use `the\n *  color` here. */'}                              | ${'and starts on the line that opens the comment'}
    ${'// Use `the\n// color` here.\n'}                                 | ${'// Use `the\n// color` here.\n'}                                 | ${'a span that wraps onto the next line comment'}
    ${'  // Use `the\n  // color` here.\n'}                             | ${'  // Use `the\n  // color` here.\n'}                             | ${'indented line comments'}
    ${'x = 1; // Use `the\n       // color` here.\n'}                   | ${'x = 1; // Use `the\n       // color` here.\n'}                   | ${'a trailing comment and the comment lined up beneath it'}
    ${'// Use `the\n//\n// color` here.\n'}                             | ${'// Use `the\n//\n// colour` here.\n'}                            | ${'a bare marker line ends the paragraph'}
    ${'// Use `color`.\n'}                                              | ${'// Use `color`.\n'}                                              | ${'a span on one comment line'}
  `('$why', ({ source, expected }) => {
    expect(rewrite('ts', source)).toBe(expected);
  });

  it.each`
    language    | source                                         | expected
    ${'python'} | ${'# Use `the\n# color` here.\n'}              | ${'# Use `the\n# color` here.\n'}
    ${'rust'}   | ${'/// Use `the\n/// color` here.\n'}          | ${'/// Use `the\n/// color` here.\n'}
    ${'rust'}   | ${'//! Use `the\n//! color` here.\n'}          | ${'//! Use `the\n//! color` here.\n'}
    ${'sql'}    | ${'-- Use `the\n-- color` here.\n'}            | ${'-- Use `the\n-- color` here.\n'}
    ${'rust'}   | ${'/// Use `the\n///\n/// color` here.\n'}     | ${'/// Use `the\n///\n/// colour` here.\n'}
  `('$language: a span that wraps across line comments', ({ language, source, expected }) => {
    expect(rewrite(language, source)).toBe(expected);
  });
});

describe('which line comments are read as one text', () => {
  it.each`
    source                                           | why
    ${'x = 1; // Use `the\n// color` here.\n'}       | ${'a trailing comment and one that is not lined up with it'}
    ${'x = 1; // Use `the\ny = 2; // color` here.\n'} | ${'two trailing comments lined up'}
    ${'// Use `the\n  // color` here.\n'}            | ${'comments at different columns'}
    ${'// Use `the\nx = 1;\n// color` here.\n'}      | ${'comments with code between them'}
    ${'// Use `the\n\n// color` here.\n'}            | ${'comments with a blank line between them'}
    ${'/* Use `the */\n// color` here.\n'}           | ${'a block comment and a line comment'}
  `('not $why', ({ source }) => {
    expect(rewrite('ts', source)).toBe(source.replace('color', 'colour'));
  });

  it('not a doc comment and a plain one', () => {
    expect(rewrite('rust', '/// Use `the\n// color` here.\n')).toBe('/// Use `the\n// colour` here.\n');
  });

  it('not two markers of the same language', () => {
    expect(rewrite('php', '// Use `the\n# color` here.\n')).toBe('// Use `the\n# colour` here.\n');
  });

  it('sees an ignore block across them', () => {
    const source = '// deamericanise-ignore-start\n// the color\n// deamericanise-ignore-end\n// the color\n';
    expect(rewrite('ts', source)).toBe(
      '// deamericanise-ignore-start\n// the color\n// deamericanise-ignore-end\n// the colour\n',
    );
  });

  it('keeps a change from crossing the marker between two of them', () => {
    expect(rewrite('ts', '// It is 6\n// feet tall.\n')).toBe('// It is 6\n// feet tall.\n');
    expect(rewrite('ts', '/**\n * It is 6\n * feet tall.\n */')).toBe('/**\n * It is 6\n * feet tall.\n */');
  });

  it('lets a change cross a line of a block comment with no star on it', () => {
    expect(rewrite('ts', '/* It is 6\n   feet tall. */')).toBe('/* It is 1.8 metres tall. */');
  });
});

describe('an article at the end of a comment line', () => {
  it.each`
    language    | source                                          | expected
    ${'ts'}     | ${'/**\n * Use an\n * eraser here.\n */'}       | ${'/**\n * Use a\n * rubber here.\n */'}
    ${'ts'}     | ${'// Use an\n// eraser here.\n'}               | ${'// Use a\n// rubber here.\n'}
    ${'ts'}     | ${'/* Use an\n   eraser here. */'}              | ${'/* Use a\n   rubber here. */'}
    ${'python'} | ${'# Use an\n# eraser here.\n'}                 | ${'# Use a\n# rubber here.\n'}
    ${'rust'}   | ${'/// Use an\n/// eraser here.\n'}             | ${'/// Use a\n/// rubber here.\n'}
  `('agrees with the word on the next line: $source', ({ language, source, expected }) => {
    expect(deamericaniseCode(source, { language, preset: 'localise' }).text).toBe(expected);
  });

  it.each`
    language    | source                                          | expected
    ${'ts'}     | ${'// Use an\n//\n// eraser here.\n'}           | ${'// Use an\n//\n// rubber here.\n'}
    ${'ts'}     | ${'/**\n * Use an\n *\n * eraser here.\n */'}   | ${'/**\n * Use an\n *\n * rubber here.\n */'}
    ${'python'} | ${'# Use an\n#\n# eraser here.\n'}              | ${'# Use an\n#\n# rubber here.\n'}
  `('leaves an article that ends a paragraph: $source', ({ language, source, expected }) => {
    expect(deamericaniseCode(source, { language, preset: 'localise' }).text).toBe(expected);
  });

  it('points the article fix at its replacement on the next line', () => {
    const source = 'const a = 1;\n/**\n * Use an\n * eraser here.\n */\n';
    const [article, word] = deamericaniseCode(source, { language: 'ts', preset: 'localise' }).changes;
    expect(source.slice(article!.start, article!.end)).toBe('an');
    expect(source.slice(word!.start, word!.end)).toBe('eraser');
    expect(article?.agreesWith).toEqual({ start: word!.start, end: word!.end });
  });
});

describe('an article in a comment', () => {
  it.each`
    source                                       | options                                     | expected
    ${'// He drove a pickup truck.\n'}           | ${{ preset: 'localise' }}                   | ${'// He drove a ute.\n'}
    ${'// He drove a pickup truck.\n'}           | ${{ preset: 'localise', dialect: 'en-NZ' }} | ${'// He drove a ute.\n'}
    ${'// Plan A popsicle.\n'}                   | ${{ preset: 'localise', dialect: 'en-GB' }} | ${'// Plan A ice lolly.\n'}
    ${'// It melted.\n// A popsicle is cold.\n'} | ${{ preset: 'localise' }}                   | ${'// It melted.\n// An icy pole is cold.\n'}
  `('is fixed only where it is one: $source', ({ source, options, expected }) => {
    expect(deamericaniseCode(source, { language: 'ts', ...options }).text).toBe(expected);
  });
});

describe('a fenced example inside a block comment', () => {
  it.each`
    source                                                                                   | expected                                                                                  | why
    ${'/**\n * Prints:\n * ```text\n * the color\n * ```\n * The color is red.\n */'}         | ${'/**\n * Prints:\n * ```text\n * the color\n * ```\n * The colour is red.\n */'}         | ${'the closing line repeats the star'}
    ${'/*\n * ~~~\n * the color\n * ~~~\n * The color is red.\n */'}                          | ${'/*\n * ~~~\n * the color\n * ~~~\n * The colour is red.\n */'}                          | ${'a tilde fence'}
    ${'/**\n *\n *     ```text\n *     the color\n *     ```\n *\n * The color is red.\n */'}  | ${'/**\n *\n *     ```text\n *     the color\n *     ```\n *\n * The colour is red.\n */'}  | ${'a fence indented past the star'}
  `('$why', ({ source, expected }) => {
    expect(rewrite('ts', source)).toBe(expected);
  });
});

describe('a fenced example across line comments', () => {
  it.each`
    language    | source                                                              | expected
    ${'rust'}   | ${'/// ```\n/// let color = 1;\n/// ```\n'}                         | ${'/// ```\n/// let color = 1;\n/// ```\n'}
    ${'rust'}   | ${'//! ```\n//! let color = 1;\n//! ```\n//! The color is red.\n'}  | ${'//! ```\n//! let color = 1;\n//! ```\n//! The colour is red.\n'}
    ${'ts'}     | ${'// ```\n// the color\n// ```\n// The color is red.\n'}           | ${'// ```\n// the color\n// ```\n// The colour is red.\n'}
    ${'python'} | ${'# ```\n# the color\n# ```\n# The color is red.\n'}               | ${'# ```\n# the color\n# ```\n# The colour is red.\n'}
  `('$language: $source', ({ language, source, expected }) => {
    expect(rewrite(language, source)).toBe(expected);
  });
});

describe('a comment that ends on an initialism', () => {
  it.each`
    language    | source                                         | expected
    ${'ts'}     | ${'// She has a Ph. D.\nconst x = 1;'}         | ${'// She has a PhD.\nconst x = 1;'}
    ${'ts'}     | ${'const x = 1; // She has a Ph. D.'}          | ${'const x = 1; // She has a PhD.'}
    ${'python'} | ${'# She has a Ph. D. It took years.'}         | ${'# She has a PhD. It took years.'}
    ${'ts'}     | ${'/* She has a Ph. D. */'}                    | ${'/* She has a PhD. */'}
    ${'ts'}     | ${'/**\n * She has a Ph. D.\n * It took years.\n */'} | ${'/**\n * She has a PhD.\n * It took years.\n */'}
    ${'ts'}     | ${'// She has a Ph. D. in physics.'}           | ${'// She has a PhD in physics.'}
  `('keeps the sentence stop where it ends one: $source', ({ language, source, expected }) => {
    expect(deamericaniseCode(source, { language, preset: 'localise' }).text).toBe(expected);
  });
});

describe('picking the handler from a filename', () => {
  it.each`
    filename            | source                    | expected
    ${'a.ts'}           | ${'// color'}             | ${'// colour'}
    ${'a.py'}           | ${'# color'}              | ${'# colour'}
    ${'README.md'}      | ${'the color'}            | ${'the colour'}
    ${'notes.txt'}      | ${'the color'}            | ${'the colour'}
    ${'Dockerfile'}     | ${'# color'}              | ${'# colour'}
    ${'a.unknown'}      | ${'the color'}            | ${'the colour'}
  `('$filename is handled as expected', ({ filename, source, expected }) => {
    expect(deamericaniseFile(filename, source).text).toBe(expected);
  });

  it('treats a markdown file as prose, so its code fences are safe', () => {
    const source = 'The color is red.\n\n```js\nconst color = 1;\n```\n';
    expect(deamericaniseFile('README.md', source).text)
      .toBe('The colour is red.\n\n```js\nconst color = 1;\n```\n');
  });
});

describe("a prose file's type decides how its code fences are read", () => {
  const rst = 'Colors\n~~~~~~\n\nThe color of things.\n\nBehavior\n~~~~~~~~\n\nMore color.\n';
  const rstOut = 'Colours\n~~~~~~\n\nThe colour of things.\n\nBehaviour\n~~~~~~~~\n\nMore colour.\n';
  const tildeFence = 'The color.\n\n~~~\nconst color = 1;\n~~~\n';
  const tildeFenceOut = 'The colour.\n\n~~~\nconst color = 1;\n~~~\n';

  it.each`
    filename        | language     | source                                                       | expected                                                      | why
    ${'guide.rst'}  | ${undefined} | ${rst}                                                       | ${rstOut}                                                     | ${'a tilde heading underline in reStructuredText'}
    ${'story.txt'}  | ${undefined} | ${'The color of the sky.\n\n~~~\n\nThe color of the sea.\n'} | ${'The colour of the sky.\n\n~~~\n\nThe colour of the sea.\n'} | ${'a tilde divider in plain text'}
    ${'notes.txt'}  | ${undefined} | ${'The color.\n\n```\nconst color = 1;\n```\n'}              | ${'The colour.\n\n```\nconst color = 1;\n```\n'}              | ${'a backtick block in plain text, protected as before'}
    ${'stdin'}      | ${'rst'}     | ${rst}                                                       | ${rstOut}                                                     | ${'a prose language other than Markdown'}
    ${'README.md'}  | ${undefined} | ${tildeFence}                                                | ${tildeFenceOut}                                              | ${'a tilde fence in Markdown'}
    ${'page.mdx'}   | ${undefined} | ${'````\n```\nconst color = 1;\n```\n````\nThe color.'}      | ${'````\n```\nconst color = 1;\n```\n````\nThe colour.'}     | ${'a four-backtick fence in MDX'}
    ${'stdin'}      | ${'md'}      | ${tildeFence}                                                | ${tildeFenceOut}                                              | ${'the Markdown language'}
    ${'notes.data'} | ${undefined} | ${tildeFence}                                                | ${tildeFenceOut}                                              | ${'an unknown type reads as deamericaniseText does'}
  `('$why', ({ filename, language, source, expected }) => {
    expect(deamericaniseFile(filename, source, language ? { language } : {}).text).toBe(expected);
  });
});

describe("a prose file's type decides whether indented code is protected", () => {
  const indented = 'Set the theme:\n\n    color = "gray";\n';
  const kept = 'Set the theme:\n\n    color = "gray";\n';
  const rewritten = 'Set the theme:\n\n    colour = "grey";\n';

  it.each`
    filename           | options                   | expected     | why
    ${'README.md'}     | ${{}}                     | ${kept}      | ${'a Markdown file'}
    ${'page.mdx'}      | ${{}}                     | ${kept}      | ${'an MDX file'}
    ${'notes.MARKDOWN'} | ${{}}                    | ${kept}      | ${'the long extension, in any case'}
    ${'stdin'}         | ${{ language: 'md' }}     | ${kept}      | ${'the Markdown language'}
    ${'stdin.txt'}     | ${{ syntax: 'markdown' }} | ${kept}      | ${'a syntax option, which wins over the type'}
    ${'notes.txt'}     | ${{}}                     | ${rewritten} | ${'a plain text file'}
    ${'guide.rst'}     | ${{}}                     | ${rewritten} | ${'reStructuredText'}
    ${'README.md'}     | ${{ syntax: 'text' }}     | ${rewritten} | ${'a Markdown file read as plain text'}
    ${'notes.data'}    | ${{}}                     | ${rewritten} | ${'an unknown type, read as deamericaniseText reads it'}
    ${'CHANGELOG'}     | ${{}}                     | ${rewritten} | ${'no extension'}
  `('$why', ({ filename, options, expected }) => {
    expect(deamericaniseFile(filename, indented, options).text).toBe(expected);
  });

  it("keeps a .txt file's indented prose and a Markdown list item's paragraphs as prose", () => {
    expect(deamericaniseFile('a.txt', 'Dear Sam,\n\n    The color is gray.').text).toBe('Dear Sam,\n\n    The colour is grey.');
    expect(deamericaniseFile('README.md', '- The color\n    is red.').text).toBe('- The colour\n    is red.');
    expect(deamericaniseFile('README.md', '1.  Step one.\n\n    More about the color.').text).toBe(
      '1.  Step one.\n\n    More about the colour.',
    );
  });
});

describe("a comment is read in its language's doc markup", () => {
  const rstDocstring =
    'def f():\n    """\n    Colors\n    ~~~~~~\n\n    The color of things.\n\n    Behavior\n    ~~~~~~~~\n\n    More color.\n    """\n';

  it('reads a tilde heading underline in a Python docstring as reStructuredText', () => {
    expect(deamericaniseCode(rstDocstring, { language: 'python', docstrings: true }).text).toBe(
      'def f():\n    """\n    Colours\n    ~~~~~~\n\n    The colour of things.\n\n    Behaviour\n    ~~~~~~~~\n\n    More colour.\n    """\n',
    );
  });

  it.each`
    language    | source                                                                                         | expected                                                                                         | why
    ${'python'} | ${'def f():\n    """\n    Run:\n\n    ```\n    color = 1\n    ```\n\n    The color.\n    """\n'} | ${'def f():\n    """\n    Run:\n\n    ```\n    color = 1\n    ```\n\n    The colour.\n    """\n'} | ${'a backtick example in a Python docstring'}
    ${'ts'}     | ${'/**\n * ~~~\n * the color\n * ~~~\n * The color is red.\n */'}                                | ${'/**\n * ~~~\n * the color\n * ~~~\n * The colour is red.\n */'}                                | ${'a tilde fence in JSDoc'}
    ${'rs'}     | ${'/**\n * ```\n * the color\n * ```\n * The color is red.\n */'}                                | ${'/**\n * ```\n * the color\n * ```\n * The colour is red.\n */'}                                | ${'a backtick fence in rustdoc'}
  `('keeps $why protected', ({ language, source, expected }) => {
    expect(deamericaniseCode(source, { language, docstrings: true }).text).toBe(expected);
  });

  it('ignores a syntax option, which names the markup of prose', () => {
    const source = '/*\n * ~~~\n * the color\n * ~~~\n */';
    expect(deamericaniseCode(source, { language: 'ts', syntax: 'text' }).text).toBe(source);
    expect(deamericaniseFile('a.py', rstDocstring, { docstrings: true, syntax: 'markdown' }).text).toContain(
      'The colour of things.',
    );
  });
});

describe('a language option overrides the filename', () => {
  it.each`
    filename           | language        | source                              | expected
    ${'stdin'}         | ${'python'}     | ${'x = "gray" # the color'}         | ${'x = "gray" # the colour'}
    ${'notes.txt'}     | ${'python'}     | ${'x = "gray" # the color'}         | ${'x = "gray" # the colour'}
    ${'settings.json'} | ${'ruby'}       | ${'x = "gray" # the color'}         | ${'x = "gray" # the colour'}
    ${'stdin'}         | ${'shell'}      | ${'x="gray" # the color'}           | ${'x="gray" # the colour'}
    ${'stdin'}         | ${'golang'}     | ${'x := "gray" // the color'}       | ${'x := "gray" // the colour'}
    ${'stdin'}         | ${'typescript'} | ${'x = "gray"; // the color'}       | ${'x = "gray"; // the colour'}
    ${'stdin'}         | ${'Dockerfile'} | ${'ENV X=gray # the color'}         | ${'ENV X=gray # the colour'}
    ${'a.ts'}          | ${'md'}         | ${'x = "gray"; // the color'}       | ${'x = "grey"; // the colour'}
    ${'a.ts'}          | ${'MD'}         | ${'x = "gray"; // the color'}       | ${'x = "grey"; // the colour'}
    ${'a.ts'}          | ${'.txt'}       | ${'x = "gray"; // the color'}       | ${'x = "grey"; // the colour'}
    ${'stdin'}         | ${'ts'}         | ${'x = "gray"; // the color'}       | ${'x = "gray"; // the colour'}
    ${'stdin'}         | ${'.ts'}        | ${'x = "gray"; // the color'}       | ${'x = "gray"; // the colour'}
    ${'a.py'}          | ${'ts'}         | ${'x = "gray"; // the color'}       | ${'x = "gray"; // the colour'}
    ${'NOTES'}         | ${'md'}         | ${'The color.'}                     | ${'The colour.'}
  `('$filename with language $language reads "$source" as "$expected"', ({ filename, language, source, expected }) => {
    expect(deamericaniseFile(filename, source, { language }).text).toBe(expected);
  });

  it.each(['settings.json', 'stdin', 'a.ts', 'README.md'])(
    'throws for a language it does not know, whatever the filename (%s)',
    (filename) => {
      expect(() => deamericaniseFile(filename, 'The color.', { language: 'nosuchlang' })).toThrow(UnknownLanguageError);
    },
  );
});

describe('json reads only the comments', () => {
  it.each`
    source                                          | expected
    ${'{ "color": "gray" }'}                        | ${'{ "color": "gray" }'}
    ${'{ "url": "http://example.com/color" }'}      | ${'{ "url": "http://example.com/color" }'}
    ${'{ "color": "gray" } // the color'}           | ${'{ "color": "gray" } // the colour'}
    ${'{ /* the color */ "color": "gray" }'}        | ${'{ /* the colour */ "color": "gray" }'}
  `('$source -> $expected', ({ source, expected }) => {
    expect(deamericaniseFile('settings.json', source, { language: 'json' }).text).toBe(expected);
    expect(deamericaniseCode(source, { language: 'json' }).text).toBe(expected);
  });

  it('reads a .json file as prose when no language is given', () => {
    expect(deamericaniseFile('settings.json', '{ "color": "gray" }').text).toBe('{ "colour": "grey" }');
  });

  it('keeps jsonc and json5 on the same lexer', () => {
    expect(deamericaniseFile('tsconfig.jsonc', '{ "color": 1 } // the color').text).toBe('{ "color": 1 } // the colour');
    expect(deamericaniseFile('a.json5', "{ color: 'gray' } // the color").text).toBe("{ color: 'gray' } // the colour");
  });
});

describe('errors', () => {
  it('names the language it cannot handle', () => {
    expect(() => deamericaniseCode('// color', { language: 'brainfuck' })).toThrow(UnknownLanguageError);
  });
});

describe('change offsets point into the original file', () => {
  it('reports positions that slice back to the original text', () => {
    const source = 'const a = 1;\n// the color of the center\n';
    const result = deamericaniseCode(source, { language: 'ts' });
    expect(result.changes.length).toBe(2);
    for (const change of result.changes) {
      expect(source.slice(change.start, change.end)).toBe(change.before);
    }
  });

  it('points an article fix at its replacement in the same file', () => {
    const source = 'const a = 1;\n// Use an eraser.\n';
    const [article, word] = deamericaniseCode(source, { language: 'ts', preset: 'localise' }).changes;
    expect(source.slice(word!.start, word!.end)).toBe('eraser');
    expect(article?.agreesWith).toEqual({ start: word!.start, end: word!.end });
  });

  it('reports positions that slice back to the original text across joined comment lines', () => {
    const source = 'const a = 1;\n/**\n * The color\n *   of the center.\n */\n///  the color\n/// and the center\n// the gray\n';
    const result = deamericaniseCode(source, { language: 'rust' });
    expect(result.changes.map((c) => c.before)).toEqual(['color', 'center', 'color', 'center', 'gray']);
    for (const change of result.changes) {
      expect(source.slice(change.start, change.end)).toBe(change.before);
    }
  });

  it('points an article fix at a converted measurement in the same file', () => {
    const source = 'const a = 1;\n// Build an 8 foot fence.\n';
    const result = deamericaniseCode(source, { language: 'ts' });
    const [article, measurement] = result.changes;
    expect(result.text).toBe('const a = 1;\n// Build a 2.4 metre fence.\n');
    expect(source.slice(article!.start, article!.end)).toBe('an');
    expect(source.slice(measurement!.start, measurement!.end)).toBe('8 foot');
    expect(article?.agreesWith).toEqual({ start: measurement!.start, end: measurement!.end });
  });
});
