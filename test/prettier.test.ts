import { afterEach, describe, expect, it, vi } from 'vitest';
import * as prettier from 'prettier';
import { UnknownLanguageError } from '../src/code.js';
import plugin from '../src/plugins/prettier.js';

// Every wrapped language has a lexer, so a language without one, or an engine fault, is staged here.
const fault = vi.hoisted(() => ({ error: undefined as Error | undefined }));

vi.mock('../src/code.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/code.js')>();
  return {
    ...actual,
    deamericaniseCode: (...args: Parameters<typeof actual.deamericaniseCode>) => {
      if (fault.error) throw fault.error;
      return actual.deamericaniseCode(...args);
    },
  };
});

afterEach(() => {
  fault.error = undefined;
});

const format = (source: string, options: prettier.Options = {}) =>
  prettier.format(source, { plugins: [plugin as never], ...options });

describe('the Prettier plugin against real Prettier', () => {
  it.each`
    parser          | source                                             | expected
    ${'markdown'}   | ${'The color of the theater.\n'}                    | ${'The colour of the theatre.\n'}
    ${'typescript'} | ${'const color = "color"; // the color\n'}          | ${'const color = "color"; // the colour\n'}
    ${'yaml'}       | ${'# the color\na: 1\n'}                            | ${'# the colour\na: 1\n'}
  `('$parser rewrites what it should', async ({ parser, source, expected }) => {
    expect(await format(source as string, { parser: parser as string })).toBe(expected);
  });

  it('leaves code and strings alone, touching only the comment', async () => {
    const source = 'const color = "the color";\n';
    expect(await format(source, { parser: 'typescript' })).toBe(source);
  });

  it('leaves a tilde fence and a four-backtick fence alone in Markdown', async () => {
    const source = 'The color.\n\n~~~\nconst color = 1;\n~~~\n\n````md\n```\nconst color = 2;\n```\n````\n';
    expect(await format(source, { parser: 'markdown' })).toBe(
      'The colour.\n\n```\nconst color = 1;\n```\n\n````md\n```\nconst color = 2;\n```\n````\n',
    );
  });

  it.each`
    parser        | source                                                  | expected
    ${'markdown'} | ${'Set the theme:\n\n    theme.color = "gray";\n'}       | ${'Set the theme:\n\n    theme.color = "gray";\n'}
    ${'mdx'}      | ${'Set the theme:\n\n    theme.color = "gray";\n'}       | ${'Set the theme:\n\n    theme.color = "gray";\n'}
    ${'markdown'} | ${'1. Step one.\n\n   More about the color.\n'}         | ${'1. Step one.\n\n   More about the colour.\n'}
    ${'markdown'} | ${'The color.\n\n<pre>\nconst color = "gray";\n</pre>\n'} | ${'The colour.\n\n<pre>\nconst color = "gray";\n</pre>\n'}
  `('reads $parser as Markdown, so indented code and a pre block are left alone: $source', async ({ parser, source, expected }) => {
    expect(await format(source as string, { parser: parser as string })).toBe(expected);
  });

  it.each`
    option                       | value                          | source                | expected
    ${'deamericanisePreset'}     | ${'localise'}                             | ${'The sidewalk.\n'}  | ${'The footpath.\n'}
    ${'deamericanisePreset'}     | ${'read'}                                 | ${'The sidewalk.\n'}  | ${'The sidewalk.\n'}
    ${'deamericaniseConfidence'} | ${'safe,moderate'}                        | ${'A flat tire.\n'}   | ${'A flat tire.\n'}
    ${'deamericaniseOptions'}    | ${'{"dialect":"en-GB","preset":"localise"}'} | ${'The sidewalk.\n'} | ${'The pavement.\n'}
    ${'deamericaniseOptions'}    | ${'{"unitsKeep":["inches"]}'}             | ${'It is 6 inches wide.\n'} | ${'It is 6 inches wide.\n'}
  `('honours $option = $value', async ({ option, value, source, expected }) => {
    expect(await format(source as string, { parser: 'markdown', [option as string]: value })).toBe(expected);
  });

  it('rejects malformed JSON options with a useful message', async () => {
    await expect(
      format('The color.\n', { parser: 'markdown', deamericaniseOptions: 'not json' } as prettier.Options),
    ).rejects.toThrow(/must be a JSON object/);
  });

  it.each`
    parser          | source                                 | expected
    ${'markdown'}   | ${'The sidewalk.\n'}                   | ${'The pavement.\n'}
    ${'typescript'} | ${'const a = 1; // the sidewalk\n'}    | ${'const a = 1; // the pavement\n'}
    ${'yaml'}       | ${'# the sidewalk\na: 1\n'}            | ${'# the pavement\na: 1\n'}
  `('applies deamericaniseOptions to $parser', async ({ parser, source, expected }) => {
    const deamericaniseOptions = '{"dialect":"en-GB","preset":"localise"}';
    expect(await format(source as string, { parser: parser as string, deamericaniseOptions } as prettier.Options)).toBe(
      expected,
    );
  });

  it('rejects malformed JSON options in a code file too', async () => {
    const options = { parser: 'typescript', deamericaniseOptions: 'not json' } as prettier.Options;
    await expect(format('const a = 1; // the color\n', options)).rejects.toThrow(/must be a JSON object/);
  });

  describe('an option the library rejects fails the file with the library\'s message', () => {
    const DIALECT = 'Unknown dialect: en-XX. Expected one of en-AU, en-GB, en-NZ, en-IE, en-ZA, en-CA.';
    const PRESET = 'Unknown preset: Localise. Expected one of read, localise.';
    const UNIT = 'Unknown unit: furlong. Expected the key, name or abbreviation of one of inch,';

    it.each`
      parser          | source
      ${'markdown'}   | ${'The color.\n'}
      ${'markdown'}   | ${'```\ncolor\n```\n'}
      ${'typescript'} | ${'const a = 1; // the color\n'}
      ${'typescript'} | ${'const a = 1;\n'}
      ${'babel'}      | ${'const a = 1;\n'}
      ${'css'}        | ${'a { color: red; } /* the color */\n'}
      ${'yaml'}       | ${'# the color\na: 1\n'}
      ${'yaml'}       | ${'a: 1\n'}
      ${'html'}       | ${'<p>hi</p>\n'}
    `('in $parser: $source', async ({ parser, source }) => {
      const run = (deamericaniseOptions: string) =>
        format(source as string, { parser: parser as string, deamericaniseOptions } as prettier.Options);
      await expect(run('{"dialect":"en-XX"}')).rejects.toThrow(DIALECT);
      await expect(run('{"preset":"Localise"}')).rejects.toThrow(PRESET);
      await expect(run('{"dialect":"toString"}')).rejects.toThrow('Unknown dialect: toString.');
      await expect(run('{"unitsKeep":["furlong"]}')).rejects.toThrow(UNIT);
    });
  });

  it('leaves a file whose language has no lexer untouched', async () => {
    fault.error = new UnknownLanguageError('typescript');
    const source = 'const a = 1; // the color\n';
    expect(await format(source, { parser: 'typescript' })).toBe(source);
  });

  it('fails a code file on any other error from the engine', async () => {
    fault.error = new Error('engine fault');
    await expect(format('const a = 1; // the color\n', { parser: 'typescript' })).rejects.toThrow('engine fault');
  });

  it('declares a parser for every language it claims to cover', () => {
    expect(Object.keys(plugin.parsers)).toEqual(
      expect.arrayContaining(['markdown', 'typescript', 'babel', 'css', 'yaml', 'html', 'vue']),
    );
  });
});
