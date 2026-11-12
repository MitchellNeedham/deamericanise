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
    ${'mail the-color+theater@favorite.org'}        | ${'an email address with a hyphen and a plus'}
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

describe('a long dotted, hyphenated or plus-joined token takes time in line with its length', () => {
  // Generous, since each of these takes a few milliseconds. A pattern that walks the token
  // from every word in it takes several seconds.
  const LIMIT_MS = 1000;

  it.each(['a.', 'a-', 'a+'])('a run of "%s"', (unit) => {
    const text = (n: number) => `${unit.repeat(n)} The color.`;
    au(text(1), { assumeAmerican: true });
    const started = performance.now();
    const output = au(text(50000), { assumeAmerican: true });
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
    expect(output.endsWith(' The colour.')).toBe(true);
  });
});

describe('file names and paths', () => {
  const american = { assumeAmerican: true };

  it.each`
    unchanged                                                    | why
    ${'Edit src/colors/center.ts to change it.'}                 | ${'a path of three segments'}
    ${'See docs/behavior.md and assets/gray.svg.'}               | ${'two segments ending in a file name'}
    ${'Rename Center.vue and behavior.ts.'}                      | ${'file names, whatever the extension'}
    ${'Copy color-picker.tsx and GRAY.PNG.'}                     | ${'a hyphen in the name, an extension in capitals'}
    ${'The theme lives in ./styles/color and ~/favorites/gray.'} | ${'paths from a root'}
    ${'Install to /usr/share/color and ../colors.'}              | ${'more roots'}
    ${'Open C:\\Users\\me\\Favorites\\color.txt first.'}         | ${'a drive letter and backslashes'}
    ${'Open D:/colors/gray first.'}                              | ${'a drive letter and slashes'}
    ${'Edit 01-colors.md and .eslintrc.color.json.'}             | ${'a name starting with a number or a dot'}
    ${'Import node_modules/@types/color/index.d.ts here.'}       | ${'a scoped package'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged, american)).toBe(unchanged);
  });

  it.each`
    input                                     | expected                                   | why
    ${'Pick a color/flavor.'}                 | ${'Pick a colour/flavour.'}                | ${'two words joined by a slash'}
    ${'colors and/or behaviors'}              | ${'colours and/or behaviours'}             | ${'and/or'}
    ${'Edit src/colors here.'}                | ${'Edit src/colours here.'}                | ${'a bare two-segment path reads the same'}
    ${'The color.It was gray.'}               | ${'The colour.It was grey.'}               | ${'a missing space after a full stop'}
    ${'It is 3.5 miles.'}                     | ${'It is 5.6 kilometres.'}                 | ${'a number has no letter in its name'}
    ${'It makes 300 lb.ft of torque.'}        | ${'It makes 410 N·m of torque.'}           | ${'a dotted unit after a number'}
    ${'It makes 300lb.ft of torque.'}         | ${'It makes 410 N·m of torque.'}           | ${'a dotted unit joined to its number'}
    ${'It is -5lb.ft or 1/2lb.ft.'}           | ${'It is -6.8 N·m or 0.68 N·m.'}           | ${'joined to a signed number or a fraction'}
    ${'Use a 25-lb.ft or 10-20lb.ft wrench.'} | ${'Use a 34 N·m or 14-27 N·m wrench.'}     | ${'joined by a hyphen, or to a range'}
    ${'It falls at 32 ft/s/s.'}               | ${'It falls at 9.8 m/s/s.'}                | ${'a unit of three segments after a number'}
    ${'Runs at 3p.m. daily.'}                 | ${'Runs at 3pm daily.'}                    | ${'a time joined to its number'}
    ${'It was 3/4/2024 then.'}                | ${'It was 2024-03-04 then.'}               | ${'a date has no letter'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input, american)).toBe(expected);
  });

  it('reads initialisms as initialisms, not file names', () => {
    const input = 'Two P.M.s met a Ph.D. from the U.S.A. at 3 P.M. on the Canada/U.S. border.';
    expect(au(input, { ...american, preset: 'localise' })).toBe(
      'Two PMs met a PhD from the USA at 3pm on the Canada/US border.',
    );
  });

  it('holds the whole path where identifiers are protected', () => {
    const input = 'Edit src/colors/center.ts and docs/behavior.md.';
    expect(au(input, { ...american, protectIdentifiers: true })).toBe(input);
  });
});

