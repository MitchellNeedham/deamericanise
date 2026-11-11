import { describe, expect, it } from 'vitest';
import { deamericanise, deamericaniseText } from '../src/index.js';
import type { Change } from '../src/index.js';
import { resolveChanges } from '../src/engine/apply.js';
import { MEASURES } from '../src/rules/units/definitions.js';
import { NUMERIC_PATTERN } from '../src/rules/units/number.js';

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

describe('an imperial original in brackets after its metric value', () => {
  it.each`
    unchanged                                                  | why
    ${'It is 1.8 metres (6 feet) tall.'}                       | ${'what keepOriginal writes'}
    ${'It is 1.8 meters (6 ft) tall.'}                         | ${'any spelling or symbol'}
    ${'It is 1.88 metres (6 feet 2 inches) tall.'}             | ${'feet and inches'}
    ${`It is 1.88 m (6'2") tall.`}                             | ${'feet and inches in symbols'}
    ${'It is 1.8 m (5 ft 11 in) tall.'}                        | ${'abbreviated'}
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
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(convert(unchanged)).toBe(unchanged);
  });

  it.each`
    input                                                     | expected                                                   | why
    ${'It weighs 2 metres (6 pounds).'}                       | ${'It weighs 2 metres (2.7 kilograms).'}                   | ${'a different dimension restates nothing'}
    ${'The rope is 2 metres long (the old one was 10 feet).'} | ${'The rope is 2 metres long (the old one was 3 metres).'} | ${'the bracket does not follow the metric value'}
    ${'It is 2 metres (the old one was 10 feet).'}            | ${'It is 2 metres (the old one was 3 metres).'}            | ${'the bracket holds more than a measurement'}
    ${'It is 2 metres (10 feet for the old one).'}            | ${'It is 2 metres (3 metres for the old one).'}            | ${'the same'}
    ${'Room 2 (6 feet) is free.'}                             | ${'Room 2 (1.8 metres) is free.'}                          | ${'a number without a metric unit'}
    ${'a 3 m (50 lb 3 oz) beam'}                              | ${'a 3 m (23 kg 85 g) beam'}                               | ${'every piece of a weight converts after a length'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
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

describe('an attributive singular needs a determiner', () => {
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
