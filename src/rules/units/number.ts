import type { Precision } from '../../types.js';

const VULGAR: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;
const DIGITS = String.raw`\d{1,3}(?:,\d{3})+|\d+`;

/**
 * Whitespace that stays on one line. A number is never written across a line break, so
 * `Step 14` at the end of one line and `1/2 gallon` at the start of the next stay apart.
 */
export const INLINE_SPACE = String.raw`[^\S\n\r\v\f\u2028\u2029]`;
const SPACE_OR_HYPHEN = String.raw`(?:${INLINE_SPACE}+|-)`;

const LINE_BREAK = String.raw`(?:\r\n?|[\n\v\f\u2028\u2029])`;

/** A line that starts a new block: blank, a list item, a heading, a quote or a table row. */
const NEW_BLOCK = String.raw`${INLINE_SPACE}*(?:${LINE_BREAK}|$|[-*+](?=\s|$)|\d+[.)](?=\s|$)|[#>|])`;

const SOFT_BREAK = String.raw`${INLINE_SPACE}*${LINE_BREAK}(?!${NEW_BLOCK})${INLINE_SPACE}*`;

/**
 * Whitespace inside one quantity but outside its number: on one line, or across a single
 * line break that only wraps the paragraph, as in `6` then `feet` on the next line.
 */
export const SOFT_SPACE = String.raw`(?:${SOFT_BREAK}|${INLINE_SPACE}*)`;

/** `SOFT_SPACE` on either side of `token`, with at most one line break between them. */
export function softGap(token: string): string {
  return String.raw`(?:${SOFT_SPACE}${token}${INLINE_SPACE}*|${INLINE_SPACE}*${token}${SOFT_BREAK})`;
}

/** Recipes and older prose write their numbers out: `one cup`, `three-quarters cup`. */
const CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, quarter: 4, quarters: 4, third: 3, thirds: 3, fourth: 4, fourths: 4,
  eighth: 8, eighths: 8, sixteenth: 16, sixteenths: 16,
};

// Every other denominator is an ordinal too, so it needs a count to be a fraction:
// `a third mile` and `one-third mile`, but `the third mile`.
const UNCOUNTED = ['half', 'halves', 'quarter', 'quarters'];

// Longest first, so `three-quarters` is not read as the cardinal `three`.
const CARD = Object.keys(CARDINALS).sort((a, b) => b.length - a.length).join('|');
const FRAC = Object.keys(DENOMINATORS).sort((a, b) => b.length - a.length).join('|');
const BARE_FRAC = [...UNCOUNTED].sort((a, b) => b.length - a.length).join('|');

const TENS = Object.keys(CARDINALS).filter((word) => CARDINALS[word]! >= 20);
const ONES = Object.keys(CARDINALS).filter((word) => CARDINALS[word]! < 10);

/**
 * `twenty-two` and `twenty two`. Spaced, a units word hyphenated to what follows is not
 * part of the pair, since `twenty five-pound bags` can be twenty bags.
 */
const COMPOUND =
  String.raw`(?:${TENS.join('|')})` +
  String.raw`(?:-(?:${ONES.join('|')})(?!\w)|${INLINE_SPACE}+(?:${ONES.join('|')})(?![\w-]))`;

/** A spelled-out fraction with its count: `a quarter`, `three-quarters`, `one half`. */
export const COUNTED_FRACTION = String.raw`(?:an?${INLINE_SPACE}+|(?:${CARD})${SPACE_OR_HYPHEN})(?:${FRAC})`;

/**
 * A spelled-out fraction, counted or not: `half`, `a quarter`, `three-quarters`. A bare
 * ordinal such as `third` is a fraction only where the words after it make it one, as
 * `of a mile` does.
 */
export const FRACTION_WORDS = String.raw`(?:${COUNTED_FRACTION}|(?:${FRAC}))`;

// The tail of a longer number that a line break cut off, such as `half feet` after `two and
// a`, is not a number of its own. A new block in between makes it one again.
const NOT_AFTER_AND = String.raw`(?<!(?:\d|\b(?:${CARD}))${softGap('and')})`;
const NOT_AFTER_COUNT = String.raw`(?<!\b(?:${CARD}|an?)-?${SOFT_SPACE})`;

