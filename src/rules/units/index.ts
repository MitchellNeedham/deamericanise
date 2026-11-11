import type { Change, Confidence, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import {
  MEASURES,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
} from './definitions.js';
import {
  COUNTED_FRACTION,
  FRACTION_WORDS,
  INLINE_SPACE,
  NUMBER_PATTERN,
  NUMERIC_PATTERN,
  SOFT_SPACE,
  formatNumber,
  formatTemperature,
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

function buildIndex(
  skip: Set<string>,
  forced: Record<string, boolean>,
): { alternation: string; words: string; byAlias: Map<string, Alias> } {
  const byAlias = new Map<string, Alias>();
  for (const measure of MEASURES) {
    // Turning the rule on by id overrides both a dialect that keeps the unit and a
    // measure that is kept everywhere by default.
    const kept = skip.has(measure.keep) || measure.keptByDefault === true;
    if (kept && forced[measure.id] !== true) continue;
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

function withOriginal(ctx: RuleContext, body: string, original: string): string {
  return ctx.options.units.keepOriginal ? `${body} (${original})` : body;
}


/**
 * A metric measurement as it appears inside a parenthetical, whether written in symbols,
 * written out, or written the American way. Longer unit names are listed first so the
 * end anchor cannot cut one short.
 */
const METRIC_INNER = new RegExp(
  String.raw`^\s*[-−]?\d[\d,]*(?:\.\d+)?` +
    String.raw`(?:\s*(?:-|–|—|to|x|×)\s*[-−]?\d[\d,]*(?:\.\d+)?)*\s*` +
    String.raw`(?:degrees?\s+(?:Celsius|C)\b|°\s*C|` +
    String.raw`kilometres?|kilometers?|centimetres?|centimeters?|millimetres?|millimeters?|` +
    String.raw`millilitres?|milliliters?|kilograms?|hectares?|kilowatts?|kilojoules?|` +
    String.raw`tonnes?|metres?|meters?|litres?|liters?|grams?|` +
    String.raw`km/h|kPa|kW|kJ|N·m|Nm|km²|km2|m²|m2|ha|mm|cm|km|kg|mg|mL|ml|` +
    String.raw`m|g|t|L|l)\s*$`,
);

/** The author wrote the metric side; only its spelling needs bringing across. */
function metricSpelling(text: string): string {
  return text.replace(
    /\b((?:kilo|centi|milli|micro|nano|deci|deca|hecto)?)(met|lit)er(s?)\b/gi,
    (_, prefix: string, stem: string, plural: string) => `${prefix}${stem}re${plural}`,
  );
}

/**
 * `30-60 feet (9-18 m)` already carries its own conversion, so converting the imperial
 * half produces `9.1-18 metres (9-18 m)`. Swallow the parenthetical instead and keep the
 * author's own figure, which is the one they rounded on purpose.
 */
function redundantMetric(ctx: RuleContext, end: number): { end: number; after: string } | null {
  const match = /^[ \t]*\(([^()]{1,40})\)/.exec(ctx.text.slice(end));
  if (!match || !METRIC_INNER.test(match[1]!)) return null;
  return { end: end + match[0].length, after: metricSpelling(match[1]!.trim()) };
}

/** Records one converted measurement, collapsing a redundant parenthetical if there is one. */
function pushMeasurement(
  ctx: RuleContext,
  changes: Change[],
  start: number,
  matched: string,
  body: string,
  ruleId: string,
  priority: number,
): void {
  const redundant = redundantMetric(ctx, start + matched.length);
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

function measurementRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  const { alternation, words, byAlias } = buildIndex(skip, forced);
  if (!alternation) return [];

  const S = INLINE_SPACE;
  // The pair guard can only apply before a digit, and is too costly to run at every word.
  const START = String.raw`(?<![\w.])(?:(?=[\d\-−])${NOT_SECOND_OF_PAIR}|(?![\d\-−]))`;
  const single = new RegExp(
    String.raw`${START}(${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );
  const range = new RegExp(
    String.raw`${START}(${NUMERIC_PATTERN})${RANGE_JOIN}(${NUMERIC_PATTERN})` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  // An optional unit after an inner number, so `8.5" x 11"` and `10 ft x 12 ft` both match.
  const INNER_UNIT = String.raw`(?:${GAP}(?:${alternation}))?`;
  const dimensions = new RegExp(
    String.raw`${START}(${NUMERIC_PATTERN})${INNER_UNIT}${DIMENSION_JOIN}(${NUMERIC_PATTERN})` +
      String.raw`(?:${INNER_UNIT}${DIMENSION_JOIN}(${NUMERIC_PATTERN}))?` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  // Written-out units only, because an abbreviation can be a word: `a gal and a half`.
  const fractionOf = new RegExp(
    String.raw`(?<![\w.])(?:((?:an?${S}+)?half)|(${FRACTION_WORDS})${S}+of)` +
      String.raw`${S}+an?(?=\s)${SOFT_SPACE}(${words})(?![\w-])`,
    'gi',
  );
  const andAFraction = new RegExp(
    String.raw`(?<![\w.])an?(?=\s)${SOFT_SPACE}(${words})${S}+and${S}+(${COUNTED_FRACTION})(?![\w-])`,
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
    if (isConventional(ctx, entry.measure, start, start + matched.length)) return;
    if (isAmbiguousHere(entry.measure, ctx.text)) return;

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
        const start = match.index;
        if (isConventional(ctx, entry.measure, start, start + match[0].length)) continue;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(match[3]!, match[0])) continue;

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
   * share the unit chosen for the largest of them.
   */
  const dimensionRule: Rule = {
    id: 'units.dimensions',
    category: 'units',
    confidence: 'moderate',
    priority: 38,
    find(ctx: RuleContext) {
      const changes: Change[] = [];
      dimensions.lastIndex = 0;
      for (const match of ctx.text.matchAll(dimensions)) {
        const entry = resolve(match[4]!);
        if (!entry) continue;
        const raw = [match[1], match[2], match[3]].filter((v): v is string => v !== undefined);
        const values = raw.map(parseNumber);
        if (values.some((v) => v === null)) continue;

        const start = match.index;
        if (isConventional(ctx, entry.measure, start, start + match[0].length)) continue;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(match[4]!, match[0])) continue;

        const numbers = values as number[];
        const largest = numbers.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
        if (largest === 0) continue;

        const target = entry.measure.convert(largest);
        const perSourceUnit = target.value / largest;
        const figures = Math.max(...raw.map(significantFigures));
        const { precision, maxDecimals } = ctx.options.units;
        const separator = /\bby\b/i.test(match[0]) ? ' by ' : match[0].includes('×') ? ' × ' : ' x ';
        const unit = entry.isWord
          ? ` ${entry.isSingular ? target.singular : target.plural}`
          : ` ${target.symbol}`;
        const body =
          numbers
            .map((v) => formatNumber(v * perSourceUnit, precision, figures, maxDecimals))
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
      for (const match of ctx.text.matchAll(single)) {
        const entry = resolve(match[2]!);
        const value = parseNumber(match[1]!);
        if (!entry || value === null) continue;
        const start = match.index;
        if (isConventional(ctx, entry.measure, start, start + match[0].length)) continue;
        if (isAmbiguousHere(entry.measure, ctx.text)) continue;
        if (isBareInch(match[2]!, match[0])) continue;

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
        const fraction = parseNumber(match[2]!);
        const value = fraction === null ? null : 1 + fraction;
        pushWrapped(ctx, changes, match.index, match[0], value, match[1]!);
      }
      return changes;
    },
  };

  return [dimensionRule, rangeRule, singleRule];
}

function temperatureRule(): Rule {
  const pattern = new RegExp(
    String.raw`(?<![\w.])([-−]?\d+(?:\.\d+)?)\s*` +
      String.raw`(°\s*F\b|℉|°\s*Fahrenheit\b|degrees?\s+Fahrenheit\b|degrees?\s+F\b|deg\.?\s*F\b)`,
    'gi',
  );

  return {
    id: 'units.temperature.fahrenheit',
    category: 'units',
    confidence: 'moderate',
    priority: 35,
    find(ctx) {
      const changes: Change[] = [];
      pattern.lastIndex = 0;
      for (const match of ctx.text.matchAll(pattern)) {
        const fahrenheit = parseNumber(match[1]!);
        if (fahrenheit === null) continue;
        const number = formatTemperature(
          ((fahrenheit - 32) * 5) / 9,
          ctx.options.units.precision,
          fahrenheit,
          ctx.options.units.maxDecimals,
        );
        const spelled = /degrees?/i.test(match[2]!);
        const suffix = spelled
          ? `${Number(number) === 1 || Number(number) === -1 ? ' degree' : ' degrees'} Celsius`
          : '°C';
        pushMeasurement(
          ctx,
          changes,
          match.index,
          match[0],
          `${number}${suffix}`,
          'units.temperature.fahrenheit',
          35,
        );
      }
      return changes;
    },
  };
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
      String.raw`(?:\s*(?:and|to|-|\u2013)\s*${DECADE})?(?!\w)`,
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
        if (!TEMPERATURE_NEARBY.test(before) && !TEMPERATURE_NEARBY.test(after)) continue;

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
        changes.push(
          change(
            match.index,
            match[0],
            withOriginal(ctx, `${number} ${perLitre ? 'km/L' : 'L/100km'}`, match[0]),
            'units.economy.mpg',
            35,
          ),
        );
      }
      return changes;
    },
  };
}

export function unitRules(options: ResolvedOptions, dialectKeep: string[]): Rule[] {
  const skip = new Set([...dialectKeep, ...options.unitsKeep]);
  return [
    feetInchesRule(),
    temperatureRule(),
    temperatureDecadeRule(),
    coinSizeRule(),
    fuelEconomyRule(),
    ...measurementRules(skip, options.rules),
  ];
}
