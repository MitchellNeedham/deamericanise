import { describe, expect, it } from 'vitest';
import { DIALECTS, deamericaniseText } from '../src/index.js';
import type { Dialect } from '../src/index.js';

// The dialect overlays are vocabulary, so they need the localise preset.
const say = (dialect: Dialect) => (input: string) =>
  deamericaniseText(input, { dialect, preset: 'localise' });

describe('the same sentence in each dialect', () => {
  it.each`
    input                  | au                   | gb                    | nz
    ${'the sidewalk'}      | ${'the footpath'}    | ${'the pavement'}     | ${'the footpath'}
    ${'candy'}             | ${'lollies'}         | ${'sweets'}           | ${'lollies'}
    ${'a cookie'}          | ${'a biscuit'}       | ${'a biscuit'}        | ${'a biscuit'}
    ${'potato chips'}      | ${'chips'}           | ${'crisps'}           | ${'chips'}
    ${'a popsicle'}        | ${'an icy pole'}     | ${'an ice lolly'}     | ${'an ice block'}
    ${'cotton candy'}      | ${'fairy floss'}     | ${'candy floss'}      | ${'candy floss'}
    ${'a thrift store'}    | ${'an op shop'}      | ${'a charity shop'}   | ${'an op shop'}
    ${'a band-aid'}        | ${'a bandaid'}       | ${'a plaster'}        | ${'a plaster'}
    ${'call 911'}          | ${'call 000'}        | ${'call 999'}         | ${'call 111'}
  `('$input -> AU $au / GB $gb / NZ $nz', ({ input, au, gb, nz }) => {
    expect(say('en-AU')(input), 'en-AU').toBe(au);
    expect(say('en-GB')(input), 'en-GB').toBe(gb);
    expect(say('en-NZ')(input), 'en-NZ').toBe(nz);
  });
});

describe('words only some dialects change', () => {
  it.each`
    input             | dialect     | expected
    ${'an apartment'} | ${'en-AU'}  | ${'an apartment'}
    ${'an apartment'} | ${'en-GB'}  | ${'a flat'}
    ${'soccer'}       | ${'en-AU'}  | ${'soccer'}
    ${'soccer'}       | ${'en-GB'}  | ${'football'}
    ${'a truck'}      | ${'en-AU'}  | ${'a truck'}
    ${'a truck'}      | ${'en-GB'}  | ${'a lorry'}
    ${'the highway'}  | ${'en-AU'}  | ${'the highway'}
    ${'the highway'}  | ${'en-GB'}  | ${'the motorway'}
    ${'zucchini'}     | ${'en-AU'}  | ${'zucchini'}
    ${'zucchini'}     | ${'en-GB'}  | ${'courgette'}
    ${'eggplant'}     | ${'en-AU'}  | ${'eggplant'}
    ${'eggplant'}     | ${'en-GB'}  | ${'aubergine'}
    ${'sulfur'}       | ${'en-AU'}  | ${'sulfur'}
    ${'sulfur'}       | ${'en-GB'}  | ${'sulphur'}
    ${'ketchup'}      | ${'en-AU'}  | ${'tomato sauce'}
    ${'ketchup'}      | ${'en-GB'}  | ${'ketchup'}
    ${'a bell pepper'} | ${'en-AU'} | ${'a capsicum'}
    ${'a bell pepper'} | ${'en-GB'} | ${'a pepper'}
  `('$dialect: $input -> $expected', ({ input, dialect, expected }) => {
    expect(say(dialect as Dialect)(input)).toBe(expected);
  });
});

describe('en-GB keeps the imperial units Britain still uses', () => {
  it.each`
    input           | au                        | gb
    ${'10 miles'}   | ${'16 kilometres'}        | ${'10 miles'}
    ${'60 mph'}     | ${'97 km/h'}              | ${'60 mph'}
    ${'2 pints'}    | ${'950 millilitres'}      | ${'2 pints'}
    ${'6 feet'}     | ${'1.8 metres'}           | ${'1.8 metres'}
    ${'350°F'}      | ${'175°C'}                | ${'175°C'}
  `('$input -> AU $au / GB $gb', ({ input, au, gb }) => {
    expect(say('en-AU')(input), 'en-AU').toBe(au);
    expect(say('en-GB')(input), 'en-GB').toBe(gb);
  });

  it('converts them anyway when the rule is turned on by id', () => {
    expect(deamericaniseText('10 miles', { dialect: 'en-GB', rules: { 'units.length.mile': true } }))
      .toBe('16 kilometres');
  });
});

describe('en-CA is the hybrid', () => {
  it.each`
    input           | expected            | why
    ${'color'}      | ${'colour'}         | ${'Canada keeps the u'}
    ${'centre'}     | ${'centre'}         | ${'and the -re'}
    ${'defense'}    | ${'defence'}        | ${'and the -ce'}
    ${'organize'}   | ${'organize'}       | ${'but keeps -ize'}
    ${'analyze'}    | ${'analyze'}        | ${'and -yze'}
    ${'aluminum'}   | ${'aluminum'}       | ${'and aluminum'}
    ${'math'}       | ${'math'}           | ${'and math'}
    ${'a flat tire'} | ${'a flat tire'}   | ${'and tire'}
    ${'the sidewalk'} | ${'the sidewalk'} | ${'and most of the vocabulary'}
    ${'gasoline'}   | ${'gasoline'}       | ${'Canadians buy gas'}
    ${'travelled'}  | ${'travelled'}      | ${'already doubled'}
    ${'traveled'}   | ${'travelled'}      | ${'but doubles the l'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(say('en-CA')(input)).toBe(expected);
  });
});

describe('the dialect registry', () => {
  it('exposes every dialect with a label', () => {
    for (const [id, pack] of Object.entries(DIALECTS)) {
      expect(pack.id).toBe(id);
      expect(pack.label.length).toBeGreaterThan(0);
    }
  });

  it('rejects a dialect it does not know', () => {
    expect(() => deamericaniseText('color', { dialect: 'en-XX' as Dialect })).toThrow(/Unknown dialect/);
  });
});

describe('words that are already correct are left alone', () => {
  it.each`
    unchanged           | dialect     | why
    ${'candy floss'}    | ${'en-AU'}  | ${'not American, so candy must not fire inside it'}
    ${'candy floss'}    | ${'en-GB'}  | ${'the same'}
    ${'fairy floss'}    | ${'en-AU'}  | ${'the target of another rule'}
  `('$dialect leaves "$unchanged" alone ($why)', ({ unchanged, dialect }) => {
    expect(say(dialect as Dialect)(unchanged)).toBe(unchanged);
  });
});
