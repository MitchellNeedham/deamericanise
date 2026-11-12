import { describe, expect, it } from 'vitest';
import { deamericanise, deamericaniseText } from '../src/index.js';

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
    ${'The vote is at 3 p.m. 5 March.'}         | ${'The vote is at 3pm 5 March.'}
    ${'The vote is at 3 p.m. 25/12/2024.'}      | ${'The vote is at 3pm 25/12/2024.'}
    ${'DOORS OPEN AT 7 P.M. SHARP'}             | ${'DOORS OPEN AT 7pm SHARP'}
    ${'- 9 a.m.\n- 5 p.m.'}                     | ${'- 9am\n- 5pm'}
  `('needs no sentence stop: $input', ({ input, expected }) => {
    expect(times(input)).toBe(expected);
  });

  it.each`
    input                           | expected
    ${'We left at 5 p.m...'}        | ${'We left at 5pm...'}
    ${'We left at 5 P.M... or so.'} | ${'We left at 5pm... or so.'}
    ${'We left at 5 p.m....'}       | ${'We left at 5pm...'}
  `('keeps the stop that opens an ellipsis, and no other: $input', ({ input, expected }) => {
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

  it.each`
    input                           | before
    ${'$5'}                         | ${'$5'}
    ${'$5 million'}                 | ${'$5 million'}
    ${'$5 billion'}                 | ${'$5 billion'}
    ${'$5 Million'}                 | ${'$5 Million'}
    ${'$5 MILLION'}                 | ${'$5 MILLION'}
    ${'$5M'}                        | ${'$5M'}
    ${'$5m'}                        | ${'$5m'}
    ${'$50K'}                       | ${'$50K'}
    ${'$50k'}                       | ${'$50k'}
    ${'$50k-$80k'}                  | ${'$50k'}
    ${'$5 millionaire'}             | ${'$5'}
    ${'$5 Kroner'}                  | ${'$5'}
    ${'a $5 Kölsch'}                | ${'$5'}
    ${'$5bn'}                       | ${'$5'}
    ${'$5 a gallon'}                | ${'$5'}
    ${'It cost $5, then $6.'}       | ${'$5'}
    ${'It was $5\nmillion'}         | ${'$5'}
    ${'It was $5\n\nThen it rose.'} | ${'$5'}
  `('ends the change for $input at the number or a whole scale word', ({ input, before }) => {
    const [change] = deamericanise(input, american).changes;
    expect(change?.before).toBe(before);
  });

  it.each`
    input                                   | options                                | expected
    ${'Spend $50 modernizing the kitchen.'} | ${american}                            | ${'Spend US$50 modernising the kitchen.'}
    ${'It was $5 mustache wax.'}            | ${american}                            | ${'It was US$5 moustache wax.'}
    ${'Two $5 medalists.'}                  | ${american}                            | ${'Two US$5 medallists.'}
    ${'A $5 beveled edge.'}                 | ${american}                            | ${'A US$5 bevelled edge.'}
    ${'We sold $5 bell peppers.'}           | ${{ ...american, preset: 'localise' }} | ${'We sold US$5 capsicums.'}
  `('leaves the word after $input to its own rule', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
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
    ${'the U.K. and U.S.A.'}   | ${'the UK and USA.'}
    ${'a Ph.D. in physics'}    | ${'a PhD in physics'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  // Only a time makes `P.M.` the meridiem. Without one it stands for something else.
  it.each`
    input                                              | expected
    ${'The P.M. said no.'}                             | ${'The PM said no.'}
    ${'The British P.M. visited Washington.'}          | ${'The British PM visited Washington.'}
    ${'Tune in on the A.M. dial.'}                     | ${'Tune in on the AM dial.'}
    ${'Two P.M.s have resigned.'}                      | ${'Two PMs have resigned.'}
    ${"the P.M.'s office"}                             | ${"the PM's office"}
    ${'In 2019 P.M. Johnson resigned.'}                | ${'In 2019 PM Johnson resigned.'}
    ${'They called him a rotten P.M. and left.'}       | ${'They called him a rotten PM and left.'}
    ${'the P.M., then the cabinet'}                    | ${'the PM, then the cabinet'}
  `('keeps the capitals with no time: $input', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                                              | expected
    ${'It starts at 3 P.M. today.'}                    | ${'It starts at 3 pm today.'}
    ${'It starts at 3:30 P.M. today.'}                 | ${'It starts at 3:30 pm today.'}
    ${'It runs from 3 to 4 A.M. today.'}               | ${'It runs from 3 to 4 am today.'}
    ${'It starts at ten P.M. today.'}                  | ${'It starts at ten pm today.'}
    ${'It starts at Ten P.M. today.'}                  | ${'It starts at Ten pm today.'}
    ${'It starts at ten forty-five P.M. today.'}       | ${'It starts at ten forty-five pm today.'}
  `('lowercases a time while times are off: $input', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                                  | expected
    ${'It starts at 3 P.M.'}               | ${'It starts at 3pm.'}
    ${'It starts at 9 A.M. sharp.'}        | ${'It starts at 9am sharp.'}
    ${'We met in the P.M. It was late.'}   | ${'We met in the PM. It was late.'}
    ${'The P.M. said no.'}                 | ${'The PM said no.'}
  `('under localise: $input', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });

  // The last stop of an initialism is also the sentence's when nothing else ends it.
  it.each`
    input                                                 | expected
    ${'She moved to the U.S. It was cold.'}               | ${'She moved to the US. It was cold.'}
    ${'She moved to the U.K. It was cold.'}               | ${'She moved to the UK. It was cold.'}
    ${'She moved to the U.S.A. It was cold.'}             | ${'She moved to the USA. It was cold.'}
    ${'He has a Ph.D. It took years.'}                    | ${'He has a PhD. It took years.'}
    ${'He has a Ph. D. It took years.'}                   | ${'He has a PhD. It took years.'}
    ${'We met in the P.M. It was late.'}                  | ${'We met in the PM. It was late.'}
    ${'She moved to the U.S.'}                            | ${'She moved to the US.'}
    ${'She moved to the U.S.\n'}                          | ${'She moved to the US.\n'}
    ${'She moved to the U.S.\nIt was cold.'}              | ${'She moved to the US.\nIt was cold.'}
    ${'She moved to the U.K.\n\nthe rest stayed.'}        | ${'She moved to the UK.\n\nthe rest stayed.'}
    ${'- She moved to the U.S.\n- He moved to the U.K.'}  | ${'- She moved to the US.\n- He moved to the UK.'}
    ${'She moved to the U.S. A year later she left.'}     | ${'She moved to the US. A year later she left.'}
    ${"She moved to the U.S. It's cold there."}           | ${"She moved to the US. It's cold there."}
    ${'She moved to the U.S. However, it was cold.'}      | ${'She moved to the US. However, it was cold.'}
    ${'Born in the U.S. I moved at ten.'}                 | ${'Born in the US. I moved at ten.'}
    ${'She moved to the U.S. (It was cold.)'}             | ${'She moved to the US. (It was cold.)'}
    ${'She moved to the U.K. "It is cold" was all.'}      | ${'She moved to the UK. "It is cold" was all.'}
    ${'(She moved to the U.S.) It was cold.'}             | ${'(She moved to the US.) It was cold.'}
    ${'"She moved to the U.S." It was cold.'}             | ${'"She moved to the US." It was cold.'}
    ${'"She moved to the U.K." It was cold.'}             | ${'"She moved to the UK." It was cold.'}
    ${"'He has a Ph.D.' It took years."}                  | ${"'He has a PhD.' It took years."}
    ${'We live in Europe (mostly the U.S.A.)'}            | ${'We live in Europe (mostly the USA.)'}
  `('keeps the sentence stop: $input', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                                          | expected
    ${'the U.S. government'}                       | ${'the US government'}
    ${'in the U.S., then'}                         | ${'in the US, then'}
    ${'She moved to the U.S.; it was cold.'}       | ${'She moved to the US; it was cold.'}
    ${'She moved to the U.S.\nand then Canada.'}   | ${'She moved to the US\nand then Canada.'}
    ${'She joined the U.S. Army in 2001.'}         | ${'She joined the US Army in 2001.'}
    ${'the U.S. Department of Energy'}             | ${'the US Department of Energy'}
    ${'the U.K. Parliament sat.'}                  | ${'the UK Parliament sat.'}
    ${'the U.S. EPA and the U.K. NHS'}             | ${'the US EPA and the UK NHS'}
    ${'THE U.S. ARMY'}                             | ${'THE US ARMY'}
    ${'the U.S. A-10 fleet'}                       | ${'the US A-10 fleet'}
    ${'She arrived in the U.S. Monday.'}           | ${'She arrived in the US Monday.'}
    ${'She arrived in the U.K. March 5.'}          | ${'She arrived in the UK March 5.'}
    ${'She flew to the U.S. Pacific coast.'}       | ${'She flew to the US Pacific coast.'}
    ${'the U.S. Eastern seaboard'}                 | ${'the US Eastern seaboard'}
    ${'He said "the U.S." and left.'}              | ${'He said "the US" and left.'}
    ${'We met (in the U.K.) and left.'}            | ${'We met (in the UK) and left.'}
    ${'We live in Europe (mostly the U.K.).'}      | ${'We live in Europe (mostly the UK).'}
    ${"the U.S.'s policy"}                         | ${"the US's policy"}
    ${'He has two Ph.D.s.'}                        | ${'He has two PhDs.'}
    ${'U.S.'}                                      | ${'US'}
    ${'- U.S.\n- U.K.'}                            | ${'- US\n- UK'}
  `('needs no sentence stop: $input', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                               | expected
    ${'She moved to the U.K...'}        | ${'She moved to the UK...'}
    ${'He has a Ph.D... or so.'}        | ${'He has a PhD... or so.'}
    ${'She moved to the U.K....'}       | ${'She moved to the UK...'}
  `('keeps the stop that opens an ellipsis, and no other: $input', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  it.each`
    input                        | expected
    ${'She said "hello," then left.'} | ${'She said "hello", then left.'}
    ${'It was "fine."'}          | ${'It was "fine".'}
  `('logical quoting: $input -> $expected', ({ input, expected }) => {
    expect(punctuation(input)).toBe(expected);
  });

  const localise = (input: string, options = {}) => deamericaniseText(input, { preset: 'localise', ...options });

  it.each`
    input                               | expected
    ${"Acme Inc.'s profits rose."}      | ${"Acme Inc.'s profits rose."}
    ${'Acme Inc.’s profits rose.'}      | ${'Acme Inc.’s profits rose.'}
    ${"Acme Co.'s profits rose."}       | ${"Acme Co.'s profits rose."}
    ${"He paused.'Hello,' she said."}   | ${"He paused.'Hello', she said."}
    ${'It was "fine."'}                 | ${'It was "fine".'}
    ${"It was 'fine.'"}                 | ${"It was 'fine'."}
    ${"She said 'hello,' then left."}   | ${"She said 'hello', then left."}
    ${"the U.K.'s policy"}              | ${"the UK's policy"}
  `('takes a quote mark before a letter for no closing quote: $input', ({ input, expected }) => {
    const once = localise(input);
    expect(once).toBe(expected);
    expect(localise(once)).toBe(once);
  });

  it.each`
    input                                              | expected                                           | options
    ${'He said "The color is gray."'}                  | ${'He said "The colour is grey".'}                 | ${{}}
    ${'He said "The color."'}                          | ${'He said "The colour".'}                         | ${{}}
    ${'He said "Buy a cookie."'}                       | ${'He said "Buy a biscuit".'}                      | ${{}}
    ${'The sign said "6 feet."'}                       | ${'The sign said "1.8 metres".'}                   | ${{}}
    ${'He said "I like the color gray," then left.'}   | ${'He said "I like the colour grey", then left.'}  | ${{}}
    ${"He wrote 'organize,' 'color,' and 'gray.'"}     | ${"He wrote 'organise', 'colour', and 'grey'."}    | ${{}}
    ${'"It cost $5M," he said.'}                       | ${'"It cost US$5M", he said.'}                     | ${{ assumeAmerican: true }}
    ${'"It cost 5 dollars," he said.'}                 | ${'"It cost 5 US dollars", he said.'}              | ${{ assumeAmerican: true }}
    ${'"It cost $5 million," he said.'}                | ${'"It cost US$5 million", he said.'}              | ${{ assumeAmerican: true }}
    ${'The sign said "It cost 500 pounds."'}           | ${'The sign said "It cost 500 pounds".'}           | ${{}}
  `('moves the stop and rewrites the word before it in one run: $input', ({ input, expected, options }) => {
    const once = localise(input, options);
    expect(once).toBe(expected);
    expect(localise(once, options)).toBe(once);
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
    ${'17 U.S.C. 105'}   | ${'a longer initialism'}
    ${'Washington, D.C. It is cold.'} | ${'D.C. is not rewritten, so its stop stays'}
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
