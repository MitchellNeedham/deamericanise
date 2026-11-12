import { toPatterns } from './engine/protect.js';
import type { Category, Confidence, LexEntry, Options, Preset, ResolvedOptions } from './types.js';
import { dialectPack } from './dialects/index.js';

export const CATEGORIES: Category[] = [
  'spelling', 'vocabulary', 'units', 'dates', 'times', 'currency', 'punctuation', 'misc',
];

export const CONFIDENCES: Confidence[] = ['safe', 'moderate', 'risky'];

export const PRESETS: Preset[] = ['read', 'localise'];

/**
 * What each preset switches on.
 *
 * `read` covers the things that stop a non-American reading the text at all: the
 * spellings, the measurements, and a date order that means the wrong day. It leaves the
 * subject matter alone, so an article about America still has sidewalks and gas stations
 * in it.
 *
 * `localise` adds the vocabulary, which is what you want when you are going to act on the
 * text rather than read it: a recipe you will cook, a manual you will follow.
 */
const PRESET_CATEGORIES: Record<Preset, Record<Category, boolean>> = {
  read: {
    spelling: true,
    units: true,
    dates: true,
    times: true,
    currency: true,
    // House style, not comprehension. Nobody misreads `Mr. Smith`, and plenty of
    // Australians write it that way, so this waits to be asked for.
    punctuation: false,
    vocabulary: false,
    misc: false,
  },
  localise: Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>,
};

export function resolveOptions(options: Options = {}, defaults: Partial<Options> = {}): ResolvedOptions {
  const merged = { ...defaults, ...options };
  const preset = merged.preset ?? 'read';
  const fromPreset = PRESET_CATEGORIES[preset];
  // An explicit category always wins over the preset that suggested it.
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c, merged.categories?.[c] ?? fromPreset[c]]),
  ) as Record<Category, boolean>;

  const units = merged.units === false ? { enabled: false } : { enabled: true, ...(merged.units ?? {}) };
  const dates = merged.dates === false ? { enabled: false } : { enabled: true, ...(merged.dates ?? {}) };
  const times = merged.times === false ? { enabled: false } : { enabled: true, ...(merged.times ?? {}) };
  const currency =
    merged.currency === false ? { enabled: false } : { enabled: true, ...(merged.currency ?? {}) };

  return {
    dialect: merged.dialect ?? 'en-AU',
    preset,
    categories,
    confidence: merged.confidence ?? CONFIDENCES,
    rules: merged.rules ?? {},
    protect: toPatterns(merged.protect ?? []),
    protectProperNouns: merged.protectProperNouns ?? true,
    protectIdentifiers: merged.protectIdentifiers ?? false,
    protectCommentedCode: merged.protectCommentedCode ?? merged.protectIdentifiers ?? false,
    commentMarkers: [],
    markdownFences: true,
    unitsKeep: merged.unitsKeep ?? [],
    assumeAmerican: merged.assumeAmerican,
    minAmericanConfidence: merged.minAmericanConfidence ?? 0.5,
    units: {
      enabled: units.enabled,
      keepOriginal: units.keepOriginal ?? false,
      precision: units.precision ?? 'natural',
      maxDecimals: units.maxDecimals ?? 6,
      respectConventions: units.respectConventions ?? true,
      fuelEconomy: units.fuelEconomy ?? 'l-per-100km',
    },
    dates: {
      enabled: dates.enabled,
      format: dates.format ?? 'iso',
      // `March 5, 2024` names its month, so nobody can misread it. Reordering it is
      // local convention rather than translation, unlike an all-numeric date.
      reorderLongDates: dates.reorderLongDates ?? preset === 'localise',
    },
    times: {
      enabled: times.enabled,
      // A 12-hour clock is normal outside America too, so only the `P.M.` styling goes
      // by default. The 24-hour clock is a change of convention, not a translation.
      to24Hour: times.to24Hour ?? false,
    },
    currency: {
      enabled: currency.enabled,
      mode: currency.mode ?? 'annotate',
    },
  };
}

/** A `rules` key matches its own id, and a key ending in `*` matches by prefix. */
export function matchesRuleId(pattern: string, ruleId: string): boolean {
  if (pattern === ruleId) return true;
  if (pattern.endsWith('.*')) return ruleId.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith('*')) return ruleId.startsWith(pattern.slice(0, -1));
  return false;
}

export interface Gate {
  rule(ruleId: string, category: Category, confidence: Confidence): boolean;
  entry(entry: LexEntry): boolean;
}

/**
 * A rule runs unless something switched it off. The most specific `rules` key wins, and
 * an explicit `true` there also overrides a disabled category or confidence tier.
 */
export function buildGate(options: ResolvedOptions): Gate {
  const pack = dialectPack(options.dialect);
  const keep = new Set(pack.keep);
  const overrides = Object.entries(options.rules).sort((a, b) => b[0].length - a[0].length);
  const confidences = new Set(options.confidence);

  function rule(ruleId: string, category: Category, confidence: Confidence): boolean {
    const override = overrides.find(([pattern]) => matchesRuleId(pattern, ruleId));
    if (override) return override[1];
    if (pack.disable.some((pattern) => matchesRuleId(pattern, ruleId))) return false;
    if (!options.categories[category]) return false;
    if (!confidences.has(confidence)) return false;

    if (category === 'units' && !options.units.enabled) return false;
    if (category === 'dates' && !options.dates.enabled) return false;
    if (category === 'times' && !options.times.enabled) return false;
    if (category === 'currency' && !options.currency.enabled) return false;
    return true;
  }

  return {
    rule,
    entry(entry: LexEntry): boolean {
      if (keep.has(entry.from.toLowerCase())) return false;
      return rule(entry.ruleId, entry.category, entry.confidence);
    },
  };
}
