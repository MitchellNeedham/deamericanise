import { describe, expect, it } from 'vitest';
import { analyse, deamericanise, deamericaniseText } from '../src/index.js';

const dates = (input: string, options = {}) =>
  deamericaniseText(input, { categories: { spelling: false, vocabulary: false, units: false }, ...options });

describe('numeric dates that cannot be misread', () => {
  it.each`
    input               | expected          | why
    ${'3/14/2024'}      | ${'2024-03-14'}   | ${'there is no month 14'}
    ${'12/25/2023'}     | ${'2023-12-25'}   | ${'there is no month 25'}
    ${'7-4-1776'}       | ${'7-4-1776'}     | ${'both readings work, and nothing says American'}
    ${'1/31/24'}        | ${'2024-01-31'}   | ${'two-digit years expand'}
    ${'2/29/2024'}      | ${'2024-02-29'}   | ${'a real leap day'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(dates(input)).toBe(expected);
  });

  it.each`
    unchanged        | why
    ${'25/12/2023'}  | ${'already day-first'}
    ${'2024-03-14'}  | ${'already ISO'}
    ${'2/30/2024'}   | ${'February has no 30th, so this is not a date'}
    ${'1/2/3/4'}     | ${'not a date'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(dates(unchanged)).toBe(unchanged);
  });
});

describe('numbers that only look like dates', () => {
  it.each`
    input                                     | expected                                  | why
    ${'On 3.14.2024 we left.'}                | ${'On 2024-03-14 we left.'}               | ${'a dotted date with a four-figure year'}
    ${'Due 3/14/24.'}                         | ${'Due 2024-03-14.'}                      | ${'a slashed two-figure year'}
    ${'Due 3-14-24.'}                         | ${'Due 2024-03-14.'}                      | ${'a hyphenated two-figure year'}
    ${'the latest version. 3/14/2024 came'}   | ${'the latest version. 2024-03-14 came'}  | ${'a version word that ends the sentence before it'}
    ${'Our conversion on 3/14/2024 worked.'}  | ${'Our conversion on 2024-03-14 worked.'} | ${'a word that only ends like a version word'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(dates(input)).toBe(expected);
  });

  // A version number is written with dots, so only a dotted date is refused after a version word.
  it.each`
    input                                       | expected
    ${'Press release 3/14/2024'}                | ${'Press release 2024-03-14'}
    ${'Version 3/14/2024 notes'}                | ${'Version 2024-03-14 notes'}
    ${'python 3/14/2024'}                       | ${'python 2024-03-14'}
    ${'Build 3-14-2024 failed.'}                | ${'Build 2024-03-14 failed.'}
    ${'Upgrade to v 3/14/2024 today.'}          | ${'Upgrade to v 2024-03-14 today.'}
    ${'Release 3-14-24 is out.'}                | ${'Release 2024-03-14 is out.'}
    ${'Version 03/04/2024 notes'}               | ${'Version 2024-03-04 notes'}
    ${'The press release of 3/14/2024 is out.'} | ${'The press release of 2024-03-14 is out.'}
  `('reads the slash or hyphen date in $input after a version word', ({ input, expected }) => {
    expect(dates(input, { assumeAmerican: true })).toBe(expected);
  });

  it.each([
    'Upgrade to version 1.13.24 today.',
    'Upgrade to release 1.13.24 today.',
    'node 3.14.2024',
  ])('leaves the dotted %j after a version word alone, even in American text', (unchanged) => {
    expect(dates(unchanged, { assumeAmerican: true })).toBe(unchanged);
  });

  it.each`
    unchanged                                 | why
    ${'Upgrade to version 1.13.24 today.'}    | ${'a version number'}
    ${'Node 1.13.24'}                         | ${'a version after a runtime'}
    ${'1.13.24'}                              | ${'a dotted two-figure year is a version'}
    ${'Upgrade to version 1.13.2024 today.'}  | ${'a version word, even before a four-figure year'}
    ${'Python 3.13.2024'}                     | ${'a version after a language'}
    ${'Upgrade to v1.13.24 today.'}           | ${'a v prefix'}
    ${'Upgrade to v 3.14.2024 today.'}        | ${'v on its own is a version word'}
    ${'Release 03/04/2024 notes'}             | ${'a British date in a British text, after a version word'}
    ${'Speeds of 3.22-1000 km/h.'}            | ${'two different separators make a range'}
    ${'Due 03/04/2024.'}                      | ${'a British date in a British text'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(dates(unchanged)).toBe(unchanged);
  });

  it('does not read a converted range as American on a second run', () => {
    const once = deamericaniseText('Speeds of 2-622 miles an hour cost $1,317.');
    expect(once).toBe('Speeds of 3.22-1000 kilometres per hour cost $1,317.');
    expect(deamericaniseText(once)).toBe(once);
  });
});

