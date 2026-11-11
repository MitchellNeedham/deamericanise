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

describe('inline code, read the way CommonMark reads it', () => {
  it.each`
    unchanged                                                                           | why
    ${'A span on one line, `the color`, stays. A span that wraps, `the\ncolor`, should too.'} | ${'a span that wraps onto the next line'}
    ${'Set `6 feet` here and `six\nfeet` there.'}                                       | ${'a measurement the wrap splits'}
    ${'A span that wraps, `the\r\ncolor`, too.'}                                        | ${'a Windows line ending'}
    ${'- Use `the\n  color` here.'}                                                     | ${'a list item that wraps'}
    ${'Use ``a ` color`` here.'}                                                        | ${'two backticks around one'}
    ${'Use ``the\ncolor ` x`` here.'}                                                   | ${'the same, wrapped'}
    ${'Use ```a `` color``` here.'}                                                     | ${'three backticks around two'}
    ${'A path ends in \\\\`the color`.'}                                                | ${'an escaped backslash before a real backtick'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                                     | expected                                                   | why
    ${"It's a `stray backtick.\n\nThe color is red."}         | ${"It's a `stray backtick.\n\nThe colour is red."}         | ${'a backtick with no partner before the blank line'}
    ${"It's a `stray backtick.\n \t\nThe color is `red`."}    | ${"It's a `stray backtick.\n \t\nThe colour is `red`."}    | ${'a blank line holding only spaces'}
    ${'A `span\n\ncolor` broken by a blank line.'}            | ${'A `span\n\ncolour` broken by a blank line.'}            | ${'a span cannot cross a blank line'}
    ${'Unequal `color`` runs.'}                               | ${'Unequal `colour`` runs.'}                               | ${'a span closes only on a run of its own length'}
    ${'Type \\` for a backtick, then the color, then `x`.'}   | ${'Type \\` for a backtick, then the colour, then `x`.'}   | ${'an escaped backtick opens nothing'}
    ${'The color ` key.\n- Set `color` here.'}                | ${'The colour ` key.\n- Set `color` here.'}                | ${'a list item ends the paragraph'}
    ${'The color ` key.\n* Set `color` here.'}                | ${'The colour ` key.\n* Set `color` here.'}                | ${'so does a star bullet'}
    ${'The color ` key.\n1. Set `color` here.'}               | ${'The colour ` key.\n1. Set `color` here.'}               | ${'and a numbered item'}
    ${'The color ` key.\n> Set `color` here.'}                | ${'The colour ` key.\n> Set `color` here.'}                | ${'and a quote'}
    ${'The color ` key.\n## Set `color` here'}                | ${'The colour ` key.\n## Set `color` here'}                | ${'and a heading'}
    ${'The color ` key.\n***\nSet `color` here.'}             | ${'The colour ` key.\n***\nSet `color` here.'}             | ${'and a rule'}
    ${'The color ` key\n---\nSet `color` here.'}              | ${'The colour ` key\n---\nSet `color` here.'}              | ${'and a setext underline'}
    ${'## The ` key\nThe color is `red`.'}                    | ${'## The ` key\nThe colour is `red`.'}                    | ${'a heading is one line long'}
    ${'| Key | Note |\n| --- | --- |\n| ` | The color |\n| `color` | x |'} | ${'| Key | Note |\n| --- | --- |\n| ` | The colour |\n| `color` | x |'} | ${'so is a table row'}
    ${'```\nconst a = 1;\n```\nThe color is ```x```.'}       | ${'```\nconst a = 1;\n```\nThe colour is ```x```.'}       | ${'a closing fence opens nothing'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
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