/**
 * Where a written-out number may start: not inside a hyphenated word and not straight after
 * a tens word, so whatever of `catch-twenty-two`, `twenty-twenty` or `twenty five-pound` the
 * table cannot read is left whole. A tens word ending the line above counts as well.
 */
export const NOT_IN_COMPOUND =
  String.raw`(?<![A-Za-z]-)(?<!\b(?:${TENS.join('|')})-?(?:${SOFT_BREAK}|${INLINE_SPACE}+))`;

/**
 * `body`, unless `guard` finds it is the tail of a longer number. The lookahead keeps the
 * costlier lookbehind to the few places where `body` can start.
 */
function unlessTail(guard: string, body: string): string {
  return String.raw`(?=${body})${guard}${body}`;
}

/** A cardinal of one word or two: `seven`, `twenty-two`, `twenty two`. */
const CARDINAL = unlessTail(NOT_IN_COMPOUND, String.raw`(?:${COMPOUND}|${CARD})`);

const WORD_NUMBER = [
  String.raw`(?:${CARDINAL}|\d+)${INLINE_SPACE}+and${INLINE_SPACE}+(?:${CARD}|an?)${SPACE_OR_HYPHEN}(?:${FRAC})`,
  unlessTail(NOT_AFTER_AND + NOT_IN_COMPOUND, String.raw`(?:${CARD})${SPACE_OR_HYPHEN}(?:${FRAC})`),
  CARDINAL,
  unlessTail(NOT_AFTER_AND + NOT_IN_COMPOUND, String.raw`an?${INLINE_SPACE}+(?:${FRAC})`),
  unlessTail(NOT_AFTER_COUNT + NOT_IN_COMPOUND, String.raw`(?:${BARE_FRAC})`),
].join('|');

/** A whole number in digits or words: `2`, `1,200`, `two`, `twenty-two`. */
export const WHOLE_NUMBER = String.raw`(?:${DIGITS}|${CARDINAL})`;

/**
 * Digits only. Ranges and dimensions use this rather than the full pattern, because a
 * written-out fraction contains its own hyphen: `one-half` is one number, not a range
 * running from `one` to `half`.
 */
export const NUMERIC_PATTERN = [
  String.raw`[-−]?(?:${DIGITS})${INLINE_SPACE}+\d+/\d+`,
  String.raw`[-−]?(?:${DIGITS})${INLINE_SPACE}*${VULGAR_CLASS}`,
  String.raw`[-−]?\d+/\d+`,
  VULGAR_CLASS,
  String.raw`[-−]?(?:${DIGITS})(?:\.\d+)?`,
].join('|');

/**
 * Matches `3`, `3.5`, `1,200`, `1 1/2`, `1½`, `3/4`, `one`, `three-quarters`,
 * `two and a half`, `a quarter`. The article in `a quarter` is part of the match, so a
 * caller that keeps it for a following noun has to split it off.
 */
export const NUMBER_PATTERN = `${NUMERIC_PATTERN}|${WORD_NUMBER}`;

function cardinal(word: string): number | undefined {
  if (word === 'a' || word === 'an') return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return CARDINALS[word];
}

/** `three-quarters`, `twenty-two`, `one and one-half`, `two and a half`, `a quarter`, `half`. */
function parseWords(text: string): number | null {
  const parts = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w !== 'and');
  if (parts.length === 0) return null;

  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const word = parts[i]!;
    const denominator = DENOMINATORS[word];
    if (denominator !== undefined) {
      // A cardinal directly before it is the numerator: `three quarters`.
      const numerator = i > 0 && cardinal(parts[i - 1]!) !== undefined ? 0 : 1;
      total += numerator / denominator;
      continue;
    }
    let count = cardinal(word);
    if (count === undefined) return null;
    // A denominator after the pair divides all of it: `twenty-three quarters`.
    if (TENS.includes(word) && ONES.includes(parts[i + 1] ?? '')) count += CARDINALS[parts[++i]!]!;
    const next = parts[i + 1];
    if (next && DENOMINATORS[next] !== undefined) total += count / DENOMINATORS[next]!;
    else total += count;
  }
  return total;
}

