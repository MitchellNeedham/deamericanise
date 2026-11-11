import { describe, expect, it } from 'vitest';
import { DIALECTS, deamericaniseText } from '../src/index.js';
import type { Dialect, LexEntry, RuleContext } from '../src/index.js';
import { compileLexicon, findLexiconMatches } from '../src/engine/lexicon.js';

// The dialect overlays are vocabulary, so they need the localise preset.
const say = (dialect: Dialect) => (input: string) =>
  deamericaniseText(input, { dialect, preset: 'localise' });

describe('the same sentence in each dialect', () => {
  it.each`
    input                  | au                   | gb                    | nz
    ${'the sidewalk'}      | ${'the footpath'}    | ${'the pavement'}     | ${'the footpath'}
    ${'candy'}             | ${'lollies'}         | ${'sweets'}           | ${'lollies'}
    ${'a cookie'}          | ${'a biscuit'}       | ${'a biscuit'}        | ${'a biscuit'}
    ${'potato chips'}      | ${'chips'}           | ${'crisps'}           | ${'chips'}
    ${'a popsicle'}        | ${'an icy pole'}     | ${'an ice lolly'}     | ${'an ice block'}
    ${'cotton candy'}      | ${'fairy floss'}     | ${'candy floss'}      | ${'candy floss'}
    ${'a thrift store'}    | ${'an op shop'}      | ${'a charity shop'}   | ${'an op shop'}
    ${'a band-aid'}        | ${'a bandaid'}       | ${'a plaster'}        | ${'a plaster'}
    ${'call 911'}          | ${'call 000'}        | ${'call 999'}         | ${'call 111'}
  `('$input -> AU $au / GB $gb / NZ $nz', ({ input, au, gb, nz }) => {
    expect(say('en-AU')(input), 'en-AU').toBe(au);
    expect(say('en-GB')(input), 'en-GB').toBe(gb);
    expect(say('en-NZ')(input), 'en-NZ').toBe(nz);
  });
});

describe('words only some dialects change', () => {
  it.each`
    input             | dialect     | expected
    ${'an apartment'} | ${'en-AU'}  | ${'an apartment'}
    ${'an apartment'} | ${'en-GB'}  | ${'a flat'}
    ${'soccer'}       | ${'en-AU'}  | ${'soccer'}
    ${'soccer'}       | ${'en-GB'}  | ${'football'}
    ${'a truck'}      | ${'en-AU'}  | ${'a truck'}
    ${'a truck'}      | ${'en-GB'}  | ${'a lorry'}
    ${'the highway'}  | ${'en-AU'}  | ${'the highway'}
    ${'the highway'}  | ${'en-GB'}  | ${'the motorway'}
    ${'zucchini'}     | ${'en-AU'}  | ${'zucchini'}
    ${'zucchini'}     | ${'en-GB'}  | ${'courgette'}
    ${'eggplant'}     | ${'en-AU'}  | ${'eggplant'}
    ${'eggplant'}     | ${'en-GB'}  | ${'aubergine'}
    ${'sulfur'}       | ${'en-AU'}  | ${'sulfur'}
    ${'sulfur'}       | ${'en-GB'}  | ${'sulphur'}
    ${'ketchup'}      | ${'en-AU'}  | ${'tomato sauce'}
    ${'ketchup'}      | ${'en-GB'}  | ${'ketchup'}
    ${'a bell pepper'} | ${'en-AU'} | ${'a capsicum'}
    ${'a bell pepper'} | ${'en-GB'} | ${'a pepper'}
  `('$dialect: $input -> $expected', ({ input, dialect, expected }) => {
    expect(say(dialect as Dialect)(input)).toBe(expected);
  });
});

