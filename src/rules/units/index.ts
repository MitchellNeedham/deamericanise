import { buildGate, resolveOptions, type Gate } from '../../config.js';
import type { Change, Confidence, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import { MONTH_PATTERN } from '../dates.js';
import { CLOSING, LIST_MARKER, OPENING, endsSentence } from '../sentence.js';
import {
  COMPOUNDS,
  MEASURES,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
} from './definitions.js';
import { BARE_CELSIUS_FIGURE, DEGREES, FAHRENHEIT, fahrenheitTemperatures } from './fahrenheit.js';
import { PREPOSITION_IN } from './money.js';
import {
  COUNTED_FRACTION,
  FRACTION_WORDS,
  HYPHEN,
  INLINE_SPACE,
  LIST_END,
  MEASUREMENT_START,
  NOT_IN_COMPOUND,
  NUMBER_PATTERN,
  NUMBER_START,
  NUMERIC_FIRST,
  NUMERIC_LAST,
  NUMERIC_PATTERN,
  SECOND_END_WORDS,
  SOFT_SPACE,
  WHOLE_NUMBER,
  canBeRange,
  formatNumber,
  formatTemperature,
  isOvenSetting,
  listReader,
  parseNumber,
  plainHyphens,
  significantFigures,
  softGap,
  type ListFigure,
} from './number.js';

const CONTEXT_WINDOW = 48;
/** Between a number and its unit: a space, a hyphen (`6-foot`), or nothing (`6ft`). */
const GAP = softGap(`${HYPHEN}?`);
const RANGE_JOIN = softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and|or)`);
const DIMENSION_JOIN = softGap('(?:x|×|by)');
const TIGHT_HYPHEN = new RegExp(`^${HYPHEN}$`);

/**
 * The second number of a range or dimension is not a measurement of its own, even where the
 * pair does not match as a whole: `14 1/2 gallon` in `2024-03-14 1/2 gallon`.
 */
const NOT_SECOND_OF_PAIR =
  String.raw`(?<!${NUMERIC_LAST}${softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and|or|x|×|by)`)})`;

/** A range's first number and its join, ending where the range's second number starts. */
const RANGE_BEFORE = new RegExp(
  String.raw`(?<=${NUMBER_START}(${NUMERIC_PATTERN})${RANGE_JOIN})(?=${NUMERIC_FIRST})`,
  'diy',
);

const readListBefore = listReader(NUMBER_PATTERN);

/**
 * The figures before a range's first end, at `start` and worth `low`, where the range is the
 * last two figures of a list, as `10 and 15` is in `5, 10 and 15 feet`. `high` is the second
 * end. A list ends in `and`, `or` or a comma, so `to` and a dash end none. Null where a comma
 * joins the range and no figure comes before it, as in `Serves 4, 2 pounds`, a count and then
 * a measurement.
 */
function figuresBefore(
  text: string,
  start: number,
  low: number,
  high: number,
  join: string,
  read = readListBefore,
): ListFigure[] | null {
  if (!/^\s*(?:,|and|or)/i.test(join)) return [];
  const figures = read(text, start, low, false, high);
  return figures.length === 0 && join.includes(',') ? null : figures;
}

/**
 * The figures before a measurement's first figure, at `start` and worth `first`, that it is
 * the end of a list with. For a range, `join` joins its ends and `high` is the second. One
 * figure ends a list only of three or more, as the `8` of `4, 6, 8 inches` does.
 */
function listedBefore(
  text: string,
  start: number,
  first: number,
  range?: { join: string; high: number },
  read = readListBefore,
): ListFigure[] {
  if (range !== undefined) return figuresBefore(text, start, first, range.high, range.join, read) ?? [];
  const figures = read(text, start, first, true);
  return figures.length >= 2 ? figures : [];
}

/** A join as a converted range or list writes it: ` to `, ` and `, ` or `, `, `, `, or `, or `-`. */
function separator(join: string): string {
  const [, comma = '', word] = /^\s*(,?)\s*(to|and|or)?\s*$/i.exec(join) ?? [];
  if (word !== undefined) return `${comma} ${word.toLowerCase()} `;
  return comma ? ', ' : '-';
}

/** The figures of a range or list with the joins between them. */
function interleave(figures: string[], joins: string[]): string {
  return figures.reduce((out, figure, i) => out + joins[i - 1]! + figure);
}

/**
 * The number at `start` is the second end of a range, as the `10` of `5 - 10 feet` is, or
 * the last figure of a list, as the `8` of `4, 6, 8 inches` is, and not a measurement of its
 * own, even where the range does not match as a whole. A first number that cannot open the
 * range leaves it free: `Price $5 - 10 inches`, `In 2024 - 5 feet`, and the inches of
 * `2 feet 6 to 3 feet`.
 */
function endsRange(text: string, start: number, value: number): boolean {
  RANGE_BEFORE.lastIndex = start;
  const before = RANGE_BEFORE.exec(text);
  if (before === null) return listedBefore(text, start, value).length > 0;
  const lowStart = before.indices![1]![0];
  if (isHeightInches(text, lowStart)) return false;
  const low = parseNumber(before[1]!);
  return low === null || canBeRange(text, lowStart, low, value);
}

/** A number the range and dimension rules read: any in digits, and a whole number in words. */
const READABLE_NUMBER = new RegExp(String.raw`^(?:${NUMERIC_PATTERN}|${SECOND_END_WORDS})$`, 'i');

const isWritten = (raw: string) => /[a-z]/i.test(raw);

/** `half` or `a quarter`: one word that `READABLE_NUMBER` refuses is a fraction with no count. */
const isUncounted = (raw: string) => !READABLE_NUMBER.test(raw) && /^(?:an?\s+)?[a-z]+$/i.test(raw);

/**
 * What the range rule does with a range that has an end in words. `to` and `or` join whole
 * numbers as they join digits, and so does `and` after `between`, unless the `and` is inside
 * one number, as in `between one hundred and twenty feet and two hundred feet`. `half` or
 * `a quarter` opens an idiom, as in `reduce by half to 2 quarts`, so it is not a range. A
 * dash, or a fraction in words, cannot be read whole, so the range is held as written:
 * `five-10 miles`, `two and a half to three miles`. So is `two to three hundred`, which may
 * mean 200 to 300.
 */
function writtenRange(
  text: string,
  start: number,
  low: string,
  join: string,
  high: string,
): 'read' | 'hold' | 'skip' {
  if (isUncounted(low) || isUncounted(high)) return 'skip';
  const word = /^\s*(to|and|or)\s*$/i.exec(join)?.[1]!.toLowerCase();
  if (word === 'and') {
    const between = /\bbetween\s+$/i.test(text.slice(Math.max(0, start - 16), start));
    if (!between || READABLE_NUMBER.test(low + join + high)) return 'skip';
  }
  const shared = sharesScale(low, high);
  return word !== undefined && !shared && READABLE_NUMBER.test(low) && READABLE_NUMBER.test(high)
    ? 'read'
    : 'hold';
}

/** `two` before `three hundred` may mean 200. */
function sharesScale(low: string, high: string): boolean {
  const scaled = (end: string) => /\b(?:hundred|thousand)\b/i.test(end);
  return isWritten(low) && !scaled(low) && scaled(high) && !/^an?\s/i.test(high);
}

/**
 * `writtenRange` for the figures of a range or a list, with the joins between them. A list's
 * `and` needs no `between`, as in `five, ten and fifteen feet`, but every figure has to be a
 * number `READABLE_NUMBER` reads, sharing no scale with the next, or the list is held.
 */
function writtenList(text: string, start: number, raws: string[], joins: string[]): 'read' | 'hold' | 'skip' {
  if (raws.length === 2) return writtenRange(text, start, raws[0]!, joins[0]!, raws[1]!);
  const readable = raws.every((raw) => READABLE_NUMBER.test(raw));
  return readable && !raws.some((raw, i) => i > 0 && sharesScale(raws[i - 1]!, raw)) ? 'read' : 'hold';
}

/**
 * A word that makes the number after it a noun, so a `by` after the number gives an amount
 * and not a second side: `raise each one by two inches`, `move all three by a foot`.
 */
const NUMBER_AS_NOUN = new RegExp(
  String.raw`\b(?:all|both|each|every|any|these|those|which|other|another|last|first|next|` +
    String.raw`remaining|either|neither)\s+$`,
  'i',
);

/** `this` and `that` make a noun only of one: `this one`, but `this ten by twelve foot room`. */
const ONE_AS_NOUN = /\b(?:this|that)\s+$/i;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Alias {
  measure: Measure;
  isWord: boolean;
  /** The matched form was singular, as in `a 9 inch dish`. */
  isSingular: boolean;
}

/** `an hour` before `ago` or `later` is a time, so `1 mile an hour ago` is a distance. */
const AN_HOUR = / an hour$/i;
const NOT_A_TIME = String.raw`(?!\s+(?:ago|later|earlier|before|after)\b)`;

function alternate(aliases: string[]): string {
  return aliases
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((alias) => escape(alias) + (AN_HOUR.test(alias) ? NOT_A_TIME : ''))
    .join('|');
}

function isKept(measure: Measure, skip: Set<string>, forced: Record<string, boolean>): boolean {
  // Turning the rule on by id overrides both a dialect that keeps the unit and a
  // measure that is kept everywhere by default.
  return (skip.has(measure.keep) || measure.keptByDefault === true) && forced[measure.id] !== true;
}

function buildIndex(
  skip: Set<string>,
  forced: Record<string, boolean>,
): { alternation: string; words: string; byAlias: Map<string, Alias> } {
  const byAlias = new Map<string, Alias>();
  for (const measure of MEASURES) {
    if (isKept(measure, skip, forced)) continue;
    for (const w of measure.words) {
      byAlias.set(w.toLowerCase(), { measure, isWord: true, isSingular: SINGULAR_WORDS.has(w) });
    }
    for (const a of measure.abbrevs) {
      byAlias.set(a.toLowerCase(), { measure, isWord: false, isSingular: false });
    }
  }
  const alternation = alternate([...byAlias.keys()]);
  const words = alternate([...byAlias].filter(([, alias]) => alias.isWord).map(([key]) => key));
  return { alternation, words, byAlias };
}

/** The document says which kind of unit it means, and it is not the American one. */
function isAmbiguousHere(measure: Measure, text: string): boolean {
  return measure.ambiguousWhen !== undefined && measure.ambiguousWhen.test(text);
}

let lastText = '';
let lastPlain = '';

/**
 * `text` as the checks on the words around a measurement read it, since their patterns name
 * only the hyphen-minus. The rules ask about one text many times in a row, so the last one is
 * kept.
 */
function contextText(text: string): string {
  if (text !== lastText) {
    lastText = text;
    lastPlain = plainHyphens(text);
  }
  return lastPlain;
}

function isConventional(ctx: RuleContext, measure: Measure, start: number, end: number): boolean {
  const rules = measure.conventional;
  if (!rules || !ctx.options.units.respectConventions) return false;
  const text = contextText(ctx.text);
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = text.slice(end, end + CONTEXT_WINDOW);
  return Boolean((rules.before?.test(before)) || (rules.after?.test(after)));
}

function isOtherSense(ctx: RuleContext, alias: Alias, start: number, end: number): boolean {
  return alias.isWord && alias.measure.otherSense?.(contextText(ctx.text), start, end) === true;
}

/** The words title case leaves in lower case between capitalised ones. */
const TITLE_CASE_MINOR = [
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of',
  'off', 'on', 'per', 'to', 'up', 'via', 'from', 'into', 'onto', 'over', 'with',
];

// Both case-sensitive, so `10 miles North of town` and `10 MILES TO GO` are measurements.
const CAPITALISED = /^[A-Z][a-z]/;
const CAPITALISED_NEXT = new RegExp(
  String.raw`^(?=\s)${SOFT_SPACE}(?:(?:${TITLE_CASE_MINOR.join('|')})${INLINE_SPACE}+){0,3}[A-ZÀ-ÖØ-Þ]`,
);

/**
 * Whether the unit word written as `written`, before the text from `end`, is part of a name,
 * as `Miles` is in `Track 7 Miles Davis`. A unit word follows its number, so a capital on it
 * is never the one that opens a sentence. Beside another capitalised word, or beside the
 * lower-case words of title case and then one, it names something, and title case counts:
 * `It is 10 Miles to Town` is a title.
 */
function isPartOfName(text: string, written: string, end: number): boolean {
  return CAPITALISED.test(written) && CAPITALISED_NEXT.test(text.slice(end, end + CONTEXT_WINDOW));
}

const UNIT_WORDS = new Set(MEASURES.flatMap((measure) => measure.words.map((word) => word.toLowerCase())));

const OTHER_SENSES = new Map(
  MEASURES.flatMap(({ words, otherSense }) =>
    otherSense ? words.map((word) => [word.toLowerCase(), otherSense] as const) : [],
  ),
);

/**
 * The number that ends where a unit word starts, begun where the rules begin it: a range at
 * its first number, and `1,500` or `two and a half` whole. A list is begun by `listedBefore`.
 */
const NUMBER_BEFORE_UNIT = new RegExp(
  String.raw`(?<![\w.])(?:(${NUMERIC_PATTERN})(${RANGE_JOIN}))?(${NUMBER_PATTERN})${GAP}$`,
  'i',
);

/** Far enough back to hold the longest range of numbers anyone writes before a unit. */
const NUMBER_REACH = 64;

/**
 * Whether the measurement rules read the written-out unit `text.slice(unitStart, unitEnd)`
 * in another sense over the quantity it ends, as they read `It cost 1,500 pounds` as money
 * and `Track 7 Miles Davis` as a name. Detection asks this, so it never counts as an imperial
 * unit what the rules leave alone.
 */
export function isUnitInOtherSense(text: string, unitStart: number, unitEnd: number): boolean {
  const unit = text.slice(unitStart, unitEnd);
  if (UNIT_WORDS.has(unit.toLowerCase()) && isPartOfName(text, unit, unitEnd)) return true;
  const otherSense = OTHER_SENSES.get(unit.toLowerCase());
  if (!otherSense) return false;
  const from = Math.max(0, unitStart - NUMBER_REACH);
  const number = NUMBER_BEFORE_UNIT.exec(text.slice(from, unitStart));
  if (number === null) return false;
  const start = from + number.index;
  const [first, high] = [parseNumber(number[1] ?? number[3]!), parseNumber(number[3]!)];
  const range = number[1] === undefined || high === null ? undefined : { join: number[2]!, high };
  const listed = first === null ? [] : listedBefore(text, start, first, range);
  return otherSense(contextText(text), listed[0]?.start ?? start, unitEnd);
}

/**
 * A determiner opening the phrase, as in `a 9 inch dish`. A count opens it as a determiner
 * does, so `2 x 4 ounce cans` keeps the singular.
 */
const DETERMINER_BEFORE = /(?:\b(?:a|an|the|this|that|each|every|per|another)\s+|\d\s*[x×]\s*)$/i;

/** The sizes a length gives, as in `6 feet long` and `a 6 foot long table`. */
const SIZES = ['thick', 'wide', 'long', 'tall', 'deep', 'high'];

/**
 * Words that cannot open a noun straight after a measurement: prepositions, sizes and
 * comparisons, adverbs of place, slope and time, pronouns, determiners, conjunctions and
 * auxiliary verbs. A unit before one is a quantity, as in `a quarter mile later` and
 * `6 foot when he left`. A hyphen after one makes a modifier of it, as in `deep-dish`.
 */
const NOT_A_NOUN = [
  'of', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'to', 'from', 'with', 'per', 'into',
  'through', 'across', 'past', 'along', 'beyond', 'behind', 'about', 'against', 'among',
  'between', 'during', 'near', 'onto', 'toward', 'towards', 'under', 'underneath', 'beneath',
  'upon', 'via', 'within', 'without', 'beside', 'like',
  ...SIZES, 'short', 'further', 'farther', 'more',
  'less', 'longer', 'shorter', 'wider', 'taller', 'deeper', 'higher', 'closer', 'too',
  'enough', 'apiece', 'each', 'only',
  'away', 'apart', 'down', 'up', 'north', 'south', 'east', 'west', 'ahead', 'back', 'out',
  'off', 'around', 'over', 'overhead', 'above', 'below', 'inside', 'outside', 'inland',
  'offshore', 'here', 'there', 'everywhere', 'overall', 'lengthwise', 'crosswise',
  'uphill', 'downhill', 'upstream', 'downstream',
  'later', 'earlier', 'ago', 'before', 'after', 'now', 'today', 'already', 'again',
  'i', 'me', 'he', 'him', 'she', 'it', 'we', 'us', 'they', 'them', 'you', 'which', 'who',
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their', 'my',
  'our', 'your', 'some', 'any', 'no', 'all', 'both', 'every',
  'but', 'so', 'if', 'when', 'while', 'as', 'than', 'because', 'since', 'until', 'unless',
  'though', 'although', 'whereas', 'whether', 'where', 'then', 'yet', 'nor',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'has', 'have', 'had', 'does', 'did',
  'will', 'would', 'should', 'could',
];

/** Every unit the rules read. */
const UNIT_FORMS = alternate(MEASURES.flatMap((measure) => [...measure.words, ...measure.abbrevs]));

/**
 * The start of a word that may be a noun. A number in words, alone or with its unit
 * (`one-inch`, `onelbs`), or a date is not one. Another rule may rewrite either to start
 * with a digit, so reading it as a noun would leave the measurement to a second run.
 */
const NOUN_START =
  String.raw`(?!(?:${NOT_A_NOUN.join('|')}|(?:${NUMBER_PATTERN})(?:${GAP}(?:${UNIT_FORMS}))?)` +
  String.raw`(?!\w|${HYPHEN})|(?:${MONTH_PATTERN})\.?\s+\d)[a-z]`;

/** A word straight after a measurement that may be a noun it describes. */
const MODIFIES_A_NOUN = new RegExp(String.raw`^(?:\s|${HYPHEN})+${NOUN_START}`, 'i');

const SIZE = String.raw`(?:${SIZES.join('|')})(?!\w|${HYPHEN})`;

/**
 * Straight after a unit of length, the only kind that gives a size: `1 pound thick bacon` is
 * a quantity of bacon.
 */
const AFTER_A_LENGTH = String.raw`(?<=(?<![A-Za-z])(?:${alternate(
  MEASURES.filter((measure) => measure.id.startsWith('units.length.')).flatMap((measure) => [
    ...measure.words,
    ...measure.abbrevs,
  ]),
)}))`;

/** Another size beside the first, as in the `by 3 foot wide` of `6 foot long by 3 foot wide`. */
const ANOTHER_SIZE =
  String.raw`(?:,?\s+(?:and|or|by|x|×)|,)\s+(?:${NUMBER_PATTERN})${GAP}(?:${UNIT_FORMS})` +
  String.raw`(?:\s|${HYPHEN})+${SIZE}`;

/**
 * A size straight after a length, then the noun the length describes through it, as in
 * `a 6 foot long table` and `a 6-foot-tall fence`. A thing has at most three sizes, and the
 * bound keeps each measurement from reading every size in a long list.
 */
const SIZES_A_NOUN = new RegExp(
  String.raw`${AFTER_A_LENGTH}(?:\s|${HYPHEN})+${SIZE}(?:${ANOTHER_SIZE}){0,2}\s+${NOUN_START}`,
  'iy',
);

/** Whether the length ending at `end` gives the size of a noun after it. */
function sizesNoun(text: string, end: number): boolean {
  SIZES_A_NOUN.lastIndex = end;
  return SIZES_A_NOUN.test(text);
}

const HYPHEN_BEFORE_SIZE = new RegExp(String.raw`${AFTER_A_LENGTH}${HYPHEN}(?=${SIZE})`, 'iy');

/**
 * Whether the singular unit word ending at `end` describes the noun after it, so its metric
 * unit stays singular too: `a 9 inch dish`, `9 inch pans`, `one-inch slices`. The unit
 * follows a number worth `value` that starts at `numberStart`, across `gap`. A determiner
 * opening the phrase says so, as does a hyphen tying the number to the unit, or the singular
 * after a number above one, which would otherwise take the plural. One and a fraction take
 * the singular anyway, so `one quart small onions` and `1/2 pound ground beef` are
 * quantities with the `of` left out, read as `one quart of small onions` would be. A length
 * that gives the size of a noun describes it whatever its number, as `1/2 inch thick slices`
 * does.
 */
function describesNoun(
  text: string,
  numberStart: number,
  value: number,
  gap: string,
  end: number,
): boolean {
  if (sizesNoun(text, end)) return true;
  if (!MODIFIES_A_NOUN.test(text.slice(end))) return false;
  return (
    Math.abs(value) > 1 ||
    plainHyphens(gap).includes('-') ||
    DETERMINER_BEFORE.test(text.slice(Math.max(0, numberStart - 24), numberStart))
  );
}

/** The count of `two quarter`: a cardinal, then a space and a singular fraction word. */
const COUNT_APART = new RegExp(
  String.raw`^(?!an?\s)[a-z]+${INLINE_SPACE}+(?=(?:half|quarter|third|fourth|eighth|sixteenth)$)`,
  'i',
);

const BARE_INCH = new RegExp(String.raw`${PREPOSITION_IN}$`, 'i');

const COUNT_IN_WORDS = new RegExp(String.raw`^(?:${SECOND_END_WORDS})$`, 'i');

/** A determiner that takes one of a noun, so the number after it cannot count the noun. */
const ONE_OF_A_NOUN_BEFORE = /\b(?:a|an|this|that|each|every|per|another)\s+$/i;

/** A size and the join of a list of sizes, as the `long, ` of `two foot-long, three foot-wide`. */
const SIZE_IN_A_LIST_BEFORE = new RegExp(String.raw`\b${SIZE}(?:,?\s+(?:and|or|by|x|×)|,)\s+$`, 'i');

/** A hyphen tying a length to its size, then the noun they describe, as in `foot-long subs`. */
const TIED_TO_A_SIZE = new RegExp(String.raw`${AFTER_A_LENGTH}${HYPHEN}${SIZE}\s+${NOUN_START}`, 'iy');

/**
 * Whether the count in words `raw`, spaced before a unit word that ends at `end` and that a
 * hyphen ties to its size, counts the noun after them, as `two` does in `two foot-long subs`.
 * After a determiner that takes one of a noun, or in a list of sizes, it is the number of
 * units, as in `a two foot-long sub`.
 */
function countsSizedNoun(text: string, start: number, raw: string, gap: string, end: number): boolean {
  if (!COUNT_IN_WORDS.test(raw) || !/^\s+$/.test(gap)) return false;
  TIED_TO_A_SIZE.lastIndex = end;
  if (!TIED_TO_A_SIZE.test(text)) return false;
  const before = text.slice(Math.max(0, start - 24), start);
  return !ONE_OF_A_NOUN_BEFORE.test(before) && !SIZE_IN_A_LIST_BEFORE.test(before);
}

/**
 * A preposition that takes a year, opening a sentence or clause, straight before where a number
 * starts: at the start of the text or a line, or of a list item there, or after a stop, comma,
 * semicolon or colon, with only spaces and opening quotes or brackets between.
 */
const YEAR_PREPOSITION_BEFORE = new RegExp(
  String.raw`(?<=(?:(?:^|[\n\r])(?:[^\S\n\r]*${LIST_MARKER})?|[.!?…]${CLOSING}*\s|[,;:])` +
    String.raw`[^\S\n\r]*${OPENING}*` +
    String.raw`(in|by|since|until|before|after|during)\s+)`,
  'diy',
);

/** Punctuation or the end of the text, after which a unit word starts no noun. */
const CLOSES_CLAUSE = /\s*(?:[,.;:!?)\]]|$)/y;

