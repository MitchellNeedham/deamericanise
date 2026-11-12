import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

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
