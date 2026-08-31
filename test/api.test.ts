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