/**
 * Whether the number `raw`, spaced before the unit word that ends at `end`, may be a year, as
 * `2024` is in `In 2024 yard sales rose` and `In 2024 miles were driven`: four figures from 1000
 * to 2999 straight after a preposition that takes a year and opens a sentence or clause. In the
 * middle of a clause they are a quantity, as in `The wreck lies in 1500 feet of water.`, and so
 * they are before a unit word that closes the clause, which names no thing the year could
 * date: `It rose by 1200 feet.`
 */
function mayBeYear(text: string, start: number, raw: string, gap: string, end: number): boolean {
  if (!/^[12]\d{3}$/.test(raw) || !/^\s+$/.test(gap)) return false;
  CLOSES_CLAUSE.lastIndex = end;
  if (CLOSES_CLAUSE.test(text)) return false;
  YEAR_PREPOSITION_BEFORE.lastIndex = start;
  const preposition = YEAR_PREPOSITION_BEFORE.exec(text);
  if (preposition === null) return false;
  // After a number on the line above, `in` may be the inch of a wrapped height and `by` a
  // dimension's join, so the reading would change once a first run converts that number.
  NUMBER_ENDS_HERE.lastIndex = preposition.indices![1]![0];
  return !NUMBER_ENDS_HERE.test(text);
}

/** `6 in` is usually the preposition. `6in` never is. */
function isBareInch(alias: string, whole: string): boolean {
  return alias.toLowerCase() === 'in' && BARE_INCH.test(whole);
}

/** Verbs that take `in` as their particle, in every form: `let`, `brought`, `squeezing`. */
const IN_PARTICLE_VERB =
  String.raw`let(?:s|ting)?|put(?:s|ting)?|br(?:ing(?:s|ing)?|ought)|c(?:omes?|oming|ame)|` +
  String.raw`fit(?:s|ted|ting)?|squeez(?:e|es|ed|ing)|pack(?:s|ed|ing)?|invit(?:e|es|ed|ing)|` +
  String.raw`allow(?:s|ed|ing)?|sen(?:d|ds|t|ding)|call(?:s|ed|ing)?`;

/** Such a verb governing the count after it, across at most a word such as `only` or `the`. */
const IN_PARTICLE_VERB_BEFORE = new RegExp(
  String.raw`\b(?:${IN_PARTICLE_VERB})\s+(?:(?:only|just|another|all|the|these|those|my|your|` +
    String.raw`his|her|its|our|their|some|about|around|nearly|almost|roughly)\s+)?$`,
  'i',
);

/**
 * Whether the spaced `in.` ending the quantity `text.slice(start, end)` is the particle of
 * a verb before it, as in `let only 3 in.` and `I put 2 in.`: the verb takes `in` and the
 * stop ends the sentence. `It is 12 in. long` and `Put a 12 in. tile in the gap` read the
 * inch.
 */
function isInParticle(text: string, start: number, end: number, alias: string): boolean {
  return (
    alias.toLowerCase() === 'in.' &&
    /\s$/.test(text.slice(start, end - alias.length)) &&
    IN_PARTICLE_VERB_BEFORE.test(text.slice(Math.max(0, start - CONTEXT_WINDOW), start)) &&
    endsSentence(text, start, end, AFTER_UNIT)
  );
}

/**
 * An apostrophe after a number, straight or curly, read as the foot's prime only on a side of
 * a dimension whose every side has a mark of its own, as in `2' x 6"`. Anywhere else it may
 * close a quote.
 */
const FOOT_MARK = "['’]";
const isFootMark = (alias: string | undefined) => alias === "'" || alias === '’';
const PRIME = '′';

/** A quote opened straight before a number, which a `'` after the number may close: `'6'`. */
const OPENS_QUOTE = /['‘]$/;

/** A double quote mark, or a blank line. A quotation still open at a blank line is given up. */
const QUOTE_OR_BLANK_LINE = new RegExp(
  String.raw`["“”]|(?:\r\n|\r(?!\n)|[\n\v\f\u2028\u2029])` +
    String.raw`${INLINE_SPACE}*(?:\r\n?|[\n\v\f\u2028\u2029])`,
  'g',
);

/** A number and the gap after it. A number in words starts a word: `often` holds none. */
const NUMBER_AND_GAP = String.raw`(?:(?<![A-Za-z])|(?![A-Za-z]))(?:${NUMBER_PATTERN})${GAP}`;

/** A number ending where a mark stands. */
const NUMBER_BEFORE_MARK = new RegExp(`${NUMBER_AND_GAP}$`, 'i');

/**
 * A number ending at `lastIndex`. It reads the whole text, so a gap that wraps onto the line
 * of `lastIndex` is seen as the soft break it is.
 */
const NUMBER_ENDS_HERE = new RegExp(`(?<=${NUMBER_AND_GAP})`, 'iy');

function followsNumber(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - NUMBER_REACH), at);
  if (!NUMBER_BEFORE_MARK.test(before)) return false;
  // A spaced mark with a word straight after it opens a quotation: `6 "free" tickets`.
  return !(/\s$/.test(before) && /[\p{L}\p{N}]/u.test(text.charAt(at + 1)));
}

let lastMarked = '';
let lastInchMarks = new Set<number>();

/**
 * Where `text` writes the inch mark as `"` or `”`. Such a mark straight after a number is the
 * inch mark unless a quotation is open, which it then closes: `a 6" pan`, but
 * `He said "6" twice.` A quotation is open after an odd number of straight double quotes
 * that are not inch marks, or after a `“` with no `”` since, counting back to a blank line.
 * An inch mark inside a quotation cannot be told from its close, so
 * `"It is 6" long," she said.` has none. `″` is never a quote, and needs no reading. The
 * rules ask about one text many times in a row, so the last one is kept.
 */
function inchMarks(text: string): Set<number> {
  if (text === lastMarked) return lastInchMarks;
  const marks = new Set<number>();
  let open = false;
  for (const { 0: found, index } of text.matchAll(QUOTE_OR_BLANK_LINE)) {
    if (found.length > 1) open = false;
    else if (found === '“') open = true;
    else if (followsNumber(text, index)) {
      if (!open) marks.add(index);
      open = false;
    } else open = found === '"' && !open;
  }
  lastMarked = text;
  lastInchMarks = marks;
  return marks;
}

