import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

// A file of its own: a worker that has already run many tests slows the longer input more
// than the shorter one, which breaks the comparison.

const convert = (input: string) =>
  deamericaniseText(input, { categories: { spelling: false, vocabulary: false } });

describe('a long run of fuel economy ranges takes time in line with its length', () => {
  // Two lengths timed in one run, so the speed of the machine cancels out. Four times the
  // ranges take about four times as long; testing every change against a hold for every range
  // takes well over eight times as long.
  const MAX_RATIO = 8;
  // Other test files run in parallel. Alternating the lengths and keeping the fastest time of
  // each stops a burst of that load from slowing one length alone.
  const growth = (short: string, long: string) => {
    const best = [Infinity, Infinity];
    for (let round = 0; round < 5; round++) {
      [short, long].forEach((text, i) => {
        const started = performance.now();
        convert(text);
        best[i] = Math.min(best[i]!, performance.now() - started);
      });
    }
    return best[1]! / best[0]!;
  };

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
