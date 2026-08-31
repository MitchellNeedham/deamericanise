import { compileLexicon, type CompiledLexicon } from '../engine/lexicon.js';
import { dialectPack } from '../dialects/index.js';
import type { Dialect, LexEntry, ResolvedOptions, Rule } from '../types.js';
import { spellingEntries, suffixRules } from './spelling/index.js';
import { baseVocabulary } from './vocabulary.js';
import { unitRules } from './units/index.js';
import { dateRules } from './dates.js';
import { timeRules } from './times.js';
import { currencyRules } from './currency.js';
import { punctuationRules } from './punctuation.js';
import { miscRules } from './misc.js';
import { MEASURES } from './units/definitions.js';

const lexiconCache = new Map<Dialect, CompiledLexicon>();

export function lexiconFor(dialect: Dialect): CompiledLexicon {
  const cached = lexiconCache.get(dialect);
  if (cached) return cached;

  const pack = dialectPack(dialect);
  const entries: LexEntry[] = [...spellingEntries(), ...baseVocabulary(), ...pack.vocabulary];
  const compiled = compileLexicon(entries);
  lexiconCache.set(dialect, compiled);
  return compiled;
}

export function patternRules(options: ResolvedOptions): Rule[] {
  const pack = dialectPack(options.dialect);
  return [
    ...suffixRules,
    ...unitRules(options, pack.unitsKeep),
    ...dateRules(),
    ...timeRules(),
    ...currencyRules(),
    ...punctuationRules(),
    ...miscRules(),
  ];
}

/** Every rule id the package can emit, for documentation and for `--explain`. */
export function ruleIds(dialect: Dialect = 'en-AU'): string[] {
  const pack = dialectPack(dialect);
  const fromEntries = [...spellingEntries(), ...baseVocabulary(), ...pack.vocabulary].map((e) => e.ruleId);
  const fromRules = patternRules({
    dialect,
    unitsKeep: [],
    rules: {},
  } as unknown as ResolvedOptions).map((r) => r.id);
  const fromMeasures = MEASURES.map((m) => m.id);
  return [...new Set([...fromEntries, ...fromRules, ...fromMeasures, 'grammar.article-agreement'])].sort();
}