/** The `"` or `”` at `at` opens or closes a quotation, and is not the inch mark. */
function isQuotationMark(text: string, at: number): boolean {
  return (text[at] === '"' || text[at] === '”') && !inchMarks(text).has(at);
}

function unitWord(target: MetricValue, value: number): string {
  return Math.abs(value) === 1 ? target.singular : target.plural;
}

/** The tier of every change made under a unit's own id. */
export const MEASUREMENT_CONFIDENCE = 'moderate' satisfies Confidence;

function change(
  start: number,
  before: string,
  after: string,
  ruleId: string,
  priority: number,
): Change {
  return {
    start,
    end: start + before.length,
    before,
    after,
    ruleId,
    category: 'units',
    confidence: MEASUREMENT_CONFIDENCE,
    priority,
  };
}

/**
 * A span the unit rules leave as written, such as a conventional size or an amount of
 * money. Another rule can match a piece of it, such as the `¾ inch` in `bolts of ½-¾ inch`,
 * and the hold keeps that piece as written too.
 */
function hold(start: number, matched: string, ruleId: string, priority: number): Change {
  return { ...change(start, matched, matched, ruleId, priority), hold: true };
}

function withOriginal(ctx: RuleContext, body: string, original: string): string {
  return ctx.options.units.keepOriginal ? `${body} (${original})` : body;
}


/**
 * A metric unit's forms, what a value in it comes to in its dimension's base unit, and,
 * for forms that are a unit only after the right figure, what has to stand before them.
 */
type MetricUnit = [forms: string, toBase: (value: number) => number, figure?: string];

const times = (factor: number) => (value: number) => value * factor;
const BASE = times(1);

// Unlike `\b`, this holds before the closing `_` of emphasis, as in `_175 degrees Celsius_`.
const UNIT_END = String.raw`(?![A-Za-z\d])`;

