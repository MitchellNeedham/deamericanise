import { describe, expect, it } from 'vitest';
import { analyse, deamericaniseText, resolveOptions } from '../src/index.js';
import { patternRules } from '../src/rules/index.js';

// A file of its own: a worker that has already run many tests slows the longer input more
// than the shorter one, which breaks the comparison.

const convert = (input: string) =>
  deamericaniseText(input, { categories: { spelling: false, vocabulary: false } });

// Shared CI runners are too noisy even for a ratio, so CI relies on the counts of changes and
// of reads in `test/units.test.ts`. A local run still catches a slow path a count cannot see.
const onCi = Boolean(process.env.CI);

// Two lengths timed in one run, so the speed of the machine cancels out. Four times the input
// takes about four times as long; testing every change against a span for every piece of it
// takes well over eight times as long.
const MAX_RATIO = 8;
// Other test files run in parallel. Alternating the lengths and keeping the fastest time of
// each stops a burst of that load from slowing one length alone.
const growth = (short: string, long: string, run: (text: string) => unknown = convert) => {
  const best = [Infinity, Infinity];
  for (let round = 0; round < 5; round++) {
    [short, long].forEach((text, i) => {
      const started = performance.now();
      run(text);
      best[i] = Math.min(best[i]!, performance.now() - started);
    });
  }
  return best[1]! / best[0]!;
};

