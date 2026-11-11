import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

const read = (input: string) => deamericaniseText(input);
const localise = (input: string) => deamericaniseText(input, { preset: 'localise' });

/**
 * The dividing line: `read` fixes what stops a non-American reading the text.
 * `localise` also swaps what the text is about for the local equivalent.
 */
describe('read is the default and keeps the subject matter American', () => {
  it.each`
    input                          | expected                        | why
    ${'The color was gray.'}       | ${'The colour was grey.'}       | ${'spelling is unreadable otherwise'}
    ${'They canceled it.'}         | ${'They cancelled it.'}         | ${'the same'}
    ${'It is 6 feet wide.'}        | ${'It is 1.8 metres wide.'}     | ${'units need converting to mean anything'}
    ${'Bake at 350°F.'}            | ${'Bake at 175°C.'}             | ${'the same'}
    ${'Due 3/14/2024.'}            | ${'Due 2024-03-14.'}            | ${'a date order that means the wrong day'}
    ${'Starts at 3:00 P.M.'}       | ${'Starts at 3:00pm.'}          | ${'the styling, not the clock'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(read(input)).toBe(expected);
  });

  it.each`
    unchanged                        | why
    ${'He walked along the sidewalk.'} | ${'an American article has sidewalks in it'}
    ${'She stopped at the gas station.'} | ${'and gas stations'}
    ${'Add a bell pepper.'}          | ${'the recipe still says bell pepper'}
    ${'In an emergency, call 911.'}  | ${'911 is the right number in America'}
    ${'He is in 5th grade.'}         | ${'an American school year'}
    ${'Print on letter paper.'}      | ${'an American page size'}
    ${'It was cotton candy.'}        | ${'a colloquialism, not a barrier'}
    ${'Mr. Smith called.'}           | ${'house style; nobody misreads it'}
    ${'Filed March 5, 2024.'}        | ${'a named month cannot be misread'}
    ${'the U.S. market'}             | ${'the same'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(read(unchanged)).toBe(unchanged);
  });
});

describe('localise also swaps the content', () => {
  it.each`
    input                                | expected
    ${'He walked along the sidewalk.'}   | ${'He walked along the footpath.'}
    ${'She stopped at the gas station.'} | ${'She stopped at the petrol station.'}
    ${'Add a bell pepper.'}              | ${'Add a capsicum.'}
    ${'In an emergency, call 911.'}      | ${'In an emergency, call 000.'}
    ${'He is in 5th grade.'}             | ${'He is in Year 5.'}
    ${'Print on letter paper.'}          | ${'Print on A4.'}
    ${'It was cotton candy.'}            | ${'It was fairy floss.'}
    ${'Filed March 5, 2024.'}            | ${'Filed 5 March 2024.'}
    ${'Mr. Smith called.'}               | ${'Mr Smith called.'}
    ${'the U.S. market'}                 | ${'the US market'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(localise(input)).toBe(expected);
  });

  it('still does everything read does', () => {
    expect(localise('The color of the sidewalk, 6 feet across.'))
      .toBe('The colour of the footpath, 1.8 metres across.');
  });
});

describe('a category set by hand beats the preset', () => {
  it.each`
    preset          | categories                       | input                  | expected
    ${'read'}       | ${{ vocabulary: true }}          | ${'the sidewalk'}      | ${'the footpath'}
    ${'localise'}   | ${{ vocabulary: false }}         | ${'the sidewalk'}      | ${'the sidewalk'}
    ${'read'}       | ${{ misc: true }}                | ${'print on letter paper'} | ${'print on A4'}
    ${'localise'}   | ${{ units: false }}              | ${'6 feet'}            | ${'6 feet'}
  `('$preset with $categories turns "$input" into "$expected"', ({ preset, categories, input, expected }) => {
    expect(deamericaniseText(input, { preset, categories })).toBe(expected);
  });

  it('can turn a single rule back on without the whole category', () => {
    expect(deamericaniseText('the gas station', { rules: { 'vocabulary.motoring': true } }))
      .toBe('the petrol station');
  });
});

describe('the preset applies to source files too', () => {
  it('leaves vocabulary in comments alone by default', () => {
    expect(deamericaniseText('// the color of the sidewalk', { protectIdentifiers: true }))
      .toBe('// the colour of the sidewalk');
  });
});
