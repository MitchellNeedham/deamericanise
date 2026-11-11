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

  // The last stop of `P.M.` is also the sentence's when nothing else ends it.
  it.each`
    input                                                     | expected
    ${'It starts at 3 P.M. Bring snacks.'}                    | ${'It starts at 3pm. Bring snacks.'}
    ${'The program starts at 3:00 P.M.'}                      | ${'The program starts at 3:00pm.'}
    ${'The program starts at 3:00 P.M.\n'}                    | ${'The program starts at 3:00pm.\n'}
    ${'It starts at 3 p.m.\nBring snacks.'}                   | ${'It starts at 3pm.\nBring snacks.'}
    ${'It was 3 p.m. I left.'}                                | ${'It was 3pm. I left.'}
    ${'It starts at 3 p.m. "Bring snacks," she said.'}        | ${'It starts at 3pm. "Bring snacks," she said.'}
    ${'It starts at 3 p.m. (Bring snacks.)'}                  | ${'It starts at 3pm. (Bring snacks.)'}
    ${'"It starts at 3 p.m." Bring snacks.'}                  | ${'"It starts at 3pm." Bring snacks.'}
    ${'(It starts at 3 p.m.) Bring snacks.'}                  | ${'(It starts at 3pm.) Bring snacks.'}
    ${'We meet tomorrow (at 3 p.m.)'}                         | ${'We meet tomorrow (at 3pm.)'}
    ${'The doors open at\n7 p.m.'}                            | ${'The doors open at\n7pm.'}
    ${'Doors open at 7 p.m.\n\nthe bar shuts later.'}         | ${'Doors open at 7pm.\n\nthe bar shuts later.'}
    ${'- Doors open at 7 p.m.\n- The bar shuts at 11 p.m.'}   | ${'- Doors open at 7pm.\n- The bar shuts at 11pm.'}
    ${'1. Doors open at 7 p.m.\n2. The bar shuts at 11 p.m.'} | ${'1. Doors open at 7pm.\n2. The bar shuts at 11pm.'}
  `('keeps the sentence stop: $input', ({ input, expected }) => {
    expect(times(input)).toBe(expected);
  });

  it.each`
    input                                       | expected
    ${'It ends at 5 a.m. tomorrow.'}            | ${'It ends at 5am tomorrow.'}
    ${'It starts at 3 p.m., then breaks.'}      | ${'It starts at 3pm, then breaks.'}
    ${'It starts at 3 p.m.; bring snacks.'}     | ${'It starts at 3pm; bring snacks.'}
    ${'Does it start at 3 p.m.?'}               | ${'Does it start at 3pm?'}
    ${'We meet (at 3 p.m.) and eat.'}           | ${'We meet (at 3pm) and eat.'}
    ${'We meet tomorrow (at 3 p.m.).'}          | ${'We meet tomorrow (at 3pm).'}
    ${'It starts at 3 p.m. (local time).'}      | ${'It starts at 3pm (local time).'}
    ${'It starts at 3 p.m.\nand ends at 5.'}    | ${'It starts at 3pm\nand ends at 5.'}
    ${'The show airs at 8 p.m. Eastern.'}       | ${'The show airs at 8pm Eastern.'}
    ${'The show airs at 8 p.m. ET on Fox.'}     | ${'The show airs at 8pm ET on Fox.'}
    ${'The show airs at 8 p.m. (ET).'}          | ${'The show airs at 8pm (ET).'}
    ${'The vote is at 3 p.m. Tuesday.'}         | ${'The vote is at 3pm Tuesday.'}
    ${'The vote is at 3 p.m. Tues. in Ohio.'}   | ${'The vote is at 3pm Tues. in Ohio.'}
    ${'The vote is at 3 p.m. March 5.'}         | ${'The vote is at 3pm March 5.'}
    ${'DOORS OPEN AT 7 P.M. SHARP'}             | ${'DOORS OPEN AT 7pm SHARP'}
    ${'- 9 a.m.\n- 5 p.m.'}                     | ${'- 9am\n- 5pm'}
  `('needs no sentence stop: $input', ({ input, expected }) => {
    expect(times(input)).toBe(expected);
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

  it('keeps the sentence stop on the 24-hour clock too', () => {
    const to24Hour = { times: { to24Hour: true } };
    expect(times('It starts at 3 P.M. Bring snacks.', to24Hour)).toBe('It starts at 15:00. Bring snacks.');
    expect(times('It ends at 5 a.m. tomorrow.', to24Hour)).toBe('It ends at 05:00 tomorrow.');
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
