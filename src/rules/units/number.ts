import type { Precision } from '../../types.js';
import { MONTH_PATTERN } from '../dates.js';

const VULGAR: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;

/** How a number in digits ends: a digit or a vulgar fraction, as in `15` and `15½`. */
export const NUMERIC_LAST = String.raw`(?:\d|${VULGAR_CLASS})`;

/** How a number in digits starts: a digit, a minus sign or a vulgar fraction. */
export const NUMERIC_FIRST = String.raw`(?:[\d\-−]|${VULGAR_CLASS})`;

/** U+2010 HYPHEN and U+2011 NON-BREAKING HYPHEN, which join words and are never minus signs. */
const UNICODE_HYPHENS = String.raw`\u2010\u2011`;

/** A hyphen as typesetting writes it: the hyphen-minus, U+2010 or U+2011. */
export const HYPHEN = `[-${UNICODE_HYPHENS}]`;
const UNICODE_HYPHEN = new RegExp(`[${UNICODE_HYPHENS}]`, 'g');

/** `text` with U+2010 and U+2011 written as `-`, at the same offsets. */
export function plainHyphens(text: string): string {
  return text.replace(UNICODE_HYPHEN, '-');
}

/**
 * Whitespace that stays on one line. A number is never written across a line break, so
 * `Step 14` at the end of one line and `1/2 gallon` at the start of the next stay apart.
 */
export const INLINE_SPACE = String.raw`[^\S\n\r\v\f\u2028\u2029]`;
const SPACE_OR_HYPHEN = String.raw`(?:${INLINE_SPACE}+|${HYPHEN})`;

/** A space, a no-break space (U+00A0) or a narrow no-break space (U+202F), between groups. */
const GROUP_SPACES = [' ', String.raw`\u00A0`, String.raw`\u202F`];
const GROUP_SPACE = `[${GROUP_SPACES.join('')}]`;

/**
 * What a figure inside a word or a decimal follows. A run of `_` between opens emphasis on the
 * figure, as in `_6 feet_`, unless a letter, digit or stop stands before the run, as in `MAX_6`.
 */
const IN_WORD = String.raw`[A-Za-z\d.]_*`;

/**
 * What figures that lead no group follow: what no number starts after, as the `98` of
 * `10/20/98` and the `30` of `7:30` do not, and a written-out month, whose day the `5` of
 * `June 5` is.
 */
const NO_LEAD =
  String.raw`${IN_WORD}|${NUMERIC_LAST}(?:${HYPHEN}|[\u2013\u2014/,:])|` +
  String.raw`\b(?:${MONTH_PATTERN})\.?${INLINE_SPACE}+`;

/** One to three digits and a group space, which three digits after continue, as in `1 000`. */
const GROUP_LEAD = String.raw`(?<!${NO_LEAD})\d{1,3}${GROUP_SPACE}`;

const groupedBy = (separator: string) => String.raw`\d{1,3}(?:${separator}\d{3})+(?!\d)`;

/**
 * A whole number grouped in thousands by one kind of space throughout: `1 000`, `12 500`. It
 * never starts on a later group of another, so a long run of groups is read once, nor where
 * its first figures lead no group.
 */
export const SPACE_GROUPED =
  String.raw`(?=\d{1,3}${GROUP_SPACE}\d)(?<!${GROUP_LEAD}|${NO_LEAD})` +
  `(?:${GROUP_SPACES.map(groupedBy).join('|')})`;

/** A whole number in digits, grouped in thousands by commas or by spaces, or not at all. */
export const DIGITS =String.raw`${groupedBy(',')}|${SPACE_GROUPED}|\d+`;

const COUNT_THEN_GROUP = new RegExp(
  String.raw`^\d{1,3}(?:${GROUP_SPACE}\d{3})*${GROUP_SPACE}(?=[1-9]\d\d(?:\.\d+)?$)`,
);

