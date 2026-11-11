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

const ruleCache = new Map<string, Rule[]>();

export function patternRules(options: ResolvedOptions): Rule[] {
  // Only these options shape the rules themselves. Everything else is read at match time.
  const key = JSON.stringify([options.dialect, options.unitsKeep, options.rules]);
  const cached = ruleCache.get(key);
  if (cached) return cached;

  const pack = dialectPack(options.dialect);
  const rules = [
    ...suffixRules,
    ...unitRules(options, pack.unitsKeep),
    ...dateRules(),
    ...timeRules(),
    ...currencyRules(),
    ...punctuationRules(),
    ...miscRules(),
  ];
  // A caller toggling single rules makes a new key each time, so the cache is bounded.
  if (ruleCache.size >= 32) ruleCache.clear();
  ruleCache.set(key, rules);
  return rules;
}