describe('ambiguous dates wait for evidence', () => {
  const ambiguous = 'Due 03/04/2024.';
  const threeMarkers = 'The color of the theater is gray. Due 03/04/2024.';
  const american = 'The color of the theater is gray and they canceled it. Due 03/04/2024.';

  it('leaves an ambiguous date alone in text that could be from anywhere', () => {
    expect(dates(ambiguous)).toBe('Due 03/04/2024.');
  });

  it('still waits when only three kinds of Americanism are present', () => {
    expect(dates(threeMarkers)).toContain('03/04/2024');
  });

  it('reads it month-first once the text is clearly American', () => {
    expect(dates(american)).toContain('2024-03-04');
  });

  it('can be persuaded with a lower threshold', () => {
    expect(dates(threeMarkers, { minAmericanConfidence: 0.4 })).toContain('2024-03-04');
  });

  it('can be told outright', () => {
    expect(dates(ambiguous, { assumeAmerican: true })).toBe('Due 2024-03-04.');
  });

  it('can be told the opposite outright', () => {
    expect(dates(american, { assumeAmerican: false })).toContain('03/04/2024');
  });
});

describe('output formats', () => {
  it.each`
    format     | input             | expected
    ${'iso'}   | ${'3/14/2024'}    | ${'2024-03-14'}
    ${'dmy'}   | ${'3/14/2024'}    | ${'14/03/2024'}
    ${'long'}  | ${'3/14/2024'}    | ${'14 March 2024'}
  `('format $format: $input -> $expected', ({ format, input, expected }) => {
    expect(dates(input, { dates: { format } })).toBe(expected);
  });
});

describe('month-first long dates, which only move under localise', () => {
  const long = (input: string, options = {}) => dates(input, { preset: 'localise', ...options });

  it.each`
    input                              | expected
    ${'March 5, 2024'}                 | ${'5 March 2024'}
    ${'March 5th, 2024'}               | ${'5 March 2024'}
    ${'Sep. 1, 1939'}                  | ${'1 September 1939'}
    ${'December 25, 2023'}             | ${'25 December 2023'}
    ${'Monday, March 5, 2024'}         | ${'Monday, 5 March 2024'}
    ${'March 5th'}                     | ${'5 March'}
    ${'the July 4th parade'}           | ${'the 4 July parade'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(long(input)).toBe(expected);
  });

  it.each`
    unchanged            | why
    ${'5 March 2024'}    | ${'already day-first'}
    ${'March 2024'}      | ${'no day to move'}
    ${'February 30, 2024'} | ${'not a real date'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(long(unchanged)).toBe(unchanged);
  });

  it('can be switched off inside localise', () => {
    expect(long('March 5, 2024', { dates: { reorderLongDates: false } })).toBe('March 5, 2024');
  });

  it('is off by default, because a named month cannot be misread', () => {
    expect(dates('March 5, 2024')).toBe('March 5, 2024');
  });

  it('can be turned on without localise', () => {
    expect(dates('March 5, 2024', { dates: { reorderLongDates: true } })).toBe('5 March 2024');
  });

  it('still counts as evidence that the text is American', () => {
    // The ambiguous date moves because the long one gave the game away.
    expect(dates('Filed March 5, 2024. Due 03/04/2024. The color was gray.'))
      .toContain('2024-03-04');
  });
});

describe('dates can be switched off entirely', () => {
  it.each`
    input              | expected
    ${'3/14/2024'}     | ${'3/14/2024'}
    ${'March 5, 2024'} | ${'March 5, 2024'}
  `('$input stays $expected', ({ input, expected }) => {
    expect(dates(input, { preset: 'localise', dates: false })).toBe(expected);
  });
});

