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
});