/** `word` in any case, as `celsius`, `Celsius` and `CELSIUS` all are. */
const anyCase = (word: string) => word.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`);
const DEGREES_WORD = `${anyCase('degree')}[sS]?`;
const CELSIUS_WORD = `${anyCase('celsius')}${UNIT_END}`;

/**
 * Metric units by dimension, in every form the unit rules write them, in the American
 * spellings, and in the shorthand of a hand-written temperature such as `180C` or `180ºC`.
 * The words of a temperature are read in any case, as the Fahrenheit value's are, but a lone
 * `C` only in upper case, so `180c` is no Celsius value.
 * Each key names a capture group, which is how a match reports its dimension.
 */
const METRIC_UNITS = {
  temperature: [
    [
      String.raw`${DEGREES_WORD}\s+(?:${CELSIUS_WORD}|C${UNIT_END})|[°º˚]\s*(?:${CELSIUS_WORD}|C)|` +
        String.raw`${CELSIUS_WORD}|℃|${anyCase('deg')}\.?\s*C${UNIT_END}|` +
        String.raw`(?:${DEGREES_WORD}\s+)?${anyCase('centigrade')}${UNIT_END}`,
      BASE,
    ],
    [String.raw`C${UNIT_END}`, BASE, BARE_CELSIUS_FIGURE],
  ],
  speed: [[String.raw`(?:kilometres?|kilometers?)\s+per\s+hour|km/h`, BASE]],
  torque: [[String.raw`newton[\s-]+(?:metres?|meters?)|N·m|Nm`, BASE]],
  area: [
    [String.raw`square\s+(?:kilometres?|kilometers?)|km²|km2`, times(1e6)],
    [String.raw`square\s+(?:metres?|meters?)|m²|m2`, BASE],
    [String.raw`hectares?|ha`, times(1e4)],
  ],
  economy: [
    [String.raw`L/100\s*km`, BASE],
    [String.raw`km/L`, (kmPerLitre) => 100 / kmPerLitre],
  ],
  length: [
    [String.raw`kilometres?|kilometers?|km`, times(1000)],
    [String.raw`centimetres?|centimeters?|cm`, times(0.01)],
    [String.raw`millimetres?|millimeters?|mm`, times(0.001)],
    [String.raw`metres?|meters?|m`, BASE],
  ],
  volume: [
    [String.raw`millilitres?|milliliters?|mL|ml`, times(0.001)],
    [String.raw`litres?|liters?|L|l`, BASE],
  ],
  mass: [
    [String.raw`kilograms?|kg`, times(1000)],
    [String.raw`tonnes?|t`, times(1e6)],
    [String.raw`grams?|g`, BASE],
    [String.raw`mg`, times(0.001)],
  ],
  pressure: [[String.raw`kilopascals?|kPa`, BASE]],
  power: [[String.raw`kilowatts?|kW`, BASE]],
  energy: [[String.raw`kilojoules?|kJ`, BASE]],
} satisfies Record<string, MetricUnit[]>;

type Dimension = keyof typeof METRIC_UNITS;

// `METRIC_FORMS` reads a unit apart from its figure, so the figure a form needs is checked here.
const afterFigure = ([forms, , figure]: MetricUnit) => (figure ? `(?<=${figure})(?:${forms})` : forms);

/** A dimension's metric units as the source of one pattern, each form after the figure it needs. */
export function metricUnitForms(dimension: Dimension): string {
  const units: MetricUnit[] = METRIC_UNITS[dimension];
  return units.map(afterFigure).join('|');
}

const METRIC_NUMBER = String.raw`[-−]?\d[\d,]*(?:\.\d+)?`;
// A comma joins only before a space, or a failing match would try every way to split `1,2,3,4`.
const METRIC_VALUE =
  String.raw`${METRIC_NUMBER}(?:(?:\s*(?:-|–|—|to|and|or|x|×|by)|,(?=\s)(?:\s+(?:and|or)(?=\s))?)` +
  String.raw`\s*${METRIC_NUMBER})*\s*-?\s*` +
  `(?:${(Object.keys(METRIC_UNITS) as Dimension[])
    .map((dimension) => `(?<${dimension}>${metricUnitForms(dimension)})`)
    .join('|')})`;

/**
 * A metric measurement filling a parenthetical, whether written in symbols, written out,
 * or written the American way.
 */
const METRIC_INNER = new RegExp(String.raw`^\s*${METRIC_VALUE}\s*$`);

/** An opening or closing tag of an element that sits inside a line of text. */
const INLINE_TAG =
  String.raw`<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|` +
  String.raw`strong|sub|sup|time|u|var)(?:\s[^<>\n]*)?>`;
const HAS_TAG = new RegExp(INLINE_TAG);

/**
 * Inline markup that can stand between the two values of a measurement given in both
 * systems, or around either of them: Markdown emphasis, a code backtick, or an inline HTML
 * tag. Every check that reads the two values together allows it in the same places.
 */
const MARKUP = String.raw`(?:[*_\`]|${INLINE_TAG})*`;
const MARKUP_MARK = new RegExp(String.raw`[*_\`]|${INLINE_TAG}`, 'g');

/** The markup that closes `opening`: its marks in reverse order, with each tag closed. */
function closingOf(opening: string): string {
  return (opening.match(MARKUP_MARK) ?? [])
    .reverse()
    .map((mark) => mark.replace(/^<(\w+)[^>]*>$/, '</$1>'))
    .join('');
}

/**
 * A metric measurement just before a parenthetical, in text that runs to the opening
 * bracket. Markup may close between them and open on the bracket, as in
 * `**1.8 metres** (6 feet)` and `1.8 metres *(6 feet)*`, and a line break that only wraps
 * the paragraph may stand between them too. An opening `_` is emphasis, not part of a word
 * the measurement starts inside.
 */
const METRIC_BEFORE = new RegExp(
  String.raw`(?<![A-Za-z\d.]_*)${METRIC_VALUE}${MARKUP}${SOFT_SPACE}${MARKUP}\($`,
);

function dimensionOf(match: RegExpMatchArray | null): Dimension | undefined {
  const groups = match?.groups ?? {};
  return Object.keys(groups).find((dimension) => groups[dimension] !== undefined) as
    | Dimension
    | undefined;
}

const METRIC_FORMS = Object.entries(METRIC_UNITS).flatMap(([dimension, units]) =>
  units.map(([forms, toBase]) => ({
    dimension: dimension as Dimension,
    pattern: new RegExp(`^(?:${forms})$`),
    toBase,
  })),
);

/**
 * What one of each measure's units comes to in a unit they share, so `2 feet x 6 inches`
 * reads as one length. Undefined when they measure different things, as feet and pounds do.
 */
function commonScale(measures: Measure[]): Map<Measure, number> | undefined {
  if (measures.length === 1) return new Map([[measures[0]!, 1]]);
  const bases = measures.map((measure) => {
    const metric = measure.convert(1);
    const form = METRIC_FORMS.find((f) => f.pattern.test(metric.symbol));
    return form && { dimension: form.dimension, value: form.toBase(metric.value) };
  });
  const dimension = bases[0]?.dimension;
  if (bases.some((base) => base === undefined || base.dimension !== dimension)) return undefined;
  return new Map(measures.map((measure, i) => [measure, bases[i]!.value]));
}

/**
 * Only a length has sides. A bare number joined by `x` to any other measure is a count:
 * `2 x 4 oz cans` is two cans.
 */
function hasSides(measure: Measure): boolean {
  const { symbol } = measure.convert(1);
  return METRIC_FORMS.find((form) => form.pattern.test(symbol))?.dimension === 'length';
}

/** A minus sign straight after a number is the dash of a range: `9-18 m`. */
const METRIC_FIGURE = /(?:(?<![\d.]\s*)[-−])?\d[\d,]*(?:\.\d+)?/g;

interface MetricReading {
  dimension: Dimension;
  /** Each figure as the span its written precision allows, in the dimension's base unit. */
  spans: Array<[low: number, high: number]>;
  /** `3 x 3.7 m` gives the sides of one thing, where `3-3.7 m` is a range. */
  sides: boolean;
}

/** `9-18 m` reads as a length of 8.5-9.5 m and 17.5-18.5 m. */
function readMetric(text: string): MetricReading | undefined {
  const match = METRIC_INNER.exec(text);
  const dimension = dimensionOf(match);
  if (dimension === undefined) return undefined;
  const unit = match!.groups![dimension]!;
  const form = METRIC_FORMS.find((f) => f.dimension === dimension && f.pattern.test(unit));
  if (form === undefined) return undefined;
  const figures = text.slice(0, text.lastIndexOf(unit));
  const spans = [...figures.matchAll(METRIC_FIGURE)].map(([figure]): [number, number] => {
    const value = Number(figure.replace(/,/g, '').replace('−', '-'));
    const half = 0.5 * 10 ** -(figure.split('.')[1]?.length ?? 0);
    const ends = [form.toBase(value - half), form.toBase(value + half)];
    return [Math.min(...ends), Math.max(...ends)];
  });
  return { dimension, spans, sides: /x|×|by/.test(figures) };
}

/**
 * Authors round a restatement and some use a unit of another country (an imperial pint or
 * gallon, a UK mpg), which can put it a fifth away from the American conversion.
 */
const RESTATEMENT_SLACK = 0.25;

/**
 * An absolute temperature has no zero to take a fraction of. Published oven tables sit up
 * to 10 °C from the oven setting this rounds to. A fan oven's setting, 20 °C lower, is not
 * a restatement.
 */
const TEMPERATURE_SLACK = 10;

/**
 * The bracket gives the same measurement as the conversion: the same dimension, as many
 * figures joined the same way, and each figure close to the converted one once both are
 * read to the precision they are written to.
 */
function restatesConversion(
  bracket: MetricReading,
  converted: MetricReading,
  absoluteTemperature: boolean,
): boolean {
  if (bracket.dimension !== converted.dimension) return false;
  if (bracket.spans.length !== converted.spans.length) return false;
  if (bracket.sides !== converted.sides) return false;
  return bracket.spans.every(([low, high], i) => {
    const [convertedLow, convertedHigh] = converted.spans[i]!;
    const slack = absoluteTemperature
      ? TEMPERATURE_SLACK
      : RESTATEMENT_SLACK * Math.max(Math.abs(convertedLow), Math.abs(convertedHigh));
    return low <= convertedHigh + slack && high >= convertedLow - slack;
  });
}

/** Miles per US gallon, in every form the fuel economy rule reads. */
const MPG_FORMS = [
  'mpg',
  String.raw`miles(?:\s+per\s+|${HYPHEN}per${HYPHEN})gallon`,
  String.raw`(?:miles|mi)\s*/\s*(?:gallon|gal)`,
];

/**
 * Imperial units by the dimension of what they convert to: every unit in MEASURES, and
 * the forms that only the feet-and-inches, temperature and fuel economy rules read.
 */
const IMPERIAL_UNITS: Partial<Record<Dimension, string[]>> = {
  temperature: [
    String.raw`[°º˚]\s*F(?:ahrenheit|\.)?`,
    String.raw`℉\.?`,
    String.raw`degrees?\s+F(?:ahrenheit|\.)?`,
    String.raw`deg\.?\s*F\.?`,
    'Fahrenheit',
  ],
  economy: [...MPG_FORMS],
  length: ["'", '’'],
};
for (const measure of MEASURES) {
  const dimension = dimensionOf(METRIC_INNER.exec(`1 ${measure.convert(1).symbol}`));
  if (dimension === undefined) continue;
  const forms = [...measure.words, ...measure.abbrevs, ...(measure.compoundAbbrevs ?? [])];
  (IMPERIAL_UNITS[dimension] ??= []).push(...forms.map(escape));
}

/** Each dimension's units as one pattern, for naming the dimension of a unit already read. */
const UNIT_OF = Object.entries(IMPERIAL_UNITS).map(([dimension, units]) => ({
  dimension: dimension as Dimension,
  pattern: new RegExp(`^(?:${units.join('|')})$`, 'i'),
}));

/**
 * The words of a quantity before its unit where the unit sits inside it: the `half an` of
 * `half an inch` and the `one-fourth of a` of `one-fourth of a pound`. The first group holds
 * `half`, the second any other fraction.
 */
const FRACTION_OF =
  String.raw`(?:((?:an?${INLINE_SPACE}+)?half)|(${FRACTION_WORDS})${INLINE_SPACE}+of)` +
  String.raw`${INLINE_SPACE}+an?(?=\s)`;

/**
 * The count before the unit in `a mile and a half` and `two inches and a quarter`. A count
 * straight after `/` or `-` is the tail of `1 1/2` or `twenty-two`, not a number.
 */
const COUNT_BEFORE_FRACTION = String.raw`an?(?=\s)|(?<!${HYPHEN}|[−/])${WHOLE_NUMBER}`;

/** The fraction after the unit in `a mile and a half`, in its group. */
const AND_FRACTION = String.raw`and${INLINE_SPACE}+(${COUNTED_FRACTION})`;

/**
 * A number as the measurement rules read one: on its own, and in the words around a unit
 * in `half an inch` and `a mile and a half`. `half an` comes before `half`, and `a quarter`
 * before `a`, because the first alternative to match is the one taken.
 */
const PIECE_NUMBER = [FRACTION_OF, AND_FRACTION, NUMBER_PATTERN, COUNT_BEFORE_FRACTION].join('|');

const JOINER = String.raw`[-–—,]|(?:to|and|or|x|×|by)(?![A-Za-z])`;

const IMPERIAL_UNIT = Object.values(IMPERIAL_UNITS)
  .flat()
  // Longest first, so `lb-ft` is torque and not `lb` joined to `ft`.
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * One piece of an imperial measurement: a unit, a number, or what joins them. A unit or a
 * number has to be followed by another piece or the end. That reads `40 miles per gallon`
 * as fuel economy and not as a length followed by a stray `per`, and reads `a quartersq ft`
 * as `a quarter` and `sq ft`, where `a quarters` would leave `q ft` over.
 */
const MEASUREMENT_PIECE = new RegExp(
  String.raw`\s*(?:(?:${IMPERIAL_UNIT})(?=\s*(?:$|${PIECE_NUMBER}|${JOINER}))|` +
    String.raw`(?:${PIECE_NUMBER})(?=\s*(?:$|${IMPERIAL_UNIT}|${PIECE_NUMBER}|${JOINER}))|${JOINER})`,
  'giy',
);

/** Words that round a restatement, as in `a 2 metre (about 6 feet) fence`. */
const APPROXIMATELY =
  /^(?:about|around|approximately|approx\.|roughly|nearly|almost|some|circa|c\.|ca\.|~|≈)\s*/i;

/** Space and markup at either end of a text, as in `*about 6 feet*`. */
const MARKUP_ENDS = new RegExp(String.raw`^\s*${MARKUP}|${MARKUP}\s*$`, 'g');

/**
 * The dimension of the imperial measurement the text holds and nothing else, inside any
 * markup and after an optional word of approximation. `about 6 feet 2 inches` is a length,
 * while `10 feet for the old one` and `6 feet 3 pounds` are neither, and give undefined.
 */
function measurementDimension(text: string): Dimension | undefined {
  const rest = text.replace(MARKUP_ENDS, '').replace(APPROXIMATELY, '').replace(MARKUP_ENDS, '');
  let read = 0;
  let dimension: Dimension | undefined;
  for (const piece of rest.matchAll(MEASUREMENT_PIECE)) {
    read += piece[0].length;
    const unit = UNIT_OF.find(({ pattern }) => pattern.test(piece[0].trim()))?.dimension;
    if (unit === undefined) continue;
    if (dimension !== undefined && unit !== dimension) return undefined;
    dimension = unit;
  }
  return read === rest.length ? dimension : undefined;
}

/**
 * `1.8 metres (6 feet)` is what `keepOriginal` writes, and what a careful author writes by
 * hand. A bracket that holds nothing but an imperial measurement, directly after a metric
 * value of the same dimension, restates that value. Every match inside it is left alone,
 * including a piece of the measurement such as the `2 inches` in `(6 feet 2 inches)`.
 */
function restatesMetric(ctx: RuleContext, start: number, end: number): boolean {
  const text = contextText(ctx.text);
  const head = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const tail = text.slice(end, end + CONTEXT_WINDOW);
  const open = head.lastIndexOf('(');
  const close = tail.indexOf(')');
  if (open < 0 || close < 0) return false;
  const inside = head.slice(open + 1) + text.slice(start, end) + tail.slice(0, close);
  const dimension = measurementDimension(inside);
  if (dimension === undefined) return false;
  const bracket = start - head.length + open;
  // Through the `(`, so a line break before it can see that its next line opens no new block.
  const before = text.slice(Math.max(0, bracket - CONTEXT_WINDOW), bracket + 1);
  return dimensionOf(METRIC_BEFORE.exec(before)) === dimension;
}

/** The author wrote the metric side; only its spelling needs bringing across. */
function metricSpelling(text: string): string {
  return text.replace(
    /\b((?:kilo|centi|milli|micro|nano|deci|deca|hecto)?)(met|lit)er(s?)\b/gi,
    (_, prefix: string, stem: string, plural: string) => `${prefix}${stem}re${plural}`,
  );
}

/**
 * A bracket after a measurement. `close` is the markup that closes on the measurement
 * before it, `open` the markup that opens on the bracket, and `inner` the markup that opens
 * on the text inside it, which `innerClose` closes.
 */
const BRACKET_AFTER = new RegExp(
  String.raw`^(?<close>${MARKUP})${SOFT_SPACE}(?<open>${MARKUP})\(` +
    String.raw`(?<inner>${MARKUP})(?<metric>[^()]{1,40}?)(?<innerClose>${MARKUP})\)`,
);

/**
 * A `/` or `or` between one measurement in both systems, as in `180°C/350°F/gas 4`. A
 * slash before a bare unit is a rate (`5 gallons/minute`), so the metric side needs a figure.
 */
const PAIR_JOIN = softGap(String.raw`(?:/|(?<=\s)or(?=\s))`);
// `(?=\S)` makes a join that wraps take its line break, so the match ends at the next value.
const METRIC_PAIRED_BEFORE = new RegExp(
  String.raw`(?<![A-Za-z\d.]_*)(${METRIC_VALUE})${MARKUP}${PAIR_JOIN}${MARKUP}(?=\S)`,
  'g',
);
/** A metric value joined after a measurement, with its markup named as in `BRACKET_AFTER`. */
const METRIC_PAIRED_AFTER = new RegExp(
  String.raw`^(?<close>${MARKUP})${PAIR_JOIN}(?<open>${MARKUP})` +
    String.raw`(?<metric>${METRIC_VALUE})(?![A-Za-z\d])`,
);
/** A cheap test passed by every text that `METRIC_PAIRED_BEFORE` can end, and few others. */
const ENDS_IN_JOIN = new RegExp(String.raw`(?:\/|\sor)\s*${MARKUP}$`);

interface MetricPartner {
  /** The length of the text from the end of the imperial value to the end of the partner. */
  length: number;
  metric: string;
  /** The markup that closes on the imperial value. */
  close: string;
}

/**
 * The metric value in brackets, or joined by `/` or `or`, at the start of `rest`, the text
 * after an imperial value. Markup that opens on the bracket or the metric value has to
 * close on it too.
 */
function metricPartnerAfter(rest: string): MetricPartner | undefined {
  const match = BRACKET_AFTER.exec(rest) ?? METRIC_PAIRED_AFTER.exec(rest);
  if (!match) return undefined;
  const { close = '', open = '', inner = '', innerClose = '', metric = '' } = match.groups!;
  const closing = closingOf(open);
  if (innerClose !== closingOf(inner)) return undefined;
  if (!rest.startsWith(closing, match[0].length)) return undefined;
  return { length: match[0].length + closing.length, metric, close };
}

/**
 * The metric text gives the same measurement as `body`, a rule's conversion. Brackets and
 * pairs share this test, so `6 feet (2 m)` and `6 feet/2 m` are always read alike.
 */
function restatesBody(metric: string, body: string, ruleId: string): boolean {
  const given = readMetric(metric);
  const converted = readMetric(body);
  if (!given || !converted) return false;
  return restatesConversion(given, converted, ruleId === ABSOLUTE_ID);
}

interface PairedMetric {
  /** Where the metric value starts in the text. */
  start: number;
  metric: string;
  dimension: Dimension | undefined;
}

/** The metric value joined by `/` or `or` before the measurement from `start` to `end`. */
function metricPairedBefore(text: string, start: number, end: number): PairedMetric | undefined {
  const from = Math.max(0, start - CONTEXT_WINDOW);
  if (!ENDS_IN_JOIN.test(text.slice(from, start))) return undefined;
  // The window runs on to `end` so a line break in the join can see that the next line
  // holds the measurement and opens no new block.
  for (const match of text.slice(from, end).matchAll(METRIC_PAIRED_BEFORE)) {
    if (from + match.index + match[0].length === start) {
      return { start: from + match.index, metric: match[1]!, dimension: dimensionOf(match) };
    }
  }
  return undefined;
}

/** `180°C/350°F` and `180°C or 350°F` give the imperial value after the metric one it restates. */
function followsItsMetric(
  ctx: RuleContext,
  start: number,
  end: number,
  body: string,
  ruleId: string,
): boolean {
  const paired = metricPairedBefore(contextText(ctx.text), start, end);
  return paired !== undefined && restatesBody(paired.metric, body, ruleId);
}

/**
 * `30-60 feet (9-18 m)` already carries its own conversion, so converting the imperial
 * half produces `9.1-18 metres (9-18 m)`. Swallow the parenthetical instead and keep the
 * author's own figure, which is the one they rounded on purpose. A bracket that says
 * anything else, as `6 feet (2 kg)` and `6 feet (5 m)` do, stays and nothing is lost.
 * `350°F/180°C` and `350°F or 180°C` collapse the same way. Markup that closes on the
 * imperial value closes on the metric one, so `**6 feet** (1.8 m)` becomes `**1.8 m**`.
 */
function redundantMetric(
  ctx: RuleContext,
  end: number,
  body: string,
  ruleId: string,
): { end: number; after: string } | null {
  const partner = metricPartnerAfter(contextText(ctx.text).slice(end));
  if (!partner || !restatesBody(partner.metric, body, ruleId)) return null;
  const after = metricSpelling(partner.metric.trim()) + partner.close;
  return { end: end + partner.length, after };
}

/**
 * Any capitalised word after a unit's stop starts a new sentence, a number in words included,
 * as in `It weighs 5 lb. One bag is enough.` It has to accept every word the bare F's
 * `OPENER` accepts there, or a stop that ends a bare F's sentence would go, and the second run
 * would read a longer sentence.
 */
const AFTER_UNIT = /(?:)/y;

/** Whether `matched`, a measurement at `start`, ends in a stop that also ends the sentence. */
function keepsStop(text: string, start: number, matched: string): boolean {
  return matched.endsWith('.') && endsSentence(text, start, start + matched.length, AFTER_UNIT);
}

/** `°F` or `℉` and a stop: a symbol, which has no stop of its own. */
const SYMBOL_STOP = /(?:[°º˚]\s*F|℉)\.$/i;

/** Space that stays in the paragraph, then a word in lower case, so the sentence plainly goes on. */
const LOWER_CASE_NEXT = new RegExp(String.raw`(?=\s)${SOFT_SPACE}\p{Ll}`, 'uy');

function continuesInLowerCase(text: string, at: number): boolean {
  LOWER_CASE_NEXT.lastIndex = at;
  return LOWER_CASE_NEXT.test(text);
}

/**
 * Whether the stop that ends `matched`, a Fahrenheit value at `start`, stays in the text. A
 * bare letter `F` abbreviates the scale, so its stop goes as an abbreviation's does, unless
 * it also ends the sentence. A symbol's stop is usually the sentence's own, but authors also
 * write `350°F. for 20 minutes`, so it goes only before a word in lower case.
 */
function fahrenheitKeepsStop(text: string, start: number, matched: string): boolean {
  if (!SYMBOL_STOP.test(matched)) return keepsStop(text, start, matched);
  return !continuesInLowerCase(text, start + matched.length);
}

/**
 * `pushMeasurement`, with the change it makes widened over a hyphen that joins a length to
 * the size it gives. The metric unit stands apart from its number, so `6-foot-tall` reads
 * `1.8 metre tall`.
 */
function pushBeforeSize(
  ctx: RuleContext,
  changes: Change[],
  start: number,
  matched: string,
  body: string,
  ruleId: string,
  priority: number,
): void {
  const made = changes.length;
  pushMeasurement(ctx, changes, start, matched, body, ruleId, priority);
  const end = start + matched.length;
  const last = changes.at(-1);
  if (changes.length === made || !last || last.hold || last.end !== end) return;
  HYPHEN_BEFORE_SIZE.lastIndex = end;
  if (!HYPHEN_BEFORE_SIZE.test(ctx.text)) return;
  changes[changes.length - 1] = {
    ...last,
    end: end + 1,
    before: last.before + ctx.text[end],
    after: `${last.after} `,
  };
}

/**
 * Records one converted measurement, collapsing a redundant parenthetical or pair if there
 * is one. A measurement that is itself the parenthetical after its metric value is not
 * recorded, and one paired after the metric value it restates is held as written. The stop
 * of an abbreviation such as `in.` goes with it, unless it also ends the sentence, when the
 * metric value takes it.
 */
function pushMeasurement(
  ctx: RuleContext,
  changes: Change[],
  start: number,
  matched: string,
  body: string,
  ruleId: string,
  priority: number,
): void {
  if (restatesMetric(ctx, start, start + matched.length)) return;
  if (followsItsMetric(ctx, start, start + matched.length, body, ruleId)) {
    changes.push(hold(start, matched, ruleId, priority));
    return;
  }
  const redundant = redundantMetric(ctx, start + matched.length, body, ruleId);
  if (redundant) {
    const before = ctx.text.slice(start, redundant.end);
    // A tag is protected, so no change can rewrite across one to collapse the pair.
    if (HAS_TAG.test(before)) {
      changes.push(hold(start, matched, ruleId, priority));
      return;
    }
    changes.push({
      start,
      end: redundant.end,
      before,
      after: redundant.after,
      ruleId,
      category: 'units',
      confidence: MEASUREMENT_CONFIDENCE,
      priority: 55,
      note: 'the text already gave the metric value, so the imperial half goes',
    });
    return;
  }
  let after = withOriginal(ctx, body, matched);
  if (keepsStop(ctx.text, start, matched)) after += '.';
  changes.push(change(start, matched, after, ruleId, priority));
}

/**
 * A number of a measurement in two units: in digits, in any shape the single rule reads but
 * unsigned, or a whole number in words. A minus before the first number stays outside the
 * match, where it negates the whole.
 */
const UNSIGNED_NUMBER = String.raw`(?:(?![-−])(?:${NUMERIC_PATTERN})|${WHOLE_NUMBER})`;

/**
 * The first number of a measurement in two units, found anywhere outside a word or a decimal,
 * even inside a longer number as the `seven` of `five-seven` is, so that `splitByStart` can
 * hold what `MEASUREMENT_START` refuses.
 */
const FIRST_NUMBER = String.raw`(?<![\w.])(?:(?![-−])(?:${NUMERIC_PATTERN})|${SECOND_END_WORDS})`;

const STARTS_HERE = new RegExp(MEASUREMENT_START, 'iy');

/**
 * The matches of `pattern`, which starts more loosely than `MEASUREMENT_START`, split by
 * whether it lets each one's number start where it stands. Past a refused match the
 * search resumes one character on, so a measurement inside it is still found, as the
 * `1/2 pounds 3 ounces` of `7:30 1/2 pounds 3 ounces` is. A refused match with none inside
 * it is for the rule to hold, so that no other rule converts a piece of it, as the single
 * rule would the `2 inches` of `At 7:30 feet 2 inches`.
 */
function splitByStart(
  pattern: RegExp,
  text: string,
): { found: RegExpExecArray[]; refused: RegExpExecArray[] } {
  const found: RegExpExecArray[] = [];
  const refused: RegExpExecArray[] = [];
  let pending: RegExpExecArray | undefined;
  pattern.lastIndex = 0;
  for (let match: RegExpExecArray | null; (match = pattern.exec(text)) !== null; ) {
    if (pending && match.index >= pending.index + pending[0].length) {
      refused.push(pending);
      pending = undefined;
    }
    STARTS_HERE.lastIndex = match.index;
    if (STARTS_HERE.test(text)) {
      found.push(match);
      pending = undefined;
    } else {
      pending ??= match;
      pattern.lastIndex = match.index + 1;
    }
  }
  if (pending) refused.push(pending);
  return { found, refused };
}

/** A range's first number and its join, ending where the range's second number starts. */
const RANGE_OPENING = new RegExp(
  String.raw`(?<=${NUMBER_START}(${NUMBER_PATTERN})(${RANGE_JOIN}))`,
  'diy',
);

/**
 * The measurement in two units at `start`, whose first number is `first`, ends a range or
 * list that the range rule reads or holds, as in `7-8 lb 4 oz`, `five to six feet two inches`
 * and `5, 6, 7 feet 2 inches`.
 * Whether the range's first end is `7` or `7 lb` cannot be told, so the measurement is held,
 * the range rule's change splits the hold and is dropped, and the whole range stays as written.
 * The inches of a height open no range, so `6 foot 2 to 6 foot 4 inches` is two heights.
 */
function endsRangeWhole(text: string, start: number, first: string): boolean {
  const lowStart = rangeOpening(text, start, first);
  return lowStart !== null && !isHeightInches(text, lowStart);
}

/**
 * Where the first end starts of the range that `endsRangeWhole` asks about, before it asks
 * whether that end is the inches of a height, or `null` where no such range opens. A list
 * with no range join before its last figure opens at its first.
 */
function rangeOpening(text: string, start: number, first: string): number | null {
  RANGE_OPENING.lastIndex = start;
  const opening = RANGE_OPENING.exec(text);
  if (opening === null) {
    const value = parseNumber(first);
    return value === null ? null : (listedBefore(text, start, value)[0]?.start ?? null);
  }
  const [lowRaw, join] = [opening[1]!, opening[2]!];
  const lowStart = opening.indices![1]![0];
  const written = isWritten(lowRaw) || isWritten(first);
  if (written && writtenRange(text, lowStart, lowRaw, join, first) === 'skip') return null;
  const low = parseNumber(lowRaw);
  const high = parseNumber(first);
  return low === null || high === null || canBeRange(text, lowStart, low, high) ? lowStart : null;
}

const LINE_END = String.raw`(?:\r\n?|[\n\v\f\u2028\u2029])`;

/** A join and a measurement in feet, as the ` to 6 foot` of `6 foot 2 to 6 foot 4`. */
const ANOTHER_HEIGHT =
  String.raw`${RANGE_JOIN}${NUMBER_START}(?:${UNSIGNED_NUMBER})${GAP}(?:feet|foot|ft)(?![A-Za-z])`;

/**
 * A word from `NOT_A_NOUN` after inches with no inch word, so nothing follows that the inches
 * could count, as in `6 foot 4 with long arms`. `in` may be the inch abbreviation, and a join
 * or `by` before a number carries the inches on to a range or a side, as in
 * `6 feet 2 to 3 inches` and `a 6-foot 2 by 4`.
 */
const NO_NOUN_WORD =
  String.raw`(?!(?:to|and|or|by)${SOFT_SPACE}(?<=\s)(?:${NUMERIC_FIRST}|${WHOLE_NUMBER}|${FRACTION_WORDS}))` +
  String.raw`(?:${NOT_A_NOUN.filter((word) => word !== 'in').join('|')})(?!\w|${HYPHEN})`;

/**
 * Where inches may go without their word after `foot` or `feet`, as in `six foot two`: before
 * nothing that could be a noun, or before another height. That is punctuation, a word that
 * cannot open a noun, the end of the text, the end of a line where the next line is blank or
 * starts with something other than a word, such as a list marker, or a join and a measurement
 * in feet, as in `6 foot 2 to 6 foot 4`.
 */
const NO_NOUN_AFTER =
  String.raw`(?=[.,;:!?)\]"'”’]+(?!\w)|${SOFT_SPACE}(?<=\s)${NO_NOUN_WORD}|${ANOTHER_HEIGHT}|` +
  String.raw`${INLINE_SPACE}*(?:$|${LINE_END}${INLINE_SPACE}*(?:$|${LINE_END}|[^\sA-Za-z])))`;

/** Inches written without their word: a whole number from 1 to 11. */
const isInchCount = (value: number | null) =>
  value !== null && Number.isInteger(value) && value >= 1 && value <= 11;

/**
 * A whole number in words straight after a hyphen, as the `two` of `six-foot-two`, which
 * `WHOLE_NUMBER` refuses so that a number never starts inside a hyphenated word.
 */
const WORDS_AFTER_HYPHEN = String.raw`(?<=${HYPHEN})(?:${SECOND_END_WORDS})`;

/**
 * The feet of a height with no inch word before another height, and its inches starting where
 * the pattern is tried. The same shape as the last alternative of `feetInchesRule`.
 */
const INCHES_OF_HEIGHT = new RegExp(
  String.raw`(?<=(?<![\w.])(${UNSIGNED_NUMBER})${GAP}(?:feet|foot)(?:${SOFT_SPACE}|${HYPHEN}))` +
    String.raw`(?<=\s|${HYPHEN})(${WHOLE_NUMBER}|${WORDS_AFTER_HYPHEN})(?=${ANOTHER_HEIGHT})`,
  'diy',
);

/**
 * The height whose inches start at `start`, with no inch word before another height, where it
 * starts where a measurement can: its feet and where they start.
 */
function heightAt(text: string, start: number): { feet: string; feetStart: number } | null {
  INCHES_OF_HEIGHT.lastIndex = start;
  const match = INCHES_OF_HEIGHT.exec(text);
  if (match === null || parseNumber(match[1]!) === null) return null;
  if (!isInchCount(parseNumber(match[2]!))) return null;
  const feetStart = match.indices![1]![0];
  STARTS_HERE.lastIndex = feetStart;
  return STARTS_HERE.test(text) ? { feet: match[1]!, feetStart } : null;
}

let inchesText = '';
const inchesAt = new Map<number, boolean>();

/**
 * The number at `start` is the inches of a height that `feetInchesRule` converts before
 * another height, as the `2` of `6 foot 2 to 6 foot 4` is, and not the first end of a range.
 * Where that height itself ends a range, the answer is the one for the range's first end, so
 * the walk follows a chain such as `5 to 6 foot 1 to 6 foot 2 to 6 foot 3` back to its start.
 * Every answer is kept for the text, so a long chain takes time in line with its length, and
 * the walk is a loop, so no chain is too long for the stack.
 */
function isHeightInches(text: string, start: number): boolean {
  if (text !== inchesText) {
    inchesText = text;
    inchesAt.clear();
  }
  const walked: number[] = [];
  let at: number | null = start;
  let answer = true;
  while (at !== null) {
    const known = inchesAt.get(at);
    if (known !== undefined) {
      answer = known;
      break;
    }
    walked.push(at);
    const height = heightAt(text, at);
    if (height === null) {
      answer = false;
      break;
    }
    at = rangeOpening(text, height.feetStart, height.feet);
  }
  for (const position of walked) inchesAt.set(position, answer);
  return answer;
}

/** Determiners and object pronouns, the words of `NOT_A_NOUN` that open a preposition's object. */
const OPENS_OBJECT = [
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their', 'my', 'our',
  'your', 'some', 'any', 'no', 'all', 'both', 'every', 'me', 'him', 'it', 'us', 'them', 'you',
];

/**
 * A word or number straight after a preposition that opens its object, as `her socks`,
 * `shoes` and `2019` do. A word that cannot open a noun opens none, and nor does the `x` of
 * a dimension, so `5 feet 4 in tall` and `5 ft 4 in x 3 ft` have no object after the `in`.
 */
const OBJECT_AFTER = new RegExp(
  String.raw`(?=\s)${SOFT_SPACE}` +
    String.raw`(?!(?:${[...NOT_A_NOUN.filter((word) => !OPENS_OBJECT.includes(word)), 'x'].join('|')})` +
    String.raw`(?!\w|${HYPHEN}))[a-z\d]`,
  'iy',
);

/** What follows a height's inches: the gap, then the inch word or mark. */
const INCH_UNIT = new RegExp(String.raw`^((?:\s|${HYPHEN})*)(.*)$`, 's');

/**
 * A unit straight after a number: one the rules read, or a metric one. A number after
 * `feet-` with a unit of its own ends a range, as the `6` of `5 feet-6 feet` does, and is
 * no inches.
 */
const UNIT_OF_ITS_OWN =
  String.raw`(?=\s)${SOFT_SPACE}(?:${UNIT_FORMS}|` +
  String.raw`${Object.values(METRIC_UNITS).flat().map(afterFigure).join('|')})(?![A-Za-z\d])`;

/**
 * `6 feet 2 inches`, `6'2"`, `5 ft 11 in`, `six feet two inches`, `six foot two` and
 * `six-foot-two` collapse into a single metric height.
 */
function feetInchesRule(): Rule {
  const pattern = new RegExp(
    String.raw`(${FIRST_NUMBER})` +
      String.raw`(?:(?:${GAP}(?:feet|foot|ft\.?)|${SOFT_SPACE}(?:′|${FOOT_MARK}))` +
      String.raw`(?:${HYPHEN}|${softGap(String.raw`(?:and(?=\s))?`)})` +
      String.raw`(\d+(?:\.\d+)?|\d+${INLINE_SPACE}+\d+/\d+|\d+${HYPHEN}\d+/\d+|\d+/\d+|` +
      String.raw`(?:${WHOLE_NUMBER}|${WORDS_AFTER_HYPHEN})` +
      String.raw`(?:${INLINE_SPACE}+and${INLINE_SPACE}+${COUNTED_FRACTION})?)` +
      String.raw`(?:${GAP}(?:inches|inch|in\.?)|${SOFT_SPACE}(?:″|["”]))(?![A-Za-z])|` +
      String.raw`${GAP}(?:feet|foot)(?:${SOFT_SPACE}(?<=\s)(${WHOLE_NUMBER})${NO_NOUN_AFTER}|` +
      // A hyphen makes the height one word, so a noun may follow it: `a six-foot-two man`.
      String.raw`${HYPHEN}(\d+|${WORDS_AFTER_HYPHEN})(?!\w|${HYPHEN}|[.,/:]\d|${UNIT_OF_ITS_OWN})))`,
    'dgi',
  );
  const sticky = new RegExp(pattern.source, 'iy');

  return {
    id: 'units.length.feet-inches',
    category: 'units',
    confidence: 'moderate',
    priority: 40,
    find(ctx) {
      const { found, refused } = splitByStart(pattern, ctx.text);
      const changes = refused.map((match) =>
        hold(match.index, match[0], 'units.length.feet-inches', 40),
      );
      /**
       * The match read as far as a quotation mark after its inches, which closes a quote
       * around the height, as in `"He is six foot two"`. A height that cannot be read
       * without the mark is held, so its feet are not read alone.
       */
      const beforeQuote = (match: RegExpExecArray): RegExpExecArray | undefined => {
        const mark = match.index + match[0].length - 1;
        if (match[2] === undefined || !isQuotationMark(ctx.text, mark)) return match;
        sticky.lastIndex = match.index;
        const inner = sticky.exec(ctx.text.slice(0, mark));
        if (inner) return inner;
        const held = ctx.text.slice(match.index, mark).trimEnd();
        changes.push(hold(match.index, held, 'units.length.feet-inches', 40));
        return undefined;
      };
      for (const whole of found) {
        const match = beforeQuote(whole);
        if (match === undefined) continue;
        const feet = parseNumber(match[1]!);
        const bare = match[3] ?? match[4];
        const inches = parseNumber(match[2] ?? bare!);
        if (bare !== undefined && !isInchCount(inches)) continue;
        // Hyphened to the foot word, only a number of inches below a foot makes a height, so
        // `2 feet-18 inches` stays two lengths.
        const tied =
          match[2] !== undefined && TIGHT_HYPHEN.test(ctx.text.charAt(match.indices![2]![0] - 1));
        if (tied && !(inches !== null && inches < 12)) continue;
        if (feet === null || inches === null || endsRangeWhole(ctx.text, match.index, match[1]!)) {
          changes.push(hold(match.index, match[0], 'units.length.feet-inches', 40));
          continue;
        }
        const target = metricLength(feet * 0.3048 + inches * 0.0254);
        // Two components together claim three figures of precision, not one.
        const number = formatNumber(
          target.value,
          ctx.options.units.precision,
          3,
          ctx.options.units.maxDecimals,
        );
        let end = match.index + match[0].length;
        let attributive = false;
        if (match[2] !== undefined) {
          const inchesEnd = match.indices![2]![1];
          const [, gap, inchUnit] = INCH_UNIT.exec(ctx.text.slice(inchesEnd, end))!;
          // An abbreviation or mark is neither singular nor plural, so it counts as the singular
          // after one, which describes a noun only after a determiner: `a 6 ft 2 in man`.
          const value = /^inch$/i.test(inchUnit!) ? inches : 1;
          attributive = describesNoun(ctx.text, match.index, value, gap!, end);
          OBJECT_AFTER.lastIndex = end;
          // The `in` of `5 feet 4 in her socks` is the preposition, and stays after the height.
          if (!attributive && isBareInch(inchUnit!, match[0]) && OBJECT_AFTER.test(ctx.text)) {
            end = inchesEnd;
          }
        } else if (match[4] !== undefined) {
          const hyphen = ctx.text.charAt(match.indices![4]![0] - 1);
          attributive = describesNoun(ctx.text, match.index, inches, hyphen, end);
        }
        const unit = attributive ? target.singular : unitWord(target, Number(number));
        const body = `${number} ${unit}`;
        const matched = ctx.text.slice(match.index, end);
        pushMeasurement(ctx, changes, match.index, matched, body, 'units.length.feet-inches', 40);
      }
      return changes;
    },
  };
}

const NOT_SECOND = new RegExp(NOT_SECOND_OF_PAIR, 'y');

/** `1st`, `21st` and `101st` are ordinals. `11st` is not. */
const ORDINAL = /^(?:\d*[02-9])?1st(?![a-z])/i;

/**
 * `7 pounds 8 ounces`, `11st 4lb` and `11 stone 4 pounds 8 ounces` are each one weight, as
 * `6 feet 2 inches` is one height. A weight that cannot be converted whole is held whole:
 * one in a unit that is kept, and one that ends a range, as in `7-8 lb 4 oz`. A weight has
 * no sides, so the number in `2 x 4 lb 8 oz bags` counts the bags.
 */
function compoundRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  const AND = softGap(String.raw`(?:and(?=\s))?`);
  const unitOf = (m: Measure) =>
    String.raw`(${alternate([...m.words, ...m.abbrevs, ...(m.compoundAbbrevs ?? [])])})(?![A-Za-z])`;

  return COMPOUNDS.map((compound): Rule => {
    const [largest, next, ...rest] = compound.measures.map(unitOf);
    const part = (unit: string) => String.raw`${AND}(${UNSIGNED_NUMBER})${GAP}${unit}`;
    const optional = rest.reduceRight((inner, unit) => `(?:${part(unit)}${inner})?`, '');
    const pattern = new RegExp(
      String.raw`(${FIRST_NUMBER})${GAP}${largest}${part(next!)}${optional}`,
      'dgi',
    );
    const sided = hasSides(compound.measures[0]!);

    return {
      id: compound.id,
      category: 'units',
      confidence: 'moderate',
      priority: 40,
      find(ctx) {
        const { found, refused } = splitByStart(pattern, ctx.text);
        const changes = refused.map((match) => hold(match.index, match[0], compound.id, 40));
        for (const match of found) {
          if (ORDINAL.test(match[0])) continue;
          const parts = compound.measures
            .map((measure, i) => ({ measure, raw: match[2 * i + 1], unit: match[2 * i + 2] ?? '' }))
            .filter((p) => p.raw !== undefined);
          const values = parts.map((p) => parseNumber(p.raw!));
          if (values.some((v) => v === null)) {
            changes.push(hold(match.index, match[0], compound.id, 40));
            continue;
          }

          const start = match.index;
          NOT_SECOND.lastIndex = start;
          const kept =
            forced[compound.id] !== true && parts.some((p) => isKept(p.measure, skip, forced));
          const second =
            endsRangeWhole(ctx.text, start, match[1]!) || (sided && !NOT_SECOND.test(ctx.text));
          if (kept || second) {
            changes.push(hold(start, match[0], compound.id, 40));
            continue;
          }

          let size = 1;
          const total = (values as number[]).reduce((sum, value, i) => {
            if (i > 0) size /= compound.per[i - 1]!;
            return sum + value * size;
          }, 0);
          const target = compound.measures[0]!.convert(total);
          const { precision, maxDecimals } = ctx.options.units;
          // Several components together claim three figures, as feet and inches do.
          const number = formatNumber(target.value, precision, 3, maxDecimals);

          const isWord = (p: (typeof parts)[number]) =>
            p.measure.words.some((w) => w === p.unit.toLowerCase());
          const last = parts[parts.length - 1]!;
          const end = start + match[0].length;
          const singular = (p: (typeof parts)[number]) =>
            isWord(p) && SINGULAR_WORDS.has(p.unit.toLowerCase());
          // A singular after a number above one says so in any part, as the pound does in
          // `7 pound 1 ounce babies`.
          const value = Math.max(...parts.flatMap((p, i) => (singular(p) ? [values[i]!] : [])));
          const lastNumber = match.indices![2 * parts.length - 1]!;
          const lastUnit = match.indices![2 * parts.length]!;
          const gap = ctx.text.slice(lastNumber[1], lastUnit[0]);
          const attributive = singular(last) && describesNoun(ctx.text, start, value, gap, end);
          const unit = !parts.some(isWord)
            ? target.symbol
            : attributive
              ? target.singular
              : unitWord(target, Number(number.replace(/,/g, '')));
          pushMeasurement(ctx, changes, start, match[0], `${number} ${unit}`, compound.id, 40);
        }
        return changes;
      },
    };
  });
}

function measurementRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  const { alternation, words, byAlias } = buildIndex(skip, forced);
  if (!alternation) return [];

  const S = INLINE_SPACE;
  // The pair guard can only apply before a number in digits, and is too costly to run at every
  // word.
  const START = String.raw`${NUMBER_START}(?:(?=${NUMERIC_FIRST})${NOT_SECOND_OF_PAIR}|(?!${NUMERIC_FIRST}))`;
  // Only a dimension's second number is refused here. `endsRange` judges a range's, which
  // needs both numbers.
  const SINGLE_START =
    String.raw`${NUMBER_START}(?:(?=${NUMERIC_FIRST})(?<!${NUMERIC_LAST}${DIMENSION_JOIN})|(?!${NUMERIC_FIRST}))`;
  const single = new RegExp(
    String.raw`${SINGLE_START}(${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );
  const SECOND_END = String.raw`(?<=\b(?:to|and)\s+)(?:${SECOND_END_WORDS})|${NUMBER_PATTERN}`;
  // The last two figures of a range or a list. `rangeRule` reads back to a list's first.
  const range = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})(${RANGE_JOIN}|${LIST_END})(${SECOND_END})` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  // A spaced `'`, or one after a word, is a quote mark. One before a digit starts the inches
  // of `6'2"`, which `feetInchesRule` reads.
  const SIDE_UNIT = byAlias.has(PRIME)
    ? String.raw`${alternation}|(?<![\sA-Za-z-])${FOOT_MARK}(?!\d)`
    : alternation;
  // An optional unit after an inner number, so `8.5" x 11"` and `10 ft x 12 ft` both match.
  const INNER_UNIT = String.raw`(?:${GAP}(${SIDE_UNIT}))?`;
  const dimensions = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})${INNER_UNIT}${DIMENSION_JOIN}(${NUMBER_PATTERN})` +
      String.raw`(?:${INNER_UNIT}${DIMENSION_JOIN}(${NUMBER_PATTERN}))?` +
      String.raw`${GAP}(${SIDE_UNIT})(?![A-Za-z])`,
    'dgi',
  );

  // Written-out units only, because an abbreviation can be a word: `a gal and a half`.
  // `NOT_IN_COMPOUND` walks back over the spaces before it, so it runs only before a letter.
  const fractionOf = new RegExp(
    String.raw`(?<![\w.])(?=[A-Za-z])${NOT_IN_COMPOUND}` +
      String.raw`${FRACTION_OF}${SOFT_SPACE}(${words})(?![\w-])`,
    'gi',
  );
  const andAFraction = new RegExp(
    String.raw`${START}(${COUNT_BEFORE_FRACTION})${SOFT_SPACE}(${words})` +
      String.raw`${S}+${AND_FRACTION}(?![\w-])`,
    'gi',
  );

  const resolve = (alias: string) => byAlias.get(alias.toLowerCase().replace(/\s+/g, ' '));

  const measurementBefore = new RegExp(
    String.raw`(?<![\w.])(?:${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])${SOFT_SPACE}(?<=\s)$`,
    'di',
  );

  /**
   * Where a length measurement in `measure` starts that ends straight before `start`, with
   * only space between, as `5 ft` does before the `6` of `5 ft 6 to 6 ft`. A number there is
   * a smaller unit of that measurement, never more of the same unit.
   */
  const sameLengthBefore = (text: string, start: number, measure: Measure): number | null => {
    if (!hasSides(measure)) return null;
    const from = Math.max(0, start - NUMBER_REACH);
    const before = measurementBefore.exec(text.slice(from, start));
    if (before === null || resolve(before[1]!)?.measure !== measure) return null;
    const quantity = before[0].slice(0, before.indices![1]![1] - before.index);
    return isBareInch(before[1]!, quantity) ? null : from + before.index;
  };

  /** A written-out quantity with its unit inside it, as in `half a mile`. */
  const pushWrapped = (
    ctx: RuleContext,
    changes: Change[],
    start: number,
    matched: string,
    value: number | null,
    alias: string,
  ): void => {
    const entry = resolve(alias);
    if (!entry || value === null) return;
    // A noun straight after claims the words before it: `half a pound cake` is half a cake,
    // and `a mile and a half hour later` is half an hour.
    if (MODIFIES_A_NOUN.test(ctx.text.slice(start + matched.length))) return;
    if (
      isOtherSense(ctx, entry, start, start + matched.length) ||
      (entry.isWord && isPartOfName(ctx.text, alias, start + matched.length))
    ) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    if (isAmbiguousHere(entry.measure, ctx.text)) return;
    if (isConventional(ctx, entry.measure, start, start + matched.length)) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }

    const target = entry.measure.convert(value);
    const { precision, maxDecimals } = ctx.options.units;
    const number = formatNumber(target.value, precision, significantFigures(matched), maxDecimals);
    const body = `${number} ${unitWord(target, Number(number.replace(/,/g, '')))}`;
    pushMeasurement(ctx, changes, start, matched, body, entry.measure.id, 30);
  };

  /** A quantity read on its own, as in `6 feet` or the `4 oz` of `2 x 4 oz cans`. */
  const pushSingle = (
    ctx: RuleContext,
    changes: Change[],
    start: number,
    matched: string,
    raw: string,
    alias: string,
    value = parseNumber(raw),
  ): void => {
    const entry = resolve(alias);
    if (!entry || value === null) return;
    const gap = matched.slice(raw.length, matched.length - alias.length);
    // The hyphen ties the fraction to the unit, so the count before them counts the noun,
    // as in `two quarter-pound burgers`.
    const count = entry.isSingular && matched[raw.length] === '-' ? COUNT_APART.exec(raw) : null;
    if (
      count &&
      (MODIFIES_A_NOUN.test(ctx.text.slice(start + matched.length)) ||
        sizesNoun(ctx.text, start + matched.length))
    ) {
      const cut = count[0].length;
      pushSingle(ctx, changes, start + cut, matched.slice(cut), raw.slice(cut), alias);
      return;
    }
    if (entry.isSingular && countsSizedNoun(ctx.text, start, raw, gap, start + matched.length)) {
      // The unit is one of itself, as the foot of a foot-long sub is.
      pushSingle(ctx, changes, start + matched.length - alias.length, alias, '', alias, 1);
      return;
    }
    if (
      isOtherSense(ctx, entry, start, start + matched.length) ||
      (entry.isWord && isPartOfName(ctx.text, alias, start + matched.length)) ||
      (entry.isWord && mayBeYear(ctx.text, start, raw, gap, start + matched.length))
    ) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    if (isAmbiguousHere(entry.measure, ctx.text)) return;
    if (isBareInch(alias, matched)) return;
    if (
      isInParticle(ctx.text, start, start + matched.length, alias) ||
      isConventional(ctx, entry.measure, start, start + matched.length)
    ) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }

    const target = entry.measure.convert(value);
    const { precision, maxDecimals } = ctx.options.units;
    const number = formatNumber(target.value, precision, significantFigures(raw), maxDecimals);
    const numberStart = start + (/^an?\s+/i.exec(raw)?.[0].length ?? 0);
    const attributive =
      entry.isWord &&
      entry.isSingular &&
      describesNoun(ctx.text, numberStart, value, gap, start + matched.length);
    const unit = entry.isWord
      ? ` ${attributive ? target.singular : unitWord(target, Number(number.replace(/,/g, '')))}`
      : ` ${target.symbol}`;
    // `a quarter mile track` keeps its article for the track, while `a quarter mile away`
    // gives it to the number.
    const from = attributive ? numberStart : start;
    const quantity = matched.slice(from - start);

    pushBeforeSize(ctx, changes, from, quantity, `${number}${unit}`, entry.measure.id, 30);
  };

  const rangeRule: Rule = {
    id: 'units.range',
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      range.lastIndex = 0;
      for (const match of ctx.text.matchAll(range)) {
        const pair = match[0];
        const [lowRaw, join, highRaw, alias] = [match[1]!, match[2]!, match[3]!, match[4]!];
        const pairStart = match.index;
        const end = pairStart + pair.length;
        const entry = resolve(alias);
        const low = parseNumber(lowRaw);
        const high = parseNumber(highRaw);
        if (!entry || low === null || high === null || high === 0) continue;
        if (isQuotationMark(ctx.text, end - 1)) continue;
        // `2-3/4` is one number, which the single measurement rule reads.
        const pairWritten = isWritten(lowRaw) || isWritten(highRaw);
        if (!pairWritten && TIGHT_HYPHEN.test(join) && parseNumber(`${lowRaw}-${highRaw}`) !== null) continue;
        if (!canBeRange(ctx.text, pairStart, low, high)) continue;
        const earlier = figuresBefore(ctx.text, pairStart, low, high, join);
        if (earlier === null) continue;
        const start = earlier[0]?.start ?? pairStart;
        const matched = ctx.text.slice(start, end);
        const raws = [...earlier.map((figure) => figure.raw), lowRaw, highRaw];
        const joins = [...earlier.map((figure) => figure.join), join];
        const written = raws.some(isWritten);
        const reading = written ? writtenList(ctx.text, start, raws, joins) : 'read';
        if (reading === 'skip') continue;
        // A list that starts as the second number of a pair, as in `1 to 2, 4 or 6 feet`.
        NOT_SECOND.lastIndex = start;
        const secondOfPair = earlier.length > 0 && !NOT_SECOND.test(ctx.text);
        const measurementStart = sameLengthBefore(ctx.text, start, entry.measure);
        if (measurementStart !== null) {
          // The inches of a height are for `feetInchesRule`. Any other smaller unit cannot be
          // read, so the measurement and range stay as written.
          if (!isHeightInches(ctx.text, start)) {
            const held = ctx.text.slice(measurementStart, end);
            changes.push(hold(measurementStart, held, entry.measure.id, 35));
          }
          continue;
        }
        if (
          isOtherSense(ctx, entry, start, end) ||
          (entry.isWord && isPartOfName(ctx.text, alias, end))
        ) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(alias, matched)) continue;
        const conventional = isConventional(ctx, entry.measure, start, end);
        const particle = isInParticle(ctx.text, start, end, alias);
        if (reading === 'hold' || conventional || secondOfPair || particle) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }

        // Every figure shares the unit chosen for the last, so the range or list stays readable.
        const target = entry.measure.convert(high);
        const perSourceUnit = target.value / high;
        const figures = Math.max(...raws.map(significantFigures));
        const { precision, maxDecimals } = ctx.options.units;
        const texts = [...earlier.map((figure) => figure.value), low].map((value) =>
          formatNumber(value * perSourceUnit, precision, figures, maxDecimals),
        );
        texts.push(formatNumber(target.value, precision, figures, maxDecimals));
        const gap = pair.slice(lowRaw.length + join.length + highRaw.length, -alias.length);
        const attributive = entry.isSingular && describesNoun(ctx.text, start, high, gap, end);
        const unit = entry.isWord
          ? ` ${attributive ? target.singular : target.plural}`
          : ` ${target.symbol}`;
        const body = interleave(texts, joins.map(separator)) + unit;

        pushBeforeSize(ctx, changes, start, matched, body, entry.measure.id, 35);
      }
      return changes;
    },
  };

  /**
   * `8.5 x 11 inches` and `10 x 12 x 8 feet` are one measurement, not two or three.
   * Converting half of a dimension pair produces nonsense, so they move together and
   * share the unit chosen for the largest of them. Each side is read in its own unit, so
   * `2 feet x 6 inches` comes to `61 x 15 centimetres`. Only a length has sides. With any
   * other unit a bare number is a count and each quantity converts on its own, so
   * `2 x 4 oz cans` comes to `2 x 110 g cans`. A whole number in words is a side as digits
   * are, as in `ten by twelve feet`, and a counted fraction in words, such as
   * `two and a half`, holds the dimension as written.
   */
  const dimensionRule: Rule = {
    id: 'units.dimensions',
    category: 'units',
    confidence: 'moderate',
    priority: 38,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      let gate: Gate | undefined;
      const switchedOff = (measure: Measure) =>
        !(gate ??= buildGate(ctx.options)).rule(measure.id, 'units', MEASUREMENT_CONFIDENCE);
      dimensions.lastIndex = 0;
      for (const match of ctx.text.matchAll(dimensions)) {
        const start = match.index;
        const end = start + match[0].length;
        // The groups holding each side's number and the unit written straight after it.
        const groups: Array<[number, number]> =
          match[5] === undefined ? [[1, 2], [3, 6]] : [[1, 2], [3, 4], [5, 6]];
        const sides = groups.map(([number, unit], i) => {
          const alias = match[unit];
          const sideEnd = match.indices![alias === undefined ? number : unit]![1];
          const next = groups[i + 1];
          return {
            raw: match[number]!,
            value: parseNumber(match[number]!),
            alias,
            entry: alias === undefined ? undefined : resolve(isFootMark(alias) ? PRIME : alias),
            bareInch: alias !== undefined && isBareInch(alias, ctx.text.slice(start, sideEnd)),
            quoted: alias !== undefined && isQuotationMark(ctx.text, sideEnd - 1),
            beforeTimes:
              next !== undefined &&
              !/by/i.test(ctx.text.slice(sideEnd, match.indices![next[0]]![0])),
          };
        });
        if (sides.some((s) => s.value === null || (s.alias !== undefined && !s.entry))) continue;
        if (sides.some((s) => isUncounted(s.raw))) continue;
        const first = sides[0]!;
        const last = sides[sides.length - 1]!;
        const entry = last.entry!;
        const before = ctx.text.slice(Math.max(0, start - 24), start);
        if (entry.isWord && isPartOfName(ctx.text, last.alias!, end)) {
          changes.push(hold(start, match[0], entry.measure.id, 38));
          continue;
        }

        // A side whose mark closes a quotation is a number, and converting the other sides alone
        // would split the dimension.
        if (sides.some((s) => s.quoted)) {
          changes.push(hold(start, match[0], 'units.dimensions', 38));
          continue;
        }
        if (sides.some((s) => isFootMark(s.alias))) {
          const lengths = sides.every((s) => !s.entry || hasSides(s.entry.measure));
          if (OPENS_QUOTE.test(before) || !lengths) continue;
          // A side with no mark of its own leaves the `'` unconfirmed, and converting the
          // other sides alone would split the dimension.
          if (sides.some((s) => !s.entry)) {
            changes.push(hold(start, match[0], 'units.dimensions', 38));
            continue;
          }
        }

        // A number with no unit of its own may be a noun, with `by` giving an amount. A pair
        // in digits before a noun describes it, as in `those 4 by 6 inch photos`.
        const describes =
          !(entry.isWord && !entry.isSingular) &&
          (MODIFIES_A_NOUN.test(ctx.text.slice(end)) || sizesNoun(ctx.text, end));
        const mayBeNoun =
          /\bby\b/i.test(match[0]) && !first.alias && (isWritten(first.raw) || !describes);
        const one = /^one$/i.test(first.raw);
        const noun = NUMBER_AS_NOUN.test(before) || (one && ONE_AS_NOUN.test(before));
        if (mayBeNoun && noun) {
          // The single rule never reads a number in digits straight after `4 by`.
          if (sides.length === 2) {
            const from = match.indices![groups[1]![0]]![0];
            pushSingle(ctx, changes, from, ctx.text.slice(from, end), last.raw, last.alias!);
          }
          continue;
        }

        // A side with no unit of its own takes the next one written, as in `10 x 12 feet`.
        const units: Alias[] = [];
        for (let i = sides.length - 1; i >= 0; i--) units[i] = sides[i]!.entry ?? units[i + 1]!;
        const measures = [...new Set(units.map((u) => u.measure))];

        const otherSense = units.find((u) => isOtherSense(ctx, u, start, end));
        if (otherSense) {
          changes.push(hold(start, match[0], otherSense.measure.id, 38));
          continue;
        }
        if (measures.some((m) => isAmbiguousHere(m, ctx.text))) continue;
        // After the sense checks, because a count is part of the amount in `It cost 2 x 5 pounds`.
        if (!measures.every(hasSides)) {
          for (const [i, side] of sides.entries()) {
            if (side.alias === undefined) continue;
            const [number, unit] = groups[i]!;
            const from = match.indices![number]![0];
            const quantity = ctx.text.slice(from, match.indices![unit]![1]);
            pushSingle(ctx, changes, from, quantity, side.raw, side.alias);
          }
          continue;
        }
        // A last `in` is the unit beside an earlier side with a unit of its own, as in
        // `10 ft x 12 in`, and an `in` before `x` and another number is one, as in
        // `4 in x 6 in`. Before `by` it may be the preposition: `6 in by 5 in the morning`. A
        // `'` needs the other sides to confirm it, so it cannot confirm an `in`.
        const confirms = (s: (typeof sides)[number]) =>
          s !== last &&
          s.entry !== undefined &&
          !isFootMark(s.alias) &&
          (!s.bareInch || s.beforeTimes);
        if (last.bareInch && !sides.some(confirms)) continue;
        // `one by` may be a pronoun and an amount, as in `lower one by two feet`.
        if (sides.some((s) => !READABLE_NUMBER.test(s.raw)) || (mayBeNoun && one)) {
          changes.push(hold(start, match[0], entry.measure.id, 38));
          continue;
        }

        const scale = commonScale(measures);
        if (!scale) continue;
        const inBase = sides.map((s, i) => s.value! * scale.get(units[i]!.measure)!);
        const largest = inBase.reduce((a, v, i) => (Math.abs(v) > Math.abs(inBase[a]!) ? i : a), 0);
        if (inBase[largest] === 0) continue;

        // The change goes under one unit's id, so the gate cannot stop the other units. The
        // hold goes under this rule's id, which the gate has already let through.
        if (measures.length > 1 && measures.some(switchedOff)) {
          changes.push(hold(start, match[0], 'units.dimensions', 38));
          continue;
        }
        // `10 ft x 12 x 6 in` could mean the `12` in either unit.
        const unclear = sides.some(
          (s, i) => !s.entry && i > 0 && units[i - 1]!.measure !== units[i]!.measure,
        );
        if (unclear || measures.some((m) => isConventional(ctx, m, start, end))) {
          changes.push(hold(start, match[0], entry.measure.id, 38));
          continue;
        }

        const target = units[largest]!.measure.convert(sides[largest]!.value!);
        const perBase = target.value / inBase[largest]!;
        const figures = Math.max(...sides.map((s) => significantFigures(s.raw)));
        const { precision, maxDecimals } = ctx.options.units;
        const separator = /\bby\b/i.test(match[0]) ? ' by ' : match[0].includes('×') ? ' × ' : ' x ';
        const unit = entry.isWord
          ? ` ${entry.isSingular ? target.singular : target.plural}`
          : ` ${target.symbol}`;
        const body =
          inBase
            .map((v) => formatNumber(v * perBase, precision, figures, maxDecimals))
            .join(separator) + unit;

        pushMeasurement(ctx, changes, start, match[0], body, entry.measure.id, 38);
      }
      return changes;
    },
  };

  const singleRule: Rule = {
    id: 'units.measurement',
    category: 'units',
    confidence: 'moderate',
    priority: 30,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      single.lastIndex = 0;
      for (let match: RegExpExecArray | null; (match = single.exec(ctx.text)) !== null; ) {
        if (isQuotationMark(ctx.text, match.index + match[0].length - 1)) continue;
        const value = parseNumber(match[1]!);
        if (resolve(match[2]!) && value !== null && endsRange(ctx.text, match.index, value)) {
          // Resumes at the next character, as past a start the pattern refused, so a measurement
          // that starts inside this match is still found.
          single.lastIndex = match.index + 1;
          continue;
        }
        pushSingle(ctx, changes, match.index, match[0], match[1]!, match[2]!);
      }

      fractionOf.lastIndex = 0;
      for (const match of ctx.text.matchAll(fractionOf)) {
        pushWrapped(ctx, changes, match.index, match[0], parseNumber(match[1] ?? match[2]!), match[3]!);
      }
      andAFraction.lastIndex = 0;
      for (const match of ctx.text.matchAll(andAFraction)) {
        const whole = parseNumber(match[1]!);
        const fraction = parseNumber(match[3]!);
        const value = whole === null || fraction === null ? null : whole + fraction;
        pushWrapped(ctx, changes, match.index, match[0], value, match[2]!);
      }
      return changes;
    },
  };

  return [dimensionRule, rangeRule, singleRule];
}

