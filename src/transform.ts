import { applyChanges, resolveChanges, type Range } from './engine/apply.js';
import { articleAgreements } from './engine/articles.js';
import { detectAmerican } from './engine/detect.js';
import { findLexiconMatches } from './engine/lexicon.js';
import { protectedRanges } from './engine/protect.js';
import { buildGate, resolveOptions } from './config.js';
import { lexiconFor, patternRules } from './rules/index.js';
import type { AmericanSignals, Change, Options, ResolvedOptions, Result, RuleContext } from './types.js';

export interface TransformInput {
  text: string;
  options: ResolvedOptions;
  /** Detected once for the whole document, then shared by every segment of it. */
  signals: AmericanSignals;
  /** Ranges no change may overlap, such as a newline that stands for a comment marker. */
  boundaries?: Range[];
}

/** Finds every change for one span of prose. Segments of a source file share a document verdict. */
export function findChanges({ text, options, signals, boundaries = [] }: TransformInput): Change[] {
  const gate = buildGate(options);
  const american = options.assumeAmerican ?? signals.confidence >= options.minAmericanConfidence;
  const ctx: RuleContext = { text, options, signals, american };

  const candidates: Change[] = [
    ...findLexiconMatches(ctx, lexiconFor(options.dialect), (entry) => gate.entry(entry)),
  ];

  for (const rule of patternRules(options)) {
    if (!gate.rule(rule.id, rule.category, rule.confidence)) continue;
    // A rule can emit changes under finer ids than its own, such as one per unit, so
    // the change's own id is what `rules` and the confidence tiers are checked against.
    for (const change of rule.find(ctx)) {
      if (gate.rule(change.ruleId, change.category, change.confidence)) candidates.push(change);
    }
  }

  const ranges = protectedRanges(text, {
    properNouns: options.protectProperNouns,
    identifiers: options.protectIdentifiers,
    commentedCode: options.protectCommentedCode,
    commentMarkers: options.commentMarkers,
    syntax: options.syntax,
    parsed: options.parsed,
    extra: options.protect,
  });
  ranges.push(...boundaries);

  const changes = resolveChanges(candidates, ranges);
  return [...changes, ...articleAgreements(text, changes)].sort((a, b) => a.start - b.start);
}

/** Rewrites a piece of prose. Use `deamericaniseCode` for source files. */
export function deamericanise(text: string, options: Options = {}): Result {
  return transformProse(text, resolveOptions(options));
}

/** `deamericanise` for options already resolved, which can carry what only a caller knows. */
export function transformProse(text: string, resolved: ResolvedOptions, boundaries: Range[] = []): Result {
  const signals =
    resolved.assumeAmerican === undefined
      ? detectAmerican(text)
      : { ...detectAmerican(text), confidence: resolved.assumeAmerican ? 1 : 0 };

  const changes = findChanges({ text, options: resolved, signals, boundaries });
  return { text: applyChanges(text, changes), changes, signals };
}

/** The same thing when all you want back is the string. */
export function deamericaniseText(text: string, options: Options = {}): string {
  return deamericanise(text, options).text;
}

/** Reports how American the input looks without changing it. */
export function analyse(text: string): AmericanSignals {
  return detectAmerican(text);
}
