import { buildGate, type Gate } from '../../config.js';
import type { Change, Confidence, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import {
  COMPOUNDS,
  MEASURES,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
} from './definitions.js';
import { FAHRENHEIT, fahrenheitTemperatures } from './fahrenheit.js';
import {
  COUNTED_FRACTION,
  FRACTION_WORDS,
  INLINE_SPACE,
  NOT_IN_COMPOUND,
  NUMBER_PATTERN,
  NUMBER_START,
  NUMERIC_PATTERN,
  RANGE_START,
  SOFT_SPACE,
  WHOLE_NUMBER,
  canBeRange,
  formatNumber,
  formatTemperature,
  isOvenSetting,
  parseNumber,
  significantFigures,
  softGap,
} from './number.js';

const CONTEXT_WINDOW = 48;
/** Between a number and its unit: a space, a hyphen (`6-foot`), or nothing (`6ft`). */
const GAP = softGap('-?');
const RANGE_JOIN = softGap(String.raw`(?:[-\u2013\u2014]|to|and)`);
const DIMENSION_JOIN = softGap('(?:x|×|by)');

/**
 * The second number of a range or dimension is not a measurement of its own, even where the
 * pair does not match as a whole: `14 1/2 gallon` in `2024-03-14 1/2 gallon`.
 */
const NOT_SECOND_OF_PAIR = String.raw`(?<!\d${softGap(String.raw`(?:[-\u2013\u2014]|to|and|x|×|by)`)})`;

/** A range's first number and its join, ending where the range's second number starts. */
const RANGE_BEFORE = new RegExp(
  String.raw`(?<=${NUMBER_START}${RANGE_START}(${NUMERIC_PATTERN})${RANGE_JOIN})(?=[\d\-−])`,
  'dy',
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

function isConventional(ctx: RuleContext, measure: Measure, start: number, end: number): boolean {
  const rules = measure.conventional;
  if (!rules || !ctx.options.units.respectConventions) return false;
  const before = ctx.text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = ctx.text.slice(end, end + CONTEXT_WINDOW);
  return Boolean((rules.before?.test(before)) || (rules.after?.test(after)));
}

function isOtherSense(ctx: RuleContext, alias: Alias, start: number, end: number): boolean {
  return alias.isWord && alias.measure.otherSense?.(ctx.text, start, end) === true;
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
  return number !== null && otherSense(text, from + number.index, unitEnd);
}

/**
 * A singular unit is modifying the noun after it only when a determiner opens the phrase:
 * `a 9 inch dish` describes the dish, so it takes the singular. `one quart small onions`
 * is an ingredient quantity with the `of` left out, and `one` is itself the determiner,
 * so it stays plural and reads the same as `one quart of small onions` would.
 */
const DETERMINER_BEFORE = /\b(?:a|an|the|this|that|each|every|per|another)\s+$/i;

const MODIFIES_A_NOUN = new RegExp(
  String.raw`^[\s-]+(?!(?:of|in|on|at|by|for|and|or|to|from|with|per|thick|wide|long|tall|deep|high|` +
    String.raw`across|away|apart|each|only|down|up|north|south|east|west|ahead|behind|past|along|` +
    String.raw`beyond|into|through|short|further|farther|more|less|longer|shorter|wider|taller|` +
    String.raw`deeper|higher|closer)\b)[a-z]`,
  'i',
);

/** `6 in` is usually the preposition. `6in` never is. */
function isBareInch(alias: string, whole: string): boolean {
  return alias.toLowerCase() === 'in' && /\s$/.test(whole.slice(0, whole.length - alias.length));
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
 * A measurement left as written, such as a conventional size. Another rule can match a
 * piece of it, such as the `¾ inch` in `bolts of ½-¾ inch`, and the hold keeps that piece
 * as written too.
 */
function hold(start: number, matched: string, ruleId: string, priority: number): Change {
  return { ...change(start, matched, matched, ruleId, priority), hold: true };
}

function withOriginal(ctx: RuleContext, body: string, original: string): string {
  return ctx.options.units.keepOriginal ? `${body} (${original})` : body;
}


/** A metric unit's forms, and what a value in it comes to in its dimension's base unit. */
type MetricUnit = [forms: string, toBase: (value: number) => number];

const times = (factor: number) => (value: number) => value * factor;
const BASE = times(1);

/**
 * Metric units by dimension, in every form the unit rules write them and in the American
 * spellings. Each key names a capture group, which is how a match reports its dimension.
 */
const METRIC_UNITS = {
  temperature: [[String.raw`degrees?\s+(?:Celsius|C)\b|°\s*C`, BASE]],
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

const METRIC_NUMBER = String.raw`[-−]?\d[\d,]*(?:\.\d+)?`;
const METRIC_VALUE =
  String.raw`${METRIC_NUMBER}(?:\s*(?:-|–|—|to|and|x|×|by)\s*${METRIC_NUMBER})*\s*-?\s*` +
  `(?:${Object.entries(METRIC_UNITS)
    .map(([dimension, units]) => `(?<${dimension}>${units.map(([forms]) => forms).join('|')})`)
    .join('|')})`;

/**
 * A metric measurement filling a parenthetical, whether written in symbols, written out,
 * or written the American way.
 */
const METRIC_INNER = new RegExp(String.raw`^\s*${METRIC_VALUE}\s*$`);

/** A metric measurement ending the text before a parenthetical. */
const METRIC_BEFORE = new RegExp(String.raw`(?<![\w.])${METRIC_VALUE}\s*$`);

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
    String.raw`°\s*F(?:ahrenheit)?`,
    '℉',
    String.raw`degrees?\s+F(?:ahrenheit)?`,
    String.raw`deg\.?\s*F`,
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

const JOINER = String.raw`[-–—]|(?:to|and|x|×|by)(?![A-Za-z])`;

/**
 * One piece of an imperial measurement: a unit, a number, or what joins them. A unit has
 * to be followed by another piece or the end, which is what reads `40 miles per gallon`
 * as fuel economy and not as a length followed by a stray `per`.
 */
const MEASUREMENT_PIECE = new RegExp(
  String.raw`\s*(?:(?:${Object.values(IMPERIAL_UNITS)
    .flat()
    // Longest first, so `lb-ft` is torque and not `lb` joined to `ft`.
    .sort((a, b) => b.length - a.length)
    .join('|')})(?=\s*(?:$|${NUMBER_PATTERN}|${JOINER}))|${NUMBER_PATTERN}|${JOINER})`,
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
  const head = ctx.text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const tail = ctx.text.slice(end, end + CONTEXT_WINDOW);
  const open = head.lastIndexOf('(');
  const close = tail.indexOf(')');
  if (open < 0 || close < 0) return false;
  const inside = head.slice(open + 1) + ctx.text.slice(start, end) + tail.slice(0, close);
  const dimension = measurementDimension(inside);
  if (dimension === undefined) return false;
  const bracket = start - head.length + open;
  const before = ctx.text.slice(Math.max(0, bracket - CONTEXT_WINDOW), bracket);
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

/** `180°C/350°F` and `180°C or 350°F` give the imperial value after the metric one it restates. */
function followsItsMetric(
  ctx: RuleContext,
  start: number,
  end: number,
  body: string,
  ruleId: string,
): boolean {
  const from = Math.max(0, start - CONTEXT_WINDOW);
  if (!ENDS_IN_JOIN.test(ctx.text.slice(from, start))) return false;
  // The window runs on to `end` so a line break in the join can see that the next line
  // holds the measurement and opens no new block.
  for (const match of ctx.text.slice(from, end).matchAll(METRIC_PAIRED_BEFORE)) {
    if (from + match.index + match[0].length === start) return restatesBody(match[1]!, body, ruleId);
  }
  return false;
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
  const rest = ctx.text.slice(end);
  const match = BRACKET_AFTER.exec(rest) ?? METRIC_PAIRED_AFTER.exec(rest);
  if (!match || !restatesBody(match[1]!, body, ruleId)) return null;
  return { end: end + match[0].length, after: metricSpelling(match[1]!.trim()) };
}

/**
 * Records one converted measurement, collapsing a redundant parenthetical or pair if there
 * is one. A measurement that is itself the parenthetical after its metric value is not
 * recorded, and one paired after the metric value it restates is held as written.
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
  changes.push(change(start, matched, withOriginal(ctx, body, matched), ruleId, priority));
}

/** `6 feet 2 inches`, `6'2"` and `5 ft 11 in` collapse into a single metric height. */
function feetInchesRule(): Rule {
  const pattern = new RegExp(
    String.raw`(?<![\w.])(\d+)${SOFT_SPACE}(?:feet|foot|ft\.?|′|')` +
      softGap(String.raw`(?:and(?=\s))?`) +
      String.raw`(\d+(?:\.\d+)?|\d+${INLINE_SPACE}+\d+/\d+|\d+/\d+)` +
      String.raw`${SOFT_SPACE}(?:inches|inch|in\.?|″|")(?![A-Za-z])`,
    'gi',
  );

  return {
    id: 'units.length.feet-inches',
    category: 'units',
    confidence: 'moderate',
    priority: 40,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;
      for (const match of ctx.text.matchAll(pattern)) {
        const inches = parseNumber(match[2]!);
        if (inches === null) continue;
        const target = metricLength(Number(match[1]) * 0.3048 + inches * 0.0254);
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
 * one in a unit that is kept, and one that ends a range or dimension, as in `7-8 lb 4 oz`.
 */
function compoundRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  // A written-out number never starts inside another, such as the `two` of `twenty-two`.
  const START = String.raw`(?<![\w.])(?<![A-Za-z]-)(?:(?=\d)|(?<!\b(?:${WHOLE_NUMBER})[-\s]+))`;
  const SMALLER = String.raw`(?![-−])(?:${NUMERIC_PATTERN}|${WHOLE_NUMBER})`;
  const AND = softGap(String.raw`(?:and(?=\s))?`);
  const unitOf = (m: Measure) =>
    String.raw`(${alternate([...m.words, ...m.abbrevs, ...(m.compoundAbbrevs ?? [])])})(?![A-Za-z])`;

  return COMPOUNDS.map((compound): Rule => {
    const [largest, next, ...rest] = compound.measures.map(unitOf);
    const part = (unit: string) => String.raw`${AND}(${SMALLER})${GAP}${unit}`;
    const optional = rest.reduceRight((inner, unit) => `(?:${part(unit)}${inner})?`, '');
    const pattern = new RegExp(
      String.raw`${START}(${WHOLE_NUMBER})${GAP}${largest}${part(next!)}${optional}`,
      'gi',
    );

    return {
      id: compound.id,
      category: 'units',
      confidence: 'moderate',
      priority: 40,
      find(ctx) {
        const changes: Change[] = [];
        for (const match of ctx.text.matchAll(pattern)) {
          if (ORDINAL.test(match[0])) continue;
          const parts = compound.measures
            .map((measure, i) => ({ measure, raw: match[2 * i + 1], unit: match[2 * i + 2] ?? '' }))
            .filter((p) => p.raw !== undefined);
          const values = parts.map((p) => parseNumber(p.raw!));
          if (values.some((v) => v === null)) continue;

          const start = match.index;
          NOT_SECOND.lastIndex = start;
          const kept =
            forced[compound.id] !== true && parts.some((p) => isKept(p.measure, skip, forced));
          if (kept || !NOT_SECOND.test(ctx.text)) {
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
  // The pair guard can only apply before a digit, and is too costly to run at every word.
  const START = String.raw`${NUMBER_START}(?:(?=[\d\-−])${NOT_SECOND_OF_PAIR}|(?![\d\-−]))`;
  // Only a dimension's second number is refused here. `endsRange` judges a range's, which
  // needs both numbers.
  const SINGLE_START =
    String.raw`${NUMBER_START}(?:(?=[\d\-−])(?<!\d${DIMENSION_JOIN})|(?![\d\-−]))`;
  const single = new RegExp(
    String.raw`${SINGLE_START}(${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );
  const range = new RegExp(
    String.raw`${START}${RANGE_START}(${NUMERIC_PATTERN})${RANGE_JOIN}(${NUMERIC_PATTERN})` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  // An optional unit after an inner number, so `8.5" x 11"` and `10 ft x 12 ft` both match.
  const INNER_UNIT = String.raw`(?:${GAP}(${alternation}))?`;
  const dimensions = new RegExp(
    String.raw`${START}(${NUMERIC_PATTERN})${INNER_UNIT}${DIMENSION_JOIN}(${NUMERIC_PATTERN})` +
      String.raw`(?:${INNER_UNIT}${DIMENSION_JOIN}(${NUMERIC_PATTERN}))?` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'dgi',
  );

  // Written-out units only, because an abbreviation can be a word: `a gal and a half`.
  const fractionOf = new RegExp(
    String.raw`(?<![\w.])${NOT_IN_COMPOUND}(?:((?:an?${S}+)?half)|(${FRACTION_WORDS})${S}+of)` +
      String.raw`${S}+an?(?=\s)${SOFT_SPACE}(${words})(?![\w-])`,
    'gi',
  );
  // A count straight after `/` or `-` is the tail of `1 1/2` or `twenty-two`, not a number.
  const andAFraction = new RegExp(
    String.raw`${START}(an?(?=\s)|(?<![-−/])${WHOLE_NUMBER})${SOFT_SPACE}(${words})` +
      String.raw`${S}+and${S}+(${COUNTED_FRACTION})(?![\w-])`,
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
    if (isOtherSense(ctx, entry, start, start + matched.length)) return;
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

  const rangeRule: Rule = {
    id: 'units.range',
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      range.lastIndex = 0;
      for (const match of ctx.text.matchAll(range)) {
        const entry = resolve(match[3]!);
        const low = parseNumber(match[1]!);
        const high = parseNumber(match[2]!);
        if (!entry || low === null || high === null || high === 0) continue;
        if (!canBeRange(ctx.text, match.index, low, high)) continue;
        const start = match.index;
        if (isOtherSense(ctx, entry, start, start + match[0].length)) continue;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(match[3]!, match[0])) continue;
        if (isConventional(ctx, entry.measure, start, start + match[0].length)) {
          changes.push(hold(start, match[0], entry.measure.id, 35));
          continue;
        }

        // Both ends share the unit chosen for the larger one, so the range stays readable.
        const target = entry.measure.convert(high);
        const perSourceUnit = target.value / high;
        const figures = Math.max(significantFigures(match[1]!), significantFigures(match[2]!));
        const { precision, maxDecimals } = ctx.options.units;
        const lowText = formatNumber(low * perSourceUnit, precision, figures, maxDecimals);
        const highText = formatNumber(target.value, precision, figures, maxDecimals);
        const separator = /\bto\b/i.test(match[0]) ? ' to ' : /\band\b/i.test(match[0]) ? ' and ' : '-';
        const unit = entry.isWord ? ` ${target.plural}` : ` ${target.symbol}`;
        const body = `${lowText}${separator}${highText}${unit}`;

        pushMeasurement(ctx, changes, start, match[0], body, entry.measure.id, 35);
      }
      return changes;
    },
  };

  /**
   * `8.5 x 11 inches` and `10 x 12 x 8 feet` are one measurement, not two or three.
   * Converting half of a dimension pair produces nonsense, so they move together and
   * share the unit chosen for the largest of them. Each side is read in its own unit, so
   * `2 feet x 6 inches` comes to `61 x 15 centimetres`.
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
        const sides = groups.map(([number, unit]) => {
          const alias = match[unit];
          const upToUnit = alias === undefined ? '' : ctx.text.slice(start, match.indices![unit]![1]);
          return {
            raw: match[number]!,
            value: parseNumber(match[number]!),
            alias,
            entry: alias === undefined ? undefined : resolve(alias),
            bareInch: alias !== undefined && isBareInch(alias, upToUnit),
          };
        });
        if (sides.some((s) => s.value === null || (s.alias !== undefined && !s.entry))) continue;
        const last = sides[sides.length - 1]!;
        const entry = last.entry!;

        // A side with no unit of its own takes the next one written, as in `10 x 12 feet`.
        const units: Alias[] = [];
        for (let i = sides.length - 1; i >= 0; i--) units[i] = sides[i]!.entry ?? units[i + 1]!;
        const measures = [...new Set(units.map((u) => u.measure))];

        if (units.some((u) => isOtherSense(ctx, u, start, end))) continue;
        if (measures.some((m) => isAmbiguousHere(m, ctx.text))) continue;
        // Beside an earlier side with a unit of its own, as in `10 ft x 12 in`, `in` is the unit.
        if (last.bareInch && !sides.some((s) => s !== last && s.entry && !s.bareInch)) continue;

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
        const entry = resolve(match[2]!);
        const value = parseNumber(match[1]!);
        if (!entry || value === null) continue;
        if (endsRange(ctx.text, match.index, value)) {
          // Resumes at the next character, as past a start the pattern refused, so a measurement
          // that starts inside this match is still found.
          single.lastIndex = match.index + 1;
          continue;
        }
        const start = match.index;
        if (isOtherSense(ctx, entry, start, start + match[0].length)) continue;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(match[2]!, match[0])) continue;
        if (isConventional(ctx, entry.measure, start, start + match[0].length)) {
          changes.push(hold(start, match[0], entry.measure.id, 30));
          continue;
        }

        const target = entry.measure.convert(value);
        const { precision, maxDecimals } = ctx.options.units;
        const number = formatNumber(target.value, precision, significantFigures(match[1]!), maxDecimals);
        const numberStart = start + (/^an?\s+/i.exec(match[1]!)?.[0].length ?? 0);
        // A singular unit modifying a following noun is attributive: `a 9 inch dish`,
        // `a 3/8 inch bolt`. What follows decides, not the value, because a fraction is
        // just as attributive. `1/2 gallon of milk` and `1/16 inch thick` are not.
        const attributive =
          entry.isWord &&
          entry.isSingular &&
          DETERMINER_BEFORE.test(ctx.text.slice(Math.max(0, numberStart - 24), numberStart)) &&
          MODIFIES_A_NOUN.test(ctx.text.slice(start + match[0].length));
        const unit = entry.isWord
          ? ` ${attributive ? target.singular : unitWord(target, Number(number.replace(/,/g, '')))}`
          : ` ${target.symbol}`;
        // `a quarter mile track` keeps its article for the track, while `a quarter mile away`
        // gives it to the number.
        const from = attributive ? numberStart : start;
        const matched = match[0].slice(from - start);

        pushMeasurement(ctx, changes, from, matched, `${number}${unit}`, entry.measure.id, 30);
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
    const before = ctx.text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
    const after = ctx.text.slice(end, end + CONTEXT_WINDOW);
    const zero = FROM_ZERO.exec(after);
    if (zero) {
      end += zero[0].length;
      if (zero[1]!.toLowerCase() === 'below') values = values.map((v) => -Math.abs(v));
    }
    const difference = !zero && (CHANGE_BEFORE.test(before) || CHANGE_AFTER.test(after));

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
  const DECADE = String.raw`(low|mid|middle|high|upper|lower)?[\s-]*(1[01]0|\d0)['\u2019]?s`;
  const pattern = new RegExp(
    String.raw`(?<![\w.])(?:(in|into|around|about|near|above|below|over|under)\s+)?the\s+${DECADE}` +
      String.raw`(?:\s*(?:and|to|-|\u2013)\s*${DECADE})?(?!\w)(\s*(?:${FAHRENHEIT}|Fahrenheit\b))?`,
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
  const pattern = /(?<![\w.])(\d+(?:\.\d+)?)\s*(mpg|miles per gallon)(?![A-Za-z])/gi;

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