describe('a dialect row outranks the shared row for the same word', () => {
  it.each`
    input                                | dialect    | expected
    ${'a field trip'}                    | ${'en-GB'} | ${'a school trip'}
    ${'Field trips are fun.'}            | ${'en-GB'} | ${'School trips are fun.'}
    ${'an apartment building'}           | ${'en-GB'} | ${'a block of flats'}
    ${'two apartment buildings'}         | ${'en-GB'} | ${'two blocks of flats'}
    ${'Drop it in the nearest mailbox.'} | ${'en-GB'} | ${'Drop it in the nearest postbox.'}
    ${'public mailboxes'}                | ${'en-GB'} | ${'public postboxes'}
    ${'a field trip'}                    | ${'en-IE'} | ${'a school trip'}
    ${'an apartment building'}           | ${'en-IE'} | ${'a block of flats'}
    ${'a field trip'}                    | ${'en-ZA'} | ${'a school trip'}
    ${'an apartment building'}           | ${'en-ZA'} | ${'a block of flats'}
    ${'any mailbox'}                     | ${'en-ZA'} | ${'any postbox'}
    ${'a field trip'}                    | ${'en-AU'} | ${'an excursion'}
    ${'an apartment building'}           | ${'en-NZ'} | ${'an apartment block'}
  `('$dialect: $input -> $expected', ({ input, dialect, expected }) => {
    expect(say(dialect as Dialect)(input)).toBe(expected);
  });
});

describe('the shared row is the fallback when the dialect row does not apply', () => {
  it.each`
    input                     | dialect    | expected
    ${'the mailbox'}          | ${'en-GB'} | ${'the letterbox'}
    ${'Check your mailbox.'}  | ${'en-GB'} | ${'Check your letterbox.'}
    ${'the mailboxes'}        | ${'en-IE'} | ${'the letterboxes'}
    ${'the mailbox'}          | ${'en-ZA'} | ${'the letterbox'}
    ${'the grocery store'}    | ${'en-ZA'} | ${'the supermarket'}
  `('$dialect: $input -> $expected', ({ input, dialect, expected }) => {
    expect(say(dialect as Dialect)(input)).toBe(expected);
  });

  it('uses the shared row when the dialect rule is switched off', () => {
    const options = { dialect: 'en-GB', preset: 'localise', rules: { 'dialect.en-GB': false } } as const;
    expect(deamericaniseText('a field trip', options)).toBe('an excursion');
  });
});

describe('the order the lexicon tries rows for one word in', () => {
  const widget = (to: string, extra: Partial<LexEntry> = {}): LexEntry => ({
    from: 'widget',
    to,
    ruleId: `test.${to}`,
    category: 'vocabulary',
    confidence: 'safe',
    ...extra,
  });
  const swap = (text: string, ...layers: LexEntry[][]): string[] =>
    findLexiconMatches({ text, american: true } as RuleContext, compileLexicon(...layers), () => true)
      .map((change) => change.after);

  it('tries a later layer first, whatever the priority', () => {
    expect(swap('a widget', [widget('shared', { priority: 90 })], [widget('dialect')])).toEqual(['dialect']);
  });

  it('tries a higher priority first within a layer', () => {
    expect(swap('a widget', [widget('plain'), widget('gated', { priority: 20 })])).toEqual(['gated']);
  });

  it('keeps the listed order between equal priorities', () => {
    expect(swap('a widget', [widget('first'), widget('second')])).toEqual(['first']);
  });

  it('falls back to an earlier layer when the later row is refused by its context', () => {
    const layers = [[widget('shared')], [widget('dialect', { requireBefore: /\bblue\s+$/ })]];
    expect(swap('a widget', ...layers)).toEqual(['shared']);
    expect(swap('a blue widget', ...layers)).toEqual(['dialect']);
  });
});

describe('en-GB keeps the imperial units Britain still uses', () => {
  it.each`
    input           | au                        | gb
    ${'10 miles'}   | ${'16 kilometres'}        | ${'10 miles'}
    ${'60 mph'}     | ${'97 km/h'}              | ${'60 mph'}
    ${'2 pints'}    | ${'950 millilitres'}      | ${'2 pints'}
    ${'6 feet'}     | ${'1.8 metres'}           | ${'1.8 metres'}
    ${'350°F'}      | ${'175°C'}                | ${'175°C'}
  `('$input -> AU $au / GB $gb', ({ input, au, gb }) => {
    expect(say('en-AU')(input), 'en-AU').toBe(au);
    expect(say('en-GB')(input), 'en-GB').toBe(gb);
  });

  it('converts them anyway when the rule is turned on by id', () => {
    expect(deamericaniseText('10 miles', { dialect: 'en-GB', rules: { 'units.length.mile': true } }))
      .toBe('16 kilometres');
  });
});