describe.skipIf(onCi)('a long run of fuel economy ranges takes time in line with its length', () => {
  it.each`
    range                    | length  | expected
    ${'20 to 30 mpg, '}      | ${4000} | ${'7.8 to 12 L/100km, 7.8 to 12 L/100km, '}
    ${'twenty to 30 mpg, '}  | ${4000} | ${'twenty to 30 mpg, twenty to 30 mpg, '}
  `(
    '"$range", $length times and four times that',
    ({ range, length, expected }) => {
      expect(convert(range.repeat(length)).startsWith(expected)).toBe(true);
      expect(growth(range.repeat(length), range.repeat(length * 4))).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );
});

describe.skipIf(onCi)('spans held or protected beside many changes take time in line with the length', () => {
  it.each`
    piece                                  | length  | expected
    ${'twenty to 30 miles per gallon, '}   | ${1000} | ${'twenty to 30 miles per gallon, twenty to 30 miles per gallon, '}
    ${'It cost 500 pounds and 3 inches, '} | ${1000} | ${'It cost 500 pounds and 7.6 centimetres, It cost 500 pounds and 7.6 centimetres, '}
    ${'see https://a.com/x the color. '}   | ${2000} | ${'see https://a.com/x the colour. see https://a.com/x the colour. '}
  `(
    '"$piece", $length times and four times that',
    ({ piece, length, expected }) => {
      expect(deamericaniseText(piece.repeat(length)).startsWith(expected)).toBe(true);
      const ratio = growth(piece.repeat(length), piece.repeat(length * 4), deamericaniseText);
      expect(ratio).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );
});

describe.skipIf(onCi)('a long run of grouped numbers takes time in line with its length', () => {
  it.each`
    piece                                      | length  | expected
    ${'100 '}                                  | ${4000} | ${'100 100 100 '}
    ${'1 000 miles, '}                         | ${2000} | ${'1 600 kilometres, 1 600 kilometres, '}
    ${'two hundred and fifty thousand feet, '} | ${1000} | ${'76 kilometres, 76 kilometres, '}
  `(
    '"$piece", $length times and four times that',
    ({ piece, length, expected }) => {
      expect(convert(piece.repeat(length)).startsWith(expected)).toBe(true);
      expect(growth(piece.repeat(length), piece.repeat(length * 4))).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );
});

describe.skipIf(onCi)('a long chain of weights takes time in line with its length', () => {
  // Each weight's next unit is decided by walking back along the chain, once for the text.
  // Walking back from every weight takes time in the square of the chain's length, which is
  // sixteen times as long for four times the chain.
  const MAX_RATIO = 10;

  it.each`
    link                  | length  | expected
    ${'11 stone 4 to '}   | ${1000} | ${'71.7 kilograms to 71.7 kilograms to '}
    ${'7 lb 8 to 9 lb, '} | ${1000} | ${'3.4 kg to 4.1 kg, 3.4 kg to 4.1 kg, '}
  `(
    '"$link", $length times and four times that',
    ({ link, length, expected }) => {
      expect(convert(link.repeat(length)).startsWith(expected)).toBe(true);
      expect(growth(link.repeat(length), link.repeat(length * 4))).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );
});

describe.skipIf(onCi)('TeX, maths, front matter and dollar variables take time in line with their length', () => {
  const markdown = { syntax: 'markdown' } as const;
  const american = { assumeAmerican: true };

  it.each`
    piece                                | options                         | wrap                                   | expected
    ${'\\textcolor{gray}{gray word} '}   | ${{}}                           | ${(s: string) => s}                    | ${'\\textcolor{gray}{grey word} \\textcolor{gray}{grey word} '}
    ${'$x$ gray '}                       | ${markdown}                     | ${(s: string) => s}                    | ${'$x$ grey $x$ grey '}
    ${'$5 gray '}                        | ${{ ...markdown, ...american }} | ${(s: string) => s}                    | ${'US$5 grey US$5 grey '}
    ${'$1 in sed '}                      | ${american}                     | ${(s: string) => s}                    | ${'$1 in sed $1 in sed '}
    ${'title: The gray cat\n'}           | ${markdown}                     | ${(s: string) => `---\n${s}---\n`}     | ${'---\ntitle: The grey cat\ntitle: The grey cat\n'}
  `(
    '"$piece", 2000 times and four times that',
    ({ piece, options, wrap, expected }) => {
      const run = (text: string) => deamericaniseText(text, options);
      expect(run(wrap(piece.repeat(2000))).startsWith(expected)).toBe(true);
      expect(growth(wrap(piece.repeat(2000)), wrap(piece.repeat(8000)), run)).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );
});

/** A text broken by a long run of white space, and what the text before the run reads as. */
const WHITESPACE_RUNS = [
  { before: 'A 7 pound 8 ounce baby.', name: 'spaces', run: ' ', length: 3000, after: 'The color.', expected: 'A 3.4 kilogram baby.' },
  { before: 'A 7 pound 8 ounce baby.', name: 'tabs', run: '\t', length: 3000, after: 'The color.', expected: 'A 3.4 kilogram baby.' },
  { before: 'A 7 pound 8 ounce baby.', name: 'newlines', run: '\n', length: 12000, after: 'The color.', expected: 'A 3.4 kilogram baby.' },
  { before: 'A 7 pound 8 ounce baby.', name: 'spaces', run: ' ', length: 3000, after: '5 feet', expected: 'A 3.4 kilogram baby.' },
  { before: 'A 7 pound 8 ounce baby.', name: 'spaces', run: ' ', length: 3000, after: 'half a mile', expected: 'A 3.4 kilogram baby.' },
  { before: 'A 7 pound 8 ounce baby.', name: 'spaces', run: ' ', length: 3000, after: 'seven pounds 8 ounces', expected: 'A 3.4 kilogram baby.' },
  { before: 'He is six foot two', name: 'spaces', run: ' ', length: 3000, after: 'tall.', expected: 'He is 1.88 metres' },
  { before: 'He is six foot two', name: 'spaces', run: ' ', length: 3000, after: 'boxes.', expected: 'He is 1.8 metres two' },
  { before: 'He is six foot two', name: 'spaces', run: ' ', length: 3000, after: 'with boxes.', expected: 'He is 1.88 metres' },
  { before: 'Weigh five to', name: 'spaces', run: ' ', length: 3000, after: 'seven pounds 8 ounces', expected: 'Weigh five to' },
  { before: 'It weighs 7 pounds', name: 'spaces', run: ' ', length: 3000, after: 'The color.', expected: 'It weighs 3.2 kilograms' },
  { before: 'It is 5', name: 'spaces', run: ' ', length: 30000, after: 'The color.', expected: 'It is 5' },
  { before: 'It is 5', name: 'spaces', run: ' ', length: 100000, after: 'The color.', expected: 'It is 5' },
  { before: 'It is five', name: 'spaces', run: ' ', length: 100000, after: 'The color.', expected: 'It is five' },
  { before: 'x', name: 'spaces', run: ' ', length: 100000, after: 'y', expected: 'x' },
  { before: 'text-align:', name: 'spaces', run: ' ', length: 100000, after: 'center', expected: 'text-align:' },
  { before: '{%', name: 'spaces', run: ' ', length: 100000, after: 'if color %}', expected: '{%' },
  { before: 'Thanks @', name: 'spaces', run: ' ', length: 100000, after: 'gray', expected: 'Thanks @' },
  { before: 'It is 1', name: 'spaces', run: ' ', length: 30000, after: '000 miles', expected: 'It is 1' },
  { before: 'Walk a hundred', name: 'spaces', run: ' ', length: 3000, after: 'feet', expected: 'Walk 30 metres' },
];
const whitespaceText = ({ before, run, length, after }: (typeof WHITESPACE_RUNS)[number]) =>
  `${before}${run.repeat(length)}${after}`;

describe('a long run of whitespace leaves the text before it read as before', () => {
  it.each(WHITESPACE_RUNS)('"$before", $length $name, then "$after"', (row) => {
    expect(convert(whitespaceText(row)).startsWith(row.expected)).toBe(true);
  });
});

// No count sees a pattern's backtracking, so on CI only the output above is checked.
describe.skipIf(onCi)('a long run of whitespace takes time in line with its length', () => {
  // Generous, since each of these takes a few milliseconds. A pattern that walks the run from
  // every place in it, or tries every split of it, takes several seconds.
  const LIMIT_MS = 1000;

  it.each(WHITESPACE_RUNS)('"$before", $length $name, then "$after"', (row) => {
    convert(whitespaceText({ ...row, length: 1 }));
    const started = performance.now();
    convert(whitespaceText(row));
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
  });
});

describe.skipIf(onCi)('the decade rule takes time in line with a long run of spaces', () => {
  // The rule alone, so the time the rest of the pipeline takes on the run cannot hide its own.
  const options = resolveOptions({});
  const decade = patternRules(options).find((rule) => rule.id === 'units.temperature.decade')!;
  // Generous, since the rule takes a few milliseconds here. A pattern that tries every split
  // of the run takes most of a second.
  const LIMIT_MS = 100;

  it.each`
    before                   | expected
    ${'the'}                 | ${[]}
    ${'Highs in the'}        | ${[]}
    ${'Highs in the mid'}    | ${[]}
    ${'Highs in the 70s or'} | ${['between 21 and 26°C']}
  `('"$before", 30000 spaces, then "x"', ({ before, expected }) => {
    const text = `${before}${' '.repeat(30000)}x`;
    const signals = analyse(text);
    const started = performance.now();
    const changes = decade.find({ text, options, signals, american: true });
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
    expect(changes.map((change) => change.after)).toEqual(expected);
  });
});

describe.skipIf(onCi)('protected names and paths take time in line with their length', () => {
  it.each`
    piece                                    | expected
    ${'Bright Red Color won. '}              | ${'Bright Red Colour won. Bright Red Colour won. '}
    ${'Set the background-color to match. '} | ${'Set the background-color to match. Set the background-color to match. '}
    ${'background-color-'}                   | ${'background-colour-background-colour-'}
    ${'Use std::color::gray here. '}         | ${'Use std::color::gray here. Use std::color::gray here. '}
    ${'I like the *color*/flavor of it. '}   | ${'I like the *colour*/flavour of it. I like the *colour*/flavour of it. '}
    ${'See \\usepackage{color} here. '}      | ${'See \\usepackage{color} here. See \\usepackage{color} here. '}
  `(
    '"$piece", 2000 times and four times that',
    ({ piece, expected }) => {
      expect(deamericaniseText(piece.repeat(2000)).startsWith(expected)).toBe(true);
      expect(growth(piece.repeat(2000), piece.repeat(8000), deamericaniseText)).toBeLessThan(MAX_RATIO);
    },
    60_000,
  );

  // Generous, since each of these takes a few milliseconds. A pattern that walks the run from
  // every place in it takes several seconds.
  const LIMIT_MS = 1000;

  it.each`
    before            | after
    ${'Medal of'}     | ${'Honor'}
    ${'It rained.'}   | ${'Bright Red Color'}
    ${'Kodak'}        | ${'Theater'}
    ${'Color'}        | ${'Run'}
    ${'std::color'}   | ${'::gray'}
    ${'border-top'}   | ${'-color'}
    ${'grayscale('}   | ${')'}
    ${'*color*'}      | ${'/flavor'}
    ${'\\usepackage'} | ${'{color}'}
  `('"$before", 100000 spaces, then "$after"', ({ before, after }) => {
    const text = `${before}${' '.repeat(100000)}${after}`;
    convert(text.slice(0, 100));
    const started = performance.now();
    expect(convert(text).startsWith(before)).toBe(true);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
  });
});
