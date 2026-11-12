import { buildGate, type Gate } from '../../config.js';
import type { Change, Confidence, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import { MONTH_PATTERN } from '../dates.js';
import { endsSentence } from '../sentence.js';
import {
  COMPOUNDS,
  MEASURES,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
} from './definitions.js';
import { BARE_CELSIUS_FIGURE, FAHRENHEIT, fahrenheitTemperatures } from './fahrenheit.js';
import {
  COUNTED_FRACTION,
  FRACTION_WORDS,
  HYPHEN,
  INLINE_SPACE,
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
  parseNumber,
  plainHyphens,
  significantFigures,
  softGap,
} from './number.js';

const CONTEXT_WINDOW = 48;
/** Between a number and its unit: a space, a hyphen (`6-foot`), or nothing (`6ft`). */
const GAP = softGap(`${HYPHEN}?`);
const RANGE_JOIN = softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and)`);
const DIMENSION_JOIN = softGap('(?:x|×|by)');
const TIGHT_HYPHEN = new RegExp(`^${HYPHEN}$`);

/**
 * The second number of a range or dimension is not a measurement of its own, even where the
 * pair does not match as a whole: `14 1/2 gallon` in `2024-03-14 1/2 gallon`.
 */
const NOT_SECOND_OF_PAIR =
  String.raw`(?<!${NUMERIC_LAST}${softGap(String.raw`(?:${HYPHEN}|[\u2013\u2014]|to|and|x|×|by)`)})`;

/** A range's first number and its join, ending where the range's second number starts. */
const RANGE_BEFORE = new RegExp(
  String.raw`(?<=${NUMBER_START}(${NUMERIC_PATTERN})${RANGE_JOIN})(?=${NUMERIC_FIRST})`,
  'diy',
);

/**
 * The number at `start` is the second end of a range, as the `10` of `5 - 10 feet` is, and
 * not a measurement of its own, even where the range does not match as a whole. A first
 * number that cannot open the range leaves it free: `Price $5 - 10 inches`, `In 2024 - 5 feet`.
 */
function endsRange(text: string, start: number, value: number): boolean {
  RANGE_BEFORE.lastIndex = start;
  const before = RANGE_BEFORE.exec(text);
  if (before === null) return false;
  const low = parseNumber(before[1]!);
  return low === null || canBeRange(text, before.indices![1]![0], low, value);
}

/** A number the range and dimension rules read: any in digits, and a whole number in words. */
const READABLE_NUMBER = new RegExp(String.raw`^(?:${NUMERIC_PATTERN}|${SECOND_END_WORDS})$`, 'i');

const isWritten = (raw: string) => /[a-z]/i.test(raw);

/** `half` or `a quarter`: one word that `READABLE_NUMBER` refuses is a fraction with no count. */
const isUncounted = (raw: string) => !READABLE_NUMBER.test(raw) && /^(?:an?\s+)?[a-z]+$/i.test(raw);

/**
 * What the range rule does with a range that has an end in words. `to` joins whole numbers
 * as it joins digits, and so does `and` after `between`, unless the `and` is inside one
 * number, as in `between one hundred and twenty feet and two hundred feet`. `half` or
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
  const word = /^\s*(to|and)\s*$/i.exec(join)?.[1]!.toLowerCase();
  if (word === 'and') {
    const between = /\bbetween\s+$/i.test(text.slice(Math.max(0, start - 16), start));
    if (!between || READABLE_NUMBER.test(low + join + high)) return 'skip';
  }
  const scaled = (end: string) => /\b(?:hundred|thousand)\b/i.test(end);
  const shared = isWritten(low) && !scaled(low) && scaled(high) && !/^an?\s/i.test(high);
  return word !== undefined && !shared && READABLE_NUMBER.test(low) && READABLE_NUMBER.test(high)
    ? 'read'
    : 'hold';
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

function alternate(aliases: string[]): string {
  return aliases
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escape)
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

const OTHER_SENSES = new Map(
  MEASURES.flatMap(({ words, otherSense }) =>
    otherSense ? words.map((word) => [word.toLowerCase(), otherSense] as const) : [],
  ),
);

/**
 * The number that ends where a unit word starts, begun where the rules begin it: a range at
 * its first number, and `1,500` or `two and a half` whole.
 */
const NUMBER_BEFORE_UNIT = new RegExp(
  String.raw`(?<![\w.])(?:(?:${NUMERIC_PATTERN})${RANGE_JOIN})?(?:${NUMBER_PATTERN})${GAP}$`,
  'i',
);

/** Far enough back to hold the longest range of numbers anyone writes before a unit. */
const NUMBER_REACH = 64;

/**
 * Whether the measurement rules read the written-out unit `text.slice(unitStart, unitEnd)`
 * in another sense over the quantity it ends, as they read `It cost 1,500 pounds` as money.
 * Detection asks this, so it never counts as an imperial unit what the rules leave alone.
 */
export function isUnitInOtherSense(text: string, unitStart: number, unitEnd: number): boolean {
  const otherSense = OTHER_SENSES.get(text.slice(unitStart, unitEnd).toLowerCase());
  if (!otherSense) return false;
  const from = Math.max(0, unitStart - NUMBER_REACH);
  const number = NUMBER_BEFORE_UNIT.exec(text.slice(from, unitStart));
  return number !== null && otherSense(contextText(text), from + number.index, unitEnd);
}

/**
 * A determiner opening the phrase, as in `a 9 inch dish`. A count opens it as a determiner
 * does, so `2 x 4 ounce cans` keeps the singular.
 */
const DETERMINER_BEFORE = /(?:\b(?:a|an|the|this|that|each|every|per|another)\s+|\d\s*[x×]\s*)$/i;

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
  'upon', 'via', 'within', 'without',
  'thick', 'wide', 'long', 'tall', 'deep', 'high', 'short', 'further', 'farther', 'more',
  'less', 'longer', 'shorter', 'wider', 'taller', 'deeper', 'higher', 'closer', 'too',
  'enough', 'apiece', 'each', 'only',
  'away', 'apart', 'down', 'up', 'north', 'south', 'east', 'west', 'ahead', 'back', 'out',
  'off', 'around', 'over', 'overhead', 'above', 'below', 'inside', 'outside', 'inland',
  'offshore',
  'uphill', 'downhill', 'upstream', 'downstream',
  'later', 'earlier', 'ago', 'before', 'after',
  'i', 'me', 'he', 'him', 'she', 'it', 'we', 'us', 'they', 'them', 'you',
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
 * A word straight after a measurement that may be a noun it describes. A number in words,
 * alone or with its unit (`one-inch`, `onelbs`), or a date is not one. Another rule may
 * rewrite either to start with a digit, so reading it as a noun would leave the measurement
 * to a second run.
 */
const MODIFIES_A_NOUN = new RegExp(
  String.raw`^(?:\s|${HYPHEN})+(?!(?:${NOT_A_NOUN.join('|')}|(?:${NUMBER_PATTERN})(?:${GAP}(?:${UNIT_FORMS}))?)` +
    String.raw`(?!\w|${HYPHEN})|(?:${MONTH_PATTERN})\.?\s+\d)[a-z]`,
  'i',
);

/**
 * Whether the singular unit word ending at `end` describes the noun after it, so its metric
 * unit stays singular too: `a 9 inch dish`, `9 inch pans`, `one-inch slices`. The unit
 * follows a number worth `value` that starts at `numberStart`, across `gap`. A determiner
 * opening the phrase says so, as does a hyphen tying the number to the unit, or the singular
 * after a number above one, which would otherwise take the plural. One and a fraction take
 * the singular anyway, so `one quart small onions` and `1/2 pound ground beef` are
 * quantities with the `of` left out, read as `one quart of small onions` would be.
 */
function describesNoun(
  text: string,
  numberStart: number,
  value: number,
  gap: string,
  end: number,
): boolean {
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

/** `6 in` is usually the preposition. `6in` never is. */
function isBareInch(alias: string, whole: string): boolean {
  return alias.toLowerCase() === 'in' && /\s$/.test(whole.slice(0, whole.length - alias.length));
}

/**
 * An apostrophe after a number, read as the foot's prime only on a side of a dimension whose
 * every side has a mark of its own, as in `2' x 6"`. Anywhere else it may close a quote.
 */