describe('en-CA is the hybrid', () => {
  it.each`
    input           | expected            | why
    ${'color'}      | ${'colour'}         | ${'Canada keeps the u'}
    ${'centre'}     | ${'centre'}         | ${'and the -re'}
    ${'defense'}    | ${'defence'}        | ${'and the -ce'}
    ${'organize'}   | ${'organize'}       | ${'but keeps -ize'}
    ${'analyze'}    | ${'analyze'}        | ${'and -yze'}
    ${'aluminum'}   | ${'aluminum'}       | ${'and aluminum'}
    ${'math'}       | ${'math'}           | ${'and math'}
    ${'a flat tire'} | ${'a flat tire'}   | ${'and tire'}
    ${'the sidewalk'} | ${'the sidewalk'} | ${'and most of the vocabulary'}
    ${'gasoline'}   | ${'gasoline'}       | ${'Canadians buy gas'}
    ${'travelled'}  | ${'travelled'}      | ${'already doubled'}
    ${'traveled'}   | ${'travelled'}      | ${'but doubles the l'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(say('en-CA')(input)).toBe(expected);
  });
});

describe('the dialect registry', () => {
  it('exposes every dialect with a label', () => {
    for (const [id, pack] of Object.entries(DIALECTS)) {
      expect(pack.id).toBe(id);
      expect(pack.label.length).toBeGreaterThan(0);
    }
  });

  it('rejects a dialect it does not know', () => {
    expect(() => deamericaniseText('color', { dialect: 'en-XX' as Dialect })).toThrow(/Unknown dialect/);
  });
});

describe('words that are already correct are left alone', () => {
  it.each`
    unchanged           | dialect     | why
    ${'candy floss'}    | ${'en-AU'}  | ${'not American, so candy must not fire inside it'}
    ${'candy floss'}    | ${'en-GB'}  | ${'the same'}
    ${'fairy floss'}    | ${'en-AU'}  | ${'the target of another rule'}
  `('$dialect leaves "$unchanged" alone ($why)', ({ unchanged, dialect }) => {
    expect(say(dialect as Dialect)(unchanged)).toBe(unchanged);
  });
});

// Every dialect with a `cookie` row.
const BISCUIT_DIALECTS: Dialect[] = ['en-AU', 'en-GB', 'en-NZ', 'en-IE', 'en-ZA'];

describe('web cookies stay cookies', () => {
  it.each([
    'We use cookies.',
    'We use cookies to improve your experience.',
    'This site uses cookies to analyse traffic.',
    'This website uses cookies to ensure you get the best experience on our website.',
    'By clicking "Accept All Cookies", you agree to the storing of cookies on your device to enhance site navigation.',
    'Accept all cookies',
    'Accept All Cookies',
    'Reject all cookies',
    'Allow all cookies',
    'Accept additional cookies',
    'Reject non-essential cookies',
    'Use necessary cookies only',
    'Cookie settings',
    'Cookies Settings',
    'Cookie Policy',
    'Cookie preferences',
    'Hide cookie message',
    'Manage cookies',
    'Strictly Necessary Cookies',
    'Performance Cookies',
    'Analytics cookies',
    'Third-party cookies',
    'first party cookies',
    'HTTP cookies',
    'Session cookies expire when you close the browser.',
    'Your browser stores a cookie for each site you visit.',
    'A cookie is a small text file stored on your computer.',
    'These cookies are necessary for the website to function.',
    'Our use of cookies is described in our privacy policy.',
    'These cookies allow us to count visits and traffic sources so we can improve our site.',
    'For all other types of cookies we need your permission.',
    'Clear your cookies and try again.',
    "the cookie's expiry date",
    'For more on cookies, e.g. how to block them, see your browser help.',
    'We value your privacy. We and our partners use cookies.',
    'Cookies on GOV.UK',
    'Cookies',
    'COOKIES',
    'Cookie:',
  ])('leaves "%s" alone', (input) => {
    for (const dialect of BISCUIT_DIALECTS) expect(say(dialect)(input), dialect).toBe(input);
  });
});

describe('cookies you eat still become biscuits', () => {
  it.each`
    input                                                  | expected
    ${'Bake the cookies for 12 minutes.'}                  | ${'Bake the biscuits for 12 minutes.'}
    ${'Store cookies in an airtight container.'}           | ${'Store biscuits in an airtight container.'}
    ${'Set cookies on a wire rack to cool.'}               | ${'Set biscuits on a wire rack to cool.'}
    ${'Chocolate Chip Cookies'}                            | ${'Chocolate Chip Biscuits'}
    ${'These cookies are baked fresh every morning.'}      | ${'These biscuits are baked fresh every morning.'}
    ${'Read our privacy policy. Then try these cookies.'}  | ${'Read our privacy policy. Then try these biscuits.'}
    ${'I ate three cookies. Then I checked the website.'}  | ${'I ate three biscuits. Then I checked the website.'}
    ${'a cookie cutter'}                                   | ${'a biscuit cutter'}
    ${'the cookie jar'}                                    | ${'the biscuit jar'}
    ${'cookie dough'}                                      | ${'biscuit dough'}
  `('$input -> $expected', ({ input, expected }) => {
    for (const dialect of BISCUIT_DIALECTS) expect(say(dialect)(input), dialect).toBe(expected);
  });
});

describe('cookies in fixed phrases', () => {
  it.each`
    input                                       | expected
    ${'Fortune cookies'}                        | ${'Fortune cookies'}
    ${'a fortune cookie'}                       | ${'a fortune cookie'}
    ${'Girl Scout cookies'}                     | ${'Girl Scout cookies'}
    ${'Cookie Monster'}                         | ${'Cookie Monster'}
    ${'a cookie-cutter approach'}               | ${'a cookie-cutter approach'}
    ${'Line a cookie sheet with parchment.'}    | ${'Line a baking tray with parchment.'}
    ${'Grease two cookie sheets.'}              | ${'Grease two baking trays.'}
  `('$input -> $expected', ({ input, expected }) => {
    for (const dialect of BISCUIT_DIALECTS) expect(say(dialect)(input), dialect).toBe(expected);
  });
});

describe('trucks', () => {
  it.each`
    input                         | gb                             | ie                             | za                            | au
    ${'a truck driver'}           | ${'a lorry driver'}            | ${'a lorry driver'}            | ${'a truck driver'}           | ${'a truck driver'}
    ${'a fire truck'}             | ${'a fire engine'}             | ${'a fire engine'}             | ${'a fire truck'}             | ${'a fire truck'}
    ${'Fire trucks raced past.'}  | ${'Fire engines raced past.'}  | ${'Fire engines raced past.'}  | ${'Fire trucks raced past.'}  | ${'Fire trucks raced past.'}
    ${'a red firetruck'}          | ${'a red fire engine'}         | ${'a red fire engine'}         | ${'a red firetruck'}          | ${'a red firetruck'}
    ${'the pickup truck'}         | ${'the pickup truck'}          | ${'the pickup truck'}          | ${'the bakkie'}               | ${'the ute'}
    ${'two pick-up trucks'}       | ${'two pick-up trucks'}        | ${'two pick-up trucks'}        | ${'two pick-up trucks'}       | ${'two pick-up trucks'}
    ${'a dump truck'}             | ${'a dump truck'}              | ${'a dump truck'}              | ${'a dump truck'}             | ${'a dump truck'}
    ${'a forklift truck'}         | ${'a forklift truck'}          | ${'a forklift truck'}          | ${'a forklift truck'}         | ${'a forklift truck'}
    ${'food trucks'}              | ${'food trucks'}               | ${'food trucks'}               | ${'food trucks'}              | ${'food trucks'}
    ${'a monster truck'}          | ${'a monster truck'}           | ${'a monster truck'}           | ${'a monster truck'}          | ${'a monster truck'}
    ${'a tow truck'}              | ${'a tow truck'}               | ${'a tow truck'}               | ${'a tow truck'}              | ${'a tow truck'}
    ${'an ice cream truck'}       | ${'an ice cream truck'}        | ${'an ice cream truck'}        | ${'an ice cream truck'}       | ${'an ice cream truck'}
  `('$input -> GB $gb / IE $ie / ZA $za / AU $au', ({ input, gb, ie, za, au }) => {
    expect(say('en-GB')(input), 'en-GB').toBe(gb);
    expect(say('en-IE')(input), 'en-IE').toBe(ie);
    expect(say('en-ZA')(input), 'en-ZA').toBe(za);
    expect(say('en-AU')(input), 'en-AU').toBe(au);
  });
});

describe('overlay words in phrases that already read right', () => {
  it.each`
    input                                                   | expected                                                | dialect
    ${"Don't be a smarty-pants."}                           | ${"Don't be a smarty-pants."}                           | ${'en-GB'}
    ${'smarty pants'}                                       | ${'smarty pants'}                                       | ${'en-GB'}
    ${'a fancy-pants restaurant'}                           | ${'a fancy-pants restaurant'}                           | ${'en-GB'}
    ${'flying by the seat of your pants'}                   | ${'flying by the seat of your pants'}                   | ${'en-GB'}
    ${'a seat-of-the-pants decision'}                       | ${'a seat-of-the-pants decision'}                       | ${'en-GB'}
    ${'It scared the pants off me.'}                        | ${'It scared the pants off me.'}                        | ${'en-GB'}
    ${'He took his pants off.'}                             | ${'He took his trousers off.'}                          | ${'en-GB'}
    ${'Iron the pants.'}                                    | ${'Iron the trousers.'}                                 | ${'en-GB'}
    ${'It is my way or the highway.'}                       | ${'It is my way or the highway.'}                       | ${'en-GB'}
    ${'That is highway robbery.'}                           | ${'That is highway robbery.'}                           | ${'en-GB'}
    ${'Highway 101 was closed.'}                            | ${'Highway 101 was closed.'}                            | ${'en-GB'}
    ${'near NW Highway 225A'}                               | ${'near NW Highway 225A'}                               | ${'en-GB'}
    ${'the Pacific Coast Highway'}                          | ${'the Pacific Coast Highway'}                          | ${'en-GB'}
    ${'across the William F. Stone Highway'}                | ${'across the William F. Stone Highway'}                | ${'en-GB'}
    ${'the California Highway Patrol'}                      | ${'the California Highway Patrol'}                      | ${'en-GB'}
    ${'the National Highway Traffic Safety Administration'} | ${'the National Highway Traffic Safety Administration'} | ${'en-GB'}
    ${'Take the highway north.'}                            | ${'Take the motorway north.'}                           | ${'en-GB'}
    ${'The highway was closed.'}                            | ${'The motorway was closed.'}                           | ${'en-GB'}
    ${'the Pacific Coast Highway'}                          | ${'the Pacific Coast Highway'}                          | ${'en-NZ'}
    ${'an apartment complex'}                               | ${'an apartment complex'}                               | ${'en-GB'}
    ${'a serviced apartment'}                               | ${'a serviced apartment'}                               | ${'en-GB'}
    ${'two apartment buildings'}                            | ${'two apartment blocks'}                               | ${'en-NZ'}
    ${'They rented an apartment.'}                          | ${'They rented a flat.'}                                | ${'en-GB'}
    ${'an apartment complex'}                               | ${'an apartment complex'}                               | ${'en-NZ'}
  `('$dialect: $input -> $expected', ({ input, expected, dialect }) => {
    expect(say(dialect as Dialect)(input)).toBe(expected);
  });
});