describe('fenced code, read the way CommonMark reads it', () => {
  it.each`
    input                                                                     | expected                                                                   | why
    ${'The color.\n\n~~~\nconst color = 1;\n~~~\n'}                           | ${'The colour.\n\n~~~\nconst color = 1;\n~~~\n'}                           | ${'a tilde fence'}
    ${'The color.\n\n````\n```\nconst color = 1;\n```\n````\n'}               | ${'The colour.\n\n````\n```\nconst color = 1;\n```\n````\n'}               | ${'four backticks around three'}
    ${'~~~~\n~~~\nconst color = 1;\n~~~\n~~~~\nThe color.'}                   | ${'~~~~\n~~~\nconst color = 1;\n~~~\n~~~~\nThe colour.'}                   | ${'four tildes around three'}
    ${'```js\nconst color = 1;\n```\nThe color.'}                             | ${'```js\nconst color = 1;\n```\nThe colour.'}                             | ${'an info string'}
    ${'The color:\n```\nconst color = 1;\n```\nThe color.'}                   | ${'The colour:\n```\nconst color = 1;\n```\nThe colour.'}                   | ${'a fence straight after a paragraph line'}
    ${'The color.\n\n```js\nconst color = 1;\n'}                              | ${'The colour.\n\n```js\nconst color = 1;\n'}                              | ${'a fence that never closes runs to the end'}
    ${'```\nconst color = 1;\n``` x\nconst color = 2;\n```\nThe color.'}      | ${'```\nconst color = 1;\n``` x\nconst color = 2;\n```\nThe colour.'}      | ${'a run with text after it does not close'}
    ${'```\nconst color = 1;\n~~~\nconst color = 2;\n```\nThe color.'}        | ${'```\nconst color = 1;\n~~~\nconst color = 2;\n```\nThe colour.'}        | ${'nor does the other character'}
    ${'````\nconst color = 1;\n```\nconst color = 2;\n````\nThe color.'}      | ${'````\nconst color = 1;\n```\nconst color = 2;\n````\nThe colour.'}      | ${'nor a shorter run'}
    ${'```\nconst color = 1;\n    ```\nconst color = 2;\n```\nThe color.'}    | ${'```\nconst color = 1;\n    ```\nconst color = 2;\n```\nThe colour.'}    | ${'nor a run four spaces further in'}
    ${'```md\n> ```\n> the color\n> ```\n```\nThe color.'}                   | ${'```md\n> ```\n> the color\n> ```\n```\nThe colour.'}                   | ${'nor a run behind a quote marker the fence lacks'}
    ${'~~~ a ``` ~~~\nconst color = 1;\n~~~\nThe color.'}                      | ${'~~~ a ``` ~~~\nconst color = 1;\n~~~\nThe colour.'}                      | ${'a tilde info string may hold backticks and tildes'}
    ${'> ```\n> const color = 1;\n> ```\n> The color.'}                       | ${'> ```\n> const color = 1;\n> ```\n> The colour.'}                       | ${'a fence in a quote'}
    ${'1. Step\n\n    ```sh\n    color=1\n    ```\n\nThe color.'}             | ${'1. Step\n\n    ```sh\n    color=1\n    ```\n\nThe colour.'}             | ${'a fence four spaces into a list item'}
    ${'10. Step\n\n       ~~~\n       color=1\n    ~~~\nThe color.'}           | ${'10. Step\n\n       ~~~\n       color=1\n    ~~~\nThe colour.'}           | ${'a closing line further out than the opening one'}
    ${'- ```js\n  const color = 1;\n  ```\n- The color.'}                      | ${'- ```js\n  const color = 1;\n  ```\n- The colour.'}                      | ${'a fence on the list marker line'}
    ${'```\r\nconst color = 1;\r\n```\r\nThe color.'}                         | ${'```\r\nconst color = 1;\r\n```\r\nThe colour.'}                         | ${'Windows line endings'}
    ${'Use ```the color``` here.'}                                            | ${'Use ```the color``` here.'}                                            | ${'three backticks inline stay a code span'}
    ${'```the color```\nThe color.'}                                          | ${'```the color```\nThe colour.'}                                          | ${'and open no fence at the start of a line'}
    ${'- The color\n    is red.'}                                             | ${'- The colour\n    is red.'}                                             | ${'an indented list continuation is prose'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
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
    ${"It's a `stray backtick.\r\n\r\nThe color is `red`."}   | ${"It's a `stray backtick.\r\n\r\nThe colour is `red`."}   | ${'a blank line with Windows line endings'}
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

describe('indented code in Markdown, read the way CommonMark reads it', () => {
  const md = (input: string) => au(input, { syntax: 'markdown' });

  it.each`
    input                                                              | expected                                                            | why
    ${'The color.\n\n    const color = 1;\n'}                          | ${'The colour.\n\n    const color = 1;\n'}                          | ${'a block after a blank line'}
    ${'The color.\n\n\tconst color = 1;'}                              | ${'The colour.\n\n\tconst color = 1;'}                              | ${'a tab is four columns'}
    ${'# Color\n    const color = 1;'}                                 | ${'# Colour\n    const color = 1;'}                                 | ${'a block straight after a heading'}
    ${'Color\n---\n    const color = 1;'}                              | ${'Colour\n---\n    const color = 1;'}                              | ${'or a setext heading'}
    ${'```\nx\n```\n    const color = 1;\nThe color.'}                 | ${'```\nx\n```\n    const color = 1;\nThe colour.'}                 | ${'or a fence, and the next line at the margin ends it'}
    ${'The color.\n\n    a = color;\n\n    b = color;\n\nThe color.'}  | ${'The colour.\n\n    a = color;\n\n    b = color;\n\nThe colour.'}  | ${'a blank line inside a block'}
    ${'> The color.\n>\n>     const color = 1;'}                       | ${'> The colour.\n>\n>     const color = 1;'}                       | ${'a block in a quote'}
    ${'1. The color.\n\n       const color = 1;'}                      | ${'1. The colour.\n\n       const color = 1;'}                      | ${'four columns past a list item'}
    ${'-     const color = 1;\n\n  The color.'}                        | ${'-     const color = 1;\n\n  The colour.'}                        | ${'five spaces after a list marker'}
    ${'- The color.\n\nThe color.\n\n    const color = 1;'}            | ${'- The colour.\n\nThe colour.\n\n    const color = 1;'}            | ${'after a list has ended'}
    ${'The color.\r\n\r\n    const color = 1;\r\nThe color.'}          | ${'The colour.\r\n\r\n    const color = 1;\r\nThe colour.'}          | ${'Windows line endings'}
  `('$why', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it.each`
    input                                                    | expected                                                  | why
    ${'- The color\n    is red.'}                            | ${'- The colour\n    is red.'}                            | ${'a list item that wraps'}
    ${'1.  Step one.\n\n    More about the color.'}          | ${'1.  Step one.\n\n    More about the colour.'}          | ${"a list item's second paragraph"}
    ${'- a\n  - The color.\n\n    More color.'}              | ${'- a\n  - The colour.\n\n    More colour.'}              | ${"a nested list item's second paragraph"}
    ${'The color\n    is red.'}                              | ${'The colour\n    is red.'}                              | ${'a paragraph that wraps, since indented code cannot interrupt one'}
    ${'> The color\n    is red.'}                            | ${'> The colour\n    is red.'}                            | ${'a lazy line of a quote'}
    ${'The color.\n\n~~~\nconst color = 1;\n~~~\n'}          | ${'The colour.\n\n~~~\nconst color = 1;\n~~~\n'}          | ${'a tilde fence'}
    ${'````\n```\nconst color = 1;\n```\n````\nThe color.'}  | ${'````\n```\nconst color = 1;\n```\n````\nThe colour.'}  | ${'a four-backtick fence holding a three-backtick one'}
    ${'The color.\n\n```js\nconst color = 1;\n'}            | ${'The colour.\n\n```js\nconst color = 1;\n'}            | ${'a fence that never closes'}
  `('reads $why as before', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it('rewrites indented code when the syntax is unknown or plain text, as before', () => {
    const input = 'The color.\n\n    const color = 1;\n';
    expect(au(input)).toBe('The colour.\n\n    const colour = 1;\n');
    expect(au(input, { syntax: 'text' })).toBe('The colour.\n\n    const colour = 1;\n');
  });

  it('reads no CommonMark fences in plain text, so a tilde heading underline is prose', () => {
    const rst = 'Colors\n~~~~~~\n\nThe color of things.\n\nBehavior\n~~~~~~~~\n';
    expect(au(rst, { syntax: 'text' })).toBe('Colours\n~~~~~~\n\nThe colour of things.\n\nBehaviour\n~~~~~~~~\n');
    expect(au('The color.\n\n```\nconst color = 1;\n```\n', { syntax: 'text' })).toBe(
      'The colour.\n\n```\nconst color = 1;\n```\n',
    );
  });

  it('names an unknown syntax rather than ignoring it', () => {
    expect(() => au('the color', { syntax: 'md' })).toThrow('Unknown syntax: md. Expected one of markdown, text.');
  });
});

describe('raw HTML blocks in Markdown, read the way CommonMark reads them', () => {
  const md = (input: string) => au(input, { syntax: 'markdown' });

  it.each`
    input                                                              | expected                                                            | why
    ${'The color.\n\n<pre>\nconst color = "gray";\n</pre>\n'}          | ${'The colour.\n\n<pre>\nconst color = "gray";\n</pre>\n'}          | ${'a pre block'}
    ${'<script>\nconst color = "gray";\n</script>\n\nThe color.'}      | ${'<script>\nconst color = "gray";\n</script>\n\nThe colour.'}      | ${'a script block'}
    ${'<style>\n.gray { color: gray; }\n</style>\n\nThe color.'}       | ${'<style>\n.gray { color: gray; }\n</style>\n\nThe colour.'}       | ${'a style block'}
    ${'<textarea>\nThe color\n</textarea>\n\nThe color.'}              | ${'<textarea>\nThe color\n</textarea>\n\nThe colour.'}              | ${'a textarea block'}
    ${'<PRE class="x">\nThe color\n</PRE>\nThe color.'}                | ${'<PRE class="x">\nThe color\n</PRE>\nThe colour.'}                | ${'a tag in capitals, with an attribute'}
    ${'<pre>\nThe color\n\nThe color\n</pre>\nThe color.'}             | ${'<pre>\nThe color\n\nThe color\n</pre>\nThe colour.'}             | ${'a blank line inside a block'}
    ${'The color.\n<pre>\nThe color\n</pre>\nThe color.'}              | ${'The colour.\n<pre>\nThe color\n</pre>\nThe colour.'}             | ${'a block straight after a paragraph line'}
    ${'<pre>The color</pre> The color.\nThe color.'}                   | ${'<pre>The color</pre> The color.\nThe colour.'}                   | ${'a block on one line, which runs to the end of that line'}
    ${'<pre>\nThe color\n</script>\nThe color.'}                       | ${'<pre>\nThe color\n</script>\nThe colour.'}                       | ${'any of the four closing tags ends a block'}
    ${'> <pre>\n> The color\n> </pre>\n\nThe color.'}                  | ${'> <pre>\n> The color\n> </pre>\n\nThe colour.'}                  | ${'a block in a quote'}
    ${'> <pre>\n> The color\nThe color.'}                              | ${'> <pre>\n> The color\nThe colour.'}                              | ${'a block that its quote ends'}
    ${'- <pre>\n  The color\n\nThe color.'}                            | ${'- <pre>\n  The color\n\nThe colour.'}                            | ${'a block that its list item ends'}
    ${'The color.\n\n<pre>\nThe color\n\nThe color'}                   | ${'The colour.\n\n<pre>\nThe color\n\nThe color'}                   | ${'a block that never closes runs to the end'}
    ${'<pre>\r\nThe color\r\n</pre>\r\nThe color.'}                    | ${'<pre>\r\nThe color\r\n</pre>\r\nThe colour.'}                    | ${'Windows line endings'}
  `('$why', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it.each`
    input                                                    | expected                                                  | why
    ${'<div align="center">\nThe color\n</div>'}             | ${'<div align="center">\nThe colour\n</div>'}             | ${'another kind of HTML block'}
    ${'<!--\nThe color\n-->\nThe color.'}                    | ${'<!--\nThe colour\n-->\nThe colour.'}                   | ${'an HTML comment'}
    ${'<prefix>\nThe color\n</prefix>'}                      | ${'<prefix>\nThe colour\n</prefix>'}                      | ${'a tag whose name only starts with pre'}
    ${'Use the <pre> tag for the color.'}                    | ${'Use the <pre> tag for the colour.'}                    | ${'a tag inside a sentence'}
    ${'The color <pre>\nThe color\n</pre>'}                  | ${'The colour <pre>\nThe colour\n</pre>'}                 | ${'a tag after text on its line'}
  `('reads $why as prose, as before', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it('rewrites the block when the syntax is unknown or plain text, as before', () => {
    const input = 'The color.\n\n<pre>\nThe color\n</pre>\n';
    expect(au(input)).toBe('The colour.\n\n<pre>\nThe colour\n</pre>\n');
    expect(au(input, { syntax: 'text' })).toBe('The colour.\n\n<pre>\nThe colour\n</pre>\n');
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