/**
 * Where the last group of `raw`, grouped with spaces, starts, where that group is a number of
 * its own, with no leading zero, so the groups before it may be a count: 2 in `2 100`. Null
 * where `raw` is no such number.
 */
export function countBeforeGroup(raw: string): number | null {
  return COUNT_THEN_GROUP.exec(raw)?.[0].length ?? null;
}

const LINE_BREAK = String.raw`(?:\r\n?|[\n\v\f\u2028\u2029])`;

/** A line that starts a new block: blank, a list item, a heading, a quote or a table row. */
const NEW_BLOCK = String.raw`${INLINE_SPACE}*(?:${LINE_BREAK}|$|[-*+](?=\s|$)|\d+[.)](?=\s|$)|[#>|])`;

// The `(?<=...)` always holds. Read backwards in a lookbehind it is tested before the
// lookahead, and turns down a run of spaces with no line break at once, where the lookahead
// would walk the rest of the run from every space in it.
const SOFT_BREAK =
  String.raw`${INLINE_SPACE}*${LINE_BREAK}(?!${NEW_BLOCK})(?<=[\n\r\v\f\u2028\u2029])${INLINE_SPACE}*`;

/**
 * Whitespace inside one quantity but outside its number: on one line, or across a single
 * line break that only wraps the paragraph, as in `6` then `feet` on the next line.
 */
export const SOFT_SPACE = String.raw`(?:${SOFT_BREAK}|${INLINE_SPACE}*)`;

/**
 * `SOFT_SPACE` on either side of `token`, with at most one line break between them. `token`
 * may match nothing, but never ends in a space.
 */
export function softGap(token: string): string {
  // Space after the token only follows something other than space. After an empty token two
  // runs of space would meet, and a match failing after them would try every split of the run.
  return (
    String.raw`(?:${SOFT_SPACE}${token}(?:(?<!${INLINE_SPACE})${INLINE_SPACE}+)?|` +
    String.raw`${INLINE_SPACE}*${token}(?<!${INLINE_SPACE})${SOFT_BREAK})`
  );
}

// Unlike `\b`, this holds before the closing `_` of emphasis, as in `_175 degrees Celsius_`.
export const UNIT_END = String.raw`(?![A-Za-z\d])`;

/** Recipes and older prose write their numbers out: `one cup`, `three-quarters cup`. */
const CARDINALS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Multipliers, read only after a count: `a hundred`, `twenty-two hundred`. */
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };
const SCALE = Object.keys(SCALES).join('|');

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
  String.raw`(?:${HYPHEN}(?:${ONES.join('|')})(?!\w)|${INLINE_SPACE}+(?:${ONES.join('|')})(?!\w|${HYPHEN}))`;

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
const NOT_AFTER_COUNT = String.raw`(?<!\b(?:${CARD}|an?)${HYPHEN}?${SOFT_SPACE})`;

const SPACING = String.raw`(?:${SOFT_BREAK}|${INLINE_SPACE}+)`;

/**
 * A prefix that takes a number after its hyphen, as `sub-` does in `a sub-2 pound tent`. Four
 * figures from 1000 to 2999 after `mid-` are a year, as in `In mid-2024 miles were driven`.
 */
export const NUMBER_PREFIX =
  String.raw`\b(?:sub|under|over|near|mid(?!${HYPHEN}[12]\d{3}(?!\.?\d)))${HYPHEN}`;

/**
 * A hyphen that joins a number to the letters before it: one straight after the unit of a
 * quantity, as in `5ft-6ft`, `350 °F-375 °F`, `two feet-three feet` and
 * `60 miles per hour-70 miles per hour`, where it joins a range, or one after a prefix that
 * takes a number, as in `a sub-2 pound tent`. No unit has more than three words before its
 * last, as `pounds per square inch` has, and none is a number in words, so the `twenty` of
 * `five twenty-two` and the `hundred` of `two hundred-three` are no unit.
 */
