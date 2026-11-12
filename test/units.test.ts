import { describe, expect, it } from 'vitest';
import { DIALECTS, analyse, deamericanise, deamericaniseCode, deamericaniseText, resolveOptions } from '../src/index.js';
import type { Change, Options, RuleContext } from '../src/index.js';
import { checkOptions } from '../src/config.js';
import { resolveChanges } from '../src/engine/apply.js';
import { patternRules } from '../src/rules/index.js';
import { spellingEntries } from '../src/rules/spelling/index.js';
import { baseVocabulary } from '../src/rules/vocabulary.js';
import { MEASURES } from '../src/rules/units/definitions.js';
import { FAHRENHEIT } from '../src/rules/units/fahrenheit.js';
import { NUMERIC_PATTERN, parseNumber } from '../src/rules/units/number.js';

const convert = (input: string, options = {}) =>
  deamericaniseText(input, { categories: { spelling: false, vocabulary: false }, ...options });

describe('length', () => {
  it.each`
    input               | expected
    ${'3 inches'}       | ${'7.6 centimetres'}
    ${'1 inch'}         | ${'2.5 centimetres'}
    ${'0.25 inches'}    | ${'6.4 millimetres'}
    ${'12 in.'}         | ${'30 cm'}
    ${'6 feet'}         | ${'1.8 metres'}
    ${'2 feet'}         | ${'61 centimetres'}
    ${'1 foot'}         | ${'30 centimetres'}
    ${'6ft'}            | ${'1.8 m'}
    ${'100 yards'}      | ${'91 metres'}
    ${'1 mile'}         | ${'1.6 kilometres'}
    ${'10 miles'}       | ${'16 kilometres'}
    ${'250 miles'}      | ${'400 kilometres'}
    ${'0.5 miles'}      | ${'800 metres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('feet and inches together', () => {
  it.each`
    input                     | expected
    ${'6 feet 2 inches'}      | ${'1.88 metres'}
    ${`6'2"`}                 | ${'1.88 metres'}
    ${'5 ft 11 in'}           | ${'1.8 metres'}
    ${'6 feet and 2 inches'}  | ${'1.88 metres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                   | expected                       | why
    ${'He stood six feet two inches tall.'} | ${'He stood 1.88 metres tall.'} | ${'both numbers in words'}
    ${'five feet eleven inches'}            | ${'1.8 metres'}                | ${'eleven inches'}
    ${'6 feet two inches'}                  | ${'1.88 metres'}               | ${'the inches in words'}
    ${'six feet 2 inches'}                  | ${'1.88 metres'}               | ${'the feet in words'}
    ${'six feet and two inches'}            | ${'1.88 metres'}               | ${'joined by "and"'}
    ${'six feet two and a half inches'}     | ${'1.89 metres'}               | ${'a fraction in words of an inch'}
    ${'twenty-one feet three inches'}       | ${'6.48 metres'}               | ${'feet in two words'}
    ${'six feet two\ninches'}               | ${'1.88 metres'}               | ${'the inch word on the next line'}
  `('reads a height in words: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                | expected                     | why
    ${'He is six foot two.'}             | ${'He is 1.88 metres.'}      | ${'before a full stop'}
    ${'He is 6 foot 2.'}                 | ${'He is 1.88 metres.'}      | ${'in digits'}
    ${'He is six feet eleven, I think.'} | ${'He is 2.11 metres, I think.'} | ${'before a comma'}
    ${'(six foot one)'}                  | ${'(1.85 metres)'}           | ${'before a bracket'}
    ${'a man six foot two tall'}         | ${'a man 1.88 metres tall'}  | ${'before "tall"'}
    ${'He is six foot two'}              | ${'He is 1.88 metres'}       | ${'at the end of the text'}
    ${'six foot two\n\nNext'}            | ${'1.88 metres\n\nNext'}     | ${'before a blank line'}
    ${'- six foot two\n- next'}          | ${'- 1.88 metres\n- next'}   | ${'before a list item'}
    ${'He is six foot\ntwo.'}            | ${'He is 1.88 metres.'}      | ${'the inches on the next line'}
  `('reads inches with no inch word: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                       | expected                     | why
    ${'6 feet 2 cars'}          | ${'1.8 metres 2 cars'}       | ${'a noun follows the number'}
    ${'six foot two\nboxes'}    | ${'1.8 metres two\nboxes'}   | ${'a word follows on the next line'}
    ${'six foot twelve.'}       | ${'1.8 metres twelve.'}      | ${'twelve is not a number of inches'}
    ${'He is 6 foot 2.5.'}      | ${'He is 1.8 metres 2.5.'}   | ${'nor is a decimal'}
    ${'He is 6 ft 2.'}          | ${'He is 1.8 m 2.'}          | ${'only "foot" or "feet" lets the inch word go'}
    ${'6 feet\n\n2 inches tall'} | ${'1.8 metres\n\n5.1 centimetres tall'} | ${'a blank line ends the height'}
    ${'six feet tall'}          | ${'1.8 metres tall'}         | ${'feet on their own'}
    ${'6 feet 2 inches'}        | ${'1.88 metres'}             | ${'both numbers in digits'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a measurement in two units that ends a range is left whole', () => {
  it.each`
    unchanged                                            | why
    ${'He is 5 - 6 feet 2 inches tall.'}                 | ${'a height after a spaced dash'}
    ${'He is 5 to 6 feet 2 inches tall.'}                | ${'after "to"'}
    ${'between 5 and 6 feet 2 inches'}                   | ${'after "and" in a range'}
    ${'He is 5-6 feet 2 inches tall.'}                   | ${'after a dash written tight'}
    ${'He is five to six feet two inches tall.'}         | ${'a height in words'}
    ${'between five and six feet two inches'}            | ${'a height in words after "and" in a range'}
    ${'five - six feet two inches'}                      | ${'a height in words after a spaced dash'}
    ${'five to 6 feet 2 inches'}                         | ${'a first end in words'}
    ${'He is five to six foot two.'}                     | ${'a height with no inch word'}
    ${'Babies weigh five to seven pounds eight ounces.'} | ${'a weight in words'}
    ${'between five and seven pounds eight ounces'}      | ${'a weight in words after "and" in a range'}
    ${'five to 7 pounds 8 ounces'}                       | ${'a first end in words'}
    ${'five - seven pounds eight ounces'}                | ${'a weight in words after a spaced dash'}
    ${'five-7 pounds 8 ounces'}                          | ${'a first end in words before a dash'}
    ${'two and a half to three pounds eight ounces'}     | ${'a first end with a fraction in words'}
    ${'5 to 7 pounds 8 ounces'}                          | ${'a range in digits'}
  `('leaves "$unchanged" as written ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected                           | why
    ${'seven pounds eight ounces'}                 | ${'3.4 kilograms'}                 | ${'a weight in words on its own'}
    ${'five to seven pounds'}                      | ${'2.3 to 3.2 kilograms'}          | ${'a range in one unit'}
    ${'one hundred and seven pounds eight ounces'} | ${'48.8 kilograms'}                | ${'"and" inside one number'}
    ${'five and seven pounds eight ounces'}        | ${'five and 3.4 kilograms'}        | ${'"and" without "between" joins no range in words'}
    ${'reduce by half to 2 pounds 3 ounces'}       | ${'reduce by half to 992 grams'}   | ${'"half to" is an idiom'}
    ${'6 feet 2 inches to 6 feet 4 inches'}        | ${'1.88 metres to 1.93 metres'}    | ${'a range of two heights'}
    ${'Model 900 - 6 feet 2 inches tall'}          | ${'Model 900 - 1.88 metres tall'}  | ${'a first number that cannot open the range'}
    ${'Model 900 - 7 pounds 8 ounces'}             | ${'Model 900 - 3.4 kilograms'}     | ${'the same, before a weight'}
    ${'5-10 feet'}                                 | ${'1.5-3 metres'}                  | ${'a range in one unit, in digits'}
    ${'6 feet 2 inches (1.88 m)'}                  | ${'1.88 m'}                        | ${'a height before its metric value'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a weight in two units is one weight', () => {
  it.each`
    input                                    | expected
    ${'The baby weighed 7 pounds 8 ounces.'} | ${'The baby weighed 3.4 kilograms.'}
    ${'I weigh 11 stone 4 pounds.'}          | ${'I weigh 71.7 kilograms.'}
    ${'The baby weighed 7 lb 8 oz.'}         | ${'The baby weighed 3.4 kg.'}
    ${'7lbs 8oz'}                            | ${'3.4 kg'}
    ${'11st 4lb'}                            | ${'71.7 kg'}
    ${'11 st 4 lbs'}                         | ${'71.7 kg'}
    ${'7 pounds and 8 ounces'}               | ${'3.4 kilograms'}
    ${'11 stone and 4 pounds'}               | ${'71.7 kilograms'}
    ${'11 stone 4 pounds 8 ounces'}          | ${'71.9 kilograms'}
    ${'11st 4lb 8oz'}                        | ${'71.9 kg'}
    ${'7 pounds 8 1/2 ounces'}               | ${'3.42 kilograms'}
    ${'seven pounds eight ounces'}           | ${'3.4 kilograms'}
    ${'1 lb 2 oz'}                           | ${'510 g'}
    ${'a 7 pound 8 ounce baby'}              | ${'a 3.4 kilogram baby'}
    ${'a 7-pound 8-ounce baby'}              | ${'a 3.4 kilogram baby'}
    ${'an 11 stone 4 pound man'}             | ${'a 71.7 kilogram man'}
    ${'the 7 pounds 8 ounces of flour'}      | ${'the 3.4 kilograms of flour'}
    ${'7 pounds\n8 ounces'}                  | ${'3.4 kilograms'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                       | expected                         | why
    ${'5 pounds'}               | ${'2.3 kilograms'}               | ${'pounds on their own'}
    ${'12 ounces'}              | ${'340 grams'}                   | ${'ounces on their own'}
    ${'6 feet 3 pounds'}        | ${'1.8 metres 1.4 kilograms'}    | ${'two dimensions are two measurements'}
    ${'the 147-pound division'} | ${'the 147-pound division'}      | ${'a weight class'}
    ${'lose the 1st 4 lb'}      | ${'lose the 1st 1.8 kg'}         | ${'1st is an ordinal'}
    ${'the 21st 4 lb'}          | ${'the 21st 1.8 kg'}             | ${'so is 21st'}
    ${'7 pounds\n\n8 ounces'}   | ${'3.2 kilograms\n\n230 grams'}  | ${'a blank line between them'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                | options                     | why
    ${'I weigh 11 stone 4 pounds.'}          | ${{ dialect: 'en-GB' }}     | ${'Britain keeps stone'}
    ${'I weigh 11st 4lb.'}                   | ${{ dialect: 'en-GB' }}     | ${'abbreviated'}
    ${'I weigh 11 stone 4 pounds 8 ounces.'} | ${{ dialect: 'en-GB' }}     | ${'with ounces'}
    ${'I weigh 11 stone.'}                   | ${{ dialect: 'en-GB' }}     | ${'stone on its own'}
    ${'7 pounds 8 ounces'}                   | ${{ unitsKeep: ['pound'] }} | ${'the larger unit is kept'}
    ${'7 pounds 8 ounces'}                   | ${{ unitsKeep: ['ounce'] }} | ${'the smaller unit is kept'}
    ${'11 stone 4 pounds'}                   | ${{ unitsKeep: ['pound'] }} | ${'pounds kept after stone'}
    ${'Babies weigh 7-8 lb 4 oz.'}           | ${{}}                       | ${'the end of a range'}
    ${'between 10 and 11 stone 4 pounds'}    | ${{}}                       | ${'a range joined by and'}
  `('leaves "$unchanged" whole ($why)', ({ unchanged, options }) => {
    expect(convert(unchanged, options)).toBe(unchanged);
  });

  it.each`
    rules
    ${{ 'units.mass.stone': true }}
    ${{ 'units.mass.stone-pounds': true }}
  `('converts stone and pounds in en-GB with $rules', ({ rules }) => {
    expect(convert('I weigh 11 stone 4 pounds.', { dialect: 'en-GB', rules })).toBe(
      'I weigh 71.7 kilograms.',
    );
  });

  it('converts pounds and ounces in en-GB, which keeps only stone', () => {
    expect(convert('7 pounds 8 ounces', { dialect: 'en-GB' })).toBe('3.4 kilograms');
  });

  it('keeps the original and collapses a metric restatement', () => {
    expect(convert('7 pounds 8 ounces', { units: { keepOriginal: true } })).toBe(
      '3.4 kilograms (7 pounds 8 ounces)',
    );
    expect(convert('7 lb 8 oz (3.4 kg)')).toBe('3.4 kg');
  });
});

describe('a measurement in two units reads its first number whole', () => {
  it.each`
    input                                      | expected                          | why
    ${'1 1/2 pounds 3 ounces'}                 | ${'765 grams'}                    | ${'a mixed number'}
    ${'1/2 pounds 3 ounces'}                   | ${'312 grams'}                    | ${'a fraction'}
    ${'2.7 pounds 3 ounces'}                   | ${'1.31 kilograms'}               | ${'a decimal'}
    ${'1½ pounds 3 ounces'}                    | ${'765 grams'}                    | ${'a vulgar fraction after a whole number'}
    ${'½ pound 3 ounces'}                      | ${'312 grams'}                    | ${'a vulgar fraction'}
    ${'1/2 stone 3 pounds'}                    | ${'4.54 kilograms'}               | ${'a fraction of a stone'}
    ${'1/2 feet 3 inches'}                     | ${'22.9 centimetres'}             | ${'a fraction of a foot'}
    ${'1 1/2 feet 3 inches'}                   | ${'53.3 centimetres'}             | ${'a mixed number of feet'}
    ${'2.5 feet 3 inches'}                     | ${'83.8 centimetres'}             | ${'a decimal number of feet'}
    ${'-2 pounds 3 ounces'}                    | ${'-992 grams'}                   | ${'a minus before the whole weight'}
    ${'Bought 2024-03-14 1/2 pounds 3 ounces'} | ${'Bought 2024-03-14 312 grams'}  | ${'a fraction after a date'}
    ${'7 pounds 8 ounces'}                     | ${'3.4 kilograms'}                | ${'a whole number of pounds'}
    ${'6 feet 2 inches'}                       | ${'1.88 metres'}                  | ${'a whole number of feet'}
    ${'1 1/2 pounds'}                          | ${'680 grams'}                    | ${'a mixed number on its own'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                    | why
    ${'1/0 pounds 3 ounces'}     | ${'a first part that is not finite'}
    ${'1 1/0 pounds 3 ounces'}   | ${'a mixed first part that is not finite'}
    ${'1/0 feet 3 inches'}       | ${'feet that are not finite'}
    ${'5 feet 1/0 inches'}       | ${'inches that are not finite'}
    ${'7 pounds 1/0 ounces'}     | ${'ounces that are not finite'}
    ${'1,5 pounds 3 ounces'}     | ${'the tail of a grouped number'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a long run of whitespace takes time in line with its length', () => {
  // Generous, since each of these takes a few milliseconds. A pattern that walks the run from
  // every place in it, or tries every split of it, takes several seconds.
  const LIMIT_MS = 1000;

  it.each`
    before                         | name          | run     | length   | after                      | expected
    ${'A 7 pound 8 ounce baby.'}   | ${'spaces'}   | ${' '}  | ${3000}  | ${'The color.'}            | ${'A 3.4 kilogram baby.'}
    ${'A 7 pound 8 ounce baby.'}   | ${'tabs'}     | ${'\t'} | ${3000}  | ${'The color.'}            | ${'A 3.4 kilogram baby.'}
    ${'A 7 pound 8 ounce baby.'}   | ${'newlines'} | ${'\n'} | ${12000} | ${'The color.'}            | ${'A 3.4 kilogram baby.'}
    ${'A 7 pound 8 ounce baby.'}   | ${'spaces'}   | ${' '}  | ${3000}  | ${'5 feet'}                | ${'A 3.4 kilogram baby.'}
    ${'A 7 pound 8 ounce baby.'}   | ${'spaces'}   | ${' '}  | ${3000}  | ${'half a mile'}           | ${'A 3.4 kilogram baby.'}
    ${'A 7 pound 8 ounce baby.'}   | ${'spaces'}   | ${' '}  | ${3000}  | ${'seven pounds 8 ounces'} | ${'A 3.4 kilogram baby.'}
    ${'He is six foot two'}        | ${'spaces'}   | ${' '}  | ${3000}  | ${'tall.'}                 | ${'He is 1.88 metres'}
    ${'He is six foot two'}        | ${'spaces'}   | ${' '}  | ${3000}  | ${'The color.'}            | ${'He is 1.8 metres two'}
    ${'Weigh five to'}             | ${'spaces'}   | ${' '}  | ${3000}  | ${'seven pounds 8 ounces'} | ${'Weigh five to'}
    ${'It weighs 7 pounds'}        | ${'spaces'}   | ${' '}  | ${3000}  | ${'The color.'}            | ${'It weighs 3.2 kilograms'}
    ${'It is 5'}                   | ${'spaces'}   | ${' '}  | ${30000} | ${'The color.'}            | ${'It is 5'}
  `('"$before", $length $name, then "$after"', ({ before, run, length, after, expected }) => {
    const text = (n: number) => `${before}${run.repeat(n)}${after}`;
    convert(text(1));
    const started = performance.now();
    const output = convert(text(length));
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
    expect(output.startsWith(expected)).toBe(true);
  });
});

describe('mass and volume', () => {
  it.each`
    input                | expected
    ${'5 pounds'}        | ${'2.3 kilograms'}
    ${'180 lbs'}         | ${'82 kg'}
    ${'1 pound'}         | ${'450 grams'}
    ${'12 ounces'}       | ${'340 grams'}
    ${'2 oz'}            | ${'57 g'}
    ${'1 ton'}           | ${'910 kilograms'}
    ${'1 gallon'}        | ${'3.8 litres'}
    ${'5 gallons'}       | ${'19 litres'}
    ${'1 quart'}         | ${'950 millilitres'}
    ${'8 fluid ounces'}  | ${'240 millilitres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('temperature', () => {
  it.each`
    input                       | expected                | why
    ${'350°F'}                  | ${'175°C'}              | ${'oven temperatures round to fives'}
    ${'400 °F'}                 | ${'205°C'}              | ${'same'}
    ${'98.6°F'}                 | ${'37°C'}               | ${'body temperature'}
    ${'32°F'}                   | ${'0°C'}                | ${'freezing'}
    ${'-40°F'}                  | ${'-40°C'}              | ${'the scales cross here'}
    ${'72 degrees Fahrenheit'}  | ${'22.2 degrees Celsius'} | ${'spelled out stays spelled out'}
    ${'100 degrees F'}          | ${'37.8 degrees Celsius'} | ${'same'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('temperature differences', () => {
  it.each`
    input                                             | expected                                          | why
    ${'The temperature dropped 20°F overnight.'}      | ${'The temperature dropped 11°C overnight.'}      | ${'a verb of change before it'}
    ${'It will be 10°F warmer than yesterday.'}       | ${'It will be 5.6°C warmer than yesterday.'}      | ${'a comparative after it'}
    ${'Temperatures rose by 15 degrees F.'}           | ${'Temperatures rose by 8.3 degrees Celsius.'}    | ${'by, and spelled out stays spelled out'}
    ${'Preheat to 350°F, then lower it by 25°F.'}     | ${'Preheat to 175°C, then lower it by 14°C.'}     | ${'a difference is not an oven setting'}
    ${'10°F below freezing'}                          | ${'5.6°C below freezing'}                         | ${'measured from freezing'}
    ${'Highs will run 5°F above normal.'}             | ${'Highs will run 2.8°C above normal.'}           | ${'measured from normal'}
    ${'a 30°F swing in a day'}                        | ${'a 17°C swing in a day'}                        | ${'a noun of change after it'}
    ${'a 10°F temperature drop'}                      | ${'a 5.6°C temperature drop'}                     | ${'the same, with temperature between'}
    ${'a drop of 20°F'}                               | ${'a drop of 11°C'}                               | ${'a noun of change before it'}
    ${'It is up 5°F on yesterday.'}                   | ${'It is up 2.8°C on yesterday.'}                 | ${'up'}
    ${'Temperatures dropped nearly 20°F.'}            | ${'Temperatures dropped nearly 11°C.'}            | ${'a hedge between the verb and the number'}
    ${'It rose 1.8 degrees F.'}                       | ${'It rose 1 degree Celsius.'}                    | ${'one degree is singular'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                             | expected                                          | why
    ${'It was 10°F below zero.'}                      | ${'It was -23.3°C.'}                              | ${'below zero is a negative temperature'}
    ${'It was 10 degrees F below zero.'}              | ${'It was -23.3 degrees Celsius.'}                | ${'the same, spelled out'}
    ${'It was 10°F above zero.'}                      | ${'It was -12.2°C.'}                              | ${'above zero is the temperature itself'}
    ${'It fell to 20°F.'}                             | ${'It fell to -6.7°C.'}                           | ${'to names the new temperature'}
    ${'It rose from 50°F to 70°F.'}                   | ${'It rose from 10°C to 21.1°C.'}                 | ${'so does from'}
    ${'It climbed to 100°F.'}                         | ${'It climbed to 37.8°C.'}                        | ${'the same'}
    ${'Temperatures up to 100°F.'}                    | ${'Temperatures up to 37.8°C.'}                   | ${'up to is a ceiling'}
    ${'Store below 40°F.'}                            | ${'Store below 4.4°C.'}                           | ${'below before the number is a threshold'}
    ${'Keep it above 90°F.'}                          | ${'Keep it above 32.2°C.'}                        | ${'so is above'}
    ${'It dropped 20°F to 40°F.'}                     | ${'It dropped 11°C to 4.4°C.'}                    | ${'one of each'}
    ${'a warm 80°F day'}                              | ${'a warm 26.7°C day'}                            | ${'warm describes the day'}
    ${'Temperatures rose 20°F (11°C) in an hour.'}    | ${'Temperatures rose 11°C in an hour.'}           | ${'the author figure stays'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('gives the same answer whatever the verdict', () => {
    const input = 'The temperature dropped 20°F overnight.';
    expect(convert(input, { assumeAmerican: true })).toBe(convert(input, { assumeAmerican: false }));
  });

  it('tags a difference with its own rule', () => {
    const { changes } = deamericanise('Preheat to 350°F, then lower it by 25°F.');
    expect(changes.map((c) => [c.after, c.ruleId])).toEqual([
      ['175°C', 'units.temperature.fahrenheit'],
      ['14°C', 'units.temperature.difference'],
    ]);
  });

  it.each`
    rule                              | expected
    ${'units.temperature.difference'} | ${'Preheat to 175°C, then lower it by 25°F.'}
    ${'units.temperature.fahrenheit'} | ${'Preheat to 350°F, then lower it by 14°C.'}
  `('switches $rule off without touching the other', ({ rule, expected }) => {
    expect(convert('Preheat to 350°F, then lower it by 25°F.', { rules: { [rule]: false } })).toBe(
      expected,
    );
  });

  it.each`
    options                            | expected
    ${{ precision: 'exact' }}          | ${'dropped 11.111111°C'}
    ${{ precision: 1 }}                | ${'dropped 11.1°C'}
    ${{ keepOriginal: true }}          | ${'dropped 11°C (20°F)'}
  `('honours $options', ({ options, expected }) => {
    expect(convert('dropped 20°F', { units: options })).toBe(expected);
  });
});

describe('a change in temperature beside its Celsius value', () => {
  it.each`
    input                                     | expected                         | why
    ${'It was 20°F (11°C) warmer.'}           | ${'It was 11°C warmer.'}         | ${'the comparative past a bracket'}
    ${'It was 20°F/11°C warmer.'}             | ${'It was 11°C warmer.'}         | ${'past a slash'}
    ${'It was 20°F or 11°C warmer.'}          | ${'It was 11°C warmer.'}         | ${'past or'}
    ${'a 30°F (17°C) swing in a day'}         | ${'a 17°C swing in a day'}       | ${'a noun of change past a bracket'}
    ${'a 10-15°F (5.6-8.3°C) drop'}           | ${'a 5.6-8.3°C drop'}            | ${'a range'}
    ${'Highs will run 5°F (3°C) above normal.'} | ${'Highs will run 3°C above normal.'} | ${'a distance from a norm'}
    ${'It dropped 20°F (11°C).'}              | ${'It dropped 11°C.'}            | ${'the verb beside the Fahrenheit value'}
    ${'It was 20°F warmer.'}                  | ${'It was 11°C warmer.'}         | ${'no Celsius value'}
    ${'The pond fell to 20°F overnight.'}     | ${'The pond fell to -6.7°C overnight.'} | ${'to names a temperature'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                           | why
    ${'It rose 11°C or 20°F.'}          | ${'the verb before a Celsius value joined by or'}
    ${'It rose by 11°C/20°F.'}          | ${'by before a Celsius value joined by a slash'}
    ${'a drop of 11°C or 20°F'}         | ${'a noun of change before the pair'}
    ${'It was 11°C (20°F) warmer.'}     | ${'the Fahrenheit value restates the Celsius one'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('tags a change past its Celsius value with the difference rule', () => {
    const { changes } = deamericanise('It was 20°F (11°C) warmer.');
    expect(changes.map((c) => c.ruleId)).toEqual(['units.temperature.difference']);
  });
});

describe('Fahrenheit ranges', () => {
  it.each`
    input                                             | expected                                          | why
    ${'Bake at 350-375°F.'}                           | ${'Bake at 175-190°C.'}                           | ${'an oven range lands on fives'}
    ${'Bake at 350 to 375°F.'}                        | ${'Bake at 175 to 190°C.'}                        | ${'to'}
    ${'Bake at 350–375°F.'}                           | ${'Bake at 175–190°C.'}                           | ${'the author dash is kept'}
    ${'between 60 and 70°F'}                          | ${'between 16 and 21°C'}                          | ${'and, after between'}
    ${'between 60 and 70 degrees Fahrenheit'}         | ${'between 16 and 21 degrees Celsius'}            | ${'spelled out stays spelled out'}
    ${'Normal is 98-99°F.'}                           | ${'Normal is 36.7-37.2°C.'}                       | ${'the ends never collapse into one'}
    ${'from -10 to 5°F'}                              | ${'from -23 to -15°C'}                            | ${'a negative end'}
    ${'Bake at 350°F to 375°F.'}                      | ${'Bake at 175°C to 190°C.'}                      | ${'both ends marked'}
    ${'a 10-15°F drop'}                               | ${'a 5.6-8.3°C drop'}                             | ${'a range that is also a difference'}
    ${'Temperatures fell 10 to 15°F.'}                | ${'Temperatures fell 5.6 to 8.3°C.'}              | ${'the same, from the verb'}
    ${'10 to 20°F below zero'}                        | ${'-23 to -29°C'}                                 | ${'both ends below zero'}
    ${'Gas mark 4 and 350°F are the same heat.'}      | ${'Gas mark 4 and 175°C are the same heat.'}      | ${'and without between is not a range'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('keeps the original range', () => {
    expect(convert('Bake at 350-375°F.', { units: { keepOriginal: true } })).toBe(
      'Bake at 175-190°C (350-375°F).',
    );
  });

  it('takes the author figure for a range', () => {
    expect(convert('Bake at 350-375°F (175-190°C).')).toBe('Bake at 175-190°C.');
  });

  it.each`
    input                                  | expected                                 | why
    ${'Room 13\n- 0°F overnight'}          | ${'Room 13\n- -17.8°C overnight'}        | ${'a list item is not the dash of a range'}
    ${'Room 13\n\n- 0°F overnight'}        | ${'Room 13\n\n- -17.8°C overnight'}      | ${'nor across a blank line'}
    ${'Room 13\n\nto 0°F overnight'}       | ${'Room 13\n\nto -17.8°C overnight'}     | ${'to after a blank line'}
    ${'Lows between 60\n\nand 70°F'}       | ${'Lows between 60\n\nand 21.1°C'}       | ${'and after a blank line'}
    ${'Highs of 70\nto 80°F'}              | ${'Highs of 21\nto 27°C'}                | ${'a line break that only wraps the paragraph'}
    ${'Highs between 60\nand 70°F'}        | ${'Highs between 16\nand 21°C'}          | ${'the same, joined by and'}
    ${'Highs between\n60 and 70°F'}        | ${'Highs between\n16 and 21°C'}          | ${'the same, after between'}
    ${'350-375°F'}                         | ${'175-190°C'}                           | ${'a range written tight'}
  `('stops a range at a new block: $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('Fahrenheit written as a bare F', () => {
  it.each`
    input                                       | expected                                    | why
    ${'Cook until the chicken reaches 165F.'}   | ${'Cook until the chicken reaches 73.9°C.'} | ${'glued to the number'}
    ${'Bake at 350 F for 20 minutes.'}          | ${'Bake at 175°C for 20 minutes.'}          | ${'after a space'}
    ${'Roast at 425F until golden.'}            | ${'Roast at 220°C until golden.'}           | ${'an oven setting lands on fives'}
    ${'Highs of 95F are forecast.'}             | ${'Highs of 35°C are forecast.'}            | ${'two figures, in a forecast'}
    ${'A fever of 102.5F needs a doctor.'}      | ${'A fever of 39.2°C needs a doctor.'}      | ${'a decimal'}
    ${'Overnight lows of -10F.'}                | ${'Overnight lows of -23.3°C.'}             | ${'a negative'}
    ${'Bake at 350-375F.'}                      | ${'Bake at 175-190°C.'}                     | ${'a range'}
    ${'Bake at 350F-375F.'}                     | ${'Bake at 175°C-190°C.'}                   | ${'a range with both ends marked'}
    ${'Set the oven to 350F/gas 4.'}            | ${'Set the oven to 175°C/gas 4.'}           | ${'beside a gas mark'}
    ${'Turn the heat down by 25F.'}             | ${'Turn the heat down by 14°C.'}            | ${'a difference'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                              | why
    ${'Apartment 3F'}                                      | ${'a flat'}
    ${'Apartment 3F has no heat.'}                         | ${'one figure, even in a sentence about heat'}
    ${'The heating on floor 5F is broken.'}                | ${'a floor'}
    ${'I sat in seat 23F.'}                                | ${'a seat, with no word about heat'}
    ${'She wears a 34F.'}                                  | ${'a size'}
    ${'The Boeing 777F carries 102 tonnes.'}               | ${'a model'}
    ${'Ford recalled the 2024 F-150 after heat damage.'}   | ${'a name after a year'}
    ${'The heat map uses #1F1F1F and #33F.'}               | ${'hex colours'}
    ${'Mask the byte with 0x1F before heating.'}           | ${'a hex literal'}
    ${'Sketch with a 2F pencil.'}                          | ${'a pencil grade'}
    ${'Bake part B4F.'}                                    | ${'a part number'}
    ${'// 3F ends the header before the oven data'}        | ${'a hex byte in a code comment'}
    ${'The A330-200F flies in hot weather.'}               | ${'a hyphenated designation'}
    ${'Cook it at 350 f.'}                                 | ${'a lower case f'}
    ${'Scale it by 100f before baking.'}                   | ${'a float literal'}
    ${'Preheat the oven to 180C/350F/gas 4.'}              | ${'the courtesy figure after Celsius'}
    ${'Bake at 350F (180C).'}                              | ${'the courtesy figure before Celsius'}
    ${'It was 75F today.'}                                 | ${'no word about heat in the sentence'}
    ${'Bake well.\nApartment 3F'}                          | ${'the word about heat is in another sentence'}
    ${'Row 350F'}                                          | ${'nothing about heat at all'}
    ${'Preheat the oven. Mr. Smith set it to 350F.'}       | ${'a title opens a sentence of its own'}
    ${'Preheat the oven\n\nRow 350F'}                      | ${'a blank line ends the sentence'}
    ${'Preheat the oven\n- Row 350F'}                      | ${'so does a list item'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                              | expected
    ${'Cook until the chicken reaches 165°F.'}         | ${'Cook until the chicken reaches 73.9°C.'}
    ${'Cook until the chicken reaches 165 degrees F.'} | ${'Cook until the chicken reaches 73.9 degrees Celsius.'}
    ${'Bake at 350 deg F.'}                            | ${'Bake at 175°C.'}
    ${'It was 70℉ out.'}                               | ${'It was 21.1°C out.'}
    ${'It was 10 °F out.'}                             | ${'It was -12.2°C out.'}
  `('converts the written unit in $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('runs twice on a kept original without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('Cook until the chicken reaches 165F.', options);
    expect(once).toBe('Cook until the chicken reaches 73.9°C (165F).');
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    input                                   | expected                                  | why
    ${'Bake for 10 min. at 350F.'}          | ${'Bake for 10 min. at 175°C.'}           | ${'an abbreviation before a word in lower case'}
    ${'Heat it to max. 450F.'}              | ${'Heat it to max. 230°C.'}               | ${'an abbreviation before a number'}
    ${'Temperatures at 6 p.m. were 10F.'}   | ${'Temperatures at 6pm were -12.2°C.'}    | ${'the stops of a time'}
    ${'Temperatures fell to 10F by 6 p.m.'} | ${'Temperatures fell to -12.2°C by 6pm.'} | ${'a time that ends the sentence'}
    ${'Preheat, said Mr. Smith, to 350F.'}  | ${'Preheat, said Mr. Smith, to 175°C.'}   | ${'a title before a name'}
    ${'Bake it the U.S. Army way at 350F.'} | ${'Bake it the U.S. Army way at 175°C.'}  | ${'an initialism before a name'}
    ${'Preheat the oven\nto 350F.'}         | ${'Preheat the oven\nto 175°C.'}          | ${'a line break that only wraps the paragraph'}
  `('reads the whole sentence past $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('stops at a time that ends the sentence before another', () => {
    expect(convert('Bake it at 6 p.m. Row 35F was empty.')).toBe('Bake it at 6pm. Row 35F was empty.');
  });

  it.each`
    input                                                 | expected
    ${'Temperatures at 6 p.m. were 10F.'}                 | ${'Temperatures at 6pm were -12.2°C.'}
    ${'Preheat, said Mr. Smith, to 350F.'}                | ${'Preheat, said Mr Smith, to 175°C.'}
    ${'Bake it the U.S. Army way at 350F.'}               | ${'Bake it the US Army way at 175°C.'}
    ${'At 20C by 6 p.m. Temperatures hit 50F.'}           | ${'At 20C by 6pm. Temperatures hit 10°C.'}
    ${'Put the cookie sheet in at 350F.'}                 | ${'Put the baking tray in at 175°C.'}
    ${'Put the baking tray in at 350F.'}                  | ${'Put the baking tray in at 175°C.'}
  `('decides $input on the first run as the second would', ({ input, expected }) => {
    const once = deamericaniseText(input, { preset: 'localise' });
    expect(once).toBe(expected);
    expect(deamericaniseText(once, { preset: 'localise' })).toBe(once);
  });

  it('keeps a sentence that opens with a number in words, which a unit rule writes in figures', () => {
    const once = convert('The heat was bad. Two feet of snow fell at 35F.');
    expect(once).toMatch(/fell at 1\.7°C\.$/);
    expect(convert(once)).toBe(once);
  });

  it.each`
    input                                       | expected
    ${'Put the cookie sheet in at 350F.'}       | ${'Put the cookie sheet in at 175°C.'}
    ${'Slide it under the broiler at 450F.'}    | ${'Slide it under the broiler at 230°C.'}
    ${'Set the skillet on the burner at 350F.'} | ${'Set the skillet on the burner at 175°C.'}
  `('reads an American word about heat in $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads every word the lexicon rewrites into one about heat as about heat itself', () => {
    const lexicon = [
      ...spellingEntries(),
      ...baseVocabulary(),
      ...Object.values(DIALECTS).flatMap((pack) => pack.vocabulary),
    ];
    const aboutHeat = (word: string) => convert(`Set the ${word} at 350F.`).endsWith('175°C.');
    const missed = lexicon.filter((entry) => aboutHeat(entry.to) && !aboutHeat(entry.from));
    expect(missed.map((entry) => entry.from)).toEqual([]);
  });
});

describe('Fahrenheit written with another degree sign, or none', () => {
  it.each`
    input                                   | expected                          | why
    ${'Bake at 350ºF.'}                     | ${'Bake at 175°C.'}               | ${'the masculine ordinal for the degree sign'}
    ${'Bake at 350˚F.'}                     | ${'Bake at 175°C.'}               | ${'the ring above'}
    ${'Bake at 350 º F.'}                   | ${'Bake at 175°C.'}               | ${'spaced'}
    ${'It was 95º Fahrenheit.'}             | ${'It was 35°C.'}                 | ${'before the word'}
    ${'It was 95 Fahrenheit.'}              | ${'It was 35°C.'}                 | ${'the word with no sign'}
    ${'It was 95 fahrenheit.'}              | ${'It was 35°C.'}                 | ${'in lower case'}
    ${'Bake at 350-375 Fahrenheit.'}        | ${'Bake at 175-190°C.'}           | ${'a range'}
    ${'It rose 20 Fahrenheit.'}             | ${'It rose 11°C.'}                | ${'a change'}
    ${'It was 95 Fahrenheit\n\n2. Rest.'}   | ${'It was 35°C\n\n2. Rest.'}      | ${'a list item past a blank line is no title'}
    ${'It was 72 degrees Fahrenheit.'}      | ${'It was 22.2 degrees Celsius.'} | ${'spelled out stays spelled out'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                                | why
    ${'I read Fahrenheit 451 last year.'}                    | ${'a title'}
    ${'They filmed the 1966 Fahrenheit 451 in England.'}     | ${'a title after a year'}
    ${'In 1724 Fahrenheit proposed his scale.'}              | ${'the man, after a year'}
    ${'Set the 2 Fahrenheit thermometers aside.'}            | ${'a count of thermometers'}
    ${'It was 95\nFahrenheit is the scale they use.'}        | ${'the word on the next line'}
    ${'Quedó en 1º lugar.'}                                  | ${'an ordinal with no F'}
    ${'Es el nº 5.'}                                         | ${'the same'}
    ${'Ford trucks from the 70s F series'}                   | ${'no temperature'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                       | expected
    ${'Bake at 350ºF (175ºC).'}                 | ${'Bake at 175ºC.'}
    ${'Bake at 350˚F/175˚C.'}                   | ${'Bake at 175˚C.'}
    ${'Bake at 350 Fahrenheit (175 Celsius).'}  | ${'Bake at 175 Celsius.'}
    ${'Bake at 350°F (180°Celsius).'}           | ${'Bake at 180°Celsius.'}
    ${'Bake at 175ºC (350ºF).'}                 | ${'Bake at 175ºC (350ºF).'}
    ${'Heat to 180˚C or 350˚F.'}                | ${'Heat to 180˚C or 350˚F.'}
    ${'Bake at 175 Celsius (350 Fahrenheit).'}  | ${'Bake at 175 Celsius (350 Fahrenheit).'}
  `('reads the Celsius value beside it in the same forms: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each(['Bake at 350ºF.', 'It was 95 Fahrenheit.', 'It was 95º Fahrenheit.'])(
    'runs twice on a kept original of %j without converting it again',
    (input) => {
      const options = { units: { keepOriginal: true } };
      const once = convert(input, options);
      expect(once).not.toBe(input);
      expect(convert(once, options)).toBe(once);
    },
  );
});

describe('speed, power and economy', () => {
  it.each`
    input                | expected
    ${'60 mph'}          | ${'97 km/h'}
    ${'55 miles per hour'} | ${'89 kilometres per hour'}
    ${'30 mpg'}          | ${'7.8 L/100km'}
    ${'300 horsepower'}  | ${'220 kilowatts'}
    ${'32 psi'}          | ${'220 kPa'}
    ${'10 acres'}        | ${'4 hectares'}
    ${'2000 square feet'} | ${'190 square metres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('fractions and ranges', () => {
  it.each`
    input                  | expected
    ${'1/2 gallon'}        | ${'1.9 litres'}
    ${'2½ inches'}         | ${'6.4 centimetres'}
    ${'5-10 feet'}         | ${'1.5-3 metres'}
    ${'5 to 10 miles'}     | ${'8 to 16 kilometres'}
    ${'between 5 and 10 miles'} | ${'between 8 and 16 kilometres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a number that is not finite', () => {
  it.each`
    unchanged
    ${'It is 5/0 inches.'}
    ${'a 1/0 mile walk'}
    ${'0/0 feet'}
    ${'1 1/0 miles'}
    ${'1/0-2 inches'}
    ${'1/0 x 2 feet'}
    ${'5 feet 1/0 inches'}
    ${'7 pounds 1/0 ounces'}
  `('leaves "$unchanged" alone', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input              | expected
    ${'1/2 inch'}      | ${'1.3 centimetres'}
    ${'0 inches'}      | ${'0 millimetres'}
    ${'1 1/2 miles'}   | ${'2.4 kilometres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each(['5/0', '-5/0', '0/0', '1 1/0'])('reads "%s" as no number', (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });

  it('never writes NaN or Infinity in any unit', () => {
    const rules = Object.fromEntries(MEASURES.map((m) => [m.id, true]));
    const options = { assumeAmerican: true, rules, units: { respectConventions: false } };
    const shapes = ['5/0', '0/0', '1 1/0', '1/0-2', '2 to 1/0', '1/0 x 2', '2 x 3 x 1/0'];
    const written: string[] = [];
    for (const unit of MEASURES.flatMap((m) => [...m.words, ...m.abbrevs])) {
      for (const shape of shapes) {
        for (const change of deamericanise(`It is ${shape} ${unit} long.`, options).changes) {
          if (/NaN|Infinity/.test(change.after)) written.push(`${change.before} -> ${change.after}`);
        }
      }
    }
    expect(written).toEqual([]);
  });
});

describe('a range opens only on a number that can be its first end', () => {
  it.each`
    input                                    | expected                                    | why
    ${'In 2024 - 5 feet of snow fell.'}      | ${'In 2024 - 1.5 metres of snow fell.'}     | ${'a year more than ten times the second number'}
    ${'In 2024 to 5 feet of snow fell.'}     | ${'In 2024 to 1.5 metres of snow fell.'}    | ${'the same, joined by "to"'}
    ${'Since 1999 - 50°F has been normal.'}  | ${'Since 1999 - 10°C has been normal.'}     | ${'the same, before a temperature'}
    ${'£5 - 10 inches long.'}                | ${'£5 - 25 centimetres long.'}              | ${'a price'}
    ${'It cost $1,005 - 10 feet of cable.'}  | ${'It cost $1,005 - 3 metres of cable.'}    | ${'the tail of a price grouped with a comma'}
    ${'2024-01-13 - 0°F'}                    | ${'2024-01-13 - -17.8°C'}                   | ${'the day of an ISO date'}
    ${'2024-01-13 - 5 feet'}                 | ${'2024-01-13 - 1.5 metres'}                | ${'the same, before a length'}
    ${'On 13/4/2024 - 1 inch fell.'}         | ${'On 13/4/2024 - 2.5 centimetres fell.'}   | ${'the year of a numeric date'}
    ${'At 6:00 - 50°F and sunny.'}           | ${'At 6:00 - 10°C and sunny.'}              | ${'the minutes of a time'}
  `('converts the second number alone after $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves a price before a range to the currency rule', () => {
    expect(convert('Price $5 - 10 inches long.', { assumeAmerican: true })).toBe(
      'Price US$5 - 25 centimetres long.',
    );
  });

  it.each`
    unchanged           | why
    ${'$5-10 feet'}     | ${'a price range written tight'}
    ${'In 2024-5 feet'} | ${'a span of years written tight'}
    ${'20-3/2 inch'}    | ${'a fraction straight after a dash, once its range is refused'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                     | expected                                      | why
    ${'5-10 feet'}                            | ${'1.5-3 metres'}                             | ${'a range'}
    ${'5 - 10 feet'}                          | ${'1.5-3 metres'}                             | ${'with a spaced dash'}
    ${'50-60°F'}                              | ${'10-16°C'}                                  | ${'a temperature range'}
    ${'between 60 and 70°F'}                  | ${'between 16 and 21°C'}                      | ${'joined by "and"'}
    ${'The water dropped from 10 to 5 feet.'} | ${'The water dropped from 3 to 1.5 metres.'}  | ${'a falling range'}
    ${'100-10 feet'}                          | ${'30-3 metres'}                              | ${'a first number exactly ten times the second'}
    ${'Visibility fell from 10 to 0.5 miles.'} | ${'Visibility fell from 16,000 to 800 metres.'} | ${'a steeper fall opened by "from"'}
    ${'Temperatures fell from 50 to 4°F.'}    | ${'Temperatures fell from 10 to -16°C.'}      | ${'the same, in Fahrenheit'}
    ${'between 30 and 2 feet'}                | ${'between 910 and 61 centimetres'}           | ${'the same, opened by "between"'}
    ${'from -50 to 2°F'}                      | ${'from -46 to -17°C'}                        | ${'a negative first number'}
    ${'Lows of 10 to 0°F tonight.'}           | ${'Lows of -12 to -18°C tonight.'}            | ${'a second number of zero'}
    ${'Bought 2024-03-14 1/2 gallon'}         | ${'Bought 2024-03-14 1.9 litres'}             | ${'a fraction after a date'}
  `('still converts $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts a fraction after a numeric date it rewrites', () => {
    expect(convert('Bought 3/14/2024 1/2 gallon', { assumeAmerican: true })).toBe(
      'Bought 2024-03-14 1.9 litres',
    );
  });
});

describe('the year of a written-out date is not a measurement', () => {
  const localise = { preset: 'localise' } as const;

  it.each`
    input                                  | expected                                    | why
    ${'Oct 22, 2024 1/2 inch long'}        | ${'22 October 2024 1.3 centimetres long'}   | ${'a fraction after a date it rewrites'}
    ${'22 October 2024 1/2 inch long'}     | ${'22 October 2024 1.3 centimetres long'}   | ${'a fraction after a date written day first'}
    ${'22nd October 2024 1/2 inch long'}   | ${'22nd October 2024 1.3 centimetres long'} | ${'a day written as an ordinal'}
    ${'October 22, 1850 1/2 inch long'}    | ${'October 22, 1850 1.3 centimetres long'}  | ${'a year the date rule leaves'}
    ${'March 13, 2024 - 250 feet'}         | ${'13 March 2024 - 76 metres'}              | ${'a range after a date it rewrites'}
    ${'13 March 2024 - 250 feet'}          | ${'13 March 2024 - 76 metres'}              | ${'a range after a date written day first'}
    ${'Oct. 22nd, 2024 - 250 feet'}        | ${'22 October 2024 - 76 metres'}            | ${'an abbreviated month with a stop'}
    ${'13 march 2024 - 250 feet'}          | ${'13 march 2024 - 76 metres'}              | ${'a month in lower case'}
    ${'22 October 2024 - 350°F'}           | ${'22 October 2024 - 175°C'}                | ${'a temperature range'}
    ${'In May 2024 1/2 inch of rain fell.'}  | ${'In May 2024 1.3 centimetres of rain fell.'} | ${'a fraction after a bare month and year'}
    ${'By March 2024 1/2 gallon cost more.'} | ${'By March 2024 1.9 litres cost more.'}       | ${'the same, before a volume'}
    ${'June 2024 - 250 feet of snow fell.'}  | ${'June 2024 - 76 metres of snow fell.'}       | ${'a range after a bare month and year'}
    ${'Oct. 2024 - 250 feet'}                | ${'Oct. 2024 - 76 metres'}                     | ${'the same, with an abbreviated month'}
    ${'October 22 2024 1/2 inch long'}       | ${'October 22 2024 1.3 centimetres long'}      | ${'a month and day with no comma'}
    ${'October 22nd 2024 - 250 feet'}        | ${'22 October 2024 - 76 metres'}               | ${'the same, with an ordinal day it rewrites'}
  `('converts the quantity alone after $why', ({ input, expected }) => {
    expect(convert(input, localise)).toBe(expected);
  });

  it.each`
    unchanged                                 | why
    ${'In May 2000 feet of snow fell.'}       | ${'four figures straight after a bare month'}
    ${'October 22 2000 feet of snow fell.'}   | ${'four figures straight after a month and day with no comma'}
    ${'In May 2000 x 5 feet of snow fell.'}   | ${'the first side of a dimension'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged, localise)).toBe(unchanged);
  });

  it.each([
    ['Oct 22, 2024 1/2 inch long', localise],
    ['March 13, 2024 - 250 feet', localise],
    ['1/29/24 in. the ', { dates: { format: 'long' } }],
  ] as const)('runs twice on %j', (input, options) => {
    const once = convert(input, options);
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    input                                          | expected                                          | why
    ${'In May 5-10 feet of snow fell.'}            | ${'In May 1.5-3 metres of snow fell.'}            | ${'a range after a bare month'}
    ${'On March 13, 2024 - 25 feet of snow fell.'} | ${'On 13 March 2024 - 7.6 metres of snow fell.'}  | ${'a range refused by its size'}
    ${'March 5, 2024'}                             | ${'5 March 2024'}                                 | ${'the date itself'}
    ${'On Oct 22, 5 feet of snow fell.'}           | ${'On Oct 22, 1.5 metres of snow fell.'}          | ${'a number too short to be a year'}
    ${'On 22 October 5 feet of snow fell.'}        | ${'On 22 October 1.5 metres of snow fell.'}       | ${'the same, after a date written day first'}
    ${'In May 2024 - 5 feet of snow fell.'}        | ${'In May 2024 - 1.5 metres of snow fell.'}       | ${'a range refused after a bare month'}
    ${'In May, 2000 feet of snow fell.'}           | ${'In May, 610 metres of snow fell.'}             | ${'four figures after a comma'}
    ${'On March 13 25 feet of snow fell.'}         | ${'On March 13 7.6 metres of snow fell.'}         | ${'a number too short to be a year, after a day with no comma'}
  `('still converts $why', ({ input, expected }) => {
    expect(convert(input, localise)).toBe(expected);
  });
});

describe('a price is not a measurement', () => {
  const american = { assumeAmerican: true } as const;

  it.each`
    unchanged                     | why
    ${'Buy a $5 gallon of milk.'} | ${'a price before a unit word'}
    ${'A $20 pound of coffee.'}   | ${'the same, before pound'}
    ${'It costs $ 5 gallons.'}    | ${'a space after the sign'}
    ${'A €5 gallon of milk.'}     | ${'another currency sign'}
    ${'A $5 x 10 foot tarp.'}     | ${'a price before a dimension'}
    ${'It cost $350°F.'}          | ${'a price before a temperature'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                             | expected
    ${'Buy a $5 gallon of milk.'}     | ${'Buy a US$5 gallon of milk.'}
    ${'A $5 x 10 foot tarp.'}         | ${'A US$5 x 10 foot tarp.'}
    ${'It was $1,000 1/2 inch wide.'} | ${'It was US$1,000 1.3 centimetres wide.'}
  `('leaves "$input" to the currency rule', ({ input, expected }) => {
    const once = convert(input, american);
    expect(once).toBe(expected);
    expect(convert(once, american)).toBe(once);
  });

  it.each`
    input                                  | expected                                     | options
    ${'Price $5 - 10 inches long.'}        | ${'Price US$5 - 25 centimetres long.'}       | ${american}
    ${'It cost $20 for 5 pounds of beef.'} | ${'It cost $20 for 2.3 kilograms of beef.'}  | ${{}}
    ${'5 gallons'}                         | ${'19 litres'}                               | ${{}}
  `('still converts "$input"', ({ input, expected, options }) => {
    expect(convert(input, options)).toBe(expected);
  });
});

describe('a whole number hyphenated to a fraction is one mixed number', () => {
  it.each`
    input                         | expected                          | why
    ${'a 2-3/4 inch board'}       | ${'a 7 centimetre board'}         | ${'the same as "2 3/4 inch"'}
    ${'a 5-1/2 foot fence'}       | ${'a 1.7 metre fence'}            | ${'in feet'}
    ${'cut it 1-1/4 inches long'} | ${'cut it 3.2 centimetres long'}  | ${'plural'}
    ${'12-3/4 inch'}              | ${'32 centimetres'}               | ${'a whole part of two figures'}
    ${'a 2-3/4-inch board'}       | ${'a 7 centimetre board'}         | ${'hyphenated to its unit'}
    ${'2-3/4 to 5 inches'}        | ${'7 to 13 centimetres'}          | ${'the first end of a range'}
    ${'1-2-3/4 inches'}           | ${'2.5-7 centimetres'}            | ${'the second end of a range'}
    ${'2-3/4 x 5 inches'}         | ${'7 x 13 centimetres'}           | ${'a side of a dimension'}
    ${'5 feet 2-3/4 inches'}      | ${'1.59 metres'}                  | ${'the inches of a height'}
    ${'7 lb 2-1/2 oz'}            | ${'3.25 kg'}                      | ${'the ounces of a weight'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                      | expected                   | why
    ${'1-3 inches'}            | ${'2.5-7.6 centimetres'}   | ${'two whole numbers are a range'}
    ${'1/2-3/4 inch'}          | ${'1.3-1.9 centimetres'}   | ${'so are two fractions'}
    ${'1-3/2 inches'}          | ${'2.5-3.8 centimetres'}   | ${'and a whole number and a fraction above one'}
    ${'2024-03-14 1/2 gallon'} | ${'2024-03-14 1.9 litres'} | ${'a fraction after a date is its own number'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves a thread spec alone', () => {
    expect(convert('a 5/16-18 UNC bolt')).toBe('a 5/16-18 UNC bolt');
  });

  it.each`
    raw         | value
    ${'2-3/4'}  | ${2.75}
    ${'−2-3/4'} | ${-2.75}
    ${'1-3/2'}  | ${null}
    ${'2-3/0'}  | ${null}
  `('reads "$raw" as $value', ({ raw, value }) => {
    expect(parseNumber(raw)).toBe(value);
  });
});

describe('a Unicode hyphen reads as a hyphen', () => {
  it.each`
    input                                    | expected                                | why
    ${'5‑10 feet'}                      | ${'1.5-3 metres'}                       | ${'a range joined by U+2011'}
    ${'5‐10 feet'}                      | ${'1.5-3 metres'}                       | ${'a range joined by U+2010'}
    ${'5 ‑ 10 feet'}                    | ${'1.5-3 metres'}                       | ${'the same, spaced'}
    ${'1‑3 inches'}                     | ${'2.5-7.6 centimetres'}                | ${'two whole numbers'}
    ${'a 6‑foot fence'}                 | ${'a 1.8 metre fence'}                  | ${'between a number and its unit'}
    ${'twenty‐two miles'}               | ${'35 kilometres'}                      | ${'inside a number of two words'}
    ${'a forty‑five‑mile drive'}   | ${'a 72 kilometre drive'}               | ${'the same, hyphenated to its unit'}
    ${'a 2‑3/4 inch board'}             | ${'a 7 centimetre board'}               | ${'inside a mixed number'}
    ${'Highs in the 70s‑80s today.'}    | ${'Highs between 21 and 32°C today.'}   | ${'between two Fahrenheit decades'}
    ${'5-10 feet'}                           | ${'1.5-3 metres'}                       | ${'a hyphen-minus'}
    ${'a 6-foot fence'}                      | ${'a 1.8 metre fence'}                  | ${'the same, before a unit'}
    ${'It was −5°F outside'}                 | ${'It was -20.6°C outside'}             | ${'a minus sign'}
    ${'It was -5°F outside'}                 | ${'It was -20.6°C outside'}             | ${'a hyphen-minus before a number, which is a minus sign'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('joins a Fahrenheit range', () => {
    expect(convert('Bake at 350‑375°F.')).toMatch(/^Bake at 175[-‑]190°C\.$/);
  });

  it.each`
    input                               | expected
    ${'one‑half cup of citron'}    | ${'120 millilitres of citron'}
    ${'one-half cup of citron'}         | ${'120 millilitres of citron'}
  `('$input -> $expected with cups switched on', ({ input, expected }) => {
    expect(convert(input, { rules: { 'units.volume.cup': true } })).toBe(expected);
  });

  it.each`
    unchanged                               | why
    ${'It was ‑5°F outside.'}          | ${'a number straight after U+2011, which is not a minus sign'}
    ${'catch‑twenty‑two miles'}   | ${'a hyphenated word the table cannot read'}
    ${'twenty five‑pound bags'}        | ${'twenty bags or one weight'}
    ${'a 5/16‑18 UNC bolt'}            | ${'a thread spec'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                    | why
    ${'the 40‑yard‑line'}          | ${'a conventional size'}
    ${'a 27‑inch‑screen'}          | ${'the same, for a screen'}
    ${'a 20‑pound‑note'}           | ${'money'}
    ${'a 9‑inch‑round pan'}        | ${'a singular unit describing the noun after it'}
    ${'a 1.8 metre (6‑foot) fence'}     | ${'an original in brackets after its metric value'}
    ${'1.5‑3 m (5‑10 feet)'}       | ${'the same, for a range'}
  `('reads the words around "$input" as around a hyphen-minus ($why)', ({ input }) => {
    const ascii = convert(input.replace(/‑/g, '-'));
    expect(convert(input)).toBe(ascii.replace(/-/g, '‑'));
  });

  it('collapses a metric bracket that restates a range', () => {
    expect(convert('5‑10 feet (1.5‑3 m)')).toMatch(/^1\.5[-‑]3 m$/);
  });

  it.each`
    raw                  | value
    ${'2‑3/4'}      | ${2.75}
    ${'twenty‐two'} | ${22}
    ${'one‑half'}   | ${0.5}
  `('reads "$raw" as $value', ({ raw, value }) => {
    expect(parseNumber(raw)).toBe(value);
  });
});

describe('the minutes of a clock time are not a measurement', () => {
  it.each`
    unchanged                                | why
    ${'She ran a 7:30 mile pace.'}           | ${'a running pace'}
    ${'Hold 8:15 miles for the tempo run.'}  | ${'a pace before a plural unit'}
    ${'At 18:00 pound the cutlets thin.'}    | ${'a 24-hour time before a verb'}
    ${'At 7:30 F the oven was hot.'}         | ${'a bare F after a time'}
    ${'At 7:30 feet 2 inches'}               | ${'a height in two units'}
    ${'At 18:00 pounds 8 ounces'}            | ${'a weight in two units'}
    ${'At 7:30 stone 4 pounds 8 ounces'}     | ${'a weight in three units'}
    ${'At 7:30 mpg'}                         | ${'fuel economy'}
    ${'At 7:30 miles per gallon'}            | ${'fuel economy written out'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                        | expected                                         | why
    ${'At 7:30 6 feet 2 inches'}                 | ${'At 7:30 1.88 metres'}                         | ${'a height after a time'}
    ${'At 7:30 1/2 pounds 3 ounces'}             | ${'At 7:30 312 grams'}                           | ${'a weight after a time'}
    ${'7 pounds 8 ounces'}                       | ${'3.4 kilograms'}                               | ${'a weight in two units'}
    ${'30 mpg'}                                  | ${'7.8 L/100km'}                                 | ${'fuel economy'}
    ${'30 miles'}                                | ${'48 kilometres'}                               | ${'a measurement'}
    ${'a 30 mile drive'}                         | ${'a 48 kilometre drive'}                        | ${'an attributive measurement'}
    ${'Gates open at 7:30. 5 miles of parking.'} | ${'Gates open at 7:30. 8 kilometres of parking.'} | ${'a measurement after a time'}
    ${'Distance:5 miles'}                        | ${'Distance:8 kilometres'}                       | ${'a colon after a word'}
  `('still converts $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('runs twice on a time it wrote in 24-hour form', () => {
    const clock = { times: { to24Hour: true } };
    const once = convert('At 6:00 PM pound the cutlets thin.', clock);
    expect(once).toBe('At 18:00 pound the cutlets thin.');
    expect(convert(once, clock)).toBe(once);
  });
});

describe('precision options', () => {
  it.each`
    precision      | input        | expected
    ${'natural'}   | ${'6 feet'}  | ${'1.8 metres'}
    ${'exact'}     | ${'6 feet'}  | ${'1.8288 metres'}
    ${0}           | ${'6 feet'}  | ${'2 metres'}
    ${1}           | ${'6 feet'}  | ${'1.8 metres'}
    ${3}           | ${'6 feet'}  | ${'1.829 metres'}
    ${'natural'}   | ${'350°F'}   | ${'175°C'}
    ${'exact'}     | ${'350°F'}   | ${'176.666667°C'}
    ${1}           | ${'350°F'}   | ${'176.7°C'}
  `('precision $precision: $input -> $expected', ({ precision, input, expected }) => {
    expect(convert(input, { units: { precision } })).toBe(expected);
  });
});

describe('keeping the original', () => {
  it.each`
    input          | expected
    ${'6 feet'}    | ${'1.8 metres (6 feet)'}
    ${'350°F'}     | ${'175°C (350°F)'}
    ${'10 miles'}  | ${'16 kilometres (10 miles)'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input, { units: { keepOriginal: true } })).toBe(expected);
  });

  it.each`
    input
    ${'It is 6 feet tall.'}
    ${'He is 6 feet 2 inches tall, or 6\'2" in socks.'}
    ${'Bake at 350°F, or 350 degrees Fahrenheit.'}
    ${'a drop of 30-60 feet, or 30 to 60 feet'}
    ${'between 5 and 10 miles'}
    ${'a sheet of 8.5 x 11 inches, 8.5" x 11", or 10 ft x 12 ft x 8 ft'}
    ${'a 6-foot fence and a 9 inch dish'}
    ${'It weighs 180 pounds, 3 ounces and 12 stone.'}
    ${'She weighed 7 pounds 8 ounces, or 7 lb 8 oz, and he weighs 11st 4lb.'}
    ${'It holds 1/2 gallon, 2 quarts, 3 pints, 4 fluid ounces and 5 cubic feet.'}
    ${'It covers 20 square feet, 2 square miles and 10 acres.'}
    ${'It goes 60 miles per hour, or 60 mph.'}
    ${'It runs at 32 psi with 300 horsepower, 100 foot-pounds and 1000 BTU.'}
    ${'It does 30 mpg.'}
  `('running it again on "$input" changes nothing', ({ input }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    quantity
    ${'half a mile'}
    ${'a half a mile'}
    ${'half an inch'}
    ${'half a\nmile'}
    ${'one-fourth of a pound'}
    ${'one-quarter of a pound'}
    ${'a quarter of a mile'}
    ${'three-quarters of an inch'}
    ${'three quarters of a mile'}
    ${'an eighth of an inch'}
    ${'a mile and a half'}
    ${'an inch and a half'}
    ${'a foot and a half'}
    ${'two inches and a quarter'}
    ${'twenty-two feet and three-quarters'}
    ${'two and a half inches'}
    ${'a quarter pound'}
    ${'a quartersq ft'}
  `('running it again on "$quantity" written around its unit changes nothing', ({ quantity }) => {
    const options = { units: { keepOriginal: true } };
    const input = `It is ${quantity}.`;
    const once = convert(input, options);
    expect(once).not.toBe(input);
    expect(convert(once, options)).toBe(once);
  });

  it.each(MEASURES.map((measure) => [measure.id, measure.words[0]!]))(
    'running it again on %s changes nothing',
    (id, unit) => {
      const options = { units: { keepOriginal: true }, rules: { [id]: true } };
      const input = `It is 7 ${unit} here.`;
      const once = convert(input, options);
      expect(once).not.toBe(input);
      expect(convert(once, options)).toBe(once);
    },
  );
});

describe('measurements that are imperial worldwide', () => {
  it.each`
    unchanged                     | why
    ${'a 15 inch laptop'}         | ${'screens are sold in inches everywhere'}
    ${'the 27-inch monitor'}      | ${'same'}
    ${'17 inch wheels'}           | ${'so are wheels'}
    ${'a 12 inch vinyl record'}   | ${'so are records'}
    ${'2 inch pipe'}              | ${'so is plumbing'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                       | expected
    ${'a 15 inch laptop'}       | ${'a 38 centimetre laptop'}
    ${'the 17 inch wheels'}     | ${'the 43 centimetre wheels'}
    ${'wheels of 15-17 inches'} | ${'wheels of 38-43 centimetres'}
    ${'the 40 yard line'}       | ${'the 37 metre line'}
    ${'the 147-pound division'} | ${'the 66.7 kilogram division'}
  `('converts $input when respectConventions is off', ({ input, expected }) => {
    expect(convert(input, { units: { respectConventions: false } })).toBe(expected);
  });

  it.each`
    unchanged            | why
    ${'6 in total'}      | ${'"in" here is the preposition'}
    ${'sections 3 to 5'} | ${'no unit at all'}
    ${'version 1.5'}     | ${'not a measurement'}
    ${'12pt font'}       | ${'pt is points, not pints'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a conventional size is never half converted', () => {
  it.each`
    unchanged                               | why
    ${'wheels of 15-17 inches'}             | ${'a range of wheel sizes'}
    ${'15-17 inch wheels'}                  | ${'the noun after the range'}
    ${'a 15 to 17 inch wheel'}              | ${'joined by "to"'}
    ${'13-15 inch laptops'}                 | ${'screens'}
    ${'wheels of 15½-17 inches'}            | ${'a vulgar fraction ends the first number'}
    ${'bolts of ½-¾ inch'}                  | ${'a vulgar fraction at each end'}
    ${'bolts from ½ to ¾ inch'}             | ${'the same, joined by "to"'}
    ${'sockets of 3/8-1/2 inch'}            | ${'a fraction at each end'}
    ${'sockets of 3/8-½ inch'}              | ${'two kinds of fraction'}
    ${'a 15" x 17" panel'}                  | ${'a dimension with a unit on each side'}
    ${'a 15 in. x 17 in. panel'}            | ${'the same, abbreviated'}
    ${'a panel of 15" x 17"'}               | ${'the noun before the dimension'}
    ${'bolts of 1/2 x 3/4 inch'}            | ${'fractions in a dimension'}
    ${'a 2" x 4" x 8" panel'}               | ${'three dimensions'}
    ${'panel of 2" x 4" x 8"'}              | ${'three dimensions after the noun'}
    ${'a 2 ft x 6 in pipe'}                 | ${'a conventional unit beside another unit'}
    ${'wheels of 15½-17 inches (38-43 cm)'} | ${'a metric bracket after the range'}
    ${'bolts of ½-¾ inch (13-19 mm)'}       | ${'the same'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                        | expected
    ${'wheels of 15½-17 inches'} | ${'wheels of 39-43 centimetres'}
    ${'bolts of ½-¾ inch'}       | ${'bolts of 1.3-1.9 centimetres'}
    ${'sockets of 3/8-1/2 inch'} | ${'sockets of 0.95-1.3 centimetres'}
    ${'a 15" x 17" panel'}       | ${'a 38 x 43 cm panel'}
    ${'a panel of 15" x 17"'}    | ${'a panel of 38 x 43 cm'}
    ${'a 2" x 4" x 8" panel'}    | ${'a 5.1 x 10 x 20 cm panel'}
    ${'a 2 ft x 6 in pipe'}      | ${'a 61 x 15 cm pipe'}
  `('converts all of $input when respectConventions is off', ({ input, expected }) => {
    expect(convert(input, { units: { respectConventions: false } })).toBe(expected);
  });

  it('still converts a measurement that holds a conventional size whole', () => {
    expect(convert('a 2 foot 6 inch pipe')).toMatch(/^a 76\.2 centimetres? pipe$/);
  });

  it('converts a measurement beside a conventional size', () => {
    expect(convert('15-17 inch wheels and 6 feet of pipe')).toBe(
      '15-17 inch wheels and 1.8 metres of pipe',
    );
  });
});

describe('a pair is never half converted with its rule switched off', () => {
  const noRanges = { rules: { 'units.range': false } };
  const noDimensions = { rules: { 'units.dimensions': false } };

  it.each`
    unchanged             | why
    ${'½-¾ inch'}         | ${'a vulgar fraction at each end'}
    ${'15½-17 inches'}    | ${'a vulgar fraction ends the first number'}
    ${'½ - ¾ inch'}       | ${'the same, spaced'}
    ${'½ to ¾ inch'}      | ${'the same, joined by "to"'}
    ${'3/8-1/2 inch'}     | ${'a fraction at each end'}
    ${'5-10 feet'}        | ${'two whole numbers'}
  `('leaves "$unchanged" alone without ranges ($why)', ({ unchanged }) => {
    expect(convert(unchanged, noRanges)).toBe(unchanged);
  });

  it.each`
    unchanged            | why
    ${'½ x ¾ inch'}      | ${'a vulgar fraction on each side'}
    ${'1½ x 2 inch'}     | ${'a vulgar fraction ends the first side'}
    ${'1/2 x 3/4 inch'}  | ${'a fraction on each side'}
  `('leaves "$unchanged" alone without dimensions ($why)', ({ unchanged }) => {
    expect(convert(unchanged, noDimensions)).toBe(unchanged);
  });

  it.each`
    unchanged            | why
    ${'½ x 3-4 inch'}    | ${'a range after a side that ends in a vulgar fraction'}
    ${'1½-2 x 3 feet'}   | ${'a dimension after a range that starts with one'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                      | expected                    | options
    ${'2024-03-14 1/2 gallon'} | ${'2024-03-14 1.9 litres'}  | ${noRanges}
    ${'a depth of -30 feet'}   | ${'a depth of -9.1 metres'} | ${noRanges}
    ${'1/2 gallon'}            | ${'1.9 litres'}             | ${noRanges}
    ${'3/4 inch'}              | ${'1.9 centimetres'}        | ${noDimensions}
    ${'½-¾ inch'}              | ${'1.3-1.9 centimetres'}    | ${{}}
  `('still converts $input', ({ input, expected, options }) => {
    expect(convert(input, options)).toBe(expected);
  });

  it('still converts a dimension of fractions as one', () => {
    expect(convert('1/2 x 3/4 inch')).toMatch(/^1\.3 x 1\.9 centimetres?$/);
  });
});

describe('a held span in change resolution', () => {
  const at = (start: number, end: number, extra: Partial<Change> = {}): Change => ({
    start,
    end,
    before: 'x'.repeat(end - start),
    after: 'y',
    ruleId: 'test',
    category: 'units',
    confidence: 'moderate',
    priority: 30,
    ...extra,
  });
  const held = at(10, 20, { after: 'x'.repeat(10), hold: true, priority: 0 });

  it('is never returned', () => {
    expect(resolveChanges([held], [])).toEqual([]);
  });

  it('drops a change that would rewrite only part of it, whatever its priority', () => {
    expect(resolveChanges([held, at(15, 20, { priority: 99 })], [])).toEqual([]);
    expect(resolveChanges([held, at(5, 12, { priority: 99 })], [])).toEqual([]);
  });

  it('keeps a change that rewrites all of it, or none of it', () => {
    const whole = at(8, 22);
    const beside = at(0, 5);
    expect(resolveChanges([held, whole, beside], [])).toEqual([beside, whole]);
  });

  it('keeps a change that writes its part of it back as it was', () => {
    const quote = at(19, 22, { before: 'x."', after: 'x".' });
    expect(resolveChanges([held, quote], [])).toEqual([quote]);
    expect(resolveChanges([held, at(19, 22, { before: 'x."', after: 'y".' })], [])).toEqual([]);
  });

  it.each`
    input                                                  | expected
    ${'The sign said "It cost 500 pounds."'}               | ${'The sign said "It cost 500 pounds".'}
    ${'They called it "a fine of 200 pounds," then left.'} | ${'They called it "a fine of 200 pounds", then left.'}
    ${'She said "I need bolts of ½-¾ inch."'}              | ${'She said "I need bolts of ½-¾ inch".'}
  `('moves the stop out of a quotation that ends in a held span: $input', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });
});

describe('units can be switched off', () => {
  it('leaves everything alone when units are disabled', () => {
    expect(convert('6 feet and 350°F', { units: false })).toBe('6 feet and 350°F');
  });

  it('honours unitsKeep for a single measure', () => {
    expect(convert('10 miles at 60 mph', { unitsKeep: ['mile'] })).toBe('10 miles at 97 km/h');
  });
});

describe('unitsKeep names a unit by key, word or abbreviation', () => {
  it.each`
    unitsKeep               | input                           | expected
    ${['inches', 'miles']}  | ${'6 inches and 2 miles'}       | ${'6 inches and 2 miles'}
    ${['inch', 'mile']}     | ${'6 inches and 2 miles'}       | ${'6 inches and 2 miles'}
    ${['Inches']}           | ${'6 inches and 2 feet'}        | ${'6 inches and 61 centimetres'}
    ${['in']}               | ${'6 inches'}                   | ${'6 inches'}
    ${['FL OZ', 'sq ft']}   | ${'8 fl oz on 100 square feet'} | ${'8 fl oz on 100 square feet'}
    ${['MPH']}              | ${'60 mph'}                     | ${'60 mph'}
    ${['LB']}               | ${'5 pounds of flour'}          | ${'5 pounds of flour'}
    ${['lbs']}              | ${'7 pounds 8 ounces'}          | ${'7 pounds 8 ounces'}
    ${['mile', 'pint']}     | ${'10 miles and 2 pints'}       | ${'10 miles and 2 pints'}
    ${['mile', 'pint']}     | ${'10 miles and 6 feet'}        | ${'10 miles and 1.8 metres'}
  `('$unitsKeep turns "$input" into "$expected"', ({ unitsKeep, input, expected }) => {
    expect(convert(input, { unitsKeep })).toBe(expected);
  });

  it('reads every key, word and abbreviation, in any case, as its own unit', () => {
    for (const measure of MEASURES) {
      for (const form of [measure.keep, ...measure.words, ...measure.abbrevs]) {
        for (const written of [form, form.toUpperCase(), form.toLowerCase()]) {
          expect(resolveOptions({ unitsKeep: [written] }).unitsKeep, written).toEqual([measure.keep]);
        }
      }
    }
  });

  it('lists each unit once, in the order first named', () => {
    expect(resolveOptions({ unitsKeep: ['Pints', 'inches', 'in', 'inch', 'pint'] }).unitsKeep).toEqual([
      'pint',
      'inch',
    ]);
  });

  it('adds to what the dialect keeps, and gives way to a rule turned on by id', () => {
    const gb = { dialect: 'en-GB' } as const;
    expect(convert('10 miles at 60 mph, 2 pints and 11 stone', gb)).toBe('10 miles at 60 mph, 2 pints and 11 stone');
    expect(convert('10 miles and 6 inches', gb)).toBe('10 miles and 15 centimetres');
    expect(convert('10 miles and 6 inches', { ...gb, unitsKeep: ['inches'] })).toBe('10 miles and 6 inches');
    expect(convert('10 miles', { ...gb, rules: { 'units.length.mile': true } })).toBe('16 kilometres');
    expect(convert('10 miles', { unitsKeep: ['miles'], rules: { 'units.length.mile': true } })).toBe('16 kilometres');
  });

  const known = 'Expected the key, name or abbreviation of one of inch, foot, yard, mile,';

  it.each(['furlong', 'inchs', 'fahrenheit', 'units.length.inch', 'square foot2', '', ' inch', 'toString'])(
    'rejects "%s" by name, listing the known keys, even with nothing to read',
    (entry) => {
      const message = `Unknown unit: ${entry}. ${known}`;
      expect(() => resolveOptions({ unitsKeep: [entry] })).toThrow(message);
      expect(() => checkOptions({ unitsKeep: [entry] })).toThrow(message);
      expect(() => convert('6 inches', { unitsKeep: [entry] })).toThrow(message);
      expect(() => deamericaniseCode('const a = 1;\n', { language: 'ts', unitsKeep: [entry] })).toThrow(message);
    },
  );

  it('names the entry that names no unit among ones that do, and ends the list of keys', () => {
    expect(() => resolveOptions({ unitsKeep: ['mile', 'furlong', 'pint'] })).toThrow(
      /^Unknown unit: furlong\. Expected .*\bpint\b.*, foot-pound\.$/,
    );
  });

  it('rejects a unitsKeep that is not a list', () => {
    const unitsKeep = 'mile' as unknown as string[];
    expect(() => resolveOptions({ unitsKeep })).toThrow("unitsKeep must be a list of units, such as ['mile', 'pint'].");
  });
});

describe('dimensions move together', () => {
  it.each`
    input                        | expected                          | why
    ${'10 x 12 feet'}            | ${'3 x 3.7 metres'}               | ${'both halves, one unit'}
    ${'9 x 13 inches'}           | ${'23 x 33 centimetres'}          | ${'a baking dish'}
    ${'10 ft x 12 ft'}           | ${'3 x 3.7 m'}                    | ${'a unit on each half'}
    ${'10 x 12 x 8 inches'}      | ${'25 x 30 x 20 centimetres'}     | ${'three dimensions'}
    ${'20 by 30 feet'}           | ${'6.1 by 9.1 metres'}            | ${'"by" is kept'}
    ${'10 × 12 feet'}            | ${'3 × 3.7 metres'}               | ${'so is the multiplication sign'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                | why
    ${'a 1920 x 1080 display'} | ${'pixels are not a unit'}
    ${'a 2 x 4 stud'}          | ${'no unit at all'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a dimension with a different unit on each side', () => {
  it.each`
    input                               | expected                              | why
    ${'the board is 2 feet x 6 inches'} | ${'the board is 61 x 15 centimetres'} | ${'each side in its own unit'}
    ${'the sheet is 4 ft x 8 in.'}      | ${'the sheet is 1.2 x 0.2 m'}         | ${'all in the unit for the largest'}
    ${'the deck is 10 ft x 12 in'}      | ${'the deck is 3 x 0.3 m'}            | ${'"in" after a side with a unit is the unit'}
    ${'10 ft by 6 in'}                  | ${'3 by 0.15 m'}                      | ${'the same, joined by "by"'}
    ${'3 ft x 2 ft x 6 in'}             | ${'91 x 61 x 15 cm'}                  | ${'three sides'}
    ${'5 x 10 ft x 6 in'}               | ${'1.5 x 3 x 0.15 m'}                 | ${'a side with no unit takes the next one'}
    ${'1 mile x 500 feet'}              | ${'1.6 x 0.15 kilometres'}            | ${'the longest side, not the largest number'}
    ${'a 10 foot x 12 inch board'}      | ${'a 3 x 0.3 metre board'}            | ${'attributive, so it stays singular'}
    ${'2 feet x 6 inches (61 x 15 cm)'} | ${'61 x 15 cm'}                       | ${'a bracket that restates it'}
    ${'8.5" x 11"'}                     | ${'22 x 28 cm'}                       | ${'one unit on each side still pairs up'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads sides that measure different things as separate measurements', () => {
    expect(convert('2 feet x 6 pounds')).toBe('61 centimetres x 2.7 kilograms');
  });

  it.each`
    unchanged                     | why
    ${'10 ft x 12 x 6 in'}        | ${'the middle side could be in either unit'}
    ${'10 x 12 in'}               | ${'"in" with no other unit may be the preposition'}
    ${'6 in by 5 in the morning'} | ${'the same on every side'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    rule
    ${'units.length.foot'}
    ${'units.length.inch'}
  `('leaves it whole when $rule is off', ({ rule }) => {
    expect(convert('2 feet x 6 inches', { rules: { [rule]: false } })).toBe('2 feet x 6 inches');
  });
});

describe('an apostrophe for feet on a side of a dimension', () => {
  it.each`
    input                    | expected                         | why
    ${`the 2' x 6" shelf`}   | ${'the 61 x 15 cm shelf'}        | ${'feet beside inches'}
    ${`a 2' x 4' sheet`}     | ${'a 0.61 x 1.2 m sheet'}        | ${'feet on every side'}
    ${`a 2' x 4' x 8' box`}  | ${'a 0.61 x 1.2 x 2.4 m box'}    | ${'three sides'}
    ${`2'x6"`}               | ${'61 x 15 cm'}                  | ${'no spaces'}
    ${`2' × 4'`}             | ${'0.61 × 1.2 m'}                | ${'the multiplication sign'}
    ${`2' by 4'`}            | ${'0.61 by 1.2 m'}               | ${'joined by "by"'}
    ${`2' x 4 feet`}         | ${'0.61 x 1.2 metres'}           | ${'beside a unit written out'}
    ${`2' x 6 in x 3 in`}    | ${'61 x 15 x 7.6 cm'}            | ${'beside an "in" that another side confirms'}
    ${`He is 6'2" tall.`}    | ${'He is 1.88 metres tall.'}     | ${'feet and inches are still one height'}
    ${'a 5′ x 8′ rug'}       | ${'a 1.5 x 2.4 m rug'}           | ${'prime marks'}
    ${`'6' x 4 ft`}          | ${`'6' x 1.2 m`}                 | ${'a quoted number beside a side with a unit'}
    ${`2' x 4 oz`}           | ${`2' x 110 g`}                  | ${'a side that is not a length'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                | why
    ${`She said '6' twice.`} | ${'a quoted number'}
    ${`the '6' x 4' panel`}  | ${'a quoted number, though a dimension follows'}
    ${`'2 x 4'`}             | ${'a quoted dimension with no unit'}
    ${`2' x 4`}              | ${'no mark on the last side'}
    ${`10 x 12' x 6"`}       | ${'no mark on the first side, so no side converts'}
    ${`2 ' x 4 '`}           | ${'a spaced apostrophe'}
    ${`2' x 4 in`}           | ${'an apostrophe cannot confirm a bare "in"'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    options                                      | why
    ${{ unitsKeep: ['foot'] }}                   | ${'the foot is kept'}
    ${{ rules: { 'units.length.foot': false } }} | ${'the foot is switched off'}
  `('leaves the feet alone when $why', ({ options }) => {
    expect(convert(`a 2' x 4' sheet`, options)).toBe(`a 2' x 4' sheet`);
  });
});

describe('a spaced "in" on every side of a dimension', () => {
  it.each`
    input                    | expected                 | why
    ${'4 in x 6 in photo'}   | ${'10 x 15 cm photo'}    | ${'"in" before "x" and a number is the unit'}
    ${'6 in x 6 in tiles'}   | ${'15 x 15 cm tiles'}    | ${'equal sides'}
    ${'4 in × 6 in'}         | ${'10 × 15 cm'}          | ${'the multiplication sign'}
    ${'4 in x 6 in x 2 in'}  | ${'10 x 15 x 5.1 cm'}    | ${'three sides'}
    ${'4in x 6in photo'}     | ${'10 x 15 cm photo'}    | ${'no spaces'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                     | why
    ${'6 in total'}               | ${'the preposition'}
    ${'10 x 12 in'}               | ${'one "in", with no other unit'}
    ${'6 in by 5 in the morning'} | ${'"by" may join two prepositions'}
    ${'4 in by 6 in'}             | ${'the same with nothing after'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a count in digits before "by" and an amount', () => {
  it.each`
    input                               | expected                                | why
    ${'Raise all 4 by 6 inches.'}       | ${'Raise all 4 by 15 centimetres.'}     | ${'"all" makes the number a noun'}
    ${'Move each 2 by 3 feet.'}         | ${'Move each 2 by 91 centimetres.'}     | ${'"each"'}
    ${'Lower these 2 by 3 feet.'}       | ${'Lower these 2 by 91 centimetres.'}   | ${'"these"'}
    ${'Shift both 1 by 2 inches.'}      | ${'Shift both 1 by 5.1 centimetres.'}   | ${'"both" before one'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                               | expected                                | why
    ${'a 4 by 6 inch photo'}            | ${'a 10 by 15 centimetre photo'}        | ${'no noun word before the pair'}
    ${'The room is 10 by 12 feet.'}     | ${'The room is 3 by 3.7 metres.'}       | ${'the same, plural'}
    ${'each 4 ft by 6 ft panel'}        | ${'each 1.2 by 1.8 m panel'}            | ${'a side with its own unit is never a noun'}
    ${'those 4 by 6 inch photos'}       | ${'those 10 by 15 centimetre photos'}   | ${'a pair before a noun describes it'}
    ${'all 4 by 6 ft panels'}           | ${'all 1.2 by 1.8 m panels'}            | ${'the same, abbreviated'}
    ${'all 4 x 6 inch photos'}          | ${'all 10 x 15 centimetre photos'}      | ${'"x" never gives an amount'}
    ${'raise all four by six inches'}   | ${'raise all four by 15 centimetres'}   | ${'a count in words'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves three sides after a noun word alone', () => {
    expect(convert('Raise all 4 by 6 by 8 inches.')).toBe('Raise all 4 by 6 by 8 inches.');
  });
});

describe('a count before a weight or volume', () => {
  it.each`
    input                                      | expected                                       | why
    ${'buy 2 x 4 oz cans'}                     | ${'buy 2 x 110 g cans'}                        | ${'two cans of 4 oz each'}
    ${'a case of 6 x 12 fl oz bottles'}        | ${'a case of 6 x 350 mL bottles'}              | ${'a volume'}
    ${'2 x 5 lb bags of flour'}                | ${'2 x 2.3 kg bags of flour'}                  | ${'a count at the start'}
    ${'2 × 4 oz cans'}                         | ${'2 × 110 g cans'}                            | ${'the multiplication sign'}
    ${'2 x 6 x 12 oz cans'}                    | ${'2 x 6 x 340 g cans'}                        | ${'two counts'}
    ${'buy 2 x 4 ounce cans'}                  | ${'buy 2 x 110 gram cans'}                     | ${'the count opens the phrase, so it stays singular'}
    ${'a case of 6 x 12 fluid ounce bottles'}  | ${'a case of 6 x 350 millilitre bottles'}      | ${'the same for a volume'}
    ${'6 x 1 pound'}                           | ${'6 x 450 grams'}                             | ${'no noun after, so it is plural'}
    ${'2 x 4 lb 8 oz bags'}                    | ${'2 x 2.04 kg bags'}                          | ${'a weight in two units'}
    ${'3 x 100 sq ft rolls'}                   | ${'3 x 9.3 m² rolls'}                          | ${'an area'}
    ${'2 lb x 3 lb'}                           | ${'910 g x 1.4 kg'}                            | ${'two weights are two measurements'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                    | expected
    ${'10 x 12 feet'}        | ${'3 x 3.7 metres'}
    ${'8.5" x 11"'}          | ${'22 x 28 cm'}
    ${'2 feet x 6 inches'}   | ${'61 x 15 centimetres'}
  `('still reads a length as a dimension: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                       | options                                     | why
    ${'a 2 x 4 stud'}               | ${{}}                                       | ${'no unit at all'}
    ${'a 15" x 17" panel'}          | ${{}}                                       | ${'a conventional size'}
    ${'It cost 2 x 5 pounds.'}      | ${{}}                                       | ${'money, with the count in its amount'}
    ${'Babies weigh 7-8 lb 4 oz.'}  | ${{}}                                       | ${'a weight at the end of a range'}
    ${'buy 2 x 4 oz cans'}          | ${{ rules: { 'units.mass.ounce': false } }} | ${'the unit is switched off'}
    ${'2 x 11 stone 4 pounds'}      | ${{ dialect: 'en-GB' }}                     | ${'a unit of the weight is kept'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged, options }) => {
    expect(convert(unchanged, options)).toBe(unchanged);
  });
});

describe('a dimension with a side in words', () => {
  it.each`
    input                                | expected                            | why
    ${'A ten by twelve foot room.'}      | ${'A 3 by 3.7 metre room.'}         | ${'every side in words'}
    ${'The room is ten by twelve feet.'} | ${'The room is 3 by 3.7 metres.'}   | ${'plural'}
    ${'The room is 10 by twelve feet.'}  | ${'The room is 3 by 3.7 metres.'}   | ${'digits and words'}
    ${'A two feet x six inches board.'}  | ${'A 61 x 15 centimetres board.'}   | ${'each side in its own unit'}
    ${'ten by twelve by eight feet'}     | ${'3 by 3.7 by 2.4 metres'}         | ${'three sides'}
    ${'twenty-two by ten feet'}          | ${'6.7 by 3 metres'}                | ${'a cardinal of two words'}
    ${'a hundred by fifty feet'}         | ${'30 by 15 metres'}                | ${'a multiplied count'}
    ${'ten × twelve feet'}               | ${'3 × 3.7 metres'}                 | ${'the multiplication sign'}
    ${'This ten by twelve foot room'}    | ${'This 3 by 3.7 metre room'}       | ${'"this" before a number above one'}
    ${'ten by twelve feet (3 by 3.7 m)'} | ${'3 by 3.7 m'}                     | ${'a bracket that restates it'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                                 | why
    ${'buy two x 4 oz cans'}               | ${'buy two x 110 g cans'}                | ${'a count before a weight'}
    ${'six x twelve fl oz bottles'}        | ${'six x 350 mL bottles'}                | ${'a count before a volume'}
    ${'Raise each one by two inches.'}     | ${'Raise each one by 5.1 centimetres.'}  | ${'a noun before "by" and an amount'}
    ${'move all three by two feet'}        | ${'move all three by 61 centimetres'}    | ${'the same, above one'}
    ${'that one by two feet'}              | ${'that one by 61 centimetres'}          | ${'"that" before "one"'}
    ${'A 10 by 12 foot room.'}             | ${'A 3 by 3.7 metre room.'}              | ${'digits'}
    ${'She won by two feet.'}              | ${'She won by 61 centimetres.'}          | ${'no number before "by"'}
    ${'One by one, they walked ten feet.'} | ${'One by one, they walked 3 metres.'}   | ${'no unit after the pair'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                            | why
    ${'two and a half by three feet'}    | ${'a fraction in words on the first side'}
    ${'two by three and a half feet'}    | ${'the same, on the last side'}
    ${'one-half by three-quarters inch'} | ${'two fractions in words'}
    ${'Lower one by two feet.'}          | ${'"one" may be a pronoun, with "by" giving an amount'}
    ${'It cost two x 5 pounds.'}         | ${'money, with the count in its amount'}
    ${'ten x twelve in'}                 | ${'"in" may be the preposition'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('singular and plural follow the source', () => {
  it.each`
    input                  | expected                     | why
    ${'a 9 inch dish'}     | ${'a 23 centimetre dish'}    | ${'attributive, so it stays singular'}
    ${'a 6 foot fence'}    | ${'a 1.8 metre fence'}       | ${'the same'}
    ${'a 9 x 13 inch dish'} | ${'a 23 x 33 centimetre dish'} | ${'the same, across a dimension pair'}
    ${'1 inch'}            | ${'2.5 centimetres'}         | ${'a real singular; the result is plural'}
    ${'0.5 inch'}          | ${'1.3 centimetres'}         | ${'below one is genuine, not attributive'}
    ${'9 inches'}          | ${'23 centimetres'}          | ${'a plural source stays plural'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('torque is not mass', () => {
  it.each`
    input                     | expected        | why
    ${'400lb ft of torque'}   | ${'540 N·m of torque'} | ${'lb ft with a space still reads as pound-feet'}
    ${'570 lb-ft'}            | ${'770 N·m'}    | ${'hyphenated'}
    ${'300 ft-lbs'}           | ${'410 N·m'}    | ${'the other way round'}
    ${'250 pound-feet'}       | ${'340 newton metres'} | ${'a spelled-out source gets a spelled-out unit'}
    ${'180 lbs of cargo'}     | ${'82 kg of cargo'} | ${'plain pounds are still mass'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('screen sizes survive an adjective or two', () => {
  it.each`
    unchanged                                 | why
    ${'a 12-inch capacitive LCD touchscreen'} | ${'three words before the noun'}
    ${'the 27-inch 4K monitor'}               | ${'an intervening word starting with a digit'}
    ${'a 65 inch 8K OLED TV'}                 | ${'several of them'}
    ${'a 15 inch laptop'}                     | ${'none at all'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                 | expected
    ${'5 inches of rain'} | ${'13 centimetres of rain'}
    ${'a 9 inch dish'}    | ${'a 23 centimetre dish'}
  `('still converts $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a text that already gives the metric value', () => {
  it.each`
    input                                            | expected                | why
    ${'100 yards (91 m)'}                            | ${'91 m'}               | ${'the imperial half goes, the author figure stays'}
    ${'30-60 feet (9-18 m)'}                         | ${'9-18 m'}             | ${'ranges too'}
    ${'120 degrees Fahrenheit (49 degrees Celsius)'} | ${'49 degrees Celsius'} | ${'temperatures too'}
    ${'100 yards (91 meters)'}                       | ${'91 metres'}          | ${'only the spelling is brought across'}
    ${'6 feet (1.8 m) tall'}                         | ${'1.8 m tall'}         | ${'mid-sentence'}
    ${'90 feet (30m)'}                               | ${'30m'}                | ${'the author spacing is kept'}
    ${'10 miles (16 km) away'}                       | ${'16 km away'}         | ${'any unit'}
    ${'6 feet (1.8 metres)'}                         | ${'1.8 metres'}         | ${'written out'}
    ${'2000 square feet (190 square metres)'}        | ${'190 square metres'}  | ${'any form a conversion writes'}
    ${'60 mph (97 kilometres per hour)'}             | ${'97 kilometres per hour'} | ${'the same'}
    ${'30 mpg (7.8 L/100km)'}                        | ${'7.8 L/100km'}        | ${'fuel economy too'}
    ${'10 by 12 feet (3 by 3.7 m)'}                  | ${'3 by 3.7 m'}         | ${'dimensions too'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                            | expected                            | why
    ${'6 feet (about two paces)'}    | ${'1.8 metres (about two paces)'}   | ${'not a measurement, so it converts as normal'}
    ${'6 feet (see the diagram)'}    | ${'1.8 metres (see the diagram)'}   | ${'the same'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a metric bracket goes only when it restates the conversion', () => {
  it.each`
    input                                  | expected                  | why
    ${'6 feet (1.8 metres)'}               | ${'1.8 metres'}           | ${'the same figure'}
    ${'It is 6 feet\n(1.8 m) tall.'}       | ${'It is 1.8 m tall.'}    | ${'the bracket wraps onto the next line'}
    ${'It is 6 feet\r\n(1.8 m) tall.'}     | ${'It is 1.8 m tall.'}    | ${'a Windows line break'}
    ${'It is 6 feet (2 m) tall.'}          | ${'It is 2 m tall.'}      | ${'rounded to one figure'}
    ${'It is 6 feet (180 cm) tall.'}       | ${'It is 180 cm tall.'}   | ${'another unit of the same dimension'}
    ${'It is 6 feet 2 inches (1.88 m).'}   | ${'It is 1.88 m.'}        | ${'feet and inches'}
    ${'Cut it into 1/4 inch (5 mm) dice.'} | ${'Cut it into 5 mm dice.'} | ${'a small figure rounded to its last digit'}
    ${'1 mile (1,600 m)'}                  | ${'1,600 m'}              | ${'a grouped figure'}
    ${'1 pound (500 g) of butter'}         | ${'500 g of butter'}      | ${'a cook rounding'}
    ${'1 ounce (25 g) of butter'}          | ${'25 g of butter'}       | ${'the same'}
    ${'1 gallon (4.5 L) of water'}         | ${'4.5 L of water'}       | ${'an imperial gallon'}
    ${'1 pint (568 ml) of milk'}           | ${'568 ml of milk'}       | ${'an imperial pint'}
    ${'It does 30 mpg (9.4 L/100km).'}     | ${'It does 9.4 L/100km.'} | ${'a UK mpg'}
    ${'It does 30 mpg (13 km/L).'}         | ${'It does 13 km/L.'}     | ${'the inverse measure of economy'}
    ${'Bake at 250°F (130°C).'}            | ${'Bake at 130°C.'}       | ${'an oven table'}
    ${'Bake at 350-375°F (175-190°C).'}    | ${'Bake at 175-190°C.'}   | ${'a range of temperatures'}
    ${'It was -40°F (-40°C).'}             | ${'It was -40°C.'}        | ${'a negative temperature'}
    ${'It dropped 20°F (11°C).'}           | ${'It dropped 11°C.'}     | ${'a change in temperature'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                                 | why
    ${'It is 6 feet (2 kg) tall.'}         | ${'It is 1.8 metres (2 kg) tall.'}       | ${'a weight restates no height'}
    ${'Bake at 350°F (2 kg).'}             | ${'Bake at 175°C (2 kg).'}               | ${'nor a temperature'}
    ${'It does 30 mpg (2 km).'}            | ${'It does 7.8 L/100km (2 km).'}         | ${'nor fuel economy'}
    ${'It is 6 feet (5 metres) tall.'}     | ${'It is 1.8 metres (5 metres) tall.'}   | ${'a different figure'}
    ${'It is 6 feet (3 m) tall.'}          | ${'It is 1.8 metres (3 m) tall.'}        | ${'further apart than rounding'}
    ${'It is 6 feet (1.8 km) tall.'}       | ${'It is 1.8 metres (1.8 km) tall.'}     | ${'the wrong unit'}
    ${'It is 5 miles (8 m) away.'}         | ${'It is 8 kilometres (8 m) away.'}      | ${'the same'}
    ${'Bake at 350°F (350°C).'}            | ${'Bake at 175°C (350°C).'}              | ${'the figure left unconverted'}
    ${'Bake at 350°F (160°C).'}            | ${'Bake at 175°C (160°C).'}              | ${'a fan oven setting'}
    ${'a 10 x 12 foot (3 m) room'}         | ${'a 3 x 3.7 metre (3 m) room'}          | ${'fewer figures'}
    ${'a 10 x 12 foot (3-3.7 m) room'}     | ${'a 3 x 3.7 metre (3-3.7 m) room'}      | ${'a range is not two sides'}
    ${'It is 6 feet\n\n(1.8 m) tall.'}     | ${'It is 1.8 metres\n\n(1.8 m) tall.'}   | ${'a blank line ends the measurement'}
    ${'It is 6 feet\n- (1.8 m) tall.'}     | ${'It is 1.8 metres\n- (1.8 m) tall.'}   | ${'so does a list item'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    options                                  | input                              | expected
    ${{ precision: 0 }}                      | ${'It is 6 feet (1.8 m) tall.'}    | ${'It is 1.8 m tall.'}
    ${{ precision: 0 }}                      | ${'It is 1 inch (2.5 cm) wide.'}   | ${'It is 2.5 cm wide.'}
    ${{ precision: 'exact' }}                | ${'It is 6 feet (1.8 m) tall.'}    | ${'It is 1.8 m tall.'}
    ${{ fuelEconomy: 'km-per-l' }}           | ${'It does 30 mpg (7.8 L/100km).'} | ${'It does 7.8 L/100km.'}
  `('with $options: $input -> $expected', ({ options, input, expected }) => {
    expect(convert(input, { units: options })).toBe(expected);
  });

  it.each(
    MEASURES
      // Tons are skipped in any document that says tonnes.
      .filter((measure) => !measure.ambiguousWhen?.test(measure.convert(7).plural))
      .flatMap((measure) =>
        [measure.words[0]!, measure.abbrevs[0]].flatMap((unit) => (unit ? [[measure.id, unit]] : [])),
      ),
  )('%s: 7 %s collapses into its own conversion', (id, unit) => {
    const options = { rules: { [id]: true } };
    const metric = convert(`7 ${unit}`, options);
    expect(convert(`It is 7 ${unit} (${metric}) here.`, options)).toBe(`It is ${metric} here.`);
  });
});

describe('an imperial original in brackets after its metric value', () => {
  it.each`
    unchanged                                                  | why
    ${'It is 1.8 metres (6 feet) tall.'}                       | ${'what keepOriginal writes'}
    ${'It is 1.8 meters (6 ft) tall.'}                         | ${'any spelling or symbol'}
    ${'It is 1.88 metres (6 feet 2 inches) tall.'}             | ${'feet and inches'}
    ${`It is 1.88 m (6'2") tall.`}                             | ${'feet and inches in symbols'}
    ${'It is 1.8 m (5 ft 11 in) tall.'}                        | ${'abbreviated'}
    ${'It weighs 71.7 kg (11st 4lb).'}                         | ${'stone and pounds'}
    ${'a 1.8 metre (6-foot) fence'}                            | ${'attributive'}
    ${'a 2 metre (about 6 feet) fence'}                        | ${'a rounded restatement'}
    ${'a 2-metre (roughly 6-foot) fence'}                      | ${'the same'}
    ${'a drop of 9.1-18 metres (30-60 feet)'}                  | ${'ranges'}
    ${'between 8 and 16 kilometres (5 and 10 miles)'}          | ${'a range joined by and'}
    ${'a sheet of 22 x 28 centimetres (8.5 x 11 inches)'}      | ${'dimensions'}
    ${'a sheet of 22 x 28 cm (8.5" x 11")'}                    | ${'dimensions with a unit on each side'}
    ${'Bake at 175°C (350°F).'}                                | ${'temperatures'}
    ${'Bake at 175 degrees Celsius (350 degrees Fahrenheit).'} | ${'temperatures written out'}
    ${'It covers 190 square metres (2000 square feet).'}       | ${'area'}
    ${'It goes 97 kilometres per hour (60 miles per hour).'}   | ${'speed'}
    ${'It does 7.8 L/100km (30 mpg).'}                         | ${'fuel economy'}
    ${'It does 5.9 L/100km (40 miles per gallon).'}            | ${'fuel economy written out, not a length'}
    ${'It turns at 140 N·m (100 lb-ft).'}                      | ${'torque, not a weight joined to a length'}
    ${'It is 1.8 metres\n(6 feet) tall.'}                      | ${'a wrapped line'}
    ${'It is 1.8 metres\r\n(6 feet) tall.'}                    | ${'a Windows line break'}
    ${'Roll it 1.3 centimetres (half an inch) thick.'}         | ${'half an inch'}
    ${'Add 110 grams (one-fourth of a pound) of almonds.'}     | ${'a fraction of a pound'}
    ${'It is 400 metres (a quarter of a mile) away.'}          | ${'a quarter of a mile'}
    ${'It is 2.4 kilometres (a mile and a half) away.'}        | ${'a mile and a half'}
    ${'It is 3.8 centimetres (about an inch and a half).'}      | ${'an inch and a half, rounded'}
    ${'Add 110 grams (a quarter pound) of almonds.'}           | ${'a quarter pound'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    unchanged                                        | why
    ${'It is **1.8 metres** (6 feet) tall.'}         | ${'bold'}
    ${'It is *1.8 metres* (6 feet) tall.'}           | ${'italic'}
    ${'It is __1.8 metres__ (6 feet) tall.'}         | ${'bold in underscores'}
    ${'It is _1.8 metres_ (6 feet) tall.'}           | ${'italic in underscores'}
    ${'It is ***1.8 metres*** (6 feet) tall.'}       | ${'bold italic'}
    ${'It is **_1.8 metres_** (6 feet) tall.'}       | ${'italic inside bold'}
    ${'It is `1.8 metres` (6 feet) tall.'}           | ${'code'}
    ${'It is **1.8 metres**\n(6 feet) tall.'}        | ${'bold and a wrapped line'}
    ${'Roll it **1.3 centimetres** (half an inch).'} | ${'bold and a written-out original'}
  `('leaves "$unchanged" alone with markup closing before the bracket ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, { syntax: 'markdown' })).toBe(unchanged);
  });

  it.each`
    input                                                      | expected                                                   | why
    ${'The rope is 2 metres long (the old one was ten feet).'} | ${'The rope is 2 metres long (the old one was 3 metres).'} | ${'a bracket that says more, in words'}
    ${'Gate A: 1 metre\n\n(3 feet) Gate B'}                    | ${'Gate A: 1 metre\n\n(91 centimetres) Gate B'}            | ${'a blank line ends the metric value'}
    ${'It is 1.8 metres\n\n(6 feet) tall.'}                    | ${'It is 1.8 metres\n\n(1.8 metres) tall.'}                | ${'the same'}
    ${'It is **1.8 metres**\n\n(6 feet) tall.'}                | ${'It is **1.8 metres**\n\n(1.8 metres) tall.'}            | ${'the same, after markup'}
    ${'It is 1.3 centimetres\n\n(half an inch) thick.'}        | ${'It is 1.3 centimetres\n\n(1.3 centimetres) thick.'}     | ${'the same, in words'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                     | expected                                                   | why
    ${'It weighs 2 metres (6 pounds).'}                       | ${'It weighs 2 metres (2.7 kilograms).'}                   | ${'a different dimension restates nothing'}
    ${'The rope is 2 metres long (the old one was 10 feet).'} | ${'The rope is 2 metres long (the old one was 3 metres).'} | ${'the bracket does not follow the metric value'}
    ${'It is 2 metres (the old one was 10 feet).'}            | ${'It is 2 metres (the old one was 3 metres).'}            | ${'the bracket holds more than a measurement'}
    ${'It is 2 metres (10 feet for the old one).'}            | ${'It is 2 metres (3 metres for the old one).'}            | ${'the same'}
    ${'Room 2 (6 feet) is free.'}                             | ${'Room 2 (1.8 metres) is free.'}                          | ${'a number without a metric unit'}
    ${'a 3 m (50 lb 3 oz) beam'}                              | ${'a 3 m (22.8 kg) beam'}                                  | ${'a weight converts after a length'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a value paired with its metric value by a slash or "or"', () => {
  it.each`
    unchanged                                         | why
    ${'Preheat the oven to 180°C/350°F (160°C fan).'} | ${'a slash'}
    ${'Heat to 180°C or 350°F.'}                      | ${'or'}
    ${'Preheat the oven to 180°C/350°F/gas 4.'}       | ${'the British trio'}
    ${'Preheat the oven to 180°C / 350°F / gas 4.'}   | ${'spaced'}
    ${'Preheat the oven to 180C/350F/gas 4.'}         | ${'the trio in bare forms'}
    ${'Heat to 180C or 350F.'}                        | ${'bare forms joined by or'}
    ${'Bake at 175-190°C/350-375°F.'}                 | ${'a range of temperatures'}
    ${'It is 5 cm/2 inches long.'}                    | ${'a length'}
    ${'It is 1.88 m/6 feet 2 inches tall.'}           | ${'no piece of feet and inches converts'}
    ${'a 2 m/6-foot fence'}                           | ${'attributive'}
    ${'a sheet of 22 x 28 cm/8.5 x 11 inches'}        | ${'dimensions'}
    ${'Add 500 g/1 pound of butter.'}                 | ${'a cook rounding, as a bracket allows'}
    ${'It goes 97 km/h or 60 mph.'}                   | ${'speed, with a slash in the metric unit'}
    ${'It does 7.8 L/100km/30 mpg.'}                  | ${'fuel economy, the same'}
    ${'It is 1.8 metres or\n6 feet tall.'}            | ${'a wrapped line'}
    ${'Preheat the oven to 350F/180C/gas 4.'}         | ${'a bare F beside a Celsius value is not read as Fahrenheit'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                        | expected                              | why
    ${'Bake at 350°F/180°C.'}                    | ${'Bake at 180°C.'}                   | ${'the imperial half goes'}
    ${'Bake at 350°F or 180°C.'}                 | ${'Bake at 180°C.'}                   | ${'or'}
    ${'Bake at 350°F / 180°C.'}                  | ${'Bake at 180°C.'}                   | ${'spaced'}
    ${'Preheat the oven to 350°F/180°C/gas 4.'}  | ${'Preheat the oven to 180°C/gas 4.'} | ${'the British trio'}
    ${'Bake at 350-375°F/175-190°C.'}            | ${'Bake at 175-190°C.'}               | ${'a range of temperatures'}
    ${'It dropped 20°F/11°C.'}                   | ${'It dropped 11°C.'}                 | ${'a change in temperature'}
    ${'It is 2 inches/5 cm long.'}               | ${'It is 5 cm long.'}                 | ${'a length'}
    ${'It is 6 feet 2 inches/1.88 m tall.'}      | ${'It is 1.88 m tall.'}               | ${'feet and inches'}
    ${'a 6-foot or 2-metre fence'}               | ${'a 2-metre fence'}                  | ${'attributive'}
    ${'a sheet of 8.5 x 11 inches/22 x 28 cm'}   | ${'a sheet of 22 x 28 cm'}            | ${'dimensions'}
    ${'Add 1 pound/500 g of butter.'}            | ${'Add 500 g of butter.'}             | ${'a cook rounding'}
    ${'It is 100 yards/91 meters long.'}         | ${'It is 91 metres long.'}            | ${'only the spelling is brought across'}
    ${'It goes 60 mph or 97 km/h.'}              | ${'It goes 97 km/h.'}                 | ${'speed'}
    ${'It does 30 mpg/7.8 L/100km.'}             | ${'It does 7.8 L/100km.'}             | ${'fuel economy'}
    ${'Cut 6 feet or 2 metres of rope.'}         | ${'Cut 2 metres of rope.'}            | ${'as close as 6 feet (2 m), which collapses too'}
    ${'It is 6 feet\n/1.8 m tall.'}              | ${'It is 1.8 m tall.'}                | ${'a wrapped line'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                         | expected                                        | why
    ${'Cut 6 feet or 3 metres of rope.'}          | ${'Cut 1.8 metres or 3 metres of rope.'}        | ${'two lengths that disagree'}
    ${'Cut 3 metres or 6 feet of rope.'}          | ${'Cut 3 metres or 1.8 metres of rope.'}        | ${'the same, metric first'}
    ${'Heat to 180°C or 400°F.'}                  | ${'Heat to 180°C or 205°C.'}                    | ${'two settings'}
    ${'Bake at 350°F/160°C.'}                     | ${'Bake at 175°C/160°C.'}                       | ${'a fan oven setting'}
    ${'It weighs 6 pounds/2 m.'}                  | ${'It weighs 2.7 kilograms/2 m.'}               | ${'a different dimension'}
    ${'It flows at 5 gallons/minute.'}            | ${'It flows at 19 litres/minute.'}              | ${'a slash between two units is a rate'}
    ${'Bake at 350°F or until golden.'}           | ${'Bake at 175°C or until golden.'}             | ${'or with no measurement after it'}
    ${'Gas mark 4 and 350°F are the same heat.'}  | ${'Gas mark 4 and 175°C are the same heat.'}    | ${'and is not a pair'}
    ${'It is 1.8 metres or\n\n6 feet tall.'}      | ${'It is 1.8 metres or\n\n1.8 metres tall.'}    | ${'a blank line ends the pair'}
    ${'It is 6 feet/\n\n1.8 m tall.'}             | ${'It is 1.8 metres/\n\n1.8 m tall.'}           | ${'the same, imperial first'}
    ${'Heat to 180°Cor 350°F.'}                   | ${'Heat to 180°Cor 175°C.'}                     | ${'or has to be a word of its own'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                    | expected
    ${'Bake at 175°C (350°F).'}              | ${'Bake at 175°C (350°F).'}
    ${'Bake at 350°F (175°C).'}              | ${'Bake at 175°C.'}
  `('reads a bracket the same way: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                         | expected
    ${'Preheat the oven to 180°C/350°F/gas 4.'}   | ${'Preheat the oven to 180°C/350°F/gas 4.'}
    ${'Preheat the oven to 350°F/180°C/gas 4.'}   | ${'Preheat the oven to 180°C/gas 4.'}
    ${'Heat to 180°C or 350°F.'}                  | ${'Heat to 180°C or 350°F.'}
    ${'It is 1.88 m/6 feet 2 inches tall.'}       | ${'It is 1.88 m/6 feet 2 inches tall.'}
    ${'Cut 6 feet or 3 metres of rope.'}          | ${'Cut 1.8 metres (6 feet) or 3 metres of rope.'}
    ${'Cut 3 metres or 6 feet of rope.'}          | ${'Cut 3 metres or 1.8 metres (6 feet) of rope.'}
  `('with keepOriginal, $input -> $expected and stays there', ({ input, expected }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(once).toBe(expected);
    expect(convert(once, options)).toBe(once);
  });
});

describe('markup on a measurement given in both systems', () => {
  it.each`
    input                                          | expected                           | why
    ${'It is **6 feet** (1.8 m) tall.'}            | ${'It is **1.8 m** tall.'}         | ${'bold closes on the metric value'}
    ${'It is 6 feet *(1.8 m)* tall.'}              | ${'It is 1.8 m tall.'}             | ${'emphasis on the bracket goes with it'}
    ${'It is 6 feet (*1.8 m*) tall.'}              | ${'It is 1.8 m tall.'}             | ${'emphasis inside the bracket goes too'}
    ${'It is **6 feet** *(1.8 m)* tall.'}          | ${'It is **1.8 m** tall.'}         | ${'both'}
    ${'It is **6 feet (1.8 m)** tall.'}            | ${'It is **1.8 m** tall.'}         | ${'bold around both'}
    ${'It is **6 feet**\n(1.8 m) tall.'}           | ${'It is **1.8 m** tall.'}         | ${'bold and a wrapped line'}
    ${'Bake at **350°F**/180°C.'}                  | ${'Bake at **180°C**.'}            | ${'a slash after bold'}
    ${'Bake at **350°F**/**180°C**.'}              | ${'Bake at **180°C**.'}            | ${'both values bold'}
    ${'Bake at 350°F (_175 degrees Celsius_).'}    | ${'Bake at 175 degrees Celsius.'}  | ${'an underscore after the written-out Celsius'}
    ${'It was **20°F** (11°C) warmer.'}            | ${'It was **11°C** warmer.'}       | ${'a change in temperature'}
    ${'It is 6 feet (1.8 m) tall.'}                | ${'It is 1.8 m tall.'}             | ${'no markup'}
    ${'Bake at 350°F/180°C.'}                      | ${'Bake at 180°C.'}                | ${'the same, joined by a slash'}
    ${'It is 6 feet\n\n(1.8 m) tall.'}             | ${'It is 1.8 metres\n\n(1.8 m) tall.'} | ${'a blank line ends the measurement'}
    ${'It is **6 feet**\n\n(1.8 m) tall.'}         | ${'It is **1.8 metres**\n\n(1.8 m) tall.'} | ${'the same, after bold'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
    expect(convert(input, { syntax: 'markdown' })).toBe(expected);
  });

  it.each`
    unchanged                                                    | why
    ${'It is <b>1.8 metres</b> (6 feet) tall.'}                  | ${'an HTML tag closes on the metric value'}
    ${'It is 1.8 metres <i>(6 feet)</i> tall.'}                  | ${'an HTML tag opens on the bracket'}
    ${'It is 1.8 metres *(6 feet)* tall.'}                       | ${'emphasis on the bracket'}
    ${'It is 1.8 metres (*6 feet*) tall.'}                       | ${'emphasis inside the bracket'}
    ${'It is 1.8 metres (about *6 feet*) tall.'}                 | ${'the same, after a word of approximation'}
    ${'Bake at _175 degrees Celsius_ (350 degrees Fahrenheit).'} | ${'an underscore after the written-out Celsius'}
    ${'Bake at _175 degrees C_ (350 degrees F).'}                | ${'the same, abbreviated'}
    ${'Bake at **180°C**/350°F.'}                                | ${'a slash after bold'}
    ${'Bake at **180°C**/**350°F**.'}                            | ${'both values bold'}
    ${'Bake at <b>180°C</b>/350°F.'}                             | ${'a slash after an HTML tag'}
    ${'It is <b>6 feet</b> (1.8 m) tall.'}                       | ${'no change can rewrite across a tag, so the pair is held'}
    ${'It is <b>6 feet 2 inches</b> (1.88 m) tall.'}             | ${'the same, and no piece of it converts'}
    ${'Bake at <b>350°F</b>/180°C.'}                             | ${'the same, joined by a slash'}
    ${'It is **1.8 metres** (6 feet) tall.'}                     | ${'bold closes on the metric value'}
    ${'Bake at 180°C/350°F.'}                                    | ${'no markup'}
    ${'Bake at 175°C (350°F).'}                                  | ${'the same, in brackets'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, { syntax: 'markdown' })).toBe(unchanged);
  });

  it.each`
    input                                                      | expected                                                   | why
    ${'The rope is 2 metres long (the old one was ten feet).'} | ${'The rope is 2 metres long (the old one was 3 metres).'} | ${'a bracket that says more'}
    ${'It is 1.8 metres (*6 feet* for the old one) tall.'}     | ${'It is 1.8 metres (*1.8 metres* for the old one) tall.'} | ${'the same, with emphasis inside'}
    ${'It is <div>1.8 metres</div> (6 feet) tall.'}            | ${'It is <div>1.8 metres</div> (1.8 metres) tall.'}        | ${'a block tag ends the metric value'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
    expect(convert(input, { syntax: 'markdown' })).toBe(expected);
  });

  it('holds only the imperial value of a pair it cannot collapse across a tag', () => {
    expect(deamericaniseText('It is <b>6 feet</b> (1.8 meters) tall.')).toBe(
      'It is <b>6 feet</b> (1.8 metres) tall.',
    );
  });
});

describe('a Celsius value written with a bare C', () => {
  it.each`
    input                               | expected                  | why
    ${'Bake at 350°F (180C).'}          | ${'Bake at 180C.'}        | ${'in brackets after the Fahrenheit value'}
    ${'Bake at 350°F (180 C).'}         | ${'Bake at 180 C.'}       | ${'after one space'}
    ${'Bake at 350°F/180C.'}            | ${'Bake at 180C.'}        | ${'after a slash'}
    ${'Bake at 350°F or 180C.'}         | ${'Bake at 180C.'}        | ${'after or'}
    ${'Bake at 350-375°F (175-190C).'}  | ${'Bake at 175-190C.'}    | ${'a range'}
    ${'Bake at 350°F (2 kg).'}          | ${'Bake at 175°C (2 kg).'} | ${'a weight is no Celsius value'}
    ${'It was 20°F (11C) warmer.'}      | ${'It was 11C warmer.'}   | ${'a change in temperature'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                     | why
    ${'Bake at 180C (350°F).'}                    | ${'the Fahrenheit value restates it in brackets'}
    ${'Preheat the oven to 180C/350°F/gas 4.'}    | ${'the British trio with a marked Fahrenheit value'}
    ${'Heat to 180C or 350°F.'}                   | ${'joined by or'}
    ${'Preheat the oven to 180C/350F/gas 4.'}     | ${'the trio in bare forms'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                  | expected                                    | why
    ${'Apartment 3C (65°F) is warm.'}      | ${'Apartment 3C (18.3°C) is warm.'}         | ${'one figure before C is a flat'}
    ${'The A330-200C (65°F) is parked.'}   | ${'The A330-200C (18.3°C) is parked.'}      | ${'a designation'}
    ${'Bake at 350°F (180c).'}             | ${'Bake at 175°C (180c).'}                  | ${'a lower case c'}
    ${'Bake at 350°F (180  C).'}           | ${'Bake at 175°C (180  C).'}                | ${'more than one space'}
  `('does not read a bare C in $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a temperature with a degree sign before two slashes is no path', () => {
  it.each`
    input                                        | expected                              | why
    ${'Cook it at 225°F/low/slow.'}              | ${'Cook it at 105°C/low/slow.'}       | ${'two words after it'}
    ${'Set it to 350°F/fan/bake.'}               | ${'Set it to 175°C/fan/bake.'}        | ${'the same'}
    ${'Preheat the oven to 350°F/180C/gas 4.'}   | ${'Preheat the oven to 180C/gas 4.'}  | ${'the British trio with a bare C'}
    ${'Cook it at 225°F/low.'}                   | ${'Cook it at 105°C/low.'}            | ${'one word after it'}
    ${'Cook it at 225°F / low / slow.'}          | ${'Cook it at 105°C / low / slow.'}   | ${'spaced'}
    ${'Preheat the oven to 350°F/180°C/gas 4.'}  | ${'Preheat the oven to 180°C/gas 4.'} | ${'the trio with both values marked'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                     | why
    ${'Preheat the oven to 180°C/350°F/gas 4.'}   | ${'the Fahrenheit value restates the Celsius one'}
    ${'Preheat the oven to 180C/350°F/gas 4.'}    | ${'the same, after a bare C'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

/** The alternatives at the top level of a pattern's source. */
function topLevelAlternatives(source: string): string[] {
  const alternatives = [''];
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    let token = source[i]!;
    if (token === '\\') token += source[++i];
    else if (inClass) inClass = token !== ']';
    else if (token === '[') inClass = true;
    else if (token === '(') depth++;
    else if (token === ')') depth--;
    else if (token === '|' && depth === 0) {
      alternatives.push('');
      continue;
    }
    alternatives[alternatives.length - 1] += token;
  }
  return alternatives;
}

describe('a Celsius value in each form a Fahrenheit value is read in', () => {
  // Each Fahrenheit form, then the Celsius form written the same way.
  const FORMS = [
    ['°F', '°C'],
    ['ºF', 'ºC'],
    ['˚F', '˚C'],
    ['℉', '℃'],
    ['°Fahrenheit', '°Celsius'],
    [' degrees Fahrenheit', ' degrees Celsius'],
    [' degrees F', ' degrees C'],
    [' deg F', ' deg C'],
    [' deg. F', ' deg. C'],
    ['degF', 'degC'],
    [' Fahrenheit', ' Celsius'],
  ];

  it('pairs every form of FAHRENHEIT with a Celsius form', () => {
    for (const alternative of topLevelAlternatives(FAHRENHEIT)) {
      const form = new RegExp(`(?:${alternative})$`, 'i');
      expect(FORMS.some(([fahrenheit]) => form.test(`350${fahrenheit}`)), alternative).toBe(true);
    }
  });

  it.each(FORMS)('leaves 350%s alone after the 180%s it restates', (fahrenheit, celsius) => {
    for (const unchanged of [
      `Bake at 180${celsius} (350${fahrenheit}).`,
      `Bake at 180${celsius}/350${fahrenheit}.`,
      `Heat to 180${celsius} or 350${fahrenheit}.`,
    ]) {
      expect(convert(unchanged)).toBe(unchanged);
    }
  });

  it.each(FORMS)('collapses 350%s into the 180%s after it', (fahrenheit, celsius) => {
    expect(convert(`Bake at 350${fahrenheit} (180${celsius}).`)).toBe(`Bake at 180${celsius}.`);
    expect(convert(`Bake at 350${fahrenheit}/180${celsius}.`)).toBe(`Bake at 180${celsius}.`);
  });

  it.each`
    input                                        | expected
    ${'Bake at 350°F (180 degrees centigrade).'} | ${'Bake at 180 degrees centigrade.'}
    ${'Bake at 350°F (180 centigrade).'}         | ${'Bake at 180 centigrade.'}
    ${'Bake at 350°F (180 degrees Centigrade).'} | ${'Bake at 180 degrees Centigrade.'}
    ${'Bake at 180 centigrade (350°F).'}         | ${'Bake at 180 centigrade (350°F).'}
    ${'Bake at 180 degrees centigrade/350°F.'}   | ${'Bake at 180 degrees centigrade/350°F.'}
    ${'Bake at 350°F (160℃).'}                   | ${'Bake at 175°C (160℃).'}
    ${'Bake at 350°F (2 kg).'}                   | ${'Bake at 175°C (2 kg).'}
    ${'Bake at 350 deg F.'}                      | ${'Bake at 175°C.'}
    ${'Bake at 175°C (350°F).'}                  | ${'Bake at 175°C (350°F).'}
    ${'Bake at 350°F (160°C).'}                  | ${'Bake at 175°C (160°C).'}
  `('reads centigrade too, and no further: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('fastener sizes are designations, not measurements', () => {
  it.each`
    unchanged                                      | why
    ${'a 3/8 inch bolt'}                           | ${'there is no 9.5 mm bolt'}
    ${'the 1/2 inch nut'}                          | ${'same'}
    ${'a 9/16 inch wrench'}                        | ${'tools are sized to the fastener'}
    ${'a 1/4 inch socket'}                         | ${'same'}
    ${'a 3/8 inch drive ratchet'}                  | ${'same'}
    ${'a 1/8 inch drill bit'}                      | ${'bits come in fractional sizes'}
    ${'1/4 inch threads'}                          | ${'same'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('leaves a sentence mixing both systems exactly as written', () => {
    const input = 'Fit a 10 mm bolt on one side and a 3/8 inch bolt on the other.';
    expect(convert(input)).toBe(input);
  });

  it('still converts a real thickness', () => {
    expect(convert('The sheet is 1/16 inch thick.')).toBe('The sheet is 1.6 millimetres thick.');
  });
});

describe('a singular unit modifying a noun stays singular', () => {
  it.each`
    input                     | expected                   | why
    ${'a 6 foot fence'}       | ${'a 1.8 metre fence'}     | ${'attributive'}
    ${'a 9 inch dish'}        | ${'a 23 centimetre dish'}  | ${'attributive'}
    ${'6 feet of rope'}       | ${'1.8 metres of rope'}    | ${'a plural source stays plural'}
    ${'1/2 gallon of milk'}   | ${'1.9 litres of milk'}    | ${'a preposition, not a noun'}
    ${'1/16 inch thick'}      | ${'1.6 millimetres thick'} | ${'a dimension adjective, not a noun'}
    ${'5 inches of rain'}     | ${'13 centimetres of rain'} | ${'plural source'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('numbers written out in words', () => {
  // Cups are switched on here because they are the natural example of a written-out
  // measure, not because they convert by default.
  const spelled = (input: string) =>
    convert(input, { rules: { 'units.volume.cup': true, 'units.volume.teaspoon': true } });

  it.each`
    input                              | expected
    ${'one cup of suet'}               | ${'240 millilitres of suet'}
    ${'two cups of cider'}             | ${'470 millilitres of cider'}
    ${'one-half cup of citron'}        | ${'120 millilitres of citron'}
    ${'three-quarters cup of syrup'}   | ${'180 millilitres of syrup'}
    ${'one and one-half cups of sugar'} | ${'350 millilitres of sugar'}
    ${'one-quarter pound of citron'}   | ${'110 grams of citron'}
    ${'two thirds cup'}                | ${'160 millilitres'}
    ${'six feet tall'}                 | ${'1.8 metres tall'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(spelled(input)).toBe(expected);
  });

  it.each`
    unchanged              | why
    ${'six eggs'}          | ${'not a unit'}
    ${'one of the best'}   | ${'not a measurement'}
    ${'one thing at a time'} | ${'not a measurement'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input             | expected            | why
    ${'5-10 feet'}    | ${'1.5-3 metres'}   | ${'a hyphen between digits is still a range'}
    ${'5 to 10 miles'} | ${'8 to 16 kilometres'} | ${'as is "to"'}
    ${'10 x 12 feet'} | ${'3 x 3.7 metres'} | ${'and dimensions still pair up'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a written-out number of two words', () => {
  it.each`
    input                                     | expected                     | why
    ${'twenty-two pounds of beef'}            | ${'10 kilograms of beef'}    | ${'joined by a hyphen'}
    ${'twenty two pounds of beef'}            | ${'10 kilograms of beef'}    | ${'joined by a space'}
    ${'thirty-five miles away'}               | ${'56 kilometres away'}      | ${'before a direction'}
    ${'ninety-nine feet'}                     | ${'30 metres'}               | ${'the largest pair'}
    ${'Twenty-One miles'}                     | ${'34 kilometres'}           | ${'in capitals'}
    ${'twenty-two and a half miles'}          | ${'36 kilometres'}           | ${'before "and a half"'}
    ${'twenty two and one-half miles'}        | ${'36 kilometres'}           | ${'the same, spaced, with a counted half'}
    ${'twenty-one and three-quarters inches'} | ${'55 centimetres'}          | ${'before a counted fraction'}
    ${'twenty-two miles and a half'}          | ${'36 kilometres'}           | ${'with the fraction after the unit'}
    ${'a twenty-two pound turkey'}            | ${'a 10 kilogram turkey'}    | ${'attributive'}
    ${'a forty-five-mile drive'}              | ${'a 72 kilometre drive'}    | ${'attributive, hyphenated to its unit'}
    ${'twenty two\nmiles'}                    | ${'35 kilometres'}           | ${'the unit may wrap onto the next line'}
    ${'twenty\n\ntwo miles'}                  | ${'twenty\n\n3.2 kilometres'} | ${'a blank line makes the second word a number of its own'}
    ${'twenty miles'}                         | ${'32 kilometres'}           | ${'a tens word on its own still reads'}
    ${'twenty and a half pounds'}             | ${'9.3 kilograms'}           | ${'the same, before "and a half"'}
    ${'two and a half feet'}                  | ${'76 centimetres'}          | ${'a units word on its own still reads'}
    ${'a half-mile'}                          | ${'800 metres'}              | ${'a hyphen after a fraction word is not a compound'}
    ${'5-10 feet'}                            | ${'1.5-3 metres'}            | ${'a hyphen between digits is still a range'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                              | expected                         | why
    ${'one-half cup of citron'}        | ${'120 millilitres of citron'}   | ${'a hyphen before a fraction word is one number'}
    ${'three-quarters cup of syrup'}   | ${'180 millilitres of syrup'}    | ${'the same, with a plural'}
  `('$input -> $expected with cups switched on ($why)', ({ input, expected }) => {
    expect(convert(input, { rules: { 'units.volume.cup': true } })).toBe(expected);
  });

  it.each`
    unchanged                               | why
    ${'catch-twenty-two miles'}             | ${'a hyphenated word the table cannot read'}
    ${'fifty-fifty miles'}                  | ${'a pair of tens words'}
    ${'twenty-one-half miles'}              | ${'a pair before a fraction word'}
    ${'twenty five-pound bags'}             | ${'twenty bags or one weight'}
    ${'twenty three-quarters inch'}         | ${'the same, before a fraction'}
    ${'twenty three-quarters of a mile'}    | ${'the same, with the unit inside the number'}
    ${'catch-twenty-two pounds and a half'} | ${'the same, with the fraction after the unit'}
    ${'twenty\ntwo miles'}                  | ${'the units word is cut off from its tens'}
    ${'twenty-\ntwo miles'}                 | ${'the same, after a hyphen'}
    ${'It cost twenty-two pounds.'}         | ${'money, read as a whole number'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    words                      | value
    ${'twenty-two'}            | ${22}
    ${'twenty two'}            | ${22}
    ${'Ninety-Nine'}           | ${99}
    ${'twenty-two and a half'} | ${22.5}
    ${'twenty-three quarters'} | ${5.75}
  `('reads "$words" as $value', ({ words, value }) => {
    expect(parseNumber(words)).toBe(value);
  });
});

describe('a written-out number with hundred or thousand', () => {
  it.each`
    input                                         | expected                     | why
    ${'one hundred and twenty feet'}              | ${'37 metres'}               | ${'with "and"'}
    ${'one hundred twenty feet'}                  | ${'37 metres'}               | ${'without "and"'}
    ${'two hundred and fifty pounds of flour'}    | ${'110 kilograms of flour'}  | ${'before "of"'}
    ${'five thousand and twenty feet'}            | ${'1.5 kilometres'}          | ${'thousand'}
    ${'one hundred and twenty-five miles'}        | ${'200 kilometres'}          | ${'a cardinal of two words after "and"'}
    ${'one hundred twenty two feet'}              | ${'37 metres'}               | ${'the same, spaced, without "and"'}
    ${'a hundred miles'}                          | ${'160 kilometres'}          | ${'counted by "a"'}
    ${'a thousand feet'}                          | ${'300 metres'}              | ${'the same, for thousand'}
    ${'two thousand five hundred feet'}           | ${'760 metres'}              | ${'hundreds after thousands'}
    ${'two thousand five hundred and fifty feet'} | ${'780 metres'}              | ${'and a cardinal after both'}
    ${'twenty-two hundred feet'}                  | ${'670 metres'}              | ${'a count of two words'}
    ${'Two Hundred Miles'}                        | ${'320 kilometres'}          | ${'in capitals'}
    ${'He weighs two hundred pounds.'}            | ${'He weighs 91 kilograms.'} | ${'a weight with no money in sight'}
    ${'a hundred-foot tree'}                      | ${'a 30 metre tree'}         | ${'attributive'}
    ${'a two-hundred-foot cliff'}                 | ${'a 61 metre cliff'}        | ${'attributive, hyphenated throughout'}
    ${'a hundred and twenty-foot drop'}           | ${'a 37 metre drop'}         | ${'"and" makes the hyphenated cardinal part of the number'}
    ${'a hundred\nmiles'}                         | ${'160 kilometres'}          | ${'the unit may wrap onto the next line'}
    ${'a hundred miles and a half'}               | ${'160 kilometres'}          | ${'with the fraction after the unit'}
    ${'two hundred pounds eight ounces'}          | ${'90.9 kilograms'}          | ${'a weight in two units'}
    ${'twenty-two pounds of beef'}                | ${'10 kilograms of beef'}    | ${'a cardinal of two words on its own still reads'}
    ${'two and a half feet'}                      | ${'76 centimetres'}          | ${'as does "and a half"'}
    ${'between one hundred and two hundred miles'} | ${'between 160 and 320 kilometres'} | ${'a range, whose second end follows "hundred and"'}
    ${'one hundred to two hundred miles'}         | ${'160 to 320 kilometres'}   | ${'the same, with "to"'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                     | why
    ${'hundreds of miles'}                        | ${'a plural is not a number'}
    ${'a few hundred feet'}                       | ${'no count before the multiplier'}
    ${'twenty-two hundred hours'}                 | ${'a time'}
    ${'one hundred and a half feet'}              | ${'a fraction is never what follows the multiplier'}
    ${'one hundred and twenty and a half feet'}   | ${'nor after the cardinal that follows it'}
    ${'two thousand and five hundred feet'}       | ${'"and" before a second multiplier'}
    ${'a hundred thousand miles'}                 | ${'a multiplier counted by a multiplier'}
    ${'one thousand, two hundred feet'}           | ${'a comma between the parts'}
    ${'two hundred two-foot boards'}              | ${'two hundred boards or one length'}
    ${'one hundred twenty-foot drop'}             | ${'the same, for a tens word'}
    ${'one hundred\ntwenty feet'}                 | ${'the cardinal is cut off from its multiplier'}
    ${'one hundred and\ntwenty feet'}             | ${'the same, after "and"'}
    ${'It cost two hundred and fifty pounds.'}    | ${'money, read whole'}
    ${'She earns forty thousand pounds a year.'}  | ${'a rate of pay'}
    ${'a hundred-pound note'}                     | ${'a thing priced in pounds'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    words                          | value
    ${'a hundred'}                 | ${100}
    ${'one hundred and twenty'}    | ${120}
    ${'one hundred twenty-two'}    | ${122}
    ${'two thousand five hundred'} | ${2500}
    ${'five thousand and twenty'}  | ${5020}
    ${'twenty-two hundred'}        | ${2200}
    ${'hundred'}                   | ${null}
  `('reads "$words" as $value', ({ words, value }) => {
    expect(parseNumber(words)).toBe(value);
  });
});

describe('a range with an end in words', () => {
  it.each`
    input                                | expected                           | why
    ${'five to 10 miles'}                | ${'8 to 16 kilometres'}            | ${'the first end in words'}
    ${'10 to twelve miles'}              | ${'16 to 19 kilometres'}           | ${'the second end in words'}
    ${'five to ten miles'}               | ${'8 to 16 kilometres'}            | ${'both ends'}
    ${'between one and two pounds'}      | ${'between 450 and 910 grams'}     | ${'"and" after "between"'}
    ${'twenty-two to thirty miles'}      | ${'35 to 48 kilometres'}           | ${'a cardinal of two words'}
    ${'one hundred to two hundred feet'} | ${'30 to 61 metres'}               | ${'the second end after "hundred to"'}
    ${'ten to a hundred feet'}           | ${'3 to 30 metres'}                | ${'a hundred counted by "a"'}
    ${'from five to six feet'}           | ${'from 1.5 to 1.8 metres'}        | ${'opened by "from"'}
    ${'five to\nten miles'}              | ${'8 to 16 kilometres'}            | ${'broken at its "to"'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                         | expected                             | why
    ${'one and two pounds'}                                       | ${'one and 910 grams'}               | ${'"and" without "between" joins no range in words'}
    ${'between one hundred and twenty feet and two hundred feet'} | ${'between 37 metres and 61 metres'} | ${'"and" inside one number'}
    ${'reduce by half to 2 quarts'}                               | ${'reduce by half to 1.9 litres'}    | ${'"half to" is an idiom'}
    ${'twenty-two miles'}                                         | ${'35 kilometres'}                   | ${'a hyphen inside a cardinal'}
    ${'one-half inch'}                                            | ${'1.3 centimetres'}                 | ${'a hyphen inside a fraction'}
    ${'5-10 feet'}                                                | ${'1.5-3 metres'}                    | ${'a dash between digits'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                 | why
    ${'five-10 miles'}                        | ${'a dash after a number in words'}
    ${'10-twelve miles'}                      | ${'a dash before one'}
    ${'five - ten miles'}                     | ${'a spaced dash between words'}
    ${'twenty-5 miles'}                       | ${'a dash after a tens word'}
    ${'two and a half to three miles'}        | ${'a fraction in words at the first end'}
    ${'one to one and a half miles'}          | ${'the same at the second end'}
    ${'two to three hundred feet'}            | ${'which may mean 200 to 300'}
    ${'between two and three hundred feet'}   | ${'the same, with "and"'}
    ${'It cost between one and two pounds.'}  | ${'money'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a fraction word that is also an ordinal', () => {
  const cups = (input: string) => convert(input, { rules: { 'units.volume.cup': true } });

  it.each`
    unchanged                          | why
    ${'the third mile marker'}         | ${'"the" makes it an ordinal'}
    ${'the third mile'}                | ${'the same, at the end of the text'}
    ${'every third mile'}              | ${'"every" as well'}
    ${'his third pound'}               | ${'a possessive as well'}
    ${'every third pound of meat'}     | ${'the same, before "of"'}
    ${'the fourth inch'}               | ${'"fourth" too'}
    ${'the eighth inch'}               | ${'"eighth" too'}
    ${'the sixteenth inch'}            | ${'"sixteenth" too'}
    ${'the third-mile marker'}         | ${'hyphenated'}
    ${'third mile'}                    | ${'with nothing before it'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    unchanged                          | why
    ${'their fourth cup of coffee'}    | ${'an ordinal cup'}
    ${'the third cup of coffee'}       | ${'the same'}
  `('leaves "$unchanged" alone with cups switched on ($why)', ({ unchanged }) => {
    expect(cups(unchanged)).toBe(unchanged);
  });

  it.each`
    input                              | expected                   | why
    ${'a third of a mile'}             | ${'540 metres'}            | ${'"a" counts it'}
    ${'a third mile'}                  | ${'540 metres'}            | ${'the same, without "of"'}
    ${'one-third mile'}                | ${'540 metres'}            | ${'"one" counts it'}
    ${'one third mile'}                | ${'540 metres'}            | ${'the same, with a space'}
    ${'the one-third mile marker'}     | ${'the 540 metre marker'}  | ${'a count after "the" is still a fraction'}
    ${'a third-mile loop'}             | ${'a 540 metre loop'}      | ${'attributive'}
    ${'the last third of a mile'}      | ${'the last 540 metres'}   | ${'"of a" makes even a bare one a fraction'}
    ${'one-fourth pound of butter'}    | ${'110 grams of butter'}   | ${'"fourth" is a fraction word'}
    ${'a fourth of a pound'}           | ${'110 grams'}             | ${'the same, with "of a"'}
    ${'three fourths of a mile'}       | ${'1.2 kilometres'}        | ${'a plural'}
    ${'a fourth-inch gap'}             | ${'a 6.4 millimetre gap'}  | ${'attributive'}
    ${'an eighth inch'}                | ${'3.2 millimetres'}       | ${'"an" counts it'}
    ${'three and a third miles'}       | ${'5.4 kilometres'}        | ${'after a whole number'}
    ${'the last quarter mile'}         | ${'the last 400 metres'}   | ${'"quarter" is never an ordinal'}
    ${'half mile'}                     | ${'800 metres'}            | ${'nor is "half"'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                              | expected                   | why
    ${'two thirds of a cup'}           | ${'160 millilitres'}       | ${'a counted plural'}
    ${'three-fourths cup'}             | ${'180 millilitres'}       | ${'"fourths"'}
    ${'one and three-fourths cups'}    | ${'410 millilitres'}       | ${'after a whole number'}
    ${'two and a fourth cups'}         | ${'530 millilitres'}       | ${'the same, with "a"'}
  `('$input -> $expected with cups switched on ($why)', ({ input, expected }) => {
    expect(cups(input)).toBe(expected);
  });
});

describe('a fraction after a counted unit', () => {
  it.each`
    input                                       | expected                     | why
    ${'two pounds and a half of sugar'}         | ${'1.1 kilograms of sugar'}  | ${'a word number'}
    ${'2 pounds and a half of sugar'}           | ${'1.1 kilograms of sugar'}  | ${'digits'}
    ${'two miles and a half'}                   | ${'4 kilometres'}            | ${'at the end of the text'}
    ${'five miles and a half away'}             | ${'8.9 kilometres away'}     | ${'before a direction'}
    ${'three feet and a half'}                  | ${'1.1 metres'}              | ${'feet'}
    ${'two pounds and a quarter'}               | ${'1 kilogram'}              | ${'a quarter'}
    ${'two gallons and a third'}                | ${'8.8 litres'}              | ${'a third'}
    ${'a pound and a fourth'}                   | ${'570 grams'}               | ${'a fourth, after "a"'}
    ${'two pounds and three quarters of sugar'} | ${'1.2 kilograms of sugar'}  | ${'a counted fraction'}
    ${'about a mile and a half'}                | ${'about 2.4 kilometres'}    | ${'"a" still counts one'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                              | why
    ${'two pounds and a half hour later'}  | ${'910 grams and a half hour later'}  | ${'the half belongs to the hour'}
    ${'two pounds\nand a half'}            | ${'910 grams\nand a half'}            | ${'the fraction is on the next line'}
    ${'1 1/2 pounds and a half'}           | ${'680 grams and a half'}             | ${'the 2 of 1 1/2 is not a count'}
    ${'between 5 and 10 miles and a half'} | ${'between 8 and 16 kilometres and a half'} | ${'nor is the end of a range'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('tons, when the document says which kind', () => {
  it.each`
    input                                                        | expected                                                     | why
    ${'The mine ships 5,000 tons a year.'}                       | ${'The mine ships 4500 tonnes a year.'}                      | ${'a US document means short tons'}
    ${'Data in thousand metric tons. The mine ships 5,000 tons.'} | ${'Data in thousand metric tons. The mine ships 5,000 tons.'} | ${'this one already said metric'}
    ${'Figures in tonnes. It moved 900 tons.'}                   | ${'Figures in tonnes. It moved 900 tons.'}                    | ${'same'}
  `('$why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('pounds of money are not weights', () => {
  it.each`
    unchanged                                                  | why
    ${'It cost 500 pounds.'}                                   | ${'a money verb governs the amount'}
    ${'It cost 500 pounds sterling.'}                          | ${'sterling'}
    ${'It cost 500 pounds in London.'}                         | ${'a money verb, with more after'}
    ${'It cost him nearly 500 pounds.'}                        | ${'a pronoun and a hedge between'}
    ${'We paid a total of 500 pounds.'}                        | ${'an article with a filler after it'}
    ${'I paid 10 pounds for it.'}                              | ${'paid'}
    ${'He owes me 50 pounds.'}                                 | ${'owes'}
    ${'Can you lend me 20 pounds?'}                            | ${'lend'}
    ${'She won 100 pounds on the lottery.'}                    | ${'won'}
    ${'We raised 2,000 pounds for charity.'}                   | ${'raised'}
    ${'He has saved 500 pounds.'}                              | ${'saved'}
    ${'He bet 50 pounds on the horse.'}                        | ${'bet'}
    ${'He was fined 200 pounds.'}                              | ${'fined'}
    ${"It's worth 300 pounds."}                                | ${'worth'}
    ${'The painting sold for 2,000 pounds.'}                   | ${'sold for'}
    ${'I bought it for 10 pounds.'}                            | ${'bought it for'}
    ${'He was given a fine of 200 pounds.'}                    | ${'a money noun and a linking word'}
    ${'a fine of up to 200 pounds'}                            | ${'the same, with a hedge'}
    ${'They fine you 50 pounds.'}                              | ${'fine as a verb'}
    ${'The fare is 3 pounds.'}                                 | ${'fare'}
    ${'The tickets are 20 pounds.'}                            | ${'tickets'}
    ${'a salary of 45,000 pounds'}                             | ${'salary'}
    ${'The budget is 500 pounds.'}                             | ${'budget'}
    ${'The prize is 1,000 pounds.'}                            | ${'prize'}
    ${'Price: 20 pounds'}                                      | ${'a money noun and a colon'}
    ${'She earns 30,000 pounds a year.'}                       | ${'a rate of pay'}
    ${'Rent is 900 pounds a month.'}                           | ${'a rent'}
    ${'I get paid 12 pounds an hour.'}                         | ${'an hourly rate'}
    ${'fees of up to 9,250 pounds per year'}                   | ${'a rate with per'}
    ${'It was 5 pounds 50.'}                                   | ${'pence after the pounds'}
    ${"That's 3 pounds 99p."}                                  | ${'pence with p'}
    ${"It's two pounds fifty."}                                | ${'pence in words'}
    ${'It costs 3 pounds and 50 pence.'}                       | ${'pence written out'}
    ${"5 pounds' worth of sweets"}                             | ${'worth after the unit'}
    ${'I spent 10 pounds of my own money.'}                    | ${'of names money'}
    ${'50 pounds in cash'}                                     | ${'cash'}
    ${'a 5-pound note'}                                        | ${'a thing priced in pounds'}
    ${'a ten-pound note'}                                      | ${'the same, in words'}
    ${'two 10-pound notes'}                                    | ${'the same, plural'}
    ${'a 100-pound fine'}                                      | ${'a fine'}
    ${'a 20-pound voucher'}                                    | ${'a voucher'}
    ${'It cost £5 pounds.'}                                    | ${'a £ on the number itself'}
    ${'Prices range from £5 to 20 pounds.'}                    | ${'a £ on the range'}
    ${'Tickets are £10 for adults and 5 pounds for children.'} | ${'a £ in the sentence'}
    ${'The house sold for a million pounds.'}                  | ${'a scale word is not read as a number'}
    ${'She paid 2 million pounds.'}                            | ${'the same'}
    ${'It cost a hundred pounds.'}                             | ${'a hundred, read whole, is still money'}
    ${'It only costs a few pounds.'}                           | ${'no number at all'}
    ${'It costs $4 per pound.'}                                | ${'a price per weight has no number before the unit'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                                       | expected                                                     | why
    ${'He lost 20 pounds.'}                                     | ${'He lost 9.1 kilograms.'}                                  | ${'no money in sight'}
    ${'It weighs 500 pounds.'}                                  | ${'It weighs 230 kilograms.'}                                | ${'the same'}
    ${'a 5-pound bag of flour'}                                 | ${'a 2.3 kilogram bag of flour'}                             | ${'the same'}
    ${'It cost $20 for 5 pounds of beef.'}                      | ${'It cost $20 for 2.3 kilograms of beef.'}                  | ${'cost already has its amount'}
    ${'It cost $20 for 5 pounds.'}                              | ${'It cost $20 for 2.3 kilograms.'}                          | ${'the same, with nothing after'}
    ${'I paid 10 pounds for 5 pounds of beef.'}                 | ${'I paid 10 pounds for 2.3 kilograms of beef.'}             | ${'each amount has its own money word or none'}
    ${'He weighs 180 pounds and earns 30,000 pounds a year.'}   | ${'He weighs 82 kilograms and earns 30,000 pounds a year.'}  | ${'the same'}
    ${'The cost of 10 pounds of potatoes rose.'}                | ${'The cost of 4.5 kilograms of potatoes rose.'}             | ${'of potatoes outranks cost'}
    ${'Aim to lose 2 pounds a week.'}                           | ${'Aim to lose 910 grams a week.'}                           | ${'a weight verb outranks a rate'}
    ${'1 pound 85% lean ground beef'}                           | ${'450 grams 85% lean ground beef'}                          | ${'a number after the unit is not pence'}
    ${'won a 20-pound salmon'}                                  | ${'won a 9.1 kilogram salmon'}                               | ${'the article belongs to the salmon'}
    ${'It cost £20 for 5 pounds of beef.'}                      | ${'It cost £20 for 2.3 kilograms of beef.'}                  | ${'of beef outranks the £'}
    ${'It cost £3 and weighed 5 pounds.'}                       | ${'It cost £3 and weighed 2.3 kilograms.'}                   | ${'weighed outranks the £'}
    ${'The 20-pound turkey cost £40.'}                          | ${'The 9.1 kilogram turkey cost £40.'}                       | ${'a size outranks the £'}
    ${'Beef is £4 a pound, so 3 pounds comes to £12.'}          | ${'Beef is £4 a pound, so 1.4 kilograms comes to £12.'}      | ${'a price by the pound'}
    ${'It cost £3. The bag held 5 pounds.'}                     | ${'It cost £3. The bag held 2.3 kilograms.'}                 | ${'the £ is in another sentence'}
    ${'Prices are £4 for 2 lb.'}                                | ${'Prices are £4 for 910 g.'}                                | ${'an abbreviation is never money'}
    ${'It cost 500 lbs.'}                                       | ${'It cost 230 kg.'}                                         | ${'the same, after a money verb'}
    ${'I want to lose 2 pounds a week.'}                        | ${'I want to lose 910 grams a week.'}                        | ${'a weight verb outranks a rate'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves money alone when respectConventions is off', () => {
    const options = { units: { respectConventions: false } };
    expect(convert('It cost 500 pounds.', options)).toBe('It cost 500 pounds.');
  });

  /** The spans the unit rules hold as written in `text`. */
  const held = (text: string, options: Options = {}): string[] => {
    const resolved = resolveOptions(options);
    const ctx: RuleContext = { text, options: resolved, signals: analyse(text), american: true };
    return patternRules(resolved)
      .flatMap((rule) => rule.find(ctx))
      .filter((c) => c.hold)
      .map((c) => c.before);
  };

  it.each`
    input                               | amount             | why
    ${'It cost 500 pounds.'}            | ${'500 pounds'}    | ${'a single amount'}
    ${'It cost 911 pounds.'}            | ${'911 pounds'}    | ${'a number that is also an emergency number'}
    ${'It cost 10-20 pounds.'}          | ${'10-20 pounds'}  | ${'a range'}
    ${'The tickets are 2 x 10 pounds.'} | ${'2 x 10 pounds'} | ${'a dimension'}
    ${'It cost half a pound.'}          | ${'half a pound'}  | ${'a written-out quantity'}
  `('holds $amount whole, so no rule can rewrite part of it ($why)', ({ input, amount }) => {
    expect(held(input)).toContain(amount);
    expect(held(input, { units: { respectConventions: false } })).toContain(amount);
  });

  it.each`
    input                                      | dialect
    ${'It cost 911 pounds.'}                   | ${'en-AU'}
    ${'It cost 911 pounds.'}                   | ${'en-GB'}
    ${'The prize is 911 pounds and a trophy.'} | ${'en-AU'}
  `('leaves "$input" whole in $dialect under localise', ({ input, dialect }) => {
    expect(deamericaniseText(input, { preset: 'localise', dialect })).toBe(input);
    expect(
      deamericaniseText(input, { preset: 'localise', dialect, units: { respectConventions: false } }),
    ).toBe(input);
  });
});

describe('Fahrenheit decades', () => {
  it.each`
    input                                          | expected
    ${'on mild days in the 70s'}                   | ${'on mild days between 21 and 26°C'}
    ${'highs in the mid 90s'}                      | ${'highs between 34 and 36°C'}
    ${'temperatures in the low 40s overnight'}     | ${'temperatures between 4 and 6°C overnight'}
    ${'the weather stayed in the upper 80s'}       | ${'the weather stayed between 31 and 32°C'}
    ${'it was freezing, in the 20s.'}              | ${'it was freezing, between -7 and -2°C.'}
    ${'temperatures in the 70s and 80s'}           | ${'temperatures between 21 and 32°C'}
    ${'highs in the low-70s'}                      | ${'highs between 21 and 23°C'}
    ${'warm, in the 70’s'}                         | ${'warm, between 21 and 26°C'}
    ${'heat in the 110s'}                          | ${'heat between 43 and 48°C'}
    ${'Highs in the upper 80s°F'}                  | ${'Highs between 31 and 32°C'}
    ${'Highs in the 80s °F'}                       | ${'Highs between 27 and 32°C'}
    ${'highs in the upper 80s Fahrenheit'}         | ${'highs between 31 and 32°C'}
    ${'the 70s and 80s ℉'}                         | ${'21 to 32°C'}
    ${'Days in the 70s °F.'}                       | ${'Days between 21 and 26°C.'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  // The decade of the calendar is the far commoner reading, so these must all survive.
  it.each`
    unchanged                                        | why
    ${'Back in the 70s, the music was better.'}      | ${'back in the'}
    ${'Songs from the 80s.'}                         | ${'no temperature anywhere'}
    ${'He was born in the 60s.'}                     | ${'born'}
    ${'Fashion of the 90s is back.'}                 | ${'fashion'}
    ${'The band formed in the late 70s.'}            | ${'late, and a band'}
    ${'Throughout the 80s the climate changed.'}     | ${'throughout, despite the word climate'}
    ${'Warm weather back in the 70s.'}               | ${'back in the wins over warm'}
    ${'During the 1970s it was warmer.'}             | ${'a four-digit year'}
    ${'She was in her 70s and the weather was mild.'} | ${'her, not the'}
    ${'Interest rates in the 80s hit records.'}      | ${'no temperature context'}
    ${'a 1.70s delay in the forecast'}               | ${'part of a decimal'}
    ${'Ford trucks from the 70s F series'}           | ${'a bare F is a letter, not a marker'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('cooking measures are not Americanisms', () => {
  it.each`
    unchanged                     | why
    ${'one cup of flour'}         | ${'Australian kitchens use cups too'}
    ${'2 teaspoons of salt'}      | ${'universal'}
    ${'1 tablespoon of butter'}   | ${'universal, and millilitres read like a lab protocol'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                            | expected                   | why
    ${'1/2 gallon of milk'}          | ${'1.9 litres of milk'}    | ${'a gallon is American'}
    ${'2 quarts of stock'}           | ${'1.9 litres of stock'}   | ${'so is a quart'}
    ${'8 fluid ounces'}              | ${'240 millilitres'}       | ${'and the US fluid ounce'}
    ${'one-quarter pound of citron'} | ${'110 grams of citron'}   | ${'weights convert'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts cups when asked to', () => {
    expect(convert('one cup of flour', { rules: { 'units.volume.cup': true } }))
      .toBe('240 millilitres of flour');
  });
});

describe('US coins used as a unit of size', () => {
  it.each`
    input                          | expected              | why
    ${'dime to quarter-sized hail'} | ${'18 to 24 mm hail'} | ${'the NWS hail convention'}
    ${'nickel-sized hail'}         | ${'21 mm hail'}       | ${'single coin'}
    ${'penny sized dent'}          | ${'19 mm dent'}       | ${'not only weather'}
    ${'half dollar sized hail'}    | ${'31 mm hail'}       | ${'two words'}
    ${'quarter sized hail'}        | ${'24 mm hail'}       | ${'quarter, with something to size'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                            | why
    ${'a quarter-sized reduction in staff'} | ${'quarter here is a fraction, and nothing is being sized'}
    ${'a quarter of the budget'}         | ${'plainly a fraction'}
    ${'golf ball sized hail'}            | ${'a golf ball is a golf ball everywhere'}
    ${'pea sized hail'}                  | ${'so is a pea'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('still reads a written-out fraction as a number', () => {
    expect(convert('one-quarter pound of butter')).toBe('110 grams of butter');
  });
});

describe('a fastener size a few words from its noun', () => {
  it.each`
    unchanged                              | why
    ${'for bolts up to 1 in. in diameter'} | ${'a bolt size, with function words between'}
    ${'For bolts above 1-in. diameter'}    | ${'the same'}
    ${'screws smaller than 1/4 inch'}      | ${'the same'}
    ${'a monitor larger than 27 inches'}   | ${'screens too'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                  | expected                                  | why
    ${'the bolt was 6 feet from the wall'} | ${'the bolt was 1.8 metres from the wall'} | ${'a real distance, not a size'}
    ${'hail 2 inches in diameter'}         | ${'hail 5.1 centimetres in diameter'}      | ${'diameter alone is no exemption'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('American designations that only look like measurements', () => {
  it.each`
    unchanged                    | why
    ${'the 40 yard line'}        | ${'there is no 37 metre line'}
    ${'the 40 yard dash'}        | ${'a named event'}
    ${'the 147-pound division'}  | ${'a weight class is a name'}
    ${'a 12 gauge shotgun'}      | ${'gauge is not a unit here'}
    ${'a 350 cubic inch V8'}     | ${'an engine name'}
    ${'P215/65R15 tires'}        | ${'a tyre code'}
    ${'a 5/16-18 UNC bolt'}      | ${'a thread spec'}
    ${'a #10-32 screw'}          | ${'the same'}
    ${'a 2x4 stud'}              | ${'lumber'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                            | expected
    ${'a 40 yard sprint'}            | ${'a 37 metre sprint'}
    ${'a 147 pound bag of cement'}   | ${'a 66.7 kilogram bag of cement'}
    ${'100 yards of fabric'}         | ${'91 metres of fabric'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('an attributive singular after one needs a determiner', () => {
  const quarts = (input: string) => convert(input, { rules: { 'units.volume.quart': true } });

  it.each`
    input                            | expected                          | why
    ${'a 6 foot fence'}              | ${'a 1.8 metre fence'}            | ${'a determiner opens the phrase'}
    ${'a 9 inch dish'}               | ${'a 23 centimetre dish'}         | ${'the same'}
    ${'a 147 pound bag of cement'}   | ${'a 66.7 kilogram bag of cement'} | ${'the same, for mass'}
    ${'one quart small onions'}      | ${'950 millilitres small onions'} | ${'an ingredient quantity with the "of" left out'}
    ${'one quart of large cucumbers'} | ${'950 millilitres of large cucumbers'} | ${'and it now matches the spelled-out form'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(quarts(input)).toBe(expected);
  });
});

describe('a singular unit after a number above one describes the noun after it', () => {
  it.each`
    input                          | expected                           | why
    ${'9 inch pans'}               | ${'23 centimetre pans'}            | ${'no determiner, but the singular says so'}
    ${'10 pound turkeys'}          | ${'4.5 kilogram turkeys'}          | ${'the same, for mass'}
    ${'the 5-6 inch pans'}         | ${'the 13-15 centimetre pans'}     | ${'a range after a determiner'}
    ${'5-6 inch pans'}             | ${'13-15 centimetre pans'}         | ${'a range on its own'}
    ${'the 5 to 6 inch pans'}      | ${'the 13 to 15 centimetre pans'}  | ${'a range joined by "to"'}
    ${'cut in one-inch slices'}    | ${'cut in 2.5 centimetre slices'}  | ${'a hyphen ties one to its unit'}
    ${'two 1-inch boards'}         | ${'two 2.5 centimetre boards'}     | ${'the same, after a count'}
    ${'a 9 inch deep-dish pie'}    | ${'a 23 centimetre deep-dish pie'} | ${'a hyphen makes a modifier of "deep"'}
    ${'a 2 mile off-road trail'}   | ${'a 3.2 kilometre off-road trail'} | ${'and of "off"'}
    ${'a 9 inch round pan'}        | ${'a 23 centimetre round pan'}     | ${'"round" describes the pan'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                           | expected                            | why
    ${'1/2 pound ground beef'}      | ${'230 grams ground beef'}          | ${'a fraction takes the singular anyway'}
    ${'1/2-1 inch gravel'}          | ${'1.3-2.5 centimetres gravel'}     | ${'so does a range that ends in one'}
    ${'0.5 inch'}                   | ${'1.3 centimetres'}                | ${'no noun after'}
    ${'5 inches of rain'}           | ${'13 centimetres of rain'}         | ${'a plural source'}
    ${'Dig 3 foot then stop'}       | ${'Dig 91 centimetres then stop'}   | ${'a conjunction is no noun'}
    ${'He was 6 foot when he left'} | ${'He was 1.8 metres when he left'} | ${'nor is "when"'}
    ${'9 inch is plenty'}           | ${'23 centimetres is plenty'}       | ${'nor is a verb'}
    ${'Cut 9 inch this time'}       | ${'Cut 23 centimetres this time'}   | ${'nor is a determiner'}
    ${'Dig 3 foot so it drains'}    | ${'Dig 91 centimetres so it drains'} | ${'nor is "so"'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a distance before an adverb of time or place is a quantity', () => {
  it.each`
    input                                 | expected                            | why
    ${'a quarter mile later we stopped'}  | ${'400 metres later we stopped'}    | ${'later'}
    ${'a quarter mile earlier'}           | ${'400 metres earlier'}             | ${'earlier'}
    ${'half a mile later'}                | ${'800 metres later'}               | ${'the unit inside the number'}
    ${'a quarter mile before the bridge'} | ${'400 metres before the bridge'}   | ${'before'}
    ${'a quarter mile after the turn'}    | ${'400 metres after the turn'}      | ${'after'}
    ${'two miles and a half later'}       | ${'4 kilometres later'}             | ${'a fraction after the unit'}
  `('time: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                 | expected                            | why
    ${'a quarter mile back'}              | ${'400 metres back'}                | ${'back'}
    ${'a mile and a half back'}           | ${'2.4 kilometres back'}            | ${'the unit inside the number'}
    ${'a quarter mile out'}               | ${'400 metres out'}                 | ${'out'}
    ${'a quarter mile off'}               | ${'400 metres off'}                 | ${'off'}
    ${'a quarter mile around'}            | ${'400 metres around'}              | ${'around'}
    ${'a quarter mile over'}              | ${'400 metres over'}                | ${'over'}
    ${'a quarter mile overhead'}          | ${'400 metres overhead'}            | ${'overhead'}
    ${'a quarter mile above the lake'}    | ${'400 metres above the lake'}      | ${'above'}
    ${'a quarter mile below the summit'}  | ${'400 metres below the summit'}    | ${'below'}
    ${'a quarter mile inside the gate'}   | ${'400 metres inside the gate'}     | ${'inside'}
    ${'a quarter mile outside town'}      | ${'400 metres outside town'}        | ${'outside'}
    ${'a quarter mile inland'}            | ${'400 metres inland'}              | ${'inland'}
    ${'a quarter mile offshore'}          | ${'400 metres offshore'}            | ${'offshore'}
  `('place: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                           | expected                    | why
    ${'a quarter mile uphill'}      | ${'400 metres uphill'}      | ${'uphill'}
    ${'a quarter mile downhill'}    | ${'400 metres downhill'}    | ${'downhill'}
    ${'a quarter mile upstream'}    | ${'400 metres upstream'}    | ${'upstream'}
    ${'half a mile downstream'}     | ${'800 metres downstream'}  | ${'downstream'}
  `('slope: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                             | expected                         | why
    ${'a quarter-mile track'}         | ${'a 400 metre track'}           | ${'a noun after keeps the article for itself'}
    ${'a 9 inch dish'}                | ${'a 23 centimetre dish'}        | ${'the same'}
    ${'a quarter mile away'}          | ${'400 metres away'}             | ${'a direction'}
    ${'half a pound cake'}            | ${'half a pound cake'}           | ${'the noun after claims the fraction'}
    ${'a mile and a half hour later'} | ${'a mile and a half hour later'} | ${'the same'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads a date after a distance as no noun, so one run converts both', () => {
    expect(convert('half a mile May 3, 2024')).toBe('800 metres May 3, 2024');
    expect(convert('half a mile May 3, 2024', { preset: 'localise' })).toBe('800 metres 3 May 2024');
  });

  it.each`
    input                          | expected
    ${'a quarter mile one way'}    | ${'400 metres one way'}
    ${'half a mile two feet away'} | ${'800 metres 61 centimetres away'}
  `('reads a number in words after a distance as no noun: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a unit that is part of a noun', () => {
  it.each`
    unchanged                        | why
    ${'Bake 1 pound cake'}           | ${'a pound cake is a cake'}
    ${'Send in 6 foot soldiers'}     | ${'the number counts the soldiers'}
    ${'heavy foot traffic'}          | ${'foot traffic'}
    ${'Count 8 inch worms'}          | ${'inch worms'}
    ${'two 1 pound cakes'}           | ${'after a count'}
    ${'Bake 2-3 pound cakes'}        | ${'after a range'}
    ${'Bake a 2 pound cake'}         | ${'with no hyphen it may be a pound cake'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                     | expected                    | why
    ${'Bake a 2-pound cake'}  | ${'Bake a 910 gram cake'}   | ${'a hyphen ties the unit to its number'}
    ${'a 6-foot soldier'}     | ${'a 1.8 metre soldier'}    | ${'the same'}
    ${'2 pounds of cake'}     | ${'910 grams of cake'}      | ${'a plural unit starts no noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  /** The spans the unit rules hold as written in `text`. */
  const held = (text: string, options: Options = {}): string[] => {
    const resolved = resolveOptions(options);
    const ctx: RuleContext = { text, options: resolved, signals: analyse(text), american: true };
    return patternRules(resolved)
      .flatMap((rule) => rule.find(ctx))
      .filter((c) => c.hold)
      .map((c) => c.before);
  };

  it.each`
    input                       | span
    ${'Bake 1 pound cake'}      | ${'1 pound'}
    ${'Send in 6 foot soldiers'} | ${'6 foot'}
    ${'Bake 2-3 pound cakes'}   | ${'2-3 pound'}
  `('holds $span whole, even with respectConventions off', ({ input, span }) => {
    expect(held(input)).toContain(span);
    expect(held(input, { units: { respectConventions: false } })).toContain(span);
  });
});

describe('a count before an attributive measurement stays out of it', () => {
  it.each`
    input                              | expected                         | why
    ${'two quarter-pound burgers'}     | ${'two 110 gram burgers'}        | ${'two burgers of a quarter pound each'}
    ${'three quarter-pound burgers'}   | ${'three 110 gram burgers'}      | ${'not three quarters of a pound'}
    ${'two half-gallon jugs'}          | ${'two 1.9 litre jugs'}          | ${'not two halves'}
    ${'two quarter-mile tracks'}       | ${'two 400 metre tracks'}        | ${'a length'}
    ${'three-quarter-pound burgers'}   | ${'340 gram burgers'}            | ${'a count hyphenated to the fraction is part of it'}
    ${'three quarter-inch pipes'}      | ${'three quarter-inch pipes'}    | ${'a pipe size is held, and the count stays out of it'}
    ${'three 2-inch screws'}           | ${'three 2-inch screws'}         | ${'a fastener size'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a number never continues onto the next line', () => {
  it.each`
    input                                 | expected                              | why
    ${'Step 14\n1/2 gallon of milk.'}     | ${'Step 14\n1.9 litres of milk.'}     | ${'a step number is not the whole part of a mixed number'}
    ${'Step 14\r\n1/2 gallon of milk.'}   | ${'Step 14\r\n1.9 litres of milk.'}   | ${'nor after a Windows line ending'}
    ${'Step 14\n½ gallon of milk.'}       | ${'Step 14\n1.9 litres of milk.'}     | ${'nor before a vulgar fraction'}
    ${'2 1/2 gallons'}                    | ${'9.5 litres'}                       | ${'on one line the two are one number'}
    ${'1\u00a01/2 gallons'}               | ${'5.7 litres'}                       | ${'a no-break space stays on the line'}
    ${'two and a half feet'}              | ${'76 centimetres'}                   | ${'so does a written-out number on one line'}
  `('$why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                     | why
    ${'two and a\nhalf feet'}     | ${'the fraction is cut off from its whole number'}
    ${'two and\na half feet'}     | ${'the same, before the article'}
    ${'two\nand a half feet'}     | ${'the same, before "and"'}
    ${'one and\none-half pounds'} | ${'the same, before the numerator'}
    ${'a\nquarter mile away'}     | ${'the article is cut off from its fraction'}
    ${'three\nquarters pound'}    | ${'the numerator is cut off from its fraction'}
    ${'Serves two\nquarter pound burgers'} | ${'a number ending the line above might be part of it'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('the rest of a measurement may wrap onto the next line', () => {
  it.each`
    input                              | expected                            | why
    ${'The fence is 6\nfeet tall'}     | ${'The fence is 1.8 metres tall'}   | ${'between the number and its unit'}
    ${'The fence is 6\n   feet tall'}  | ${'The fence is 1.8 metres tall'}   | ${'with the next line indented'}
    ${'6\u202ffeet'}                   | ${'1.8 metres'}                     | ${'a narrow no-break space is a space'}
    ${'two and a half\nfeet'}          | ${'76 centimetres'}                 | ${'after a written-out number'}
    ${'a quarter\nmile away'}          | ${'400 metres away'}                | ${'after a fraction with its article'}
    ${'half a\nmile away'}             | ${'800 metres away'}                | ${'with the unit inside the number'}
    ${'between 5 and\n10 miles'}       | ${'between 8 and 16 kilometres'}    | ${'after a range connector'}
    ${'between 5\nand 10 miles'}       | ${'between 8 and 16 kilometres'}    | ${'before one'}
    ${'5 -\n10 miles'}                 | ${'8-16 kilometres'}                | ${'after a dash that ends the line'}
    ${'a 10 x\n12 foot room'}          | ${'a 3 x 3.7 metre room'}           | ${'inside a dimension'}
    ${'a 10 x\r\n12 foot room'}        | ${'a 3 x 3.7 metre room'}           | ${'after a Windows line ending'}
    ${'a 10 x 12 x\n8 foot shed'}      | ${'a 3 x 3.7 x 2.4 metre shed'}     | ${'before the last of three'}
    ${'6 feet\n2 inches tall'}         | ${'1.88 metres tall'}               | ${'between feet and inches'}
    ${'6 feet and\n2 inches tall'}     | ${'1.88 metres tall'}               | ${'the same, after "and"'}
  `('$why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('never takes a range for the second number alone', () => {
    expect(convert('Bought 2024-03-14 1/2 gallon')).toBe('Bought 2024-03-14 1.9 litres');
  });
});

describe('a measurement never crosses into a new block', () => {
  it.each`
    input                                    | expected                                  | why
    ${'between 5 and\n\n10 miles'}           | ${'between 5 and\n\n16 kilometres'}       | ${'a blank line ends the range'}
    ${'6 feet\n\n2 inches tall'}             | ${'1.8 metres\n\n5.1 centimetres tall'}   | ${'and feet and inches'}
    ${'Serves two\n\nQuarter pound of butter'} | ${'Serves two\n\n110 grams of butter'}  | ${'and a written-out number'}
    ${'Serves 4\n- 2 pounds beef'}           | ${'Serves 4\n- 910 grams beef'}           | ${'a dash opening a line is a bullet, not a range'}
    ${'Serves 4\n* 2 pounds beef'}           | ${'Serves 4\n* 910 grams beef'}           | ${'so is a star'}
    ${'Serves 4\n+ 2 pounds beef'}           | ${'Serves 4\n+ 910 grams beef'}           | ${'and a plus'}
    ${'Serves 4\n1. 2 pounds beef'}          | ${'Serves 4\n1. 910 grams beef'}          | ${'a numbered item'}
    ${'Serves 4\n1) 2 pounds beef'}          | ${'Serves 4\n1) 910 grams beef'}          | ${'the same'}
    ${'Chapter 4\n# 2 miles out'}            | ${'Chapter 4\n# 3.2 kilometres out'}      | ${'a heading'}
    ${'Section 4\n> 2 miles out'}            | ${'Section 4\n> 3.2 kilometres out'}      | ${'a quote'}
    ${'Total 4\n| 2 miles |'}                | ${'Total 4\n| 3.2 kilometres |'}         | ${'a table row'}
  `('$why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                          | why
    ${'The fence is 6\n\nfeet tall'}   | ${'a blank line between the number and its unit'}
    ${'The fence is 6\n  \nfeet tall'} | ${'the same, with spaces on the blank line'}
    ${'two and a half\n\nfeet'}        | ${'the same, after a written-out number'}
    ${'Step 4\n- Feet together'}       | ${'a list item opening with a unit word'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('spelled-out fractions with "a"', () => {
  it.each`
    input                                  | expected                   | why
    ${'two and a half feet'}               | ${'76 centimetres'}        | ${'a whole number and a half'}
    ${'one and a half pounds of butter'}   | ${'680 grams of butter'}   | ${'the same, before "of"'}
    ${'one and an eighth inches'}          | ${'2.9 centimetres'}       | ${'"an" before a vowel'}
    ${'1 and a half pounds'}               | ${'680 grams'}             | ${'digits before "and a half"'}
    ${'one and one-half pounds of butter'} | ${'680 grams of butter'}   | ${'a written-out numerator still reads'}
    ${'a quarter mile away'}               | ${'400 metres away'}       | ${'the article belongs to the number'}
    ${'a quarter pound of butter'}         | ${'110 grams of butter'}   | ${'the same'}
    ${'about a half mile'}                 | ${'about 800 metres'}      | ${'the same, at the end of the text'}
    ${'an eighth inch'}                    | ${'3.2 millimetres'}       | ${'"an" as well as "a"'}
    ${'A quarter mile away'}               | ${'400 metres away'}       | ${'a capital article'}
    ${'a quarter-mile track'}              | ${'a 400 metre track'}     | ${'attributive, so the article belongs to the noun'}
    ${'a half-inch gap'}                   | ${'a 1.3 centimetre gap'}  | ${'the same'}
    ${'half a mile away'}                  | ${'800 metres away'}       | ${'the unit inside the number'}
    ${'half an inch thick'}                | ${'1.3 centimetres thick'} | ${'the same, with "an"'}
    ${'a half a pound of butter'}          | ${'230 grams of butter'}   | ${'with a second article'}
    ${'half of a mile'}                    | ${'800 metres'}            | ${'with "of"'}
    ${'a quarter of a mile'}               | ${'400 metres'}            | ${'the same'}
    ${'three quarters of a mile'}          | ${'1.2 kilometres'}        | ${'a counted fraction'}
    ${'one-quarter of a pound of peel'}    | ${'110 grams of peel'}     | ${'the cookbook spelling'}
    ${'about a mile and a half'}           | ${'about 2.4 kilometres'}  | ${'the fraction after the unit'}
    ${'an inch and a quarter thick'}       | ${'3.2 centimetres thick'} | ${'the same, with "an"'}
    ${'a pound and a half of butter'}      | ${'680 grams of butter'}   | ${'the same, before "of"'}
    ${'a mile and three quarters.'}        | ${'2.8 kilometres.'}       | ${'a counted fraction after the unit'}
    ${'a quarter mile down the road'}      | ${'400 metres down the road'} | ${'a direction is not a noun the unit modifies'}
    ${'half a mile north of town'}         | ${'800 metres north of town'} | ${'the same, with the unit inside'}
    ${'half an inch longer'}               | ${'1.3 centimetres longer'} | ${'nor is a comparison'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                           | why
    ${'a half-hour drive'}              | ${'no unit'}
    ${'a quarter of the class'}         | ${'no unit'}
    ${'apples were a quarter a pound'}  | ${'a price per pound, not a weight'}
    ${'half a pound cake'}              | ${'half of a cake'}
    ${'a quarter of a pound cake'}      | ${'the same'}
    ${'a mile and a half hour later'}   | ${'the half belongs to the hour'}
    ${'a pound and a half dozen eggs'}  | ${'the same, for a dozen'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('keeps written-out numbers out of the pattern ranges use', () => {
    const numeric = new RegExp(`^(?:${NUMERIC_PATTERN})$`, 'i');
    for (const words of ['half', 'a half', 'one-half', 'two and a half', '1 and a half']) {
      expect(numeric.test(words), words).toBe(false);
    }
  });
});
