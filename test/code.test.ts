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

describe('inline code inside a comment', () => {
  it.each`
    source                                                              | expected                                                             | why
    ${'/* Use `the\n   color` here. */'}                                | ${'/* Use `the\n   color` here. */'}                                 | ${'a span that wraps in a block comment'}
    ${"/**\n * It's a `stray backtick.\n *\n * The color is `red`.\n */"} | ${"/**\n * It's a `stray backtick.\n *\n * The colour is `red`.\n */"} | ${'a bare star line ends the paragraph'}
    ${"/**\n * Don't use a ` here.\n * Use `color` and `center`.\n */"}  | ${"/**\n * Don't use a ` here.\n * Use `color` and `center`.\n */"}   | ${'an unpaired backtick reaches no further than its line'}
  `('$why', ({ source, expected }) => {
    expect(rewrite('ts', source)).toBe(expected);
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
