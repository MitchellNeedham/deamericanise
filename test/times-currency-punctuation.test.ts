import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

const only = (category: 'times' | 'currency' | 'punctuation') => (input: string, options = {}) =>
  deamericaniseText(input, {
    categories: Object.fromEntries(
      ['spelling', 'vocabulary', 'units', 'dates', 'times', 'currency', 'punctuation', 'misc'].map(
        (c) => [c, c === category],
      ),
    ),
    ...options,
  });

describe('times', () => {
  const times = only('times');

  // By default only the American styling goes: a 12-hour clock is normal elsewhere too.
  it.each`
    input           | expected
    ${'3:00 PM'}    | ${'3:00pm'}
    ${'3 PM'}       | ${'3pm'}
    ${'3:30 p.m.'}  | ${'3:30pm'}
    ${'9 A.M.'}     | ${'9am'}
    ${'12:00 AM'}   | ${'12:00am'}
    ${'11:59 pm'}   | ${'11:59pm'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(times(input)).toBe(expected);
  });

  it('keeps the sentence when a bare PM ends one', () => {
    expect(times('Starts at 3:00 PM. Ends later.')).toBe('Starts at 3:00pm. Ends later.');
  });

  it.each`
    input           | expected
    ${'3:00 PM'}    | ${'15:00'}
    ${'3 PM'}       | ${'15:00'}
    ${'3:30 p.m.'}  | ${'15:30'}
    ${'9 A.M.'}     | ${'09:00'}
    ${'12:00 AM'}   | ${'00:00'}
    ${'12:30 PM'}   | ${'12:30'}
    ${'11:59 pm'}   | ${'23:59'}
    ${'1:05:30 PM'} | ${'13:05:30'}
  `('with to24Hour on, $input -> $expected', ({ input, expected }) => {
    expect(times(input, { times: { to24Hour: true } })).toBe(expected);
  });

  it.each`
    unchanged        | why
    ${'13:00'}       | ${'already 24-hour'}
    ${'25 PM'}       | ${'not a clock time'}
    ${'the AM band'} | ${'no number in front'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(times(unchanged)).toBe(unchanged);
  });

  it('can be switched off', () => {
    expect(times('3:00 PM', { times: false })).toBe('3:00 PM');
  });
});

describe('currency', () => {
  const money = only('currency');
  const american = { assumeAmerican: true };

  it.each`
    input                  | expected
    ${'It cost $500.'}     | ${'It cost US$500.'}
    ${'$1,299.99'}         | ${'US$1,299.99'}
    ${'$5 million'}        | ${'US$5 million'}
    ${'paid 50 dollars'}   | ${'paid 50 US dollars'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(money(input, american)).toBe(expected);
  });

  it.each`
    unchanged      | why
    ${'A$500'}     | ${'already pinned to a currency'}
    ${'US$500'}    | ${'already pinned'}
    ${'NZ$20'}     | ${'already pinned'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(money(unchanged, american)).toBe(unchanged);
  });

  it('says nothing when the text does not look American', () => {
    expect(money('It cost $500.')).toBe('It cost $500.');
  });

  it('can be switched off', () => {
    expect(money('It cost $500.', { ...american, currency: false })).toBe('It cost $500.');
  });
});

describe('punctuation', () => {
  const punctuation = only('punctuation');

  it.each`
    input                      | expected
    ${'Mr. Smith'}             | ${'Mr Smith'}
    ${'Dr. Jones and Mrs. Lee'} | ${'Dr Jones and Mrs Lee'}
    ${'Sgt. Lee'}              | ${'Sgt Lee'}
    ${'Lt. Chen'}              | ${'Lt Chen'}
    ${'St. Kilda'}             | ${'St Kilda'}
    ${'the U.S. market'}       | ${'the US market'}
    ${'the U.K. and U.S.A.'}   | ${'the UK and USA'}
    ${'a Ph.D. in physics'}    | ${'a PhD in physics'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                        | expected
    ${'She said "hello," then left.'} | ${'She said "hello", then left.'}
    ${'It was "fine."'}          | ${'It was "fine".'}
  `('logical quoting: $input -> $expected', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  // The stop marks a truncation, not an abbreviation. A word cut short keeps it.
  it.each`
    unchanged            | why
    ${'Prof. Chen'}      | ${'Professor does not end in f'}
    ${'Rev. Green'}      | ${'Reverend does not end in v'}
    ${'Capt. Ahab'}      | ${'Captain does not end in t'}
    ${'Gen. Monash'}     | ${'General does not end in n'}
    ${'Co. Ltd'}         | ${'Company does not end in o'}
    ${'etc. and so on'}  | ${'et cetera, cut short'}
    ${'Mr Smith'}        | ${'already correct'}
    ${'e.g. this'}       | ${'not a title'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(punctuation(unchanged)).toBe(unchanged);
  });

  it('is off unless asked for, being house style rather than comprehension', () => {
    expect(deamericaniseText('Mr. Smith visited the U.S.')).toBe('Mr. Smith visited the U.S.');
  });

  it('drops logical quoting on its own', () => {
    expect(punctuation('It was "fine."', { rules: { 'punctuation.logical-quotes': false } }))
      .toBe('It was "fine."');
  });
});
