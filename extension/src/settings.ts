import { CONFIDENCES, PRESETS } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { DomOptions, Verdict } from '../../src/dom/index.js';
import type { Confidence, Dialect, Preset } from '../../src/types.js';
import { api } from './browser.js';

export interface Settings {
  dialect: Dialect;
  preset: Preset;
  confidence: Confidence[];
  verdict: Verdict;
  highlight: boolean;
  /** Hostnames the extension leaves alone. */
  disabledSites: string[];
}

export const VERDICTS: Verdict[] = ['detect', 'lang', 'american'];

export const DEFAULTS: Settings = {
  dialect: 'en-AU',
  preset: 'read',
  confidence: [...CONFIDENCES],
  verdict: 'detect',
  highlight: false,
  disabledSites: [],
};

/** Anything stored by an older version, or edited by hand, falls back to the default. */
function clean(stored: Record<string, unknown>): Settings {
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const confidence = list(stored.confidence).filter((c): c is Confidence =>
    CONFIDENCES.includes(c as Confidence),
  );
  return {
    dialect: pick(stored.dialect, Object.keys(DIALECTS) as Dialect[], DEFAULTS.dialect),
    preset: pick(stored.preset, PRESETS, DEFAULTS.preset),
    confidence: confidence.length > 0 ? confidence : DEFAULTS.confidence,
    verdict: pick(stored.verdict, VERDICTS, DEFAULTS.verdict),
    highlight: typeof stored.highlight === 'boolean' ? stored.highlight : DEFAULTS.highlight,
    disabledSites: list(stored.disabledSites).filter((s): s is string => typeof s === 'string'),
  };
}

export async function loadSettings(): Promise<Settings> {
  return clean(await api.storage.sync.get(null));
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  await api.storage.sync.set(changes);
}

export function domOptions(settings: Settings): DomOptions {
  return {
    dialect: settings.dialect,
    preset: settings.preset,
    confidence: settings.confidence,
    verdict: settings.verdict,
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
