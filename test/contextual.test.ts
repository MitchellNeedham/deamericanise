import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

const au = (input: string) => deamericaniseText(input);

describe('tire / tyre', () => {
  it.each`
    input                          | expected
    ${'a flat tire'}               | ${'a flat tyre'}
    ${'the spare tire'}            | ${'the spare tyre'}
    ${'four new tires'}            | ${'four new tyres'}
    ${'check the tire pressure'}   | ${'check the tyre pressure'}
    ${'the tire tread is worn'}    | ${'the tyre tread is worn'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                    | why
    ${'I tire of this'}          | ${'the verb'}
    ${'they tire quickly'}       | ${'the verb'}
    ${'do not tire yourself'}    | ${'the verb'}
    ${'she was tired'}           | ${'a different word'}
    ${'a tiring day'}            | ${'a different word'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('check / cheque', () => {
  it.each`
    input                            | expected
    ${'a check for $50'}             | ${'a cheque for $50'}
    ${'wrote a check'}               | ${'wrote a cheque'}
    ${'paid by check'}               | ${'paid by cheque'}
    ${'my checkbook'}                | ${'my chequebook'}
    ${'a checking account'}          | ${'a cheque account'}
    ${'the paycheck arrived'}        | ${'the pay cheque arrived'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                     | why
    ${'check the value'}          | ${'the verb, which is everywhere in code'}
    ${'a health check'}           | ${'the noun in its other sense'}
    ${'please check again'}       | ${'the verb'}
    ${'checked the box'}          | ${'the verb'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('license / licence and practice / practise', () => {
  it.each`
    input                            | expected                          | why
    ${'a valid license'}             | ${'a valid licence'}              | ${'the noun takes a c'}
    ${'renew your license'}          | ${'renew your licence'}           | ${'the noun'}
    ${'a fishing license'}           | ${'a fishing licence'}            | ${'the noun'}
    ${'the license plate'}           | ${'the licence plate'}            | ${'the noun, with vocabulary off'}
    ${'we practice daily'}           | ${'we practise daily'}            | ${'the verb takes an s'}
    ${'to practice medicine'}        | ${'to practise medicine'}         | ${'the verb'}
    ${'she practiced'}               | ${'she practised'}                | ${'always an s in the past'}
    ${'practicing law'}              | ${'practising law'}               | ${'always an s'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                      | why
    ${'a licensed operator'}       | ${'licensed keeps its s everywhere'}
    ${'licensing terms'}           | ${'same'}
    ${'the licensee'}              | ${'same'}
    ${'best practice'}             | ${'the noun keeps its c'}
    ${'common practices'}          | ${'the noun'}
    ${'a practical solution'}      | ${'a different word'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('other sense-dependent spellings', () => {
  it.each`
    input                          | expected                        | rule
    ${'a two story building'}      | ${'a two-storey building'}      | ${'storey'}
    ${'a three story house'}       | ${'a three-storey house'}       | ${'storey'}
    ${'parked at the curb'}        | ${'parked at the kerb'}         | ${'kerb'}
    ${'curbside collection'}       | ${'kerbside collection'}        | ${'kerb'}
    ${'draft beer'}                | ${'draught beer'}               | ${'draught'}
    ${'served on draft'}           | ${'served on draught'}          | ${'draught'}
    ${'a drafty room'}             | ${'a draughty room'}            | ${'draught'}
    ${'a compact disk'}            | ${'a compact disc'}             | ${'disc'}
    ${'disk brakes'}               | ${'disc brakes'}                | ${'disc'}
    ${'a bench vise'}              | ${'a bench vice'}               | ${'vice'}
    ${'400 meters'}                | ${'400 metres'}                 | ${'metre'}
    ${'square meters'}             | ${'square metres'}              | ${'metre'}
    ${'she kneeled down'}          | ${'she knelt down'}             | ${'irregular past'}
    ${'he leaped over it'}         | ${'he leapt over it'}           | ${'irregular past'}
    ${'they had gotten it'}        | ${'they had got it'}            | ${'gotten'}
  `('$rule: $input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                        | why
    ${'a good story'}                | ${'a tale, not a floor'}
    ${'curb your enthusiasm'}        | ${'the verb'}
    ${'curb inflation'}              | ${'the verb'}
    ${'the first draft'}             | ${'a document'}
    ${'drafted the proposal'}        | ${'a document'}
    ${'the hard disk'}               | ${'a computer disk keeps its k'}
    ${'a parking meter'}             | ${'a device, not the unit'}
    ${'the gas meter reading'}       | ${'a device'}
    ${'ill-gotten gains'}            | ${'a fixed phrase'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('with localise on, vocabulary wins the longer match', () => {
  it('prefers "number plate" over "licence plate"', () => {
    expect(deamericaniseText('the license plate', { preset: 'localise' })).toBe('the number plate');
  });
});

// `burned`, `spelled`, `learned` and the rest are ordinary Australian English, not
// Americanisms, so they are left alone. Only `kneeled` and `leaped` are genuinely American.
describe('past forms that are native here are left alone', () => {
  it.each`
    unchanged                      | why
    ${'the fire burned for days'}  | ${'both forms are native'}
    ${'burned toast'}              | ${'burnt is preferred, but burned is not American'}
    ${'she learned quickly'}       | ${'both forms are native'}
    ${'he spelled it wrong'}       | ${'both forms are native'}
    ${'they dreamed of it'}        | ${'both forms are native'}
    ${'the milk spilled'}          | ${'both forms are native'}
    ${'it smelled bad'}            | ${'smelt reads dated here'}
    ${'he leaned on the door'}     | ${'leant reads dated here'}
    ${'a learned professor'}       | ${'the adjective, and native anyway'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });

  it('still fixes the ones that really are American', () => {
    expect(au('they had gotten it after she kneeled and leaped')).toBe(
      'they had got it after she knelt and leapt',
    );
  });
});

describe('risky rules can be switched off in one move', () => {
  it('drops every sense-dependent rule with the risky tier', () => {
    const safe = { confidence: ['safe', 'moderate'] as const };
    expect(deamericaniseText('a flat tire and a check for $50', { confidence: [...safe.confidence] }))
      .toBe('a flat tire and a check for $50');
  });

  it('drops one rule by id', () => {
    expect(deamericaniseText('a flat tire', { rules: { 'spelling.contextual.tyre': false } }))
      .toBe('a flat tire');
  });

  it('drops a family of rules with a wildcard', () => {
    expect(deamericaniseText('a flat tire on the curb', { rules: { 'spelling.contextual.*': false } }))
      .toBe('a flat tire on the curb');
  });
});