/**
 * A change in temperature, told by the words just before it: a verb of change, `by`,
 * `up`, `down` or `a drop of`, with at most a hedge such as `nearly` in between. A verb
 * followed by `to` or `from` names the new temperature, so it does not count.
 * Bare `fall` is left out because it is also the season.
 */
const CHANGE_BEFORE = new RegExp(
  String.raw`\b(?:drop(?:s|ped|ping)?|fell|falls|fallen|falling|r(?:ise[sn]?|ising|ose)|` +
    String.raw`climb(?:s|ed|ing)?|jump(?:s|ed|ing)?|dip(?:s|ped|ping)?|plung(?:e[sd]?|ing)|` +
    String.raw`plummet(?:s|ed|ing)?|soar(?:s|ed|ing)?|spik(?:e[sd]|ing)|surg(?:e[sd]?|ing)|` +
    String.raw`increas(?:e[sd]?|ing)|decreas(?:e[sd]?|ing)|by|up|down|` +
    String.raw`(?:drop|rise|fall|increase|decrease|change|swing|difference|jump|dip)s?\s+of)` +
    String.raw`(?:\s+(?:about|around|roughly|nearly|almost|some|another|a\s+further|just|only))?\s+$`,
  'i',
);

/**
 * A change in temperature, told by the words just after it: a comparative, a noun of
 * change, or a distance from a norm. `above` and `below` mean a difference only here;
 * before the number they set a threshold. `fall` is left out because `a 60°F fall day`
 * is the season.
 */
