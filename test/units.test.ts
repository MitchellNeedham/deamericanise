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
import { NUMBER_START, NUMERIC_PATTERN, parseNumber } from '../src/rules/units/number.js';

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
    input                                     | expected                                  | why
    ${'He is 6 foot 2 to 6 foot 4.'}          | ${'He is 1.88 metres to 1.93 metres.'}    | ${'joined by "to"'}
    ${'He is six foot two to six foot four.'} | ${'He is 1.88 metres to 1.93 metres.'}    | ${'in words'}
    ${'between 5 foot 10 and 6 foot 2'}       | ${'between 1.78 metres and 1.88 metres'}  | ${'joined by "and"'}
    ${'He is 6 foot 2 - 6 foot 4 tall.'}      | ${'He is 1.88 metres - 1.93 metres tall.'} | ${'joined by a spaced dash'}
    ${'He is 6 foot 2 to 6 feet 4 inches.'}   | ${'He is 1.88 metres to 1.93 metres.'}    | ${'before a height with its inch word'}
    ${'2 feet 6 to 3 feet'}                   | ${'76.2 centimetres to 91 centimetres'}   | ${'before feet alone'}
    ${'from 5 foot 2 to 6 ft'}                | ${'from 1.57 metres to 1.8 m'}            | ${'before an abbreviation'}
    ${'5 foot 1 to 5 foot 2 to 5 foot 3'}     | ${'1.55 metres to 1.57 metres to 1.6 metres'} | ${'three heights in a row'}
  `('reads inches with no inch word before another height: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                       | why
    ${'5 ft 6 to 6 ft'}             | ${'only "foot" or "feet" lets the inch word go'}
    ${'3 yards 2 to 4 yards'}       | ${'a smaller unit after yards'}
    ${'10 feet 12 to 15 feet'}      | ${'twelve is not a number of inches'}
    ${'6 foot 2-6 foot 4'}          | ${'a dash written tight, where no second height can start'}
    ${'5 to 6 foot 2 to 6 foot 4'}  | ${'the first height ends a range'}
  `('leaves "$unchanged" as written, since its number after a length is no range ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                  | expected                                         | why
    ${'6 feet 2 to 3 inches'}              | ${'1.8 metres 5.1 to 7.6 centimetres'}           | ${'a range in a smaller unit'}
    ${'Pack 5 in 2 to 3 inches of foam.'}  | ${'Pack 5 in 5.1 to 7.6 centimetres of foam.'}   | ${'"in" before a number is a preposition'}
    ${'5 to 10 feet'}                      | ${'1.5 to 3 metres'}                             | ${'a range on its own'}
  `('still reads a range after a number: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                          | expected                       | why
    ${'a 6 foot 2 inch man'}       | ${'a 1.88 metre man'}          | ${'a determiner and a singular unit'}
    ${'the 2 foot 6 inch pipes'}   | ${'the 76.2 centimetre pipes'} | ${'a plural noun'}
    ${'a 6 ft 2 in man'}           | ${'a 1.88 metre man'}          | ${'abbreviations after a determiner'}
    ${'6 feet 2 inch pipes'}       | ${'1.88 metre pipes'}          | ${'the singular after a number above one'}
    ${'a 6 foot 1 inch man'}       | ${'a 1.85 metre man'}          | ${'one inch after a determiner'}
  `('keeps the unit singular before a noun: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                              | expected                       | why
    ${'He is 6 feet 2 inches tall.'}   | ${'He is 1.88 metres tall.'}   | ${'"tall" is no noun'}
    ${'He is 6 foot 2 inches tall.'}   | ${'He is 1.88 metres tall.'}   | ${'nor after "foot"'}
    ${'6 ft 2 in'}                     | ${'1.88 metres'}               | ${'nothing after it'}
  `('keeps the plural where no noun follows: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('gives a height before an adjective and a noun the singular', () => {
    expect(convert('a 6 foot 2 inch tall man')).toBe('a 1.88 metre tall man');
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

  it.each`
    input                                  | expected                                 | why
    ${'He is 6 foot 4 with long arms.'}    | ${'He is 1.93 metres with long arms.'}   | ${'a preposition'}
    ${'He is 6 foot 4 and strong.'}        | ${'He is 1.93 metres and strong.'}       | ${'"and" before a word'}
    ${'He is 6 foot 4 but slim.'}          | ${'He is 1.93 metres but slim.'}         | ${'a conjunction'}
    ${'He is 6 foot 4 by now.'}            | ${'He is 1.93 metres by now.'}           | ${'"by" before a word'}
    ${'He is six foot two or so.'}         | ${'He is 1.88 metres or so.'}            | ${'"or" before a word'}
    ${'He is six foot two he said.'}       | ${'He is 1.88 metres he said.'}          | ${'a pronoun'}
  `('reads inches with no inch word before a word that opens no noun: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                        | expected                                  | why
    ${'6 feet 2 and 3 inches'}   | ${'1.8 metres 5.1 and 7.6 centimetres'}   | ${'"and" before a number joins a range'}
    ${'6 foot 2 by 3 feet'}      | ${'1.8 metres 61 by 91 centimetres'}      | ${'"by" before a number joins a dimension'}
  `('reads no inches before a join and a number: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads no inches before "or" and a number', () => {
    expect(convert('6 feet 2 or 3 inches')).toBe('1.8 metres 5.1 or 7.6 centimetres');
  });

  it.each`
    input                                               | expected                                         | why
    ${'He is six foot two and a half.'}                 | ${'He is 1.89 metres.'}                          | ${'a fraction in words'}
    ${'He is 6 foot 2 and a half.'}                     | ${'He is 1.89 metres.'}                          | ${'after digits'}
    ${'He is 6 foot 2½.'}                               | ${'He is 1.89 metres.'}                          | ${'a vulgar fraction'}
    ${'He is 6 foot 2 1/2.'}                            | ${'He is 1.89 metres.'}                          | ${'a mixed number'}
    ${'He is 6 foot 2-1/2.'}                            | ${'He is 1.89 metres.'}                          | ${'a mixed number with a hyphen'}
    ${'He is six foot two and three-quarters.'}         | ${'He is 1.9 metres.'}                           | ${'three-quarters'}
    ${'He is six foot eleven and a half.'}              | ${'He is 2.12 metres.'}                          | ${'eleven and a half inches'}
    ${'He is six foot two and a half to six foot four.'} | ${'He is 1.89 metres to 1.93 metres.'}          | ${'before another height'}
    ${'He is 6 foot 2 1/2 to 6 foot 4.'}                | ${'He is 1.89 metres to 1.93 metres.'}           | ${'a mixed number before another height'}
    ${'6 feet 2½ inches'}                               | ${'1.89 metres'}                                 | ${'a vulgar fraction before the inch word'}
    ${'six foot twelve and a half.'}                    | ${'1.8 metres twelve and a half.'}               | ${'twelve is not a number of inches'}
    ${'six foot two and a half cars'}                   | ${'1.8 metres two and a half cars'}              | ${'a noun follows the fraction'}
    ${'He is six foot two.'}                            | ${'He is 1.88 metres.'}                          | ${'no fraction'}
    ${'six feet two and a half inches'}                 | ${'1.89 metres'}                                 | ${'the inch word written'}
    ${'two and a half feet'}                            | ${'76 centimetres'}                              | ${'feet alone'}
  `('reads a fraction of an inch with no inch word: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                            | expected                                            | why
    ${'a six foot two tall man'}                     | ${'a 1.88 metre tall man'}                          | ${'in words'}
    ${'He is a 6 foot 2 tall man.'}                  | ${'He is a 1.88 metre tall man.'}                   | ${'in digits'}
    ${'a six foot two and a half tall man'}          | ${'a 1.89 metre tall man'}                          | ${'with a fraction'}
    ${'six foot two long, three foot wide planks'}   | ${'1.88 metre long, 91 centimetre wide planks'}     | ${'two sizes'}
    ${'He is six foot two tall.'}                    | ${'He is 1.88 metres tall.'}                        | ${'no noun after the size'}
    ${'He is six foot two tall and thin.'}           | ${'He is 1.88 metres tall and thin.'}               | ${'a conjunction after the size'}
  `('gives a height with no inch word before a size and a noun the singular: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                               | expected                                     | why
    ${'6 feet 2, 3 or 4 inches'}        | ${'1.8 metres 5.1, 7.6 or 10 centimetres'}   | ${'a list claims the number'}
    ${'He is 6 foot 2, 180 pounds.'}    | ${'He is 1.88 metres, 82 kilograms.'}        | ${'a weight after the comma starts no list'}
  `('reads no inches with no inch word where a list starts at them: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a spaced "in" after a height that opens a phrase is the preposition', () => {
  it.each`
    input                                    | expected                                      | why
    ${'She stands 5 feet 4 in her socks.'}   | ${'She stands 1.63 metres in her socks.'}     | ${'a determiner after "in"'}
    ${'He is 6 foot 2 in height.'}           | ${'He is 1.88 metres in height.'}             | ${'a noun after "in"'}
    ${'He is 6 feet 2 in shoes.'}            | ${'He is 1.88 metres in shoes.'}              | ${'a plural noun after "in"'}
    ${'She is 5 ft 4 in her socks.'}         | ${'She is 1.63 metres in her socks.'}         | ${'after "ft"'}
    ${'She is 5 feet 4.5 in her socks.'}     | ${'She is 1.64 metres in her socks.'}         | ${'inches with a decimal'}
    ${'The average is 5 ft 9 in men.'}       | ${'The average is 1.75 metres in men.'}       | ${'no determiner opens the height'}
    ${'She is 5 feet 4\nin her socks.'}      | ${'She is 1.63 metres\nin her socks.'}        | ${'"in" on the next line'}
    ${'He is 6 foot 2 in his socks and 6 foot 4 in boots.'} | ${'He is 1.88 metres in his socks and 1.93 metres in boots.'} | ${'two heights'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                         | expected                                   | why
    ${'She is 5 feet 4 in tall.'}                 | ${'She is 1.63 metres tall.'}              | ${'a size after "in"'}
    ${'She is 5 ft 4 in.'}                        | ${'She is 1.63 metres.'}                   | ${'"in." ends the sentence'}
    ${'He is 6 foot 2 in.'}                       | ${'He is 1.88 metres.'}                    | ${'after "foot"'}
    ${'He is 6 ft 2 in and strong.'}              | ${'He is 1.88 metres and strong.'}         | ${'a conjunction after "in"'}
    ${'a 6 ft 2 in man'}                          | ${'a 1.88 metre man'}                      | ${'the height describes the noun'}
    ${'5 ft 4 in x 3 ft'}                         | ${'1.63 metres x 91 cm'}                   | ${'a dimension'}
    ${'She stands 5 feet 4 inches in her socks.'} | ${'She stands 1.63 metres in her socks.'}  | ${'the inch word written'}
  `('keeps the "in" as the inch unit: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a hyphenated height is one height', () => {
  it.each`
    input                               | expected                             | why
    ${'He is six-foot-two.'}            | ${'He is 1.88 metres.'}              | ${'in words'}
    ${'a 6-foot-2 man'}                 | ${'a 1.88 metre man'}                | ${'in digits before a noun'}
    ${'a six-foot-two man'}             | ${'a 1.88 metre man'}                | ${'in words before a noun'}
    ${'He is six-foot two.'}            | ${'He is 1.88 metres.'}              | ${'a hyphen after the feet'}
    ${'He is 6-foot 2.'}                | ${'He is 1.88 metres.'}              | ${'the same in digits'}
    ${'He is six foot-two.'}            | ${'He is 1.88 metres.'}              | ${'a hyphen before the inches'}
    ${'a 6-foot-2-inch man'}            | ${'a 1.88 metre man'}                | ${'with its inch word'}
    ${'6-foot-2-inch pipes'}            | ${'1.88 metre pipes'}                | ${'with its inch word and no determiner'}
    ${'a 6-foot 2-inch pipe'}           | ${'a 1.88 metre pipe'}               | ${'each number hyphenated to its unit'}
    ${'a 6-ft 2-in pipe'}               | ${'a 1.88 metre pipe'}               | ${'in abbreviations'}
    ${'6′-2″'}                          | ${'1.88 metres'}                     | ${'in primes'}
    ${'six-foot-two to six-foot-four'}  | ${'1.88 metres to 1.93 metres'}      | ${'two heights joined by "to"'}
    ${'6-foot 2 to 6-foot 4'}           | ${'1.88 metres to 1.93 metres'}      | ${'with spaced inches'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                     | expected                     | why
    ${'6 feet 2 inches'}      | ${'1.88 metres'}             | ${'no hyphen'}
    ${'a 6-foot fence'}       | ${'a 1.8 metre fence'}       | ${'feet alone'}
    ${'a 2 foot 6 inch pipe'} | ${'a 76.2 centimetre pipe'}  | ${'spaced before a noun'}
  `('still converts $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                       | expected                              | why
    ${'5 feet-6 feet tall'}     | ${'1.5 metres-1.8 metres tall'}       | ${'the same unit after the hyphen'}
    ${'5 foot-6 foot fence'}    | ${'1.5 metres-1.8 metre fence'}       | ${'before a noun'}
    ${'two feet-6 feet'}        | ${'61 centimetres-1.8 metres'}        | ${'feet in words'}
    ${'5 feet-6 ft'}            | ${'1.5 metres-1.8 m'}                 | ${'an abbreviation after the hyphen'}
    ${'5 feet-6 yards'}         | ${'1.5 metres-5.5 metres'}            | ${'another unit after the hyphen'}
    ${'5 feet-6 metres'}        | ${'1.5 metres-6 metres'}              | ${'a metric unit after the hyphen'}
    ${'2 feet-18 inches'}       | ${'61 centimetres-46 centimetres'}    | ${'more inches than a foot holds'}
  `('reads no inches from a number with a unit of its own: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                           | expected                        | why
    ${'six feet-two'}               | ${'1.88 metres'}                | ${'after "feet"'}
    ${'a 5-foot-10 man'}            | ${'a 1.78 metre man'}           | ${'ten inches'}
    ${'She is 5 foot-6 and slim.'}  | ${'She is 1.68 metres and slim.'} | ${'before a conjunction'}
    ${'It is 5 feet-6 inches.'}     | ${'It is 1.68 metres.'}         | ${'with its inch word'}
  `('reads a height hyphenated to its inches: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves a hyphenated height at the end of a range as written', () => {
    expect(convert('He is five to six-foot-two.')).toBe('He is five to six-foot-two.');
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
    ${'5 to 6 feet 2 inches'}                            | ${'with nothing around it'}
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

describe('a number straight after a weight is its next unit, before another weight', () => {
  const noRanges = { rules: { 'units.range': false } };

  it.each`
    input                                               | expected                                                | why
    ${'11 stone 4 to 12 stone'}                         | ${'71.7 kilograms to 76 kilograms'}                     | ${'stone and pounds'}
    ${'7 lb 8 to 9 lb'}                                 | ${'3.4 kg to 4.1 kg'}                                   | ${'pounds and ounces'}
    ${'She went from 11 stone 4 to 12 stone in a year.'} | ${'She went from 71.7 kilograms to 76 kilograms in a year.'} | ${'in a sentence'}
    ${'The baby weighed 7 pounds 8 to 9 pounds.'}       | ${'The baby weighed 3.4 kilograms to 4.1 kilograms.'}   | ${'pounds written out'}
    ${'eleven stone four to twelve stone'}              | ${'71.7 kilograms to 76 kilograms'}                     | ${'in words'}
    ${'between 7 lb 8 and 9 lb'}                        | ${'between 3.4 kg and 4.1 kg'}                          | ${'joined by "and"'}
    ${'11 stone 4 - 12 stone'}                          | ${'71.7 kilograms - 76 kilograms'}                      | ${'joined by a spaced dash'}
    ${'11 stone 13 to 12 stone'}                        | ${'75.7 kilograms to 76 kilograms'}                     | ${'thirteen pounds'}
    ${'7 lb 8 to 9 lb 4 oz'}                            | ${'3.4 kg to 4.2 kg'}                                   | ${'before a weight in two units'}
    ${'7 lb 8 to 9 lb 8 to 10 lb'}                      | ${'3.4 kg to 4.31 kg to 4.5 kg'}                        | ${'three weights in a row'}
    ${'12 stone 11 stone 4 to 12 stone'}                | ${'76 kilograms 71.7 kilograms to 76 kilograms'}        | ${'after a weight in the same unit'}
  `('reads $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                       | expected
    ${'11 stone 4 to 12 stone'} | ${'71.7 kilograms to 76 kilograms'}
    ${'7 lb 8 to 9 lb'}         | ${'3.4 kg to 4.1 kg'}
  `('reads $input with the range rule off', ({ input, expected }) => {
    expect(convert(input, noRanges)).toBe(expected);
  });

  it('keeps the original of each weight', () => {
    expect(convert('11 stone 4 to 12 stone', { units: { keepOriginal: true } })).toBe(
      '71.7 kilograms (11 stone 4) to 76 kilograms (12 stone)',
    );
  });

  it.each`
    unchanged                                         | options                     | why
    ${'11 stone 14 to 12 stone'}                      | ${{}}                       | ${'fourteen is no number of pounds'}
    ${'7 lb 16 to 9 lb'}                              | ${{}}                       | ${'sixteen is no number of ounces'}
    ${'The price rose from 7 pounds 50 to 8 pounds.'} | ${{}}                       | ${'nor is fifty'}
    ${'11 stone 4-12 stone'}                          | ${{}}                       | ${'a dash written tight, where no second weight can start'}
    ${'5 to 11 stone 4 to 12 stone'}                  | ${{}}                       | ${'the first weight ends a range'}
    ${'It cost 5 pounds 10 to 6 pounds'}              | ${{}}                       | ${'pounds of money'}
    ${'11 stone 4 pounds 8 to 12 pounds'}             | ${{}}                       | ${'the tail of a weight in stone'}
    ${'11 stone 4 to 12 stone'}                       | ${{ dialect: 'en-GB' }}     | ${'Britain keeps stone'}
    ${'7 lb 8 to 9 lb'}                               | ${{ unitsKeep: ['ounce'] }} | ${'the smaller unit is kept'}
  `('leaves "$unchanged" as written ($why)', ({ unchanged, options }) => {
    expect(convert(unchanged, options)).toBe(unchanged);
  });

  it.each`
    input                              | expected
    ${'11 stone 4 pounds to 12 stone'} | ${'71.7 kilograms to 76 kilograms'}
    ${'5 to 10 pounds'}                | ${'2.3 to 4.5 kilograms'}
    ${'7 pounds 8 ounces'}             | ${'3.4 kilograms'}
    ${'5 to 7 pounds 8 ounces'}        | ${'5 to 7 pounds 8 ounces'}
  `('still converts $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a number straight after a weight is its next unit, before nothing it could count', () => {
  it.each`
    input                                          | expected                                      | why
    ${'He weighs 11 stone 4.'}                     | ${'He weighs 71.7 kilograms.'}                | ${'stone and pounds'}
    ${'She was born at 7 lb 8.'}                   | ${'She was born at 3.4 kg.'}                  | ${'pounds and ounces'}
    ${'He weighs 11 stone 4, I think.'}            | ${'He weighs 71.7 kilograms, I think.'}       | ${'before a comma'}
    ${'He weighs 7 pounds 8.'}                     | ${'He weighs 3.4 kilograms.'}                 | ${'pounds written out, after a weight verb'}
    ${'The baby weighed 7 lb 8 and was healthy.'}  | ${'The baby weighed 3.4 kg and was healthy.'} | ${'before a word that opens no noun'}
    ${'eleven stone four'}                         | ${'71.7 kilograms'}                           | ${'in words'}
    ${'11 stone 13.'}                              | ${'75.7 kilograms.'}                          | ${'thirteen pounds'}
    ${'11 stone 14.'}                              | ${'70 kilograms 14.'}                         | ${'fourteen is no number of pounds'}
    ${'7 lb 16.'}                                  | ${'3.2 kg 16.'}                               | ${'sixteen is no number of ounces'}
    ${'Buy 2 lb 3 times a week.'}                  | ${'Buy 910 g 3 times a week.'}                | ${'a noun follows the number'}
    ${'It is 5 pounds 10, 12 or 14 feet.'}         | ${'It is 2.3 kilograms 3, 3.7 or 4.3 metres.'} | ${'a list claims the number'}
    ${'11 stone 4, 5 or 6 pounds'}                 | ${'70 kilograms 1.8, 2.3 or 2.7 kilograms'}   | ${'the same, in the smaller unit'}
    ${'I weigh 11 stone.'}                         | ${'I weigh 70 kilograms.'}                    | ${'stone alone'}
    ${'He weighs 11 stone 4 pounds.'}              | ${'He weighs 71.7 kilograms.'}                | ${'the pound word written'}
    ${'6 feet 3 pounds'}                           | ${'1.8 metres 1.4 kilograms'}                 | ${'two dimensions are two measurements'}
  `('reads $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                       | options                     | why
    ${'It cost 5 pounds 50.'}       | ${{}}                       | ${'pounds and pence'}
    ${'It cost 5 pounds 10.'}       | ${{}}                       | ${'pence below sixteen'}
    ${'11 st 4.'}                   | ${{}}                       | ${'st is a weight only beside another unit'}
    ${'I weigh 11 stone 4.'}        | ${{ dialect: 'en-GB' }}     | ${'Britain keeps stone'}
    ${'I weigh 11 stone 4 pounds.'} | ${{ dialect: 'en-GB' }}     | ${'the same, with the pound word'}
    ${'7 lb 8.'}                    | ${{ unitsKeep: ['ounce'] }} | ${'the smaller unit is kept'}
  `('leaves "$unchanged" as written ($why)', ({ unchanged, options }) => {
    expect(convert(unchanged, options)).toBe(unchanged);
  });

  it('converts stone and pounds in en-GB with the compound turned on', () => {
    const options = { dialect: 'en-GB', rules: { 'units.mass.stone-pounds': true } } as const;
    expect(convert('I weigh 11 stone 4.', options)).toBe('I weigh 71.7 kilograms.');
  });
});

describe('a height in a kept unit is held whole', () => {
  it.each`
    unchanged                                   | unitsKeep            | why
    ${'It is 6 feet 2 inches tall.'}            | ${['foot', 'inch']}  | ${'both units kept'}
    ${'It is 6 feet 2 inches tall.'}            | ${['inch']}          | ${'inches kept'}
    ${'It is 6 feet 2 inches tall.'}            | ${['foot']}          | ${'feet kept'}
    ${'From 5 feet 2 inches to 6 feet.'}        | ${['foot', 'inch']}  | ${'before a join and feet'}
    ${'He is six foot two.'}                    | ${['inch']}          | ${'no inch word'}
    ${'a six-foot-two man'}                     | ${['foot']}          | ${'hyphenated'}
    ${`He is 6'2" tall.`}                       | ${['inch']}          | ${'marks'}
    ${'It is 6 feet tall and 2 inches wide.'}   | ${['foot', 'inch']}  | ${'two lengths'}
  `('leaves "$unchanged" as written with unitsKeep $unitsKeep ($why)', ({ unchanged, unitsKeep }) => {
    expect(convert(unchanged, { unitsKeep })).toBe(unchanged);
  });

  it('holds the whole height, so no rule converts a piece of it', () => {
    const { changes } = deamericanise('From 5 feet 2 inches to 6 feet.', { unitsKeep: ['inch'] });
    expect(changes.map((c) => c.before)).toEqual(['6 feet']);
  });

  it.each`
    options                                                                   | why
    ${{}}                                                                     | ${'nothing kept'}
    ${{ unitsKeep: ['mile'] }}                                                | ${'another unit kept'}
    ${{ unitsKeep: ['foot'], rules: { 'units.length.foot': true } }}          | ${'feet kept but turned on by id'}
    ${{ unitsKeep: ['inch'], rules: { 'units.length.inch': true } }}          | ${'inches kept but turned on by id'}
    ${{ unitsKeep: ['inch'], rules: { 'units.length.feet-inches': true } }}   | ${'the height rule turned on by id'}
  `('converts 6 feet 2 inches with $options ($why)', ({ options }) => {
    expect(convert('6 feet 2 inches', options)).toBe('1.88 metres');
  });
});

describe('a weight in two units that describes a noun stays singular', () => {
  it.each`
    input                         | expected                    | why
    ${'7 pound 8 ounce babies'}   | ${'3.4 kilogram babies'}    | ${'the singular after a number above one'}
    ${'7-pound 8-ounce babies'}   | ${'3.4 kilogram babies'}    | ${'a hyphen ties the number to the unit'}
    ${'7 pound 1 ounce babies'}   | ${'3.2 kilogram babies'}    | ${'the pound is singular after seven'}
    ${'our 8 pound 1 ounce baby'} | ${'our 3.66 kilogram baby'} | ${'the same, after a word that is no determiner'}
    ${'11 stone 4 pound men'}     | ${'71.7 kilogram men'}      | ${'stone and pounds'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                   | expected
    ${'a 7 pound 8 ounce baby'}             | ${'a 3.4 kilogram baby'}
    ${'the 7 pound 8 ounce babies'}         | ${'the 3.4 kilogram babies'}
    ${'7 pounds 8 ounces'}                  | ${'3.4 kilograms'}
    ${'7 pounds 8 ounces of flour'}         | ${'3.4 kilograms of flour'}
    ${'She was 7 pound 8 ounce when born.'} | ${'She was 3.4 kilograms when born.'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
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

describe('a measurement starts only where a number can', () => {
  it.each`
    unchanged                                    | why
    ${'catch-22 feet'}                           | ${'digits after a letter and a hyphen are part of a name'}
    ${'COVID-19 miles'}                          | ${'the same, in capitals'}
    ${'F-150 pounds'}                            | ${'the same, after one letter'}
    ${'the B-52 feet'}                           | ${'the same, after a determiner'}
    ${'catch-22°F'}                              | ${'a temperature after a name'}
    ${'catch-22 feet 2 inches'}                  | ${'a height after a name'}
    ${'the B-52 feet 2 inches'}                  | ${'the same, after a determiner'}
    ${'catch-22 pounds 8 ounces'}                | ${'a weight after a name'}
    ${'a 5-by-7-inch photo'}                     | ${'the second side of a hyphenated dimension'}
    ${'five-7 pounds'}                           | ${'digits after a number in words and a hyphen'}
    ${'a catch-22 situation'}                    | ${'a name with no unit'}
    ${'five-seven pounds eight ounces'}          | ${'a weight in words after a word and a hyphen'}
    ${'catch-twenty-two pounds eight ounces'}    | ${'the same, after a name'}
    ${'twenty-twenty pounds eight ounces'}       | ${'the same, after a tens word'}
    ${'two thousand, seven pounds eight ounces'} | ${'a weight in words after thousand and a comma'}
    ${'five-six feet 2 inches'}                  | ${'a height after a word and a hyphen'}
    ${'five-six feet two inches'}                | ${'the same, in words'}
    ${'catch-twenty-two miles'}                  | ${'a hyphenated word the table cannot read'}
    ${'twenty five-pound bags'}                  | ${'twenty bags or one weight'}
    ${'Route-66 miles'}                          | ${'a name before a unit word'}
    ${'two hundred-three feet'}                  | ${'a number in words before the hyphen is no unit'}
    ${'In mid-2024 miles were driven.'}          | ${'a year after mid-'}
  `('leaves "$unchanged" whole ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected                         | why
    ${'Week 3 seven pounds eight ounces'}          | ${'Week 3 3.4 kilograms'}        | ${'a weight in words after a number in digits'}
    ${'Day five seven pounds eight ounces'}        | ${'Day five 3.4 kilograms'}      | ${'the same, after a number in words'}
    ${'Room 12 eleven stone four pounds'}          | ${'Room 12 71.7 kilograms'}      | ${'stone and pounds'}
    ${'Week 3 six feet two inches'}                | ${'Week 3 1.88 metres'}          | ${'a height'}
    ${'Week 3 7 pounds 8 ounces'}                  | ${'Week 3 3.4 kilograms'}        | ${'a weight in digits'}
    ${'Week 3 seven pounds'}                       | ${'Week 3 3.2 kilograms'}        | ${'pounds on their own'}
    ${'twenty two pounds eight ounces'}            | ${'10.2 kilograms'}              | ${'a number of two words'}
    ${'twenty-two pounds eight ounces'}            | ${'10.2 kilograms'}              | ${'the same, hyphenated'}
    ${'one hundred and seven pounds eight ounces'} | ${'48.8 kilograms'}              | ${'a number with hundred and'}
    ${'two hundred pounds eight ounces'}           | ${'90.9 kilograms'}              | ${'a number with hundred'}
    ${'seven pounds eight ounces'}                 | ${'3.4 kilograms'}               | ${'a weight in words'}
    ${'a 7-pound 8-ounce baby'}                    | ${'a 3.4 kilogram baby'}         | ${'hyphens between numbers and units'}
    ${'a 6-foot fence'}                            | ${'a 1.8 metre fence'}           | ${'the same, before a noun'}
    ${'-5°F'}                                      | ${'-20.6°C'}                     | ${'a minus sign'}
    ${'It fell to -5°F.'}                          | ${'It fell to -20.6°C.'}         | ${'the same, after a word'}
    ${'5ft-6ft'}                                   | ${'1.5 m-1.8 m'}                 | ${'a range with its unit on both ends'}
    ${'5 ft-6 ft'}                                 | ${'1.5 m-1.8 m'}                 | ${'the same, spaced'}
    ${'5 sq ft-6 sq ft'}                           | ${'0.46 m²-0.56 m²'}             | ${'the same, with a unit of two words'}
    ${'60 miles per hour-70 miles per hour'}       | ${'97 kilometres per hour-110 kilometres per hour'} | ${'the same, with a unit of three words'}
    ${'two feet-6 feet'}                           | ${'61 centimetres-1.8 metres'}   | ${'the same, after a number in words'}
    ${'two feet-three feet'}                       | ${'61 centimetres-91 centimetres'} | ${'the same, with both ends in words'}
    ${'a sub-2 pound tent'}                        | ${'a sub-910 gram tent'}         | ${'digits after a prefix that takes a number'}
    ${'a sub-two pound tent'}                      | ${'a sub-910 gram tent'}         | ${'the same, in words'}
    ${'an under-5 pound baby'}                     | ${'an under-2.3 kilogram baby'}  | ${'another prefix'}
    ${'an under-five pound baby'}                  | ${'an under-2.3 kilogram baby'}  | ${'the same, in words'}
    ${'a near-100°F day'}                          | ${'a near-37.8°C day'}           | ${'a temperature after a prefix'}
    ${'over-50 mph winds'}                         | ${'over-80 km/h winds'}          | ${'a speed after a prefix'}
    ${'a mid-20 mile hike'}                        | ${'a mid-32 kilometre hike'}     | ${'a number after mid- that is no year'}
    ${'a sub-1 pound bag'}                         | ${'a sub-450 gram bag'}          | ${'a determiner before the prefix keeps the singular'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a long chain of heights takes time in line with its length', () => {
  // Generous, since each of these takes tens of milliseconds. A walk back along the chain
  // from every height in it takes seconds.
  const LIMIT_MS = 1000;

  it.each`
    link                            | count   | expected
    ${'6 foot 2 to 6 foot 4 and '}  | ${500}  | ${'1.88 metres to 1.93 metres and 1.88 metres to 1.93 metres and '}
    ${'6 foot 2 to '}               | ${1000} | ${'1.88 metres to 1.88 metres to 1.88 metres to '}
  `('"$link" $count times', ({ link, count, expected }) => {
    convert(link);
    const started = performance.now();
    const output = convert(link.repeat(count));
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

describe('the stop of a unit abbreviation', () => {
  it.each`
    input                                          | expected                                       | why
    ${'The board is 12 in.'}                       | ${'The board is 30 cm.'}                       | ${'the end of the text'}
    ${'The fence is 6 ft. It is new.'}             | ${'The fence is 1.8 m. It is new.'}            | ${'before a new sentence'}
    ${'Add 2 fl. oz.'}                             | ${'Add 59 mL.'}                                | ${'an abbreviation of two words'}
    ${'The fence is 6 ft.\nIt is new.'}            | ${'The fence is 1.8 m.\nIt is new.'}           | ${'before a sentence on the next line'}
    ${'The board is 12 in. One end is red.'}       | ${'The board is 30 cm. One end is red.'}       | ${'before a number in words that opens a sentence'}
    ${'(The board is 12 in.)'}                     | ${'(The board is 30 cm.)'}                     | ${'inside a closing bracket'}
    ${'He is 6 ft. 2 in.'}                         | ${'He is 1.88 metres.'}                        | ${'feet and inches'}
    ${'The gap is 6-12 in.'}                       | ${'The gap is 15-30 cm.'}                      | ${'a range'}
    ${'The sheet is 4 ft. x 8 ft.'}                | ${'The sheet is 1.2 x 2.4 m.'}                 | ${'a dimension'}
    ${'It weighs 5 lb.'}                           | ${'It weighs 2.3 kg.'}                         | ${'pounds'}
    ${'It weighs 5 lbs. The bag is full.'}         | ${'It weighs 2.3 kg. The bag is full.'}        | ${'pounds, plural'}
    ${'Add 8 oz.'}                                 | ${'Add 230 g.'}                                | ${'ounces'}
    ${'The baby weighed 7 lb. 8 oz.'}              | ${'The baby weighed 3.4 kg.'}                  | ${'a weight in two units'}
    ${'It weighs 5 lb. 1 December 2024 was cold.'} | ${'It weighs 2.3 kg. 1 December 2024 was cold.'} | ${'before a sentence that opens with a day-first date'}
    ${'It weighs 5 lb. 25/12/2024 was cold.'}      | ${'It weighs 2.3 kg. 25/12/2024 was cold.'}    | ${'before a sentence that opens with a date in figures'}
  `('keeps the stop that also ends the sentence: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                          | expected                                       | why
    ${'It is 12 in. long.'}                        | ${'It is 30 cm long.'}                         | ${'before a word in lower case'}
    ${'Cut 6 ft. of rope.'}                        | ${'Cut 1.8 m of rope.'}                        | ${'the same, feet'}
    ${'Add 8 oz. of cheese and 5 lb. of beef.'}    | ${'Add 230 g of cheese and 2.3 kg of beef.'}   | ${'ounces and pounds'}
    ${'Add 5 lbs. of beef.'}                       | ${'Add 2.3 kg of beef.'}                       | ${'pounds, plural'}
    ${'Buy a 5 lb. bag of flour.'}                 | ${'Buy a 2.3 kg bag of flour.'}                | ${'before the noun it describes'}
    ${'The baby weighed 7 lb. 8 oz. at birth.'}    | ${'The baby weighed 3.4 kg at birth.'}         | ${'a weight in two units'}
    ${'Buy a 6 ft. HDMI cable.'}                   | ${'Buy a 1.8 m HDMI cable.'}                   | ${'before a word in capitals'}
    ${'Is it 12 in.?'}                             | ${'Is it 30 cm?'}                              | ${'before another stop'}
    ${'Add 8 oz of cheese.'}                       | ${'Add 230 g of cheese.'}                      | ${'no stop of its own'}
    ${'There are 6 in total.'}                     | ${'There are 6 in total.'}                     | ${'the preposition'}
    ${'The engine makes 100 lb-ft of torque.'}     | ${'The engine makes 140 N·m of torque.'}       | ${'torque'}
  `('drops the stop that only ends the abbreviation: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('keeps the stop after the original, outside its bracket', () => {
    expect(convert('The board is 12 in.', { units: { keepOriginal: true } })).toBe('The board is 30 cm (12 in.).');
  });

  it.each`
    input                                     | expected
    ${'The bag weighs 2.2 lb. (1 kg).'}       | ${'The bag weighs 1 kg.'}
    ${'The bag weighs 1 kg (2.2 lb.) today.'} | ${'The bag weighs 1 kg (2.2 lb.) today.'}
  `('reads a dotted weight whole beside its metric value: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                          | expected                              | why
    ${'The bag weighs 2.2 lb. (1 kg) Then stir.'}  | ${'The bag weighs 1 kg. Then stir.'}  | ${'before a new sentence'}
    ${'The fence is 6 ft. (1.8 m) It is new.'}     | ${'The fence is 1.8 m. It is new.'}   | ${'the same, feet'}
    ${'The bag weighs 2.2 lb. (1 kg)'}             | ${'The bag weighs 1 kg.'}             | ${'the end of the text'}
    ${'The bag weighs 2.2 lb./1 kg Then stir.'}    | ${'The bag weighs 1 kg. Then stir.'}  | ${'a pair joined by a slash'}
    ${'The bag weighs 2.2 lb. (1 kg) of flour.'}   | ${'The bag weighs 1 kg of flour.'}    | ${'before a word in lower case'}
    ${'The bag weighs 2.2 lb. (1 kg), then stir.'} | ${'The bag weighs 1 kg, then stir.'}  | ${'before a comma'}
    ${'The bag weighs 2.2 lb. (1 kg).'}            | ${'The bag weighs 1 kg.'}             | ${'before the sentence stop after the bracket'}
  `('decides the stop past the metric value a pair collapses into: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                              | expected                          | why
    ${'The board is 12 in...'}         | ${'The board is 30 cm...'}        | ${'inches'}
    ${'It weighs 5 lb...'}             | ${'It weighs 2.3 kg...'}          | ${'pounds'}
    ${'The fence is 6 ft... or so.'}   | ${'The fence is 1.8 m... or so.'} | ${'inside the sentence'}
    ${'It is 12 in.... long'}          | ${'It is 30 cm... long'}          | ${'a whole ellipsis after the stop'}
  `('keeps the stop that opens an ellipsis: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | expected                                     | why
    ${'It weighs **5 lb.** Then stir.'}         | ${'It weighs **2.3 kg.** Then stir.'}        | ${'strong emphasis'}
    ${'It weighs _5 lb._ Then stir.'}           | ${'It weighs _2.3 kg._ Then stir.'}          | ${'underscore emphasis'}
    ${'It weighs <b>5 lb.</b> Then stir.'}      | ${'It weighs <b>2.3 kg.</b> Then stir.'}     | ${'an inline tag'}
    ${'It weighs **5 lb.**'}                    | ${'It weighs **2.3 kg.**'}                   | ${'the end of the text'}
    ${'It weighs 5 lb. **Then** stir.'}         | ${'It weighs 2.3 kg. **Then** stir.'}        | ${'markup opening the next sentence'}
  `('keeps the stop that ends the sentence before markup: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | expected                                     | why
    ${'It weighs **5 lb.** of flour.'}          | ${'It weighs **2.3 kg** of flour.'}          | ${'before a word in lower case'}
    ${'It weighs <b>5 lb.</b> of flour.'}       | ${'It weighs <b>2.3 kg</b> of flour.'}       | ${'an inline tag'}
    ${'It weighs 5 lb. **of** flour.'}          | ${'It weighs 2.3 kg **of** flour.'}          | ${'markup opening a word in lower case'}
  `('drops the stop inside the sentence past markup: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                              | expected                                         | why
    ${'It is 6 ft. (see the plan) It is new.'}         | ${'It is 1.8 m. (see the plan) It is new.'}      | ${'a new sentence after the bracket'}
    ${'It weighs 5 lb. (It is heavy.) Then stir.'}     | ${'It weighs 2.3 kg. (It is heavy.) Then stir.'} | ${'a sentence in the bracket'}
    ${'It is 6 ft. (see (a) above) It is new.'}        | ${'It is 1.8 m. (see (a) above) It is new.'}     | ${'a bracket inside the bracket'}
    ${'It is 6 ft. *(see the plan)* It is new.'}       | ${'It is 1.8 m. *(see the plan)* It is new.'}    | ${'markup around the bracket'}
    ${'It is 6 ft. (see the plan) (and the map) It is new.'} | ${'It is 1.8 m. (see the plan) (and the map) It is new.'} | ${'two brackets'}
    ${'It is 6 ft. (See the plan.)'}                   | ${'It is 1.8 m. (See the plan.)'}                | ${'a sentence in the bracket at the end of the text'}
    ${'It is 6 ft. (See the plan.)\n\nIt is new.'}     | ${'It is 1.8 m. (See the plan.)\n\nIt is new.'}  | ${'the same, at the end of the paragraph'}
  `('keeps the stop where the sentence ends past a bracket: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                              | expected                                         | why
    ${'It is 6 ft. (see the plan) and new.'}           | ${'It is 1.8 m (see the plan) and new.'}         | ${'a word in lower case after the bracket'}
    ${'It is 6 ft. (Roughly) and new.'}                | ${'It is 1.8 m (Roughly) and new.'}              | ${'a capital in the bracket'}
    ${'It is 6 ft. (or so) long.'}                     | ${'It is 1.8 m (or so) long.'}                   | ${'the same, a word in lower case'}
    ${'It is 6 ft. (see the plan).'}                   | ${'It is 1.8 m (see the plan).'}                 | ${'the sentence stop after the bracket'}
    ${'It is 6 ft. (see the plan), and new.'}          | ${'It is 1.8 m (see the plan), and new.'}        | ${'a comma after the bracket'}
    ${'It is 6 ft. (see the plan'}                     | ${'It is 1.8 m (see the plan'}                   | ${'a bracket that never closes'}
    ${'It is 6 ft. (see the plan)'}                    | ${'It is 1.8 m (see the plan)'}                  | ${'words in lower case in the bracket at the end of the text'}
    ${'- The fence is 6 ft. (approx.)'}                | ${'- The fence is 1.8 m (approx.)'}              | ${'the same, in a list item'}
    ${'6 feet (see the diagram)'}                      | ${'1.8 metres (see the diagram)'}                | ${'no stop'}
  `('drops the stop where the sentence goes on past a bracket: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a spaced "in." that ends the sentence after a verb taking "in"', () => {
  it.each`
    unchanged                                              | why
    ${'The bus was full, so the driver let only 3 in.'}    | ${'let, across only'}
    ${'How many sugars? I put 2 in.'}                      | ${'put'}
    ${'The hall was packed, but they squeezed 6 in.'}      | ${'squeezed'}
    ${'They brought another 4 in.'}                        | ${'brought, across another'}
    ${'We called the 3 in.'}                               | ${'called, across a determiner'}
    ${'The driver let only three in.'}                     | ${'a count in words'}
    ${'How many sugars? I put 2-3 in.'}                    | ${'a range'}
    ${'The driver let only 3 in. Then he drove off.'}      | ${'before another sentence'}
    ${'(I put 2 in.)'}                                     | ${'inside a closing bracket'}
    ${'The driver let only 3 in and drove off.'}           | ${'a spaced "in" with no stop is the preposition'}
    ${'There are 6 in total.'}                             | ${'the same'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    unchanged                                                  | why
    ${'They let only 3 in...'}                                 | ${'an ellipsis'}
    ${'I put 2 in... then shut the door.'}                     | ${'an ellipsis inside the sentence'}
    ${'They let only 3 in.'}                                   | ${'the end of the text'}
    ${'The driver let only 3 in. (see the map) Then he left.'} | ${'a new sentence past a bracket'}
    ${'**The driver let only 3 in.** Then he left.'}           | ${'a new sentence past closing markup'}
  `('leaves "$unchanged" alone where the stop stays ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                 | expected                              | why
    ${'Trim the board to 12 in.'}         | ${'Trim the board to 30 cm.'}         | ${'no verb that takes "in"'}
    ${'It is 12 in. long.'}               | ${'It is 30 cm long.'}                | ${'the stop ends only the abbreviation'}
    ${'Put a 12 in. tile in the gap.'}    | ${'Put a 30 cm tile in the gap.'}     | ${'the same, after a verb that takes "in"'}
    ${'Let the hem down 2 in.'}           | ${'Let the hem down 5.1 cm.'}         | ${'more than a word between the verb and the count'}
    ${'He let 3in.'}                      | ${'He let 7.6 cm.'}                   | ${'"in" straight after the number'}
    ${'The board is 12 in...'}            | ${'The board is 30 cm...'}            | ${'an ellipsis with no verb that takes "in"'}
    ${'He let only 3 in. (see the map) and left.'} | ${'He let only 7.6 cm (see the map) and left.'} | ${'the sentence goes on past a bracket'}
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
    input                                    | span
    ${'The driver let only 3 in.'}           | ${'3 in.'}
    ${'How many sugars? I put 2-3 in.'}      | ${'2-3 in.'}
  `('holds $span whole, even with respectConventions off', ({ input, span }) => {
    expect(held(input)).toContain(span);
    expect(held(input, { units: { respectConventions: false } })).toContain(span);
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

describe('a spelled-out temperature that describes a noun stays singular', () => {
  it.each`
    input                                   | expected                                   | why
    ${'a 350 degree F oven'}                | ${'a 175 degree Celsius oven'}             | ${'degree F'}
    ${'a 350 degree Fahrenheit oven'}       | ${'a 175 degree Celsius oven'}             | ${'degree Fahrenheit'}
    ${'a 350-375 degree F oven'}            | ${'a 175-190 degree Celsius oven'}         | ${'a range'}
    ${'a 10 degree F drop in a day'}        | ${'a 5.6 degree Celsius drop in a day'}    | ${'a change in temperature'}
    ${'Bake at 350 degree F and stir.'}     | ${'Bake at 175 degrees Celsius and stir.'} | ${'no noun after it'}
    ${'Bake at 350 degree F. Stir well.'}   | ${'Bake at 175 degrees Celsius. Stir well.'} | ${'a stop that ends the sentence'}
    ${'a 350 degrees F oven'}               | ${'a 175 degrees Celsius oven'}            | ${'the plural stays plural'}
    ${'Preheat to 350 degrees F.'}          | ${'Preheat to 175 degrees Celsius.'}       | ${'the plural with no noun'}
    ${'It was 72 degrees Fahrenheit.'}      | ${'It was 22.2 degrees Celsius.'}          | ${'the same, spelled out'}
    ${'a 350°F oven'}                       | ${'a 175°C oven'}                          | ${'a symbol has no number'}
    ${'a 350-degree F oven'}                | ${'a 175 degree Celsius oven'}             | ${'a hyphen ties the number to "degree"'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a hyphenated degree-Fahrenheit modifier', () => {
  it.each`
    input                                                       | expected                                  | why
    ${'It was 110-degree-Fahrenheit heat.'}                     | ${'It was 43.3 degree Celsius heat.'}     | ${'both hyphens'}
    ${'It was a 110 degree-Fahrenheit day.'}                    | ${'It was a 43.3 degree Celsius day.'}    | ${'the second hyphen alone'}
    ${'Use a 350‐degree‐F oven today.'}                         | ${'Use a 175 degree Celsius oven today.'} | ${'U+2010 hyphens and an F'}
    ${'It was a 100-110-degree-Fahrenheit day.'}                | ${'It was a 38-43 degree Celsius day.'}   | ${'a range'}
    ${'The heat hit 110-degree-Fahrenheit today.'}              | ${'The heat hit 43.3 degrees Celsius today.'} | ${'no noun after it takes the plural'}
    ${'It was 110-degrees-Fahrenheit today.'}                   | ${'It was 43.3 degrees Celsius today.'}   | ${'the plural stays plural'}
    ${'It was a 110-degree-Fahrenheit (43-degree-Celsius) day.'} | ${'It was a 43-degree-Celsius day.'}     | ${'a hyphenated Celsius partner'}
    ${'It was 110 degrees Fahrenheit.'}                         | ${'It was 43.3 degrees Celsius.'}         | ${'spaced'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts a hyphenated degree-F modifier', () => {
    expect(convert('A 110-degree-F day.', { assumeAmerican: true })).toBe('A 43.3 degree Celsius day.');
  });

  it.each`
    unchanged                                                    | why
    ${'A 110-degree day.'}                                       | ${'bare degrees'}
    ${'It was a 43-degree-Celsius (110-degree-Fahrenheit) day.'} | ${'the Fahrenheit value restates the Celsius one'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('the stop of a Fahrenheit F', () => {
  it.each`
    input                                    | expected                                    | why
    ${'Bake at 350 degrees F. Stir well.'}   | ${'Bake at 175 degrees Celsius. Stir well.'} | ${'before a new sentence'}
    ${'Bake at 350 degrees F. Then rest it.'} | ${'Bake at 175 degrees Celsius. Then rest it.'} | ${'the same'}
    ${'Preheat to 350 degrees F.'}           | ${'Preheat to 175 degrees Celsius.'}        | ${'the end of the text'}
    ${'Roast at 425 deg F.\nThen rest it.'}  | ${'Roast at 220°C.\nThen rest it.'}         | ${'before a sentence on the next line'}
    ${'Bake at 350F. Stir well.'}            | ${'Bake at 175°C. Stir well.'}              | ${'a bare F'}
    ${'Highs in the 80s degrees F. Then rain.'} | ${'Highs between 27 and 32°C. Then rain.'} | ${'a decade'}
  `('keeps the stop that also ends the sentence: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                          | expected                                          | why
    ${'Bake at 350 degrees F. for 20 minutes.'}    | ${'Bake at 175 degrees Celsius for 20 minutes.'}  | ${'degrees F'}
    ${'Bake at 350 deg F. for 20 minutes.'}        | ${'Bake at 175°C for 20 minutes.'}                | ${'deg F'}
    ${'Bake at 350-375 degrees F. for an hour.'}   | ${'Bake at 175-190 degrees Celsius for an hour.'} | ${'a range'}
    ${'Bake at 350F. for 20 minutes.'}             | ${'Bake at 175°C for 20 minutes.'}                | ${'a bare F'}
    ${'Bake at 350 F. for 20 minutes.'}            | ${'Bake at 175°C for 20 minutes.'}                | ${'a spaced bare F'}
    ${'Use a 350 degree F. oven for it.'}          | ${'Use a 175 degree Celsius oven for it.'}        | ${'before the noun it describes'}
    ${'Highs in the 80s degrees F. for days on end.'} | ${'Highs between 27 and 32°C for days on end.'} | ${'a decade'}
    ${'- 350 degrees F.'}                          | ${'- 175 degrees Celsius'}                        | ${'a label, as for in.'}
    ${'He said "Bake at 350 degrees F." and left.'} | ${'He said "Bake at 175 degrees Celsius" and left.'} | ${'inside a quote, as for in.'}
  `('drops the stop inside the sentence: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                 | expected                                                  | why
    ${'Bake at 350 degrees F...'}                         | ${'Bake at 175 degrees Celsius...'}                       | ${'an ellipsis'}
    ${'Bake at 350 degrees F. 2 trays fit.'}              | ${'Bake at 175 degrees Celsius. 2 trays fit.'}            | ${'before a figure'}
    ${'Bake at 350 degrees F. (see below) Then stir.'}    | ${'Bake at 175 degrees Celsius. (see below) Then stir.'}    | ${'before a bracket the sentence may trail'}
    ${'Set it to 350 F. for an hour.'}                    | ${'Set it to 350 F. for an hour.'}                        | ${'a bare F with no word about heat'}
    ${'Bake it at 350 f. for an hour.'}                   | ${'Bake it at 350 f. for an hour.'}                       | ${'a lower case bare f'}
  `('leaves the stop in the text: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | expected                                         | why
    ${'Bake at 350°F. for 20 minutes.'}         | ${'Bake at 175°C for 20 minutes.'}               | ${'a degree sign'}
    ${'Bake at 350℉. for 20 minutes.'}          | ${'Bake at 175°C for 20 minutes.'}               | ${'one sign'}
    ${'Bake at 350ºF. for an hour.'}            | ${'Bake at 175°C for an hour.'}                  | ${'the masculine ordinal for the degree sign'}
    ${'Bake at 350-375°F. for an hour.'}        | ${'Bake at 175-190°C for an hour.'}              | ${'a range'}
    ${'Use a 350°F. oven for it.'}              | ${'Use a 175°C oven for it.'}                    | ${'before the noun it describes'}
    ${'Highs in the 80s°F. for days'}           | ${'Highs between 27 and 32°C for days'}          | ${'a decade'}
  `('drops the stop after a symbol only before a word in lower case: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                    | expected                                  | why
    ${'- 350°F.'}                            | ${'- 175°C.'}                             | ${'a label'}
    ${'- 350ºF.'}                            | ${'- 175°C.'}                             | ${'the masculine ordinal for the degree sign'}
    ${'- 350˚F.'}                            | ${'- 175°C.'}                             | ${'the ring above'}
    ${'- 350℉.'}                             | ${'- 175°C.'}                             | ${'one sign'}
    ${'"Bake at 350°F." he said'}            | ${'"Bake at 175°C." he said'}             | ${'a closing quote between'}
    ${'Bake at 350°F.'}                      | ${'Bake at 175°C.'}                       | ${'the end of the text'}
    ${'Heat it to 350°F. Then stir.'}        | ${'Heat it to 175°C. Then stir.'}         | ${'before a new sentence'}
    ${'It was 90°F. Then it rained.'}        | ${'It was 32.2°C. Then it rained.'}       | ${'the same'}
    ${'Highs in the 80s°F. Then rain.'}      | ${'Highs between 27 and 32°C. Then rain.'} | ${'a decade before a new sentence'}
    ${'Bake at 350°F. 2 trays fit.'}         | ${'Bake at 175°C. 2 trays fit.'}          | ${'before a figure'}
    ${'Bake at 350°F. (see below) Then stir.'} | ${'Bake at 175°C. (see below) Then stir.'} | ${'before a bracket'}
    ${'Bake at 350°F (175°C).'}              | ${'Bake at 175°C.'}                       | ${'after its Celsius value'}
    ${'- 350 degrees Fahrenheit.'}           | ${'- 175 degrees Celsius.'}               | ${'the word takes no stop'}
  `('leaves the stop after a symbol or the word everywhere else: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                            | expected                       | why
    ${'Bake at 350°F. (175°C) Then stir.'}           | ${'Bake at 175°C. Then stir.'} | ${'a symbol before a new sentence'}
    ${'Bake at 350°F. (175°C)'}                      | ${'Bake at 175°C.'}            | ${'the end of the text'}
    ${'Bake at 350°F. (175°C) for an hour.'}         | ${'Bake at 175°C for an hour.'} | ${'a symbol before a word in lower case'}
    ${'Bake at 350°F. (175°C).'}                     | ${'Bake at 175°C.'}            | ${'before the sentence stop after the bracket'}
    ${'Bake at 350°F. (175°C), then stir.'}          | ${'Bake at 175°C, then stir.'} | ${'before a comma'}
    ${'Bake at 350 degrees F. (175°C) for an hour.'} | ${'Bake at 175°C for an hour.'} | ${'a bare letter F'}
    ${'Bake at 350 degrees F. (175°C) Then stir.'}   | ${'Bake at 175°C. Then stir.'} | ${'a bare letter F before a new sentence'}
    ${'Bake at 350°F (175°C). Then stir.'}           | ${'Bake at 175°C. Then stir.'} | ${'no stop before the bracket'}
    ${'Bake at 350°F. Then stir.'}                   | ${'Bake at 175°C. Then stir.'} | ${'no bracket'}
  `('decides the stop past the Celsius value a pair collapses into: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                               | expected                                                | why
    ${'Bake at 350 degrees F. (or so) for an hour.'}    | ${'Bake at 175 degrees Celsius (or so) for an hour.'}   | ${'a bare letter F'}
    ${'Bake at 350°F. (or so) for an hour.'}            | ${'Bake at 175°C (or so) for an hour.'}                 | ${'a symbol'}
    ${'Bake at 350 degrees F. (or so) Then stir.'}      | ${'Bake at 175 degrees Celsius. (or so) Then stir.'}    | ${'a bare letter F before a new sentence'}
    ${'Bake at 350°F. (or so) Then stir.'}              | ${'Bake at 175°C. (or so) Then stir.'}                  | ${'a symbol before a new sentence'}
    ${'Bake at 350°F. (or so)'}                         | ${'Bake at 175°C. (or so)'}                             | ${'a symbol at the end of the text'}
    ${'Preheat to 350 degrees F. (or so)'}              | ${'Preheat to 175 degrees Celsius (or so)'}             | ${'a bare letter F at the end of the text'}
  `('decides the stop before a bracket past its close: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | expected                                   | why
    ${'Bake at **350°F.** for an hour.'}        | ${'Bake at **175°C** for an hour.'}        | ${'a symbol before a word in lower case'}
    ${'Bake at **350°F.** Then stir.'}          | ${'Bake at **175°C.** Then stir.'}         | ${'a symbol before a new sentence'}
    ${'Bake at **350 degrees F.** Then stir.'}  | ${'Bake at **175 degrees Celsius.** Then stir.'} | ${'a bare letter F before a new sentence'}
  `('decides the stop past closing markup: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged
    ${'Bake at 175°C (350°F.).'}
    ${'Bake at 175°C (350℉.).'}
    ${'Bake at 175°C (350 degrees F.).'}
    ${'Bake at 180°C/350 degrees F. Stir well.'}
  `('reads "$unchanged" as a restatement of the Celsius value before it', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected
    ${'Bake at 350°F.'}                            | ${'Bake at 175°C (350°F).'}
    ${'Bake at 350°F. for 20 minutes.'}            | ${'Bake at 175°C (350°F.) for 20 minutes.'}
    ${'Preheat to 350 degrees F.'}                 | ${'Preheat to 175 degrees Celsius (350 degrees F).'}
    ${'Bake at 350 degrees F. for 20 minutes.'}    | ${'Bake at 175 degrees Celsius (350 degrees F.) for 20 minutes.'}
  `('keeps the original of $input and runs twice without converting it again', ({ input, expected }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(once).toBe(expected);
    expect(convert(once, options)).toBe(once);
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
    ${'Keep it between 60 and 70°F.'}                 | ${'Keep it between 16 and 21°C.'}                 | ${'between and, in a sentence'}
    ${'Bake at 350 to 375 degrees F.'}                | ${'Bake at 175 to 190 degrees Celsius.'}          | ${'to, before degrees F'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                     | why
    ${'Serial 1234567890123 is fine.'}            | ${'a serial number'}
    ${`Serial 1${'1'.repeat(8000)} ends.`}        | ${'a long run of digits'}
    ${`Keep it between 6${'0'.repeat(8000)} and`} | ${'a long figure after between, with no unit'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
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

describe('a Fahrenheit figure grouped in thousands', () => {
  it.each`
    input                                              | expected                                      | why
    ${'The kiln reached 2,000°F.'}                     | ${'The kiln reached 1,095°C.'}                | ${'grouped by a comma, as the Celsius value is'}
    ${'The furnace runs at 1,200 degrees Fahrenheit.'} | ${'The furnace runs at 650 degrees Celsius.'} | ${'spelled out'}
    ${'Fire it at 1,000-1,200°F.'}                     | ${'Fire it at 540-650°C.'}                    | ${'a range'}
    ${'It ran between 1,000 and 1,200°F.'}             | ${'It ran between 540 and 650°C.'}            | ${'a range after between'}
    ${'Fire it at 1,000, 1,100 or 1,200°F.'}           | ${'Fire it at 540, 595 or 650°C.'}            | ${'a list'}
    ${'The kiln reached 1 000°F.'}                     | ${'The kiln reached 540°C.'}                  | ${'grouped by a space'}
    ${'The kiln reached 4 000°F.'}                     | ${'The kiln reached 2 205°C.'}                | ${'grouped by a space, as the Celsius value is'}
    ${'It was 1,001.5°F inside.'}                      | ${'It was 538.6°C inside.'}                   | ${'with a decimal'}
    ${'Temperatures rose by 1,000°F.'}                 | ${'Temperatures rose by 560°C.'}              | ${'a difference'}
    ${'Heat the kiln to 2,000 F.'}                     | ${'Heat the kiln to 1,095°C.'}                | ${'a bare F in a sentence about heat'}
    ${'Fire it to 2,000°F (1,095°C).'}                 | ${'Fire it to 1,095°C.'}                      | ${'the Celsius value given beside it'}
    ${'Bake at 350°F.'}                                | ${'Bake at 175°C.'}                           | ${'three figures'}
    ${'The kiln reached 2000°F.'}                      | ${'The kiln reached 1095°C.'}                 | ${'four figures, not grouped'}
    ${'Fire it at 2 350°F.'}                           | ${'Fire it at 1 290°C.'}                      | ${'groups that could be a count, with no noun after'}
    ${'Fire a 2 350°F loaf.'}                          | ${'Fire a 1 290°C loaf.'}                     | ${'the same, after a determiner that takes one'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                   | why
    ${'In 1724 Fahrenheit proposed his scale.'} | ${'a year before the bare word'}
    ${'Fahrenheit 451'}                         | ${'a title'}
    ${'Fire it to 1,095°C (2,000°F).'}          | ${'the courtesy figure after Celsius'}
    ${'The kiln reached 2,000 F.'}              | ${'a bare F with no word about heat'}
    ${'Heat the kiln to 2000 F.'}               | ${'four figures before a bare F, not grouped'}
    ${'Fire 2 350°F loaves.'}                   | ${'a count, then the temperature of the loaves'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('keeps the original grouped figure', () => {
    expect(convert('The kiln reached 2,000°F.', { units: { keepOriginal: true } })).toBe(
      'The kiln reached 1,095°C (2,000°F).',
    );
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

  const stirring = 'stir it well and wait, '.repeat(60);

  it.each`
    input                                                            | expected                                                         | why
    ${`Set it to 95F, then ${stirring}and put it in the oven.`}      | ${`Set it to 35°C, then ${stirring}and put it in the oven.`}     | ${'a word about heat far along the sentence'}
    ${`Put it in the oven, then ${stirring}and set it to 95F.`}      | ${`Put it in the oven, then ${stirring}and set it to 35°C.`}     | ${'a word about heat far back in the sentence'}
    ${`Preheat to 350F, then ${stirring}until the dial reads 180C.`} | ${`Preheat to 350F, then ${stirring}until the dial reads 180C.`} | ${'a Celsius value far along the sentence'}
    ${`Set it to 95F. Then ${stirring}and put it in the oven.`}      | ${`Set it to 95F. Then ${stirring}and put it in the oven.`}      | ${'a word about heat in the next sentence'}
    ${'Bake at 350F.'}                                               | ${'Bake at 175°C.'}                                              | ${'a word about heat beside it'}
    ${'Seat 22F is free.'}                                           | ${'Seat 22F is free.'}                                           | ${'no word about heat'}
  `('reads the whole sentence of a bare F: $why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('decides a bare F by a word about heat far along its sentence on the first run', () => {
    const localise = { preset: 'localise' } as const;
    const input =
      'Set it to 95F, then pour 100 fluid ounces, 100 fluid ounces, 100 fluid ounces, 100 fluid ounces, ' +
      '100 fluid ounces and 100 fluid ounces into the oven.';
    const once = deamericaniseText(input, localise);
    expect(once).toBe(
      'Set it to 35°C, then pour 3 litres, 3 litres, 3 litres, 3 litres, 3 litres and 3 litres into the oven.',
    );
    expect(deamericaniseText(once, localise)).toBe(once);
  });

  it.each`
    input                                                 | expected
    ${'Temperatures at 6 p.m. were 10F.'}                 | ${'Temperatures at 6pm were -12.2°C.'}
    ${'Preheat, said Mr. Smith, to 350F.'}                | ${'Preheat, said Mr Smith, to 175°C.'}
    ${'Bake it the U.S. Army way at 350F.'}               | ${'Bake it the US Army way at 175°C.'}
    ${'At 20C by 6 p.m. Temperatures hit 50F.'}           | ${'At 20C by 6pm. Temperatures hit 10°C.'}
    ${'Put the cookie sheet in at 350F.'}                 | ${'Put the baking tray in at 175°C.'}
    ${'Put the baking tray in at 350F.'}                  | ${'Put the baking tray in at 175°C.'}
    ${'It hit 10F. December 1, 2024 was a few degrees colder.'} | ${'It hit 10F. 1 December 2024 was a few degrees colder.'}
    ${'It hit 10F. Dec 1st was a few degrees colder.'}    | ${'It hit 10F. 1 December was a few degrees colder.'}
    ${'It hit 10F. 1 December 2024 was a few degrees colder.'} | ${'It hit 10F. 1 December 2024 was a few degrees colder.'}
    ${'It hit 10F. In December it was a few degrees colder.'} | ${'It hit 10F. In December it was a few degrees colder.'}
    ${'The heat was bad. Two feet of snow fell at 35F.'}  | ${'The heat was bad. 61 centimetres of snow fell at 1.7°C.'}
  `('decides $input on the first run as the second would', ({ input, expected }) => {
    const once = deamericaniseText(input, { preset: 'localise' });
    expect(once).toBe(expected);
    expect(deamericaniseText(once, { preset: 'localise' })).toBe(once);
  });

  it('decides a bare F before a month-first date on the first run as the second would, with dates in figures', () => {
    const dayFirst = { preset: 'localise', dates: { format: 'dmy' } } as const;
    const once = deamericaniseText('It hit 10F. December 1, 2024 was a few degrees colder.', dayFirst);
    expect(once).toBe('It hit 10F. 01/12/2024 was a few degrees colder.');
    expect(deamericaniseText(once, dayFirst)).toBe(once);
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

describe('fuel economy', () => {
  /** Every change and hold the fuel economy rule makes in `text`. */
  const economyChanges = (text: string): Change[] => {
    const resolved = resolveOptions({});
    const ctx: RuleContext = { text, options: resolved, signals: analyse(text), american: true };
    return patternRules(resolved)
      .filter((rule) => rule.id === 'units.economy.mpg')
      .flatMap((rule) => rule.find(ctx));
  };

  it.each`
    range                   | read
    ${'20 to 30 mpg, '}     | ${'converted'}
    ${'twenty to 30 mpg, '} | ${'held'}
    ${'20, 25 or 30 mpg; '} | ${'converted, as a list'}
    ${'twenty, 25 or 30 mpg; '} | ${'held, as a list'}
  `('gives one change for each range, $read: "$range"', ({ range }) => {
    expect(economyChanges(range.repeat(50))).toHaveLength(50);
  });

  it.each`
    input                                             | expected                                   | why
    ${'It does 30 miles/gallon on the highway'}       | ${'It does 7.8 L/100km on the highway'}    | ${'a slash'}
    ${'It does 30 miles / gallon on the highway'}     | ${'It does 7.8 L/100km on the highway'}    | ${'a spaced slash'}
    ${'It does 30 mi/gal on the highway'}             | ${'It does 7.8 L/100km on the highway'}    | ${'abbreviated'}
    ${'It does 30 Miles/Gallon on the highway'}       | ${'It does 7.8 L/100km on the highway'}    | ${'capitalised'}
    ${'It does 30 miles-per-gallon on the highway'}   | ${'It does 7.8 L/100km on the highway'}    | ${'hyphenated'}
    ${'It does 30 miles\nper gallon on the highway'}  | ${'It does 7.8 L/100km on the highway'}    | ${'a wrapped line'}
    ${'a 30-miles-per-gallon car'}                    | ${'a 7.8 L/100km car'}                     | ${'a hyphen after the number'}
    ${'a 30-mpg car'}                                 | ${'a 7.8 L/100km car'}                     | ${'the same, abbreviated'}
    ${'In 2024 - 30 miles/gallon on the highway'}     | ${'In 2024 - 7.8 L/100km on the highway'}  | ${'a year before it'}
    ${'It does 30 miles/gallon (7.8 L/100km) here'}   | ${'It does 7.8 L/100km here'}              | ${'a bracket that restates it'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                | expected                                     | why
    ${'It does 20 to 30 mpg on the highway'}             | ${'It does 7.8 to 12 L/100km on the highway'} | ${'to, the smaller first'}
    ${'It does 20 - 30 mpg on the highway'}              | ${'It does 7.8-12 L/100km on the highway'}   | ${'a spaced dash'}
    ${'It does 20-30 mpg on the highway'}                | ${'It does 7.8-12 L/100km on the highway'}   | ${'a tight dash'}
    ${'between 25 and 30 miles per gallon'}              | ${'between 7.8 and 9.4 L/100km'}             | ${'and after between'}
    ${'It does 30 to 20 mpg on the highway'}             | ${'It does 7.8 to 12 L/100km on the highway'} | ${'falling, the smaller first too'}
    ${'It does 20 to 30 mi/gal on the highway'}          | ${'It does 7.8 to 12 L/100km on the highway'} | ${'not a range of lengths'}
    ${'Economy improved from 20 to 30 mpg here'}         | ${'Economy improved from 12 to 7.8 L/100km here'} | ${'from shows a direction'}
    ${'Economy fell from 30 to 20 mpg here'}             | ${'Economy fell from 7.8 to 12 L/100km here'} | ${'the same, falling'}
    ${'It does 25 to 30 mpg (7.8 to 9.4 L/100km) here'}  | ${'It does 7.8 to 9.4 L/100km here'}         | ${'a bracket that restates it'}
    ${'It does 25 to 30 mpg (9.4 to 7.8 L/100km) here'}  | ${'It does 9.4 to 7.8 L/100km here'}         | ${'the same, in the source order'}
    ${'It fell by half to 30 mpg on the hill'}           | ${'It fell by half to 7.8 L/100km on the hill'} | ${'half to is an idiom'}
  `('reads a range: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                               | why
    ${'It does twenty to 30 mpg on the highway'}            | ${'a first end in words'}
    ${'between one and 30 miles per gallon'}                | ${'the same, written out'}
    ${'It does 0 to 30 mpg on the highway'}                 | ${'a first end of zero'}
    ${'It does 5 to 20 to 30 miles per gallon on the road'} | ${'the second end of a range'}
    ${'It does 0 miles per gallon on the hill'}             | ${'zero, which has no litres per 100 km'}
    ${'It does 7.8 L/100km (30 miles/gallon) here'}         | ${'the original in brackets'}
    ${'It does 7.8 L/100km (30 mi/gal) here'}               | ${'the same, abbreviated'}
    ${'It does 7.8 L/100km (30 miles-per-gallon) here'}     | ${'the same, hyphenated'}
    ${'At 7:30 miles/gallon'}                               | ${'the minutes of a time'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected
    ${'It does 30 miles/gallon on the road'}       | ${'It does 13 km/L on the road'}
    ${'It does 20 to 30 mpg on the road'}          | ${'It does 8.5 to 13 km/L on the road'}
    ${'It does 30 to 20 mpg on the road'}          | ${'It does 8.5 to 13 km/L on the road'}
    ${'Economy improved from 20 to 30 mpg here'}   | ${'Economy improved from 8.5 to 13 km/L here'}
    ${'Economy fell from 30 to 20 mpg here'}       | ${'Economy fell from 13 to 8.5 km/L here'}
  `('in km per litre: $input -> $expected', ({ input, expected }) => {
    expect(convert(input, { units: { fuelEconomy: 'km-per-l' } })).toBe(expected);
  });

  it.each`
    input                                          | expected
    ${'It does 30 miles/gallon on the road'}       | ${'It does 7.8 L/100km (30 miles/gallon) on the road'}
    ${'It does 20 to 30 mpg on the road'}          | ${'It does 7.8 to 12 L/100km (20 to 30 mpg) on the road'}
    ${'Economy improved from 20 to 30 mpg here'}   | ${'Economy improved from 12 to 7.8 L/100km (20 to 30 mpg) here'}
  `('keeps the original of $input, and runs twice without converting it again', ({ input, expected }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(once).toBe(expected);
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    input                               | expected
    ${'It flows at 5 gallons/minute.'}  | ${'It flows at 19 litres/minute.'}
    ${'It moves at 10 feet/second.'}    | ${'It moves at 3 metres/second.'}
    ${'It does 30 mpg.'}                | ${'It does 7.8 L/100km.'}
    ${'It does 30 mpg (7.8 L/100km).'}  | ${'It does 7.8 L/100km.'}
    ${'In 2024 - 30 mpg'}               | ${'In 2024 - 7.8 L/100km'}
    ${'At 7:30 mpg'}                    | ${'At 7:30 mpg'}
  `('still gives $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a unit of more than one word in the singular', () => {
  it.each`
    input                                          | expected
    ${'Inflate to half a pound per square inch.'}  | ${'Inflate to 3.4 kilopascals.'}
    ${'It drops 1 pound per square inch a month.'} | ${'It drops 6.9 kilopascals a month.'}
    ${'It moves at half a mile per hour.'}         | ${'It moves at 0.8 kilometres per hour.'}
    ${'It moves at 1 mile an hour.'}               | ${'It moves at 1.6 kilometres per hour.'}
    ${'Tighten it to 1 foot pound.'}               | ${'Tighten it to 1.4 newton metres.'}
    ${'Expect a 5 pound per square inch drop.'}    | ${'Expect a 34 kilopascal drop.'}
    ${'Enter a 25 mile per hour zone.'}            | ${'Enter a 40 kilometre per hour zone.'}
    ${'Add half a pound of butter.'}               | ${'Add 230 grams of butter.'}
    ${'Inflate to 30 pounds per square inch.'}     | ${'Inflate to 210 kilopascals.'}
    ${'1 mile'}                                    | ${'1.6 kilometres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                 | expected
    ${'I walked 1 mile an hour ago.'}     | ${'I walked 1.6 kilometres an hour ago.'}
    ${'I walked half a mile an hour ago.'} | ${'I walked 800 metres an hour ago.'}
    ${'I walked 2 miles an hour ago.'}    | ${'I walked 3.2 kilometres an hour ago.'}
    ${'She had run 3 miles an hour later.'} | ${'She had run 4.8 kilometres an hour later.'}
  `('reads the distance before a time in $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  /** The singular of a plural form, as `pound per square inch` is of `pounds per square inch`. */
  const singular = (form: string) =>
    form.replace(/\b(?:feet|(\w+?ch)es|(\w+)s)\b/, (_, ches?: string, stem?: string) => ches ?? stem ?? 'foot');

  /** Forms that are their own plural, so a number above one says nothing of how they are used. */
  const OWN_PLURAL = ['stone', 'horsepower'];

  it.each(MEASURES.map((measure) => [measure.id, measure] as const))(
    '%s lists as singular every word that is not a plural',
    (_, measure) => {
      const plurals = measure.words.filter((word) => singular(word) !== word);
      const singulars = measure.words.filter((word) => !plurals.includes(word) && !OWN_PLURAL.includes(word));
      expect([...measure.singular].sort()).toEqual(singulars.sort());
      for (const word of plurals) expect(measure.singular, word).toContain(singular(word));
    },
  );
  const masked = (text: string) => text.replace(/\d(?:[\d.,]*\d)?/g, '#');
  const compounds = MEASURES.flatMap((measure) =>
    [...new Set(measure.words.filter((word) => /[\s-]/.test(word)).flatMap((word) => [word, singular(word)]))].map(
      (form) => [form, measure] as const,
    ),
  );

  it.each(compounds)('reads "%s" after one and after half as its plural after two', (form, measure) => {
    const options = { rules: { [measure.id]: true } };
    const plural = convert(`Set it to 2 ${measure.words[0]}.`, options);
    expect(plural).not.toContain(measure.words[0]);
    for (const count of ['1', 'half a']) {
      expect(masked(convert(`Set it to ${count} ${form}.`, options)), count).toBe(masked(plural));
    }
  });
});

describe('a unit of more than one word written with hyphens', () => {
  it.each`
    input                                           | expected                                       | why
    ${'A 35-mile-per-hour wind.'}                   | ${'A 56 km/h wind.'}                           | ${'a speed before its noun'}
    ${'A 35-mile-an-hour wind.'}                    | ${'A 56 km/h wind.'}                           | ${'the same, an hour'}
    ${'A 35 mile-per-hour wind.'}                   | ${'A 56 km/h wind.'}                           | ${'the same, spaced from its number'}
    ${'They forecast 35-miles-per-hour winds.'}     | ${'They forecast 56 km/h winds.'}              | ${'the same, plural'}
    ${'A 30- to 40-mile-per-hour wind.'}            | ${'A 48 to 64 km/h wind.'}                     | ${'a range of speeds'}
    ${'The wind reached 35-mile-per-hour.'}         | ${'The wind reached 56 kilometres per hour.'}  | ${'a speed before no noun'}
    ${'A 35-mile-per-hour, gusty wind.'}            | ${'A 56 km/h, gusty wind.'}                    | ${'a speed before a comma and another modifier'}
    ${'It was 35-mile-per-hour, gusty and cold.'}   | ${'It was 56 kilometres per hour, gusty and cold.'} | ${'a speed after a verb, before a comma'}
    ${'a 100-pound-per-square-inch tank'}           | ${'a 690 kilopascal tank'}                     | ${'a pressure'}
    ${'A 500-square-foot apartment.'}               | ${'A 46 square metre apartment.'}              | ${'an area'}
    ${'a 10-cubic-foot fridge'}                     | ${'a 280 litre fridge'}                        | ${'a volume'}
    ${'a 2-fluid-ounce shot'}                       | ${'a 59 millilitre shot'}                      | ${'a fluid ounce'}
    ${'a 1-troy-ounce coin'}                        | ${'a 31 gram coin'}                            | ${'a troy ounce'}
    ${'a 35-sq-ft room'}                            | ${'a 3.3 m² room'}                             | ${'an abbreviation of two words'}
    ${'A 35‐mile‐per‐hour wind.'}    | ${'A 56 km/h wind.'}                           | ${'the Unicode hyphen'}
    ${'A 500‑square‑foot apartment.'}     | ${'A 46 square metre apartment.'}              | ${'the non-breaking hyphen'}
  `('reads it as one unit: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reports one change under the unit it reads', () => {
    const { changes } = deamericanise('A 35-mile-per-hour wind.', { categories: { spelling: false, vocabulary: false } });
    expect(changes.map(({ ruleId, before, after }) => ({ ruleId, before, after }))).toEqual([
      { ruleId: 'units.speed.mph', before: '35-mile-per-hour', after: '56 km/h' },
    ]);
  });

  it.each`
    unchanged                                            | why
    ${'A 46 square metre (500-square-foot) apartment.'}  | ${'an area that restates its metric value'}
    ${'A 56 km/h (35-mile-per-hour) wind.'}              | ${'the same, a speed'}
    ${'I watched 8 Square-Mile last night.'}             | ${'a capitalised singular after a count above one names something'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('keeps the original, and runs twice without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('A 35-mile-per-hour wind.', options);
    expect(once).toBe('A 56 km/h (35-mile-per-hour) wind.');
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    input                                   | expected
    ${'It was doing 35 miles per hour.'}    | ${'It was doing 56 kilometres per hour.'}
    ${'A 30 mph zone.'}                     | ${'A 48 km/h zone.'}
    ${'A 500 square foot apartment.'}       | ${'A 46 square metre apartment.'}
    ${'Enter a 25 mile per hour zone.'}     | ${'Enter a 40 kilometre per hour zone.'}
    ${'a 2 square mile park'}               | ${'a 5.2 square kilometre park'}
    ${'a 100 foot-pound wrench'}            | ${'a 140 newton metre wrench'}
    ${'Inflate to 30 pounds per square inch.'} | ${'Inflate to 210 kilopascals.'}
  `('still gives $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('miles per hour and miles per gallon written with stops', () => {
  it.each`
    input                                        | expected                                     | why
    ${'It does 30 m.p.h. on the highway.'}       | ${'It does 48 km/h on the highway.'}         | ${'miles per hour'}
    ${'It does 30 M.P.H. on the highway.'}       | ${'It does 48 km/h on the highway.'}         | ${'the same, in capitals'}
    ${'It does 30 m.p.g. on the highway.'}       | ${'It does 7.8 L/100km on the highway.'}     | ${'miles per gallon'}
    ${'It does 30 M.P.G. on the highway.'}       | ${'It does 7.8 L/100km on the highway.'}     | ${'the same, in capitals'}
    ${'It does 20 to 30 m.p.h. on the road.'}    | ${'It does 32 to 48 km/h on the road.'}      | ${'a range of speeds'}
    ${'It does 20 to 30 m.p.g. on the road.'}    | ${'It does 7.8 to 12 L/100km on the road.'}  | ${'a range of fuel economy'}
  `('drops the stop that only ends the abbreviation: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                | expected                          | why
    ${'It does 30 m.p.h.'}               | ${'It does 48 km/h.'}             | ${'the end of the text'}
    ${'It does 30 M.P.H.'}               | ${'It does 48 km/h.'}             | ${'the same, in capitals'}
    ${'It does 30 m.p.g.'}               | ${'It does 7.8 L/100km.'}         | ${'miles per gallon'}
    ${'It does 30 m.p.h. It is slow.'}   | ${'It does 48 km/h. It is slow.'} | ${'before a new sentence'}
  `('keeps the stop that also ends the sentence: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected
    ${'It does 30 m.p.h. on the road.'}    | ${'It does 48 km/h (30 m.p.h.) on the road.'}
    ${'It does 30 m.p.g. on the road.'}    | ${'It does 7.8 L/100km (30 m.p.g.) on the road.'}
  `('keeps the original of $input, and runs twice without converting it again', ({ input, expected }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(once).toBe(expected);
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    input                                  | expected
    ${'It does 30 mph on the highway.'}    | ${'It does 48 km/h on the highway.'}
    ${'It does 30 mpg.'}                   | ${'It does 7.8 L/100km.'}
    ${'M.P.H. is the unit.'}               | ${'M.P.H. is the unit.'}
  `('still gives $input -> $expected', ({ input, expected }) => {
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

describe('a range joined by "or"', () => {
  it.each`
    input                               | expected                                 | why
    ${'It is 5 or 6 feet long.'}        | ${'It is 1.5 or 1.8 metres long.'}       | ${'a length'}
    ${'Use 2 or 3 pounds of beef.'}     | ${'Use 0.91 or 1.4 kilograms of beef.'}  | ${'a weight'}
    ${'It is two or three feet long.'}  | ${'It is 61 or 91 centimetres long.'}    | ${'in words'}
    ${'Use a 2 or 3 inch dish.'}        | ${'Use a 5.1 or 7.6 centimetre dish.'}   | ${'describing a noun'}
    ${'It is 5 or\n6 feet long.'}       | ${'It is 1.5 or 1.8 metres long.'}       | ${'broken at its "or"'}
    ${'Bake at 350 or 375°F.'}          | ${'Bake at 175 or 190°C.'}               | ${'a temperature'}
    ${'He is 6 foot 2 or 6 foot 4.'}    | ${'He is 1.88 metres or 1.93 metres.'}   | ${'two heights with no inch word'}
  `('converts both figures: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                     | expected                                         | why
    ${'It does 20 or 30 mpg on the highway'}  | ${'It does 7.8 or 12 L/100km on the highway'}    | ${'the smaller first'}
    ${'It went from 20 or 30 mpg to 40 mpg'}  | ${'It went from 12 or 7.8 L/100km to 5.9 L/100km'} | ${'in the source order after "from"'}
  `('converts fuel economy joined by "or": $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                              | why
    ${'It costs 10 or 20 pounds.'}         | ${'money'}
    ${'It is two or three hundred feet.'}  | ${'which may mean 200 or 300'}
    ${'He is 5 or 6 feet 2 inches tall.'}  | ${'a height that ends the range'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                               | expected
    ${'Bake at gas mark 4 or 350°F.'}   | ${'Bake at gas mark 4 or 175°C.'}
    ${'Bake at Gas 4 or 350°F.'}        | ${'Bake at Gas 4 or 175°C.'}
  `('reads a gas mark before "or" as no first end: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected
    ${'5 to 10 feet'}                      | ${'1.5 to 3 metres'}
    ${'Bake at 350°F or until golden.'}    | ${'Bake at 175°C or until golden.'}
    ${'Cut 3 metres or 6 feet of rope.'}   | ${'Cut 3 metres or 1.8 metres of rope.'}
  `('still gives $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('takes the author figure for a range joined by "or"', () => {
    expect(convert('Cut 5 or 6 feet (1.5 or 1.8 m) of rope.')).toBe('Cut 1.5 or 1.8 m of rope.');
  });

  it('keeps the original of a range joined by "or", and runs twice without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('It is 5 or 6 feet long.', options);
    expect(once).toBe('It is 1.5 or 1.8 metres (5 or 6 feet) long.');
    expect(convert(once, options)).toBe(once);
  });
});

describe('a gas mark before a Fahrenheit value', () => {
  it.each`
    input                                             | expected                                           | why
    ${'Preheat to gas mark 4 - 350°F first.'}         | ${'Preheat to gas mark 4 - 175°C first.'}          | ${'a dash'}
    ${'Preheat to Gas Mark 4 to 350°F first.'}        | ${'Preheat to Gas Mark 4 to 175°C first.'}         | ${'"to"'}
    ${'Preheat to gas 4 – 350°F first.'}              | ${'Preheat to gas 4 – 175°C first.'}               | ${'an en dash after "gas" alone'}
    ${'Preheat to gas mark 4 - 350 degrees F first.'} | ${'Preheat to gas mark 4 - 175 degrees Celsius first.'} | ${'spelled out'}
    ${'Preheat to gas mark 4 - 350F first.'}          | ${'Preheat to gas mark 4 - 175°C first.'}          | ${'a bare F'}
    ${'Preheat to gas mark 4 - 350 Fahrenheit first.'} | ${'Preheat to gas mark 4 - 175°C first.'}         | ${'the word alone'}
    ${'Preheat from gas mark 1 to 350°F first.'}      | ${'Preheat from gas mark 1 to 175°C first.'}       | ${'after "from"'}
    ${'Preheat to gas mark 4 - 350-375°F first.'}     | ${'Preheat to gas mark 4 - 175-190°C first.'}      | ${'a range after it'}
  `('is no first end of a range: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                               | expected
    ${'Bake at 350-375°F.'}             | ${'Bake at 175-190°C.'}
    ${'Preheat to 350°F - gas mark 4.'} | ${'Preheat to 175°C - gas mark 4.'}
    ${'Preheat to gas mark 4 (350°F).'} | ${'Preheat to gas mark 4 (175°C).'}
    ${'from -10 to 5°F'}                | ${'from -23 to -15°C'}
  `('still gives $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a list of figures before one unit', () => {
  it.each`
    input                                        | expected                                          | why
    ${'It comes in 5, 10 and 15 feet.'}          | ${'It comes in 1.5, 3 and 4.6 metres.'}           | ${'ending in "and"'}
    ${'It comes in 5, 10, and 15 feet.'}         | ${'It comes in 1.5, 3, and 4.6 metres.'}          | ${'with a comma before "and"'}
    ${'Cut it to 2, 4 or 6 inches.'}             | ${'Cut it to 5.1, 10 or 15 centimetres.'}         | ${'ending in "or"'}
    ${'Cut it to 2, 4, or 6 inches.'}            | ${'Cut it to 5.1, 10, or 15 centimetres.'}        | ${'with a comma before "or"'}
    ${'Sizes: 4, 6, 8 inches.'}                  | ${'Sizes: 10, 15, 20 centimetres.'}               | ${'commas alone'}
    ${'Buy 2, 3, 4 or 5 pounds of beef.'}        | ${'Buy 0.91, 1.4, 1.8 or 2.3 kilograms of beef.'} | ${'four figures'}
    ${'It drops 15, 10 or 5 feet.'}              | ${'It drops 4.6, 3 or 1.5 metres.'}               | ${'a list that falls'}
    ${'It comes in five, ten and fifteen feet.'} | ${'It comes in 1.5, 3 and 4.6 metres.'}           | ${'figures in words'}
    ${'Use a 2, 4 or 6 inch dish.'}              | ${'Use a 5.1, 10 or 15 centimetre dish.'}         | ${'describing a noun'}
    ${'It comes in ½, ¾ or 1 inch.'}             | ${'It comes in 1.3, 1.9 or 2.5 centimetres.'}     | ${'fractions'}
    ${'It comes in 5,\n10 and 15 feet.'}         | ${'It comes in 1.5, 3 and 4.6 metres.'}           | ${'wrapped after a comma'}
    ${'Bake at 325, 350 or 375°F.'}              | ${'Bake at 165, 175 or 190°C.'}                   | ${'temperatures'}
    ${'Bake at 325, 350 and 375°F.'}             | ${'Bake at 165, 175 and 190°C.'}                  | ${'temperatures ending in "and"'}
    ${'Bake at 325, 350, 375°F.'}                | ${'Bake at 165, 175, 190°C.'}                     | ${'temperatures with commas alone'}
    ${'Temperatures fell 10, 15 or 20°F.'}       | ${'Temperatures fell 5.6, 8.3 or 11°C.'}          | ${'changes in temperature'}
    ${'Lows of 30, 20 or 10°F tonight.'}         | ${'Lows of -1.1, -6.7 or -12°C tonight.'}         | ${'temperatures that fall'}
    ${'He is 6 foot 2, 6 foot 4 or 6 foot 6.'}   | ${'He is 1.88 metres, 1.93 metres or 1.98 metres.'} | ${'heights with no inch word'}
  `('converts every figure: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                          | expected                                          | why
    ${'Models do 20, 25 or 30 mpg on the highway'} | ${'Models do 7.8, 9.4 or 12 L/100km on the highway'} | ${'the smallest first'}
    ${'Models do 20, 25, 30 mpg on the highway'}   | ${'Models do 7.8, 9.4, 12 L/100km on the highway'}   | ${'commas alone'}
  `('converts every figure of fuel economy: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts a list of fuel economy in km per litre', () => {
    expect(convert('Models do 20, 25 or 30 mpg here', { units: { fuelEconomy: 'km-per-l' } })).toBe(
      'Models do 8.5, 11 or 13 km/L here',
    );
  });

  it.each`
    input                                          | expected                                          | why
    ${'In 2024, 5 and 10 feet of snow fell.'}      | ${'In 2024, 1.5 and 3 metres of snow fell.'}      | ${'a year more than ten times the next figure'}
    ${'On Oct 22, 5, 10 and 15 feet of snow fell.'} | ${'On Oct 22, 1.5, 3 and 4.6 metres of snow fell.'} | ${'the day of a date'}
    ${'Serves 4, 2 pounds beef'}                   | ${'Serves 4, 910 grams beef'}                     | ${'one figure before a comma'}
    ${'Serves 4, 2 or 3 pounds beef'}              | ${'Serves 4, 0.91 or 1.4 kilograms beef'}         | ${'a count out of the order of the list'}
  `('starts the list after a figure it cannot take: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                  | why
    ${'It costs 5, 10 or 20 pounds.'}          | ${'money'}
    ${'It costs 5, 10, 20 pounds.'}            | ${'money, with commas alone'}
    ${'It is two, three or four hundred feet.'} | ${'which may mean 200, 300 or 400'}
    ${'It is 5, 6, 7 feet 2 inches.'}          | ${'a height that ends the list'}
    ${'It weighs 4, 5 or 6 pounds 8 ounces.'}  | ${'a weight that ends the list'}
    ${'It is 1 to 2, 4 or 6 feet.'}            | ${'a list that starts as the second end of a range'}
    ${'Models do twenty, 25 or 30 mpg here'}   | ${'fuel economy with a figure in words'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                    | expected
    ${'It is 5 feet, 10 feet and 15 feet.'}  | ${'It is 1.5 metres, 3 metres and 4.6 metres.'}
    ${'between 5 and 10 miles'}              | ${'between 8 and 16 kilometres'}
    ${'5-10 feet'}                           | ${'1.5-3 metres'}
  `('still gives $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                 | expected
    ${'Cut 5, 10 or 15 feet (1.5, 3 or 4.6 m) of rope.'}  | ${'Cut 1.5, 3 or 4.6 m of rope.'}
    ${'Bake at 325, 350 or 375°F (165, 175 or 190°C).'}   | ${'Bake at 165, 175 or 190°C.'}
  `('takes the author figures for a list: $input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected
    ${'It comes in 5, 10 and 15 feet.'}    | ${'It comes in 1.5, 3 and 4.6 metres (5, 10 and 15 feet).'}
    ${'Sizes: 4, 6, 8 inches.'}            | ${'Sizes: 10, 15, 20 centimetres (4, 6, 8 inches).'}
    ${'Bake at 325, 350 or 375°F.'}        | ${'Bake at 165, 175 or 190°C (325, 350 or 375°F).'}
  `('keeps the original of $input, and runs twice without converting it again', ({ input, expected }) => {
    const options = { units: { keepOriginal: true } };
    const once = convert(input, options);
    expect(once).toBe(expected);
    expect(convert(once, options)).toBe(once);
  });
});

describe('a range whose first end has a hanging hyphen', () => {
  const noRanges = { rules: { 'units.range': false } };

  it.each`
    input                              | expected                                     | why
    ${'Cut into 2- to 3-inch pieces.'} | ${'Cut into 5.1 to 7.6 centimetre pieces.'}  | ${'joined by "to"'}
    ${'a 10- to 12-pound turkey'}      | ${'a 4.5 to 5.4 kilogram turkey'}            | ${'a weight'}
    ${'Use 8- or 9-inch pans.'}        | ${'Use 20 or 23 centimetre pans.'}           | ${'joined by "or"'}
    ${'Cut 2- and 3-inch pieces'}      | ${'Cut 5.1 and 7.6 centimetre pieces'}       | ${'joined by "and"'}
    ${'two- to three-inch pieces'}     | ${'5.1 to 7.6 centimetre pieces'}            | ${'ends in words'}
    ${'2‑ to 3‑inch pieces'} | ${'5.1 to 7.6 centimetre pieces'}            | ${'a non-breaking hyphen'}
    ${'a 20- to 30-mpg car'}           | ${'a 7.8 to 12 L/100km car'}                 | ${'fuel economy'}
  `('converts both ends of $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged
    ${'Cut into 2- to 3-inch pieces.'}
    ${'a 10- to 12-pound turkey'}
    ${'Use 8- or 9-inch pans.'}
  `('leaves "$unchanged" as written with the range rule off', ({ unchanged }) => {
    expect(convert(unchanged, noRanges)).toBe(unchanged);
  });

  it('opens no range on the second end', () => {
    expect(convert('1- to 2-3 inch')).toBe('1- to 2-3 inch');
  });

  it.each`
    input                              | expected
    ${'Cut into 2 to 3-inch pieces.'}  | ${'Cut into 5.1 to 7.6 centimetre pieces.'}
    ${'Cut into 2-3 inch pieces.'}     | ${'Cut into 5.1-7.6 centimetre pieces.'}
    ${'a 10–12-pound turkey'}          | ${'a 4.5-5.4 kilogram turkey'}
    ${'2-3/4 inch'}                    | ${'7 centimetres'}
  `('still converts $input -> $expected', ({ input, expected }) => {
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
    ${'0 inches'}      | ${'0 centimetres'}
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

describe('a number grouped in thousands with spaces is one number', () => {
  it.each`
    input                                   | expected                                     | why
    ${'The road is 1 000 miles long.'}      | ${'The road is 1 600 kilometres long.'}      | ${'a space between the groups'}
    ${'It weighs 1 500 pounds.'}            | ${'It weighs 680 kilograms.'}                | ${'a result of three figures'}
    ${'We drove 12 500 miles.'}             | ${'We drove 20 100 kilometres.'}             | ${'two figures before the group'}
    ${'We drove 1 000 000 miles.'}          | ${'We drove 1 600 000 kilometres.'}          | ${'two groups'}
    ${'The road is 1\u00A0000 miles long.'} | ${'The road is 1\u00A0600 kilometres long.'} | ${'a no-break space'}
    ${'The road is 1\u202F000 miles long.'} | ${'The road is 1\u202F600 kilometres long.'} | ${'a narrow no-break space'}
    ${'We drove 1 000 to 2 000 miles.'}     | ${'We drove 1 600 to 3 200 kilometres.'}     | ${'both ends of a range'}
    ${'a 1 000 x 2 000 foot plot'}          | ${'a 300 x 610 metre plot'}                  | ${'both sides of a dimension'}
    ${'The 1 000-foot tower'}               | ${'The 300 metre tower'}                     | ${'a last group that is no number on its own'}
    ${'a 1 500-foot tower'}                 | ${'a 460 metre tower'}                       | ${'a determiner before a hyphenated size'}
    ${'the 1 500-foot tower'}               | ${'the 460 metre tower'}                     | ${'the same, with "the"'}
    ${'their 1 500-foot tower'}             | ${'their 460 metre tower'}                   | ${'a possessive before it'}
    ${'Buy 2 100-pound bags.'}              | ${'Buy 2 45 kilogram bags.'}                 | ${'a count, then a hyphenated size'}
    ${'Buy 2 100-lb bags.'}                 | ${'Buy 2 45 kg bags.'}                       | ${'the same, with an abbreviation'}
    ${'It is 1 000 miles (1 600 km) away.'} | ${'It is 1 600 km away.'}                    | ${'a metric value grouped the same way restates it'}
    ${'Plot 4096 500 feet wide'}            | ${'Plot 4096 150 metres wide'}               | ${'four figures lead no group'}
    ${'We drove 1 1/2 miles.'}              | ${'We drove 2.4 kilometres.'}                | ${'a mixed number'}
    ${'Rooms 3 4 feet apart'}               | ${'Rooms 3 1.2 metres apart'}                | ${'a single figure is no group'}
    ${'It weighs 1,500 pounds.'}            | ${'It weighs 680 kilograms.'}                | ${'a comma between the groups'}
    ${'It is 0.5 miles away.'}              | ${'It is 800 metres away.'}                  | ${'a decimal after a zero'}
    ${'We drove 0 to 5 miles.'}             | ${'We drove 0 to 8 kilometres.'}             | ${'a zero'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                          | why
    ${'We drove 025 miles.'}           | ${'a leading zero'}
    ${'Agent 007 feet'}                | ${'the same, in a code'}
    ${'It is 007 to 012 feet.'}        | ${'at both ends of a range'}
    ${'It weighs 07 pounds 3 ounces.'} | ${'in a weight in two units, which stays whole'}
    ${'They built 3 400 foot towers.'} | ${'three towers of 400 feet, or towers of 3400'}
    ${'I gave her 2 100-pound bags.'}  | ${'"her" may own the bags or be given two of them'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    text              | numbers                  | why
    ${'1 000'}        | ${['1 000']}             | ${'one group'}
    ${'12 345 678'}   | ${['12 345 678']}        | ${'two groups'}
    ${'1\u00A0500'}   | ${['1\u00A0500']}        | ${'a no-break space'}
    ${'1 000\u00A0000'} | ${['1 000']}             | ${'one kind of space throughout'}
    ${'3 4'}          | ${['3', '4']}            | ${'one figure after the space'}
    ${'2024 500'}     | ${['2024', '500']}       | ${'four figures before it'}
    ${'7:30 500'}     | ${['7', '500']}          | ${'the minutes of a time before it'}
    ${'June 5 100'}   | ${['5', '100']}          | ${'the day of a date before it'}
  `('reads $numbers in "$text" ($why)', ({ text, numbers }) => {
    const reads = new RegExp(`${NUMBER_START}(?:${NUMERIC_PATTERN})`, 'gi');
    expect(text.match(reads)).toEqual(numbers);
  });

  it.each`
    raw               | value
    ${'1 000'}        | ${1000}
    ${'1\u202F000'}   | ${1000}
    ${'12 500.5'}     | ${12500.5}
    ${'1 000 1/2'}    | ${1000.5}
    ${'0'}            | ${0}
    ${'0.5'}          | ${0.5}
    ${'007'}          | ${null}
    ${'05 1/2'}       | ${null}
  `('reads "$raw" as $value', ({ raw, value }) => {
    expect(parseNumber(raw)).toBe(value);
  });
});

describe('a converted number groups its thousands as its source did', () => {
  it.each`
    input                             | expected                               | why
    ${'We drove 2,025 miles.'}        | ${'We drove 3,259 kilometres.'}        | ${'four figures from a grouped source'}
    ${'We drove 1,500 miles.'}        | ${'We drove 2,400 kilometres.'}        | ${'the same, rounded'}
    ${'We drove 500 to 1,500 miles.'} | ${'We drove 800 to 2,400 kilometres.'} | ${'one grouped end groups both'}
    ${'We drove 2025 miles.'}         | ${'We drove 3259 kilometres.'}         | ${'four figures from an ungrouped source'}
    ${'We drove 12500 miles.'}        | ${'We drove 20,100 kilometres.'}       | ${'five figures, whatever the source'}
    ${'It is 238,855 miles away.'}    | ${'It is 384,400 kilometres away.'}    | ${'six figures'}
    ${'It cost 2,025 dollars.'}       | ${'It cost 2,025 dollars.'}            | ${'nothing to convert'}
    ${'in 2025'}                      | ${'in 2025'}                           | ${'a year'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    units                         | input                      | expected
    ${{ precision: 'exact' }}     | ${'We drove 2,025 miles.'} | ${'We drove 3,258.9216 kilometres.'}
    ${{ precision: 1 }}           | ${'We drove 2,025 miles.'} | ${'We drove 3,258.9 kilometres.'}
    ${{ precision: 'exact' }}     | ${'We drove 1 000 miles.'} | ${'We drove 1 609.344 kilometres.'}
    ${{ keepOriginal: true }}     | ${'We drove 2,025 miles.'} | ${'We drove 3,259 kilometres (2,025 miles).'}
  `('$input with $units -> $expected', ({ units, input, expected }) => {
    expect(convert(input, { units })).toBe(expected);
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

describe('a year after a preposition is not a measurement', () => {
  it.each`
    unchanged                                     | why
    ${'In 2024 yard sales rose.'}                 | ${'a singular unit before a noun'}
    ${'In 2024 mile markers were added.'}         | ${'the same, for miles'}
    ${'By 2030 acre prices doubled.'}             | ${'after "by"'}
    ${'Since 2019 mile markers have been added.'} | ${'after "since"'}
    ${'In 2024 miles were driven.'}               | ${'a plural unit'}
    ${'Until 1999 square miles were mapped by hand.'} | ${'a unit of two words, after "until"'}
    ${'During 2020 miles driven fell.'}           | ${'after "during"'}
    ${'Before\n1990 acres were farmed here.'}     | ${'across a line that wraps'}
    ${'By 2025 miles of track will open.'}        | ${'"of" after the unit'}
    ${'In 5 yard sales we sold it.'}              | ${'a compound noun, whatever the number'}
    ${'In 1500 feet of water, it lies.'}          | ${'a quantity that opens the sentence reads as a year'}
    ${'Last year, in 2024 miles were driven.'}    | ${'after a comma'}
    ${'Note: in 2024 miles were driven.'}         | ${'after a colon'}
    ${'It rained; in 2024 miles were driven.'}    | ${'after a semicolon'}
    ${'It rained.\nIn 2024 miles were driven.'}   | ${'at the start of a line'}
    ${'He said, "In 2024 miles were driven."'}    | ${'after an opening quote'}
    ${'It rained. (In 2024 miles were driven.)'}  | ${'after a stop and an opening bracket'}
    ${'- In 2024 miles were driven.'}             | ${'opening a list item'}
    ${'* In 2024 miles were driven.'}             | ${'the same, after "*"'}
    ${'+ Since 2019 mile markers have been added.'} | ${'the same, after "+"'}
    ${'1. In 2024 miles were driven.'}            | ${'the same, after a number and a stop'}
    ${'2) By 2025 miles of track will open.'}     | ${'the same, after a number and a bracket'}
    ${'Notes:\n- In 2024 miles were driven.'}     | ${'a list item on a later line'}
    ${'Notes\n  2) By 2025 miles of track will open.'} | ${'an indented list item'}
    ${'a 2024 yard dash'}                         | ${'no preposition before the number'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                  | expected                                    | why
    ${'It is 2024 miles away.'}            | ${'It is 3257 kilometres away.'}            | ${'no preposition before the number'}
    ${'We drove 2024 miles in 2024.'}      | ${'We drove 3257 kilometres in 2024.'}      | ${'the year after the unit'}
    ${'In 2024 the race was 26 miles.'}    | ${'In 2024 the race was 42 kilometres.'}    | ${'no unit after the year'}
    ${'In 2,024 miles were driven.'}       | ${'In 3,257 kilometres were driven.'}       | ${'a comma'}
    ${'In 3024 miles were driven.'}        | ${'In 4867 kilometres were driven.'}        | ${'four figures too large for a year'}
    ${'In 2024-mile races they tired.'}    | ${'In 3257 kilometre races they tired.'}    | ${'a hyphen ties the number to the unit'}
    ${'In 1500 ft of water it sank.'}      | ${'In 460 m of water it sank.'}             | ${'an abbreviation'}
    ${'In 1500 ft of water.'}              | ${'In 460 m of water.'}                     | ${'the same, ending the sentence'}
    ${'It rose by 1200 feet.'}             | ${'It rose by 370 metres.'}                 | ${'a unit that ends the sentence'}
    ${'In 1000 feet, turn right.'}         | ${'In 300 metres, turn right.'}             | ${'a unit before a comma'}
    ${'within 2024 miles of here'}         | ${'within 3257 kilometres of here'}         | ${'"in" inside a word'}
    ${'The wreck lies in 1500 feet of water.'} | ${'The wreck lies in 460 metres of water.'} | ${'a preposition inside the clause'}
    ${'Traffic grew in 2024 miles of road.'} | ${'Traffic grew in 3257 kilometres of road.'} | ${'the same, though it may be a year'}
    ${'Faults fell to 1 in 2000 miles driven.'} | ${'Faults fell to 1 in 3200 kilometres driven.'} | ${'the same, after a number'}
    ${'It ended (in 2024 miles were driven).'} | ${'It ended (in 3257 kilometres were driven).'} | ${'an opening bracket inside a sentence'}
    ${'a well-known in 2024 miles fact'}    | ${'a well-known in 3257 kilometres fact'}  | ${'a hyphen inside the line is no list marker'}
    ${'Notes - In 2024 miles were driven.'} | ${'Notes - In 3257 kilometres were driven.'} | ${'nor is a spaced dash'}
  `('still converts $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('keeps reading the year of a date before a singular unit of two words under localise', () => {
    expect(convert('On May 5, 2024 square mile parks opened.', { preset: 'localise' })).toBe(
      'On 5 May 2024 square mile parks opened.',
    );
  });

  it.each([
    'It was 4 ft 1 in 1000 ounces later.',
    'six foot one in 1000 ounces later',
    'It was 4 ft 1\nin 1000 ounces later.',
    'six foot one\nin 1000 ounces later',
  ])(
    'gives the same output on a second run over %j, where "in" may be the inch',
    (input) => {
      const once = convert(input);
      expect(convert(once)).toBe(once);
    },
  );

  /** The spans the unit rules hold as written in `text`. */
  const held = (text: string): string[] => {
    const resolved = resolveOptions({});
    const ctx: RuleContext = { text, options: resolved, signals: analyse(text), american: true };
    return patternRules(resolved)
      .flatMap((rule) => rule.find(ctx))
      .filter((c) => c.hold)
      .map((c) => c.before);
  };

  it('holds the year and its unit word whole', () => {
    expect(held('In 2024 miles were driven.')).toContain('2024 miles');
  });

  it.each`
    unchanged                                            | why
    ${'In 2020-2024 miles were driven.'}                 | ${'joined by a hyphen'}
    ${'In 2020–2024 miles were driven.'}                 | ${'joined by an en dash'}
    ${'In 2020 - 2024 miles were driven.'}               | ${'joined by a spaced hyphen'}
    ${'In 2020 to 2024 miles were driven.'}              | ${'joined by "to"'}
    ${'In 2020 and 2024 miles were driven.'}             | ${'joined by "and"'}
    ${'In 2020 or 2024 miles were driven.'}              | ${'joined by "or"'}
    ${'In 2020, 2022 or 2024 miles were driven.'}        | ${'a list ending in "or"'}
    ${'In 2020, 2022, and 2024 miles were driven.'}      | ${'a list ending in a comma and "and"'}
    ${'In 2020, 2022, 2024 miles were driven.'}          | ${'a list with commas alone'}
    ${'In 2020-2024 acre prices doubled.'}               | ${'a singular unit before a noun'}
    ${'From 2019 to 2024 miles driven rose.'}            | ${'after "from"'}
    ${'Between 2020 and 2024 acres were farmed.'}        | ${'after "between"'}
    ${'Last year, from 2019 to 2024 miles driven rose.'} | ${'after a comma'}
    ${'- Between 2020 and 2024 acres were farmed.'}      | ${'opening a list item'}
    ${'Until 1999 to 2001 square miles were mapped.'}    | ${'a unit of two words'}
  `('leaves the years of "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    unchanged
    ${'In 2020-2024 miles were driven.'}
    ${'In 2020, 2022 or 2024 miles were driven.'}
  `('leaves the years of "$unchanged" alone with the range rule off', ({ unchanged }) => {
    expect(convert(unchanged, { rules: { 'units.range': false } })).toBe(unchanged);
  });

  it.each`
    input                                    | expected                                       | why
    ${'It climbed from 1000 to 2000 feet.'}  | ${'It climbed from 300 to 610 metres.'}        | ${'a preposition inside the clause'}
    ${'We drove 1500-2000 miles that year.'} | ${'We drove 2400-3200 kilometres that year.'}  | ${'no preposition before the range'}
    ${'5-10 feet'}                           | ${'1.5-3 metres'}                              | ${'numbers too short to be years'}
    ${'In 2024 - 5 feet of snow fell.'}      | ${'In 2024 - 1.5 metres of snow fell.'}        | ${'a year that cannot open the range'}
    ${'In 1000-2000 feet, turn right.'}      | ${'In 300-610 metres, turn right.'}            | ${'a unit before a comma'}
    ${'In 2024-2020 miles were driven.'}     | ${'In 3257-3251 kilometres were driven.'}      | ${'a second end before the first'}
    ${'In 2020-3024 miles were driven.'}     | ${'In 3251-4867 kilometres were driven.'}      | ${'four figures too large for a year'}
    ${'In 2020-2024-mile races they tired.'} | ${'In 3251-3257 kilometre races they tired.'}  | ${'a hyphen ties the number to the unit'}
    ${'From 2019 miles driven rose.'}        | ${'From 3249 kilometres driven rose.'}         | ${'"from" before one number'}
    ${'From 1500 feet to 2000 feet the trail climbs.'} | ${'From 460 to 610 metres the trail climbs.'} | ${'a unit after the first number'}
    ${'From 1000 to 2000 feet the air thins.'} | ${'From 300 to 610 metres the air thins.'} | ${'a range of heights in feet'}
    ${'Between 2000 and 2500 feet the trail steepens.'} | ${'Between 610 and 760 metres the trail steepens.'} | ${'the same, after "between"'}
    ${'In 1500-2000 foot climbs we rested.'} | ${'In 460-610 metre climbs we rested.'} | ${'the same, in the singular before a noun'}
    ${'From 2019 to 2024 feet the air thins.'} | ${'From 615.4 to 616.9 metres the air thins.'} | ${'the same, though its figures may be years'}
  `('still converts $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('holds a range of years and its unit word whole', () => {
    expect(held('In 2020-2024 miles were driven.')).toEqual(['2020-2024 miles']);
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
    ${'6 feet 2‑1/2 inches'}            | ${'1.89 metres'}                        | ${'inside the inches of a height'}
    ${'6 feet 2‐1/2 inches'}            | ${'1.89 metres'}                        | ${'the same, with U+2010'}
    ${'5 ft 2‑3/4 in'}                  | ${'1.59 metres'}                        | ${'the same, abbreviated'}
    ${'6 feet 2-1/2 inches'}                 | ${'1.89 metres'}                        | ${'a height with a hyphen-minus'}
    ${'Highs in the 70s‑80s today.'}    | ${'Highs between 21 and 32°C today.'}   | ${'between two Fahrenheit decades'}
    ${'5-10 feet'}                           | ${'1.5-3 metres'}                       | ${'a hyphen-minus'}
    ${'a 6-foot fence'}                      | ${'a 1.8 metre fence'}                  | ${'the same, before a unit'}
    ${'It was −5°F outside'}                 | ${'It was -20.6°C outside'}             | ${'a minus sign'}
    ${'It was -5°F outside'}                 | ${'It was -20.6°C outside'}             | ${'a hyphen-minus before a number, which is a minus sign'}
    ${'5ft‐6ft'}                        | ${'1.5 m‐1.8 m'}                        | ${'a range with its unit on both ends, joined by U+2010'}
    ${'5ft‑6ft'}                        | ${'1.5 m‑1.8 m'}                        | ${'the same, joined by U+2011'}
    ${'two feet‐three feet'}            | ${'61 centimetres‐91 centimetres'}      | ${'the same, in words'}
    ${'Bake at 350°F‑375°F.'}           | ${'Bake at 175°C‑190°C.'}               | ${'the same, in Fahrenheit'}
    ${'a sub‐2 pound tent'}             | ${'a sub‐910 gram tent'}                | ${'after a prefix that takes a number'}
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
    ${'catch‐22 feet'}                 | ${'digits after a name'}
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

  it.each`
    unchanged                                  | why
    ${'rims from 15 inches to 17 inches'}      | ${'the noun before the range'}
    ${'a 3/8" to 1/2" socket'}                 | ${'the noun after the range, with inch marks'}
    ${'a 3/8″ to 1/2″ socket'}                 | ${'the same, with double primes'}
    ${'a 2 inch to 3 inch pipe'}               | ${'a singular unit on both ends'}
    ${'rims of 15 inches - 17 inches'}         | ${'joined by a spaced hyphen'}
    ${'rims of 15 inches – 17 inches'}         | ${'joined by an en dash'}
    ${'rims of 15 inches or 17 inches'}        | ${'joined by "or"'}
    ${'rims between 15 inches and 17 inches'}  | ${'joined by "and"'}
    ${'fits 15″-17″ wheels'}                   | ${'joined by a hyphen written tight'}
  `('leaves "$unchanged" alone, with the unit on both ends of the range ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                 | expected
    ${'rims from 15 inches to 17 inches'} | ${'rims from 38 to 43 centimetres'}
    ${'a 3/8" to 1/2" socket'}            | ${'a 0.95 to 1.3 cm socket'}
  `('converts all of $input when respectConventions is off', ({ input, expected }) => {
    expect(convert(input, { units: { respectConventions: false } })).toBe(expected);
  });
});

describe('a range with its unit on both ends', () => {
  it.each`
    input                                       | expected                              | why
    ${'from 15 inches to 17 inches'}            | ${'from 38 to 43 centimetres'}        | ${'joined by "to"'}
    ${'It rose from 6 feet to 8 feet.'}         | ${'It rose from 1.8 to 2.4 metres.'}  | ${'in a sentence'}
    ${'from 5 ft to 6 ft'}                      | ${'from 1.5 to 1.8 m'}                | ${'abbreviations'}
    ${'from 2 feet to 6 ft'}                    | ${'from 0.61 to 1.8 m'}               | ${'a word and an abbreviation of one unit'}
    ${'a 2 inch to 3 inch board'}               | ${'a 5.1 to 7.6 centimetre board'}    | ${'describing a noun'}
    ${'from two feet to three feet'}            | ${'from 61 to 91 centimetres'}        | ${'ends in words'}
    ${'from two and a half feet to three feet'} | ${'from 76 to 91 centimetres'}        | ${'a fraction in words, which its unit ends'}
    ${'from 1 1/2 inches to 2 inches'}          | ${'from 3.8 to 5.1 centimetres'}      | ${'a mixed number'}
  `('converts both ends as one range: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                                  | why
    ${'from 6 feet to 10 inches'}          | ${'from 1.8 metres to 25 centimetres'}    | ${'two units'}
    ${'6 feet to 10 inches to 12 inches'}  | ${'1.8 metres to 25 to 30 centimetres'}   | ${'a range after a measurement in another unit'}
    ${'6 feet 2 inches'}                   | ${'1.88 metres'}                          | ${'a height'}
    ${'5 feet to 6 feet 2 inches'}         | ${'1.5 metres to 1.88 metres'}            | ${'a height at the second end'}
    ${'5 feet or 6 feet'}                  | ${'1.5 metres or 1.8 metres'}             | ${'joined by "or"'}
    ${'between 5 feet and 6 feet'}         | ${'between 1.5 metres and 1.8 metres'}    | ${'joined by "and"'}
    ${'5 feet - 6 feet'}                   | ${'1.5 metres - 1.8 metres'}              | ${'joined by a spaced hyphen'}
    ${'5ft-6ft'}                           | ${'1.5 m-1.8 m'}                          | ${'joined by a hyphen written tight'}
    ${'It is 5 feet, 10 feet and 15 feet.'} | ${'It is 1.5 metres, 3 metres and 4.6 metres.'} | ${'a list'}
    ${'Put 5 in to 6 inches of water.'}    | ${'Put 5 in to 15 centimetres of water.'} | ${'a spaced "in" that may be the preposition'}
  `('converts each measurement on its own: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('keeps the original of the range, and runs twice without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('from 15 inches to 17 inches', options);
    expect(once).toBe('from 38 to 43 centimetres (15 inches to 17 inches)');
    expect(convert(once, options)).toBe(once);
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

  it.each`
    unchanged                            | why
    ${'five-10 miles'}                   | ${'a first end in words before a dash'}
    ${'five to 10 miles'}                | ${'a first end in words before "to"'}
    ${'two and a half to three miles'}   | ${'a fraction in words'}
    ${'five to twenty-two miles'}        | ${'a second end of two words'}
  `('leaves "$unchanged" alone without ranges ($why)', ({ unchanged }) => {
    expect(convert(unchanged, noRanges)).toBe(unchanged);
  });

  it.each`
    unchanged               | why
    ${'ten by 12 feet'}     | ${'a first side in words before "by"'}
    ${'ten x 12 feet'}      | ${'the same, before "x"'}
    ${'ten by twelve feet'} | ${'both sides in words'}
    ${'one by two feet'}    | ${'"one by", which the dimension rule holds'}
  `('leaves "$unchanged" alone without dimensions ($why)', ({ unchanged }) => {
    expect(convert(unchanged, noDimensions)).toBe(unchanged);
  });

  it.each`
    unchanged                      | why
    ${'5 ft 6 to 6 ft'}            | ${'a number after a length in the range unit'}
    ${'3 yards 2 to 4 yards'}      | ${'after yards'}
    ${'10 feet 12 to 15 feet'}     | ${'twelve is no number of inches'}
    ${'11 stone 20 to 12 stone'}   | ${'twenty is no number of pounds'}
    ${'5 ft 6 or 6 ft'}            | ${'joined by "or"'}
    ${'5 ft 6, 7 or 8 ft'}         | ${'a list'}
    ${'5 ft 6, 7, 8 ft'}           | ${'a list with commas alone'}
  `('leaves "$unchanged" whole without ranges, where the range rule holds it ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, noRanges)).toBe(unchanged);
  });

  it.each`
    input                       | expected                                 | options
    ${'2 feet 6 to 3 feet'}     | ${'76.2 centimetres to 91 centimetres'}  | ${{}}
    ${'2 feet 6 to 3 feet'}     | ${'76.2 centimetres to 91 centimetres'}  | ${noRanges}
    ${'6 feet 2 to 3 inches'}   | ${'1.8 metres 5.1 to 7.6 centimetres'}   | ${{}}
    ${'6 feet 2 to 3 inches'}   | ${'1.8 metres 2 to 3 inches'}            | ${noRanges}
    ${'11 stone 4 to 12 stone'} | ${'71.7 kilograms to 76 kilograms'}      | ${noRanges}
  `('still reads $input with $options, where a height, a weight or another unit takes the number', ({ input, expected, options }) => {
    expect(convert(input, options)).toBe(expected);
  });

  it.each`
    input                             | expected                               | options
    ${'raise each one by two inches'} | ${'raise each one by 5.1 centimetres'} | ${noRanges}
    ${'raise each one by two inches'} | ${'raise each one by 5.1 centimetres'} | ${noDimensions}
    ${'reduce by half to 2 quarts'}   | ${'reduce by half to 1.9 litres'}      | ${noRanges}
    ${'reduce by half to 2 quarts'}   | ${'reduce by half to 1.9 litres'}      | ${noDimensions}
    ${'two x 4 oz cans'}              | ${'two x 110 g cans'}                  | ${noDimensions}
    ${'five to 10 miles'}             | ${'8 to 16 kilometres'}                | ${{}}
    ${'ten by 12 feet'}               | ${'3 by 3.7 metres'}                   | ${{}}
  `('still converts $input with $options', ({ input, expected, options }) => {
    expect(convert(input, options)).toBe(expected);
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

describe('resolving many changes beside many spans', () => {
  const at = (start: number, end: number, extra: Partial<Change> = {}): Change => ({
    start,
    end,
    before: 'x'.repeat(end - start),
    after: 'y',
    ruleId: 'test',
    category: 'units',
    confidence: 'moderate',
    ...extra,
  });
  /** `span`, counting each read of one of its properties in `reads`. */
  const counted = <T extends object>(span: T, reads: { count: number }): T =>
    new Proxy(span, {
      get(target, key, receiver) {
        reads.count++;
        return Reflect.get(target, key, receiver);
      },
    });
  const spans = 200;
  /** A span every 20 characters, as `make` builds it from its start and end. */
  const everyTwenty = <T>(make: (start: number, end: number) => T) =>
    Array.from({ length: spans }, (_, i) => make(i * 20, i * 20 + 10));
  /** `count` changes, one every 20 characters, clear of the spans `everyTwenty` builds. */
  const beside = (count: number) => Array.from({ length: count }, (_, i) => at(i * 20 + 12, i * 20 + 15));

  const readsOfHeld = (changes: number) => {
    const reads = { count: 0 };
    const held = everyTwenty((start, end) => counted(at(start, end, { hold: true }), reads));
    expect(resolveChanges([...held, ...beside(changes)], [])).toHaveLength(changes);
    return reads.count;
  };

  const readsOfProtected = (changes: number) => {
    const reads = { count: 0 };
    const ranges = everyTwenty((start, end) => counted({ start, end }, reads));
    expect(resolveChanges(beside(changes), ranges)).toHaveLength(changes);
    return reads.count;
  };

  const readsOfChanges = (changes: number) => {
    const reads = { count: 0 };
    expect(resolveChanges(beside(changes).map((c) => counted(c, reads)), [])).toHaveLength(changes);
    return reads.count;
  };

  it('reads each held span a fixed number of times, however many changes there are', () => {
    expect(readsOfHeld(spans)).toBe(readsOfHeld(1));
  });

  it('reads each protected range a fixed number of times, however many changes there are', () => {
    expect(readsOfProtected(spans)).toBe(readsOfProtected(1));
  });

  it('reads the changes a number of times in line with how many there are', () => {
    // Given in order of rank, so sorting them reads each one a fixed number of times.
    expect(readsOfChanges(2000)).toBeLessThan(5 * readsOfChanges(500));
  });

  it.each`
    input                             | expected
    ${'It cost 500 pounds.'}          | ${'It cost 500 pounds.'}
    ${'Use bolts of ½-¾ inch.'}       | ${'Use bolts of ½-¾ inch.'}
    ${'He is 6 feet 2 inches tall.'}  | ${'He is 1.88 metres tall.'}
    ${'It is 6 feet (1.8 m) tall.'}   | ${'It is 1.8 m tall.'}
    ${'the 40 yard line, the color.'} | ${'the 40 yard line, the colour.'}
  `('resolves "$input" as "$expected"', ({ input, expected }) => {
    expect(deamericaniseText(input)).toBe(expected);
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
    ${'the sheet is 4 ft x 8 in.'}      | ${'the sheet is 1.2 x 0.2 m.'}        | ${'all in the unit for the largest'}
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

describe('a double quote after a number that closes a quotation', () => {
  it.each`
    unchanged                                 | why
    ${'He said "6" twice.'}                   | ${'a quoted number'}
    ${'She said "pick 3" and left.'}          | ${'a quotation that ends in a number'}
    ${'The sign read "Route 66" in red.'}     | ${'a name'}
    ${'Press "1" to start.'}                  | ${'a key'}
    ${'He said "six" twice.'}                 | ${'a number in words'}
    ${'He said "5-10" twice.'}                | ${'a range'}
    ${'"6" x "8"'}                            | ${'two quoted numbers'}
    ${'the "2" x 4" board'}                   | ${'a quoted side leaves the dimension whole'}
    ${`He said "6'2" twice.`}                 | ${'feet and inches'}
    ${'He said "6 ft 2" twice.'}              | ${'feet and inches, held so the feet are not read alone'}
    ${'She said "the answer is\n6" and left.'} | ${'a quotation that wraps onto the next line'}
    ${'"It is 6" long," she said.'}           | ${'an inch mark inside a quotation reads as its close'}
    ${'a 12" pizza'}                          | ${'a conventional size'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                          | expected                                          | why
    ${'a 6" pan'}                                  | ${'a 15 cm pan'}                                  | ${'no quotation'}
    ${'Cut it to 6".'}                             | ${'Cut it to 15 cm.'}                             | ${'before a stop'}
    ${'the 2" x 4" board'}                         | ${'the 5.1 x 10 cm board'}                        | ${'an inch mark opens no quotation'}
    ${`He is 6'2".`}                               | ${'He is 1.88 metres.'}                           | ${'feet and inches'}
    ${'a 6" pan and a 9" dish'}                    | ${'a 15 cm pan and a 23 cm dish'}                 | ${'two inch marks on one line'}
    ${'She said "go" and cut a 6" pan.'}           | ${'She said "go" and cut a 15 cm pan.'}           | ${'a quotation closed before the number'}
    ${'He said "pick 3\n\nThen cut a 6" pan.'}     | ${'He said "pick 3\n\nThen cut a 15 cm pan.'}     | ${'a quotation left open before a blank line'}
    ${'He bought 6 "free" tickets and a 6" pan.'}  | ${'He bought 6 "free" tickets and a 15 cm pan.'}  | ${'a spaced quote before a word opens a quotation'}
    ${'He said "six foot two" twice.'}             | ${'He said "1.88 metres" twice.'}                 | ${'a height read up to the closing quote'}
    ${'He said "6 feet 2" twice.'}                 | ${'He said "1.88 metres" twice.'}                 | ${'the same, in figures'}
    ${'He said "a 6″ pan" today.'}                 | ${'He said "a 15 cm pan" today.'}                 | ${'a double prime is never a quote'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                         | expected
    ${'She said "I counted 3."'}  | ${'She said "I counted 3".'}
    ${'She said “I counted 3.”'}  | ${'She said “I counted 3”.'}
  `('keeps the count in "$input" a count once logical quoting moves the stop', ({ input, expected }) => {
    const once = deamericaniseText(input, { preset: 'localise' });
    expect(once).toBe(expected);
    expect(deamericaniseText(once, { preset: 'localise' })).toBe(once);
  });
});

describe('feet and inch marks typed as curly quotes', () => {
  it.each`
    input                     | expected                       | why
    ${'He is 6’2” tall.'}     | ${'He is 1.88 metres tall.'}   | ${'a height'}
    ${'He is 5’ 10” tall.'}   | ${'He is 1.78 metres tall.'}   | ${'a space between the parts'}
    ${'a 12” pan'}            | ${'a 30 cm pan'}               | ${'inches alone'}
    ${'the 2’ x 6” shelf'}    | ${'the 61 x 15 cm shelf'}      | ${'feet beside inches'}
    ${'a 2’ x 4’ sheet'}      | ${'a 0.61 x 1.2 m sheet'}      | ${'feet on every side'}
    ${'the 2” x 4” board'}    | ${'the 5.1 x 10 cm board'}     | ${'inches on every side'}
    ${'She’s 6’2”.'}          | ${'She’s 1.88 metres.'}        | ${'after an apostrophe'}
    ${'She’s 6 feet tall.'}   | ${'She’s 1.8 metres tall.'}    | ${'an apostrophe that is no mark'}
    ${`He is 6'2" tall.`}     | ${'He is 1.88 metres tall.'}   | ${'straight marks'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                       | why
    ${'He said “6” twice.'}         | ${'a quoted number'}
    ${'He said “pick 3” and left.'} | ${'a quotation that ends in a number'}
    ${'He said “6’2” twice.'}       | ${'a quoted height'}
    ${'He said “pick 3" and left.'} | ${'a curly quotation closed by a straight mark'}
    ${'the ‘6’ x 4’ panel'}         | ${'a quoted number, though a dimension follows'}
    ${'‘2 x 4’'}                    | ${'a quoted dimension with no unit'}
    ${'a 6’ fence'}                 | ${'an apostrophe alone after a number'}
    ${'2’ x 4'}                     | ${'no mark on the last side'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
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
    ${'It is 1.88 m (6’2”) tall.'}                             | ${'feet and inches in curly marks'}
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
    input                                       | expected                                   | why
    ${'It is **6 feet** (1.8 m) tall.'}         | ${'It is **1.8 m** tall.'}                 | ${'bold closes on the metric value'}
    ${'It is 6 feet *(1.8 m)* tall.'}           | ${'It is 1.8 m tall.'}                     | ${'emphasis on the bracket goes with it'}
    ${'It is 6 feet (*1.8 m*) tall.'}           | ${'It is 1.8 m tall.'}                     | ${'emphasis inside the bracket goes too'}
    ${'It is **6 feet** *(1.8 m)* tall.'}       | ${'It is **1.8 m** tall.'}                 | ${'both'}
    ${'It is **6 feet (1.8 m)** tall.'}         | ${'It is **1.8 m** tall.'}                 | ${'bold around both'}
    ${'It is **6 feet**\n(1.8 m) tall.'}        | ${'It is **1.8 m** tall.'}                 | ${'bold and a wrapped line'}
    ${'Bake at **350°F**/180°C.'}               | ${'Bake at **180°C**.'}                    | ${'a slash after bold'}
    ${'Bake at **350°F**/**180°C**.'}           | ${'Bake at **180°C**.'}                    | ${'both values bold'}
    ${'Bake at 350°F (_175 degrees Celsius_).'} | ${'Bake at 175 degrees Celsius.'}          | ${'an underscore after the written-out Celsius'}
    ${'It was **20°F** (11°C) warmer.'}         | ${'It was **11°C** warmer.'}               | ${'a change in temperature'}
    ${'It is 6 feet (1.8 m) tall.'}             | ${'It is 1.8 m tall.'}                     | ${'no markup'}
    ${'Bake at 350°F/180°C.'}                   | ${'Bake at 180°C.'}                        | ${'the same, joined by a slash'}
    ${'It is 6 feet\n\n(1.8 m) tall.'}          | ${'It is 1.8 metres\n\n(1.8 m) tall.'}     | ${'a blank line ends the measurement'}
    ${'It is **6 feet**\n\n(1.8 m) tall.'}      | ${'It is **1.8 metres**\n\n(1.8 m) tall.'} | ${'the same, after bold'}
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

describe('a Fahrenheit degree inside a compound unit', () => {
  it.each`
    unchanged                                                    | why
    ${'The wall has a thermal resistance of 0.45 °F·ft²·h/BTU.'} | ${'an R-value'}
    ${'The R-value is 0.45 °F·ft²·h/BTU per inch.'}              | ${'the same, per inch'}
    ${'The R-value is 0.45 °F⋅ft²⋅h/BTU.'}                       | ${'the same, with the dot operator'}
    ${'It warms at 2 °F/min.'}                                   | ${'a rate'}
    ${'It warms at 2°F/hour.'}                                   | ${'a rate in a word'}
    ${'It warmed 0.5°F/decade.'}                                 | ${'a rate over years'}
    ${'The sink is rated 0.5 °F/W.'}                             | ${'a thermal resistance per watt'}
    ${'It warms at 2 degrees F/min.'}                            | ${'spelled out'}
    ${'It warms at 2 degrees Fahrenheit/min.'}                   | ${'the same, with the scale named'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                               | expected                          | why
    ${'It is 75°F/sunny today.'}        | ${'It is 23.9°C/sunny today.'}    | ${'a word after the slash that is no unit'}
    ${'Grill it at 450°F/high heat.'}   | ${'Grill it at 230°C/high heat.'} | ${'a word that starts like a unit'}
    ${'It fell 20°F overnight.'}        | ${'It fell 11°C overnight.'}      | ${'a change in temperature'}
    ${'Bake at 350°F.'}                 | ${'Bake at 175°C.'}               | ${'a temperature'}
    ${'The rate is 5 BTU per °F.'}      | ${'The rate is 5.3 kJ per °F.'}   | ${'a degree with no number'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a Celsius value in brackets that also gives the gas mark', () => {
  it.each`
    input                                                     | expected                                     | why
    ${'Preheat the oven to 350°F (180°C/gas mark 4).'}        | ${'Preheat the oven to 180°C (gas mark 4).'} | ${'a slash'}
    ${'Preheat the oven to 350°F (180°C, gas mark 4).'}       | ${'Preheat the oven to 180°C (gas mark 4).'} | ${'a comma'}
    ${'Preheat the oven to 350°F (180°C or gas mark 4).'}     | ${'Preheat the oven to 180°C (gas mark 4).'} | ${'"or"'}
    ${'Preheat the oven to 350°F (180°C; Gas Mark 4).'}       | ${'Preheat the oven to 180°C (Gas Mark 4).'} | ${'a semicolon and capitals'}
    ${'Preheat the oven to 350°F (180°C / gas 4).'}           | ${'Preheat the oven to 180°C (gas 4).'}      | ${'a spaced slash and "gas" alone'}
    ${'Preheat the oven to 250°F (120°C/gas mark ½).'}        | ${'Preheat the oven to 120°C (gas mark ½).'} | ${'a half gas mark'}
    ${'Bake at 350-375°F (180-190°C/gas mark 4-5).'}          | ${'Bake at 180-190°C (gas mark 4-5).'}       | ${'a range'}
    ${'Preheat the oven to 350°F\n(180°C/gas mark 4).'}       | ${'Preheat the oven to 180°C\n(gas mark 4).'} | ${'a wrapped line'}
    ${'Preheat the oven to **350°F** (180°C/gas mark 4).'}    | ${'Preheat the oven to **180°C** (gas mark 4).'} | ${'bold closes on the metric value'}
    ${'Preheat the oven to 350°F *(180°C/gas mark 4)*.'}      | ${'Preheat the oven to 180°C *(gas mark 4)*.'} | ${'emphasis on the bracket stays with it'}
    ${'Preheat the oven to 350°F (*180°C/gas mark 4*).'}      | ${'Preheat the oven to 180°C (*gas mark 4*).'} | ${'emphasis around both stays on the gas mark'}
    ${'Preheat the oven to 350 degrees F (180 degrees C/gas mark 4).'} | ${'Preheat the oven to 180 degrees C (gas mark 4).'} | ${'spelled out'}
    ${'Preheat the oven to 350°F (200°C/gas mark 4).'}        | ${'Preheat the oven to 175°C (200°C/gas mark 4).'} | ${'a Celsius value that does not restate it'}
    ${'It is 6 feet (1.8 m/gas mark 4) tall.'}                | ${'It is 1.8 metres (1.8 m/gas mark 4) tall.'} | ${'a gas mark follows only a temperature'}
    ${'Preheat the oven to 350°F (180°C).'}                   | ${'Preheat the oven to 180°C.'}              | ${'no gas mark'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('collapses the pair with keepOriginal on, and runs twice without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('Preheat the oven to 350°F (180°C/gas mark 4).', options);
    expect(once).toBe('Preheat the oven to 180°C (gas mark 4).');
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    unchanged                                            | why
    ${'Preheat the oven to 180°C (350°F/gas mark 4).'}   | ${'the Fahrenheit value restates the Celsius one'}
    ${'Preheat the oven to 180°C (350°F, gas mark 4).'}  | ${'the same, after a comma'}
    ${'Preheat the oven to 180°C (*350°F*/gas mark 4).'} | ${'the same, with emphasis'}
    ${'Preheat the oven to 180°C (350°F).'}              | ${'no gas mark'}
    ${'Bake at gas mark 4 (180°C).'}                     | ${'a gas mark alone'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a Celsius value in brackets that also gives the fan oven setting', () => {
  it.each`
    input                                                                      | expected                                                    | why
    ${'Preheat the oven to 350°F (180°C/160°C fan).'}                          | ${'Preheat the oven to 180°C (160°C fan).'}                 | ${'a slash'}
    ${'Preheat the oven to 350°F (180°C, fan 160°C).'}                         | ${'Preheat the oven to 180°C (fan 160°C).'}                 | ${'a comma, with fan first'}
    ${'Preheat the oven to 350°F (180°C/160°C fan/gas mark 4).'}               | ${'Preheat the oven to 180°C (160°C fan/gas mark 4).'}      | ${'and the gas mark'}
    ${'Preheat the oven to 350°F (180°C/gas mark 4/160°C fan).'}               | ${'Preheat the oven to 180°C (gas mark 4/160°C fan).'}      | ${'the gas mark first'}
    ${'Preheat the oven to 350°F (180°C/160°C fan-forced).'}                   | ${'Preheat the oven to 180°C (160°C fan-forced).'}          | ${'fan-forced'}
    ${'Preheat the oven to 350°F (180°C; Fan-assisted 160°C).'}                | ${'Preheat the oven to 180°C (Fan-assisted 160°C).'}        | ${'a semicolon, capitals and fan-assisted'}
    ${'Preheat the oven to 350°F (180°C or 160°C fan oven).'}                  | ${'Preheat the oven to 180°C (160°C fan oven).'}            | ${'"or" and fan oven'}
    ${'Preheat the oven to 350°F (180C/160C fan/gas 4).'}                      | ${'Preheat the oven to 180C (160C fan/gas 4).'}             | ${'a bare C'}
    ${'Preheat the oven to 350°F (180°C/160 fan).'}                            | ${'Preheat the oven to 180°C (160 fan).'}                   | ${'a fan figure with no unit'}
    ${'Preheat the oven to 350 degrees F (180 degrees C, fan 160 degrees C).'} | ${'Preheat the oven to 180 degrees C (fan 160 degrees C).'} | ${'spelled out'}
    ${'Preheat the oven to 350°F (*180°C/160°C fan*).'}                        | ${'Preheat the oven to 180°C (*160°C fan*).'}               | ${'emphasis around all of it stays on the fan setting'}
    ${'Preheat the oven to 350°F (180°C/160°C fans).'}                         | ${'Preheat the oven to 175°C (180°C/160°C fans).'}          | ${'a word that only starts with fan'}
    ${'Preheat the oven to 350°F (160°C fan).'}                                | ${'Preheat the oven to 175°C (160°C fan).'}                 | ${'the fan setting alone'}
    ${'Preheat the oven to 350°F (180°C).'}                                    | ${'Preheat the oven to 180°C.'}                             | ${'no fan setting'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('collapses the pair with keepOriginal on, and runs twice without converting it again', () => {
    const options = { units: { keepOriginal: true } };
    const once = convert('Preheat the oven to 350°F (180°C/160°C fan).', options);
    expect(once).toBe('Preheat the oven to 180°C (160°C fan).');
    expect(convert(once, options)).toBe(once);
  });

  it.each`
    unchanged                                                    | why
    ${'Preheat the oven to 180°C (350°F/160°C fan).'}            | ${'the Fahrenheit value restates the Celsius one'}
    ${'Preheat the oven to 180°C (350°F, fan 160°C).'}           | ${'the same, with fan first'}
    ${'Preheat the oven to 180°C (350°F/160°C fan/gas mark 4).'} | ${'the same, with the gas mark'}
    ${'Preheat the oven to 180°C (350°F).'}                      | ${'no fan setting'}
    ${'Heat the oven to 180C fan or to 400F.'}                   | ${'a fan setting outside a bracket'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it('counts no Fahrenheit value that restates the Celsius one beside its fan setting', () => {
    expect(analyse('Preheat the oven to 180°C (350°F/160°C fan).').markers).toEqual([]);
  });
});

describe('a measurement in underscore emphasis', () => {
  it.each`
    input                                   | expected                                   | why
    ${'It is _6 feet_ tall.'}               | ${'It is _1.8 metres_ tall.'}              | ${'italic'}
    ${'It is __6 feet__ tall.'}             | ${'It is __1.8 metres__ tall.'}            | ${'bold'}
    ${'Bake at __350°F__.'}                 | ${'Bake at __175°C__.'}                    | ${'a temperature'}
    ${'Bake at 350°F__ today.'}             | ${'Bake at 175°C__ today.'}                | ${'a run of underscores after the unit'}
    ${'Bake at __350 degrees Fahrenheit__.'} | ${'Bake at __175 degrees Celsius__.'}     | ${'a temperature spelled out'}
    ${'Bake the cake at _350F_ today.'}     | ${'Bake the cake at _175°C_ today.'}       | ${'a bare F'}
    ${'It weighs _5 pounds_.'}              | ${'It weighs _2.3 kilograms_.'}            | ${'a weight'}
    ${'It is _1 000 miles_ away.'}          | ${'It is _1 600 kilometres_ away.'}        | ${'a number grouped with a space'}
    ${'It is _two feet_ long.'}             | ${'It is _61 centimetres_ long.'}          | ${'a number in words'}
    ${'It is _half an inch_ thick.'}        | ${'It is _1.3 centimetres_ thick.'}        | ${'half an inch'}
    ${'It is _a mile and a half_ away.'}    | ${'It is _2.4 kilometres_ away.'}          | ${'a mile and a half'}
    ${'It is _2-3 feet_ long.'}             | ${'It is _61-91 centimetres_ long.'}       | ${'a range'}
    ${'It is _6 x 4 feet_ wide.'}           | ${'It is _1.8 x 1.2 metres_ wide.'}        | ${'a dimension'}
    ${'Drive at _60 mph_ there.'}           | ${'Drive at _97 km/h_ there.'}             | ${'a speed'}
    ${'It does _30 mpg_ there.'}            | ${'It does _7.8 L/100km_ there.'}          | ${'fuel economy'}
    ${'It is _6 feet 2 inches_ tall.'}      | ${'It is _1.88 metres_ tall.'}             | ${'a height in two units'}
    ${'He is _six foot two_ now.'}          | ${'He is _1.88 metres_ now.'}              | ${'a height with no inch word'}
    ${'He is _six-foot-two_ now.'}          | ${'He is _1.88 metres_ now.'}              | ${'the same, hyphenated'}
    ${'It weighs _7 pounds 8 ounces_.'}     | ${'It weighs _3.4 kilograms_.'}            | ${'a weight in two units'}
    ${'A _6-foot-tall_ fence.'}             | ${'A _1.8 metre tall_ fence.'}             | ${'a length and its size'}
    ${'It is _6 feet_ (1.8 metres) tall.'}  | ${'It is _1.8 metres_ tall.'}              | ${'with its metric value'}
    ${'It is *6 feet* tall.'}               | ${'It is *1.8 metres* tall.'}              | ${'asterisks, as before'}
    ${'He is *six foot two* now.'}          | ${'He is *1.88 metres* now.'}              | ${'asterisks after a height with no inch word'}
    ${'Leave __init__ 6 feet away.'}        | ${'Leave __init__ 1.8 metres away.'}       | ${'a run that closes on a word'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
    expect(convert(input, { syntax: 'markdown' })).toBe(expected);
  });

  it.each`
    unchanged                                | why
    ${'Use MAX_6 feet.'}                     | ${'a letter before the underscore'}
    ${'Use max_6 feet.'}                     | ${'the same, in lower case'}
    ${'Use v5_6 feet.'}                      | ${'a digit before the underscore'}
    ${'It is _1.8 metres_ (6 feet) tall.'}   | ${'the metric value it restates'}
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
    [' degrees fahrenheit', ' degrees celsius'],
    [' DEGREES FAHRENHEIT', ' DEGREES CELSIUS'],
    [' Degrees F', ' Degrees C'],
    [' DEG F', ' DEG C'],
    ['°fahrenheit', '°celsius'],
    [' fahrenheit', ' celsius'],
    [' FAHRENHEIT', ' CELSIUS'],
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

  it.each`
    input                                                       | expected
    ${'Bake at 180 degrees celsius (350 degrees fahrenheit).'}  | ${'Bake at 180 degrees celsius (350 degrees fahrenheit).'}
    ${'Bake at 350 degrees fahrenheit (180 degrees celsius).'}  | ${'Bake at 180 degrees celsius.'}
    ${'Bake at 180 celsius/350 fahrenheit.'}                    | ${'Bake at 180 celsius/350 fahrenheit.'}
    ${'Bake at 350 fahrenheit (180 CENTIGRADE).'}               | ${'Bake at 180 CENTIGRADE.'}
    ${'Bake at 350 Fahrenheit (180 Degrees Celsius).'}          | ${'Bake at 180 Degrees Celsius.'}
    ${'Bake at 350°F (180c).'}                                  | ${'Bake at 175°C (180c).'}
    ${'Bake at 350°F (180°c).'}                                 | ${'Bake at 175°C (180°c).'}
    ${'Bake at 350 degrees F (180 degrees c).'}                 | ${'Bake at 175 degrees Celsius (180 degrees c).'}
    ${'It was 95 fahrenheit.'}                                  | ${'It was 35°C.'}
  `('reads the words of a Celsius value in any case, and a lone C in upper case only: $input -> $expected', ({ input, expected }) => {
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

describe('a count of hundreds before thousand', () => {
  it.each`
    input                                                              | expected                                    | why
    ${'a hundred thousand miles'}                                      | ${'160,000 kilometres'}                     | ${'counted by "a hundred"'}
    ${'two hundred and fifty thousand pounds of steel'}                | ${'110 tonnes of steel'}                    | ${'with "and" in the count'}
    ${'one hundred twenty thousand feet'}                              | ${'37 kilometres'}                          | ${'without "and"'}
    ${'a hundred and fifty thousand miles'}                            | ${'240,000 kilometres'}                     | ${'"a hundred and" a cardinal'}
    ${'two hundred thousand five hundred feet'}                        | ${'61 kilometres'}                          | ${'hundreds after the thousands'}
    ${'between two hundred thousand and three hundred thousand miles'} | ${'between 320,000 and 480,000 kilometres'} | ${'both ends of a range'}
    ${'between one hundred and two thousand miles'}                    | ${'between 160 and 3200 kilometres'}        | ${'after "between", "and" joins the range'}
    ${'a hundred miles'}                                               | ${'160 kilometres'}                         | ${'a count of hundreds alone'}
    ${'two thousand five hundred feet'}                                | ${'760 metres'}                             | ${'hundreds after thousands'}
    ${'twenty-two hundred feet'}                                       | ${'670 metres'}                             | ${'a count of two words'}
    ${'between one hundred and two hundred miles'}                     | ${'between 160 and 320 kilometres'}         | ${'a range of hundreds'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                               | why
    ${'between one hundred and two hundred thousand miles'} | ${'no one number, and a range that may mean thousands at both ends'}
    ${'one hundred to two hundred thousand miles'}          | ${'which may mean 100,000 to 200,000'}
    ${'two to three hundred thousand miles'}                | ${'which may mean 200,000 to 300,000'}
    ${'It cost a hundred thousand pounds.'}                 | ${'money'}
    ${'hundreds of thousands of miles'}                     | ${'a plural is not a number'}
    ${'one hundred thousand two-foot boards'}               | ${'a count of boards or one length'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    words                               | value
    ${'a hundred thousand'}             | ${100000}
    ${'two hundred and fifty thousand'} | ${250000}
    ${'one hundred twenty thousand'}    | ${120000}
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
    ${'the one-third mile track'}      | ${'the 540 metre track'}   | ${'a count after "the" is still a fraction'}
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
    ${'The mine ships 5,000 tons a year.'}                       | ${'The mine ships 4,500 tonnes a year.'}                     | ${'a US document means short tons'}
    ${'Data in thousand metric tons. The mine ships 5,000 tons.'} | ${'Data in thousand metric tons. The mine ships 5,000 tons.'} | ${'this one already said metric'}
    ${'Figures in tonnes. It moved 900 tons.'}                   | ${'Figures in tonnes. It moved 900 tons.'}                    | ${'same'}
  `('$why', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a unit the words beside it read in another sense', () => {
  it.each`
    input                                                 | expected
    ${'Install a 3-ton central AC unit.'}                 | ${'Install an 11 kilowatt central AC unit.'}
    ${'A 3-ton air conditioner is enough for the house.'} | ${'An 11 kilowatt air conditioner is enough for the house.'}
    ${'Buy a 3-ton mini-split.'}                          | ${'Buy an 11 kilowatt mini-split.'}
    ${'A 40-ton cooling tower.'}                          | ${'A 140 kilowatt cooling tower.'}
    ${'The plant has 500 tons of cooling.'}               | ${'The plant has 1800 kilowatts of cooling.'}
    ${'AC units of 2 to 5 tons.'}                         | ${'AC units of 7 to 18 kilowatts.'}
    ${'The heat pump is 3 tons.'}                         | ${'The heat pump is 11 kilowatts.'}
    ${'Data in metric tons. A 3-ton AC unit.'}            | ${'Data in metric tons. An 11 kilowatt AC unit.'}
    ${'It gives 7 tons of refrigeration.'}                | ${'It gives 25 kilowatts.'}
    ${'He bought 16 oz of gold.'}                         | ${'He bought 500 g of gold.'}
    ${'He bought 2 troy ounces of gold.'}                 | ${'He bought 62 grams of gold.'}
    ${'He bought 2 ozt of gold.'}                         | ${'He bought 62 g of gold.'}
    ${'He bought 2 oz t of gold.'}                        | ${'He bought 62 g of gold.'}
    ${'He bought 2 troy oz of silver.'}                   | ${'He bought 62 g of silver.'}
    ${'He bought half an ounce of gold.'}                 | ${'He bought 16 grams of gold.'}
    ${'Buy a 1 oz gold coin.'}                            | ${'Buy a 31 g gold coin.'}
    ${'Drink 16 oz of water.'}                            | ${'Drink 470 mL of water.'}
    ${'Add 8 oz of milk.'}                                | ${'Add 240 mL of milk.'}
    ${'Add 8 oz heavy cream.'}                            | ${'Add 240 mL heavy cream.'}
    ${'Pour a 16-oz pint glass of beer.'}                 | ${'Pour a 470 mL pint glass of beer.'}
    ${'Open a 12 oz can of soda.'}                        | ${'Open a 350 mL can of soda.'}
    ${'Open a 12 oz soda can.'}                           | ${'Open a 350 mL soda can.'}
    ${'Open a 12-ounce bottle of beer.'}                  | ${'Open a 350 millilitre bottle of beer.'}
    ${'Pour 2 x 12 oz cans of soda.'}                     | ${'Pour 2 x 350 mL cans of soda.'}
    ${'Add 2 to 3 oz of milk.'}                           | ${'Add 59 to 89 mL of milk.'}
    ${'Mix 2 oz gin and 1 oz lime juice.'}                | ${'Mix 59 mL gin and 30 mL lime juice.'}
    ${'Use 1 cup (8 oz) whole milk.'}                     | ${'Use 1 cup (240 mL) whole milk.'}
    ${'Use 8 oz (about 1 cup) of milk.'}                  | ${'Use 240 mL (about 1 cup) of milk.'}
    ${'Drink 16 oz (470 mL) of water.'}                   | ${'Drink 470 mL of water.'}
    ${'Leave 240 mL (8 oz) of water.'}                    | ${'Leave 240 mL (8 oz) of water.'}
    ${'Drink 16 oz sports drink.'}                        | ${'Drink 470 mL sports drink.'}
    ${'A 3-ton AC unit costs more.'}                      | ${'An 11 kilowatt AC unit costs more.'}
    ${'Pour 8 oz of milk into the pan.'}                  | ${'Pour 240 mL of milk into the pan.'}
    ${'She bought 16 oz of gold coins.'}                  | ${'She bought 500 g of gold coins.'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                         | expected
    ${'A 5-ton air conditioner cools the hall.'}   | ${'An 18 kilowatt air conditioner cools the hall.'}
    ${'A 5-ton heat pump heats the hall.'}         | ${'An 18 kilowatt heat pump heats the hall.'}
    ${'The 5-ton air conditioner cools the hall.'} | ${'The 18 kilowatt air conditioner cools the hall.'}
    ${'Drink 16 oz of water daily.'}               | ${'Drink 470 mL of water daily.'}
    ${'16 oz of water keeps you going.'}           | ${'470 mL of water keeps you going.'}
    ${'Add 8 oz of milk slowly.'}                  | ${'Add 240 mL of milk slowly.'}
    ${'16 oz of gold costs a lot.'}                | ${'500 g of gold costs a lot.'}
    ${'AC units of 3 tons cool the hall.'}         | ${'AC units of 11 kilowatts cool the hall.'}
    ${'AC units of 2 to 5 tons cool the hall.'}    | ${'AC units of 7 to 18 kilowatts cool the hall.'}
  `('reads the sense whatever word follows its thing: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                  | why
    ${'Order the board with 2 oz copper.'}     | ${'the copper of a circuit board'}
    ${'The 2 oz copper board costs more.'}     | ${'copper before a verb'}
    ${'Order 2 oz copper PCBs.'}               | ${'copper that describes a board'}
    ${'Copper weight: 2 oz, on both sides.'}   | ${'copper before the number'}
    ${'The PCB uses 1 oz on inner layers.'}    | ${'a circuit board in the sentence'}
    ${'Copper weight: 2 ounces suits a board.'} | ${'copper before the number, and a verb after'}
  `('holds the copper weight of a circuit board: $why', ({ unchanged }) => {
    const { text, changes } = deamericanise(unchanged);
    expect(text).toBe(unchanged);
    expect(changes).toEqual([]);
  });

  it.each`
    input                                             | expected
    ${'A 3-ton truck.'}                               | ${'A 2.7 tonne truck.'}
    ${'A 3-ton truck needs AC.'}                      | ${'A 2.7 tonne truck needs AC.'}
    ${'The 3-ton trucks need AC.'}                    | ${'The 2.7 tonne trucks need AC.'}
    ${'The truck carries 3 tons of gravel.'}          | ${'The truck carries 2.7 tonnes of gravel.'}
    ${'The bridge carries 40 tons.'}                  | ${'The bridge carries 36 tonnes.'}
    ${'Data in metric tons. A 3-ton truck.'}          | ${'Data in metric tons. A 3-ton truck.'}
    ${'The AC is in a 3-ton truck.'}                  | ${'The AC is in a 2.7 tonne truck.'}
    ${'The AC is in a 3 ton truck.'}                  | ${'The AC is in a 2.7 tonne truck.'}
    ${'A 5-ton HVAC truck.'}                          | ${'A 4.5 tonne HVAC truck.'}
    ${'The ship has a gross tonnage of 90,000 tons.'} | ${'The ship has a gross tonnage of 82,000 tonnes.'}
    ${'Cooling 3 tons of steel takes a day.'}         | ${'Cooling 2.7 tonnes of steel takes a day.'}
    ${'Add 8 oz cream cheese.'}                       | ${'Add 230 g cream cheese.'}
    ${'Add 8 oz sour cream.'}                         | ${'Add 230 g sour cream.'}
    ${'Add 8 oz ice cream.'}                          | ${'Add 230 g ice cream.'}
    ${'Add 8 oz milk chocolate.'}                     | ${'Add 230 g milk chocolate.'}
    ${'Buy 12 oz coffee beans.'}                      | ${'Buy 340 g coffee beans.'}
    ${'Add 2 oz baking soda.'}                        | ${'Add 57 g baking soda.'}
    ${'Add 14 oz sweetened condensed milk.'}          | ${'Add 400 g sweetened condensed milk.'}
    ${'Buy 12 oz whole bean coffee.'}                 | ${'Buy 340 g whole bean coffee.'}
    ${'A 16-oz steak.'}                               | ${'A 450 g steak.'}
    ${'A 16 oz T-bone steak.'}                        | ${'A 450 g T-bone steak.'}
    ${'Dissolve 2 oz of sugar in water.'}             | ${'Dissolve 57 g of sugar in water.'}
    ${'Open a 15 oz can of beans.'}                   | ${'Open a 430 g can of beans.'}
    ${'Open a 15 oz can of tomatoes.'}                | ${'Open a 430 g can of tomatoes.'}
    ${'Fill a 16 oz glass jar of honey.'}             | ${'Fill a 450 g glass jar of honey.'}
    ${'Drink 8 oz (230 g) of milk.'}                  | ${'Drink 230 g of milk.'}
    ${'Add 8 fl oz of milk.'}                         | ${'Add 240 mL of milk.'}
    ${'Buy 2 oz silver polish.'}                      | ${'Buy 57 g silver polish.'}
    ${'Add 2 oz of copper sulfate.'}                  | ${'Add 57 g of copper sulfate.'}
    ${'The PCB ships in an 8 oz bag.'}                | ${'The PCB ships in a 230 g bag.'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads nothing after a stop that ends the sentence', () => {
    const { changes } = deamericanise('Use 16 oz. Water the plants.');
    expect(changes.map((c) => c.ruleId)).toEqual(['units.mass.ounce']);
  });

  it.each`
    input                                 | ruleId                             | note
    ${'He bought 16 oz of gold.'}         | ${'units.mass.troy-ounce'}         | ${'read as troy ounces, in which precious metals are weighed'}
    ${'Drink 16 oz of water.'}            | ${'units.volume.fluid-ounce'}      | ${'read as fluid ounces, since it measures a liquid'}
    ${'Install a 3-ton central AC unit.'} | ${'units.power.refrigeration-ton'} | ${'read as tons of refrigeration, a rate of cooling'}
  `('converts $input under $ruleId, with a note', ({ input, ruleId, note }) => {
    const units = deamericanise(input).changes.filter((c) => c.category === 'units');
    expect(units.map((c) => [c.ruleId, c.note])).toEqual([[ruleId, note]]);
  });

  it.each`
    input                         | options                                                   | expected
    ${'Drink 16 oz of water.'}    | ${{ rules: { 'units.volume.fluid-ounce': false } }}       | ${'Drink 16 oz of water.'}
    ${'Drink 16 oz of water.'}    | ${{ unitsKeep: ['fluid ounces'] }}                        | ${'Drink 16 oz of water.'}
    ${'Drink 16 oz of water.'}    | ${{ rules: { 'units.mass.ounce': false } }}               | ${'Drink 470 mL of water.'}
    ${'He bought 16 oz of gold.'} | ${{ unitsKeep: ['troy-ounce'] }}                          | ${'He bought 16 oz of gold.'}
    ${'He bought 2 ozt of gold.'} | ${{ unitsKeep: ['ozt'] }}                                 | ${'He bought 2 ozt of gold.'}
    ${'A 3-ton AC unit.'}         | ${{ rules: { 'units.power.refrigeration-ton': false } }}  | ${'A 3-ton AC unit.'}
  `('follows the options of the measure it reads as: $options', ({ input, options, expected }) => {
    expect(convert(input, options)).toBe(expected);
  });

  it.each([
    ['Drink 16 oz of water.', 'Drink 470 mL (16 oz) of water.'],
    ['Install a 3-ton central AC unit.', 'Install an 11 kilowatt (3-ton) central AC unit.'],
    ['He bought 16 oz of gold.', 'He bought 500 g (16 oz) of gold.'],
  ])('keeps "%s" as written in its own bracket on a second run', (input, once) => {
    const options = { units: { keepOriginal: true } };
    expect(convert(input, options)).toBe(once);
    expect(convert(once, options)).toBe(once);
  });
});

describe('an ounce is a fluid ounce only where a liquid heads the phrase after it', () => {
  it.each`
    input                                 | expected                              | why
    ${'Add 8 oz rum raisins.'}            | ${'Add 230 g rum raisins.'}           | ${'a food named for a drink'}
    ${'Add 8 oz rum truffles.'}           | ${'Add 230 g rum truffles.'}          | ${'the same'}
    ${'Add 8 oz wine biscuits.'}          | ${'Add 230 g wine biscuits.'}         | ${'the same'}
    ${'Add 8 oz milk biscuits.'}          | ${'Add 230 g milk biscuits.'}         | ${'the same'}
    ${'Add 8 oz vodka gummies.'}          | ${'Add 230 g vodka gummies.'}         | ${'the same'}
    ${'Add 8 oz espresso beans.'}         | ${'Add 230 g espresso beans.'}        | ${'the same'}
    ${'Add 8 oz rum raisins to the bowl.'} | ${'Add 230 g rum raisins to the bowl.'} | ${'its head before a preposition'}
    ${'Add 8 oz wine jelly.'}             | ${'Add 230 g wine jelly.'}            | ${'a food in "ly"'}
    ${'Bake a 16 oz mug cake.'}           | ${'Bake a 450 g mug cake.'}           | ${'drinkware before another noun'}
    ${'Add 8 oz cream of tartar.'}        | ${'Add 230 g cream of tartar.'}       | ${'a solid headed by a liquid'}
  `('weighs $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                    | expected                                  | why
    ${'Add 8 oz chocolate milk.'}            | ${'Add 240 mL chocolate milk.'}           | ${'a liquid heads it'}
    ${'Add 4 oz beef stock.'}                | ${'Add 120 mL beef stock.'}               | ${'the same'}
    ${'Add 8 oz water first.'}               | ${'Add 240 mL water first.'}              | ${'before an adverb'}
    ${'Set 4 oz stock aside.'}               | ${'Set 120 mL stock aside.'}              | ${'the same'}
    ${'Add 8 oz of milk gradually.'}         | ${'Add 240 mL of milk gradually.'}        | ${'before an adverb in "ly"'}
    ${'8 oz of milk makes 2 servings.'}      | ${'240 mL of milk makes 2 servings.'}     | ${'before a verb and its object'}
    ${'Add 8 oz rum and raisins.'}           | ${'Add 240 mL rum and raisins.'}          | ${'before a conjunction'}
    ${'Add 8 oz milk, sugar and eggs.'}      | ${'Add 240 mL milk, sugar and eggs.'}     | ${'before a comma'}
    ${'Open a 12 oz beer can.'}              | ${'Open a 350 mL beer can.'}              | ${'before a vessel'}
    ${'Pour it into a 2 oz shot glass.'}     | ${'Pour it into a 59 mL shot glass.'}     | ${'drinkware'}
  `('reads $input as fluid ounces ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                      | expected
    ${'Stir until 8 oz of cream thickens.'}                    | ${'Stir until 240 mL of cream thickens.'}
    ${'Simmer until 16 oz of stock reduces by half.'}          | ${'Simmer until 470 mL of stock reduces by half.'}
    ${'Simmer until 16 oz of stock reduces, about 10 minutes.'} | ${'Simmer until 470 mL of stock reduces, about 10 minutes.'}
    ${'Once 8 oz of milk boils, add the oats.'}                | ${'Once 240 mL of milk boils, add the oats.'}
    ${'Heat until 8 oz of milk boils.'}                        | ${'Heat until 240 mL of milk boils.'}
    ${'16 oz of water goes into the pot.'}                     | ${'470 mL of water goes into the pot.'}
    ${'8 oz water helps.'}                                     | ${'240 mL water helps.'}
    ${'The 12 oz beer tastes flat.'}                           | ${'The 350 mL beer tastes flat.'}
    ${'The 12 oz beer tastes flat and warm.'}                  | ${'The 350 mL beer tastes flat and warm.'}
    ${'Then 16 oz of water goes in.'}                          | ${'Then 470 mL of water goes in.'}
    ${'8 oz of milk makes a cup.'}                             | ${'240 mL of milk makes a cup.'}
    ${'Pour 8 oz of milk into the bowl.'}                      | ${'Pour 240 mL of milk into the bowl.'}
  `('reads a drink before its own verb as fluid ounces: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                               | why
    ${'8 oz rum raisins go in first.'}     | ${'230 g rum raisins go in first.'}    | ${'the verb after the plural food'}
    ${'8 oz rum truffles are enough.'}     | ${'230 g rum truffles are enough.'}    | ${'an auxiliary after the plural food'}
    ${'8 oz rum raisins, chopped'}         | ${'230 g rum raisins, chopped'}        | ${'a sentence with no verb'}
    ${'After 8 oz wine gums, stop.'}       | ${'After 230 g wine gums, stop.'}      | ${'a food named for a drink'}
    ${'Add 8 oz beer batter.'}             | ${'Add 230 g beer batter.'}            | ${'a food headed by a noun'}
  `('weighs a food a drink names, wherever the quantity stands: $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                | expected
    ${'8 oz rum raisins\n4 oz sugar'}                    | ${'230 g rum raisins\n110 g sugar'}
    ${'Ingredients:\n8 oz rum raisins\n4 oz sugar\n'}    | ${'Ingredients:\n230 g rum raisins\n110 g sugar\n'}
    ${'8 oz milk biscuits\n2 cups flour'}                | ${'230 g milk biscuits\n2 cups flour'}
    ${'8 oz rum raisins\nA pinch of salt'}               | ${'230 g rum raisins\nA pinch of salt'}
  `('weighs a food a drink names at the end of a line of ingredients: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                                   | expected
    ${'8 oz of milk makes\na cup.'}                         | ${'240 mL of milk makes\na cup.'}
    ${'In the morning, 8 oz of milk makes\na good start.'}  | ${'In the morning, 240 mL of milk makes\na good start.'}
    ${'The 12 oz beer tastes\nflat.'}                       | ${'The 350 mL beer tastes\nflat.'}
    ${'16 oz of water goes\ninto the pot.'}                 | ${'470 mL of water goes\ninto the pot.'}
    ${'16 oz of water keeps\nyou going.'}                   | ${'470 mL of water keeps\nyou going.'}
  `('reads a drink before its verb at the end of a wrapped line as fluid ounces: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                          | expected
    ${'Add 4 oz stock cubes.'}     | ${'Add 110 g stock cubes.'}
    ${'Add 8 oz rum cake.'}        | ${'Add 230 g rum cake.'}
    ${'Add 8 oz water chestnuts.'} | ${'Add 230 g water chestnuts.'}
    ${'Add 8 oz wine gums.'}       | ${'Add 230 g wine gums.'}
    ${'Add 8 oz soda bread.'}      | ${'Add 230 g soda bread.'}
    ${'Add 8 oz coffee grounds.'}  | ${'Add 230 g coffee grounds.'}
  `('weighs a food a drink names whose head is not the drink: $input', ({ input, expected }) => {
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
    ${'It came to 5 pounds 50.'}                               | ${'the same'}
    ${'It came to 5 pounds 50 in total.'}                      | ${'pence before the preposition "in"'}
    ${'It cost 5 pounds 50 in total.'}                         | ${'the same, after a money verb'}
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
    ${'The box is 5 pounds 12 in. wide.'}                       | ${'The box is 2.3 kilograms 30 cm wide.'}                    | ${'nor is a number of inches'}
    ${'The box is five pounds twelve in. wide.'}                | ${'The box is 2.3 kilograms 30 cm wide.'}                    | ${'the same, in words'}
    ${'The box is 5 pounds 12in wide.'}                         | ${'The box is 2.3 kilograms 30 cm wide.'}                    | ${'the same, with no space'}
    ${'The box is 5 pounds 12 inches wide.'}                    | ${'The box is 2.3 kilograms 30 centimetres wide.'}           | ${'the same, written out'}
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

  it('converts pounds before a number of inches in one run', () => {
    const once = deamericaniseText('The box is 5 pounds 12 in. wide.');
    expect(once).toBe('The box is 2.3 kilograms 30 cm wide.');
    expect(deamericaniseText(once)).toBe(once);
  });

  it.each`
    input                                             | expected                                                   | why
    ${'It is 5 pounds 16 to 20 feet.'}                | ${'It is 2.3 kilograms 4.9 to 6.1 metres.'}                | ${'the first end of a range'}
    ${'It is 0 1/2pounds\n16 to 20 feet.'}            | ${'It is 230 grams\n4.9 to 6.1 metres.'}                   | ${'the same, across a line break'}
    ${'It is five pounds sixteen to twenty feet.'}    | ${'It is 2.3 kilograms 4.9 to 6.1 metres.'}                | ${'the same, in words'}
    ${'The box is 5 pounds 12 to 14 inches wide.'}    | ${'The box is 2.3 kilograms 30 to 36 centimetres wide.'}   | ${'a range in inches'}
    ${'It is 5 pounds 16, 18 or 20 feet.'}            | ${'It is 2.3 kilograms 4.9, 5.5 or 6.1 metres.'}           | ${'the first figure of a list'}
    ${'The box is 5 pounds 12 in by 3 inches wide.'}  | ${'The box is 2.3 kilograms 30 by 7.6 centimetres wide.'}  | ${'the first side of a dimension'}
    ${'The box is 5 pounds 12 in x 3 in wide.'}       | ${'The box is 2.3 kilograms 30 x 7.6 cm wide.'}            | ${'the same, joined by x'}
    ${'It is 5 pounds 12 and a half feet.'}           | ${'It is 2.3 kilograms 3.8 metres.'}                       | ${'a number with its unit'}
  `('reads no pence where a measurement starts: $input -> $expected ($why)', ({ input, expected }) => {
    const once = deamericaniseText(input);
    expect(once).toBe(expected);
    expect(deamericaniseText(once)).toBe(once);
  });

  it.each`
    unchanged                                         | why
    ${'It came to 5 pounds 50 in total.'}             | ${'pence before the preposition "in"'}
    ${'It came to 5 pounds 50.'}                      | ${'pence ending the sentence'}
    ${'It came to 5 pounds 50 and a bit.'}            | ${'pence before "and" and no number'}
    ${'It came to 5 pounds 12 to 14 pounds.'}         | ${'the range is in pounds, so the figure is part of the first amount'}
    ${'6 in by 5 in the morning'}                     | ${'no pounds at all'}
  `('still leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(deamericaniseText(unchanged)).toBe(unchanged);
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
    ${'temperatures in the 80s degrees'}           | ${'temperatures between 27 and 32°C'}
    ${'highs in the upper 80s degrees today'}      | ${'highs between 31 and 32°C today'}
    ${'temperatures in the 80s and 90s degrees'}   | ${'temperatures between 27 and 37°C'}
    ${'highs in the 80s degrees F today'}          | ${'highs between 27 and 32°C today'}
    ${'Highs in the mid-80s.'}                     | ${'Highs between 29 and 30°C.'}
    ${'Highs in the mid 80s.'}                     | ${'Highs between 29 and 30°C.'}
    ${'highs in the\n   80s'}                      | ${'highs between 27 and 32°C'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                               | why
    ${'Highs in the 70s or 80s.'}          | ${'Highs between 21 and 32°C.'}        | ${'or'}
    ${'Highs in the 70s and 80s.'}         | ${'Highs between 21 and 32°C.'}        | ${'and'}
    ${'Highs in the 70s to 80s.'}          | ${'Highs between 21 and 32°C.'}        | ${'to'}
    ${'highs in the 70s\u201480s'}         | ${'highs between 21 and 32°C'}         | ${'an em dash'}
    ${'highs in the low 70s or upper 80s'} | ${'highs between 21 and 32°C'}         | ${'two banded decades'}
    ${'highs in the 70s or 80s °F'}        | ${'highs between 21 and 32°C'}         | ${'a Fahrenheit unit after the pair'}
    ${'highs in the 70s or 80s degrees'}   | ${'highs between 21 and 32°C'}         | ${'a bare degrees after the pair'}
    ${'highs in the 70s or\n80s'}          | ${'highs between 21 and 32°C'}         | ${'the pair wrapped across lines'}
    ${'highs in the 100s or 110s'}         | ${'highs between 38 and 48°C'}         | ${'decades of three figures'}
    ${'Highs in the 70s or so.'}           | ${'Highs between 21 and 26°C or so.'}  | ${'no second decade after or'}
  `('reads two decades joined as a range does: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                            | expected                                                  | why
    ${'Highs in the 70s, 80s or 90s.'}               | ${'Highs between 21 and 37°C.'}                           | ${'a list with or'}
    ${'Highs in the 70s, 80s, and 90s.'}             | ${'Highs between 21 and 37°C.'}                           | ${'an Oxford comma'}
    ${'Highs in the 70s and 80s and 90s.'}           | ${'Highs between 21 and 37°C.'}                           | ${'and twice'}
    ${'Highs in the 70s or 80s or 90s.'}             | ${'Highs between 21 and 37°C.'}                           | ${'or twice'}
    ${'Highs in the 70s to 80s to 90s.'}             | ${'Highs between 21 and 37°C.'}                           | ${'to twice'}
    ${'Highs in the 70s, 80s, 90s, 100s and 110s.'}  | ${'Highs between 21 and 48°C.'}                           | ${'five decades'}
    ${'Highs in the low 70s, mid 80s or upper 90s.'} | ${'Highs between 21 and 37°C.'}                           | ${'banded decades'}
    ${'highs in the 80s, 90s or 100s °F'}            | ${'highs between 27 and 43°C'}                            | ${'a Fahrenheit unit after the list'}
    ${'Highs in the 70s,\n80s and 90s.'}             | ${'Highs between 21 and 37°C.'}                           | ${'the list wrapped across lines'}
    ${'Highs in the 70s,\n\n80s and 90s.'}           | ${'Highs between 21 and 26°C,\n\n80s and 90s.'}           | ${'a blank line, which no join crosses'}
    ${'Highs in the 70s, lows in the 50s.'}          | ${'Highs between 21 and 26°C, lows between 10 and 15°C.'} | ${'two decades, each with its own word'}
  `('reads a list of decades as one range: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | why
    ${'Highs in the 70s, 90s and 80s.'}         | ${'a list that falls back'}
    ${'Highs in the 80s or 70s.'}               | ${'a pair that falls'}
    ${'Highs in the 70s, 80s and 90s Celsius.'} | ${'a Celsius unit after the list'}
  `('leaves a list of decades that does not rise or is Celsius as written: $input ($why)', ({ input }) => {
    expect(convert(input)).toBe(input);
  });

  it.each`
    input                                         | expected                                                    | why
    ${'highs in the 70s F'}                       | ${'highs between 21 and 26°C'}                              | ${'a bare F'}
    ${'highs in the upper 70s F today'}           | ${'highs between 25 and 26°C today'}                        | ${'a banded decade'}
    ${'temperatures in the mid-80s F'}            | ${'temperatures between 29 and 30°C'}                       | ${'a hyphenated band'}
    ${'highs in the 70s F and lows in the 50s F'} | ${'highs between 21 and 26°C and lows between 10 and 15°C'} | ${'two decades'}
    ${'highs in the 70s, 80s or 90s F'}           | ${'highs between 21 and 37°C'}                              | ${'after a list'}
  `('takes a bare F after a decade with it: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                              | why
    ${'highs in the 30s (Celsius)'}                    | ${'Celsius in a bracket'}
    ${'highs in the 30s (°C)'}                         | ${'a degree sign and C in a bracket'}
    ${'highs in the 30s (C)'}                          | ${'a bare C in a bracket'}
    ${'highs in the 30s ( Celsius )'}                  | ${'a bracket with spaces inside'}
    ${'In Celsius, highs are in the 30s.'}             | ${'Celsius earlier in the sentence'}
    ${'In centigrade the highs are in the 30s.'}       | ${'centigrade earlier in the sentence'}
    ${'Highs in the 30s, as Celsius readers expect.'}  | ${'Celsius later in the sentence'}
    ${'Highs in the 30s Celsius and lows in the 20s.'} | ${'a second decade after a Celsius one'}
  `('leaves a decade in a sentence that names Celsius as written: $input ($why)', ({ input }) => {
    expect(convert(input)).toBe(input);
  });

  it.each`
    input                                                                       | expected                                                                             | why
    ${'Highs in the 30s. Celsius is the scale used here.'}                      | ${'Highs between -1 and 4°C. Celsius is the scale used here.'}                       | ${'Celsius in the next sentence'}
    ${'Highs in the 70s, which Fahrenheit readers know, feel mild in Celsius.'} | ${'Highs between 21 and 26°C, which Fahrenheit readers know, feel mild in Celsius.'} | ${'Fahrenheit named too'}
    ${'Highs in the 30s, and seat 22C is free.'}                                | ${'Highs between -1 and 4°C, and seat 22C is free.'}                                 | ${'a bare C, which names no scale'}
  `('converts a decade whose sentence names no Celsius alone: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('takes a bare degrees after a decade as its unit whatever the verdict', () => {
    expect(convert('temperatures in the 80s degrees', { assumeAmerican: true })).toBe(
      'temperatures between 27 and 32°C',
    );
  });

  it.each`
    input                                          | why
    ${'temperatures in the 30s Celsius'}           | ${'Celsius'}
    ${'temperatures in the 20s degrees Celsius'}   | ${'degrees Celsius, whose degrees is no bare unit'}
    ${'highs in the 20s °C'}                       | ${'a degree sign and C'}
    ${'highs in the 30s ºC'}                       | ${'a phone keyboard degree sign'}
    ${'highs in the 30s ℃'}                        | ${'the Celsius sign'}
    ${'highs in the 30s centigrade'}               | ${'centigrade'}
    ${'highs in the 30s degrees centigrade'}       | ${'degrees centigrade'}
    ${'highs in the 30s degrees C'}                | ${'degrees C'}
    ${'highs in the 30s deg C'}                    | ${'deg C'}
    ${'highs in the 30s C'}                        | ${'a bare upper case C'}
    ${'highs in the 30s celsius'}                  | ${'the word in lower case'}
    ${'highs in the low 30s Celsius'}              | ${'a banded decade'}
    ${'highs in the 20s and 30s Celsius'}          | ${'two decades'}
    ${'highs in the 20s or 30s °C'}                | ${'two decades joined by or'}
    ${'highs in the 30s\nCelsius'}                 | ${'the unit on the next line'}
  `('leaves a decade with a Celsius unit as written: $input ($why)', ({ input }) => {
    expect(convert(input)).toBe(input);
  });

  it('leaves a decade with a Celsius unit as written under localise', () => {
    const input = 'temperatures in the 30s Celsius';
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(input);
  });

  /** The spans the decade rule holds as written in `text`. */
  const decadeHolds = (text: string): string[] => {
    const resolved = resolveOptions({});
    const ctx: RuleContext = { text, options: resolved, signals: analyse(text), american: true };
    return patternRules(resolved)
      .flatMap((rule) => rule.find(ctx))
      .filter((c) => c.hold && c.ruleId === 'units.temperature.decade')
      .map((c) => c.before);
  };

  it.each`
    input                                         | span
    ${'temperatures in the 30s Celsius today'}    | ${'in the 30s Celsius'}
    ${'highs in the 20s degrees Celsius'}         | ${'in the 20s degrees Celsius'}
    ${'highs in the 20s or 30s °C'}               | ${'in the 20s or 30s °C'}
    ${'highs in the 30s C'}                       | ${'in the 30s C'}
    ${'highs in the 30s (C)'}                     | ${'in the 30s (C)'}
    ${'In Celsius, highs are in the 30s.'}        | ${'in the 30s'}
    ${'Highs in the 70s, 90s and 80s.'}           | ${'in the 70s, 90s and 80s'}
  `('holds "$span" whole', ({ input, span }) => {
    expect(decadeHolds(input)).toEqual([span]);
  });

  it('holds nothing for a bare F with no word about heat nearby', () => {
    expect(decadeHolds('Ford trucks from the 70s F series')).toEqual([]);
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
    ${'Lows in the -20s overnight.'}                 | ${'a minus sign, which no band explains'}
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

describe('a conventional size names its noun in either number, on either side', () => {
  it.each`
    unchanged                            | why
    ${'a monitor of 27 inches'}          | ${'a singular noun before the size'}
    ${'monitors of 27 inches'}           | ${'its plural'}
    ${'laptops of 13 inches'}            | ${'the same'}
    ${'screens up to 15.6 inches'}       | ${'the same, with function words between'}
    ${'wheels of 15 to 17 inches'}       | ${'a range after "of"'}
    ${'wheels between 15 and 17 inches'} | ${'a range after "between"'}
    ${'a pizza of 12 inches'}            | ${'a noun read after a size reads before one'}
    ${'a 6 inch phone'}                  | ${'and the other way round'}
    ${'a waist of 32 inches'}            | ${'a body size before its number'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                    | expected                                         | why
    ${'between 15 and 17 inches'}            | ${'between 38 and 43 centimetres'}               | ${'no conventional noun'}
    ${'The gauge records 2 inches of rain.'} | ${'The gauge records 5.1 centimetres of rain.'}  | ${'a plural that is also a verb of measuring'}
    ${'Lose 2 inches off your waist.'}       | ${'Lose 5.1 centimetres off your waist.'}        | ${'a body measured, not sized'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a distance from a thing sized in inches', () => {
  it.each`
    input                                                  | expected                                                    | why
    ${'Place the monitor about 20 inches from your eyes.'} | ${'Place the monitor about 51 centimetres from your eyes.'} | ${'a distance from the thing'}
    ${'Space the bolts 6 inches apart.'}                   | ${'Space the bolts 15 centimetres apart.'}                  | ${'a distance between them'}
    ${'Keep the phone 12 inches away from your face.'}     | ${'Keep the phone 30 centimetres away from your face.'}     | ${'away'}
    ${'Mount the screen 30 inches above the desk.'}        | ${'Mount the screen 76 centimetres above the desk.'}        | ${'a position'}
    ${'Place the speaker about 6 inches from the wall.'}   | ${'Place the speaker about 15 centimetres from the wall.'}  | ${'a noun read either side of a size'}
    ${'The jack is 4 inches from the edge.'}               | ${'The jack is 10 centimetres from the edge.'}              | ${'after a verb'}
    ${'Keep it 6 inches from the monitor.'}                | ${'Keep it 15 centimetres from the monitor.'}               | ${'the thing after the distance word'}
    ${'Space the bolts 4 to 6 inches apart.'}              | ${'Space the bolts 10 to 15 centimetres apart.'}            | ${'a range'}
    ${'Hang the screen 20 x 30 inches above the desk.'}    | ${'Hang the screen 51 x 76 centimetres above the desk.'}    | ${'a dimension'}
    ${'hail 2 inches in diameter'}                         | ${'hail 5.1 centimetres in diameter'}                       | ${'no conventional noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged                                          | why
    ${'a 27 inch monitor'}                             | ${'the noun straight after the size'}
    ${'a 6 inch speaker'}                              | ${'the same'}
    ${'The screen is 27 inches.'}                      | ${'nothing after the size'}
    ${'The screen is 27 inches from corner to corner.'} | ${'from one part of the thing to another'}
    ${'monitors of 27 inches'}                         | ${'the noun before the size'}
    ${'a 6 inch off-white speaker'}                    | ${'a distance word inside another word'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('drive bays, audio jacks and telescope parts are sized in inches', () => {
  it.each`
    unchanged                                                    | converted
    ${'Fit a 2.5-inch SATA SSD next to the 3.5-inch HDD.'}       | ${'Fit a 6.4 centimetre SATA SSD next to the 8.9 centimetre HDD.'}
    ${'Plug the guitar into the 1/4-inch TRS jack.'}             | ${'Plug the guitar into the 6.4 millimetre TRS jack.'}
    ${'Use a 2-inch eyepiece on the 8-inch Dobsonian telescope.'} | ${'Use a 5.1 centimetre eyepiece on the 20 centimetre Dobsonian telescope.'}
  `('leaves "$unchanged" alone, and converts it with respectConventions off', ({ unchanged, converted }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, { units: { respectConventions: false } })).toBe(converted);
  });

  it.each`
    input                                    | expected                                       | why
    ${'The jack is 4 inches from the edge.'} | ${'The jack is 10 centimetres from the edge.'} | ${'a distance from the jack'}
    ${'Plug the 2 inch hole with filler.'}   | ${'Plug the 5.1 centimetre hole with filler.'} | ${'a verb before the size names no plug'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    unchanged               | why
    ${'A 3.5mm jack.'}      | ${'already metric'}
    ${'A 27 inch monitor.'} | ${'a screen'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });
});

describe('a shipping container is named by its length in feet', () => {
  it.each`
    unchanged                                                            | why
    ${'We shipped it in a 20-foot container and two 40-foot containers.'} | ${'the standard lengths'}
    ${'The 40-foot shipping container holds a lot.'}                     | ${'a word between'}
    ${'a 40-foot high-cube container'}                                   | ${'a hyphenated word between'}
    ${'a 20-foot reefer box'}                                            | ${'a box of a kind'}
    ${'the twenty-foot equivalent unit'}                                 | ${'what a TEU stands for'}
    ${'20- and 40-foot containers'}                                      | ${'two standard lengths'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                       | expected                                       | why
    ${'A 20-foot boat.'}                        | ${'A 6.1 metre boat.'}                         | ${'no container'}
    ${'A 6-foot fence.'}                        | ${'A 1.8 metre fence.'}                        | ${'the same'}
    ${'the container is 20 feet from the wall'} | ${'the container is 6.1 metres from the wall'} | ${'a distance from a container'}
    ${'Move it 20 feet towards the container.'} | ${'Move it 6.1 metres towards the container.'} | ${'a preposition and a determiner between'}
    ${'a 30-foot container'}                    | ${'a 9.1 metre container'}                     | ${'no standard length'}
    ${'a 20 to 30 foot container'}              | ${'a 6.1 to 9.1 metre container'}              | ${'a range with one end no standard length'}
    ${'a 20-foot box'}                          | ${'a 6.1 metre box'}                           | ${'any box'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts a container with respectConventions off', () => {
    expect(convert('a 20-foot container', { units: { respectConventions: false } })).toBe(
      'a 6.1 metre container',
    );
  });
});

describe('an aviation altitude is given in feet', () => {
  it.each`
    unchanged                                                           | why
    ${'We cruised at 35,000 feet MSL and descended to 1,500 feet AGL.'} | ${'a reference level after the altitude'}
    ${'The plane climbed to flight level 350, about 35,000 feet.'}      | ${'a flight level earlier in the sentence'}
    ${'We reached our cruising altitude of 35,000 feet.'}               | ${'a cruising altitude'}
    ${'The service ceiling is 41,000 feet.'}                            | ${'an aircraft ceiling'}
    ${'35,000 feet is a usual cruising altitude'}                       | ${'later in the sentence'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                                  | expected                                                 | why
    ${'The plane is 200 feet long.'}                       | ${'The plane is 61 metres long.'}                        | ${'a plane alone is not enough'}
    ${'The hill rises 1,500 feet.'}                        | ${'The hill rises 460 metres.'}                          | ${'a height that is no altitude'}
    ${'a 10-foot ceiling'}                                 | ${'a 3 metre ceiling'}                                   | ${'a room has a ceiling'}
    ${'We climbed 35,000 feet. The flight level was 350.'} | ${'We climbed 11 kilometres. The flight level was 350.'} | ${'in another sentence'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('converts an altitude with respectConventions off', () => {
    expect(convert('We cruised at 35,000 feet MSL.', { units: { respectConventions: false } })).toBe(
      'We cruised at 11 kilometres MSL.',
    );
  });
});

describe('inches of mercury', () => {
  it.each`
    input                                       | expected
    ${'Set the altimeter to 29.92 inHg.'}       | ${'Set the altimeter to 1013 hPa.'}
    ${'29.92 inches of mercury'}                | ${'1013 hectopascals'}
    ${'29.92 in Hg'}                            | ${'1013 hPa'}
    ${'The pressure fell 2 inches of mercury.'} | ${'The pressure fell 68 hectopascals.'}
    ${'29.92 inHg (1013 hPa)'}                  | ${'1013 hPa'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                   | expected                                | why
    ${'Set the altimeter to 30 inHg.'}      | ${'Set the altimeter to 1016 hPa.'}     | ${'more figures than the source gives'}
    ${'Set it between 29.9 and 30.1 inHg.'} | ${'Set it between 1013 and 1019 hPa.'}  | ${'each end of a range'}
    ${'Try 29.92, 30.00 or 30.12 inHg.'}    | ${'Try 1013, 1016 or 1020 hPa.'}        | ${'each figure of a list'}
    ${'It reads to within 0.01 inHg.'}      | ${'It reads to within 0.34 hPa.'}       | ${'no value under one is written as zero'}
  `('writes whole hectopascals: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('honours a precision the options set', () => {
    expect(convert('Set the altimeter to 29.92 inHg.', { units: { precision: 2 } })).toBe(
      'Set the altimeter to 1013.21 hPa.',
    );
  });

  it('honours unitsKeep', () => {
    expect(convert('Set the altimeter to 29.92 inHg.', { unitsKeep: ['inHg'] })).toBe(
      'Set the altimeter to 29.92 inHg.',
    );
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
    input                                     | expected                              | why
    ${'a 2 square mile park'}                 | ${'a 5.2 square kilometre park'}      | ${'an area'}
    ${'a 2 sq mile park'}                     | ${'a 5.2 square kilometre park'}      | ${'the same, shortened'}
    ${'a 100 foot-pound wrench'}              | ${'a 140 newton metre wrench'}        | ${'a hyphenated torque'}
    ${'a 100 pound-foot wrench'}              | ${'a 140 newton metre wrench'}        | ${'the other way round'}
    ${'a 100 foot pound wrench'}              | ${'a 140 newton metre wrench'}        | ${'spaced'}
    ${'a 10,000 british thermal unit heater'} | ${'an 11,000 kilojoule heater'}       | ${'energy'}
    ${'a 2 square foot tile'}                 | ${'a 0.19 square metre tile'}         | ${'an area in feet'}
    ${'2 square miles of forest'}             | ${'5.2 square kilometres of forest'}  | ${'a plural unit stays plural'}
    ${'1 foot-pound'}                         | ${'1.4 newton metres'}                | ${'no noun after'}
  `('a unit of more than one word: $input -> $expected ($why)', ({ input, expected }) => {
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

describe('a length that gives the size of a noun describes it', () => {
  it.each`
    input                                    | expected                                           | why
    ${'a 6 foot long table'}                 | ${'a 1.8 metre long table'}                        | ${'a size between the unit and the noun'}
    ${'the 9 inch high wall'}                | ${'the 23 centimetre high wall'}                   | ${'the same'}
    ${'a 6-foot-tall fence'}                 | ${'a 1.8 metre tall fence'}                        | ${'hyphenated'}
    ${'a 3 inch-thick steak'}                | ${'a 7.6 centimetre thick steak'}                  | ${'a hyphen after the unit only'}
    ${'a 6-ft-tall fence'}                   | ${'a 1.8 m tall fence'}                            | ${'an abbreviation'}
    ${'a 2 to 3 foot long table'}            | ${'a 61 to 91 centimetre long table'}              | ${'a range'}
    ${'the 5-6 inch deep pans'}              | ${'the 13-15 centimetre deep pans'}                | ${'a range with a dash'}
    ${'a 2 to 3-foot-long table'}            | ${'a 61 to 91 centimetre long table'}              | ${'a hyphenated range'}
    ${'cut into 1/2 inch thick slices'}      | ${'cut into 1.3 centimetre thick slices'}          | ${'a fraction, which gives the size whatever its number'}
    ${'one foot long boards'}                | ${'30 centimetre long boards'}                     | ${'and one'}
    ${'a quarter mile long track'}           | ${'a 400 metre long track'}                        | ${'the article stays with the track'}
    ${'two quarter-mile-long tracks'}        | ${'two 400 metre long tracks'}                     | ${'a count stays out of the size'}
    ${'a 6 foot long by 3 foot wide table'}  | ${'a 1.8 metre long by 91 centimetre wide table'}  | ${'two sizes'}
    ${'a 6 foot long and 3 foot wide table'} | ${'a 1.8 metre long and 91 centimetre wide table'} | ${'two sizes joined by "and"'}
    ${'those 4 by 6 inch thick boards'}      | ${'those 10 by 15 centimetre thick boards'}        | ${'a dimension'}
    ${'The fence is 6-foot-tall.'}           | ${'The fence is 1.8 metres tall.'}                 | ${'a hyphenated size with no noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                      | expected                                          | why
    ${'6 feet long'}                           | ${'1.8 metres long'}                              | ${'no noun after the size'}
    ${'Roll it 1/16 inch thick.'}              | ${'Roll it 1.6 millimetres thick.'}               | ${'the same'}
    ${'a 9 inch deep-dish pie'}                | ${'a 23 centimetre deep-dish pie'}                | ${'a hyphen makes a modifier of "deep"'}
    ${'They stood 6 feet apart'}               | ${'They stood 1.8 metres apart'}                  | ${'an adverb'}
    ${'He is 6 foot tall.'}                    | ${'He is 1.8 metres tall.'}                       | ${'a size and a full stop'}
    ${'The track is a quarter mile long.'}     | ${'The track is 400 metres long.'}                | ${'the article goes to the number'}
    ${'a 6 feet long table'}                   | ${'a 1.8 metres long table'}                      | ${'a plural source stays plural'}
    ${'Roll the dough 1/4 inch thick and cut'} | ${'Roll the dough 6.4 millimetres thick and cut'} | ${'a conjunction after the size'}
    ${'1 pound thick bacon'}                   | ${'450 grams thick bacon'}                        | ${'only a length gives a size'}
    ${'2 pound thick steaks'}                  | ${'910 grams thick steaks'}                       | ${'the same'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                       | expected
    ${'He is 6 foot tall now.'}                 | ${'He is 1.8 metres tall now.'}
    ${'He is 6 foot now.'}                      | ${'He is 1.8 metres now.'}
    ${'The board is 6 foot long overall.'}      | ${'The board is 1.8 metres long overall.'}
    ${'The snow lay 2 foot deep everywhere.'}   | ${'The snow lay 61 centimetres deep everywhere.'}
    ${'The wall is 6 foot high here.'}          | ${'The wall is 1.8 metres high here.'}
    ${'Slice it 1/4 inch thick crosswise.'}     | ${'Slice it 6.4 millimetres thick crosswise.'}
    ${'a wall 6 foot high beside the road'}     | ${'a wall 1.8 metres high beside the road'}
    ${'He stood 6 foot tall like his father.'}  | ${'He stood 1.8 metres tall like his father.'}
    ${'a hedge 6 foot high which needs a trim'} | ${'a hedge 1.8 metres high which needs a trim'}
  `('reads an adverb, preposition or pronoun after a size as no noun: $input', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('reads three sizes as the size of the noun after them', () => {
    expect(convert('a 6 foot long by 3 foot wide by 2 foot high table')).toBe(
      'a 1.8 metre long by 91 centimetre wide by 61 centimetre high table',
    );
  });

  it('reads two sizes with no noun after them as quantities', () => {
    expect(convert('The table is 6 foot long and 3 foot wide.')).toBe(
      'The table is 1.8 metres long and 91 centimetres wide.',
    );
  });

  it('keeps the original before the size', () => {
    expect(convert('a 6-foot-tall fence', { units: { keepOriginal: true } })).toBe(
      'a 1.8 metre (6-foot) tall fence',
    );
  });
});

describe('a unit word that is its own plural describes a noun where its number cannot say', () => {
  it.each`
    input                                  | expected                               | why
    ${'a 300 horsepower engine'}           | ${'a 220 kilowatt engine'}             | ${'an article opens the phrase'}
    ${'a 300-horsepower engine'}           | ${'a 220 kilowatt engine'}             | ${'a hyphen ties the number to the unit'}
    ${'two 300 horsepower engines'}        | ${'two 220 kilowatt engines'}          | ${'a count before the number'}
    ${'a 14 stone man'}                    | ${'an 89 kilogram man'}                | ${'stone'}
    ${'the 300-horsepower engine'}         | ${'the 220 kilowatt engine'}           | ${'a hyphen after "the"'}
    ${'a 200 to 300 horsepower engine'}    | ${'a 150 to 220 kilowatt engine'}      | ${'a range'}
    ${'a 300-horsepower, twin-turbo car'}  | ${'a 220 kilowatt, twin-turbo car'}    | ${'a hyphen before a comma and another modifier'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                             | expected                                         | why
    ${'300 horsepower'}                               | ${'220 kilowatts'}                               | ${'no noun after'}
    ${'He weighs 14 stone.'}                          | ${'He weighs 89 kilograms.'}                     | ${'the same'}
    ${'The engine makes 300 horsepower at 6000 rpm.'} | ${'The engine makes 220 kilowatts at 6000 rpm.'} | ${'a preposition after'}
    ${'He was 14 stone soaking wet.'}                 | ${'He was 89 kilograms soaking wet.'}            | ${'nothing opens the phrase'}
    ${'the 300 horsepower produced by the motor'}     | ${'the 220 kilowatts produced by the motor'}     | ${'"the" may take the unit as its noun'}
    ${'another 300 horsepower comes from the motor'}  | ${'another 220 kilowatts comes from the motor'}  | ${'so may "another"'}
    ${'a 6 foot fence'}                               | ${'a 1.8 metre fence'}                           | ${'a singular unit keeps its reading'}
  `('keeps the plural: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a hyphenated measurement describes the noun wherever it stands', () => {
  it.each`
    input                                    | expected                                | why
    ${'a 6-inch, sharp knife'}               | ${'a 15 centimetre, sharp knife'}       | ${'a comma and another modifier before the noun'}
    ${'A 10-foot-tall, 2,500-pound crane.'}  | ${'A 3 metre tall, 1.1 tonne crane.'}   | ${'a size, then a comma and another measurement'}
    ${'It is a 2,500-pound, red crane.'}     | ${'It is a 1.1 tonne, red crane.'}      | ${'mass'}
    ${'two 6-inch, sharp knives'}            | ${'two 15 centimetre, sharp knives'}    | ${'a count opens the phrase'}
    ${'a 6-foot or 8-foot ladder'}           | ${'a 1.8 metre or 2.4 metre ladder'}    | ${'a conjunction and another measurement'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                           | expected                                        | why
    ${'It is 10 feet tall.'}                        | ${'It is 3 metres tall.'}                       | ${'no hyphen'}
    ${'We bought 2,500 pounds, then more.'}         | ${'We bought 1.1 tonnes, then more.'}           | ${'the same'}
    ${'A 10-foot-tall fence.'}                      | ${'A 3 metre tall fence.'}                      | ${'the noun straight after the size'}
    ${'A heavy 2,500-pound crane.'}                 | ${'A heavy 1.1 tonne crane.'}                   | ${'the noun straight after'}
    ${'The fence is 6-foot-tall.'}                  | ${'The fence is 1.8 metres tall.'}              | ${'nothing opens the phrase'}
    ${'The fence is 6-foot-tall, sturdy and heavy.'} | ${'The fence is 1.8 metres tall, sturdy and heavy.'} | ${'the same, before a comma'}
    ${'It is a quarter-mile.'}                      | ${'It is 400 metres.'}                          | ${'the article is the number\'s own'}
  `('keeps the plural: $input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a singular unit before a modifier in digits describes the noun', () => {
  it.each`
    input                                  | expected                               | why
    ${'Buy a 6-foot 2-door cabinet.'}      | ${'Buy a 1.8 metre 2-door cabinet.'}   | ${'a number hyphenated to a word'}
    ${'Buy a 6-foot 3-shelf bookcase.'}    | ${'Buy a 1.8 metre 3-shelf bookcase.'} | ${'the same'}
    ${'Buy a 10-gallon 2-tier fountain.'}  | ${'Buy a 38 litre 2-tier fountain.'}   | ${'volume'}
    ${'Buy a 6 foot 2-door cabinet.'}      | ${'Buy a 1.8 metre 2-door cabinet.'}   | ${'a unit spaced from its number'}
    ${'Buy a 6-foot 4WD truck.'}           | ${'Buy a 1.8 metre 4WD truck.'}        | ${'a word with digits in it'}
    ${'Buy a 6 foot long 2-door cabinet.'} | ${'Buy a 1.8 metre long 2-door cabinet.'} | ${'after a size'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                  | expected                                | why
    ${'He lost 6 feet 2 days later.'}      | ${'He lost 1.8 metres 2 days later.'}   | ${'a count spaced from its noun'}
    ${'Buy a 6-foot two-door cabinet.'}    | ${'Buy a 1.8 metre two-door cabinet.'}  | ${'a modifier in words'}
    ${'Cut a 6-foot 2-inch board.'}        | ${'Cut a 1.88 metre board.'}            | ${'a number hyphenated to a unit is a measurement'}
    ${'It grew 6 foot 2 years ago.'}       | ${'It grew 1.8 metres 2 years ago.'}    | ${'a singular unit before a count spaced from its noun'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });
});

describe('a measurement of zero takes the unit nearest in size to its own', () => {
  it.each`
    input                    | expected
    ${'It is 0 miles away.'} | ${'It is 0 kilometres away.'}
    ${'It is 0 feet.'}       | ${'It is 0 metres.'}
    ${'It is 0 inches.'}     | ${'It is 0 centimetres.'}
    ${'It weighs 0 pounds.'} | ${'It weighs 0 kilograms.'}
    ${'It weighs 0 ounces.'} | ${'It weighs 0 grams.'}
    ${'It holds 0 gallons.'} | ${'It holds 0 litres.'}
    ${'It covers 0 acres.'}  | ${'It covers 0 hectares.'}
    ${'It weighs 0 tons.'}   | ${'It weighs 0 tonnes.'}
    ${'It is 0 ft wide.'}    | ${'It is 0 m wide.'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                       | expected
    ${'It is 0.5 miles away.'}  | ${'It is 800 metres away.'}
    ${'It is 1 inch long.'}     | ${'It is 2.5 centimetres long.'}
    ${'It weighs 3 ounces.'}    | ${'It weighs 85 grams.'}
    ${'It is 0 to 5 miles.'}    | ${'It is 0 to 8 kilometres.'}
  `('keeps the unit of a number that is not zero: $input -> $expected', ({ input, expected }) => {
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
    ${'In 5 yard sales we sold it.'} | ${'a yard sale is a sale'}
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
    input                            | span
    ${'Bake 1 pound cake'}           | ${'1 pound cake'}
    ${'Send in 6 foot soldiers'}     | ${'6 foot soldiers'}
    ${'Bake 2-3 pound cakes'}        | ${'2-3 pound cakes'}
    ${'In 5 yard sales we sold it.'} | ${'5 yard sales'}
  `('holds $span whole, even with respectConventions off', ({ input, span }) => {
    expect(held(input)).toContain(span);
    expect(held(input, { units: { respectConventions: false } })).toContain(span);
  });
});

describe('a count before a compound noun that starts with a unit', () => {
  it.each`
    unchanged                       | why
    ${'We passed 3 mile markers.'}  | ${'a mile marker is a post'}
    ${'the 26 mile marker'}         | ${'the post at mile 26'}
    ${'the 26-mile marker'}         | ${'the same, hyphenated'}
    ${'We put up 3 yard signs.'}    | ${'a yard sign is a sign'}
    ${'Press the two pound signs.'} | ${'a pound sign is a mark'}
    ${'Bake 1 pound cake'}          | ${'a pound cake is a cake'}
    ${'the 40 yard line'}           | ${'a yard line is a name'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                | expected
    ${'a 3 mile hike'}   | ${'a 4.8 kilometre hike'}
    ${'3 miles of road'} | ${'4.8 kilometres of road'}
  `('$input -> $expected', ({ input, expected }) => {
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
    input                           | span
    ${'We passed 3 mile markers.'}  | ${'3 mile markers'}
    ${'the 26 mile marker'}         | ${'26 mile marker'}
    ${'We put up 3 yard signs.'}    | ${'3 yard signs'}
    ${'Press the two pound signs.'} | ${'two pound signs'}
  `('holds $span whole, even with respectConventions off', ({ input, span }) => {
    expect(held(input)).toEqual([span]);
    expect(held(input, { units: { respectConventions: false } })).toEqual([span]);
  });

  it('converts a hyphenated mile marker with respectConventions off', () => {
    expect(convert('the 26-mile marker', { units: { respectConventions: false } })).toBe(
      'the 42 kilometre marker',
    );
  });
});

describe('a compound noun that starts with a unit is held to its end', () => {
  const southAfrican = { preset: 'localise', dialect: 'en-ZA' } as const;

  it.each`
    unchanged                                         | why
    ${'We counted 6 foot traffic lights.'}            | ${'a number in digits'}
    ${'We counted six foot traffic lights.'}          | ${'a number in words'}
    ${'We counted 6 to 8 foot traffic lights.'}       | ${'a range'}
    ${'We counted 2, 4 or 6 foot traffic lights.'}    | ${'a list'}
    ${'We counted 2 x 4 foot traffic lights.'}        | ${'a dimension'}
    ${'Bake 1 pound cake'}                            | ${'a pound cake'}
    ${'In 5 yard sales we sold it.'}                  | ${'a yard sale'}
  `('leaves "$unchanged" alone on both runs, so no rule rewrites part of the noun ($why)', ({ unchanged }) => {
    const once = deamericaniseText(unchanged, southAfrican);
    expect(once).toBe(unchanged);
    expect(deamericaniseText(once, southAfrican)).toBe(unchanged);
  });

  it('leaves the compound in a comment alone on both runs', () => {
    const source = '// We counted 6 foot traffic lights.\nconst a = 1;\n';
    const options = { language: 'ts', ...southAfrican } as const;
    const once = deamericaniseCode(source, options).text;
    expect(once).toBe(source);
    expect(deamericaniseCode(once, options).text).toBe(source);
  });

  it.each`
    input                             | options         | expected
    ${'The traffic lights were out.'} | ${southAfrican} | ${'The robots were out.'}
    ${'a 2-pound cake'}               | ${{}}           | ${'a 910 gram cake'}
  `('$input -> $expected', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
  });
});

describe('a capitalised unit word that is part of a name', () => {
  it.each`
    unchanged                                         | why
    ${'Track 7 Miles Davis'}                          | ${'a first name'}
    ${'Album: 1959 Miles Davis'}                      | ${'after a year'}
    ${'From 1955 to 1959 Miles Davis led a quintet.'} | ${'after a range'}
    ${'Track 7\nMiles Davis'}                         | ${'across a line that wraps'}
    ${'the 1972 Pound Ridge fire'}                    | ${'a place'}
    ${'a 1983 Foot Locker ad'}                        | ${'a shop'}
    ${'Track 3 Gallon Drunk'}                         | ${'a band'}
    ${'It is 10 Miles to Town'}                       | ${'title case, across a small word'}
    ${'A Mile and a Half From Home'}                  | ${'title case around a fraction'}
    ${'The 10 x 12 Feet Room'}                        | ${'title case after a dimension'}
    ${'Watch The Green Mile and 8 Mile.'}             | ${'a singular after a count above one, ending a title'}
    ${'I watched 8 Mile last night.'}                 | ${'the same, before words in lower case'}
    ${'Walk 8 Miles to Town'}                         | ${'title case'}
    ${'A 10 Mile Run'}                                | ${'title case in a heading'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, { assumeAmerican: true })).toBe(unchanged);
  });

  it.each`
    input                                | expected                                    | why
    ${'10 miles North of town'}          | ${'16 kilometres North of town'}            | ${'a unit word in lower case'}
    ${'Walk 10 Miles'}                   | ${'Walk 16 kilometres'}                     | ${'no capitalised word after it'}
    ${'He walked 10 Miles to the shop.'} | ${'He walked 16 kilometres to the shop.'}   | ${'small words, then one in lower case'}
    ${'Walk 1 Mile'}                     | ${'Walk 1.6 kilometres'}                    | ${'a singular after one'}
    ${'an 8 mile hike'}                  | ${'a 13 kilometre hike'}                    | ${'a singular in lower case describing a noun'}
    ${'It was 8 miles away.'}            | ${'It was 13 kilometres away.'}             | ${'a plural in lower case'}
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
    input                                             | span
    ${'Track 7 Miles Davis'}                          | ${'7 Miles'}
    ${'From 1955 to 1959 Miles Davis led a quintet.'} | ${'1955 to 1959 Miles'}
    ${'A Mile and a Half From Home'}                  | ${'A Mile and a Half'}
    ${'The 10 x 12 Feet Room'}                        | ${'10 x 12 Feet'}
    ${'I watched 8 Mile last night.'}                 | ${'8 Mile'}
    ${'A Boeing 747 mph record.'}                     | ${'Boeing 747 mph'}
    ${'Route 66 miles from here.'}                    | ${'Route 66 miles'}
    ${'The Model 3 mpg equivalent.'}                  | ${'Model 3 mpg'}
  `('holds $span whole, even with respectConventions off', ({ input, span }) => {
    expect(held(input)).toContain(span);
    expect(held(input, { units: { respectConventions: false } })).toContain(span);
  });
});

describe('a number after a name is part of it', () => {
  it.each`
    unchanged                                  | why
    ${'A Boeing 747 mph record.'}              | ${'a model after a capitalised word, before an abbreviation'}
    ${'The Model 3 mpg equivalent.'}           | ${'a word that takes a designation'}
    ${'Python 3.12 ft. new syntax.'}           | ${'a version before a credit'}
    ${'Route 66 miles from here.'}             | ${'a designation before a unit word'}
    ${'Ford F-150 mpg'}                        | ${'a hyphenated model'}
    ${'The new track ft. Drake drops Friday.'} | ${'a credit with no number'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
    expect(convert(unchanged, { assumeAmerican: true })).toBe(unchanged);
  });

  it.each`
    input                              | expected                                  | why
    ${'The pipe is 3 ft. long.'}       | ${'The pipe is 91 cm long.'}              | ${'a word in lower case before the number'}
    ${'The 2026 F-150 gets 20 mpg.'}   | ${'The 2026 F-150 gets 12 L/100km.'}      | ${'a verb between the name and the number'}
    ${'It was 8 miles away.'}          | ${'It was 13 kilometres away.'}           | ${'a unit word after a word in lower case'}
    ${'Version 2 weighs 3 pounds.'}    | ${'Version 2 weighs 1.4 kilograms.'}      | ${'a quantity after the designation'}
    ${'About 5 mph.'}                  | ${'About 8 km/h.'}                        | ${'a capitalised word that opens the sentence'}
    ${'It rose. About 5 mph.'}         | ${'It rose. About 8 km/h.'}               | ${'the same, after a stop'}
    ${'About 3.12 ft. of snow fell.'}  | ${'About 95.1 cm of snow fell.'}          | ${'a decimal before a word that opens no noun'}
    ${'Season 2 pounds of pork.'}      | ${'Season 910 grams of pork.'}            | ${'a verb that opens a recipe step'}
    ${'On Monday 40 mph gusts hit the coast.'}   | ${'On Monday 64 km/h gusts hit the coast.'}   | ${'a day is no name'}
    ${'In March 40 mph winds are common.'}       | ${'In March 64 km/h winds are common.'}       | ${'nor is a month'}
    ${'Mount Everest 29,032 ft. is the summit.'} | ${'Mount Everest 8.849 km is the summit.'}    | ${'a figure grouped with a comma'}
    ${'Track 3 miles a day.'}                    | ${'Track 4.8 kilometres a day.'}              | ${'a verb that opens a sentence'}
    ${'Cut 2.25 ft. lengths of pipe.'}           | ${'Cut 68.6 cm lengths of pipe.'}             | ${'a plural in lower case after the feet'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(convert(input, { assumeAmerican: true })).toBe(expected);
  });

  it('holds the name with its number, so no rewrite of the name frees the number', () => {
    const input = 'The Paycheck 5 lb bonus';
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(input);
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

  it.each`
    input                                     | expected                                     | why
    ${'Buy two foot-long subs.'}              | ${'Buy two 30 centimetre long subs.'}        | ${'two subs a foot long each'}
    ${'three foot-long hot dogs'}             | ${'three 30 centimetre long hot dogs'}       | ${'an adjective before the noun'}
    ${'Cut two inch-thick steaks.'}           | ${'Cut two 2.5 centimetre thick steaks.'}    | ${'another unit and size'}
    ${'Buy one foot-long sub.'}               | ${'Buy one 30 centimetre long sub.'}         | ${'a count of one'}
    ${'the two foot-long subs'}               | ${'the two 30 centimetre long subs'}         | ${'after a determiner that takes a count'}
    ${'twenty-two mile-long queues'}          | ${'twenty-two 1.6 kilometre long queues'}    | ${'a count of two words'}
    ${'a hundred foot-long subs'}             | ${'a hundred 30 centimetre long subs'}       | ${'a multiplied count'}
    ${'two foot‑long subs'}                   | ${'two 30 centimetre long subs'}             | ${'a non-breaking hyphen'}
  `('reads a count spaced before a unit tied to its size as counting the noun: $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it.each`
    input                                     | expected                                        | why
    ${'a two foot-long sub'}                  | ${'a 61 centimetre long sub'}                   | ${'a determiner that takes one of the noun'}
    ${'two foot-long, three foot-wide boards'} | ${'61 centimetre long, 91 centimetre wide boards'} | ${'a list of sizes'}
    ${'two foot-long and three foot-wide boards'} | ${'61 centimetre long and 91 centimetre wide boards'} | ${'the same, joined by "and"'}
    ${'The sub is two foot-long.'}            | ${'The sub is 61 centimetres long.'}            | ${'no noun after the size'}
    ${'two and a half foot-long subs'}        | ${'76 centimetre long subs'}                    | ${'a fraction is no count'}
    ${'a two-foot-long sub'}                  | ${'a 61 centimetre long sub'}                   | ${'a count hyphenated to the unit is part of it'}
    ${'a 6-foot-tall fence'}                  | ${'a 1.8 metre tall fence'}                     | ${'the same, in digits'}
  `('reads the number before a unit tied to its size as the number of units: $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves "a foot-long sub" alone, with no number to read', () => {
    expect(convert('a foot-long sub')).toBe('a foot-long sub');
  });

  it.each`
    input                                          | expected                                              | why
    ${'Buy two to three foot-long subs.'}          | ${'Buy two to three 30 centimetre long subs.'}        | ${'joined by "to"'}
    ${'Buy two or three foot-long subs.'}          | ${'Buy two or three 30 centimetre long subs.'}        | ${'joined by "or"'}
    ${'Cut five to six inch-thick steaks.'}        | ${'Cut five to six 2.5 centimetre thick steaks.'}     | ${'another unit and size'}
    ${'Buy two, three or four foot-long subs.'}    | ${'Buy two, three or four 30 centimetre long subs.'}  | ${'a list'}
    ${'Buy two to three hundred foot-long subs.'}  | ${'Buy two to three hundred 30 centimetre long subs.'} | ${'a count that may mean 200, which stays as written'}
    ${'the two to three foot-long subs'}           | ${'the two to three 30 centimetre long subs'}         | ${'after a determiner that takes a count'}
  `('reads a range of counts spaced before a unit tied to its size as counting the noun: $input ($why)', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
  });

  it('leaves a range of counts before a unit tied to its size as written with the range rule off', () => {
    const unchanged = 'Buy two to three foot-long subs.';
    expect(convert(unchanged, { rules: { 'units.range': false } })).toBe(unchanged);
  });

  it.each`
    input                                       | expected                                       | why
    ${'a two to three foot-long gap'}           | ${'a 61 to 91 centimetre long gap'}            | ${'a determiner that takes one of the noun'}
    ${'a foot-long, three to four foot-wide board'} | ${'a foot-long, 0.91 to 1.2 metre wide board'} | ${'a list of sizes'}
    ${'Buy 2 to 3 foot-long subs.'}             | ${'Buy 61 to 91 centimetre long subs.'}        | ${'counts in digits'}
    ${'5-6 inch pans'}                          | ${'13-15 centimetre pans'}                     | ${'no hyphen after the unit'}
    ${'two to three feet long'}                 | ${'61 to 91 centimetres long'}                 | ${'no hyphen ties the unit to its size'}
  `('reads a range before a unit as the number of units: $input ($why)', ({ input, expected }) => {
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
