import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

// Vocabulary is the `localise` half of the package, so every case here opts in.
const au = (input: string, options = {}) =>
  deamericaniseText(input, { preset: 'localise', ...options });

describe('everyday vocabulary', () => {
  it.each`
    input                    | expected
    ${'gasoline'}            | ${'petrol'}
    ${'the gas station'}     | ${'the petrol station'}
    ${'the gas pedal'}       | ${'the accelerator'}
    ${'we ran out of gas'}   | ${'we ran out of petrol'}
    ${'the elevator'}        | ${'the lift'}
    ${'a cell phone'}        | ${'a mobile phone'}
    ${'my vacation'}         | ${'my holiday'}
    ${'the movie theater'}   | ${'the cinema'}
    ${'a zip code'}          | ${'a postcode'}
    ${'the drugstore'}       | ${'the chemist'}
    ${'the faucet'}          | ${'the tap'}
    ${'a flashlight'}        | ${'a torch'}
    ${'the garbage can'}     | ${'the rubbish bin'}
    ${'a parking lot'}       | ${'a car park'}
    ${'the windshield'}      | ${'the windscreen'}
    ${'turn signals'}        | ${'indicators'}
    ${'a diaper'}            | ${'a nappy'}
    ${'a stroller'}          | ${'a pram'}
    ${'the closet'}          | ${'the wardrobe'}
    ${'an eraser'}           | ${'a rubber'}
    ${'a sweater'}           | ${'a jumper'}
    ${'french fries'}        | ${'chips'}
    ${'cilantro'}            | ${'coriander'}
    ${'arugula'}             | ${'rocket'}
    ${'ground beef'}         | ${'beef mince'}
    ${'powdered sugar'}      | ${'icing sugar'}
    ${'a shopping cart'}     | ${'a trolley'}
    ${'the railroad'}        | ${'the railway'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('words gated on their context', () => {
  it.each`
    input                          | expected                         | why
    ${'in the fall of 2024'}       | ${'in the autumn of 2024'}        | ${'the season'}
    ${'last fall the team met'}    | ${'last autumn the team met'}     | ${'the season'}
    ${'take out the trash'}        | ${'take out the rubbish'}         | ${'household waste'}
    ${'waiting in line'}           | ${'waiting in the queue'}         | ${'a queue'}
    ${'buying gas'}                | ${'buying petrol'}                | ${'fuel'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                       | why
    ${'prices will fall sharply'}   | ${'the verb'}
    ${'watch it fall'}              | ${'the verb'}
    ${'a gas giant'}                | ${'a state of matter'}
    ${'a gas leak in the mains'}    | ${'natural gas'}
    ${'the noble gas argon'}        | ${'chemistry'}
    ${'a line of code'}             | ${'not a queue'}
    ${'trash talk'}                 | ${'not household waste'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('school years', () => {
  it.each`
    input              | expected
    ${'5th grade'}     | ${'Year 5'}
    ${'1st grade'}     | ${'Year 1'}
    ${'twelfth grade'} | ${'Year 12'}
    ${'grade 3'}       | ${'Year 3'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('vocabulary can be switched off on its own', () => {
  it('leaves words alone but still fixes spelling', () => {
    expect(au('the gasoline color', { categories: { vocabulary: false } }))
      .toBe('the gasoline colour');
  });

  it('is off without the localise preset, which is the default', () => {
    expect(deamericaniseText('the gasoline color')).toBe('the gasoline colour');
  });
});
