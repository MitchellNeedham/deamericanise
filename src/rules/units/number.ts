import type { Precision } from '../../types.js';

const VULGAR: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;
const DIGITS = String.raw`\d{1,3}(?:,\d{3})+|\d+`;

/**
 * Whitespace that stays on one line. A quantity is never written across a line break, so
 * `Step 14` at the end of one line and `1/2 gallon` at the start of the next stay apart.
 */
export const INLINE_SPACE = String.raw`[^\S\n\r\v\f\u2028\u2029]`;
const SPACE_OR_HYPHEN = String.raw`(?:${INLINE_SPACE}+|-)`;

/** Recipes and older prose write their numbers out: `one cup`, `three-quarters cup`. */
const CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, quarter: 4, quarters: 4, third: 3, thirds: 3,
  eighth: 8, eighths: 8, sixteenth: 16, sixteenths: 16,
};

// Longest first, so `three-quarters` is not read as the cardinal `three`.
const CARD = Object.keys(CARDINALS).sort((a, b) => b.length - a.length).join('|');
const FRAC = Object.keys(DENOMINATORS).sort((a, b) => b.length - a.length).join('|');

/** A spelled-out fraction with its count: `a quarter`, `three-quarters`, `one half`. */
export const COUNTED_FRACTION = String.raw`(?:an?${INLINE_SPACE}+|(?:${CARD})${SPACE_OR_HYPHEN})(?:${FRAC})`;

/** A spelled-out fraction, counted or not: `half`, `a quarter`, `three-quarters`. */
export const FRACTION_WORDS = String.raw`(?:${COUNTED_FRACTION}|(?:${FRAC}))`;

// The tail of a longer number that a line break cut off, such as `half feet` after `two and
// a`, is not a number of its own.
const NOT_AFTER_AND = String.raw`(?<!(?:\d|\b(?:${CARD}))\s+and\s+)`;
const NOT_AFTER_COUNT = String.raw`(?<!\b(?:${CARD}|an?)[\s-]+)`;

const WORD_NUMBER = [
  String.raw`(?:${CARD}|\d+)${INLINE_SPACE}+and${INLINE_SPACE}+(?:${CARD}|an?)${SPACE_OR_HYPHEN}(?:${FRAC})`,
  String.raw`${NOT_AFTER_AND}(?:${CARD})${SPACE_OR_HYPHEN}(?:${FRAC})`,
  String.raw`(?:${CARD})`,
  String.raw`${NOT_AFTER_AND}an?${INLINE_SPACE}+(?:${FRAC})`,
  String.raw`${NOT_AFTER_COUNT}(?:${FRAC})`,
].join('|');

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

/** `three-quarters`, `one and one-half`, `two and a half`, `a quarter`, `half`. */
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
    const count = cardinal(word);
    if (count === undefined) return null;
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
  const isOvenSetting = Number.isInteger(source) && source >= 200 && source % 25 === 0;
  if (isOvenSetting) return String(Math.round(celsius / 5) * 5);
  return String(Math.round(celsius * 10) / 10);
}