const CHANGE_AFTER = new RegExp(
  String.raw`^\s+(?:warmer|cooler|hotter|colder|higher|lower|` +
    String.raw`(?:temperature\s+)?(?:drop|rise|increase|decrease|change|swing|difference|jump|dip)s?|` +
    String.raw`(?:above|below)\s+(?:the\s+)?(?:seasonal\s+)?(?:normal|average|norm|freezing))\b`,
  'i',
);

/** `10°F below zero` is a negative temperature, not a distance from zero. */
const FROM_ZERO = /^\s+(above|below)\s+zero\b/i;

/** The Celsius value in brackets or joined by `/` or `or` at the start of `rest`. */
function celsiusPartnerAfter(rest: string): MetricPartner | undefined {
  const partner = metricPartnerAfter(rest);
  if (dimensionOf(METRIC_INNER.exec(partner?.metric ?? '')) !== 'temperature') return undefined;
  return partner;
}

/**
 * The text either side of a Fahrenheit value from `start` to `end`, past any Celsius value
 * given beside it, where the words that mark a change in temperature stand, as they do in
 * `20°F (11°C) warmer` and `rose 11°C or 20°F`.
 */
function wordsBeside(text: string, start: number, end: number): { before: string; after: string } {
  const paired = metricPairedBefore(text, start, end);
  const from = paired?.dimension === 'temperature' ? paired.start : start;
  const to = end + (celsiusPartnerAfter(text.slice(end))?.length ?? 0);
  return {
    before: text.slice(Math.max(0, from - CONTEXT_WINDOW), from),
    after: text.slice(to, to + CONTEXT_WINDOW),
  };
}