const JOINING_HYPHEN =
  String.raw`(?:(?:${NUMERIC_LAST}|\b(?:${CARD})\b)${INLINE_SPACE}?(?:[°º˚]${INLINE_SPACE}?)?` +
  String.raw`(?:[A-Za-z]+${INLINE_SPACE}){0,3}[A-Za-z]+(?<!\b(?:${CARD}|${SCALE}|${FRAC}))${HYPHEN}|` +
  String.raw`${NUMBER_PREFIX})`;

/**
 * Where a written-out number may start: not inside a hyphenated word, unless the hyphen joins
 * it to a unit or a prefix (`JOINING_HYPHEN`), not straight after a tens word, and not after
 * `hundred` or `thousand` with at most a comma, `and` or `to` between. So whatever of
 * `catch-twenty-two`, `twenty-twenty`, `twenty five-pound` or
 * `between one hundred and two hundred` the table cannot read is left whole. A word ending
 * the line above counts as well.
 */
export const NOT_IN_COMPOUND =
  String.raw`(?<![A-Za-z]${HYPHEN}(?<!${JOINING_HYPHEN}))` +
  String.raw`(?<!\b(?:(?:${TENS.join('|')})${HYPHEN}?|(?:${SCALE}),?(?:${SPACING}(?:and|to))?)${SPACING})`;

/**
 * `body`, unless `guard` finds it is the tail of a longer number. The lookahead keeps the
 * costlier lookbehind to the few places where `body` can start.
 */
function unlessTail(guard: string, body: string): string {
  return String.raw`(?=${body})${guard}${body}`;
}

/** A cardinal of one word or two: `seven`, `twenty-two`, `twenty two`. */
const CARDINAL_WORDS = String.raw`(?:${COMPOUND}|${CARD})`;
const CARDINAL = unlessTail(NOT_IN_COMPOUND, CARDINAL_WORDS);

const COUNT = String.raw`(?:an?${INLINE_SPACE}+|${CARDINAL_WORDS}${SPACE_OR_HYPHEN})`;
const THOUSAND =
  String.raw`thousand\b(?:${INLINE_SPACE}+(?:${ONES.join('|')})${SPACE_OR_HYPHEN}hundred\b)?`;

/**
 * A count times `hundred` or `thousand`: `a hundred`, `twenty-two hundred`,
 * `two thousand five hundred`. A count of thousands may itself be a count of hundreds, with a
 * cardinal after it or not: `a hundred thousand`, `one hundred twenty thousand`,
 * `two hundred and fifty thousand`. The cardinal is the word straight before `thousand`, so
 * `one hundred and two hundred thousand` is no count. Straight after `between`, the `and`
 * joins a range, as in `between one hundred and two thousand`.
 */
const MULTIPLIED =
  String.raw`(?:(?<!\bbetween${SPACING})${COUNT}hundred${INLINE_SPACE}+and${INLINE_SPACE}+` +
  String.raw`${CARDINAL_WORDS}${SPACE_OR_HYPHEN}${THOUSAND}|` +
  String.raw`${COUNT}(?:(?:hundred(?:${INLINE_SPACE}+${CARDINAL_WORDS})?${SPACE_OR_HYPHEN})?` +
  String.raw`${THOUSAND}|hundred\b))`;

/**
 * A whole number in words: a cardinal, a multiplied count, or a multiplied count and then a
 * cardinal with or without `and`, as in `one hundred and twenty` and `one hundred twenty`.
 * A cardinal never stops short of the multiplier after it, so `between one hundred and two
 * hundred` is not `one hundred and two` and a stray `hundred`. Without `and`, a cardinal
 * hyphenated to what follows is not part of the number, since `two hundred two-foot boards`
 * can be two hundred boards.
 *
 * The first alternative ends every number that ends in a cardinal, so read backwards, as the
 * compound rules read the number before theirs, the pattern scans the cardinals once.
 */
