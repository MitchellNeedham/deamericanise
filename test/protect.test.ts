import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

const au = (input: string, options = {}) => deamericaniseText(input, options);
const code = (input: string) => deamericaniseText(input, { protectIdentifiers: true });

describe('proper nouns keep their American spelling', () => {
  it.each`
    unchanged                                | why
    ${'Pearl Harbor'}                        | ${'a place name'}
    ${'the World Trade Center'}              | ${'a building'}
    ${'Rockefeller Center'}                  | ${'a building'}
    ${'the Department of Defense'}           | ${'an institution'}
    ${'the Center for Disease Control'}      | ${'an institution'}
    ${'the Australian Labor Party'}          | ${'spelled that way on purpose'}
    ${'a Labor MP'}                          | ${'same'}
    ${'rigor mortis'}                        | ${'a Latin phrase'}
    ${'Fahrenheit 451'}                      | ${'a title'}
    ${'the MIT License'}                     | ${'a licence with a name'}
    ${'SPDX-License-Identifier'}             | ${'a header'}
    ${'Prolog'}                              | ${'a language, not a prologue'}
    ${'a Band-Aid'}                          | ${'a trademark'}
    ${'Realtor'}                             | ${'a trademark'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it('still fixes the same words in ordinary prose', () => {
    expect(au('the harbor and the defense center')).toBe('the harbour and the defence centre');
  });

  it('can be told to stop protecting them', () => {
    expect(au('Pearl Harbor', { protectProperNouns: false })).toBe('Pearl Harbour');
  });
});

describe('structure that is never prose', () => {
  it.each`
    unchanged                                       | why
    ${'see https://example.com/color/center'}       | ${'a URL'}
    ${'mail color@favorite.org'}                    | ${'an email address'}
    ${'use `color` here'}                           | ${'inline code'}
    ${'<div class="color">'}                        | ${'markup'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it('leaves a fenced code block alone', () => {
    const input = '```\nconst color = 1;\n```\nthe color is red';
    expect(au(input)).toBe('```\nconst color = 1;\n```\nthe colour is red');
  });
});

describe('identifier protection, for comments in source files', () => {
  it.each`
    unchanged                    | why
    ${'normalizeInput'}          | ${'camelCase'}
    ${'MAX_COLOR_VALUE'}         | ${'CONSTANT_CASE'}
    ${'background-color'}        | ${'a CSS property'}
    ${'text-color-primary'}      | ${'a token with three parts'}
    ${'theme.colors.gray'}       | ${'a dotted path'}
    ${'--color-scheme'}          | ${'a flag or custom property'}
    ${'getColor()'}              | ${'a call'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(code(unchanged)).toBe(unchanged);
  });

  it('still fixes plain words in the same comment', () => {
    expect(code('set backgroundColor to the right color')).toBe('set backgroundColor to the right colour');
  });

  it('is off by default for prose', () => {
    expect(au('background-color')).toBe('background-colour');
  });
});

describe('user-supplied protection', () => {
  it.each`
    input                    | protect              | expected
    ${'our Color scheme'}    | ${['Color']}         | ${'our Color scheme'}
    ${'the color center'}    | ${['color']}         | ${'the color centre'}
    ${'Acme Defense Corp'}   | ${[/Acme [A-Z]\w+/]} | ${'Acme Defense Corp'}
  `('protect $protect keeps $input as $expected', ({ input, protect, expected }) => {
    expect(au(input, { protect })).toBe(expected);
  });
});

describe('inline ignore directives', () => {
  it('skips a line marked with deamericanise-ignore', () => {
    const input = 'the color is red\nthe color is blue // deamericanise-ignore';
    expect(au(input)).toBe('the colour is red\nthe color is blue // deamericanise-ignore');
  });

  it('skips a block between start and end markers', () => {
    const input = 'color one\ndeamericanise-ignore-start\ncolor two\ndeamericanise-ignore-end\ncolor three';
    const output = au(input);
    expect(output).toContain('colour one');
    expect(output).toContain('color two');
    expect(output).toContain('colour three');
  });
});

describe('institution names keep their spelling', () => {
  it.each`
    unchanged                        | why
    ${'the Storm Prediction Center'} | ${'a NOAA office, named that'}
    ${'the National Hurricane Center'} | ${'the same'}
    ${'the Johnson Space Center'}    | ${'the same'}
    ${'Rockefeller Center'}          | ${'on the explicit list'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                  | expected              | why
    ${'the data center'}   | ${'the data centre'}  | ${'one capitalised word is not a name'}
    ${'the center of town'} | ${'the centre of town'} | ${'a plain noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});