const ABSOLUTE_ID = 'units.temperature.fahrenheit';
const DIFFERENCE_ID = 'units.temperature.difference';

interface FahrenheitReading {
  start: number;
  /** The source text, including any `below zero` folded into the value. */
  matched: string;
  body: string;
  ruleId: typeof ABSOLUTE_ID | typeof DIFFERENCE_ID;
}

/**
 * The ends of a range at one precision, matching the more precise end of the source.
 * A narrow range takes extra figures where it would otherwise print both ends the same.
 */
function formatEnds(ctx: RuleContext, values: number[], raw: string[]): string[] {
  const { precision, maxDecimals } = ctx.options.units;
  const figures = Math.max(...raw.map(significantFigures));
  let texts = values.map((v) => formatNumber(v, precision, figures, maxDecimals));
  for (let extra = 1; extra <= 2 && texts.length === 2 && texts[0] === texts[1]; extra++) {
    texts = values.map((v) => formatNumber(v, precision, figures + extra, maxDecimals));
  }
  return texts;
}

const readDegreesBefore = listReader(DEGREES);

/** What each Fahrenheit match gives, with a list such as `325, 350 or 375°F` read whole. */
function fahrenheitReadings(
  ctx: RuleContext,
  matches: Iterable<RegExpExecArray> = fahrenheitTemperatures(ctx.text),
): FahrenheitReading[] {
  const readings: FahrenheitReading[] = [];
  for (const match of matches) {
    const pair = match[1] === undefined ? [match[3]!] : [match[1], match[3]!];
    const parsed = pair.map(parseNumber);
    if (parsed.some((v) => v === null)) continue;
    const range = match[2] === undefined ? undefined : { join: match[2], high: parsed[1]! };
    const listed = listedBefore(ctx.text, match.index, parsed[0]!, range, readDegreesBefore);
    const raw = [...listed.map((figure) => figure.raw), ...pair];
    const joins = [...listed.map((figure) => figure.join), ...(range === undefined ? [] : [range.join])];
    let values = [...listed.map((figure) => figure.value), ...(parsed as number[])];

    const start = listed[0]?.start ?? match.index;
    const whole = ctx.text.slice(start, match.index + match[0].length);
    // A stop that stays in the text stays outside the value and any kept original.
    const valueEnd = start + whole.length - (fahrenheitKeepsStop(ctx.text, start, whole) ? 1 : 0);
    let end = valueEnd;
    const beside = wordsBeside(ctx.text, start, end);
    const after = ctx.text.slice(end, end + CONTEXT_WINDOW);
    const zero = FROM_ZERO.exec(after);
    if (zero) {
      end += zero[0].length;
      if (zero[1]!.toLowerCase() === 'below') values = values.map((v) => -Math.abs(v));
    }
    const difference = !zero && (CHANGE_BEFORE.test(beside.before) || CHANGE_AFTER.test(beside.after));

    let numbers: string[];
    if (difference) {
      numbers = formatEnds(ctx, values.map((v) => (v * 5) / 9), raw);
    } else if (values.length === 1 || values.every(isOvenSetting)) {
      const { precision, maxDecimals } = ctx.options.units;
      numbers = values.map((v) => formatTemperature(((v - 32) * 5) / 9, precision, v, maxDecimals));
    } else {
      numbers = formatEnds(ctx, values.map((v) => ((v - 32) * 5) / 9), raw);
    }

    const unit = match[4] ?? '';
    const spelled = /degrees?/i.test(unit);
    const gap = /\s*$/.exec(match[0].slice(0, match[0].length - unit.length))![0];
    const singular =
      (numbers.length === 1 && Math.abs(Number(numbers[0])) === 1) ||
      (/^degree(?!s)/i.test(unit) && describesNoun(ctx.text, start, values.at(-1)!, gap, valueEnd));
    const suffix = spelled ? ` ${singular ? 'degree' : 'degrees'} Celsius` : '°C';
    readings.push({
      start,
      matched: ctx.text.slice(start, end),
      body: interleave(numbers, joins) + suffix,
      ruleId: difference ? DIFFERENCE_ID : ABSOLUTE_ID,
    });
  }
  return readings;
}

