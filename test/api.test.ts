import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CONFIDENCES,
  analyse,
  deamericanise,
  deamericaniseText,
  ruleIds,
} from '../src/index.js';
import type { Category, Change } from '../src/index.js';
import { articleAgreements } from '../src/engine/articles.js';

describe('case is carried across', () => {
  it.each`
    input                | expected
    ${'color'}           | ${'colour'}
    ${'Color'}           | ${'Colour'}
    ${'COLOR'}           | ${'COLOUR'}
    ${'Organized'}       | ${'Organised'}
    ${'ORGANIZED'}       | ${'ORGANISED'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(deamericaniseText(input)).toBe(expected);
  });

  it.each`
    input                | expected
    ${'Gasoline'}        | ${'Petrol'}
    ${'GASOLINE'}        | ${'PETROL'}
    ${'Movie Theater'}   | ${'Cinema'}
    ${'MOVIE THEATER'}   | ${'CINEMA'}
    ${'Gas Station'}     | ${'Petrol Station'}
    ${'gas station'}     | ${'petrol station'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });
});

describe('articles follow the replacement', () => {
  it.each`
    input                | expected               | why
    ${'an eraser'}       | ${'a rubber'}          | ${'vowel to consonant'}
    ${'a elevator'}      | ${'a lift'}            | ${'left alone, it was already wrong'}
    ${'an elevator'}     | ${'a lift'}            | ${'vowel to consonant'}
    ${'an apartment'}    | ${'an apartment'}      | ${'unchanged in en-AU'}
    ${'a popsicle'}      | ${'an icy pole'}       | ${'consonant to vowel'}
    ${'An eraser'}       | ${'A rubber'}          | ${'capitalisation carried across'}
    ${'A popsicle'}      | ${'An icy pole'}       | ${'a lone capital A'}
    ${'A POPSICLE'}      | ${'AN ICY POLE'}       | ${'a lone A in text in capitals'}
    ${'AN ERASER'}       | ${'A RUBBER'}          | ${'text in capitals'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });

  it('records which replacement the article fix agrees with', () => {
    const [article, word] = deamericanise('Use an eraser.', { preset: 'localise' }).changes;
    expect(word).toMatchObject({ before: 'eraser', start: 7, end: 13 });
    expect(article).toMatchObject({ before: 'an', after: 'a', agreesWith: { start: 7, end: 13 } });
  });

  it('links nothing else', () => {
    const { changes } = deamericanise('Use an eraser on the gray sidewalk.', { preset: 'localise' });
    expect(changes.filter((c) => c.agreesWith).map((c) => c.before)).toEqual(['an']);
  });
});

describe('a capital A that is a label', () => {
  const localise = { preset: 'localise' } as const;
  const gb = { preset: 'localise', dialect: 'en-GB' } as const;

  it.each`
    input                       | options     | expected                     | why
    ${'a Grade A eggplant'}     | ${gb}       | ${'a Grade A aubergine'}     | ${'a grade'}
    ${'Plan A popsicle'}        | ${gb}       | ${'Plan A ice lolly'}        | ${'a plan at the start of the text'}
    ${'the type A eggplant'}    | ${gb}       | ${'the type A aubergine'}    | ${'after a lowercase word'}
    ${'Bring A cooler'}         | ${localise} | ${'Bring A esky'}            | ${'a capital where none is expected'}
    ${'Hall A 60 foot ceiling'} | ${{}}       | ${'Hall A 18 metre ceiling'} | ${'before a converted measurement'}
  `('is left alone: $input -> $expected ($why)', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
  });

  it.each`
    input                                           | expected                                         | why
    ${'A popsicle melted.'}                         | ${'An icy pole melted.'}                         | ${'the start of the text'}
    ${'It melted. A popsicle is cold.'}             | ${'It melted. An icy pole is cold.'}             | ${'after a sentence end'}
    ${'(It melted.) A popsicle is cold.'}           | ${'(It melted.) An icy pole is cold.'}           | ${'after a stop and a closing bracket'}
    ${'Wait… A popsicle'}                           | ${'Wait… An icy pole'}                           | ${'after an ellipsis'}
    ${'Note: A popsicle melts.'}                    | ${'Note: An icy pole melts.'}                    | ${'after a colon'}
    ${'She wrote "A popsicle melts" on the board.'} | ${'She wrote "An icy pole melts" on the board.'} | ${'after an opening quote'}
    ${'Dessert\nA popsicle'}                        | ${'Dessert\nAn icy pole'}                        | ${'the start of a line'}
    ${'- A popsicle'}                               | ${'- An icy pole'}                               | ${'after a list marker'}
    ${'# A popsicle'}                               | ${'# An icy pole'}                               | ${'after a heading marker'}
    ${'> A popsicle'}                               | ${'> An icy pole'}                               | ${'after a quote marker'}
    ${'| A popsicle |'}                             | ${'| An icy pole |'}                             | ${'a table cell'}
    ${'**A popsicle** melts.'}                      | ${'**An icy pole** melts.'}                      | ${'in emphasis at the start'}
    ${'Fix A Blinker'}                              | ${'Fix An Indicator'}                            | ${'title case'}
    ${'FIX A BLINKER'}                              | ${'FIX AN INDICATOR'}                            | ${'text in capitals'}
    ${'AN ERASER'}                                  | ${'A RUBBER'}                                    | ${'text in capitals with AN'}
    ${'Use an eraser.'}                             | ${'Use a rubber.'}                               | ${'a lower case article'}
  `('is the article where a capital is expected: $input -> $expected ($why)', ({ input, expected }) => {
    expect(deamericaniseText(input, localise)).toBe(expected);
  });

  it.each`
    input                      | expected                  | why
    ${'Use An eraser.'}        | ${'Use A rubber.'}        | ${'mid-sentence'}
    ${'Give An eraser to Bo.'} | ${'Give A rubber to Bo.'} | ${'mid-sentence before a name'}
    ${'Use An Eraser'}         | ${'Use A Rubber'}         | ${'title case'}
    ${'Use AN eraser.'}        | ${'Use A rubber.'}        | ${'in capitals'}
  `('is the article whenever it is An: $input -> $expected ($why)', ({ input, expected }) => {
    expect(deamericaniseText(input, localise)).toBe(expected);
  });

  it('is the article before a converted measurement at the start', () => {
    expect(deamericaniseText('an 8 foot fence')).toBe('a 2.4 metre fence');
    expect(deamericaniseText('A 60 foot tree fell.', { assumeAmerican: true })).toBe('An 18 metre tree fell.');
  });
});

describe('a blank line between an article and its word', () => {
  const localise = { preset: 'localise' } as const;

  it.each`
    input                             | options     | expected                             | why
    ${'Use an\n\neraser here.'}       | ${localise} | ${'Use an\n\nrubber here.'}          | ${'a blank line'}
    ${'It needs an\n\n8 foot fence.'} | ${{}}       | ${'It needs an\n\n2.4 metre fence.'} | ${'before a converted measurement'}
    ${'Use an\r\n\r\neraser here.'}   | ${localise} | ${'Use an\r\n\r\nrubber here.'}      | ${'Windows line endings'}
    ${'Use an\n  \neraser here.'}     | ${localise} | ${'Use an\n  \nrubber here.'}        | ${'a blank line of spaces'}
    ${'Use an \n\t\n eraser here.'}   | ${localise} | ${'Use an \n\t\n rubber here.'}      | ${'spaces either side of the lines'}
  `('ends the agreement: $why', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
  });

  it.each`
    input                        | options     | expected
    ${'Use an\neraser here.'}    | ${localise} | ${'Use a\nrubber here.'}
    ${'Use an\r\neraser here.'}  | ${localise} | ${'Use a\r\nrubber here.'}
    ${'Use an \n  eraser here.'} | ${localise} | ${'Use a \n  rubber here.'}
    ${'Use an eraser.'}          | ${localise} | ${'Use a rubber.'}
    ${'Build an 8 foot fence.'}  | ${{}}       | ${'Build a 2.4 metre fence.'}
  `('leaves a single line break in the paragraph: $input', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
  });
});

describe('a ute', () => {
  it.each`
    dialect    | expected
    ${'en-AU'} | ${'He drove a ute.'}
    ${'en-NZ'} | ${'He drove a ute.'}
  `('takes a in $dialect', ({ dialect, expected }) => {
    expect(deamericaniseText('He drove a pickup truck.', { preset: 'localise', dialect })).toBe(expected);
  });
});

describe('articles follow a replacement that starts with a number', () => {
  const american = { assumeAmerican: true };
  const clock = { assumeAmerican: true, times: { to24Hour: true } };
  const dmy = { assumeAmerican: true, dates: { format: 'dmy' as const } };
  const long = { assumeAmerican: true, dates: { reorderLongDates: true } };

  it.each`
    input                          | options     | expected                         | why
    ${'an 8 foot fence'}           | ${{}}       | ${'a 2.4 metre fence'}           | ${'eight to two'}
    ${'an 8 inch pan'}             | ${american} | ${'a 20 centimetre pan'}         | ${'eight to twenty'}
    ${'an eighth-inch gap'}        | ${american} | ${'a 3.2 millimetre gap'}        | ${'a fraction word to a figure'}
    ${'an 18 inch gap'}            | ${american} | ${'a 46 centimetre gap'}         | ${'eighteen to forty-six'}
    ${'a 60 foot tree'}            | ${american} | ${'an 18 metre tree'}            | ${'sixty to eighteen'}
    ${'a 7 mile run'}              | ${american} | ${'an 11 kilometre run'}         | ${'seven to eleven'}
    ${'a 50 mile trip'}            | ${american} | ${'an 80 kilometre trip'}        | ${'fifty to eighty'}
    ${'a 500 mile trip'}           | ${american} | ${'an 800 kilometre trip'}       | ${'five hundred to eight hundred'}
    ${'a 28 foot boat'}            | ${american} | ${'an 8.5 metre boat'}           | ${'a decimal is read from its whole part'}
    ${'a 2,900 gallon tank'}       | ${american} | ${'an 11,000 litre tank'}        | ${'eleven thousand'}
    ${'a 480 gallon tank'}         | ${american} | ${'a 1800 litre tank'}           | ${'one thousand or eighteen hundred, so left'}
    ${'an 480 gallon tank'}        | ${american} | ${'an 1800 litre tank'}          | ${'the same the other way'}
    ${'a 20°F drop'}               | ${american} | ${'an 11°C drop'}                | ${'a temperature difference'}
    ${'an 80°F day'}               | ${american} | ${'a 26.7°C day'}                | ${'a temperature'}
    ${'an 8°F night'}              | ${american} | ${'a -13.3°C night'}             | ${'minus'}
    ${'a dime-sized dent'}         | ${american} | ${'an 18 mm dent'}               | ${'a coin size'}
    ${'a 15 inch laptop'}          | ${american} | ${'a 15 inch laptop'}            | ${'a conventional size is left alone'}
    ${'a 6 foot fence'}            | ${american} | ${'a 1.8 metre fence'}           | ${'one point eight'}
    ${'A 60 foot tree fell.'}      | ${american} | ${'An 18 metre tree fell.'}      | ${'a capital article'}
    ${'an 8 P.M. meeting'}         | ${clock}    | ${'a 20:00 meeting'}             | ${'twenty hundred'}
    ${'a 6 P.M. meeting'}          | ${clock}    | ${'an 18:00 meeting'}            | ${'eighteen hundred'}
    ${'a 5 A.M. start'}            | ${clock}    | ${'a 05:00 start'}               | ${'oh five or five, so left'}
    ${'a 11 A.M. start'}           | ${american} | ${'an 11am start'}               | ${'the 12-hour clock'}
    ${'an 8/14/2024 deadline'}     | ${american} | ${'a 2024-08-14 deadline'}       | ${'twenty twenty-four'}
    ${'a 3/14/1812 letter'}        | ${american} | ${'an 1812-03-14 letter'}        | ${'a year is said in pairs'}
    ${'a 3/8/2024 deadline'}       | ${dmy}      | ${'an 08/03/2024 deadline'}      | ${'eighth'}
    ${'a March 11th deadline'}     | ${long}     | ${'an 11 March deadline'}        | ${'eleven'}
    ${'an April 1st deadline'}     | ${long}     | ${'a 1 April deadline'}          | ${'one'}
    ${'a $5 note'}                 | ${american} | ${'a US$5 note'}                 | ${'the amount is said before the currency'}
    ${'an $8 fee'}                 | ${american} | ${'an US$8 fee'}                 | ${'the same with eight'}
    ${'a $1.8 million deal'}       | ${american} | ${'a US$1.8 million deal'}       | ${'one point eight million'}
  `('$input -> $expected ($why)', ({ input, options, expected }) => {
    expect(deamericaniseText(input, options)).toBe(expected);
  });

  it('records which measurement the article fix agrees with', () => {
    const [article, measurement] = deamericanise('Build an 8 foot fence.').changes;
    expect(measurement).toMatchObject({ before: '8 foot', after: '2.4 metre', start: 9, end: 15 });
    expect(article).toMatchObject({ before: 'an', after: 'a', agreesWith: { start: 9, end: 15 } });
  });

  /** The article `after` takes, or `either` when neither is changed. */
  function articleFor(after: string, category: Category): string {
    const kept = ['a', 'an'].filter((article) => {
      const text = `${article} ${after}`;
      const change: Change = {
        start: article.length + 1,
        end: text.length,
        before: after,
        after,
        ruleId: 'test',
        category,
        confidence: 'safe',
      };
      return articleAgreements(text, [change]).length === 0;
    });
    return kept.length === 1 ? kept[0]! : 'either';
  }

  it.each`
    after                | category      | article
    ${'8 metre'}         | ${'units'}    | ${'an'}
    ${'80 metre'}        | ${'units'}    | ${'an'}
    ${'800 metre'}       | ${'units'}    | ${'an'}
    ${'8.5 metre'}       | ${'units'}    | ${'an'}
    ${'8000 tonne'}      | ${'units'}    | ${'an'}
    ${'11 metre'}        | ${'units'}    | ${'an'}
    ${'18 metre'}        | ${'units'}    | ${'an'}
    ${'11,000 litre'}    | ${'units'}    | ${'an'}
    ${'18,500 litre'}    | ${'units'}    | ${'an'}
    ${'1 metre'}         | ${'units'}    | ${'a'}
    ${'1.8 metre'}       | ${'units'}    | ${'a'}
    ${'100 metre'}       | ${'units'}    | ${'a'}
    ${'180 metre'}       | ${'units'}    | ${'a'}
    ${'110,000 litre'}   | ${'units'}    | ${'a'}
    ${'1,800,000 litre'} | ${'units'}    | ${'a'}
    ${'0.8 metre'}       | ${'units'}    | ${'a'}
    ${'.8 metre'}        | ${'units'}    | ${'a'}
    ${'-8°C'}            | ${'units'}    | ${'a'}
    ${'1100 litre'}      | ${'units'}    | ${'either'}
    ${'1,850 litre'}     | ${'units'}    | ${'either'}
    ${'8pm'}             | ${'times'}    | ${'an'}
    ${'11:30am'}         | ${'times'}    | ${'an'}
    ${'12pm'}            | ${'times'}    | ${'a'}
    ${'18:00'}           | ${'times'}    | ${'an'}
    ${'20:00'}           | ${'times'}    | ${'a'}
    ${'08:00'}           | ${'times'}    | ${'an'}
    ${'05:00'}           | ${'times'}    | ${'either'}
    ${'00:30'}           | ${'times'}    | ${'either'}
    ${'08/03/2024'}      | ${'dates'}    | ${'an'}
    ${'05/03/2024'}      | ${'dates'}    | ${'a'}
    ${'18 March'}        | ${'dates'}    | ${'an'}
    ${'1812-03-14'}      | ${'dates'}    | ${'an'}
    ${'1100-03-14'}      | ${'dates'}    | ${'an'}
    ${'1999-03-14'}      | ${'dates'}    | ${'a'}
    ${'2008-03-14'}      | ${'dates'}    | ${'a'}
    ${'US$8'}            | ${'currency'} | ${'an'}
    ${'US$5'}            | ${'currency'} | ${'a'}
    ${'US$18 million'}   | ${'currency'} | ${'an'}
    ${'8 US dollars'}    | ${'currency'} | ${'an'}
    ${'A4'}              | ${'misc'}     | ${'an'}
  `('$after ($category) takes $article', ({ after, category, article }) => {
    expect(articleFor(after, category)).toBe(article);
  });

  it.each`
    after        | article
    ${'ute'}     | ${'a'}
    ${'utes'}    | ${'a'}
    ${'Ute'}     | ${'a'}
    ${'utensil'} | ${'an'}
    ${'uterine'} | ${'an'}
    ${'utter'}   | ${'an'}
  `('$after (vocabulary) takes $article', ({ after, article }) => {
    expect(articleFor(after, 'vocabulary')).toBe(article);
  });
});

describe('the change list', () => {
  const source = 'The color of the theater was gray.';
  const result = deamericanise(source);

  it('reports one change per rewrite', () => {
    expect(result.changes.map((c) => [c.before, c.after])).toEqual([
      ['color', 'colour'],
      ['theater', 'theatre'],
      ['gray', 'grey'],
    ]);
  });

  it('gives offsets that slice back to the original', () => {
    for (const change of result.changes) {
      expect(source.slice(change.start, change.end)).toBe(change.before);
    }
  });

  it('returns them in document order', () => {
    const starts = result.changes.map((c) => c.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('tags every change with a rule, a category and a confidence', () => {
    for (const change of result.changes) {
      expect(change.ruleId.length).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(change.category);
      expect(CONFIDENCES).toContain(change.confidence);
    }
  });
});

describe('running twice changes nothing the second time', () => {
  it.each`
    input
    ${'The color of the theater center was gray.'}
    ${'He is 6 feet 2 inches tall and weighs 180 pounds.'}
    ${'Bake at 350°F on 3/14/2024 at 3:00 PM.'}
    ${'I bought gasoline at the gas station near the sidewalk.'}
    ${'They canceled the traveled program and organized a defense.'}
  `('is stable for $input', ({ input }) => {
    const once = deamericaniseText(input);
    expect(deamericaniseText(once)).toBe(once);
  });

  it.each`
    input
    ${'He is 6 feet 2 inches tall and weighs 180 pounds.'}
    ${'Bake at 350°F on 3/14/2024 at 3:00 PM.'}
  `('is stable for $input with keepOriginal', ({ input }) => {
    const options = { units: { keepOriginal: true } };
    const once = deamericaniseText(input, options);
    expect(deamericaniseText(once, options)).toBe(once);
  });
});

describe('categories and confidence tiers', () => {
  const source = 'The color of the flat tire is gray, 6 feet from the sidewalk on 3/14/2024.';
  const all = { preset: 'localise' } as const;

  it.each`
    category          | present         | absent
    ${'spelling'}     | ${'colour'}     | ${'color'}
    ${'vocabulary'}   | ${'footpath'}   | ${'sidewalk'}
    ${'units'}        | ${'1.8 metres'} | ${'6 feet'}
    ${'dates'}        | ${'2024-03-14'} | ${'3/14/2024'}
  `('$category on produces $present, off leaves $absent', ({ category, present, absent }) => {
    expect(deamericaniseText(source, all)).toContain(present);
    const off: Partial<Record<Category, boolean>> = { [category as Category]: false };
    expect(deamericaniseText(source, { ...all, categories: off })).toContain(absent);
  });

  it.each`
    tiers                    | expected
    ${['safe']}              | ${'The colour of the flat tire is gray, 6 feet from the sidewalk on 3/14/2024.'}
    ${['safe', 'moderate']}  | ${'The colour of the flat tire is grey, 1.8 metres from the footpath on 2024-03-14.'}
  `('with tiers $tiers the result is $expected', ({ tiers, expected }) => {
    expect(deamericaniseText(source, { ...all, confidence: tiers })).toBe(expected);
  });
});

describe('rule ids', () => {
  it('lists a stable, sorted set', () => {
    const ids = ruleIds();
    expect(ids.length).toBeGreaterThan(20);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toContain('spelling.our');
    expect(ids).toContain('units.length.mile');
  });
});

describe('analyse', () => {
  it.each`
    input                                                        | american
    ${'The color of the theater is gray and they canceled it.'}  | ${true}
    ${'The colour of the theatre is grey.'}                      | ${false}
    ${'A neutral sentence about nothing in particular.'}         | ${false}
  `('rates "$input" as american=$american', ({ input, american }) => {
    expect(analyse(input).confidence >= 0.5).toBe(american);
  });

  it('names the markers it found', () => {
    expect(analyse('the color and the theater').markers).toEqual(['-or spelling', '-er spelling']);
  });

  it('counts dates that pin their own order', () => {
    const signals = analyse('due 3/14/2024 and 25/12/2023');
    expect(signals.unambiguousMonthFirstDates).toBe(1);
    expect(signals.unambiguousDayFirstDates).toBe(1);
  });
});

describe('the Fahrenheit marker', () => {
  const FAHRENHEIT = 'Fahrenheit';

  /** A Fahrenheit value that only restates the Celsius value before it, which the rules leave alone. */
  const RESTATED = [
    'Bake at 175°C (350°F).',
    'Bake at 175°C (350 degrees Fahrenheit).',
    'Bake at 175 Celsius (350 Fahrenheit).',
    'Preheat the oven to 180°C/350°F.',
    'Heat to 180°C or 350°F.',
    'It was 11°C (20°F) warmer.',
    'It rose 11°C or 20°F.',
  ];

  const READ = [
    'Cook until the chicken reaches 165°F.',
    'Cook until the chicken reaches 165 degrees F.',
    'Cook until the chicken reaches 165F.',
    'Bake at 350 F for 20 minutes.',
    'Bake at 350 deg F.',
    'Bake at 350 deg. F.',
    'It was 70℉ outside.',
    'A fever of 102.5F needs a doctor.',
    'Bake at 350-375F.',
    'It was 72 degrees Fahrenheit.',
    'Bake at 350ºF.',
    'Bake at 350˚F.',
    'It was 95 Fahrenheit.',
    'Bake at 350°F (175°C).',
    'Heat to 180°C or 400°F.',
  ];

  const NOT_READ = [
    'Apartment 3F',
    'Apartment 3F has no heat.',
    'The heating on floor 5F is broken.',
    'I sat in seat 23F.',
    'The Boeing 777F carries 102 tonnes.',
    'Ford recalled the 2024 F-150 after heat damage.',
    'The heat map uses #1F1F1F and #33F.',
    'Mask the byte with 0x1F before heating.',
    'Sketch with a 2F pencil.',
    'Bake part B4F.',
    '// 3F ends the header before the oven data',
    'The A330-200F flies in hot weather.',
    'Scale it by 100f before baking.',
    'Preheat the oven to 180C/350F/gas 4.',
    'Heat the oven to 180C fan or to 400F.',
    'I read Fahrenheit 451 at school.',
    'The film Fahrenheit 9/11 opened in 2004.',
    'They filmed the 1966 Fahrenheit 451 in England.',
    ...RESTATED,
  ];

  it.each(READ)('finds Fahrenheit in "%s"', (input) => {
    expect(analyse(input).markers).toContain(FAHRENHEIT);
  });

  it.each(NOT_READ)('finds no Fahrenheit in "%s"', (input) => {
    expect(analyse(input).markers).not.toContain(FAHRENHEIT);
  });

  it.each(RESTATED)('gives no American evidence for the courtesy figure in "%s"', (input) => {
    expect(analyse(input).markers).toEqual([]);
  });

  it('still counts a converted temperature beside a courtesy figure', () => {
    expect(analyse('Bake at 175°C (350°F). Cook the chicken to 165°F.').markers).toEqual([FAHRENHEIT]);
  });

  it.each([
    'Set the thermostat in Fahrenheit.',
    'The Fahrenheit scale puts water at 32 when it freezes.',
    'Temperatures are in Fahrenheit: 72 is comfortable.',
    'Temperatures in Fahrenheit\n2. Warm the milk.',
    '## Temperatures in Fahrenheit\n\n1. Warm the milk.',
  ])('still counts the scale named on its own in %j', (input) => {
    expect(analyse(input).markers).toContain(FAHRENHEIT);
  });

  it.each([
    'I read Fahrenheit 451 at school.',
    'FAHRENHEIT 451 by Ray Bradbury',
    'We watched Fahrenheit 9/11.',
    'I read Fahrenheit\n451 at school.',
  ])('does not count the title in %j', (input) => {
    expect(analyse(input).markers).toEqual([]);
  });

  it('still counts a protected place name beside the title', () => {
    expect(analyse('I read Fahrenheit 451 on the way to Pearl Harbor.').markers).toEqual(['US spellings of places']);
  });

  it('keeps a British date British in a review of the novel', () => {
    const text = 'We organized a screening of Fahrenheit 451 in color with Mr. Jones on 03/04/2024.';
    expect(analyse(text).confidence).toBeCloseTo(0.45);
    expect(deamericaniseText(text)).toBe(
      'We organised a screening of Fahrenheit 451 in colour with Mr. Jones on 03/04/2024.',
    );
  });

  it.each([...READ, ...NOT_READ])('agrees with the temperature rule on "%s"', (input) => {
    const converted = deamericanise(input).changes.some((c) => c.ruleId.startsWith('units.temperature.'));
    expect(analyse(input).markers.includes(FAHRENHEIT)).toBe(converted);
  });

  it('lets a bare F count towards the verdict', () => {
    const recipe = 'Melt 1 stick of butter in a gray pan, cook the chicken to 165F, and spend $5 on it.';
    expect(deamericaniseText(recipe)).toBe(
      'Melt 1 stick of butter in a grey pan, cook the chicken to 73.9°C, and spend US$5 on it.',
    );
  });
});

describe('the imperial units marker', () => {
  const IMPERIAL = 'imperial units';

  const MEASURED = [
    'Brown 2 pounds of ground beef.',
    'It weighs 5 pounds.',
    'The crate weighs 1,500 pounds.',
    'It cost £5 and weighed 3 pounds.',
    'It cost $20 for 5 pounds of beef.',
    'It cost 400 pounds and weighed 3 pounds.',
    'Walk 5 miles.',
    'Add 3 gallons of water.',
    'Bake a 2-pound cake.',
  ];

  const NOUNS = ['Bake 1 pound cake.', 'Send in 6 foot soldiers.', 'Count 8 inch worms.'];

  const NAMES = ['Track 7 Miles Davis', 'From 1955 to 1959 Miles Davis led a quintet.'];

  const MONEY = [
    'The apartment cost 400 pounds a week.',
    'He paid a fine of 200 pounds.',
    'It came to 5 pounds 50.',
    'She earns 30,000 pounds a year.',
    'It cost 1,500 pounds.',
    'It cost 2.50 pounds.',
    'Tickets cost 500-600 pounds.',
    'It cost between 500 and 600 pounds.',
    'It cost two and a half pounds.',
    'It cost five pounds.',
    'I found a 5-pound note.',
  ];

  it.each(MEASURED)('counts "%s"', (input) => {
    expect(analyse(input).markers).toContain(IMPERIAL);
  });

  it.each(MONEY)('does not count the money in "%s"', (input) => {
    expect(analyse(input).markers).not.toContain(IMPERIAL);
  });

  it.each(NOUNS)('does not count the noun in "%s"', (input) => {
    expect(analyse(input).markers).not.toContain(IMPERIAL);
  });

  it.each(NAMES)('does not count the name in "%s"', (input) => {
    expect(analyse(input).markers).not.toContain(IMPERIAL);
  });

  it.each([...MEASURED, ...MONEY, ...NOUNS, ...NAMES])('agrees with the unit rules on "%s"', (input) => {
    const converted = deamericanise(input).changes.some((c) => c.category === 'units');
    expect(analyse(input).markers.includes(IMPERIAL)).toBe(converted);
  });

  it('keeps a British date British beside pounds of money', () => {
    const text = 'The apartment cost 400 pounds a week. We organized it through Mr. Jones and moved in on 03/04/2024.';
    expect(analyse(text).confidence).toBeCloseTo(0.45);
    expect(deamericaniseText(text)).toBe(
      'The apartment cost 400 pounds a week. We organised it through Mr. Jones and moved in on 03/04/2024.',
    );
  });

  it('still lets pounds of weight count towards the verdict', () => {
    const text = 'The apartment needed 400 pounds of sand. We organized it through Mr. Jones and moved in on 03/04/2024.';
    expect(deamericaniseText(text)).toBe(
      'The apartment needed 180 kilograms of sand. We organised it through Mr. Jones and moved in on 2024-03-04.',
    );
  });

  it('leaves a text with no other American marker below the bar', () => {
    expect(analyse('Brown 2 pounds of ground beef.').confidence).toBeCloseTo(0.15);
  });
});

describe('analyse on recipes', () => {
  const OVEN = 'Fahrenheit oven setting';
  const STICK = 'stick of butter';
  const INGREDIENT = 'US ingredient names';

  it.each`
    input                                                 | marker
    ${'Preheat the oven to 350 degrees.'}                 | ${OVEN}
    ${'Heat oven to 425.'}                                | ${OVEN}
    ${'Set the oven to 400 degrees F.'}                   | ${OVEN}
    ${'Preheat the oven to 350°F.'}                       | ${OVEN}
    ${'Bake at 375 for 20 minutes.'}                      | ${OVEN}
    ${'Bake, uncovered, for 30 to 35 minutes at 350.'}    | ${OVEN}
    ${'Roast at 450 until golden.'}                       | ${OVEN}
    ${'Put the dish in a 350-degree oven.'}               | ${OVEN}
    ${'Bake in a 375° oven.'}                             | ${OVEN}
    ${'Bake in a 325 oven.'}                              | ${OVEN}
    ${'Bake at 350 and sell them at the bake sale.'}      | ${OVEN}
    ${'Grease a baking tin and bake at 350.'}             | ${OVEN}
    ${'Bake for 10 minutes, then reduce to 350.'}         | ${OVEN}
    ${'Roast for 20 minutes, then raise the heat to 450.'} | ${OVEN}
    ${'Preheat the oven until it gets to 350.'}           | ${OVEN}
    ${'Bake the risen loaf at 450 for 30 minutes.'}       | ${OVEN}
    ${'Bake for a total of 40 minutes at 350.'}           | ${OVEN}
    ${'Bake off the par-baked rolls at 400.'}             | ${OVEN}
    ${'Preheat the oven to 350 deg F.'}                   | ${OVEN}
    ${'Preheat the oven to 350℉.'}                        | ${OVEN}
    ${'Put the dish in a 350℉ oven.'}                     | ${OVEN}
    ${'Put the dish in a 350 deg F oven.'}                | ${OVEN}
    ${'Put the dish in a 350 degrees Fahrenheit oven.'}   | ${OVEN}
    ${'Put the dish in a 350F oven.'}                     | ${OVEN}
    ${'Bake at 350 till golden.'}                         | ${OVEN}
    ${'Bake at 350 til golden.'}                          | ${OVEN}
    ${'Preheat the oven to 350 before you start.'}        | ${OVEN}
    ${'Bake at 350 after the dough has risen.'}           | ${OVEN}
    ${'Bake at 350 about 20 minutes.'}                    | ${OVEN}
    ${'Bake at 350 approximately 20 minutes.'}            | ${OVEN}
    ${'Bake at 350 so the top browns.'}                   | ${OVEN}
    ${'Bake at 350 uncovered.'}                           | ${OVEN}
    ${'Bake at 350 covered.'}                             | ${OVEN}
    ${'Bake at 350 undisturbed.'}                         | ${OVEN}
    ${'Preheat oven to 350 - grease a pan.'}              | ${OVEN}
    ${'Preheat oven to 350 \u2013 grease a pan.'}         | ${OVEN}
    ${'Preheat oven to 350\u2014grease a pan.'}           | ${OVEN}
    ${'Bake at 350 20 to 25 minutes.'}                    | ${OVEN}
    ${'Roast at 400 1 hour.'}                             | ${OVEN}
    ${'Melt 1 stick of butter.'}                          | ${STICK}
    ${'2 sticks unsalted butter, softened'}               | ${STICK}
    ${'1/2 cup (1 stick) butter, melted'}                 | ${STICK}
    ${'1 stick (1/2 cup) cold butter'}                    | ${STICK}
    ${'1/2 cup butter (1 stick)'}                         | ${STICK}
    ${'Cut in half a stick of margarine.'}                | ${STICK}
    ${'1 cup all-purpose flour'}                          | ${INGREDIENT}
    ${'2 cups (250 g) all-purpose flour'}                 | ${INGREDIENT}
    ${"1 cup confectioners' sugar"}                       | ${INGREDIENT}
    ${'1/2 cup heavy cream'}                              | ${INGREDIENT}
    ${'2 tablespoons cornstarch'}                         | ${INGREDIENT}
  `('finds $marker in "$input"', ({ input, marker }) => {
    expect(analyse(input).markers).toContain(marker);
  });

  it.each`
    input                                                      | why
    ${'Preheat the oven to 180 degrees.'}                      | ${'a Celsius oven'}
    ${'Bake at 180 degrees for 20 minutes.'}                   | ${'a Celsius oven'}
    ${'Preheat the oven to 180°C (350°F).'}                    | ${'Fahrenheit given as a courtesy after Celsius'}
    ${'Preheat the oven to 180C/350F/gas 4.'}                  | ${'Fahrenheit given as a courtesy after Celsius'}
    ${'Heat the oven to 180C fan or to 400F.'}                 | ${'the setting is in Celsius first'}
    ${'Heat the oven to 350°C.'}                               | ${'marked Celsius, whatever the number'}
    ${'Heat the pizza oven to 400 degrees.'}                   | ${'pizza ovens run that hot in Celsius'}
    ${'Bake at 450 degrees in the wood-fired oven.'}           | ${'so do wood-fired ovens'}
    ${'A pyrolytic oven heats itself to 500 degrees.'}         | ${'and a cleaning cycle'}
    ${'Add the baking powder to 300 g of flour.'}              | ${'a weight, not a setting'}
    ${'Cook in the oven for up to 300 minutes.'}               | ${'a time, not a setting'}
    ${'The factory made 400 ovens a week.'}                    | ${'a count of ovens'}
    ${'Microwave oven at 500 watts.'}                          | ${'a power, not a temperature'}
    ${'The bake sale takings came to 320.'}                    | ${'a bake sale and its total'}
    ${'We set out to raise 500 at the bake sale and got to 450.'} | ${'a bake sale and its total'}
    ${'Sales of baked goods rose to 350 on Saturday.'}         | ${'baked goods and their sales'}
    ${'The bake-off had entries from 300 to 400.'}             | ${'a bake-off is a thing'}
    ${'Tins of baked beans went up to 350.'}                   | ${'baked beans are a thing'}
    ${'The shop sells baking tins in sizes up to 400.'}        | ${'a baking tin is a thing'}
    ${'The cakes we baked came to 320.'}                       | ${'the to belongs to came'}
    ${'Sales of ovens rose to 400.'}                           | ${'the to belongs to rose'}
    ${'We baked 200 cakes, which sold at 350.'}                | ${'the at belongs to sold'}
    ${'Baking supplies cost up to 400.'}                       | ${'the to belongs to cost'}
    ${'The bakers baked all day and raised the total to 400.'} | ${'the to belongs to raised'}
    ${'The bake sale takings came to 320 before noon.'}        | ${'the to belongs to came'}
    ${'Cook in the oven for up to 300 - 400 minutes.'}         | ${'a dash before a number joins a range'}
    ${'Heat the oven to 350 deg C.'}                           | ${'marked Celsius, whatever the number'}
  `('finds no oven setting in "$input" ($why)', ({ input }) => {
    expect(analyse(input).markers).not.toContain(OVEN);
  });

  it('keeps a British date British beside a bake sale total', () => {
    const text = 'The bake sale takings came to 320. We organized it through Mr. Jones on 03/04/2024.';
    expect(analyse(text).confidence).toBeCloseTo(0.3);
    expect(deamericaniseText(text)).toBe(
      'The bake sale takings came to 320. We organised it through Mr. Jones on 03/04/2024.',
    );
  });

  it.each`
    input                                     | why
    ${'Melt 125 g butter.'}                   | ${'butter by weight'}
    ${'2 sticks of celery and butter'}        | ${'a stick of something else'}
    ${'1 cinnamon stick'}                     | ${'a stick of something else'}
    ${'Stir with a stick, then add butter.'}  | ${'a stick that is not a pack size'}
  `('finds no stick of butter in "$input" ($why)', ({ input }) => {
    expect(analyse(input).markers).not.toContain(STICK);
  });

  it.each`
    input                                                 | why
    ${'1 cup flour'}                                      | ${'metric cups are Australian too'}
    ${'2 cups of flour'}                                  | ${'metric cups are Australian too'}
    ${'1 cup plain flour'}                                | ${'the Commonwealth name'}
    ${'1/2 cup caster sugar'}                             | ${'the Commonwealth name'}
    ${'1 1/2 cups (225g) plain flour (all-purpose flour)'} | ${'the US name given as a courtesy'}
    ${'1 cup all-purpose flour (plain flour)'}            | ${'the US name glossed with the local one'}
    ${'2 tbsp cornflour (cornstarch)'}                    | ${'the US name given as a courtesy'}
    ${'1 cup (250ml) thickened cream / heavy cream'}      | ${'the US name given as a courtesy'}
  `('finds no US ingredient name in "$input" ($why)', ({ input }) => {
    expect(analyse(input).markers).not.toContain(INGREDIENT);
  });

  it.each`
    recipe
    ${'Preheat the oven to 180 degrees. Sift 1 cup flour and 1/2 cup caster sugar into a bowl, rub in 125g butter, and bake at 180 degrees for 20 minutes.'}
    ${'Preheat the oven to 200C/180C fan/gas 6. Rub 100g cold butter into 225g self-raising flour, stir in 50g caster sugar and 150ml double cream, and bake for 15 minutes.'}
  `('gives a Commonwealth recipe no American evidence: $recipe', ({ recipe }) => {
    expect(analyse(recipe)).toMatchObject({ confidence: 0, markers: [] });
  });

  it('gives no recipe evidence to an Australian recipe that glosses the US names', () => {
    const recipe =
      'Preheat the oven to 180°C/350°F (160°C fan). Mix 1 1/2 cups (225g) plain flour (all-purpose flour), ' +
      '1 cup (250ml) thickened cream / heavy cream and 2 tbsp cornflour (cornstarch) with 125g butter.';
    expect(analyse(recipe).markers).toEqual([]);
  });

  it.each`
    input
    ${'Preheat the oven to 350 degrees. Mix 2 cups of flour with 1 stick of butter and bake for 20 minutes.'}
    ${'Preheat the oven to 350°F. Mix 2 cups of flour with 1 stick of butter and bake for 20 minutes.'}
  `('rates a short American recipe as American: $input', ({ input }) => {
    expect(analyse(input).confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('lets the rules that wait for the verdict run on a short American recipe', () => {
    const recipe = 'Tested 03/04/2024. Preheat the oven to 350 degrees, melt 1 stick of butter, and spend $5 on flour.';
    expect(deamericaniseText(recipe)).toBe(
      'Tested 2024-03-04. Preheat the oven to 350 degrees, melt 1 stick of butter, and spend US$5 on flour.',
    );
  });

  it.each`
    input                                                       | confidence | why
    ${'Melt 1 stick of butter.'}                                | ${0.25}    | ${'a recipe marker outweighs a spelling marker'}
    ${'Preheat the oven to 350 degrees.'}                       | ${0.25}    | ${'and so does an oven in Fahrenheit'}
    ${'Preheat the oven to 350°F.'}                             | ${0.25}    | ${'the oven setting and its °F are one sighting'}
    ${'Preheat the oven to 350 deg F.'}                         | ${0.25}    | ${'and so are the setting and its deg F'}
    ${'Preheat the oven to 350 before you start. Melt 1 stick of butter.'} | ${0.5} | ${'two recipe markers clear it'}
    ${'1 cup all-purpose flour'}                                | ${0.15}    | ${'an ingredient name counts like any other vocabulary'}
    ${'Melt 1 stick of butter in a gray pan.'}                  | ${0.4}     | ${'one recipe marker and one other fall short of the bar'}
    ${'Melt 1 stick of butter. Bake at 350.'}                   | ${0.5}     | ${'two recipe markers clear it'}
  `('scores "$input" at $confidence ($why)', ({ input, confidence }) => {
    expect(analyse(input).confidence).toBeCloseTo(confidence);
  });

  it('caps the markers, so a day-first date still pulls an American-looking recipe under the bar', () => {
    const recipe = 'Tested 25/12/2023. Melt 1 stick of butter, add 1 cup all-purpose flour, and bake at 350 in a gray pan.';
    expect(analyse(recipe).confidence).toBeCloseTo(0.2);
  });
});

describe('paper sizes', () => {
  it.each`
    input                                      | expected                  | why
    ${'print on letter paper'}                 | ${'print on A4'}          | ${'named, with paper context'}
    ${'a 8.5" x 11" page'}                     | ${'an A4 page'}           | ${'the dimensions give it away'}
    ${'print on letter paper, 8.5 x 11 inches'} | ${'print on A4'}         | ${'name and dimensions merge into one'}
    ${'letter-sized pages'}                    | ${'A4 pages'}             | ${'the adjective'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });

  it.each`
    unchanged                          | why
    ${'The letter arrived today.'}     | ${'no paper context nearby'}
    ${'He wrote a letter home.'}       | ${'correspondence'}
    ${'the letter A'}                  | ${'a character'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(deamericaniseText(unchanged, { preset: 'localise' })).toBe(unchanged);
  });
});

describe('the paper rule and the unit rules do not fight', () => {
  it.each`
    input                                   | expected                                 | why
    ${'print 8.5 x 11 inches'}              | ${'print A4'}                            | ${'the size has a name'}
    ${'US Letter is 8.5 x 11 inches'}       | ${'US Letter is 22 x 28 centimetres'}    | ${'a definition keeps its subject'}
    ${'a 9 x 13 inch dish'}                 | ${'a 23 x 33 centimetre dish'}           | ${'not a paper size'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(deamericaniseText(input, { preset: 'localise' })).toBe(expected);
  });
});