const FOOT_MARK = "'";
const PRIME = '′';

/** A quote opened straight before a number, which a `'` after the number may close: `'6'`. */
const OPENS_QUOTE = /['‘]$/;

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

/**
 * Metric units by dimension, in every form the unit rules write them, in the American
 * spellings, and in the shorthand of a hand-written temperature such as `180C` or `180ºC`.
 * Each key names a capture group, which is how a match reports its dimension.
 */
const METRIC_UNITS = {
  temperature: [
    [String.raw`degrees?\s+(?:Celsius|C)\b|[°º˚]\s*C(?:elsius\b)?|Celsius\b`, BASE],
    [String.raw`C\b`, BASE, BARE_CELSIUS_FIGURE],
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

const METRIC_NUMBER = String.raw`[-−]?\d[\d,]*(?:\.\d+)?`;
const METRIC_VALUE =
  String.raw`${METRIC_NUMBER}(?:\s*(?:-|–|—|to|and|x|×|by)\s*${METRIC_NUMBER})*\s*-?\s*` +
  `(?:${Object.entries(METRIC_UNITS)
    .map(([dimension, units]) => `(?<${dimension}>${units.map(afterFigure).join('|')})`)
    .join('|')})`;

/**
 * A metric measurement filling a parenthetical, whether written in symbols, written out,
 * or written the American way.
 */
const METRIC_INNER = new RegExp(String.raw`^\s*${METRIC_VALUE}\s*$`);

/**
 * A metric measurement just before a parenthetical, in text that runs to the opening
 * bracket. Markdown emphasis or code may close between them, as in `**1.8 metres** (6 feet)`,
 * and so may a line break that only wraps the paragraph. An opening `_` is emphasis, not
 * part of a word the measurement starts inside.
 */
const METRIC_BEFORE = new RegExp(
  String.raw`(?<![A-Za-z\d.]_*)${METRIC_VALUE}[*_\`]*${SOFT_SPACE}\($`,
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

/**
 * Imperial units by the dimension of what they convert to: every unit in MEASURES, and
 * the forms that only the feet-and-inches, temperature and fuel economy rules read.
 */
const IMPERIAL_UNITS: Partial<Record<Dimension, string[]>> = {
  temperature: [
    String.raw`[°º˚]\s*F(?:ahrenheit)?`,
    '℉',
    String.raw`degrees?\s+F(?:ahrenheit)?`,
    String.raw`deg\.?\s*F`,
    'Fahrenheit',
  ],
  economy: ['mpg', String.raw`miles\s+per\s+gallon`],
  length: ["'"],
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

const JOINER = String.raw`[-–—]|(?:to|and|x|×|by)(?![A-Za-z])`;

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

/**
 * The dimension of the imperial measurement the text holds and nothing else, after an
 * optional word of approximation. `about 6 feet 2 inches` is a length, while
 * `10 feet for the old one` and `6 feet 3 pounds` are neither, and give undefined.
 */
function measurementDimension(text: string): Dimension | undefined {
  const rest = text.trim().replace(APPROXIMATELY, '');
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

const BRACKET_AFTER = new RegExp(String.raw`^${SOFT_SPACE}\(([^()]{1,40})\)`);

/**
 * A `/` or `or` between one measurement in both systems, as in `180°C/350°F/gas 4`. A
 * slash before a bare unit is a rate (`5 gallons/minute`), so the metric side needs a figure.
 */
const PAIR_JOIN = softGap(String.raw`(?:/|(?<=\s)or(?=\s))`);
// `(?=\S)` makes a join that wraps take its line break, so the match ends at the next value.
const METRIC_PAIRED_BEFORE = new RegExp(
  String.raw`(?<![\w.])(${METRIC_VALUE})${PAIR_JOIN}(?=\S)`,
  'g',
);
const METRIC_PAIRED_AFTER = new RegExp(String.raw`^${PAIR_JOIN}(${METRIC_VALUE})(?!\w)`);
/** A cheap test passed by every text that `METRIC_PAIRED_BEFORE` can end, and few others. */
const ENDS_IN_JOIN = /(?:\/|\sor)\s*$/;

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
 * `350°F/180°C` and `350°F or 180°C` collapse the same way.
 */
function redundantMetric(
  ctx: RuleContext,
  end: number,
  body: string,
  ruleId: string,
): { end: number; after: string } | null {
  const rest = contextText(ctx.text).slice(end);
  const match = BRACKET_AFTER.exec(rest) ?? METRIC_PAIRED_AFTER.exec(rest);
  if (!match || !restatesBody(match[1]!, body, ruleId)) return null;
  return { end: end + match[0].length, after: metricSpelling(match[1]!.trim()) };
}

/**
 * Any capitalised word after a unit's stop starts a new sentence, a number in words included,
 * as in `It weighs 5 lb. One bag is enough.` It has to accept every word the bare F's
 * `OPENER` accepts there, or a stop that ends a bare F's sentence would go, and the second run
 * would read a longer sentence.
 */
const AFTER_UNIT = /(?:)/y;

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
    changes.push({
      start,
      end: redundant.end,
      before: ctx.text.slice(start, redundant.end),
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
  if (matched.endsWith('.') && endsSentence(ctx.text, start, start + matched.length, AFTER_UNIT)) after += '.';
  changes.push(change(start, matched, after, ruleId, priority));
}

/**
 * A number of a measurement in two units: in digits, in any shape the single rule reads but
 * unsigned, or a whole number in words. A minus before the first number stays outside the
 * match, where it negates the whole.
 */
const UNSIGNED_NUMBER = String.raw`(?:(?![-−])(?:${NUMERIC_PATTERN})|${WHOLE_NUMBER})`;

const STARTS_HERE = new RegExp(NUMBER_START, 'y');

/**
 * The matches of `pattern`, which starts more loosely than `NUMBER_START`, split by whether
 * `NUMBER_START` lets each one's number start where it stands. Past a refused match the
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
 * The measurement in two units at `start`, whose first number is `first`, ends a range that
 * the range rule reads or holds, as in `7-8 lb 4 oz` and `five to six feet two inches`.
 * Whether the range's first end is `7` or `7 lb` cannot be told, so the measurement is held,
 * the range rule's change splits the hold and is dropped, and the whole range stays as written.
 */
function endsRangeWhole(text: string, start: number, first: string): boolean {
  RANGE_OPENING.lastIndex = start;
  const opening = RANGE_OPENING.exec(text);
  if (opening === null) return false;
  const [lowRaw, join] = [opening[1]!, opening[2]!];
  const lowStart = opening.indices![1]![0];
  const written = isWritten(lowRaw) || isWritten(first);
  if (written && writtenRange(text, lowStart, lowRaw, join, first) === 'skip') return false;
  const low = parseNumber(lowRaw);
  const high = parseNumber(first);
  return low === null || high === null || canBeRange(text, lowStart, low, high);
}

const LINE_END = String.raw`(?:\r\n?|[\n\v\f\u2028\u2029])`;

/**
 * Where inches may go without their word after `foot` or `feet`, as in `six foot two`: before
 * nothing that could be a noun. That is punctuation, `tall`, the end of the text, or the end
 * of a line where the next line is blank or starts with something other than a word, such as
 * a list marker.
 */
const NO_NOUN_AFTER =
  String.raw`(?=[.,;:!?)\]"'”’]+(?!\w)|${SOFT_SPACE}tall\b|` +
  String.raw`${INLINE_SPACE}*(?:$|${LINE_END}${INLINE_SPACE}*(?:$|${LINE_END}|[^\sA-Za-z])))`;

/** Inches written without their word: a whole number from 1 to 11. */
const isInchCount = (value: number | null) =>
  value !== null && Number.isInteger(value) && value >= 1 && value <= 11;

/**
 * `6 feet 2 inches`, `6'2"`, `5 ft 11 in`, `six feet two inches` and `six foot two` collapse
 * into a single metric height.
 */
function feetInchesRule(): Rule {
  const pattern = new RegExp(
    String.raw`(?<![\w.])(${UNSIGNED_NUMBER})${SOFT_SPACE}(?:(?:feet|foot|ft\.?|′|')` +
      softGap(String.raw`(?:and(?=\s))?`) +
      String.raw`(\d+(?:\.\d+)?|\d+${INLINE_SPACE}+\d+/\d+|\d+-\d+/\d+|\d+/\d+|` +
      String.raw`${WHOLE_NUMBER}(?:${INLINE_SPACE}+and${INLINE_SPACE}+${COUNTED_FRACTION})?)` +
      String.raw`${SOFT_SPACE}(?:inches|inch|in\.?|″|")(?![A-Za-z])|` +
      String.raw`(?:feet|foot)${SOFT_SPACE}(?<=\s)(${WHOLE_NUMBER})${NO_NOUN_AFTER})`,
    'gi',
  );

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
      for (const match of found) {
        const feet = parseNumber(match[1]!);
        const inches = parseNumber(match[2] ?? match[3]!);
        if (match[3] !== undefined && !isInchCount(inches)) continue;
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
        const body = `${number} ${unitWord(target, Number(number))}`;
        pushMeasurement(ctx, changes, match.index, match[0], body, 'units.length.feet-inches', 40);
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
  // A written-out number never starts inside another, such as the `two` of `twenty-two`.
  // The lookbehind runs only before a letter, and takes a run of spaces whole, because each
  // place it tries inside the run costs a walk over the rest of it.
  const START =
    String.raw`(?<![\w.])` +
    String.raw`(?:(?![A-Za-z])|(?=[A-Za-z])(?<![A-Za-z]-)(?<!\b(?:${WHOLE_NUMBER})(?<![-\s])\s+))`;
  const AND = softGap(String.raw`(?:and(?=\s))?`);
  const unitOf = (m: Measure) =>
    String.raw`(${alternate([...m.words, ...m.abbrevs, ...(m.compoundAbbrevs ?? [])])})(?![A-Za-z])`;

  return COMPOUNDS.map((compound): Rule => {
    const [largest, next, ...rest] = compound.measures.map(unitOf);
    const part = (unit: string) => String.raw`${AND}(${UNSIGNED_NUMBER})${GAP}${unit}`;
    const optional = rest.reduceRight((inner, unit) => `(?:${part(unit)}${inner})?`, '');
    const pattern = new RegExp(
      String.raw`${START}(${UNSIGNED_NUMBER})${GAP}${largest}${part(next!)}${optional}`,
      'gi',
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
          const attributive =
            isWord(last) &&
            SINGULAR_WORDS.has(last.unit.toLowerCase()) &&
            DETERMINER_BEFORE.test(ctx.text.slice(Math.max(0, start - 24), start)) &&
            MODIFIES_A_NOUN.test(ctx.text.slice(end));
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
  const range = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})(${RANGE_JOIN})(${SECOND_END})` +
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
    if (isOtherSense(ctx, entry, start, start + matched.length)) {
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
  ): void => {
    const entry = resolve(alias);
    const value = parseNumber(raw);
    if (!entry || value === null) return;
    // The hyphen ties the fraction to the unit, so the count before them counts the noun,
    // as in `two quarter-pound burgers`.
    const count = entry.isSingular && matched[raw.length] === '-' ? COUNT_APART.exec(raw) : null;
    if (count && MODIFIES_A_NOUN.test(ctx.text.slice(start + matched.length))) {
      const cut = count[0].length;
      pushSingle(ctx, changes, start + cut, matched.slice(cut), raw.slice(cut), alias);
      return;
    }
    if (isOtherSense(ctx, entry, start, start + matched.length)) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }
    if (isAmbiguousHere(entry.measure, ctx.text)) return;
    if (isBareInch(alias, matched)) return;
    if (isConventional(ctx, entry.measure, start, start + matched.length)) {
      changes.push(hold(start, matched, entry.measure.id, 30));
      return;
    }

    const target = entry.measure.convert(value);
    const { precision, maxDecimals } = ctx.options.units;
    const number = formatNumber(target.value, precision, significantFigures(raw), maxDecimals);
    const numberStart = start + (/^an?\s+/i.exec(raw)?.[0].length ?? 0);
    const gap = matched.slice(raw.length, matched.length - alias.length);
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

    pushMeasurement(ctx, changes, from, quantity, `${number}${unit}`, entry.measure.id, 30);
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
        const matched = match[0];
        const [lowRaw, join, highRaw, alias] = [match[1]!, match[2]!, match[3]!, match[4]!];
        const start = match.index;
        const entry = resolve(alias);
        const low = parseNumber(lowRaw);
        const high = parseNumber(highRaw);
        if (!entry || low === null || high === null || high === 0) continue;
        const written = isWritten(lowRaw) || isWritten(highRaw);
        const reading = written ? writtenRange(ctx.text, start, lowRaw, join, highRaw) : 'read';
        if (reading === 'skip') continue;
        // `2-3/4` is one number, which the single measurement rule reads.
        if (!written && TIGHT_HYPHEN.test(join) && parseNumber(`${lowRaw}-${highRaw}`) !== null) continue;
        if (!canBeRange(ctx.text, start, low, high)) continue;
        if (isOtherSense(ctx, entry, start, start + matched.length)) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(alias, matched)) continue;
        const conventional = isConventional(ctx, entry.measure, start, start + matched.length);
        if (reading === 'hold' || conventional) {
          changes.push(hold(start, matched, entry.measure.id, 35));
          continue;
        }

        // Both ends share the unit chosen for the larger one, so the range stays readable.
        const target = entry.measure.convert(high);
        const perSourceUnit = target.value / high;
        const figures = Math.max(significantFigures(lowRaw), significantFigures(highRaw));
        const { precision, maxDecimals } = ctx.options.units;
        const lowText = formatNumber(low * perSourceUnit, precision, figures, maxDecimals);
        const highText = formatNumber(target.value, precision, figures, maxDecimals);
        const separator = /to/i.test(join) ? ' to ' : /and/i.test(join) ? ' and ' : '-';
        const gap = matched.slice(lowRaw.length + join.length + highRaw.length, -alias.length);
        const attributive =
          entry.isSingular && describesNoun(ctx.text, start, high, gap, start + matched.length);
        const unit = entry.isWord
          ? ` ${attributive ? target.singular : target.plural}`
          : ` ${target.symbol}`;
        const body = `${lowText}${separator}${highText}${unit}`;

        pushMeasurement(ctx, changes, start, matched, body, entry.measure.id, 35);
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
            entry: alias === undefined ? undefined : resolve(alias === FOOT_MARK ? PRIME : alias),
            bareInch: alias !== undefined && isBareInch(alias, ctx.text.slice(start, sideEnd)),
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

        if (sides.some((s) => s.alias === FOOT_MARK)) {
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
          !(entry.isWord && !entry.isSingular) && MODIFIES_A_NOUN.test(ctx.text.slice(end));
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
          s.alias !== FOOT_MARK &&
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
function celsiusPartnerAfter(rest: string): RegExpExecArray | null {
  const match = BRACKET_AFTER.exec(rest) ?? METRIC_PAIRED_AFTER.exec(rest);
  return match && dimensionOf(METRIC_INNER.exec(match[1]!)) === 'temperature' ? match : null;
}

/**
 * The text either side of a Fahrenheit value from `start` to `end`, past any Celsius value
 * given beside it, where the words that mark a change in temperature stand, as they do in
 * `20°F (11°C) warmer` and `rose 11°C or 20°F`.
 */
function wordsBeside(text: string, start: number, end: number): { before: string; after: string } {
  const paired = metricPairedBefore(text, start, end);
  const from = paired?.dimension === 'temperature' ? paired.start : start;
  const to = end + (celsiusPartnerAfter(text.slice(end))?.[0].length ?? 0);
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

function fahrenheitReadings(ctx: RuleContext): FahrenheitReading[] {
  const readings: FahrenheitReading[] = [];
  for (const match of fahrenheitTemperatures(ctx.text)) {
    const raw = match[1] === undefined ? [match[3]!] : [match[1], match[3]!];
    const parsed = raw.map(parseNumber);
    if (parsed.some((v) => v === null)) continue;
    let values = parsed as number[];

    const start = match.index;
    let end = start + match[0].length;
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

    const spelled = /degrees?/i.test(match[4] ?? '');
    const single = numbers.length === 1 && Math.abs(Number(numbers[0])) === 1;
    const suffix = spelled ? ` ${single ? 'degree' : 'degrees'} Celsius` : '°C';
    readings.push({
      start,
      matched: ctx.text.slice(start, end),
      body: numbers.join(match[2] ?? '') + suffix,
      ruleId: difference ? DIFFERENCE_ID : ABSOLUTE_ID,
    });
  }
  return readings;
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
      String.raw`(?:\s*(?:and|to|${HYPHEN}|\u2013)\s*${DECADE})?(?!\w)(\s*(?:${FAHRENHEIT}|Fahrenheit\b))?`,
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
          after: body,
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

function fuelEconomyRule(): Rule {
  const pattern = new RegExp(
    String.raw`${NUMBER_START}(\d+(?:\.\d+)?)\s*(mpg|miles per gallon)(?![A-Za-z])`,
    'gi',
  );

  return {
    id: 'units.economy.mpg',
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;
      for (const match of ctx.text.matchAll(pattern)) {
        const mpg = Number(match[1]);
        if (!mpg) continue;
        const perLitre = ctx.options.units.fuelEconomy === 'km-per-l';
        const value = perLitre ? mpg * 0.425143707 : 235.214583 / mpg;
        const { precision, maxDecimals } = ctx.options.units;
        const number = formatNumber(value, precision, Math.max(2, significantFigures(match[1]!)), maxDecimals);
        const body = `${number} ${perLitre ? 'km/L' : 'L/100km'}`;
        pushMeasurement(ctx, changes, match.index, match[0], body, 'units.economy.mpg', 35);
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