function wholeWords(guard: string): string {
  return (
    String.raw`(?=an?${INLINE_SPACE}+(?:${SCALE})\b|${CARD})${guard}` +
    String.raw`(?:(?:${MULTIPLIED}${INLINE_SPACE}+(?:and${INLINE_SPACE}+|(?=${CARDINAL_WORDS}(?!\w|${HYPHEN}))))?` +
    String.raw`${CARDINAL_WORDS}(?!${SPACE_OR_HYPHEN}(?:${SCALE})\b)|${MULTIPLIED})`
  );
}

const WHOLE_WORDS = wholeWords(NOT_IN_COMPOUND);

/**
 * A whole number in words that may start straight after `hundred to` or `hundred and`, for
 * the second end of a range, whose `to` or `and` places it: `one hundred to two hundred`.
 */
export const SECOND_END_WORDS = wholeWords('');

const WORD_NUMBER = [
  String.raw`(?:${CARDINAL}|\d+)${INLINE_SPACE}+and${INLINE_SPACE}+(?:${CARD}|an?)${SPACE_OR_HYPHEN}(?:${FRAC})`,
  unlessTail(NOT_AFTER_AND + NOT_IN_COMPOUND, String.raw`(?:${CARD})${SPACE_OR_HYPHEN}(?:${FRAC})`),
  WHOLE_WORDS,
  unlessTail(NOT_AFTER_AND + NOT_IN_COMPOUND, String.raw`an?${INLINE_SPACE}+(?:${FRAC})`),
  unlessTail(NOT_AFTER_COUNT + NOT_IN_COMPOUND, String.raw`(?:${BARE_FRAC})`),
].join('|');

/** A whole number in digits or words: `2`, `1,200`, `two`, `twenty-two`, `a hundred`. */
export const WHOLE_NUMBER = String.raw`(?:${DIGITS}|${WHOLE_WORDS})`;

/**
 * Digits only: `3`, `1,200`, `1 200`, `1 1/2`, `2-3/4`, `1½`, `3/4`. A dash joins a range
 * only between these, because a written-out fraction contains its own hyphen: `one-half` is one
 * number, not a range running from `one` to `half`. `2-3/4` is a mixed number only where its
 * fraction is below one, which `parseNumber` decides.
 */
export const NUMERIC_PATTERN = [
  String.raw`[-−]?\d+${HYPHEN}\d+/\d+`,
  String.raw`[-−]?(?:${DIGITS})${INLINE_SPACE}+\d+/\d+`,
  String.raw`[-−]?(?:${DIGITS})${INLINE_SPACE}*${VULGAR_CLASS}`,
  String.raw`[-−]?\d+/\d+`,
  VULGAR_CLASS,
  String.raw`[-−]?(?:${DIGITS})(?:\.\d+)?`,
].join('|');

/**
 * Matches `3`, `3.5`, `1,200`, `1 1/2`, `1½`, `3/4`, `one`, `three-quarters`,
 * `two and a half`, `a quarter`, `one hundred and twenty`. The article in `a quarter` is
 * part of the match, so a caller that keeps it for a following noun has to split it off.
 */
export const NUMBER_PATTERN = `${NUMERIC_PATTERN}|${WORD_NUMBER}`;

function cardinal(word: string): number | undefined {
  if (word === 'a' || word === 'an') return 1;
  if (/^(?:0|[1-9]\d*)$/.test(word)) return Number(word);
  return CARDINALS[word];
}

/**
 * `three-quarters`, `twenty-two`, `one and one-half`, `two and a half`, `a quarter`, `half`,
 * `one hundred and twenty`, `two thousand five hundred`.
 */