export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/−/g, '-').replace(/,/g, '');
  if (/[a-z]/i.test(text)) return parseWords(text);
  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^-/, '');

  const vulgar = body.match(new RegExp(`^(\\d*)\\s*(${VULGAR_CLASS})$`));
  if (vulgar) {
    const whole = vulgar[1] ? Number(vulgar[1]) : 0;
    return sign * (whole + VULGAR[vulgar[2]!]!);
  }

  const mixed = body.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return sign * (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));

  const fraction = body.match(/^(\d+)\/(\d+)$/);
  if (fraction) return sign * (Number(fraction[1]) / Number(fraction[2]));

  const value = Number(body);
  return Number.isFinite(value) ? sign * value : null;
}

/**
 * How precisely the source was written. `6` claims one figure, `6.5` claims two, and
 * `350` claims two because the trailing zero is padding rather than measurement.
 */
export function significantFigures(raw: string): number {
  if (/[a-z]/i.test(raw)) return 2;
  const text = raw.replace(/[,\s−-]/g, '');
  if (new RegExp(VULGAR_CLASS).test(text) || text.includes('/')) return 2;

  const [whole = '', decimal] = text.split('.');
  if (decimal !== undefined) {
    return (whole.replace(/^0+/, '') + decimal).replace(/^0+/, '').length || 1;
  }
  return whole.replace(/^0+/, '').replace(/0+$/, '').length || 1;
}

/**
 * Where a number of a measurement may start: not inside a word or a decimal. Straight after
 * `\d-`, `\d/`, `\d,` or `\d:` it is the tail of a date or of a range written tight, of a
 * fraction, of a grouped number such as `1,005`, or the minutes of a time such as `7:30`.
 */
export const NUMBER_START = String.raw`(?<![\w.]|\d[-\u2013\u2014/,:])`;

/**
 * Where the first number of a range may start, beyond `NUMBER_START`: not after a currency
 * sign, where it is a price. The optional space matches the currency rule, which reads
 * `$ 5` as money.
 */
export const RANGE_START = String.raw`(?<![$£€]\s?)`;

/** `from` or `between` before a first number, which opens a range whatever its ends. */
const RANGE_WORD_BEFORE = /\b(?:from|between)\s+$/i;

/**
 * Whether `low`, which starts at `start` in `text`, and `high` can be the two ends of one
 * range. A first number more than ten times the size of the second is a year or a count
 * before a quantity, as in `In 2024 - 5 feet`, unless `from` or `between` opens the range, as
 * in `fell from 10 to 0.5 miles`. A second end of zero says nothing, as in `lows of 10 to 0°F`.
 */
export function canBeRange(text: string, start: number, low: number, high: number): boolean {
  if (high === 0 || low <= 10 * Math.abs(high)) return true;
  return RANGE_WORD_BEFORE.test(text.slice(Math.max(0, start - 16), start));
}

function roundToSignificant(value: number, figures: number): number {
  if (value === 0) return 0;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (figures - magnitude);
  return Math.round(value * factor) / factor;
}

function group(text: string): string {
  const [whole = '', decimal] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  if (digits.length < 5) return text;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal ? `.${decimal}` : '');
}

function trim(value: number, maxDecimals: number): string {
  return group(String(Number(value.toFixed(maxDecimals))));
}

export function formatNumber(
  value: number,
  precision: Precision,
  sourceFigures: number,
  maxDecimals: number,
): string {
  if (typeof precision === 'number') return group(value.toFixed(precision));
  if (precision === 'exact') return trim(value, maxDecimals);
  // `natural`: never claim less than two figures, and never more than the source did.
  return trim(roundToSignificant(value, Math.max(2, sourceFigures)), 4);
}

/** A Fahrenheit value that reads as an oven dial setting rather than a measurement. */
export function isOvenSetting(fahrenheit: number): boolean {
  return Number.isInteger(fahrenheit) && fahrenheit >= 200 && fahrenheit % 25 === 0;
}

/**
 * Oven temperatures are written in fives, so `350F` should land on 175C rather than
 * 176.7C. The habit only applies to the oven range; `100F` is a fever, not a setting.
 */
export function formatTemperature(
  celsius: number,
  precision: Precision,
  source: number,
  maxDecimals: number,
): string {
  if (typeof precision === 'number') return celsius.toFixed(precision);
  if (precision === 'exact') return trim(celsius, maxDecimals);
  if (isOvenSetting(source)) return String(Math.round(celsius / 5) * 5);
  return String(Math.round(celsius * 10) / 10);
}