/** A rule run with the default options and no verdict, for a caller outside one. */
const DEFAULT_RUN: Omit<RuleContext, 'text'> = {
  options: resolveOptions(),
  signals: {
    confidence: 0,
    markers: [],
    unambiguousMonthFirstDates: 0,
    unambiguousDayFirstDates: 0,
    namedMonthFirstDates: 0,
    namedDayFirstDates: 0,
  },
  american: false,
};

/**
 * Whether the Fahrenheit temperature `match`, as `fahrenheitTemperatures` gives it, only
 * restates the Celsius value before it, as in `175°C (350°F)` and `180°C/350°F`. The
 * temperature rules leave such a value as written. A value before its Celsius partner, as
 * in `350°F (175°C)`, is not a restatement: the rules convert it by dropping the partner.
 */
export function restatesCelsiusBefore(text: string, match: RegExpExecArray): boolean {
  const ctx = { ...DEFAULT_RUN, text };
  const [reading] = fahrenheitReadings(ctx, [match]);
  if (reading === undefined) return false;
  const end = reading.start + reading.matched.length;
  return (
    restatesMetric(ctx, reading.start, end) ||
    followsItsMetric(ctx, reading.start, end, reading.body, reading.ruleId)
  );
}

/**
 * A temperature and a change in temperature convert differently: `20°F` is -6.7°C, but
 * `a 20°F drop` is an 11°C drop. Both rules read the same matches and each converts only
 * its own kind, so switching one off leaves that kind in Fahrenheit, never misread as
 * the other.
 */
function temperatureRules(): Rule[] {
  return [ABSOLUTE_ID, DIFFERENCE_ID].map(
    (id): Rule => ({
      id,
      category: 'units',
      confidence: 'moderate',
      priority: 35,
      find(ctx) {
        const changes: Change[] = [];
        for (const reading of fahrenheitReadings(ctx)) {
          if (reading.ruleId !== id) continue;
          pushMeasurement(ctx, changes, reading.start, reading.matched, reading.body, id, 35);
        }
        return changes;
      },
    }),
  );
}

/**
 * `on mild days in the 70s` is a Fahrenheit decade, and means nothing to a reader who
 * thinks in Celsius. It cannot become `the 20s`, because 70-79F spans 21-26C and
 * straddles the band, so it becomes an explicit range instead.
 *
 * The risk is that `the 70s` is far more often a decade of the calendar, so this needs
 * temperature words nearby and refuses outright when the sentence is talking about time.
 */
function temperatureDecadeRule(): Rule {
  // A decade, optionally banded (`low`, `mid`, `upper`), optionally paired with a second
  // decade (`the 70s and 80s`). `70's` and `low-70s` are both written in the wild.
  const DECADE = String.raw`(low|mid|middle|high|upper|lower)?(?:\s|${HYPHEN})*(1[01]0|\d0)['\u2019]?s`;
  const pattern = new RegExp(
    String.raw`(?<![\w.])(?:(in|into|around|about|near|above|below|over|under)\s+)?the\s+${DECADE}` +
      String.raw`(?:\s*(?:and|to|${HYPHEN}|\u2013)\s*${DECADE})?(?!\w)` +
      // A bare `degrees` after a decade can only be its unit, unless a Celsius unit begins there.
      String.raw`(\s*(?:${FAHRENHEIT}|Fahrenheit\b|(?!${metricUnitForms('temperature')})degrees\b))?`,
    'gi',
  );

  const TEMPERATURE_NEARBY =
    /\b(?:temperatures?|degrees?|weather|heat|humidity|forecasts?|highs?|lows?|warm|warmer|mild|cool|cooler|chilly|hot|hotter|cold|colder|freezing|thermometer|climate|Fahrenheit|outdoors?|outside)\b/i;

  // Phrases that pin `the 70s` to the calendar rather than the thermometer.
  const A_DECADE =
    /\b(?:back|music|song|songs|band|bands|born|era|decade|decades|throughout|during|since|fashion|nostalgia|album|movie|movies|film|films|show|shows|style|revival|late|early|mid-)\s*$/i;

  const SPREAD: Record<string, [number, number]> = {
    low: [0, 3],
    lower: [0, 3],
    mid: [4, 6],
    middle: [4, 6],
    high: [7, 9],
    upper: [7, 9],
  };

  const toCelsius = (f: number) => Math.round(((f - 32) * 5) / 9);

  return {
    id: 'units.temperature.decade',
    category: 'units',
    confidence: 'risky',
    priority: 36,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;

      for (const match of ctx.text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const before = ctx.text.slice(Math.max(0, start - 90), start);
        const after = ctx.text.slice(end, end + 90);

        if (A_DECADE.test(before)) continue;
        const marked = match[6] !== undefined;
        if (!marked && !TEMPERATURE_NEARBY.test(before) && !TEMPERATURE_NEARBY.test(after)) continue;

        const firstBand = SPREAD[(match[2] ?? '').toLowerCase()] ?? [0, 9];
        // With a second decade the range runs from the bottom of the first to the top of
        // the second: `the 70s and 80s` is 70 through 89.
        const lastBand = match[5] === undefined ? firstBand : SPREAD[(match[4] ?? '').toLowerCase()] ?? [0, 9];
        const low = toCelsius(Number(match[3]) + firstBand[0]);
        const high = toCelsius(Number(match[5] ?? match[3]) + lastBand[1]);
        if (low >= high) continue;

        // `days in the 70s` has to become `days between 21 and 26C`, never `days in
        // between`, so the preposition is swallowed rather than left dangling.
        const body = match[1] ? `between ${low} and ${high}°C` : `${low} to ${high}°C`;

        changes.push({
          start,
          end,
          before: match[0],
          after: fahrenheitKeepsStop(ctx.text, start, match[0]) ? `${body}.` : body,
          ruleId: 'units.temperature.decade',
          category: 'units',
          confidence: 'risky',
          priority: 36,
          note: 'a Fahrenheit decade, which has no single Celsius equivalent',
        });
      }
      return changes;
    },
  };
}

/**
 * `dime to quarter-sized hail` is a real American unit of measure, used by the National
 * Weather Service and by anyone describing a dent or a bruise. It is also completely
 * opaque anywhere else: an Australian twenty-cent piece is 28 mm, so guessing from a
 * local coin gets it wrong rather than merely vague.
 *
 * Diameters are the United States Mint's, not the rounded values on the NWS hail chart.
 */
function coinSizeRule(): Rule {
  const COINS: Record<string, number> = {
    penny: 19,
    pennies: 19,
    nickel: 21,
    dime: 18,
    quarter: 24,
    'half dollar': 31,
    'half-dollar': 31,
    'silver dollar': 38,
  };

  const names = Object.keys(COINS).sort((a, b) => b.length - a.length).join('|');
  const pattern = new RegExp(
    String.raw`(?<![\w-])(${names})(?:\s*(?:to|-)\s*(${names}))?[\s-]*sized?(?![\w-])`,
    'gi',
  );

  // `quarter` is also a fraction, so on its own it needs something coin-shaped to size.
  const SIZED_THING =
    /\b(?:hail|hailstones?|dent|dents|bruise|bruises|spot|spots|lesion|lesions|patch|patches|hole|holes|blister|welt|mark|marks|lump|nodule|rash)\b/i;

  return {
    id: 'units.length.coin',
    category: 'units',
    confidence: 'risky',
    priority: 34,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;

      for (const match of ctx.text.matchAll(pattern)) {
        const first = COINS[match[1]!.toLowerCase()];
        const second = match[2] ? COINS[match[2].toLowerCase()] : undefined;
        if (first === undefined) continue;

        const onlyQuarter = match[1]!.toLowerCase() === 'quarter' && second === undefined;
        if (onlyQuarter) {
          const around = ctx.text.slice(Math.max(0, match.index - 60), match.index + 60);
          if (!SIZED_THING.test(around)) continue;
        }

        const body =
          second === undefined
            ? `${first} mm`
            : `${Math.min(first, second)} to ${Math.max(first, second)} mm`;

        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: body,
          ruleId: 'units.length.coin',
          category: 'units',
          confidence: 'risky',
          priority: 34,
          note: 'a US coin used as a unit of size, which is opaque outside America',
        });
      }
      return changes;
    },
  };
}

/**
 * `30 mpg`, `30 miles per gallon` and `30 mi/gal` become litres per 100 km, or km per litre.
 * A range converts both ends and gives the smaller first, though litres per 100 km fall as
 * miles per gallon rise: `20 to 30 mpg` becomes `7.8 to 12 L/100km`. A list does the same,
 * so `20, 25 or 30 mpg` becomes `7.8, 9.4 or 12 L/100km`. After `from` the order shows a
 * direction, so it stays: `from 20 to 30 mpg` becomes `from 12 to 7.8 L/100km`. A range, list
 * or figure the rule cannot convert whole is held, so the length rule never reads its
 * `miles`.
 */
function fuelEconomyRule(): Rule {
  const id = 'units.economy.mpg';
  const MPG = String.raw`\d+(?:\.\d+)?`;
  const PLAIN_MPG = new RegExp(`^(?:${MPG})$`);
  const UNIT = String.raw`${GAP}(?:${MPG_FORMS.join('|')})(?![A-Za-z])`;
  const single = new RegExp(String.raw`${NUMBER_START}(${MPG})${UNIT}`, 'gi');
  // Must start where the range rule starts, so the two read the same ranges.
  const START = String.raw`${NUMBER_START}(?:(?=${NUMERIC_FIRST})${NOT_SECOND_OF_PAIR}|(?!${NUMERIC_FIRST}))`;
  const range = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})(${RANGE_JOIN}|${LIST_END})(${MPG})${UNIT}`,
    'gi',
  );
  const FROM_BEFORE = /\bfrom\s+$/i;

  return {
    id,
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx) {
      const changes: Change[] = [];
      const perLitre = ctx.options.units.fuelEconomy === 'km-per-l';
      const { precision, maxDecimals } = ctx.options.units;
      const rate = (mpg: number) => (perLitre ? mpg * 0.425143707 : 235.214583 / mpg);
      const economy = (mpg: number, figures: number) =>
        formatNumber(rate(mpg), precision, figures, maxDecimals);
      const unit = perLitre ? 'km/L' : 'L/100km';
      // Where each range read here ends, which is where its second end's own match ends.
      const rangeEnds = new Set<number>();

      range.lastIndex = 0;
      for (const match of ctx.text.matchAll(range)) {
        const [pair, lowRaw, join, highRaw] = [match[0], match[1]!, match[2]!, match[3]!];
        const pairStart = match.index;
        const low = parseNumber(lowRaw);
        const high = Number(highRaw);
        if (low === null || !canBeRange(ctx.text, pairStart, low, high)) continue;
        const earlier = figuresBefore(ctx.text, pairStart, low, high, join);
        if (earlier === null) continue;
        const start = earlier[0]?.start ?? pairStart;
        const end = pairStart + pair.length;
        const matched = ctx.text.slice(start, end);
        const raws = [...earlier.map((figure) => figure.raw), lowRaw, highRaw];
        const joins = [...earlier.map((figure) => figure.join), join];
        const reading = raws.some(isWritten) ? writtenList(ctx.text, start, raws, joins) : 'read';
        if (reading === 'skip') continue;
        rangeEnds.add(end);
        const values = [...earlier.map((figure) => figure.value), low, high];
        if (reading === 'hold' || !raws.every((raw) => PLAIN_MPG.test(raw)) || values.includes(0)) {
          changes.push(hold(start, matched, id, 35));
          continue;
        }
        const figures = Math.max(2, ...raws.map(significantFigures));
        const separators = joins.map(separator);
        const write = (order: number[]) =>
          `${interleave(order.map((mpg) => economy(mpg, figures)), separators)} ${unit}`;
        const asWritten = write(values);
        const keepOrder =
          rate(values[0]!) <= rate(high) ||
          FROM_BEFORE.test(ctx.text.slice(Math.max(0, start - 16), start)) ||
          // An author's own metric value may give the ends in the source's order, and
          // `pushMeasurement` keeps it in place of the conversion.
          redundantMetric(ctx, end, asWritten, id) !== null ||
          followsItsMetric(ctx, start, end, asWritten, id);
        const body = keepOrder ? asWritten : write([...values].reverse());
        pushMeasurement(ctx, changes, start, matched, body, id, 35);
      }

      single.lastIndex = 0;
      for (const match of ctx.text.matchAll(single)) {
        // Its range settles it.
        if (rangeEnds.has(match.index + match[0].length)) continue;
        const mpg = Number(match[1]);
        if (!mpg || endsRange(ctx.text, match.index, mpg)) {
          changes.push(hold(match.index, match[0], id, 35));
          continue;
        }
        const body = `${economy(mpg, Math.max(2, significantFigures(match[1]!)))} ${unit}`;
        pushMeasurement(ctx, changes, match.index, match[0], body, id, 35);
      }
      return changes;
    },
  };
}

export function unitRules(options: ResolvedOptions, dialectKeep: string[]): Rule[] {
  const skip = new Set([...dialectKeep, ...options.unitsKeep]);
  return [
    feetInchesRule(),
    ...compoundRules(skip, options.rules),
    ...temperatureRules(),
    temperatureDecadeRule(),
    coinSizeRule(),
    fuelEconomyRule(),
    ...measurementRules(skip, options.rules),
  ];
}