function parseWords(text: string): number | null {
  const parts = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w !== 'and');
  if (parts.length === 0) return null;

  let total = 0;
  let group = 0;
  for (let i = 0; i < parts.length; i++) {
    const word = parts[i]!;
    const scale = SCALES[word];
    if (scale !== undefined) {
      if (group === 0) return null;
      if (word === 'hundred') group *= scale;
      else {
        total += group * scale;
        group = 0;
      }
      continue;
    }
    const denominator = DENOMINATORS[word];
    if (denominator !== undefined) {
      // A cardinal directly before it is the numerator: `three quarters`.
      const numerator = i > 0 && cardinal(parts[i - 1]!) !== undefined ? 0 : 1;
      group += numerator / denominator;
      continue;
    }
    let count = cardinal(word);
    if (count === undefined) return null;
    // A denominator after the pair divides all of it: `twenty-three quarters`.
    if (TENS.includes(word) && ONES.includes(parts[i + 1] ?? '')) count += CARDINALS[parts[++i]!]!;
    const next = parts[i + 1];
    if (next && DENOMINATORS[next] !== undefined) group += count / DENOMINATORS[next]!;
    else group += count;
  }
  return total + group;
}

/**
 * The value `raw` is written as, or null where it is not a finite number, as `5/0` is not, or
 * its whole part has a leading zero, as `007` and `025` do.
 */
export function parseNumber(raw: string): number | null {
  const value = readNumber(raw);
  return value !== null && Number.isFinite(value) ? value : null;
}

// A space before a fraction's numerator is the gap of a mixed number, as in `1 100/200`.
const GROUP_SPACE_IN_NUMBER = new RegExp(String.raw`(?<=\d)${GROUP_SPACE}(?=\d{3}(?![\d/]))`, 'g');

function readNumber(raw: string): number | null {
  const text = plainHyphens(raw.trim())
    .replace(/−/g, '-')
    .replace(/,/g, '')
    .replace(GROUP_SPACE_IN_NUMBER, '');
  if (/[a-z]/i.test(text)) return parseWords(text);
  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^-/, '');
  // A whole part with a leading zero is a code or a name, as `007` is, not a quantity.
  if (/^0\d/.test(body)) return null;

  const vulgar = body.match(new RegExp(`^(\\d*)\\s*(${VULGAR_CLASS})$`));
  if (vulgar) {
    const whole = vulgar[1] ? Number(vulgar[1]) : 0;
    return sign * (whole + VULGAR[vulgar[2]!]!);
  }

  const mixed = body.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return sign * (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));

  // `1-3/2` runs from 1 to 3/2, so only a fraction below one makes a mixed number.
  const hyphenated = body.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (hyphenated) {
    const [numerator, denominator] = [Number(hyphenated[2]), Number(hyphenated[3])];
    return numerator < denominator ? sign * (Number(hyphenated[1]) + numerator / denominator) : null;
  }

  const fraction = body.match(/^(\d+)\/(\d+)$/);
  if (fraction) return sign * (Number(fraction[1]) / Number(fraction[2]));

  return sign * Number(body);
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
 * A date in words up to where its year starts: a month and day as the date rules read and
 * write them, `Oct 22, ` and `22 October `, a month and day with no comma, `October 22 `, or
 * a month alone, `May `.
 */
