import type { Change, ResolvedOptions, Rule, RuleContext } from '../../types.js';
import {
  MEASURES,
  SINGULAR_WORDS,
  metricLength,
  type Measure,
  type MetricValue,
} from './definitions.js';
import {
  NUMBER_PATTERN,
  formatNumber,
  formatTemperature,
  parseNumber,
  significantFigures,
} from './number.js';

const CONTEXT_WINDOW = 48;
/** Between a number and its unit: a space, a hyphen (`6-foot`), or nothing (`6ft`). */
const GAP = String.raw`[\s ]*-?[\s ]*`;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Alias {
  measure: Measure;
  isWord: boolean;
  /** The matched form was singular, as in `a 9 inch dish`. */
  isSingular: boolean;
}

function buildIndex(
  skip: Set<string>,
  forced: Record<string, boolean>,
): { alternation: string; byAlias: Map<string, Alias> } {
  const byAlias = new Map<string, Alias>();
  for (const measure of MEASURES) {
    // Turning the rule on by id overrides a dialect that would otherwise keep the unit.
    if (skip.has(measure.keep) && forced[measure.id] !== true) continue;
    for (const w of measure.words) {
      byAlias.set(w.toLowerCase(), { measure, isWord: true, isSingular: SINGULAR_WORDS.has(w) });
    }
    for (const a of measure.abbrevs) {
      byAlias.set(a.toLowerCase(), { measure, isWord: false, isSingular: false });
    }
  }
  const alternation = [...byAlias.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escape)
    .join('|');
  return { alternation, byAlias };
}

function isConventional(measure: Measure, text: string, start: number, end: number): boolean {
  const rules = measure.conventional;
  if (!rules) return false;
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = text.slice(end, end + CONTEXT_WINDOW);
  return Boolean((rules.before?.test(before)) || (rules.after?.test(after)));
}

/** `6 in` is usually the preposition. `6in` never is. */
function isBareInch(alias: string, whole: string): boolean {
  return alias.toLowerCase() === 'in' && /\s$/.test(whole.slice(0, whole.length - alias.length));
}

function unitWord(target: MetricValue, value: number): string {
  return Math.abs(value) === 1 ? target.singular : target.plural;
}

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
    confidence: 'moderate',
    priority,
  };
}

function withOriginal(ctx: RuleContext, body: string, original: string): string {
  return ctx.options.units.keepOriginal ? `${body} (${original})` : body;
}

/** `6 feet 2 inches`, `6'2"` and `5 ft 11 in` collapse into a single metric height. */
function feetInchesRule(): Rule {
  const pattern = new RegExp(
    String.raw`(?<![\w.])(\d+)\s*(?:feet|foot|ft\.?|′|')\s*(?:and\s+)?` +
      String.raw`(\d+(?:\.\d+)?|\d+\s+\d+/\d+|\d+/\d+)\s*(?:inches|inch|in\.?|″|")(?![A-Za-z])`,
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
        changes.push(
          change(match.index, match[0], withOriginal(ctx, body, match[0]), 'units.length.feet-inches', 40),
        );
      }
      return changes;
    },
  };
}

function measurementRules(skip: Set<string>, forced: Record<string, boolean>): Rule[] {
  const { alternation, byAlias } = buildIndex(skip, forced);
  if (!alternation) return [];

  const single = new RegExp(
    String.raw`(?<![\w.])(${NUMBER_PATTERN})${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );
  const range = new RegExp(
    String.raw`(?<![\w.])(${NUMBER_PATTERN})\s*(?:-|–|—|to|and)\s*(${NUMBER_PATTERN})` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  // An optional unit after an inner number, so `8.5" x 11"` and `10 ft x 12 ft` both match.
  const INNER_UNIT = String.raw`(?:${GAP}(?:${alternation}))?`;
  const dimensions = new RegExp(
    String.raw`(?<![\w.])(${NUMBER_PATTERN})${INNER_UNIT}\s*(?:x|×|by)\s*(${NUMBER_PATTERN})` +
      String.raw`(?:${INNER_UNIT}\s*(?:x|×|by)\s*(${NUMBER_PATTERN}))?` +
      String.raw`${GAP}(${alternation})(?![A-Za-z])`,
    'gi',
  );

  const resolve = (alias: string) => byAlias.get(alias.toLowerCase().replace(/\s+/g, ' '));

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
        if (isConventional(entry.measure, ctx.text, start, start + match[0].length)) continue;
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

        changes.push(change(start, match[0], withOriginal(ctx, body, match[0]), entry.measure.id, 35));
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
        if (isConventional(entry.measure, ctx.text, start, start + match[0].length)) continue;
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

        changes.push(change(start, match[0], withOriginal(ctx, body, match[0]), entry.measure.id, 38));
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
        if (isConventional(entry.measure, ctx.text, start, start + match[0].length)) continue;
        if (isBareInch(match[2]!, match[0])) continue;

        const target = entry.measure.convert(value);
        const { precision, maxDecimals } = ctx.options.units;
        const number = formatNumber(target.value, precision, significantFigures(match[1]!), maxDecimals);
        // A singular unit beside a number above one is attributive: `a 9 inch dish`.
        // Below one it is genuine, as in `1/2 gallon`, so the value decides instead.
        const attributive = entry.isWord && entry.isSingular && Math.abs(value) > 1;
        const unit = entry.isWord
          ? ` ${attributive ? target.singular : unitWord(target, Number(number.replace(/,/g, '')))}`
          : ` ${target.symbol}`;

        changes.push(
          change(start, match[0], withOriginal(ctx, `${number}${unit}`, match[0]), entry.measure.id, 30),
        );
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
        changes.push(
          change(
            match.index,
            match[0],
            withOriginal(ctx, `${number}${suffix}`, match[0]),
            'units.temperature.fahrenheit',
            35,
          ),
        );
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
    fuelEconomyRule(),
    ...measurementRules(skip, options.rules),
  ];
}
