import { CATEGORIES, CONFIDENCES, PRESETS, resolveOptions } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { DomOptions, Verdict } from '../../src/dom/index.js';
import { ruleCatalogue, type RuleInfo } from '../../src/rules/catalogue.js';
import type {
  Category,
  Confidence,
  DateOptions,
  Dialect,
  Precision,
  Preset,
  TimeOptions,
  UnitOptions,
} from '../../src/types.js';
import { api } from './browser.js';

export type UnitSettings = Pick<UnitOptions, 'keepOriginal' | 'precision' | 'fuelEconomy'>;
export type DateSettings = Pick<DateOptions, 'format' | 'reorderLongDates'>;
export type TimeSettings = Pick<TimeOptions, 'to24Hour'>;

export interface Settings {
  dialect: Dialect;
  preset: Preset;
  /** Categories switched on or off by hand. Each one beats the mode. */
  categories: Partial<Record<Category, boolean>>;
  /** Options changed by hand. The rest take the package's default for the mode. */
  units: UnitSettings;
  dates: DateSettings;
  times: TimeSettings;
  confidence: Confidence[];
  verdict: Verdict;
  highlight: boolean;
  /** Rules switched on or off by hand. Each one differs from the dialect's default. */
  rules: Record<string, boolean>;
  /** Hostnames the extension leaves alone. */
  disabledSites: string[];
}

export const VERDICTS: Verdict[] = ['detect', 'lang', 'american'];
export const PRECISIONS: Precision[] = ['natural', 'exact', 0, 1, 2];
export const FUEL_ECONOMY: NonNullable<UnitOptions['fuelEconomy']>[] = ['l-per-100km', 'km-per-l'];
export const DATE_FORMATS: NonNullable<DateOptions['format']>[] = ['iso', 'dmy', 'long'];

export const DEFAULTS: Settings = {
  dialect: 'en-AU',
  preset: 'read',
  categories: {},
  units: {},
  dates: {},
  times: {},
  confidence: [...CONFIDENCES],
  verdict: 'detect',
  highlight: false,
  rules: {},
  disabledSites: [],
};

/** Anything stored by an older version, or edited by hand, falls back to the default. */
function clean(stored: Record<string, unknown>): Settings {
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const switches = (value: unknown): [string, boolean][] =>
    Object.entries(record(value)).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    );
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  /** Keeps only the fields that hold an allowed value. */
  const fields = <T extends object>(value: unknown, allowed: { [K in keyof T]: readonly T[K][] }): T => {
    const stored = record(value);
    return Object.fromEntries(
      Object.entries(allowed as Record<string, readonly unknown[]>)
        .filter(([key, values]) => values.includes(stored[key]))
        .map(([key]) => [key, stored[key]]),
    ) as T;
  };
  const BOOLEAN = [true, false];

  const confidence = list(stored.confidence).filter((c): c is Confidence =>
    CONFIDENCES.includes(c as Confidence),
  );
  return {
    dialect: pick(stored.dialect, Object.keys(DIALECTS) as Dialect[], DEFAULTS.dialect),
    preset: pick(stored.preset, PRESETS, DEFAULTS.preset),
    categories: Object.fromEntries(
      switches(stored.categories).filter(([c]) => CATEGORIES.includes(c as Category)),
    ),
    units: fields<UnitSettings>(stored.units, {
      keepOriginal: BOOLEAN,
      precision: PRECISIONS,
      fuelEconomy: FUEL_ECONOMY,
    }),
    dates: fields<DateSettings>(stored.dates, { format: DATE_FORMATS, reorderLongDates: BOOLEAN }),
    times: fields<TimeSettings>(stored.times, { to24Hour: BOOLEAN }),
    confidence: confidence.length > 0 ? confidence : DEFAULTS.confidence,
    verdict: pick(stored.verdict, VERDICTS, DEFAULTS.verdict),
    highlight: flag(stored.highlight, DEFAULTS.highlight),
    rules: Object.fromEntries(switches(stored.rules)),
    disabledSites: list(stored.disabledSites).filter((s): s is string => typeof s === 'string'),
  };
}

export async function loadSettings(): Promise<Settings> {
  return clean(await api.storage.sync.get(null));
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  await api.storage.sync.set(changes);
}

const catalogues = new Map<Dialect, Map<string, RuleInfo>>();

/** Every rule in a dialect, by id. */
export function catalogue(dialect: Dialect): Map<string, RuleInfo> {
  let rules = catalogues.get(dialect);
  if (!rules) catalogues.set(dialect, (rules = new Map(ruleCatalogue(dialect).map((r) => [r.id, r]))));
  return rules;
}

/** Whether a rule runs when nothing has switched it, in the settings' dialect. */
export function ruleOnByDefault(settings: Settings, ruleId: string): boolean {
  return catalogue(settings.dialect).get(ruleId)?.offByDefault !== true;
}

/** The rule switches with one rule set, keeping only the switches that differ from its default. */
export function withRule(settings: Settings, ruleId: string, on: boolean): Record<string, boolean> {
  const rules = { ...settings.rules };
  if (on === ruleOnByDefault(settings, ruleId)) delete rules[ruleId];
  else rules[ruleId] = on;
  return rules;
}

export async function switchOffRule(ruleId: string): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({ rules: withRule(settings, ruleId, false) });
}

/** The categories in effect: the mode's, with the ones switched by hand. */
export function categoriesOn(settings: Settings): Record<Category, boolean> {
  return resolveOptions({ preset: settings.preset, categories: settings.categories }).categories;
}

/**
 * The package lets a rule switched on beat a category or tier that is off. Here the
 * category and tier switches win, so those rules are left out.
 */
function runnableRules(settings: Settings): Record<string, boolean> {
  const on = Object.keys(settings.rules).filter((id) => settings.rules[id] === true);
  if (on.length === 0) return settings.rules;

  const rules = { ...settings.rules };
  const categories = categoriesOn(settings);
  for (const id of on) {
    const rule = catalogue(settings.dialect).get(id);
    const runs =
      rule !== undefined &&
      categories[rule.category] &&
      rule.confidence.some((c) => settings.confidence.includes(c));
    if (!runs) delete rules[id];
  }
  return rules;
}

export function domOptions(settings: Settings): DomOptions {
  return {
    dialect: settings.dialect,
    preset: settings.preset,
    categories: settings.categories,
    confidence: settings.confidence,
    units: settings.units,
    dates: settings.dates,
    times: settings.times,
    verdict: settings.verdict,
    rules: runnableRules(settings),
  };
}

export function isEnabledOn(settings: Settings, host: string): boolean {
  return !settings.disabledSites.includes(host);
}

/** Asks the content script in a tab how it is doing. */
export interface StatusRequest {
  type: 'status';
}

export interface Status {
  host: string;
  enabled: boolean;
  changes: number;
}