const DATE_BEFORE_YEAR =
  String.raw`\b(?:(?:${MONTH_PATTERN})\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+))?|` +
  String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH_PATTERN})\.?\s+)`;

/**
 * Letters and then `-`, which join a name such as `catch-22` to its number, or U+2010 or
 * U+2011, which only join words, unless `JOINING_HYPHEN` joins a quantity's unit or a prefix
 * to the number, as in `5ft‐6ft` and `a sub-2 pound tent`.
 */
const NAME_HYPHEN = String.raw`(?:\b[A-Za-z]+-|[${UNICODE_HYPHENS}])(?<!${JOINING_HYPHEN})`;

/** Not inside a word or a decimal, as `IN_WORD` reads one. */
export const OUTSIDE_WORD =
  // The lookahead comes first so the lookbehind walks a run of `_` only from its end.
  String.raw`(?!_)(?<!${IN_WORD})`;

/**
 * Where a number of a measurement may start: not inside a word, a decimal or a number such
 * as `15½`, and not after a hyphen that joins a name or a word to it (`NAME_HYPHEN`), as in
 * `catch-22`. Straight after a
 * digit or vulgar fraction and then a hyphen, dash, `/`, `,` or `:` it is the tail of a date
 * or of a range written tight, of a fraction, of a grouped number such as `1,005`, or the
 * minutes of a time such as `7:30`. Straight after a currency sign it is a price, and four
 * figures straight after `Oct 22,`, `22 October`, `October 22` or `May` are the year of a
 * date. The optional space after the sign matches the currency rule, which reads `$ 5` as
 * money. Emphasis may open on it, as `OUTSIDE_WORD` reads it. Three figures straight after
 * one to three and a space are a group of a number such as `1 000`, while one or two are a
 * number of their own, as the `4` of `Rooms 3 4 feet` is.
 */
export const NUMBER_START =
  String.raw`${OUTSIDE_WORD}(?<!${VULGAR_CLASS}|${NAME_HYPHEN}|` +
  String.raw`${NUMERIC_LAST}(?:${HYPHEN}|[\u2013\u2014/,:])|[$£€]\s?)` +
  String.raw`(?!(?=\d{4}(?!\d))(?<=${DATE_BEFORE_YEAR}))` +
  String.raw`(?!(?=\d{3}(?!\d))(?<=${GROUP_LEAD}))`;

/**
 * Where the number of a measurement may start: where `NUMBER_START` lets a number start, and
 * where a number in words is not the tail of a longer one, which `NOT_IN_COMPOUND` decides. A
 * rule whose pattern starts at `NUMBER_START` reads the same, since every number in words in
 * `NUMBER_PATTERN` carries that guard. A rule that finds its measurement from a looser start
 * asks this of what it finds.
 */
export const MEASUREMENT_START = String.raw`${NUMBER_START}(?:(?![A-Za-z])|${NOT_IN_COMPOUND})`;

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

/** A comma and the space after it, between two figures of a list: the first of `5, 10 and 15 feet`. */
const LIST_COMMA = String.raw`${softGap(',')}(?<=\s)`;

/**
 * What joins the last figure of a list to the one before it: a comma, `and` or `or`, or a
 * comma and either word, as in `5, 10, and 15 feet`.
 */
export const LIST_END = String.raw`${softGap(String.raw`(?:,(?:${SOFT_SPACE}(?:and|or))?|and|or)`)}(?<=\s)`;

/** Where a figure is the day of a date, as the `22` of `Oct 22, 5 and 10 feet` is. */
const DAY_OF_MONTH = new RegExp(String.raw`(?<=\b(?:${MONTH_PATTERN})\.?${INLINE_SPACE}+)`, 'y');

export interface ListFigure {
  raw: string;
  start: number;
  value: number;
  /** What joins it to the figure after it. */
  join: string;
}

/**
 * Reads back from a figure along the list it is part of, giving the figures before it in
 * order: from the `15` of `5, 10 and 15 feet`, the `5` and `10`. Each figure is one that
 * `figure` matches, and starts where a measurement can. `last` says the figure ends the list,
 * so the join before it may be the list's `and`, `or` or comma. Every join before that is a
 * comma. `after` is the figure after it, if any. A figure that cannot open a range with the
 * one after it ends the walk, as the year of `In 2024, 5 and 10 feet` does, and so does the
 * day of a date, or a figure out of the order the rest of the list runs in, as the count of
 * `Serves 4, 2 or 3 pounds beef` is.
 */
export function listReader(
  figure: string,
): (text: string, start: number, value: number, last: boolean, after?: number) => ListFigure[] {
  const before = (join: string) =>
    new RegExp(String.raw`(?<=${NUMBER_START}(${figure})(${join}))`, 'diy');
  const comma = before(LIST_COMMA);
  const end = before(LIST_END);
  return (text, start, value, last, after) => {
    const figures: ListFigure[] = [];
    let at = start;
    let next = value;
    let order = after === undefined ? 0 : Math.sign(after - value);
    for (let pattern = last ? end : comma; ; pattern = comma) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (match === null) break;
      const from = match.indices![1]![0];
      const parsed = parseNumber(match[1]!);
      if (parsed === null || !canBeRange(text, from, parsed, next)) break;
      const step = Math.sign(next - parsed);
      if (order !== 0 && step !== 0 && step !== order) break;
      DAY_OF_MONTH.lastIndex = from;
      if (DAY_OF_MONTH.test(text)) break;
      figures.push({ raw: match[1]!, start: from, value: parsed, join: match[2]! });
      order ||= step;
      at = from;
      next = parsed;
    }
    return figures.reverse();
  };
}

function roundToSignificant(value: number, figures: number): number {
  if (value === 0) return 0;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (figures - magnitude);
  return Math.round(value * factor) / factor;
}

const GROUPED_SOURCE = new RegExp(String.raw`\d(,|${GROUP_SPACE})\d{3}(?![\d/])`);

// A list's figures are each formatted with the same `raws`, so its separator is found once for
// the list, not once for every figure.
const SEPARATORS = new WeakMap<readonly string[], string | undefined>();

/** The separator the first of `raws` that groups its thousands groups them with. */
function thousandsSeparator(raws: readonly string[]): string | undefined {
  if (SEPARATORS.has(raws)) return SEPARATORS.get(raws);
  const separator = raws.map((raw) => GROUPED_SOURCE.exec(raw)?.[1]).find((found) => found !== undefined);
  SEPARATORS.set(raws, separator);
  return separator;
}

/**
 * `text` grouped in thousands: from four digits by `separator`, or from five by commas where
 * the source grouped none.
 */
function group(text: string, separator?: string): string {
  const [whole = '', decimal] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  if (digits.length < (separator === undefined ? 5 : 4)) return text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator ?? ',');
  return sign + grouped + (decimal ? `.${decimal}` : '');
}

function trim(value: number, maxDecimals: number, separator?: string): string {
  return group(String(Number(value.toFixed(maxDecimals))), separator);
}

/**
 * `value` written to `precision`, its thousands grouped as the source numbers `raws` group
 * theirs: `2,025 miles` gives `3,259 kilometres`, `1 000 miles` gives `1 600 kilometres`, and
 * `2025 miles` gives `3259 kilometres`.
 */
export function formatNumber(
  value: number,
  precision: Precision,
  sourceFigures: number,
  maxDecimals: number,
  raws: readonly string[],
): string {
  const separator = thousandsSeparator(raws);
  if (typeof precision === 'number') return group(value.toFixed(precision), separator);
  if (precision === 'exact') return trim(value, maxDecimals, separator);
  // `natural`: never claim less than two figures, and never more than the source did.
  return trim(roundToSignificant(value, Math.max(2, sourceFigures)), 4, separator);
}

/** A Fahrenheit value that reads as an oven dial setting rather than a measurement. */
export function isOvenSetting(fahrenheit: number): boolean {
  return Number.isInteger(fahrenheit) && fahrenheit >= 200 && fahrenheit % 25 === 0;
}

/**
 * Oven temperatures are written in fives, so `350F` should land on 175C rather than
 * 176.7C. The habit only applies to the oven range; `100F` is a fever, not a setting. The
 * thousands are grouped as `formatNumber` groups them from the source numbers `raws`, so
 * `2,000°F` gives `1,095°C`.
 */
export function formatTemperature(
  celsius: number,
  precision: Precision,
  source: number,
  maxDecimals: number,
  raws: readonly string[],
): string {
  const separator = thousandsSeparator(raws);
  if (typeof precision === 'number') return group(celsius.toFixed(precision), separator);
  if (precision === 'exact') return trim(celsius, maxDecimals, separator);
  if (isOvenSetting(source)) return group(String(Math.round(celsius / 5) * 5), separator);
  return group(String(Math.round(celsius * 10) / 10), separator);
}
