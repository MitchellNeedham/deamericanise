import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

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
    ${'2 cups'}          | ${'470 millilitres'}
    ${'1 quart'}         | ${'950 millilitres'}
    ${'8 fluid ounces'}  | ${'240 millilitres'}
    ${'1 tablespoon'}    | ${'15 millilitres'}
    ${'2 teaspoons'}     | ${'9.9 millilitres'}
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
    ${'1 1/2 cups'}        | ${'350 millilitres'}
    ${'2½ inches'}         | ${'6.4 centimetres'}
    ${'5-10 feet'}         | ${'1.5-3 metres'}
    ${'5 to 10 miles'}     | ${'8 to 16 kilometres'}
    ${'between 5 and 10 miles'} | ${'between 8 and 16 kilometres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(convert(input)).toBe(expected);
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
    unchanged            | why
    ${'6 in total'}      | ${'"in" here is the preposition'}
    ${'sections 3 to 5'} | ${'no unit at all'}
    ${'version 1.5'}     | ${'not a measurement'}
    ${'12pt font'}       | ${'pt is points, not pints'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
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
