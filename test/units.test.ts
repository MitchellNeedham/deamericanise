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
