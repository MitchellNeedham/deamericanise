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

  it.each`
    input                          | monthFirst | dayFirst
    ${'due 3/14/2024'}             | ${1}       | ${0}
    ${'due 25/12/2023'}            | ${0}       | ${1}
    ${'Filed March 5, 2024'}       | ${1}       | ${0}
    ${'Filed 5 March 2024'}        | ${0}       | ${1}
    ${'March 5, 2024 and 25/12/2023'} | ${1}    | ${1}
  `('counts $input as $monthFirst month-first, $dayFirst day-first', ({ input, monthFirst, dayFirst }) => {
    const signals = analyse(input as string);
    expect(signals.unambiguousMonthFirstDates).toBe(monthFirst);
    expect(signals.unambiguousDayFirstDates).toBe(dayFirst);
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
    expect(ambiguous?.note).toContain('another date in this text is written month-first');
  });
});
