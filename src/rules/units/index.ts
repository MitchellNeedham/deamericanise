import { buildGate, resolveOptions, type Gate } from '../../config.js';
import type { Change, Confidence, Precision, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import { MONTH_PATTERN } from '../dates.js';
import { CLOSING, LIST_MARKER, OPENING, endsSentence, sentenceBounds, stopStays } from '../sentence.js';
import { CALENDAR_WORD } from '../times.js';
import {
  COMPOUNDS,
  HEIGHT,
  MEASURES,
  OWN_PLURAL_WORDS,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
  type Sense,
} from './definitions.js';
import {
  BARE,
  BARE_CELSIUS_FIGURE,
  DEGREES,
  DEGREE_GAP,
  FAHRENHEIT,
  GAS_MARK,
  OPENER as SENTENCE_OPENER,
  fahrenheitTemperatures,
  sentenceAround,
} from './fahrenheit.js';
import { PREPOSITION_IN, readMeasurementsWith } from './money.js';
import {
  COUNTED_FRACTION,
  FRACTION_WORDS,
  HYPHEN,
  INLINE_SPACE,
  LIST_END,
  MEASUREMENT_START,
  NOT_IN_COMPOUND,
  NUMBER_PATTERN,
  NUMBER_PREFIX,
  NUMBER_START,
  NUMERIC_FIRST,
  NUMERIC_LAST,
  NUMERIC_PATTERN,
  OUTSIDE_WORD,
  SECOND_END_WORDS,
  SOFT_SPACE,
  SPACE_GROUPED,
  UNIT_END,
  VULGAR_CLASS,
  WHOLE_NUMBER,
  canBeRange,
  countBeforeGroup,
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
/**
 * A hyphen left hanging on a range's first number, since the unit's hyphen is written once for
 * both ends, and then a word that joins them: the `- to ` of `2- to 3-inch`.
 */
const HANGING_JOIN = String.raw`${HYPHEN}(?=\s)${softGap('(?:to|and|or)')}`;
const RANGE_JOIN =
  String.raw`(?:${softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and|or)`)}|${HANGING_JOIN})`;
const DIMENSION_JOIN = softGap('(?:x|×|by)');
const TIGHT_HYPHEN = new RegExp(`^${HYPHEN}$`);

/**
 * The second number of a range or dimension is not a measurement of its own, even where the
 * pair does not match as a whole: `14 1/2 gallon` in `2024-03-14 1/2 gallon`.
 */
const NOT_SECOND_OF_PAIR =
  String.raw`(?<!${NUMERIC_LAST}(?:` +
  String.raw`${softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and|or|x|×|by)`)}|${HANGING_JOIN}))`;

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

/** A hanging hyphen before a join is the unit's, as in `2- to 3-inch`, so the join drops it. */
const SEPARATOR = new RegExp(String.raw`^\s*(?:${HYPHEN}(?=\s))?\s*(,?)\s*(to|and|or)?\s*$`, 'i');

/** A join as a converted range or list writes it: ` to `, ` and `, ` or `, `, `, `, or `, or `-`. */
function separator(join: string): string {
  const [, comma = '', word] = SEPARATOR.exec(join) ?? [];
  if (word !== undefined) return `${comma} ${word.toLowerCase()} `;
  return comma ? ', ' : '-';
}

/** The figures of a range or list with the joins between them. */
function interleave(figures: string[], joins: string[]): string {
  return figures.reduce((out, figure, i) => out + joins[i - 1]! + figure);
}

/**
 * The number at `start`, written `first`, is the second end of a range that the range rule
 * reads or holds, as the `10` of `5 - 10 feet` and of `five to 10 miles` is, or the last
 * figure of a list, as the `8` of `4, 6, 8 inches` is, and not a measurement of its own, even
 * where the range does not match as a whole or its rule is off. A first number that cannot
 * open the range leaves it free: `Price $5 - 10 inches`, `In 2024 - 5 feet`,
 * `reduce by half to 2 quarts`, and the inches of `2 feet 6 to 3 feet`.
 * A height or weight in two units that ends a range or list is held, since its first end could
 * be in either unit, as in `7-8 lb 4 oz` and `5, 6, 7 feet 2 inches`. The range rule's change
 * splits the hold and is dropped, and the whole range stays as written.
 */
function endsRange(text: string, start: number, first: string): boolean {
  const lowStart = rangeOpening(text, start, first);
  return lowStart !== null && !isSmallerPart(text, lowStart);
}

/** A number the range and dimension rules read: any in digits, and a whole number in words. */
const READABLE_NUMBER = new RegExp(String.raw`^(?:${NUMERIC_PATTERN}|${SECOND_END_WORDS})$`, 'i');

const isWritten = (raw: string) => /[a-z]/i.test(raw);

/** `half` or `a quarter`: one word that `READABLE_NUMBER` refuses is a fraction with no count. */
const isUncounted = (raw: string) => !READABLE_NUMBER.test(raw) && /^(?:an?\s+)?[a-z]+$/i.test(raw);

const WORD_JOIN = new RegExp(String.raw`^${HYPHEN}?\s*(to|and|or)\s*$`, 'i');

/**
 * What the range rule does with a range that has an end in words. `to` and `or` join whole
 * numbers as they join digits, and so does `and` after `between`, unless the `and` is inside
 * one number, as in `between one hundred and twenty feet and two hundred feet`. `half` or
 * `a quarter` opens an idiom, as in `reduce by half to 2 quarts`, so it is not a range. A
 * dash, or a fraction in words, cannot be read whole, so the range is held as written:
 * `five-10 miles`, `two and a half to three miles`. So is `two to three hundred`, which may
 * mean 200 to 300, and `one hundred to two hundred thousand`, which may mean 100,000 to
 * 200,000. A hyphen left hanging before the join, as in `two- to three-inch`, is the
 * unit's and changes nothing.
 */
function writtenRange(
  text: string,
  start: number,
  low: string,
  join: string,
  high: string,
): 'read' | 'hold' | 'skip' {
  if (isUncounted(low) || isUncounted(high)) return 'skip';
  const word = WORD_JOIN.exec(join)?.[1]!.toLowerCase();
  if (word === 'and') {
    const between = /\bbetween\s+$/i.test(text.slice(Math.max(0, start - 16), start));
    if (!between || readsAsOne(text, start, low + join + high)) return 'skip';
  }
  const shared = sharesScale(low, high);
  return word !== undefined && !shared && READABLE_NUMBER.test(low) && READABLE_NUMBER.test(high)
    ? 'read'
    : 'hold';
}

const WORDS_TO_END = new RegExp(String.raw`(?:${SECOND_END_WORDS})$`, 'iy');

/**
 * Whether `words`, at `start` in `text`, read there as one number, as `one hundred and twenty`
 * does. After `between`, `one hundred and two thousand` does not.
 */
function readsAsOne(text: string, start: number, words: string): boolean {
  // As far back as `writtenRange` looks for `between`, which the number's pattern looks for too.
  const from = Math.max(0, start - 16);
  WORDS_TO_END.lastIndex = start - from;
  return WORDS_TO_END.test(text.slice(from, start + words.length));
}

/**
 * `two` before `three hundred` may mean 200, and `one hundred` before `two hundred thousand`
 * 100,000: the second end's scale after the ones they share may be the first end's too.
 */
function sharesScale(low: string, high: string): boolean {
  if (!isWritten(low) || /^an?\s/i.test(high)) return false;
  const scales = (end: string) => end.toLowerCase().match(/\b(?:hundred|thousand)\b/g) ?? [];
  const [lows, highs] = [scales(low), scales(high)];
  const next = highs[lows.length];
  if (next === undefined || lows.some((scale, i) => scale !== highs[i])) return false;
  return lows.length === 0 || (lows[lows.length - 1] === 'hundred' && next === 'thousand');
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

/** The words `before` the number `raw` make it a noun, so a `by` after it gives an amount. */
const namesNoun = (before: string, raw: string) =>
  NUMBER_AS_NOUN.test(before) || (/^one$/i.test(raw) && ONE_AS_NOUN.test(before));

/** A number and a dimension's join, ending where the dimension's next number starts. */
const SIDE_OPENING = new RegExp(
  String.raw`(?<=${NUMBER_START}(${NUMBER_PATTERN})(${DIMENSION_JOIN}))`,
  'diy',
);

/**
 * The length at `start` is a side of a dimension whose side before it is a number in words,
 * as the `12 feet` of `ten by 12 feet` is, and not a measurement of its own, even where the
 * dimension rule is off. A number in digits before the join is refused by the single rule's
 * pattern. `half` opens no side, and after a word that makes the number before `by` a noun,
 * the length is an amount, as in `raise each one by two inches`.
 */
function endsSide(text: string, start: number, measure: Measure): boolean {
  if (!hasSides(measure)) return false;
  SIDE_OPENING.lastIndex = start;
  const opening = SIDE_OPENING.exec(text);
  if (opening === null) return false;
  const side = opening[1]!;
  if (!isWritten(side) || isUncounted(side)) return false;
  const sideStart = opening.indices![1]![0];
  const before = text.slice(Math.max(0, sideStart - 24), sideStart);
  return !/by/i.test(opening[2]!) || !namesNoun(before, side);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Alias {
  measure: Measure;
  isWord: boolean;
  /** The matched form was singular, as in `a 9 inch dish`. */
  isSingular: boolean;
  /** The matched form is its own plural, as `stone` is. */
  isOwnPlural: boolean;
  /** How the unit was read, where the words beside it gave it another sense. */
  note?: string;
}

/** `an hour` before `ago` or `later` is a time, so `1 mile an hour ago` is a distance. */
const AN_HOUR = / an hour$/i;
const NOT_A_TIME = String.raw`(?!\s+(?:ago|later|earlier|before|after)\b)`;

/** A lone letter ending a form starts a word as often, as the `T` of `16 oz T-bone` does. */
const LETTER_LAST = /\s[a-z]$/i;
const NOT_A_WORD = String.raw`(?!\w|${HYPHEN})`;

/** A unit's form as a pattern, with a hyphen read for each space, as in `500-square-foot`. */
function aliasPattern(alias: string): string {
  return escape(alias).replace(/ /g, `(?: |${HYPHEN})`);
}

const ALIAS_HYPHEN = new RegExp(HYPHEN, 'g');

/**
 * The key `listed` holds the unit written `written` under: in lower case, and where that is
 * not listed, with each hyphen read as the space `aliasPattern` lets it stand for.
 */
function aliasKey(written: string, listed: { has(key: string): boolean }): string {
  const key = written.toLowerCase().replace(/\s+/g, ' ');
  return listed.has(key) ? key : key.replace(ALIAS_HYPHEN, ' ');
}

function alternate(aliases: string[]): string {
  return aliases
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(
      (alias) =>
        aliasPattern(alias) + (AN_HOUR.test(alias) ? NOT_A_TIME : '') + (LETTER_LAST.test(alias) ? NOT_A_WORD : ''),
    )
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
      byAlias.set(w.toLowerCase(), {
        measure,
        isWord: true,
        isSingular: SINGULAR_WORDS.has(w),
        isOwnPlural: OWN_PLURAL_WORDS.has(w),
      });
    }
    for (const a of measure.abbrevs) {
      byAlias.set(a.toLowerCase(), {
        measure,
        isWord: false,
        isSingular: false,
        isOwnPlural: false,
      });
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

/**
 * Whether the measurement `text.slice(start, end)` in `measure`, whose figures are `values`,
 * is in one of the measure's conventional contexts.
 */
function isConventional(
  ctx: RuleContext,
  measure: Measure,
  start: number,
  end: number,
  values: readonly number[],
): boolean {
  if (!measure.conventional || !ctx.options.units.respectConventions) return false;
  const text = contextText(ctx.text);
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = text.slice(end, end + CONTEXT_WINDOW);
  return [measure.conventional].flat().some(
    (rules) =>
      (rules.values === undefined || values.every((value) => rules.values!.includes(value))) &&
      !rules.distance?.test(after) &&
      Boolean(rules.before?.test(before) || rules.after?.test(after)),
  );
}

/**
 * Where the span ends that the rules hold for the quantity from `start` to `end` where its
 * unit is in another sense, or null where it is a measurement. Past a noun the unit starts,
 * as in `6 foot traffic`, since a rule that rewrote the rest of the noun would leave the
 * quantity to convert on a second run.
 */
function otherSenseEnd(ctx: RuleContext, alias: Alias, start: number, end: number): number | null {
  if (!alias.isWord) return null;
  return alias.measure.otherSense?.(contextText(ctx.text), start, end) ?? null;
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
 * `It is 10 Miles to Town` is a title. A singular after `count`, the number straight before
 * it, names something whatever follows when that number is more than one, as in `8 Mile`,
 * since a singular there only describes a noun, and one that does is written in lower case,
 * as in `an 8 mile hike`.
 */
function isPartOfName(text: string, written: string, end: number, count?: number | null): boolean {
  if (!CAPITALISED.test(written)) return false;
  if (count != null && Math.abs(count) > 1 && SINGULAR_WORDS.has(aliasKey(written, SINGULAR_WORDS))) return true;
  return CAPITALISED_NEXT.test(text.slice(end, end + CONTEXT_WINDOW));
}

/**
 * Words that take a designation after them, as `Route` does in `Route 66 miles`. `Season` and
 * `Track` are not, since a sentence may open with either as a verb: `Season 2 pounds of pork.`
 * and `Track 3 miles a day.`
 */
const DESIGNATIONS = [
  'Model', 'Version', 'Route', 'Highway', 'Interstate', 'Flight', 'Episode', 'Chapter', 'Room',
];

/** A capitalised word and the space after it, ending where a number starts. */
const WORD_BEFORE = new RegExp(String.raw`(?<=\b([A-Z][a-z]+)(?=\s)${SOFT_SPACE})`, 'dy');

/** A day or a month, which dates the figure after it rather than naming it. */
const CALENDAR = new RegExp(`^(?:${CALENDAR_WORD})$`);

/** A figure grouped with commas, as `29,032` is, which counts rather than names. */
const GROUPED = /\d{1,3}(?:,\d{3})+(?!\d)/y;

/**
 * Where a sentence opens: at the start of the text or a line, or of a list item there, or
 * after a stop.
 */
const SENTENCE_OPENING = String.raw`(?:^|[\n\r])(?:[^\S\n\r]*${LIST_MARKER})?|[.!?…]${CLOSING}*\s`;

/** Where a word opens a sentence, past any spaces and opening quotes or brackets. */
const OPENS_SENTENCE = new RegExp(
  String.raw`(?<=(?:${SENTENCE_OPENING})[^\S\n\r]*${OPENING}*)`,
  'y',
);

/** A version number, with two figures or more after its point, as `3.12` and `20.04` have. */
const VERSION = /^\d+\.\d{2,}$/;

/** A plural in lower case next, which feet measure, as in `2.25 ft. lengths`. */
const PLURAL_NEXT = /^\s+[a-z]*[a-rt-z]s(?![\w-])/;

/**
 * Where the name starts that the number `raw` at `start`, before the unit written `written`
 * that ends at `end`, is part of, as `66` is in `Route 66 miles`, or null where it is part of
 * none. After a word in `DESIGNATIONS` it is a designation whatever the unit. After another
 * capitalised word an abbreviation makes it one too, as in `A Boeing 747 mph record`, unless
 * that word opens the sentence, as `About` does in `About 5 mph`, since a quantity before an
 * abbreviation rarely has a name in front of it. A version number after any capitalised word,
 * before `ft.` and then a word that may open a noun but is no plural in lower case, is a
 * version and a credit, as in `Python 3.12 ft. new syntax`. A day or a month is no name, as
 * in `On Monday 40 mph gusts`, and a figure grouped with commas is part of none, as in
 * `Mount Everest 29,032 ft.`. A rule holds the name with its number, since another rule may
 * rewrite the word into one that names nothing, as `Thumbtack` becomes `Drawing pin`.
 */
function nameBefore(
  text: string,
  start: number,
  raw: string,
  written: string,
  isWord: boolean,
  end: number,
): number | null {
  WORD_BEFORE.lastIndex = start;
  const before = WORD_BEFORE.exec(text);
  if (before === null || CALENDAR.test(before[1]!)) return null;
  GROUPED.lastIndex = start;
  if (GROUPED.test(text)) return null;
  const nameStart = before.indices![1]![0];
  if (DESIGNATIONS.includes(before[1]!)) return nameStart;
  const after = text.slice(end);
  const credit = written.toLowerCase() === 'ft.' && VERSION.test(raw);
  if (credit && MODIFIES_A_NOUN.test(after) && !PLURAL_NEXT.test(after)) return nameStart;
  OPENS_SENTENCE.lastIndex = nameStart;
  return !isWord && !OPENS_SENTENCE.test(text) ? nameStart : null;
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
  String.raw`${OUTSIDE_WORD}(?:(${NUMERIC_PATTERN})(${RANGE_JOIN}))?(${NUMBER_PATTERN})${GAP}$`,
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
  const isWord = UNIT_WORDS.has(unit.toLowerCase());
  const from = Math.max(0, unitStart - NUMBER_REACH);
  const number = NUMBER_BEFORE_UNIT.exec(text.slice(from, unitStart));
  const high = number === null ? null : parseNumber(number[3]!);
  if (isWord && isPartOfName(text, unit, unitEnd, high)) return true;
  if (number === null) return false;
  const start = from + number.index;
  const first = parseNumber(number[1] ?? number[3]!);
  const range = number[1] === undefined || high === null ? undefined : { join: number[2]!, high };
  const listed = first === null ? [] : listedBefore(text, start, first, range);
  const opening = listed[0]?.start ?? start;
  if (nameBefore(text, opening, number[3]!, unit, isWord, unitEnd) !== null) return true;
  const otherSense = OTHER_SENSES.get(unit.toLowerCase());
  return otherSense !== undefined && otherSense(contextText(text), opening, unitEnd) !== null;
}

/**
 * A determiner opening the phrase, as in `a 9 inch dish`, and any prefix between, as in
 * `a sub-1 pound tent`. A count opens it as a determiner does, so `2 x 4 ounce cans` keeps
 * the singular.
 */
const DETERMINER_BEFORE = new RegExp(
  String.raw`(?:\b(?:a|an|the|this|that|each|every|per|another)\s+(?:${NUMBER_PREFIX})?|\d\s*[x×]\s*)$`,
  'i',
);

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
 * with a digit, so reading it as a noun would leave the measurement to a second run. A number
 * in digits starts one only where letters that are no unit follow it, straight or after a
 * hyphen, as in `2-door` and `4WD`, which no rule rewrites, so a count spaced from its noun,
 * as in `6 feet 2 days later`, and a measurement such as `2-inch` start none.
 */
const NOUN_START =
  String.raw`(?!(?:${NOT_A_NOUN.join('|')}|(?:${NUMBER_PATTERN})(?:${GAP}(?:${UNIT_FORMS}))?)` +
  String.raw`(?!\w|${HYPHEN})|(?:${MONTH_PATTERN})\.?\s+\d)` +
  String.raw`(?:[a-z]|\d+(?:[.,]\d+)*${HYPHEN}?(?!(?:${UNIT_FORMS})(?![a-z]))[a-z])`;

/** A word straight after a measurement that may be a noun it describes. */
const MODIFIES_A_NOUN = new RegExp(String.raw`^(?:\s|${HYPHEN})+${NOUN_START}`, 'i');

const SIZE = String.raw`(?:${SIZES.join('|')})(?![A-Za-z\d]|${HYPHEN})`;

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
 * A size, then the noun a length describes through it, as the ` long table` of
 * `a 6 foot long table`. A thing has at most three sizes, and the bound keeps each
 * measurement from reading every size in a long list.
 */
const SIZE_THEN_NOUN = String.raw`(?:\s|${HYPHEN})+${SIZE}(?:${ANOTHER_SIZE}){0,2}\s+${NOUN_START}`;

/**
 * A size straight after a length, then the noun the length describes through it, as in
 * `a 6 foot long table` and `a 6-foot-tall fence`.
 */
const SIZES_A_NOUN = new RegExp(`${AFTER_A_LENGTH}${SIZE_THEN_NOUN}`, 'iy');

/** Whether the length ending at `end` gives the size of a noun after it. */
function sizesNoun(text: string, end: number): boolean {
  SIZES_A_NOUN.lastIndex = end;
  return SIZES_A_NOUN.test(text);
}

const SIZE_BEFORE_NOUN = new RegExp(SIZE_THEN_NOUN, 'iy');

/**
 * Whether a size and then a noun follow `end`, where a height with no inch word ends, as in
 * `a six foot two tall man`. The height ends in a number, so `sizesNoun` cannot ask it.
 */
function sizeBeforeNoun(text: string, end: number): boolean {
  SIZE_BEFORE_NOUN.lastIndex = end;
  return SIZE_BEFORE_NOUN.test(text);
}

const HYPHEN_BEFORE_SIZE = new RegExp(String.raw`${AFTER_A_LENGTH}${HYPHEN}(?=${SIZE})`, 'iy');

/** A count in words spaced before a number, as `two` is in `two 300 horsepower engines`. */
const COUNT_BEFORE = new RegExp(String.raw`(?<![\w-])(?:${SECOND_END_WORDS})\s+$`, 'i');

/**
 * An article, or a count with a times sign, opening the phrase, as in `a 300 horsepower engine`.
 * Before a unit that is its own plural, any other determiner may take the unit as the noun, as
 * in `the 300 horsepower produced by it` and `another 300 horsepower comes from the motor`.
 */
const ARTICLE_BEFORE = new RegExp(
  String.raw`(?:\b(?:a|an)\s+(?:${NUMBER_PREFIX})?|\d\s*[x×]\s*)$`,
  'i',
);

/** A number that takes no article of its own, as `6` and `two` do, and `quarter` does not. */
const TAKES_NO_ARTICLE = new RegExp(String.raw`\d|${SECOND_END_WORDS}`, 'iy');

/**
 * Whether the unit word ending at `end` describes the noun after it, so its metric unit is
 * singular: `a 9 inch dish`, `9 inch pans`, `one-inch slices`. The unit follows a number worth
 * `value` that starts at `numberStart`, across `gap`. A determiner or a count opening the
 * phrase says so, as does a hyphen tying the number to the unit, or the singular after a
 * number above one, which would otherwise take the plural. One and a fraction take the
 * singular anyway, so `one quart small onions` and `1/2 pound ground beef` are quantities with
 * the `of` left out, read as `one quart of small onions` would be. A length that gives the size
 * of a noun describes it whatever its number, as `1/2 inch thick slices` does. A unit that is
 * its own plural, as `ownPlural` says, tells nothing by its number, so only a hyphen, a count,
 * or an article or a times sign opening the phrase says so. A hyphen, with a determiner or a
 * count opening the phrase, says so wherever the noun stands, as in `a 6-inch, sharp knife`,
 * though not where the determiner is the number's own, as in `It is a quarter-mile.`
 */
function describesNoun(
  text: string,
  numberStart: number,
  value: number,
  gap: string,
  end: number,
  ownPlural = false,
): boolean {
  if (sizesNoun(text, end)) return true;
  const before = text.slice(Math.max(0, numberStart - 24), numberStart);
  const opened =
    COUNT_BEFORE.test(before) || (ownPlural ? ARTICLE_BEFORE : DETERMINER_BEFORE).test(before);
  const tied = plainHyphens(gap).includes('-');
  if (!MODIFIES_A_NOUN.test(text.slice(end))) {
    TAKES_NO_ARTICLE.lastIndex = numberStart;
    return tied && opened && TAKES_NO_ARTICLE.test(text);
  }
  return tied || opened || (!ownPlural && Math.abs(value) > 1);
}

/**
 * Whether a measurement in `measure` takes the metric symbol because its unit words, `alias`
 * ending at `end`, are joined by hyphens to describe a noun, and `measure` asks for its symbol
 * there, as the speed of `a 35-mile-per-hour wind` does. `attributive` is `describesNoun`'s
 * answer, which also finds the noun past a comma, as in `a 35-mile-per-hour, gusty wind`.
 */
function symbolBeforeNoun(
  text: string,
  measure: Measure,
  alias: string,
  end: number,
  attributive: boolean,
): boolean {
  return (
    measure.symbolBeforeNoun === true &&
    plainHyphens(alias).includes('-') &&
    (attributive || MODIFIES_A_NOUN.test(text.slice(end)))
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

/** A possessive before a number, as in `their 1 500-foot tower` and `Sam's 1 500-foot yacht`. */
const POSSESSIVE_BEFORE = new RegExp(
  String.raw`(?:\b(?:my|your|his|its|our|their)|` +
    String.raw`\b(?!(?:it|that|there|here|what|who|he|she|let)['’]s)[A-Za-z]+['’]s)\s+$`,
  'i',
);

/** `her`, a possessive or the object of a verb, as in `her 1 500-foot yacht` and `gave her 2 bags`. */
const HER_BEFORE = /\bher\s+$/i;

/**
 * Where the size's number starts in the number `raw`, grouped with spaces before a hyphenated
 * size, as in `2 100-pound bags`: the groups before its last are a count of the noun, and the
 * last is the size. After a determiner or a possessive the groups are one number, as in
 * `a 1 500-foot tower`, and after `her` they may be either, which is `unclear`. Null where `raw`
 * is not a count and a size, or is one number.
 */
function countBeforeSize(
  text: string,
  start: number,
  raw: string,
  gap: string,
): number | 'unclear' | null {
  if (!plainHyphens(gap).includes('-')) return null;
  const cut = countBeforeGroup(raw);
  if (cut === null) return null;
  const before = text.slice(Math.max(0, start - 24), start);
  if (HER_BEFORE.test(before)) return 'unclear';
  return DETERMINER_BEFORE.test(before) || POSSESSIVE_BEFORE.test(before) ? null : cut;
}

/**
 * Whether the number `raw`, grouped with spaces before a unit that ends at `end` and spaced
 * from it, may be a count of the noun the measurement describes and then the measurement's
 * own number, as in `3 400 foot towers` and `2 350°F loaves`. A unit that is a plural word
 * (`pluralWord`) describes no noun, and a determiner that takes one of a noun leaves no count,
 * as in `a 1 500 foot tower`.
 */
function mayCountNoun(
  text: string,
  start: number,
  raw: string,
  pluralWord: boolean,
  value: number,
  gap: string,
  end: number,
): boolean {
  if (countBeforeGroup(raw) === null || plainHyphens(gap).includes('-')) return false;
  if (pluralWord) return false;
  if (ONE_OF_A_NOUN_BEFORE.test(text.slice(Math.max(0, start - 24), start))) return false;
  return describesNoun(text, start, value, gap, end);
}

/**
 * A preposition that takes a year, opening a sentence or clause, straight before where a number
 * starts: at the start of the text or a line, or of a list item there, or after a stop, comma,
 * semicolon or colon, with only spaces and opening quotes or brackets between.
 */
const YEAR_PREPOSITION_BEFORE = new RegExp(
  String.raw`(?<=(?:${SENTENCE_OPENING}|[,;:])` +
    String.raw`[^\S\n\r]*${OPENING}*` +
    String.raw`(in|by|since|until|before|after|during|from|between)\s+)`,
  'diy',
);

/** The prepositions of `YEAR_PREPOSITION_BEFORE` that take a range of years, and never one. */
const RANGE_PREPOSITION = /^(?:from|between)$/i;

/** Punctuation or the end of the text, after which a unit word starts no noun. */
const CLOSES_CLAUSE = /\s*(?:[,.;:!?)\]]|$)/y;

/**
 * Whether the number `raw`, spaced before the unit word that ends at `end`, may be a year, as
 * `2024` is in `In 2024 yard sales rose` and `In 2024 miles were driven`: four figures from 1000
 * to 2999 straight after a preposition that takes a year and opens a sentence or clause. In the
 * middle of a clause they are a quantity, as in `The wreck lies in 1500 feet of water.`, and so
 * they are before a unit word that closes the clause, which names no thing the year could
 * date: `It rose by 1200 feet.`
 *
 * `earlier` holds the figures before `raw` of a range or list that starts at `start`, before a
 * unit in `measure`. Each may be a year where each is later than the one before, as in
 * `In 2020-2024 miles were driven.`, and a range of years may follow `from` or `between` too,
 * as in `From 2019 to 2024 miles driven rose.` A range or list in feet is a height, never
 * years, as in `From 1000 to 2000 feet the air thins.`
 */
function mayBeYear(
  text: string,
  start: number,
  raw: string,
  gap: string,
  end: number,
  earlier: string[] = [],
  measure?: Measure,
): boolean {
  if (earlier.length > 0 && measure?.id === 'units.length.foot') return false;
  const years = [...earlier, raw];
  if (!years.every((year) => /^[12]\d{3}$/.test(year)) || !/^\s+$/.test(gap)) return false;
  if (years.some((year, i) => i > 0 && Number(year) <= Number(years[i - 1]))) return false;
  CLOSES_CLAUSE.lastIndex = end;
  if (CLOSES_CLAUSE.test(text)) return false;
  YEAR_PREPOSITION_BEFORE.lastIndex = start;
  const preposition = YEAR_PREPOSITION_BEFORE.exec(text);
  if (preposition === null) return false;
  if (earlier.length === 0 && RANGE_PREPOSITION.test(preposition[1]!)) return false;
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

/**
 * `value`, in the metric unit `measure` converts to, as the unit rules write it. A measure with
 * `decimals` takes that many places under `natural` precision, unless they would write a value
 * that is not zero as zero.
 */
function formatIn(
  measure: Measure,
  value: number,
  precision: Precision,
  figures: number,
  maxDecimals: number,
  raws: readonly string[],
): string {
  if (precision === 'natural' && measure.decimals !== undefined) {
    const fixed = formatNumber(value, measure.decimals, figures, maxDecimals, raws);
    if (value === 0 || Number(fixed.replace(/,/g, '')) !== 0) return fixed;
  }
  return formatNumber(value, precision, figures, maxDecimals, raws);
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
      String.raw`${DEGREES_WORD}${DEGREE_GAP}(?:${CELSIUS_WORD}|C${UNIT_END})|[°º˚]\s*(?:${CELSIUS_WORD}|C)|` +
        String.raw`${CELSIUS_WORD}|℃|${anyCase('deg')}\.?\s*C${UNIT_END}|` +
        String.raw`(?:${DEGREES_WORD}${DEGREE_GAP})?${anyCase('centigrade')}${UNIT_END}`,
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
  pressure: [
    [String.raw`kilopascals?|kPa`, BASE],
    [String.raw`hectopascals?|hPa`, times(0.1)],
  ],
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

const METRIC_DIGITS = String.raw`(?:${SPACE_GROUPED}|\d[\d,]*)(?:\.\d+)?`;
const METRIC_NUMBER = `[-−]?${METRIC_DIGITS}`;
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
const METRIC_FIGURE = new RegExp(String.raw`(?:(?<![\d.]\s*)[-−])?${METRIC_DIGITS}`, 'g');

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
    const value = Number(figure.replace(/[,\s]/g, '').replace('−', '-'));
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
  String.raw`m\.p\.g\.`,
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
    String.raw`degrees?${DEGREE_GAP}F(?:ahrenheit|\.)?`,
    String.raw`deg\.?\s*F\.?`,
    'Fahrenheit',
  ],
  economy: [...MPG_FORMS],
  length: ["'", '’'],
};
for (const measure of MEASURES) {
  const forms = [...measure.words, ...measure.abbrevs, ...(measure.compoundAbbrevs ?? [])];
  // A unit read in another sense restates a value in that sense's dimension too, as the
  // `8 oz` of `240 mL (8 oz)` does.
  const read = [measure, ...(measure.senses ?? []).flatMap((sense) => senseMeasure(sense) ?? [])];
  for (const dimension of new Set(read.map(measureDimension))) {
    if (dimension === undefined) continue;
    (IMPERIAL_UNITS[dimension] ??= []).push(...forms.map(aliasPattern));
  }
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

const IMPERIAL_UNIT = [...new Set(Object.values(IMPERIAL_UNITS).flat())]
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
 * The dimensions the imperial measurement the text holds and nothing else may have, inside
 * any markup and after an optional word of approximation. `about 6 feet 2 inches` is a length,
 * `8 oz` a mass or a volume, while `10 feet for the old one` and `6 feet 3 pounds` are neither,
 * and give none.
 */
function measurementDimensions(text: string): Dimension[] {
  const rest = text.replace(MARKUP_ENDS, '').replace(APPROXIMATELY, '').replace(MARKUP_ENDS, '');
  let read = 0;
  let dimensions: Dimension[] | undefined;
  for (const piece of rest.matchAll(MEASUREMENT_PIECE)) {
    read += piece[0].length;
    const units = UNIT_OF.filter(({ pattern }) => pattern.test(piece[0].trim())).map((unit) => unit.dimension);
    if (units.length === 0) continue;
    dimensions = (dimensions ?? units).filter((dimension) => units.includes(dimension));
    if (dimensions.length === 0) return [];
  }
  return read === rest.length ? (dimensions ?? []) : [];
}

/**
 * What joins an oven setting to the temperature before it in one bracket, as in
 * `(180°C/gas mark 4)`, and one setting to another.
 */
const SETTING_JOIN = String.raw`\s*(?:[/,;]|(?<=\s)or(?=\s))\s*`;

const FAN_KIND = [anyCase('forced'), anyCase('assisted'), anyCase('oven')].join('|');
const FAN_WORDS = String.raw`${anyCase('fan')}(?:(?:\s+|${HYPHEN})(?:${FAN_KIND}))?${UNIT_END}`;
const FAN_TEMPERATURE = String.raw`${METRIC_NUMBER}(?:\s*(?:${metricUnitForms('temperature')}))?`;

/** A fan oven's setting, as in `160°C fan`, `fan 160°C` and `160°C fan-forced`. */
const FAN_SETTING = String.raw`(?:${FAN_TEMPERATURE}\s+${FAN_WORDS}|${FAN_WORDS}\s+${FAN_TEMPERATURE})`;

/** The settings a recipe gives beside its temperature: a fan setting, a gas mark, or both. */
const OVEN_SETTINGS =
  String.raw`(?:${FAN_SETTING}(?:${SETTING_JOIN}${GAS_MARK})?|${GAS_MARK}(?:${SETTING_JOIN}${FAN_SETTING})?)`;

/** The oven settings that end a bracket after its temperature, as in `(350°F/160°C fan/gas mark 4)`. */
const SETTINGS_AFTER = new RegExp(String.raw`${SETTING_JOIN}${OVEN_SETTINGS}${MARKUP}$`);

/**
 * `1.8 metres (6 feet)` is what `keepOriginal` writes, and what a careful author writes by
 * hand. A bracket that holds nothing but an imperial measurement, directly after a metric
 * value of the same dimension, restates that value. Every match inside it is left alone,
 * including a piece of the measurement such as the `2 inches` in `(6 feet 2 inches)`. A
 * temperature may be followed by its oven settings, as in `180°C (350°F/160°C fan/gas mark 4)`.
 */
function restatesMetric(ctx: RuleContext, start: number, end: number): boolean {
  const text = contextText(ctx.text);
  const head = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const tail = text.slice(end, end + CONTEXT_WINDOW);
  const open = head.lastIndexOf('(');
  const close = tail.indexOf(')');
  if (open < 0 || close < 0) return false;
  const inside = head.slice(open + 1) + text.slice(start, end) + tail.slice(0, close);
  const measurement = inside.replace(SETTINGS_AFTER, '');
  const dimensions = measurementDimensions(measurement);
  if (dimensions.length === 0) return false;
  if (measurement !== inside && !dimensions.includes('temperature')) return false;
  const bracket = start - head.length + open;
  // Through the `(`, so a line break before it can see that its next line opens no new block.
  const before = text.slice(Math.max(0, bracket - CONTEXT_WINDOW), bracket + 1);
  const metric = dimensionOf(METRIC_BEFORE.exec(before));
  return metric !== undefined && dimensions.includes(metric);
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
 * before it, `gap` the space before the bracket, `open` the markup that opens on the bracket,
 * and `inner` the markup that opens on the text inside it, which `innerClose` closes. A
 * temperature may be followed by its oven settings, as in `(180°C/160°C fan/gas mark 4)`, and
 * `settingClose` then closes any `inner` that wraps them all.
 */
const BRACKET_AFTER = new RegExp(
  String.raw`^(?<close>${MARKUP})(?<gap>${SOFT_SPACE})(?<open>${MARKUP})\(` +
    String.raw`(?<inner>${MARKUP})(?<metric>[^()]{1,40}?)(?<innerClose>${MARKUP})` +
    String.raw`(?:${SETTING_JOIN}(?<setting>${OVEN_SETTINGS})(?<settingClose>${MARKUP}))?\)`,
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
  /** What stays of the bracket once the metric value goes, as the gas mark of `(180°C/gas mark 4)`. */
  kept: string;
}

/**
 * The metric value in brackets, or joined by `/` or `or`, at the start of `rest`, the text
 * after an imperial value. Markup that opens on the bracket or the metric value has to
 * close on it too. The oven settings after a temperature in the bracket stay in it, with any
 * markup that wraps them all.
 */
function metricPartnerAfter(rest: string): MetricPartner | undefined {
  const match = BRACKET_AFTER.exec(rest) ?? METRIC_PAIRED_AFTER.exec(rest);
  if (!match) return undefined;
  const { close = '', gap = '', open = '', inner = '', innerClose = '', metric = '' } = match.groups!;
  const { setting, settingClose = '' } = match.groups!;
  const closing = closingOf(open);
  if (!rest.startsWith(closing, match[0].length)) return undefined;
  const length = match[0].length + closing.length;
  if (setting === undefined) {
    if (innerClose !== closingOf(inner)) return undefined;
    return { length, metric, close, kept: '' };
  }
  if (dimensionOf(METRIC_INNER.exec(metric)) !== 'temperature') return undefined;
  // Markup on the metric value alone goes with it, and markup that wraps both stays.
  const wraps = innerClose === '' && settingClose !== '';
  if (wraps ? settingClose !== closingOf(inner) : innerClose !== closingOf(inner) || settingClose !== '') {
    return undefined;
  }
  const kept = `${gap}${open}(${wraps ? inner : ''}${setting}${settingClose})${closing}`;
  return { length, metric, close, kept };
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
): { end: number; metric: string; close: string; kept: string } | null {
  const partner = metricPartnerAfter(contextText(ctx.text).slice(end));
  if (!partner || !restatesBody(partner.metric, body, ruleId)) return null;
  return {
    end: end + partner.length,
    metric: metricSpelling(partner.metric.trim()),
    close: partner.close,
    kept: partner.kept,
  };
}

/**
 * Any capitalised word after a unit's stop starts a new sentence, a number in words included,
 * as in `It weighs 5 lb. One bag is enough.` It has to accept every word the bare F's
 * `OPENER` accepts there, or a stop that ends a bare F's sentence would go, and the second run
 * would read a longer sentence.
 */
const AFTER_UNIT = /(?:)/y;

/**
 * Whether `matched`, a measurement at `start`, ends in a stop that stays: one that also ends
 * the sentence or opens an ellipsis. It is read at `end`, which is past the metric partner
 * when a pair collapses over the stop.
 */
function keepsStop(text: string, start: number, matched: string, end = start + matched.length): boolean {
  return matched.endsWith('.') && stopStays(text, start, end, AFTER_UNIT);
}

/** `°F` or `℉` and a stop: a symbol, which has no stop of its own. */
const SYMBOL_STOP = /(?:[°º˚]\s*F|℉)\.$/i;

/** Space that stays in the paragraph, then a word in lower case, so the sentence plainly goes on. */
const LOWER_CASE_NEXT = new RegExp(String.raw`(?=\s)${SOFT_SPACE}\p{Ll}`, 'uy');

function continuesInLowerCase(text: string, at: number): boolean {
  LOWER_CASE_NEXT.lastIndex = at;
  return LOWER_CASE_NEXT.test(text);
}

const BRACKET_NEXT = /\s*\(/y;

/**
 * Whether the stop that ends `matched`, a Fahrenheit value at `start`, stays in the text,
 * read at `end` as `keepsStop` reads it. A bare letter `F` abbreviates the scale, so its stop
 * goes as an abbreviation's does, unless it also ends the sentence. A symbol's stop is usually
 * the sentence's own, but authors also write `350°F. for 20 minutes`, so it goes only before a
 * word in lower case. Either stays before a bracket, which may trail the sentence it ends.
 */
function fahrenheitKeepsStop(text: string, start: number, matched: string, end = start + matched.length): boolean {
  if (!matched.endsWith('.')) return false;
  BRACKET_NEXT.lastIndex = end;
  if (BRACKET_NEXT.test(text)) return true;
  if (!SYMBOL_STOP.test(matched)) return keepsStop(text, start, matched, end);
  return !continuesInLowerCase(text, end);
}

/** Where a stop can stand: past any closing marks, before a space or the end of the text. */
const STOP_STANDS = new RegExp(String.raw`${CLOSING}*(?:\s|$)`, 'y');
/** The measure `sense` converts as, or undefined for a sense that holds the quantity. */
function senseMeasure(sense: Sense): Measure | undefined {
  if (sense.as === undefined) return undefined;
  const found = MEASURES.find((measure) => measure.id === sense.as);
  if (found === undefined) throw new Error(`A sense converts as ${sense.as}, which is no measure.`);
  return found;
}

/** The dimension of what `measure` converts to. */
function measureDimension(measure: Measure): Dimension | undefined {
  return dimensionOf(METRIC_INNER.exec(`1 ${measure.convert(1).symbol}`));
}

/** Space between two words of one phrase, which may wrap the line but opens no new block. */
const WORD_GAP = String.raw`(?=\s)${SOFT_SPACE}`;
const ARTICLE = String.raw`(?:(?:a|an|the)${WORD_GAP})?`;
const WORD_END = String.raw`(?![\w-])`;
const FUNCTION_WORD = String.raw`(?:${NOT_A_NOUN.join('|')})${WORD_END}`;
/** A word that may modify the noun after it: no function word, and no possessive. */
const MODIFIER = String.raw`(?!${FUNCTION_WORD})[A-Za-z\d][\w%]*(?:-[\w%]+)*`;
/** A word ending in a lone `s`, as a plural or a verb such as `needs` does, and `glass` does not. */
const ENDS_IN_S = String.raw`(?=[\w%-]*[^\W\dsu]s${WORD_END})`;

/** Determiners and object pronouns, the words of `NOT_A_NOUN` that open a preposition's object. */
const OPENS_OBJECT = [
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their', 'my', 'our',
  'your', 'some', 'any', 'no', 'all', 'both', 'every', 'me', 'him', 'it', 'us', 'them', 'you',
];

/**
 * Adverbs that end in no `ly` and follow what a recipe adds, as `first` does in
 * `Add 8 oz water first`.
 */
const ADVERBS = ['first', 'also', 'instead', 'together', 'overnight', 'aside', 'well'];

/** An adverb. A word in `ly` is one, as in `Add 8 oz of milk slowly`, but `jelly` is a food. */
const ADVERB = String.raw`(?:${ADVERBS.join('|')}|(?!jelly${WORD_END})[A-Za-z]+ly)${WORD_END}`;

/**
 * A word that ends a noun phrase before it: a function word, an adverb, or a word in `s` before
 * the object it takes, which is a verb, as `keeps` is in `16 oz of water keeps you going`.
 */
const ENDS_NOUN =
  String.raw`(?:${FUNCTION_WORD}|${ADVERB}|` +
  String.raw`${ENDS_IN_S}[\w-]+${WORD_GAP}(?:(?:${OPENS_OBJECT.join('|')})${WORD_END}|\d))`;

/** Auxiliary verbs, which may follow a plural noun as its verb, as in `8 oz rum truffles are enough`. */
const AUXILIARIES = [
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'can', 'may', 'might', 'must',
];

/** Conjunctions that join words alike, and so may follow an adjective, as in `tastes flat and warm`. */
const COORDINATORS = ['and', 'or', 'but', 'nor', 'yet', 'so', 'than'];

/** A function word that may follow a verb, as `in` does in `go in first`. */
const AFTER_A_VERB =
  String.raw`(?:${NOT_A_NOUN.filter((word) => !COORDINATORS.includes(word)).join('|')})${WORD_END}`;

/**
 * A word in `s` that is the verb of the clause the quantity before it is the subject of, as
 * `boils` is in `until 8 oz of milk boils`. It is a plural noun, and the subject's head, where an
 * auxiliary follows it, or a word that a function word, an adverb or a number follows in turn,
 * which is then the verb, as `go` is in `8 oz rum raisins go in first`.
 */
const SUBJECT_VERB =
  String.raw`${ENDS_IN_S}[\w-]+${WORD_END}(?!${WORD_GAP}(?:(?:${AUXILIARIES.join('|')})${WORD_END}|` +
  String.raw`(?!${FUNCTION_WORD}|${ADVERB})[A-Za-z][\w-]*${WORD_GAP}(?:${AFTER_A_VERB}|${ADVERB}|\d)))`;

/**
 * Where the quantity stands in its clause, which tells a verb from a noun after a drink: the
 * subject of a clause a conjunction opens, which has a verb, the opening of a sentence, which may
 * have none, or elsewhere, where it is read as an object.
 */
type Place = 'subject' | 'opening' | 'object';

/**
 * Where a noun phrase ends, in each place: at anything but a word that may be a noun after it, as
 * `raisins` is in `rum raisins`, where `rum` only describes it. A sentence that a quantity opens
 * may be a list item with no verb, as `8 oz rum raisins, chopped` is, so there a word in `s`
 * before a comma, a colon or the end of its line is a noun. These read `phraseText`, where the
 * end of a line that no sentence runs on from is a `;`.
 */
const PHRASE_ENDS: Record<Place, string> = {
  subject: String.raw`(?!${WORD_GAP}(?!${ENDS_NOUN}|${SUBJECT_VERB})[A-Za-z])`,
  opening: String.raw`(?!${WORD_GAP}(?!${ENDS_NOUN}|${SUBJECT_VERB}(?![^\S\n\r]*(?:[,;:]|$)))[A-Za-z])`,
  object: String.raw`(?!${WORD_GAP}(?!${ENDS_NOUN})[A-Za-z])`,
};

/**
 * A conjunction that opens a clause, whose subject follows it. `until`, `before` and `after` are
 * prepositions too, but rarely before a quantity of food with no verb after it.
 */
const CONJUNCTION_BEFORE = new RegExp(
  String.raw`(?<![\w-])(?:once|when|whenever|as|while|if|unless|because|until|till|before|after)` +
    String.raw`${WORD_GAP}$`,
  'i',
);

/** An adverb that may open a sentence before its subject, as in `Then 16 oz of water goes in`. */
const OPENING_ADVERB_BEFORE = new RegExp(
  String.raw`(?<![\w-])(?:then|next|now|finally),?${WORD_GAP}$`,
  'i',
);

/**
 * A line break whose next line does not go on in lower case. Case-sensitive, since a capital
 * there opens the next item of a list, as `A pinch of salt` does, where a hard-wrapped sentence
 * goes on in lower case.
 */
const LIST_LINE_BREAK = /(?:\r\n|[\n\r\v\f\u2028\u2029])(?![^\S\n\r\v\f\u2028\u2029]*[a-z])/g;

let lastPhraseSource = '';
let lastPhraseText = '';

/**
 * `text` as the phrase after a quantity is read in it: with each `LIST_LINE_BREAK` as a `;`, so
 * a phrase never runs from one line of a list into the next, as from `8 oz rum raisins` into
 * `4 oz sugar`, while it runs on through a hard-wrapped sentence. Each offset is kept.
 */
function phraseText(text: string): string {
  if (text !== lastPhraseSource) {
    lastPhraseSource = text;
    lastPhraseText = text.replace(LIST_LINE_BREAK, (lineBreak) => ';'.repeat(lineBreak.length));
  }
  return lastPhraseText;
}

/** Where the quantity whose number starts at `start` stands, past a determiner before it. */
function placeOf(text: string, start: number): Place {
  const determiner = DETERMINER_BEFORE.exec(text.slice(Math.max(0, start - CONTEXT_WINDOW), start));
  const at = start - (determiner?.[0].length ?? 0);
  const before = text.slice(Math.max(0, at - CONTEXT_WINDOW), at);
  if (CONJUNCTION_BEFORE.test(before)) return 'subject';
  OPENS_SENTENCE.lastIndex = at - (OPENING_ADVERB_BEFORE.exec(before)?.[0].length ?? 0);
  return OPENS_SENTENCE.test(text) ? 'opening' : 'object';
}

/**
 * From a unit to the word after it, past the bracket the quantity may close, as in
 * `1 cup (8 oz) milk`, and an aside in brackets, as in `8 oz (1 cup) milk`.
 */
const LEAD = String.raw`\)?(?:${WORD_GAP}\([^()\n]{1,40}\))?${WORD_GAP}`;

/** `of` and what the quantity measures, as in `3 tons of gravel`. */
const OF_A_THING = new RegExp(String.raw`${LEAD}of${WORD_GAP}${ARTICLE}${NOUN_START}`, 'iy');

/**
 * A word that may be the noun a quantity describes, as in `a 3-ton truck`. A plural unit word
 * describes none, so the word after `3 tons` in `AC units of 3 tons cool the hall` is a verb.
 */
const NOUN_AFTER = new RegExp(String.raw`${LEAD}${NOUN_START}`, 'iy');

/** `names` as one pattern, each read with a space or a hyphen between its words. */
const namePattern = (names: string[]) =>
  alternate([...names]).replace(/ /g, () => String.raw`(?:${WORD_GAP}|-)`);

interface SenseReader {
  measure: Measure | undefined;
  note: string | undefined;
  /** Sticky, to test where the unit ends, for the quantity in each place. */
  after: Record<Place, RegExp>;
  /** Whether `after` reads `phraseText`, as the head of a phrase is read. */
  asHead: boolean;
  /** Tested on the text before the number. */
  before: RegExp | undefined;
  /** Tested on the quantity's sentence. */
  sentence: RegExp | undefined;
}

function senseReader(sense: Sense): SenseReader {
  const heads = sense.heads ?? [];
  const except = sense.except ? String.raw`(?!(?:${namePattern(sense.except)})${WORD_END})` : '';
  const word = String.raw`${except}${MODIFIER}${WORD_GAP}`;
  // A word in `s` is a plural or a verb. Before another word it is the noun measured, as in
  // `3-ton trucks need AC`, and after one a verb, as in `a 3-ton truck needs AC`.
  const words = String.raw`(?:(?:(?!${ENDS_IN_S})${word}){1,2}|${word})?`;
  const head = heads.length > 0 ? String.raw`${WORD_GAP}(?:${namePattern(heads)})` : '';
  const holders = sense.things.filter((thing) => heads.includes(thing));
  const describers = sense.things.filter((thing) => !heads.includes(thing));
  const described = sense.asHead && head ? `(?:${head}${WORD_END})?` : '';
  const thing = (ends: string) =>
    [
      ...(describers.length > 0 ? [`(?:${namePattern(describers)})${WORD_END}${described}${ends}`] : []),
      ...(holders.length > 0 ? [`(?:${namePattern(holders)})${WORD_END}(?!${head}${WORD_END})${ends}`] : []),
    ].join('|');
  const vessel = sense.vessels
    ? String.raw`(?:(?:${namePattern(sense.vessels)})${WORD_GAP}of${WORD_GAP}${ARTICLE}${words})?`
    : '';
  const pattern = (ends: string) =>
    new RegExp(String.raw`${LEAD}(?:of${WORD_GAP}${ARTICLE})?${words}${vessel}${except}(?:${thing(ends)})`, 'iy');
  const anywhere = pattern('');
  const after = sense.asHead
    ? {
        subject: pattern(PHRASE_ENDS.subject),
        opening: pattern(PHRASE_ENDS.opening),
        object: pattern(PHRASE_ENDS.object),
      }
    : { subject: anywhere, opening: anywhere, object: anywhere };
  const before =
    sense.before &&
    new RegExp(
      String.raw`(?<![\w-])(?:${namePattern(sense.before)})(?:${head})?${WORD_END}` +
        String.raw`(?:${WORD_GAP}${FUNCTION_WORD}){0,3}:?${WORD_GAP}$`,
      'i',
    );
  const sentence =
    sense.sentence && new RegExp(String.raw`(?<![\w-])(?:${namePattern(sense.sentence)})${WORD_END}`, 'i');
  const asHead = sense.asHead === true;
  return { measure: senseMeasure(sense), note: sense.note, after, asHead, before, sentence };
}

const SENSES = new Map(
  MEASURES.flatMap((measure) => (measure.senses ? [[measure, measure.senses.map(senseReader)] as const] : [])),
);

/**
 * The sense of `measure` that the words beside the quantity from `start` to `end` give its
 * unit, written as a plural word where `plural` says so, or undefined where they give none. A
 * metric value after the quantity names the sense by its dimension. Then the phrase after the
 * unit decides, and where it names a thing that no sense has, the unit keeps its own sense.
 * Only where nothing after it names a thing do the words before the number count, and then
 * the sentence.
 */
function senseAt(
  text: string,
  measure: Measure,
  start: number,
  end: number,
  plural: boolean,
): SenseReader | undefined {
  const readers = SENSES.get(measure);
  if (readers === undefined) return undefined;
  const plain = contextText(text);
  const partner = metricPartnerAfter(plain.slice(end));
  const dimension = partner && readMetric(partner.metric)?.dimension;
  if (dimension !== undefined) {
    if (dimension === measureDimension(measure)) return undefined;
    return readers.find((reader) => reader.measure && measureDimension(reader.measure) === dimension);
  }
  // A stop that also ends the sentence leaves nothing after the quantity to read.
  if (!keepsStop(plain, start, plain.slice(start, end))) {
    const place = placeOf(plain, start);
    for (const reader of readers) {
      const after = reader.after[place];
      after.lastIndex = end;
      if (after.test(reader.asHead ? phraseText(plain) : plain)) return reader;
    }
    OF_A_THING.lastIndex = end;
    NOUN_AFTER.lastIndex = end;
    if (OF_A_THING.test(plain) || (!plural && NOUN_AFTER.test(plain))) return undefined;
  }
  const before = plain.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const named = readers.find((reader) => reader.before?.test(before));
  if (named !== undefined || !readers.some((reader) => reader.sentence)) return named;
  const sentence = sentenceAround(plain, start, end);
  return readers.find((reader) => reader.sentence?.test(sentence));
}

/** Notes on the change at `made`, if a push made one that converts, the sense its unit was read in. */
function noteSense(changes: Change[], made: number, note: string | undefined): void {
  const change = changes[made];
  if (note === undefined || changes.length !== made + 1 || !change || change.hold || change.note) return;
  changes[made] = { ...change, note };
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
 * of an abbreviation such as `in.` goes with it, unless it also ends the sentence or opens an
 * ellipsis, when the metric value takes it. Where a pair collapses, the stop is read past the
 * metric value that stays.
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
    // Only past the partner can the stop end the sentence. A symbol's test would keep it before
    // any mark but a lower-case word, so the stop also needs a space or the end there.
    const keeps = ruleId === ABSOLUTE_ID || ruleId === DIFFERENCE_ID ? fahrenheitKeepsStop : keepsStop;
    STOP_STANDS.lastIndex = redundant.end;
    const stop = STOP_STANDS.test(ctx.text) && keeps(ctx.text, start, matched, redundant.end) ? '.' : '';
    changes.push({
      start,
      end: redundant.end,
      before,
      // A stop that ends the sentence goes after what stays of the bracket.
      after: redundant.kept === ''
        ? redundant.metric + stop + redundant.close
        : redundant.metric + redundant.close + redundant.kept + stop,
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
const FIRST_NUMBER = String.raw`${OUTSIDE_WORD}(?:(?![-−])(?:${NUMERIC_PATTERN})|${SECOND_END_WORDS})`;

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
 * Where the first end starts of the range that `endsRange` asks about, before it asks
 * whether that end is the smaller part of a height or weight, or `null` where no such range
 * opens. A list with no range join before its last figure opens at its first.
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

/**
 * Where the range rule starts the range or list that the figure at `start`, written `first`,
 * ends: where `rangeOpening` finds its first end, or at the first figure of a list that ends
 * in that range, as at the `5` of `5, 10 or 15 feet`.
 */
function rangeStart(text: string, start: number, first: string): number | null {
  const lowStart = rangeOpening(text, start, first);
  if (lowStart === null) return null;
  RANGE_OPENING.lastIndex = start;
  const opening = RANGE_OPENING.exec(text);
  const low = opening === null ? null : parseNumber(opening[1]!);
  const high = parseNumber(first);
  if (opening === null || low === null || high === null) return lowStart;
  return figuresBefore(text, lowStart, low, high, opening[2]!)?.[0]?.start ?? lowStart;
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
 * Nothing after the smaller part of a height or weight with no unit word that the part could
 * count: punctuation, a word that cannot open a noun, the end of the text, or the end of a line
 * where the next line is blank or starts with something other than a word, such as a list
 * marker.
 */
const NOTHING_COUNTED =
  String.raw`[.,;:!?)\]"'”’*_]+(?![A-Za-z\d])|${SOFT_SPACE}(?<=\s)${NO_NOUN_WORD}|` +
  String.raw`${INLINE_SPACE}*(?:$|${LINE_END}${INLINE_SPACE}*(?:$|${LINE_END}|[^\sA-Za-z]))`;

/**
 * Where inches may go without their word after `foot` or `feet`, as in `six foot two`: before
 * nothing they could count, or before a join and a measurement in feet, as in
 * `6 foot 2 to 6 foot 4`.
 */
const NO_NOUN_AFTER = `(?=${NOTHING_COUNTED}|${ANOTHER_HEIGHT})`;

/** Inches written without their word: a whole number from 1 to 11. */
const isInchCount = (value: number | null) =>
  value !== null && Number.isInteger(value) && value >= 1 && value <= 11;

/**
 * A fraction of an inch after a whole number of inches: ` and a half` after digits or words,
 * and ` 1/2`, `-1/2` or `½` after digits.
 */
const INCH_FRACTION =
  String.raw`${INLINE_SPACE}+and${INLINE_SPACE}+${COUNTED_FRACTION}|` +
  String.raw`(?<=\d)(?:(?:${INLINE_SPACE}+|${HYPHEN})\d+/\d+|${INLINE_SPACE}*${VULGAR_CLASS})`;

/**
 * The inches of a height with no inch word, written `raw` and starting with the whole number
 * `whole`: a whole number from 1 to 11 and any fraction after it, below a foot in all. Null
 * where they are not inches.
 */
function bareInches(whole: string, raw: string): number | null {
  const inches = parseNumber(raw);
  return isInchCount(parseNumber(whole)) && inches !== null && inches < 12 ? inches : null;
}

/**
 * A whole number in words straight after a hyphen, as the `two` of `six-foot-two`, which
 * `WHOLE_NUMBER` refuses so that a number never starts inside a hyphenated word.
 */
const WORDS_AFTER_HYPHEN = String.raw`(?<=${HYPHEN})(?:${SECOND_END_WORDS})`;

/**
 * The feet of a height with no inch word before another height, and its inches starting where
 * the pattern is tried, with their whole number in the third group. The same shape as the last
 * alternatives of `feetInchesRule`.
 */
const INCHES_OF_HEIGHT = new RegExp(
  String.raw`(?<=${OUTSIDE_WORD}(${UNSIGNED_NUMBER})${GAP}(?:feet|foot)(?:${SOFT_SPACE}|${HYPHEN}))` +
    String.raw`(?<=\s|${HYPHEN})((${WHOLE_NUMBER}|${WORDS_AFTER_HYPHEN})(?:${INCH_FRACTION})?)` +
    String.raw`(?=${ANOTHER_HEIGHT})`,
  'diy',
);

/** The larger part of a height or weight in two units: its number and where it starts. */
interface LargerPart {
  raw: string;
  start: number;
}

/**
 * The height whose inches start at `start`, with no inch word before another height, where it
 * starts where a measurement can: its feet and where they start.
 */
function heightAt(text: string, start: number): LargerPart | null {
  INCHES_OF_HEIGHT.lastIndex = start;
  const match = INCHES_OF_HEIGHT.exec(text);
  if (match === null || parseNumber(match[1]!) === null) return null;
  if (bareInches(match[3]!, match[2]!) === null) return null;
  const feetStart = match.indices![1]![0];
  STARTS_HERE.lastIndex = feetStart;
  return STARTS_HERE.test(text) ? { raw: match[1]!, start: feetStart } : null;
}

/** Every form a weight in two units may write a unit in, including `st`, read only there. */
const compoundAliases = (measure: Measure) => [
  ...measure.words,
  ...measure.abbrevs,
  ...(measure.compoundAbbrevs ?? []),
];

/**
 * A join and a weight in `measure` that the single rule reads, as the ` to 12 stone` of
 * `11 stone 4 to 12 stone`.
 */
const anotherWeight = (measure: Measure) =>
  String.raw`${RANGE_JOIN}${NUMBER_START}(?:${UNSIGNED_NUMBER})${GAP}` +
  String.raw`(?:${alternate([...measure.words, ...measure.abbrevs])})(?![A-Za-z])`;

/**
 * After a weight's larger unit and the space after it, its next unit's number with no unit
 * word, before another weight in the larger unit, which the last group spans: the `4` and
 * ` to 12 stone` of `11 stone 4 to 12 stone`.
 */
const unnamedPart = (measure: Measure) =>
  String.raw`(?<=\s)(${WHOLE_NUMBER})(?=(${anotherWeight(measure)}))`;

/** A number of a weight's next unit written without its word: a whole number below `per`. */
const isPartCount = (value: number | null, per: number) =>
  value !== null && Number.isInteger(value) && value >= 1 && value < per;

/** The units a weight in two units writes first: stone, and pounds before ounces. */
const FIRST_OF_WEIGHT = new Set(COMPOUNDS.map((compound) => compound.measures[0]!));

/**
 * For each unit a weight in two units writes first, a unit larger still that ends straight
 * before a number, as `stone` does before the `4 pounds` of `11 stone 4 pounds 8 to 12 pounds`.
 */
const AFTER_LARGER_UNIT = new Map(
  [...FIRST_OF_WEIGHT].flatMap((measure) => {
    const larger = COMPOUNDS.flatMap(({ measures }) =>
      measures.slice(0, Math.max(0, measures.indexOf(measure))),
    );
    if (larger.length === 0) return [];
    const units = alternate(larger.flatMap(compoundAliases));
    const pattern = new RegExp(
      String.raw`(?<![A-Za-z])(?:${units})(?![A-Za-z])${SOFT_SPACE}$`,
      'i',
    );
    return [[measure, pattern] as const];
  }),
);

/**
 * The weight in `measure` at `start` is the tail of one in a larger unit still, which reads
 * it: the `4 pounds` of `11 stone 4 pounds`.
 */
const continuesWeight = (text: string, start: number, measure: Measure) =>
  AFTER_LARGER_UNIT.get(measure)?.test(text.slice(Math.max(0, start - CONTEXT_WINDOW), start)) ===
  true;

/**
 * For each weight in two units, its larger part and then, starting where the pattern is
 * tried, the shape `unnamedPart` reads. The same shape as the compound rules' last
 * alternative.
 */
const UNNAMED_PARTS = COMPOUNDS.map((compound) => {
  const larger = compound.measures[0]!;
  const pattern = new RegExp(
    String.raw`(?<=${OUTSIDE_WORD}(${UNSIGNED_NUMBER})${GAP}(?:${alternate(compoundAliases(larger))})` +
      String.raw`(?![A-Za-z])${SOFT_SPACE})${unnamedPart(larger)}`,
    'diy',
  );
  return { pattern, larger, per: compound.per[0]! };
});

/**
 * The weight whose next unit's number starts at `start`, with no unit word before another
 * weight in the larger unit, where it starts where a measurement can and is no tail of a
 * weight in a larger unit still: its larger part and where that starts.
 */
function weightAt(text: string, start: number): LargerPart | null {
  for (const { pattern, larger, per } of UNNAMED_PARTS) {
    pattern.lastIndex = start;
    const match = pattern.exec(text);
    if (match === null || parseNumber(match[1]!) === null) continue;
    if (!isPartCount(parseNumber(match[2]!), per)) continue;
    const largerStart = match.indices![1]![0];
    STARTS_HERE.lastIndex = largerStart;
    if (!STARTS_HERE.test(text) || continuesWeight(text, largerStart, larger)) continue;
    return { raw: match[1]!, start: largerStart };
  }
  return null;
}

let smallerText = '';
const smallerAt = new Map<number, boolean>();

/**
 * The number at `start` is the smaller part of a height or weight in two units, written
 * without its unit word before another measurement in the larger unit, as the `2` of
 * `6 foot 2 to 6 foot 4` and the `4` of `11 stone 4 to 12 stone` are. `feetInchesRule` or a
 * compound rule converts that measurement, and the number is not the first end of a range.
 * Where the measurement itself ends a range, the answer is the one for the range's first end,
 * so the walk follows a chain such as `5 to 6 foot 1 to 6 foot 2 to 6 foot 3` back to its
 * start. Every answer is kept for the text, so a long chain takes time in line with its
 * length, and the walk is a loop, so no chain is too long for the stack.
 */
function isSmallerPart(text: string, start: number): boolean {
  if (text !== smallerText) {
    smallerText = text;
    smallerAt.clear();
  }
  const walked: number[] = [];
  let at: number | null = start;
  let answer = true;
  while (at !== null) {
    const known = smallerAt.get(at);
    if (known !== undefined) {
      answer = known;
      break;
    }
    walked.push(at);
    const larger = heightAt(text, at) ?? weightAt(text, at);
    if (larger === null) {
      answer = false;
      break;
    }
    at = rangeOpening(text, larger.start, larger.raw);
  }
  for (const position of walked) smallerAt.set(position, answer);
  return answer;
}

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
 * `six-foot-two` collapse into a single metric height. A height in a unit that is kept is held
 * whole, as a weight in two units is.
 */
function feetInchesRule(skip: Set<string>, forced: Record<string, boolean>): Rule {
  const pattern = new RegExp(
    String.raw`(${FIRST_NUMBER})` +
      String.raw`(?:(?:${GAP}(?:feet|foot|ft\.?)|${SOFT_SPACE}(?:′|${FOOT_MARK}))` +
      String.raw`(?:${HYPHEN}|${softGap(String.raw`(?:and(?=\s))?`)})` +
      String.raw`(\d+(?:\.\d+)?|\d+${INLINE_SPACE}+\d+/\d+|\d+${HYPHEN}\d+/\d+|\d+/\d+|` +
      String.raw`(?:${WHOLE_NUMBER}|${WORDS_AFTER_HYPHEN})(?:${INCH_FRACTION})?)` +
      String.raw`(?:${GAP}(?:inches|inch|in\.?)|${SOFT_SPACE}(?:″|["”]))(?![A-Za-z])|` +
      String.raw`${GAP}(?:feet|foot)(?:${SOFT_SPACE}(?<=\s)((${WHOLE_NUMBER})(?:${INCH_FRACTION})?)${NO_NOUN_AFTER}|` +
      // A hyphen makes the height one word, so a noun may follow it: `a six-foot-two man`.
      String.raw`${HYPHEN}(\d+|${WORDS_AFTER_HYPHEN})(?![A-Za-z\d]|${HYPHEN}|[.,/:]\d|${UNIT_OF_ITS_OWN})))`,
    'dgi',
  );
  const sticky = new RegExp(pattern.source, 'diy');
  const kept = forced[HEIGHT.id] !== true && HEIGHT.measures.some((m) => isKept(m, skip, forced));

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
        const bare = match[3] ?? match[5];
        const inches =
          match[3] !== undefined ? bareInches(match[4]!, match[3]) : parseNumber(match[2] ?? bare!);
        if (match[3] !== undefined && inches === null) continue;
        if (match[5] !== undefined && !isInchCount(inches)) continue;
        // A list may go on after a comma, as in `6 feet 2, 3 or 4 inches`, and claims the number.
        if (match[3] !== undefined && startsMeasurement(contextText(ctx.text), match.indices![3]![0])) {
          continue;
        }
        // Hyphened to the foot word, only a number of inches below a foot makes a height, so
        // `2 feet-18 inches` stays two lengths.
        const tied =
          match[2] !== undefined && TIGHT_HYPHEN.test(ctx.text.charAt(match.indices![2]![0] - 1));
        if (tied && !(inches !== null && inches < 12)) continue;
        if (kept || feet === null || inches === null || endsRange(ctx.text, match.index, match[1]!)) {
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
          [match[1]!, match[2] ?? bare!],
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
        } else if (match[5] !== undefined) {
          const hyphen = ctx.text.charAt(match.indices![5]![0] - 1);
          attributive = describesNoun(ctx.text, match.index, inches, hyphen, end);
        } else {
          // Inches with no word end before nothing they could count, so only a size can lead
          // to a noun.
          attributive = sizeBeforeNoun(ctx.text, end);
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
 * no sides, so the number in `2 x 4 lb 8 oz bags` counts the bags. The next unit's word may
 * be left out before a join and another weight in the larger unit, as in
 * `11 stone 4 to 12 stone`, and a weight read so that cannot be converted is held up to the
 * end of the other weight, which would otherwise convert alone. It may be left out before
 * nothing the number could count too, as inches may after feet: `11 stone 4.` and `7 lb 8.`,
 * but not after `st`, which is a weight only beside another unit.
 */
function compoundRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  const AND = softGap(String.raw`(?:and(?=\s))?`);
  const unitOf = (m: Measure) => String.raw`(${alternate(compoundAliases(m))})(?![A-Za-z])`;

  return COMPOUNDS.map((compound): Rule => {
    const [largest, next, ...rest] = compound.measures.map(unitOf);
    const part = (unit: string) => String.raw`${AND}(${UNSIGNED_NUMBER})${GAP}${unit}`;
    const optional = rest.reduceRight((inner, unit) => `(?:${part(unit)}${inner})?`, '');
    const withWords = `${part(next!)}${optional}`;
    const withoutWord =
      String.raw`${SOFT_SPACE}(?:${unnamedPart(compound.measures[0]!)}|` +
      String.raw`(?<=\s)(${WHOLE_NUMBER})(?=${NOTHING_COUNTED}))`;
    const pattern = new RegExp(
      String.raw`(${FIRST_NUMBER})${GAP}${largest}(?:${withWords}|${withoutWord})`,
      'dgi',
    );
    const unnamedGroup = 2 * compound.measures.length + 1;
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
          const lastUnnamed = match[unnamedGroup + 2];
          const unnamed = match[unnamedGroup] ?? lastUnnamed;
          if (unnamed !== undefined) {
            parts.push({ measure: compound.measures[1]!, raw: unnamed, unit: '' });
          }
          const written = match[2]!.toLowerCase();
          if (
            lastUnnamed !== undefined &&
            (compound.measures[0]!.compoundAbbrevs?.includes(written) ||
              startsMeasurement(contextText(ctx.text), match.indices![unnamedGroup + 2]![0]))
          ) {
            continue;
          }
          const values = parts.map((p) => parseNumber(p.raw!));
          const start = match.index;
          const held =
            match[unnamedGroup] === undefined
              ? match[0]
              : ctx.text.slice(start, match.indices![unnamedGroup + 1]![1]);
          if (values.some((v) => v === null)) {
            changes.push(hold(start, held, compound.id, 40));
            continue;
          }
          if (
            unnamed !== undefined &&
            (!isPartCount(values[1]!, compound.per[0]!) ||
              continuesWeight(ctx.text, start, compound.measures[0]!))
          ) {
            continue;
          }

          NOT_SECOND.lastIndex = start;
          const kept =
            forced[compound.id] !== true && parts.some((p) => isKept(p.measure, skip, forced));
          const second =
            endsRange(ctx.text, start, match[1]!) || (sided && !NOT_SECOND.test(ctx.text));
          // With no unit word after its number, nothing makes the larger unit a weight, so
          // `pounds` may be money, as in `It cost 5 pounds 10 to 6 pounds`.
          const larger = compound.measures[0]!;
          const otherSense =
            unnamed !== undefined &&
            larger.words.includes(match[2]!.toLowerCase()) &&
            larger.otherSense?.(contextText(ctx.text), start, match.indices![2]![1]) != null;
          if (kept || second || otherSense) {
            changes.push(hold(start, held, compound.id, 40));
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
          const raws = parts.map((p) => p.raw!);
          const number = formatNumber(target.value, precision, 3, maxDecimals, raws);

          const isWord = (p: (typeof parts)[number]) =>
            p.measure.words.some((w) => w === p.unit.toLowerCase());
          const last = parts[parts.length - 1]!;
          const end = start + match[0].length;
          const singular = (p: (typeof parts)[number]) =>
            isWord(p) && SINGULAR_WORDS.has(p.unit.toLowerCase());
          // A singular after a number above one says so in any part, as the pound does in
          // `7 pound 1 ounce babies`.
          const value = Math.max(...parts.flatMap((p, i) => (singular(p) ? [values[i]!] : [])));
          const lastNumber = match.indices![2 * parts.length - 1];
          const lastUnit = match.indices![2 * parts.length];
          const gap = lastNumber && lastUnit ? ctx.text.slice(lastNumber[1], lastUnit[0]) : '';
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
  // Only a dimension's number after digits is refused here. `endsRange` judges a range's, and
  // `endsSide` one after words, which need both numbers.
  const SINGLE_START =
    String.raw`${NUMBER_START}(?:(?=${NUMERIC_FIRST})(?<!${NUMERIC_LAST}${DIMENSION_JOIN})|(?!${NUMERIC_FIRST}))`;
  const single = new RegExp(
    String.raw`${SINGLE_START}(${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );
  const SECOND_END = String.raw`(?<=\b(?:to|and)\s+)(?:${SECOND_END_WORDS})|${NUMBER_PATTERN}`;
  // The last two figures of a range or a list. `rangeRule` reads back to a list's first. An
  // optional unit after the first, so `15 inches to 17 inches` is one range.
  const range = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})(?:${GAP}(${alternation})(?![A-Za-z]))?` +
      String.raw`(${RANGE_JOIN}|${LIST_END})(${SECOND_END})${GAP}(${alternation})(?![A-Za-z])`,
    'dgi',
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
    String.raw`(?=[A-Za-z])${OUTSIDE_WORD}${NOT_IN_COMPOUND}` +
      String.raw`${FRACTION_OF}${SOFT_SPACE}(${words})(?![A-Za-z\d-])`,
    'gi',
  );
  const andAFraction = new RegExp(
    String.raw`${START}(${COUNT_BEFORE_FRACTION})${SOFT_SPACE}(${words})` +
      String.raw`${S}+${AND_FRACTION}(?![A-Za-z\d-])`,
    'gi',
  );

  const resolve = (alias: string) => byAlias.get(aliasKey(alias, byAlias));

  const measurementBefore = new RegExp(
    String.raw`${OUTSIDE_WORD}(?:${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])${SOFT_SPACE}(?<=\s)$`,
    'di',
  );

  /**
   * Where a measurement in `measure` starts that ends straight before `start`, with only space
   * between, as `5 ft` does before the `6` of `5 ft 6 to 6 ft`, and `11 stone` before the `4`
   * of `11 stone 4 to 12 stone`. After a length, or a weight in a unit that a smaller one may
   * follow, a number there is a smaller unit of that measurement, never more of the same unit.
   * A weight there may be the tail of one in a larger unit still, which then starts first, as
   * `11 stone 4 pounds` does before the `8` of `11 stone 4 pounds 8 to 12 pounds`.
   */
  const sameUnitBefore = (text: string, start: number, measure: Measure): number | null => {
    if (!hasSides(measure) && !FIRST_OF_WEIGHT.has(measure)) return null;
    const from = Math.max(0, start - NUMBER_REACH);
    const before = measurementBefore.exec(text.slice(from, start));
    if (before === null || resolve(before[1]!)?.measure !== measure) return null;
    const quantity = before[0].slice(0, before.indices![1]![1] - before.index);
    if (isBareInch(before[1]!, quantity)) return null;
    let measurementStart = from + before.index;
    let unit = measure;
    while (continuesWeight(text, measurementStart, unit)) {
      const reach = Math.max(0, measurementStart - NUMBER_REACH);
      const outer = measurementBefore.exec(text.slice(reach, measurementStart));
      const outerUnit = outer && resolve(outer[1]!)?.measure;
      if (!outerUnit) break;
      measurementStart = reach + outer.index;
      unit = outerUnit;
    }
    return measurementStart;
  };

  /**
   * `entry` in the sense the words beside the quantity from `start` to `end` give its unit,
   * or itself where they give none. Null where that sense holds the quantity as written, for
   * want of a conversion or because its measure is kept.
   */
  const inSense = (ctx: RuleContext, entry: Alias, start: number, end: number): Alias | null => {
    const sense = senseAt(ctx.text, entry.measure, start, end, entry.isWord && !entry.isSingular);
    if (sense === undefined) return entry;
    if (sense.measure === undefined || isKept(sense.measure, skip, forced)) return null;
    return { ...entry, measure: sense.measure, note: sense.note };
  };

  /**
   * What a measurement in `measure` that `sameUnitBefore` finds before the range or list whose
   * first figure starts at `start` makes of it: undefined where there is none, and null where a
   * height or weight in two units reads that figure as its smaller unit, as `feetInchesRule`
   * reads the `6` of `2 feet 6 to 3 feet`. Otherwise no rule can read the figure, and this is
   * where the measurement starts, to be held with the range as written, as `5 ft 6 to 6 ft` is.
   * The range and single rules both ask this, so the span stays whole with either one off.
   */
  const beforeRange = (
    text: string,
    start: number,
    measure: Measure,
  ): number | null | undefined => {
    const measurementStart = sameUnitBefore(text, start, measure);
    if (measurementStart === null) return undefined;
    return isSmallerPart(text, start) ? null : measurementStart;
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
    let entry = resolve(alias);
    if (!entry || value === null) return;
    // A noun straight after claims the words before it: `half a pound cake` is half a cake,
    // and `a mile and a half hour later` is half an hour.
    if (MODIFIES_A_NOUN.test(ctx.text.slice(start + matched.length))) return;
    const senseEnd = otherSenseEnd(ctx, entry, start, start + matched.length);
    if (senseEnd !== null || (entry.isWord && isPartOfName(ctx.text, alias, start + matched.length))) {
      changes.push(hold(start, ctx.text.slice(start, senseEnd ?? start + matched.length), entry.measure.id, 30));
      return;
    }
    const read = inSense(ctx, entry, start, start + matched.length);
    if (read === null) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    entry = read;
    if (isAmbiguousHere(entry.measure, ctx.text)) return;
    if (isConventional(ctx, entry.measure, start, start + matched.length, [value])) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }

    const target = entry.measure.convert(value);
    const { precision, maxDecimals } = ctx.options.units;
    const figures = significantFigures(matched);
    const number = formatIn(
      entry.measure,
      target.value,
      precision,
      figures,
      maxDecimals,
      [matched],
    );
    const body = `${number} ${unitWord(target, Number(number.replace(/,/g, '')))}`;
    const made = changes.length;
    pushMeasurement(ctx, changes, start, matched, body, entry.measure.id, 30);
    noteSense(changes, made, entry.note);
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
    let entry = resolve(alias);
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
    const groups = countBeforeSize(ctx.text, start, raw, gap);
    if (groups === 'unclear') {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    if (groups !== null) {
      pushSingle(ctx, changes, start + groups, matched.slice(groups), raw.slice(groups), alias);
      return;
    }
    if (entry.isSingular && countsSizedNoun(ctx.text, start, raw, gap, start + matched.length)) {
      // The unit is one of itself, as the foot of a foot-long sub is.
      pushSingle(ctx, changes, start + matched.length - alias.length, alias, '', alias, 1);
      return;
    }
    const senseEnd = otherSenseEnd(ctx, entry, start, start + matched.length);
    if (
      senseEnd !== null ||
      (entry.isWord && isPartOfName(ctx.text, alias, start + matched.length, value)) ||
      (entry.isWord && mayBeYear(ctx.text, start, raw, gap, start + matched.length))
    ) {
      changes.push(hold(start, ctx.text.slice(start, senseEnd ?? start + matched.length), entry.measure.id, 30));
      return;
    }
    const named = nameBefore(ctx.text, start, raw, alias, entry.isWord, start + matched.length);
    if (named !== null) {
      changes.push(hold(named, ctx.text.slice(named, start + matched.length), entry.measure.id, 30));
      return;
    }
    const read = inSense(ctx, entry, start, start + matched.length);
    if (read === null) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    entry = read;
    if (isAmbiguousHere(entry.measure, ctx.text)) return;
    if (isBareInch(alias, matched)) return;
    if (
      isInParticle(ctx.text, start, start + matched.length, alias) ||
      isConventional(ctx, entry.measure, start, start + matched.length, [value])
    ) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    const pluralWord = entry.isWord && !entry.isSingular;
    if (mayCountNoun(ctx.text, start, raw, pluralWord, value, gap, start + matched.length)) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }

    const target = entry.measure.convert(value);
    const { precision, maxDecimals } = ctx.options.units;
    const figures = significantFigures(raw);
    const number = formatIn(entry.measure, target.value, precision, figures, maxDecimals, [raw]);
    const numberStart = start + (/^an?\s+/i.exec(raw)?.[0].length ?? 0);
    const attributive =
      entry.isWord &&
      (entry.isSingular || entry.isOwnPlural) &&
      describesNoun(ctx.text, numberStart, value, gap, start + matched.length, entry.isOwnPlural);
    const unit =
      entry.isWord &&
      !symbolBeforeNoun(ctx.text, entry.measure, alias, start + matched.length, attributive)
        ? ` ${attributive ? target.singular : unitWord(target, Number(number.replace(/,/g, '')))}`
        : ` ${target.symbol}`;
    // `a quarter mile track` keeps its article for the track, while `a quarter mile away`
    // gives it to the number.
    const from = attributive ? numberStart : start;
    const quantity = matched.slice(from - start);

    const made = changes.length;
    pushBeforeSize(ctx, changes, from, quantity, `${number}${unit}`, entry.measure.id, 30);
    noteSense(changes, made, entry.note);
  };

  /**
   * Whether the unit after the first number of `match`, a match of `range`, is in `measure`,
   * the second number's unit, so the two ends are one span, as in `from 15 inches to 17 inches`.
   * Units that differ, as in `from 6 feet to 10 inches`, give two measurements. A spaced `in`
   * may be the preposition, and a `"` that closes a quotation is no inch mark.
   */
  const joinsSameUnit = (text: string, match: RegExpExecArray, measure: Measure): boolean => {
    const inner = match[2]!;
    const innerEnd = match.indices![2]![1];
    if (resolve(inner)?.measure !== measure || isQuotationMark(text, innerEnd - 1)) return false;
    return !isBareInch(inner, text.slice(match.index, innerEnd));
  };

  const rangeRule: Rule = {
    id: 'units.range',
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      range.lastIndex = 0;
      for (let match: RegExpExecArray | null; (match = range.exec(ctx.text)) !== null; ) {
        const pair = match[0];
        const [lowRaw, join, highRaw, alias] = [match[1]!, match[3]!, match[4]!, match[5]!];
        const inner = match[2];
        // After a unit, the second number may open a range of its own, as the `10 inches` of
        // `6 feet to 10 inches to 12 inches` does.
        if (inner !== undefined) range.lastIndex = match.indices![4]![0];
        const pairStart = match.index;
        const end = pairStart + pair.length;
        let entry = resolve(alias);
        const low = parseNumber(lowRaw);
        const high = parseNumber(highRaw);
        if (!entry || low === null || high === null || high === 0) continue;
        if (isQuotationMark(ctx.text, end - 1)) continue;
        if (inner !== undefined && !joinsSameUnit(ctx.text, match, entry.measure)) continue;
        // `2-3/4` is one number, which the single measurement rule reads.
        const pairWritten = isWritten(lowRaw) || isWritten(highRaw);
        if (
          inner === undefined &&
          !pairWritten &&
          TIGHT_HYPHEN.test(join) &&
          parseNumber(`${lowRaw}-${highRaw}`) !== null
        ) {
          continue;
        }
        if (!canBeRange(ctx.text, pairStart, low, high)) continue;
        // A list's figures share the unit at its end, so none comes before one with its own.
        const earlier =
          inner === undefined ? figuresBefore(ctx.text, pairStart, low, high, join) : [];
        if (earlier === null) continue;
        const start = earlier[0]?.start ?? pairStart;
        const matched = ctx.text.slice(start, end);
        const raws = [...earlier.map((figure) => figure.raw), lowRaw, highRaw];
        const joins = [...earlier.map((figure) => figure.join), join];
        const gap = ctx.text.slice(match.indices![4]![1], match.indices![5]![0]);
        // Each end's own unit marks where its number ends, so words read as digits do.
        const written = inner === undefined && raws.some(isWritten);
        const reading = written ? writtenList(ctx.text, start, raws, joins) : 'read';
        if (reading === 'skip' || (inner !== undefined && raws.some(isUncounted))) continue;
        if (
          inner === undefined &&
          entry.isSingular &&
          raws.every((raw) => COUNT_IN_WORDS.test(raw)) &&
          countsSizedNoun(ctx.text, start, highRaw, gap, end)
        ) {
          // The figures count the noun, and the unit is one of itself, as the foot of
          // `two to three foot-long subs` is.
          pushSingle(ctx, changes, end - alias.length, alias, '', alias, 1);
          continue;
        }
        // A list that starts as the second number of a pair, as in `1 to 2, 4 or 6 feet`.
        NOT_SECOND.lastIndex = start;
        const secondOfPair = earlier.length > 0 && !NOT_SECOND.test(ctx.text);
        const measurementStart = beforeRange(ctx.text, start, entry.measure);
        if (measurementStart !== undefined) {
          // The inches of a height are for `feetInchesRule`, and the next unit of a weight for
          // its compound rule. Any other smaller unit cannot be read, so the measurement and
          // range stay as written.
          if (measurementStart !== null) {
            const held = ctx.text.slice(measurementStart, end);
            changes.push(hold(measurementStart, held, entry.measure.id, 35));
          }
          continue;
        }
        const senseEnd = otherSenseEnd(ctx, entry, start, end);
        if (
          senseEnd !== null ||
          (entry.isWord && isPartOfName(ctx.text, alias, end, high)) ||
          // A unit after the first number makes it a quantity, as in `From 1500 feet to 2000 feet`.
          (entry.isWord &&
            inner === undefined &&
            mayBeYear(ctx.text, start, highRaw, gap, end, raws.slice(0, -1), entry.measure))
        ) {
          changes.push(hold(start, ctx.text.slice(start, senseEnd ?? end), entry.measure.id, 35));
          continue;
        }
        const named = nameBefore(ctx.text, start, highRaw, alias, entry.isWord, end);
        if (named !== null) {
          changes.push(hold(named, ctx.text.slice(named, end), entry.measure.id, 35));
          continue;
        }
        const read = inSense(ctx, entry, start, end);
        if (read === null) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }
        entry = read;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(alias, matched)) continue;
        const values = [...earlier.map((figure) => figure.value), low, high];
        const conventional = isConventional(ctx, entry.measure, start, end, values);
        const particle = isInParticle(ctx.text, start, end, alias);
        if (reading === 'hold' || conventional || secondOfPair || particle) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }
        // Only `to` makes one range of two measurements. Joined any other way, as in
        // `5 feet or 6 feet` and `5ft-6ft`, each keeps its unit, and the single rule converts each.
        if (inner !== undefined && WORD_JOIN.exec(join)?.[1]!.toLowerCase() !== 'to') continue;

        // Every figure shares the unit chosen for the last, so the range or list stays readable.
        const target = entry.measure.convert(high);
        const perSourceUnit = target.value / high;
        const figures = Math.max(...raws.map(significantFigures));
        const { precision, maxDecimals } = ctx.options.units;
        const texts = [...earlier.map((figure) => figure.value), low].map((value) =>
          formatIn(entry.measure, value * perSourceUnit, precision, figures, maxDecimals, raws),
        );
        texts.push(formatIn(entry.measure, target.value, precision, figures, maxDecimals, raws));
        const attributive =
          (entry.isSingular || entry.isOwnPlural) &&
          describesNoun(ctx.text, start, high, gap, end, entry.isOwnPlural);
        const unit =
          entry.isWord && !symbolBeforeNoun(ctx.text, entry.measure, alias, end, attributive)
            ? ` ${attributive ? target.singular : target.plural}`
            : ` ${target.symbol}`;
        const body = interleave(texts, joins.map(separator)) + unit;

        const made = changes.length;
        pushBeforeSize(ctx, changes, start, matched, body, entry.measure.id, 35);
        noteSense(changes, made, entry.note);
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
        if (entry.isWord && isPartOfName(ctx.text, last.alias!, end, last.value)) {
          changes.push(hold(start, match[0], entry.measure.id, 38));
          continue;
        }
        const named = nameBefore(ctx.text, start, last.raw, last.alias!, entry.isWord, end);
        if (named !== null) {
          changes.push(hold(named, ctx.text.slice(named, end), entry.measure.id, 38));
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
        const noun = namesNoun(before, first.raw);
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

        const otherSense = units.find((u) => otherSenseEnd(ctx, u, start, end) !== null);
        if (otherSense) {
          const senseEnd = otherSenseEnd(ctx, otherSense, start, end)!;
          changes.push(hold(start, ctx.text.slice(start, senseEnd), otherSense.measure.id, 38));
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
        const values = sides.map((s) => s.value!);
        if (unclear || measures.some((m) => isConventional(ctx, m, start, end, values))) {
          changes.push(hold(start, match[0], entry.measure.id, 38));
          continue;
        }

        const target = units[largest]!.measure.convert(sides[largest]!.value!);
        const perBase = target.value / inBase[largest]!;
        const raws = sides.map((s) => s.raw);
        const figures = Math.max(...raws.map(significantFigures));
        const { precision, maxDecimals } = ctx.options.units;
        const separator = /\bby\b/i.test(match[0]) ? ' by ' : match[0].includes('×') ? ' × ' : ' x ';
        const unit = entry.isWord
          ? ` ${entry.isSingular ? target.singular : target.plural}`
          : ` ${target.symbol}`;
        const body =
          inBase
            .map((v) => formatNumber(v * perBase, precision, figures, maxDecimals, raws))
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
        const entry = resolve(match[2]!);
        const value = parseNumber(match[1]!);
        const endsPair =
          entry !== undefined && value !== null && endsRange(ctx.text, match.index, match[1]!);
        if (endsPair) {
          const listStart = rangeStart(ctx.text, match.index, match[1]!);
          const held =
            listStart === null ? undefined : beforeRange(ctx.text, listStart, entry.measure);
          if (typeof held === 'number') {
            const end = match.index + match[0].length;
            changes.push(hold(held, ctx.text.slice(held, end), 'units.measurement', 30));
          }
        }
        if (
          entry &&
          value !== null &&
          (endsPair || endsSide(ctx.text, match.index, entry.measure))
        ) {
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
  /** Whether the figure may be a count and then the temperature, which is then held. */
  countsNoun: boolean;
}

/**
 * The ends of a range at one precision, matching the more precise end of the source.
 * A narrow range takes extra figures where it would otherwise print both ends the same.
 */
function formatEnds(ctx: RuleContext, values: number[], raw: string[]): string[] {
  const { precision, maxDecimals } = ctx.options.units;
  const figures = Math.max(...raw.map(significantFigures));
  let texts = values.map((v) => formatNumber(v, precision, figures, maxDecimals, raw));
  for (let extra = 1; extra <= 2 && texts.length === 2 && texts[0] === texts[1]; extra++) {
    texts = values.map((v) => formatNumber(v, precision, figures + extra, maxDecimals, raw));
  }
  return texts;
}

const readDegreesBefore = listReader(DEGREES);

/** The space or hyphen between a Fahrenheit value's number and its unit. */
const GAP_BEFORE_UNIT = new RegExp(String.raw`(?:${HYPHEN}|\s*)$`);

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
    const wholeEnd = start + whole.length;
    // A stop that stays in the text stays outside the value and any kept original.
    const valueEnd = wholeEnd - (fahrenheitKeepsStop(ctx.text, start, whole) ? 1 : 0);
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
      numbers = values.map((v) => formatTemperature(((v - 32) * 5) / 9, precision, v, maxDecimals, raw));
    } else {
      numbers = formatEnds(ctx, values.map((v) => ((v - 32) * 5) / 9), raw);
    }

    const unit = match[4] ?? '';
    const spelled = /degrees?/i.test(unit);
    const gap = GAP_BEFORE_UNIT.exec(match[0].slice(0, match[0].length - unit.length))![0];
    const singular =
      (numbers.length === 1 && Math.abs(Number(numbers[0])) === 1) ||
      (/^degree(?!s)/i.test(unit) && describesNoun(ctx.text, start, values.at(-1)!, gap, valueEnd));
    const suffix = spelled ? ` ${singular ? 'degree' : 'degrees'} Celsius` : '°C';
    const body = interleave(numbers, joins) + suffix;
    const ruleId = difference ? DIFFERENCE_ID : ABSOLUTE_ID;
    // A stop kept before the Celsius value the pair collapses into goes into the change, so
    // that `pushMeasurement` finds the partner and decides the stop past it.
    if (end < wholeEnd && redundantMetric(ctx, wholeEnd, body, ruleId) !== null) end = wholeEnd;
    const pluralWord = /^degrees/i.test(unit);
    const countsNoun = mayCountNoun(ctx.text, start, raw[0]!, pluralWord, values[0]!, gap, valueEnd);
    readings.push({ start, matched: ctx.text.slice(start, end), body, ruleId, countsNoun });
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
          if (reading.countsNoun) {
            changes.push(hold(reading.start, reading.matched, id, 35));
            continue;
          }
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
  // A decade, optionally banded (`low`, `mid`, `upper`). `70's` and `low-70s` are both written
  // in the wild. Only a band takes the space before the figure, or a failing match after `the`
  // would try every split of the run of spaces that follows it.
  const BAND = 'low|mid|middle|high|upper|lower';
  const BANDED = (band: string, figure: string) =>
    String.raw`(?:${band}(?:\s|${HYPHEN})*)?${figure}['\u2019]?s`;
  // Each decade ends at a word's end, so nothing after a run of them can fail and send the
  // match back through the joins, which `and` and `or` match two ways.
  const DECADE = String.raw`${BANDED(`(?:${BAND})`, String.raw`(?:1[01]0|\d0)`)}(?!\w)`;
  const DECADE_PARTS = new RegExp(BANDED(`(${BAND})`, String.raw`(1[01]0|\d0)`), 'gi');
  const pattern = new RegExp(
    String.raw`(?<![\w.])(?:(in|into|around|about|near|above|below|over|under)\s+)?the\s+` +
      String.raw`(${DECADE}(?:(?:${RANGE_JOIN}|${LIST_END})${DECADE})*)` +
      // A bare `degrees` after a decade can only be its unit, unless a Celsius unit begins there.
      String.raw`(\s*(?:${FAHRENHEIT}|Fahrenheit\b|(?!${metricUnitForms('temperature')})degrees\b))?`,
    'gi',
  );

  // Case-sensitive, so `the 70s f` has no unit. `F-150` is a name, whose figure would be left
  // after the range.
  const BARE_F = new RegExp(String.raw`(?!${INLINE_SPACE}?F[-–]\d)(?:${BARE})`, 'y');

  // Case-sensitive, so a lone `c` is no unit here, as it is none after a figure. The bare `C`
  // is read apart because `metricUnitForms` reads it only after a figure, as in `180C`.
  const CELSIUS_AFTER = new RegExp(
    String.raw`${SOFT_SPACE}(?:${metricUnitForms('temperature')}|` +
      String.raw`\(${INLINE_SPACE}*(?:${metricUnitForms('temperature')}|C${UNIT_END})${INLINE_SPACE}*\))|` +
      String.raw`${INLINE_SPACE}?C${UNIT_END}`,
    'y',
  );

  // A bare `C` away from the decade is as often a grade, a vitamin or a seat as a scale.
  const CELSIUS_NAMED = new RegExp(
    String.raw`(?<![A-Za-z])(?!C${UNIT_END})(?:${metricUnitForms('temperature')})`,
    'g',
  );
  const FAHRENHEIT_NAMED = new RegExp(String.raw`(?<![A-Za-z])(?:${FAHRENHEIT}|Fahrenheit\b)`, 'gi');
  // Far beyond any real sentence, so a rewrite inside one cannot move a scale in or out of reach.
  const SENTENCE_REACH = 2000;

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

  interface Scale {
    /** Where the text names the scale, in order. */
    at: number[];
    /** The first of `at` from the end of the last span looked around, since spans come in order. */
    next: number;
  }

  const scale = (text: string, named: RegExp): Scale => ({
    at: [...text.matchAll(named)].map((match) => match.index),
    next: 0,
  });

  /** The nearest places `scale` is named before `start` and from `end` on, within reach. */
  const nearest = (scale: Scale, start: number, end: number): [number | undefined, number | undefined] => {
    while (scale.next < scale.at.length && scale.at[scale.next]! < end) scale.next++;
    const before = scale.at[scale.next - 1];
    const after = scale.at[scale.next];
    return [
      before !== undefined && start - before <= SENTENCE_REACH ? before : undefined,
      after !== undefined && after - end < SENTENCE_REACH ? after : undefined,
    ];
  };

  /**
   * Whether the sentence holding `start` to `end` names Celsius and no Fahrenheit. It is read
   * only as far as the nearest place each scale is named on each side, since a farther one is
   * in the sentence only if that one is.
   */
  const namesOnlyCelsius = (text: string, start: number, end: number, celsius: Scale, fahrenheit: Scale) => {
    const [celsiusBefore, celsiusAfter] = nearest(celsius, start, end);
    if (celsiusBefore === undefined && celsiusAfter === undefined) return false;
    const [fahrenheitBefore, fahrenheitAfter] = nearest(fahrenheit, start, end);
    const reach = Math.max(
      ...[celsiusBefore, fahrenheitBefore].map((at) => start - (at ?? start)),
      ...[celsiusAfter, fahrenheitAfter].map((at) => (at ?? end - 1) - end + 1),
    );
    const [from, to] = sentenceBounds(text, start, end, SENTENCE_OPENER, reach);
    const inSentence = (before?: number, after?: number) =>
      (before !== undefined && before >= from) || (after !== undefined && after < to);
    return inSentence(celsiusBefore, celsiusAfter) && !inSentence(fahrenheitBefore, fahrenheitAfter);
  };

  return {
    id: 'units.temperature.decade',
    category: 'units',
    confidence: 'risky',
    priority: 36,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;
      let scales: [celsius: Scale, fahrenheit: Scale] | undefined;

      for (const match of ctx.text.matchAll(pattern)) {
        const start = match.index;
        const marked = match[3] !== undefined;
        let matched = match[0];
        if (!marked) {
          BARE_F.lastIndex = start + matched.length;
          matched += BARE_F.exec(ctx.text)?.[0] ?? '';
        }
        const end = start + matched.length;
        const before = ctx.text.slice(Math.max(0, start - 90), start);
        const after = ctx.text.slice(end, end + 90);

        if (!marked) {
          CELSIUS_AFTER.lastIndex = end;
          const celsius = CELSIUS_AFTER.exec(ctx.text);
          if (celsius) {
            changes.push(hold(start, matched + celsius[0], 'units.temperature.decade', 36));
            continue;
          }
        }

        if (A_DECADE.test(before)) continue;
        if (!marked && !TEMPERATURE_NEARBY.test(before) && !TEMPERATURE_NEARBY.test(after)) continue;

        // The range runs from the bottom of the first decade to the top of the last:
        // `the 70s and 80s` is 70 through 89.
        const decades = [...match[2]!.matchAll(DECADE_PARTS)].map(([, band, figure]) => {
          const [bottom, top] = SPREAD[(band ?? '').toLowerCase()] ?? [0, 9];
          return [Number(figure) + bottom, Number(figure) + top] as const;
        });
        const rises = decades.every(([bottom], i) => i === 0 || bottom > decades[i - 1]![1]);
        const low = toCelsius(decades[0]![0]);
        const high = toCelsius(decades.at(-1)![1]);
        scales ??= [scale(ctx.text, CELSIUS_NAMED), scale(ctx.text, FAHRENHEIT_NAMED)];
        if (!rises || low >= high || (!marked && namesOnlyCelsius(ctx.text, start, end, ...scales))) {
          changes.push(hold(start, matched, 'units.temperature.decade', 36));
          continue;
        }

        // `days in the 70s` has to become `days between 21 and 26C`, never `days in
        // between`, so the preposition is swallowed rather than left dangling.
        const body = match[1] ? `between ${low} and ${high}°C` : `${low} to ${high}°C`;

        changes.push({
          start,
          end,
          before: matched,
          after: fahrenheitKeepsStop(ctx.text, start, matched) ? `${body}.` : body,
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
  const UNIT = String.raw`${GAP}(${MPG_FORMS.join('|')})(?![A-Za-z])`;
  const single = new RegExp(String.raw`${NUMBER_START}(${MPG})${UNIT}`, 'gi');
  // Must start where the range rule starts, so the two read the same ranges.
  const START = String.raw`${NUMBER_START}(?:(?=${NUMERIC_FIRST})${NOT_SECOND_OF_PAIR}|(?!${NUMERIC_FIRST}))`;
  const range = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})(${RANGE_JOIN}|${LIST_END})(${MPG})${UNIT}`,
    'gi',
  );
  const FROM_BEFORE = /\bfrom\s+$/i;
  const isWordForm = (form: string) => /^miles/i.test(form);

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
      const economy = (mpg: number, figures: number, raws: string[]) =>
        formatNumber(rate(mpg), precision, figures, maxDecimals, raws);
      const unit = perLitre ? 'km/L' : 'L/100km';
      // Where each range read here ends, which is where its second end's own match ends.
      const rangeEnds = new Set<number>();

      range.lastIndex = 0;
      for (const match of ctx.text.matchAll(range)) {
        const [pair, lowRaw, join, highRaw] = [match[0], match[1]!, match[2]!, match[3]!];
        const form = match[4]!;
        const pairStart = match.index;
        const low = parseNumber(lowRaw);
        const high = parseNumber(highRaw);
        if (low === null || high === null || !canBeRange(ctx.text, pairStart, low, high)) continue;
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
        const named = nameBefore(ctx.text, start, highRaw, form, isWordForm(form), end);
        if (named !== null) {
          changes.push(hold(named, ctx.text.slice(named, end), id, 35));
          continue;
        }
        const figures = Math.max(2, ...raws.map(significantFigures));
        const separators = joins.map(separator);
        const write = (order: number[]) =>
          `${interleave(order.map((mpg) => economy(mpg, figures, raws)), separators)} ${unit}`;
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
        const mpg = parseNumber(match[1]!);
        if (!mpg || endsRange(ctx.text, match.index, match[1]!)) {
          changes.push(hold(match.index, match[0], id, 35));
          continue;
        }
        const [form, end] = [match[2]!, match.index + match[0].length];
        const named = nameBefore(ctx.text, match.index, match[1]!, form, isWordForm(form), end);
        if (named !== null) {
          changes.push(hold(named, ctx.text.slice(named, end), id, 35));
          continue;
        }
        const raws = [match[1]!];
        const body = `${economy(mpg, Math.max(2, significantFigures(match[1]!)), raws)} ${unit}`;
        pushMeasurement(ctx, changes, match.index, match[0], body, id, 35);
      }
      return changes;
    },
  };
}

let measuredText: string | undefined;
let measuredStarts = new Set<number>();
let measuring = false;
let defaultUnitRules: Rule[] | undefined;

/**
 * Whether a unit rule run with the default options reads a measurement that starts at `at` in
 * `text`, converting it or holding it as written, as the range rule reads the `16` of
 * `16 to 20 feet` and the dimension rule the `12` of `12 in by 3 in.` Money asks this of the
 * figure after `pounds`, which is pence only where no measurement claims it. The answers for
 * the last text are kept, so a text is read once however often it is asked about. While the
 * rules read it, every answer is no, so a pence check inside them reads as it would alone.
 */
export function startsMeasurement(text: string, at: number): boolean {
  if (measuring) return false;
  if (text !== measuredText) {
    measuring = true;
    try {
      defaultUnitRules ??= unitRules(DEFAULT_RUN.options, []);
      const ctx = { ...DEFAULT_RUN, text };
      measuredStarts = new Set(defaultUnitRules.flatMap((rule) => rule.find(ctx).map((c) => c.start)));
    } finally {
      measuring = false;
    }
  }
  // Equal strings that are separate objects compare character by character, so the latest is kept.
  measuredText = text;
  return measuredStarts.has(at);
}

readMeasurementsWith(startsMeasurement);

export function unitRules(options: ResolvedOptions, dialectKeep: string[]): Rule[] {
  const skip = new Set([...dialectKeep, ...options.unitsKeep]);
  return [
    feetInchesRule(skip, options.rules),
    ...compoundRules(skip, options.rules),
    ...temperatureRules(),
    temperatureDecadeRule(),
    coinSizeRule(),
    fuelEconomyRule(),
    ...measurementRules(skip, options.rules),
  ];
}
