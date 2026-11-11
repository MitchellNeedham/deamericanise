import { CATEGORIES, CONFIDENCES, PRESETS } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { DomOptions, Verdict } from '../../src/dom/index.js';
import type { Category, Confidence, Dialect, Preset } from '../../src/types.js';
import { api } from './browser.js';

export interface Settings {
  dialect: Dialect;
  preset: Preset;
  /** Categories switched on or off by hand. Each one beats the mode. */
  categories: Partial<Record<Category, boolean>>;
  confidence: Confidence[];
  /** Writes `1.8 metres (6 feet)`. */
  keepOriginalUnits: boolean;
  verdict: Verdict;
  highlight: boolean;
  /** Rule ids switched off by hand, as `false`. */
  rules: Record<string, boolean>;
  /** Hostnames the extension leaves alone. */
  disabledSites: string[];
}

export const VERDICTS: Verdict[] = ['detect', 'lang', 'american'];

export const DEFAULTS: Settings = {
  dialect: 'en-AU',
  preset: 'read',
  categories: {},
  confidence: [...CONFIDENCES],
  keepOriginalUnits: false,
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
  const switches = (value: unknown): [string, boolean][] =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
      : [];
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  const confidence = list(stored.confidence).filter((c): c is Confidence =>
    CONFIDENCES.includes(c as Confidence),
  );
  return {
    dialect: pick(stored.dialect, Object.keys(DIALECTS) as Dialect[], DEFAULTS.dialect),
    preset: pick(stored.preset, PRESETS, DEFAULTS.preset),
    categories: Object.fromEntries(
      switches(stored.categories).filter(([c]) => CATEGORIES.includes(c as Category)),
    ),
    confidence: confidence.length > 0 ? confidence : DEFAULTS.confidence,
    keepOriginalUnits: flag(stored.keepOriginalUnits, DEFAULTS.keepOriginalUnits),
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

export async function switchOffRule(ruleId: string): Promise<void> {
  const { rules } = await loadSettings();
  await saveSettings({ rules: { ...rules, [ruleId]: false } });
}

export function domOptions(settings: Settings): DomOptions {
  return {
    dialect: settings.dialect,
    preset: settings.preset,
    categories: settings.categories,
    confidence: settings.confidence,
    units: { keepOriginal: settings.keepOriginalUnits },
    verdict: settings.verdict,
    rules: settings.rules,
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
