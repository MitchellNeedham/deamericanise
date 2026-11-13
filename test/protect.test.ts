import { describe, expect, it } from 'vitest';
import { deamericaniseCode, deamericaniseFile, deamericaniseText } from '../src/index.js';

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
    ${'See src/colors/gray.png here.'}                           | ${'a path ending in an image'}
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
    ${'It is 5 feet. The color.'}             | ${'It is 1.5 metres. The colour.'}         | ${'a sentence after a measurement'}
    ${'It makes 300 lb.ft of torque.'}        | ${'It makes 410 N·m of torque.'}           | ${'a dotted unit after a number'}
    ${'It makes 300lb.ft of torque.'}         | ${'It makes 410 N·m of torque.'}           | ${'a dotted unit joined to its number'}
    ${'It is -5lb.ft or 1/2lb.ft.'}           | ${'It is -6.8 N·m or 0.68 N·m.'}           | ${'joined to a signed number or a fraction'}
    ${'Use a 25-lb.ft or 10-20lb.ft wrench.'} | ${'Use a 34 N·m or 14-27 N·m wrench.'}     | ${'joined by a hyphen, or to a range'}
    ${'It falls at 32 ft/s/s.'}               | ${'It falls at 9.8 m/s/s.'}                | ${'a unit of three segments after a number'}
    ${'Cook it at 225°F/low/slow.'}           | ${'Cook it at 105°C/low/slow.'}            | ${'a unit after a number and a degree sign'}
    ${'Cook it at 225 º F/low/slow.'}         | ${'Cook it at 105°C/low/slow.'}            | ${'spaced, with another degree sign'}
    ${'Runs at 3p.m. daily.'}                 | ${'Runs at 3pm daily.'}                    | ${'a time joined to its number'}
    ${'It was 3/4/2024 then.'}                | ${'It was 2024-03-04 then.'}               | ${'a date has no letter'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input, american)).toBe(expected);
  });

  it.each`
    input                                    | expected                                  | why
    ${'I like the *color*/flavor of it.'}    | ${'I like the *colour*/flavour of it.'}   | ${'after closing emphasis'}
    ${'It is in *bold*/color text.'}         | ${'It is in *bold*/colour text.'}         | ${'the same'}
    ${'I like the (color)/flavor of it.'}    | ${'I like the (colour)/flavour of it.'}   | ${'after a closing bracket'}
    ${'I like the [color]/flavor of it.'}    | ${'I like the [colour]/flavour of it.'}   | ${'the same'}
    ${'I like the "color"/flavor of it.'}    | ${'I like the "colour"/flavour of it.'}   | ${'after a closing straight quote'}
    ${'I like the ‘color’/flavor of it.'}    | ${'I like the ‘colour’/flavour of it.'}   | ${'after a closing curly quote'}
    ${'See /etc/colors for the colors.'}     | ${'See /etc/colors for the colours.'}     | ${'a root after a space'}
    ${'See (/etc/colors) for the colors.'}   | ${'See (/etc/colors) for the colours.'}   | ${'a root after an opening bracket'}
    ${'See "/etc/colors" for the colors.'}   | ${'See "/etc/colors" for the colours.'}   | ${'a root after an opening quote'}
    ${'See */etc/colors* for the colors.'}   | ${'See */etc/colors* for the colours.'}   | ${'a root after opening emphasis'}
  `('a slash roots a path only where a token starts: $input -> $expected ($why)', ({ input, expected }) => {
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

describe('long command-line flags', () => {
  it.each`
    unchanged                                                  | why
    ${'Pass --center to the tool.'}                            | ${'a flag'}
    ${'Run it with --color=gray and --no-color.'}              | ${'a flag with a value, and one at the end of a sentence'}
    ${'Use the --favorite-color flag.'}                        | ${'a flag of two words'}
    ${'Pass --label="dark gray" or --label=\'light gray\' here.'} | ${'a quoted value with a space in it'}
    ${'Pass (--center) or "--center" to it.'}                  | ${'a flag in brackets or quotes'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected                                        | why
    ${'The color--that is, the hue--was gray.'}    | ${'The colour--that is, the hue--was grey.'}    | ${'two hyphens straight after a word are a dash'}
    ${'The color -- gray -- was fine.'}            | ${'The colour -- grey -- was fine.'}            | ${'two hyphens with a space after them'}
    ${'The color---gray---was fine.'}              | ${'The colour---grey---was fine.'}              | ${'three hyphens'}
    ${'Pass `--center` to the tool.'}              | ${'Pass `--center` to the tool.'}               | ${'a flag in a code span, held as before'}
    ${'- The color is gray.'}                      | ${'- The colour is grey.'}                      | ${'a list marker'}
    ${'A well-known color.'}                       | ${'A well-known colour.'}                       | ${'a hyphenated word'}
    ${'Use -color for the color.'}                 | ${'Use -colour for the colour.'}                | ${'one hyphen, which in prose is seldom a flag'}
    ${'<!--color and gray-->'}                     | ${'<!--colour and grey-->'}                     | ${'an HTML comment opened straight onto a word'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it('holds a flag in a Markdown file and a plain text file', () => {
    expect(deamericaniseFile('README.md', 'Pass --center to the tool.\n').text).toBe('Pass --center to the tool.\n');
    expect(deamericaniseFile('notes.txt', 'Use --color=gray here.\n').text).toBe('Use --color=gray here.\n');
  });

  it('still holds one-hyphen flags in a source comment', () => {
    const source = '// Set --color-scheme or -color for the color.';
    expect(deamericaniseCode(source, { language: 'ts' }).text).toBe('// Set --color-scheme or -color for the colour.');
  });
});

describe('a CSS declaration in a sentence', () => {
  it.each`
    unchanged                                              | why
    ${'Set text-align: center and color: red on the div.'} | ${'a bare name after a hyphenated one'}
    ${'Add background-color: gray; to the body rule.'}     | ${'a hyphenated name, then a semicolon'}
    ${'text-align: center;'}                               | ${'a declaration on its own'}
    ${'Use color: gray and text-align: center on it.'}     | ${'a bare name before a hyphenated one'}
    ${'Set color: gray, background: white on it.'}         | ${'two bare names together'}
    ${'Use { color: gray } for it.'}                       | ${'a bare name in braces'}
    ${'color: gray;'}                                      | ${'a semicolon that ends the line'}
    ${'Use color: #ccc on it.'}                            | ${'a hex colour'}
    ${'Use filter: grayscale(1) on it.'}                   | ${'a call'}
    ${'Set accent-color: gray !important on it.'}          | ${'an important value'}
    ${'Set -webkit-text-fill-color: gray on it.'}          | ${'a vendor prefix'}
    ${'Set --brand-color: gray on it.'}                    | ${'a custom property'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                                        | expected                                                     | why
    ${'Set justify-content: center to center the color swatch.'} | ${'Set justify-content: center to centre the colour swatch.'} | ${'the value ends at a function word'}
    ${'Set text-align: center for the favorite layout.'}         | ${'Set text-align: center for the favourite layout.'}        | ${'the same'}
    ${'Use color: #ccc for the gray text.'}                      | ${'Use color: #ccc for the grey text.'}                      | ${'the same, after a hex colour'}
    ${'the color of the sky'}                                    | ${'the colour of the sky'}                                   | ${'no colon'}
    ${'configure center alignment in CSS'}                       | ${'configure centre alignment in CSS'}                       | ${'no colon'}
    ${'Note: color matters.'}                                    | ${'Note: colour matters.'}                                   | ${'Note is no CSS property'}
    ${'Favorite color: gray.'}                                   | ${'Favourite colour: grey.'}                                 | ${'a bare name alone is a key in prose'}
    ${'Eye color: blue; hair color: gray.'}                      | ${'Eye colour: blue; hair colour: grey.'}                    | ${'a semicolon inside a sentence'}
    ${'One follow-up: color the gray boxes.'}                    | ${'One follow-up: colour the grey boxes.'}                   | ${'a hyphenated word that names no CSS property'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('a CSS property or function named in a sentence', () => {
  it.each`
    unchanged                                         | why
    ${'Set the background-color to match.'}           | ${'a property from a family'}
    ${'Use the accent-color property.'}               | ${'the same'}
    ${'Set the border-top-color to match.'}           | ${'a property of three words'}
    ${'Set the outline-color to match.'}              | ${'a family that is also a bare property'}
    ${'Set the print-color-adjust to exact.'}         | ${'a word after the colour'}
    ${'Set the -webkit-text-fill-color to match.'}    | ${'a vendor prefix'}
    ${'Set the color-scheme to dark.'}                | ${'a property in the colour family'}
    ${'Set the scroll-behavior to smooth.'}           | ${'a property that ends in behavior'}
    ${'Apply grayscale(100%) to the image.'}          | ${'a function and its argument'}
    ${'Mix them with color-mix() here.'}              | ${'a function with no arguments'}
    ${'Use color-mix(in srgb, gray, white) here.'}    | ${'a colour keyword inside a function'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                     | expected                                   | why
    ${'A color-coded chart.'}                 | ${'A colour-coded chart.'}                 | ${'a compound in the colour family that names no property'}
    ${'A color-blind reader.'}                | ${'A colour-blind reader.'}                | ${'the same'}
    ${'A white-colored shirt.'}               | ${'A white-coloured shirt.'}               | ${'a family before a longer word'}
    ${'The gray-blue sky.'}                   | ${'The grey-blue sky.'}                    | ${'no family'}
    ${'Track user-behavior data.'}            | ${'Track user-behaviour data.'}            | ${'behavior after a family that takes no such property'}
    ${'Set the background color to match.'}   | ${'Set the background colour to match.'}   | ${'two words'}
    ${'Pick a color(s) for it.'}              | ${'Pick a colour(s) for it.'}              | ${'a plural in brackets'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('template tags and emoji shortcodes', () => {
  it.each`
    unchanged                                    | why
    ${'{% include picker theme="gray" %}'}       | ${'a Liquid tag and its arguments'}
    ${'{{ favorite | upcase }} and {{ color }}'} | ${'Liquid or Jinja output'}
    ${'{# the color is gray #}'}                 | ${'a Jinja comment'}
    ${':colorful: and :heart:'}                  | ${'emoji shortcodes'}
    ${'It is (:+1::gray_heart:) now.'}           | ${'a run of shortcodes in brackets'}
    ${'Ratio 1:2:3'}                             | ${'a ratio'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                         | expected                                       | why
    ${'{% if favorite %}The color.{% endif %}'}   | ${'{% if favorite %}The colour.{% endif %}'}   | ${'the text between tags is prose'}
    ${'{% if x %}The color.{% endif %}'}          | ${'{% if x %}The colour.{% endif %}'}          | ${'the same'}
    ${'{%- if favorite -%}gray{%- endif -%}'}     | ${'{%- if favorite -%}grey{%- endif -%}'}      | ${'the same, with whitespace control'}
    ${'{% if favorite and the color is gray'}     | ${'{% if favourite and the colour is grey'}    | ${'a tag that never closes is prose'}
    ${'Note: the color is gray.'}                 | ${'Note: the colour is grey.'}                 | ${'a colon with a space after it'}
    ${'std::color::gray'}                         | ${'std::color::gray'}                          | ${'a colon either side is a scope, held as one'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it('holds them in a Markdown file', () => {
    const input = '{% if favorite %}The color.{% endif %}\n\n{{ favorite | upcase }} and {{ color }}\n\n:colorful: and :heart:\n';
    expect(deamericaniseFile('page.md', input).text).toBe(
      '{% if favorite %}The colour.{% endif %}\n\n{{ favorite | upcase }} and {{ color }}\n\n:colorful: and :heart:\n',
    );
  });
});

describe('scope paths joined by ::', () => {
  it.each`
    unchanged                               | why
    ${'Use std::color::gray in the code.'}  | ${'a Rust or C++ path'}
    ${'Call Color::Gray here.'}             | ${'a Ruby or PHP constant'}
    ${'Use ::color here.'}                  | ${'a leading ::'}
    ${'Use Theme::$color here.'}            | ${'a PHP static property'}
    ${'Use obj.color.gray here.'}           | ${'a dotted name, held as before'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it('holds the path where identifiers are protected', () => {
    expect(code('Use std::color::gray in the code.')).toBe('Use std::color::gray in the code.');
  });

  it.each`
    input                               | expected                             | why
    ${'The color: gray.'}               | ${'The colour: grey.'}               | ${'one colon'}
    ${'Favorite color:: gray'}          | ${'Favourite colour:: grey'}         | ${'a labelled list, with a space after the ::'}
    ${'Mix the color 3::2 with gray.'}  | ${'Mix the colour 3::2 with grey.'}  | ${'figures'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('mentions and hashtags', () => {
  it.each`
    unchanged                                  | why
    ${'cc @favorite-color'}                    | ${'a handle with a hyphen'}
    ${'Tag it #color today.'}                  | ${'a hashtag'}
    ${'Ask (@gray) or "#favorite" about it.'}  | ${'after a bracket or a quote'}
    ${'Email jo@color.com today.'}             | ${'an email address, held as before'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                | expected                              | why
    ${'Thanks @gray for the color fix.'} | ${'Thanks @gray for the colour fix.'} | ${'the words beside a mention'}
    ${'Meet @ the color store.'}         | ${'Meet @ the colour store.'}         | ${'a lone @'}
    ${'Drive @60mph there.'}             | ${'Drive @97 km/h there.'}            | ${'an @ before a number means at'}
    ${'Item #3 is gray.'}                | ${'Item #3 is grey.'}                 | ${'a number'}
    ${'# of items is gray'}              | ${'# of items is grey'}               | ${'a lone #'}
    ${'Use C# for the color.'}           | ${'Use C# for the colour.'}           | ${'a # straight after a word'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it('still rewrites a Markdown heading', () => {
    expect(au('# Color', { syntax: 'markdown' })).toBe('# Colour');
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

describe('a pre, script, style or textarea element inside another HTML block in Markdown', () => {
  const md = (input: string) => au(input, { syntax: 'markdown' });

  it.each`
    input                                                                         | expected                                                                       | why
    ${'<div align="center">\n<pre>\nconst color = "gray";\n</pre>\n</div>\n'}    | ${'<div align="center">\n<pre>\nconst color = "gray";\n</pre>\n</div>\n'}     | ${'a pre in a div'}
    ${'<details>\n<summary>The color</summary>\n<pre>\nThe color\n</pre>\n</details>\n'} | ${'<details>\n<summary>The colour</summary>\n<pre>\nThe color\n</pre>\n</details>\n'} | ${'a pre in details, after a summary that is prose'}
    ${'<div>\n<script>\nThe color\n</script>\n</div>'}                            | ${'<div>\n<script>\nThe color\n</script>\n</div>'}                             | ${'a script'}
    ${'<div>\n<style>\nThe color\n</style>\n</div>'}                              | ${'<div>\n<style>\nThe color\n</style>\n</div>'}                               | ${'a style'}
    ${'<div>\n<textarea>\nThe color\n</textarea>\n</div>'}                        | ${'<div>\n<textarea>\nThe color\n</textarea>\n</div>'}                         | ${'a textarea'}
    ${'<span>\n<pre>\nThe color\n</pre>\n</span>'}                                | ${'<span>\n<pre>\nThe color\n</pre>\n</span>'}                                 | ${'a block opened by any tag alone on its line'}
    ${'<DIV>\n<PRE class="x">\nThe color\n</PRE >\n</DIV>'}                       | ${'<DIV>\n<PRE class="x">\nThe color\n</PRE >\n</DIV>'}                        | ${'tags in capitals, with an attribute and a space'}
    ${'<div><pre>The color</pre> The color</div>\nThe color'}                     | ${'<div><pre>The color</pre> The colour</div>\nThe colour'}                    | ${'an element in the middle of a line, and the text after it'}
    ${'<div>\n<pre>\nThe color\n</pre>\nThe color\n</div>'}                       | ${'<div>\n<pre>\nThe color\n</pre>\nThe colour\n</div>'}                       | ${'a line after the closing tag'}
    ${'<div>\n<pre>\nThe color\n</script>\nThe color\n</pre>\nThe color'}         | ${'<div>\n<pre>\nThe color\n</script>\nThe color\n</pre>\nThe colour'}         | ${'only a closing tag of the same name ends one'}
    ${'<div>\n<pre>\nThe color\n\nThe color.'}                                    | ${'<div>\n<pre>\nThe color\n\nThe colour.'}                                    | ${'an element that never closes runs to the end of the block'}
    ${'<div>\n<pre>A</pre>\nThe color\n<pre>The color</pre>\n</div>'}             | ${'<div>\n<pre>A</pre>\nThe colour\n<pre>The color</pre>\n</div>'}             | ${'two elements in one block'}
    ${'> <div>\n> <pre>\n> The color\n> </pre>\n> </div>\n\nThe color.'}          | ${'> <div>\n> <pre>\n> The color\n> </pre>\n> </div>\n\nThe colour.'}          | ${'a block in a quote'}
    ${'<div>\r\n<pre>\r\nThe color\r\n</pre>\r\n</div>\r\nThe color'}             | ${'<div>\r\n<pre>\r\nThe color\r\n</pre>\r\n</div>\r\nThe colour'}             | ${'Windows line endings'}
  `('$why', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it.each`
    input                                                    | expected                                                  | why
    ${'<div align="center">\nThe color\n</div>'}             | ${'<div align="center">\nThe colour\n</div>'}             | ${'a div holding text'}
    ${'<details>\n<summary>The color</summary>'}             | ${'<details>\n<summary>The colour</summary>'}             | ${'a summary'}
    ${'<div>\n<!-- <pre> -->\nThe color\n</div>'}            | ${'<div>\n<!-- <pre> -->\nThe colour\n</div>'}            | ${'a tag inside an HTML comment'}
    ${'<div>\n<prefix>\nThe color\n</div>'}                  | ${'<div>\n<prefix>\nThe colour\n</div>'}                  | ${'a tag whose name only starts with pre'}
    ${'Use the <pre> tag for the color.'}                    | ${'Use the <pre> tag for the colour.'}                    | ${'a tag inside a sentence, which opens no HTML block'}
  `('reads $why as prose', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it('rewrites the element when the syntax is unknown or plain text, as before', () => {
    const input = '<div>\n<pre>\nThe color\n</pre>\n</div>\n';
    expect(au(input)).toBe('<div>\n<pre>\nThe colour\n</pre>\n</div>\n');
    expect(au(input, { syntax: 'text' })).toBe('<div>\n<pre>\nThe colour\n</pre>\n</div>\n');
  });
});

describe('front matter at the start of Markdown', () => {
  const md = (input: string, options = {}) => au(input, { syntax: 'markdown', ...options });

  it.each`
    input                                                                                         | expected                                                                                       | why
    ${'---\nlayout: color-page\nslug: favorite-colors\ntags: [color, behavior]\ntitle: The color guide\n---\n\nThe color.\n'} | ${'---\nlayout: color-page\nslug: favorite-colors\ntags: [color, behavior]\ntitle: The colour guide\n---\n\nThe colour.\n'} | ${'YAML, with a title that is prose'}
    ${'+++\nlayout = "color-page"\nslug = "favorite-colors"\ntitle = "The color guide"\n+++\n\nThe color.\n'} | ${'+++\nlayout = "color-page"\nslug = "favorite-colors"\ntitle = "The colour guide"\n+++\n\nThe colour.\n'} | ${'TOML'}
    ${'---\nimage:\n  alt: A gray cat\n  name: gray-cat\n---\n'}                                    | ${'---\nimage:\n  alt: A grey cat\n  name: gray-cat\n---\n'}                                    | ${'a nested prose key'}
    ${'---\nitems:\n  - title: The gray cat\n    slug: gray-cat\n---\n'}                            | ${'---\nitems:\n  - title: The grey cat\n    slug: gray-cat\n---\n'}                            | ${'a prose key in a list item'}
    ${'---\nTitle: The gray cat\nSummary: A gray cat\n---\n'}                                     | ${'---\nTitle: The grey cat\nSummary: A grey cat\n---\n'}                                     | ${'keys in any case'}
    ${'---\ntitle: "Gray" # the color\n---\n'}                                                     | ${'---\ntitle: "Grey" # the color\n---\n'}                                                     | ${'a quoted value and a comment after it'}
    ${"---\ntitle: 'It''s gray'\n---\n"}                                                           | ${"---\ntitle: 'It''s grey'\n---\n"}                                                           | ${'a single-quoted value'}
    ${'---\ntitle: The gray cat # the color\n---\n'}                                               | ${'---\ntitle: The grey cat # the color\n---\n'}                                               | ${'a plain value and a comment after it'}
    ${'---\ndescription: >\n  The gray cat\nsubtitle: [gray]\ncaption: |\n  The gray cat\n---\n'}  | ${'---\ndescription: >\n  The gray cat\nsubtitle: [gray]\ncaption: |\n  The gray cat\n---\n'}  | ${'a block or list as the value of a prose key'}
    ${'+++\ndescription = """\nThe gray cat\n"""\nexcerpt = \'Gray\'\n[params]\nsummary = "Gray" # c\nslug = "gray"\n+++\n'} | ${'+++\ndescription = """\nThe gray cat\n"""\nexcerpt = \'Grey\'\n[params]\nsummary = "Grey" # c\nslug = "gray"\n+++\n'} | ${'a TOML string over several lines, and keys in a table'}
    ${'---\r\nlayout: color-page\r\ntitle: The color guide\r\n---\r\n\r\nThe color.\r\n'}          | ${'---\r\nlayout: color-page\r\ntitle: The colour guide\r\n---\r\n\r\nThe colour.\r\n'}         | ${'Windows line endings'}
    ${'\uFEFF---\nlayout: color-page\n---\nThe color.\n'}                                         | ${'\uFEFF---\nlayout: color-page\n---\nThe colour.\n'}                                        | ${'a byte order mark before it'}
    ${'---  \nlayout: color-page\n---\t\nThe color.\n'}                                           | ${'---  \nlayout: color-page\n---\t\nThe colour.\n'}                                          | ${'spaces after the fences'}
    ${'---\nlayout: color-page\nnote: |\n  ~~~\n---\n\nThe color.\n'}                              | ${'---\nlayout: color-page\nnote: |\n  ~~~\n---\n\nThe colour.\n'}                              | ${'a fence inside it opens no block'}
    ${'---\nlayout: color-page\n---\n\nThe color.\n\n---\n\nThe gray cat.\n'}                    | ${'---\nlayout: color-page\n---\n\nThe colour.\n\n---\n\nThe grey cat.\n'}                    | ${'a thematic break after it'}
  `('$why', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });

  it('keeps the quotes of a prose value where they are', () => {
    expect(md('---\ntitle: "The color guide."\n---\n', { preset: 'localise' })).toBe(
      '---\ntitle: "The colour guide."\n---\n',
    );
  });

  it.each`
    input                                                   | expected                                                 | why
    ${'The color.\n\n---\n\nThe gray cat.\n'}               | ${'The colour.\n\n---\n\nThe grey cat.\n'}               | ${'a thematic break with no front matter'}
    ${'The color.\n---\nlayout: color-page\n---\n'}         | ${'The colour.\n---\nlayout: colour-page\n---\n'}        | ${'fences that do not open the text'}
    ${'---\nlayout: color-page\n\nThe color.\n'}            | ${'---\nlayout: colour-page\n\nThe colour.\n'}           | ${'an opening fence that nothing closes'}
    ${'----\nlayout: color-page\n----\nThe color.\n'}       | ${'----\nlayout: colour-page\n----\nThe colour.\n'}      | ${'four hyphens'}
    ${'---\nlayout: color-page\n+++\nThe color.\n'}         | ${'---\nlayout: colour-page\n+++\nThe colour.\n'}        | ${'fences that differ'}
  `('reads $why as prose', ({ input, expected }) => {
    expect(md(input)).toBe(expected);
  });
});

describe('TeX commands', () => {
  it.each`
    input                                                    | expected                                                  | why
    ${'Use \\centering and \\color{red} here.'}              | ${'Use \\centering and \\color{red} here.'}               | ${'a command and a colour'}
    ${'Use \\textcolor{gray}{gray word} here.'}              | ${'Use \\textcolor{gray}{grey word} here.'}               | ${'a colour, and the text it colours'}
    ${'Use \\textcolor[gray]{0.5}{gray word} here.'}         | ${'Use \\textcolor[gray]{0.5}{grey word} here.'}          | ${'a colour model in brackets'}
    ${'Use \\colorbox{gray}{gray word} here.'}               | ${'Use \\colorbox{gray}{grey word} here.'}                | ${'a box'}
    ${'Use \\fcolorbox{gray}{gray}{gray word} here.'}        | ${'Use \\fcolorbox{gray}{gray}{grey word} here.'}         | ${'a framed box'}
    ${'Use \\definecolor{shade}{gray}{0.9} for gray.'}       | ${'Use \\definecolor{shade}{gray}{0.9} for grey.'}        | ${'a colour definition'}
    ${'Use \\colorlet{shade}{gray} for gray.'}               | ${'Use \\colorlet{shade}{gray} for grey.'}                | ${'a colour from another'}
    ${'Use \\pagecolor{gray} and \\rowcolor{gray} for gray.'} | ${'Use \\pagecolor{gray} and \\rowcolor{gray} for grey.'} | ${'a page and a table row'}
    ${'Use \\begin{center} the color \\end{center} here.'}   | ${'Use \\begin{center} the colour \\end{center} here.'}   | ${'an environment'}
    ${'Use \\colorful gray here.'}                           | ${'Use \\colorful grey here.'}                            | ${'a longer command that only starts with one of those'}
    ${'The color is gray.'}                                  | ${'The colour is grey.'}                                  | ${'prose with no command'}
    ${'C:\\Users\\color\\gray.txt'}                          | ${'C:\\Users\\color\\gray.txt'}                           | ${'a path'}
  `('$why: $input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('TeX names that TeX looks up', () => {
  it.each`
    input                                                   | expected                                                 | why
    ${'\\usepackage{color}'}                                | ${'\\usepackage{color}'}                                 | ${'a package'}
    ${'\\usepackage[usenames]{color}'}                      | ${'\\usepackage[usenames]{color}'}                       | ${'a package with options'}
    ${'\\RequirePackage{color}'}                            | ${'\\RequirePackage{color}'}                             | ${'a package a package loads'}
    ${'Use \\documentclass{color} for gray.'}               | ${'Use \\documentclass{color} for grey.'}                | ${'a class'}
    ${'Use \\LoadClass{color} for gray.'}                   | ${'Use \\LoadClass{color} for grey.'}                    | ${'a class a class loads'}
    ${'Use \\input{color} and \\include{gray} here.'}       | ${'Use \\input{color} and \\include{gray} here.'}        | ${'files'}
    ${'Use \\bibliographystyle{color} for gray.'}           | ${'Use \\bibliographystyle{color} for grey.'}            | ${'a bibliography style'}
    ${'See \\label{fig:color} and \\ref{fig:color} here.'}  | ${'See \\label{fig:color} and \\ref{fig:color} here.'}   | ${'a label and a reference to it'}
    ${'See \\eqref{eq:gray} and \\pageref{fig:color}.'}     | ${'See \\eqref{eq:gray} and \\pageref{fig:color}.'}      | ${'more references'}
    ${'See \\autoref{fig:color} and \\cref{fig:gray}.'}     | ${'See \\autoref{fig:color} and \\cref{fig:gray}.'}      | ${'more references'}
    ${'See \\Cref{fig:color} and \\nameref{sec:gray}.'}     | ${'See \\Cref{fig:color} and \\nameref{sec:gray}.'}      | ${'references from other packages'}
    ${'See \\vref{fig:color} and \\cpageref{fig:gray}.'}    | ${'See \\vref{fig:color} and \\cpageref{fig:gray}.'}     | ${'the same'}
    ${'See \\crefrange{fig:color}{fig:gray} here.'}         | ${'See \\crefrange{fig:color}{fig:gray} here.'}          | ${'a range of two keys'}
    ${'See \\ref*{fig:color} here.'}                        | ${'See \\ref*{fig:color} here.'}                         | ${'a starred reference'}
    ${'See \\cite{color} on the gray.'}                     | ${'See \\cite{color} on the grey.'}                      | ${'a citation key'}
    ${'Use \\inputenc{gray} here.'}                         | ${'Use \\inputenc{grey} here.'}                          | ${'a longer command that only starts with one of those'}
    ${'Use \\textcolor{gray}{gray word} here.'}             | ${'Use \\textcolor{gray}{grey word} here.'}              | ${'the text a colour command colours'}
    ${'\\section{The color}'}                               | ${'\\section{The colour}'}                               | ${'a heading'}
    ${'\\section*{The color}'}                              | ${'\\section*{The colour}'}                              | ${'a starred heading'}
    ${'The color is gray.'}                                 | ${'The colour is grey.'}                                 | ${'prose with no command'}
  `('$why: $input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('TeX maths in Markdown', () => {
  const md = (input: string, options = {}) => au(input, { syntax: 'markdown', ...options });
  const american = { assumeAmerican: true };

  it.each`
    input                                                  | options     | expected                                                | why
    ${'Inline math $\\color{red}{x}$ here.'}               | ${{}}       | ${'Inline maths $\\color{red}{x}$ here.'}               | ${'inline maths'}
    ${'$$\n\\color{gray} x^2\n$$'}                         | ${{}}       | ${'$$\n\\color{gray} x^2\n$$'}                          | ${'display maths'}
    ${'The $$gray$$ cat is gray.'}                         | ${{}}       | ${'The $$gray$$ cat is grey.'}                          | ${'display maths inside a sentence'}
    ${'The $gray$ cat is gray.'}                           | ${{}}       | ${'The $gray$ cat is grey.'}                            | ${'a word inside maths'}
    ${'The $gray\ncat$ is gray.'}                          | ${{}}       | ${'The $gray\ncat$ is grey.'}                           | ${'maths over a line break'}
    ${'The cost is $2^n$ for each color.'}                 | ${american} | ${'The cost is $2^n$ for each colour.'}                 | ${'a figure after the opening $'}
    ${'Let $5x + 3 = 8$ hold.'}                            | ${american} | ${'Let $5x + 3 = 8$ hold.'}                             | ${'an equation'}
    ${'Run `echo $HOME` and the gray $x$ cat.'}            | ${{}}       | ${'Run `echo $HOME` and the grey $x$ cat.'}             | ${'a $ inside a code span opens nothing'}
    ${'The $a `b$ and `gray` cat.'}                        | ${{}}       | ${'The $a `b$ and `gray` cat.'}                         | ${'a backtick inside maths opens nothing'}
  `('holds $why', ({ input, options, expected }) => {
    expect(md(input, options)).toBe(expected);
  });

  it.each`
    input                                    | options     | expected                                  | why
    ${'It costs $5 and $10.'}                | ${american} | ${'It costs US$5 and US$10.'}             | ${'a digit after the second $'}
    ${'The $ gray$ cat.'}                    | ${{}}       | ${'The $ grey$ cat.'}                     | ${'a space after the first $'}
    ${'The $gray $ cat.'}                    | ${{}}       | ${'The $grey $ cat.'}                     | ${'a space before the second $'}
    ${'The \\$gray$ cat.'}                   | ${{}}       | ${'The \\$grey$ cat.'}                    | ${'an escaped first $'}
    ${'The $gray\n\ngray$ cat.'}             | ${{}}       | ${'The $grey\n\ngrey$ cat.'}              | ${'a blank line between them'}
    ${'The $$gray cat.'}                     | ${{}}       | ${'The $$grey cat.'}                      | ${'a $$ that nothing closes'}
  `('reads $why as prose', ({ input, options, expected }) => {
    expect(md(input, options)).toBe(expected);
  });

  it('reads maths only in Markdown', () => {
    expect(au('The $gray$ cat.')).toBe('The $grey$ cat.');
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
    expect(au('color-picker')).toBe('colour-picker');
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
    unchanged                                                         | why
    ${'The World Health Organization met.'}                           | ${'two capitalised words before it'}
    ${'NATO, the North Atlantic Treaty Organization, met.'}           | ${'the same'}
    ${'We toured the Johnson Space Center.'}                          | ${'the same, on no list'}
    ${'Johnson Space Center opened.'}                                 | ${'a Center name counts a capital that starts a sentence'}
    ${'## Johnson Space Center'}                                      | ${'and is read in a heading'}
    ${'The International Organization for Standardization met.'}      | ${'for and a capitalised word after it'}
    ${'The Organization of American States met.'}                     | ${'of and a capitalised word after it'}
    ${'The Museum of Color opened.'}                                  | ${'a capitalised word and of before it, on no list'}
    ${'The Department of Labor and the Bureau of Labor Statistics.'}  | ${'listed, on a line every word of which is capitalised'}
    ${'The American Federation of Labor merged.'}                     | ${'a capitalised word and of before it'}
    ${'He received the Medal of Honor.'}                              | ${'the same'}
    ${'They performed at the Kodak Theater.'}                         | ${'a listed name'}
    ${'We visited Space Center Houston.'}                             | ${'the same'}
    ${'I ran the Color Run.'}                                         | ${'the same'}
    ${'## Medal of Honor Recipients'}                                 | ${'a listed name in a heading'}
  `('leaves the name in "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it.each`
    input                  | expected              | why
    ${'the data center'}   | ${'the data centre'}  | ${'one capitalised word is not a name'}
    ${'the center of town'} | ${'the centre of town'} | ${'a plain noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    input                                        | expected                                     | why
    ${'The organization grew.'}                  | ${'The organisation grew.'}                  | ${'after a capitalised article'}
    ${'A sense of honor.'}                       | ${'A sense of honour.'}                      | ${'after of and a plain noun'}
    ${'Yes, Your Honor.'}                        | ${'Yes, Your Honour.'}                       | ${'a form of address, after a possessive'}
    ${'The Legion of Honor met.'}                | ${'The Legion of Honour met.'}               | ${'the French order, spelt the British way'}
    ${'Center stage is gray.'}                   | ${'Centre stage is grey.'}                   | ${'at the start of a sentence'}
    ${'The Children’s Theater opened.'}          | ${'The Children’s Theatre opened.'}          | ${'one capitalised word before it'}
    ${'Color Theory is fun.'}                    | ${'Colour Theory is fun.'}                   | ${'one capitalised word after it'}
    ${'Labor Costs rose again.'}                 | ${'Labour Costs rose again.'}                | ${'the same'}
    ${'See the Color Picker panel.'}             | ${'See the Colour Picker panel.'}            | ${'an interface label'}
    ${'Global Health Organization members met.'} | ${'Global Health Organisation members met.'} | ${'a capital from the start of a sentence'}
    ${'It rained. Bright Red Color won.'}        | ${'It rained. Bright Red Colour won.'}       | ${'the same, after a full stop'}
  `('rewrites a common noun: $input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    input                                | expected                              | why
    ${'## Customizing Colors'}           | ${'## Customising Colours'}           | ${'a Markdown heading'}
    ${'## Data Center Setup'}            | ${'## Data Centre Setup'}             | ${'the same'}
    ${'# Organization Settings'}         | ${'# Organisation Settings'}          | ${'the same'}
    ${'## The Favorite Colors of Kids'}  | ${'## The Favourite Colours of Kids'} | ${'of after it, in a heading'}
    ${'Data Center Setup\n====='}        | ${'Data Centre Setup\n====='}         | ${'a setext heading'}
    ${'Set The Primary Brand Color'}     | ${'Set The Primary Brand Colour'}     | ${'a line in title case'}
  `('reads no name from capitals in a heading: $input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it('reads a phrase the vocabulary rewrites as a common noun, even in title case', () => {
    expect(au('Movie Theater Etiquette', { preset: 'localise' })).toBe('Cinema Etiquette');
  });

  it('can be told to stop protecting them', () => {
    expect(au('He received the Medal of Honor.', { protectProperNouns: false })).toBe('He received the Medal of Honour.');
  });
});