describe('a named month pins the order for the numeric dates around it', () => {
  it.each`
    input                                          | expected            | why
    ${'Filed March 5, 2024. Due 03/04/2024.'}      | ${'2024-03-04'}     | ${'month-first named date says the doc is American'}
    ${'Filed 5 March 2024. Due 03/04/2024.'}       | ${'03/04/2024'}     | ${'day-first named date says it is not'}
  `('$input yields $expected ($why)', ({ input, expected }) => {
    expect(dates(input)).toContain(expected);
  });

  // Numeric and named dates are counted apart, because a document can write its prose
  // one way round and its data the other.
  it.each`
    input                             | numMonth | numDay | namedMonth | namedDay
    ${'due 3/14/2024'}                | ${1}     | ${0}   | ${0}       | ${0}
    ${'due 25/12/2023'}               | ${0}     | ${1}   | ${0}       | ${0}
    ${'Filed March 5, 2024'}          | ${0}     | ${0}   | ${1}       | ${0}
    ${'Filed 5 March 2024'}           | ${0}     | ${0}   | ${0}       | ${1}
    ${'March 5, 2024 and 25/12/2023'} | ${0}     | ${1}   | ${1}       | ${0}
    ${'due 14/3/2024'}                | ${0}     | ${1}   | ${0}       | ${0}
    ${'due 25.12.2023'}               | ${0}     | ${1}   | ${0}       | ${0}
    ${'speeds of 3.22-1000 km/h'}     | ${0}     | ${0}   | ${0}       | ${0}
    ${'speeds of 22.3-1000 km/h'}     | ${0}     | ${0}   | ${0}       | ${0}
    ${'version 1.13.24'}              | ${0}     | ${0}   | ${0}       | ${0}
    ${'Node 14.2.10'}                 | ${0}     | ${0}   | ${0}       | ${0}
    ${'version 3/14/2024'}            | ${1}     | ${0}   | ${0}       | ${0}
    ${'Build 14-3-2024'}              | ${0}     | ${1}   | ${0}       | ${0}
    ${'version 3.14.2024'}            | ${0}     | ${0}   | ${0}       | ${0}
    ${'due 2/30/2024'}                | ${0}     | ${0}   | ${0}       | ${0}
    ${'see /3/14/2024/'}              | ${0}     | ${0}   | ${0}       | ${0}
  `('counts $input', ({ input, numMonth, numDay, namedMonth, namedDay }) => {
    const s = analyse(input as string);
    expect(s.unambiguousMonthFirstDates, 'numeric month-first').toBe(numMonth);
    expect(s.unambiguousDayFirstDates, 'numeric day-first').toBe(numDay);
    expect(s.namedMonthFirstDates, 'named month-first').toBe(namedMonth);
    expect(s.namedDayFirstDates, 'named day-first').toBe(namedDay);
  });

  it.each([
    'due 3/14/2024',
    'due 3.14.2024 and 1.13.24',
    'speeds of 3.22-1000 km/h',
    'version 3/14/2024, released 3/15/2024',
    'due 2/30/2024 or 4/31/2024',
    'see /3/14/2024/ and -3/14/2024',
    'runs 1/2/3/4 and 3/14/2024/5',
  ])('counts as month-first exactly the dates the rule converts in %j', (input) => {
    const { changes, signals } = deamericanise(input, { assumeAmerican: false });
    const unambiguous = changes.filter((c) => c.ruleId === 'dates.numeric' && c.confidence === 'safe');
    expect(signals.unambiguousMonthFirstDates).toBe(unambiguous.length);
  });

  it('treats one unambiguous American date as near-conclusive on its own', () => {
    expect(analyse('The form was filed 12/16/2026.').confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('lets a numeric day-first date veto month-first prose', () => {
    // American prose, day-first data: exactly what a US agency API produces.
    const text = 'Letters were mailed February 4, 2022. Report received 20/02/2026. Due 03/04/2024.';
    expect(dates(text)).toContain('03/04/2024');
  });
});

describe('a sibling date outranks the American-ness score', () => {
  it.each`
    input                                                             | expected          | why
    ${'Filed 3/14/2024. Due 03/04/2024.'}                             | ${'2024-03-04'}   | ${'a day of 14 pins the order'}
    ${'Filed 25/12/2023. Due 03/04/2024. The color was gray.'}        | ${'03/04/2024'}   | ${'a day-first sibling vetoes, however American the prose'}
    ${'Filed 5 March 2024. Due 03/04/2024. The color was gray.'}      | ${'03/04/2024'}   | ${'a named day-first date does the same'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(dates(input)).toContain(expected);
  });

  it('records which evidence it used', () => {
    const { changes } = deamericanise('Filed March 5, 2024. Due 03/04/2024.');
    const ambiguous = changes.find((c) => c.before === '03/04/2024');
    expect(ambiguous?.note).toContain('this text writes its named dates month-first');
  });
});
