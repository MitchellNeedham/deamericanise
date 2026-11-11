import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CONFIDENCES,
  analyse,
  deamericanise,
  deamericaniseText,
  ruleIds,
} from '../src/index.js';
import type { Category } from '../src/index.js';

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
  `('finds no oven setting in "$input" ($why)', ({ input }) => {
    expect(analyse(input).markers).not.toContain(OVEN);
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
    expect(analyse(recipe).markers).toEqual(['Fahrenheit']);
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
