import { CATEGORIES, CONFIDENCES, PRESETS, resolveOptions } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { DomOptions, Verdict } from '../../src/dom/index.js';
import { ruleCatalogue, type RuleInfo } from '../../src/rules/catalogue.js';
import type {
  Category,
  Confidence,
  DateOptions,
  Dialect,
  Options,
  Precision,
  Preset,
  TimeOptions,
  UnitOptions,
} from '../../src/types.js';
import { api } from './browser.js';

export type UnitSettings = Pick<
  UnitOptions,
  'keepOriginal' | 'precision' | 'fuelEconomy' | 'respectConventions'
>;
export type DateSettings = Pick<DateOptions, 'format' | 'reorderLongDates'>;
export type TimeSettings = Pick<TimeOptions, 'to24Hour'>;

/** What one site has set for itself. Each site is stored under its own key, `site:<hostname>`. */
export interface SiteSettings {
  /** False when the extension leaves the site alone. */
  enabled?: boolean;
}

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
  /** Mark what would change in text the reader is writing, and offer each change. */
  suggest: boolean;
  /** Rules switched on or off by hand. Each one differs from the dialect's default. */
  rules: Record<string, boolean>;
  /** Settings of each site that has any, by hostname. */
  sites: Record<string, SiteSettings>;
}

/** The settings stored under keys of their own, as `saveSettings` takes them. */
export type SettingsChanges = Partial<Omit<Settings, 'sites'>>;

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
  suggest: true,
  rules: {},
  sites: {},
};

const SITE = 'site:';
/** The single list of sites switched off that older versions kept. */
const OLD_SITES = 'disabledSites';

/**
 * The most sites with a key of their own. Browsers allow 512 items in `storage.sync`, and the
 * rest are kept for the settings' own keys.
 */
export const MAX_SITES = 480;

const siteKey = (host: string): string => SITE + host;
const isSiteKey = (key: string): boolean => key.startsWith(SITE);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const hostList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];

/** Anything stored by an older version, or edited by hand, falls back to the default. */
function clean(stored: Record<string, unknown>): Settings {
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
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

  // Hostnames come from pages, so `__proto__` must stay an ordinary key.
  const sites: Record<string, SiteSettings> = Object.create(null);
  for (const [key, value] of Object.entries(stored)) {
    if (!isSiteKey(key)) continue;
    const site = fields<SiteSettings>(value, { enabled: BOOLEAN });
    if (Object.keys(site).length > 0) sites[key.slice(SITE.length)] = site;
  }
  for (const host of hostList(stored[OLD_SITES])) sites[host] = { ...sites[host], enabled: false };

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
      respectConventions: BOOLEAN,
    }),
    dates: fields<DateSettings>(stored.dates, { format: DATE_FORMATS, reorderLongDates: BOOLEAN }),
    times: fields<TimeSettings>(stored.times, { to24Hour: BOOLEAN }),
    confidence: confidence.length > 0 ? confidence : DEFAULTS.confidence,
    verdict: pick(stored.verdict, VERDICTS, DEFAULTS.verdict),
    highlight: flag(stored.highlight, DEFAULTS.highlight),
    suggest: flag(stored.suggest, DEFAULTS.suggest),
    rules: Object.fromEntries(switches(stored.rules)),
    sites,
  };
}

export async function loadSettings(): Promise<Settings> {
  return clean(await api.storage.sync.get(null));
}

/** Stores settings. Rejects with the browser's error when storage refuses them. */
export async function saveSettings(changes: SettingsChanges): Promise<void> {
  await api.storage.sync.set(changes);
}

/** Thrown by `saveSite` when `MAX_SITES` sites already have a key of their own. */
export class SitesFullError extends Error {
  constructor() {
    super(`${MAX_SITES} sites already have settings of their own.`);
    this.name = 'SitesFullError';
  }
}

/**
 * Changes one site's settings. A field set to `undefined` is cleared, and a site left with
 * nothing set loses its key. Fields this version does not know are kept. Rejects with the
 * browser's error, or with `SitesFullError`, when the change cannot be stored.
 */
export async function saveSite(host: string, changes: SiteSettings): Promise<void> {
  const key = siteKey(host);
  const stored = await api.storage.sync.get(null);
  const site = { ...record(stored[key]) };
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) delete site[field];
    else site[field] = value;
  }

  const old = hostList(stored[OLD_SITES]);
  if (site.enabled !== false && old.includes(host)) {
    await api.storage.sync.set({ [OLD_SITES]: old.filter((h) => h !== host) });
  }
  if (Object.keys(site).length === 0) {
    if (key in stored) await api.storage.sync.remove(key);
    return;
  }
  if (!(key in stored) && Object.keys(stored).filter(isSiteKey).length >= MAX_SITES) {
    throw new SitesFullError();
  }
  await api.storage.sync.set({ [key]: site });
}

/**
 * Moves the sites in the list older versions kept to keys of their own, in one write that
 * also empties the list. Once it has run there is nothing left to move, and two browsers
 * running it at once write the same values. When the sites would not fit under `MAX_SITES` it
 * does nothing, and `loadSettings` goes on reading the list.
 */
export async function migrateSites(): Promise<void> {
  const stored = await api.storage.sync.get(null);
  const old = hostList(stored[OLD_SITES]);
  if (old.length === 0) return;

  const writes: Record<string, unknown> = { [OLD_SITES]: [] };
  for (const host of old) writes[siteKey(host)] = { ...record(stored[siteKey(host)]), enabled: false };
  const keys = new Set([...Object.keys(stored), ...Object.keys(writes)].filter(isSiteKey));
  if (keys.size > MAX_SITES) return;
  await api.storage.sync.set(writes);
}

/** Whether a change in storage can alter the settings of a page on `host`. */
export function affectsHost(changes: Record<string, unknown>, host: string): boolean {
  return Object.keys(changes).some((key) => !isSiteKey(key) || key === siteKey(host));
}

/** A sentence for the reader saying why a change was not stored. */
export function failureMessage(error: unknown): string {
  if (error instanceof SitesFullError) {
    return `Not saved: synced settings have room for ${MAX_SITES} sites switched off. Switch one back on in Settings to make room.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/WRITE_OPERATIONS/.test(message)) {
    return 'Not saved: there were too many changes in the last minute. Try again shortly.';
  }
  if (/quota/i.test(message)) {
    return 'Not saved: synced storage is full. Switch a site back on in Settings to make room.';
  }
  return `Not saved: ${message}`;
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

/**
 * The options for suggestions in text the reader is writing. It is always read as American,
 * but a bare $ there is the writer's own currency, so currency is left alone, along with any
 * currency rule switched on by hand.
 */
export function writingOptions(settings: Settings): Options {
  const categories = { ...settings.categories, currency: false };
  const { verdict, ...options } = domOptions({ ...settings, categories });
  return { ...options, assumeAmerican: true };
}

export function isEnabledOn(settings: Settings, host: string): boolean {
  return settings.sites[host]?.enabled !== false;
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
