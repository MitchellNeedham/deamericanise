import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import plugin from '../src/plugins/prettier.js';

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

  it.each`
    option                       | value                          | source                | expected
    ${'deamericanisePreset'}     | ${'localise'}                             | ${'The sidewalk.\n'}  | ${'The footpath.\n'}
    ${'deamericanisePreset'}     | ${'read'}                                 | ${'The sidewalk.\n'}  | ${'The sidewalk.\n'}
    ${'deamericaniseConfidence'} | ${'safe,moderate'}                        | ${'A flat tire.\n'}   | ${'A flat tire.\n'}
    ${'deamericaniseOptions'}    | ${'{"dialect":"en-GB","preset":"localise"}'} | ${'The sidewalk.\n'} | ${'The pavement.\n'}
  `('honours $option = $value', async ({ option, value, source, expected }) => {
    expect(await format(source as string, { parser: 'markdown', [option as string]: value })).toBe(expected);
  });

  it('rejects malformed JSON options with a useful message', async () => {
    await expect(
      format('The color.\n', { parser: 'markdown', deamericaniseOptions: 'not json' } as prettier.Options),
    ).rejects.toThrow(/must be a JSON object/);
  });

  it('declares a parser for every language it claims to cover', () => {
    expect(Object.keys(plugin.parsers)).toEqual(
      expect.arrayContaining(['markdown', 'typescript', 'babel', 'css', 'yaml', 'html', 'vue']),
    );
  });
});
