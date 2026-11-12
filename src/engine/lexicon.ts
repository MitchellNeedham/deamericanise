import type { Change, LexEntry, RuleContext } from '../types.js';
import { matchCase } from './case.js';

const APOSTROPHES = /['’ʼ]/g;
const WHITESPACE = /[\s\u00a0]+/g;

export interface CompiledLexicon {
  regex: RegExp;
  byKey: Map<string, LexEntry[]>;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lowercase, single-space, straight apostrophes. Hyphens are kept, so `take-out` and
 * `take out` stay different entries rather than colliding on one key.
 */
export function normaliseKey(s: string): string {
  return s.toLowerCase().replace(APOSTROPHES, "'").replace(WHITESPACE, ' ').trim();
}

/** The pattern an entry's `from` matches as: any run of space between words, any apostrophe. */
export function toPattern(from: string): string {
  return from
    .split(WHITESPACE)
    .filter(Boolean)
    .map((word) => escape(word).replace(/'/g, "['’ʼ]"))
    .join('[\\s\\u00a0]+');
}

const DEFAULT_PRIORITY = 10;

interface Candidate {
  entry: LexEntry;
  layer: number;
}

/** Later layer first, then higher priority. Ties keep their listed order, as the sort is stable. */
function byPrecedence(a: Candidate, b: Candidate): number {
  return (
    b.layer - a.layer ||
    (b.entry.priority ?? DEFAULT_PRIORITY) - (a.entry.priority ?? DEFAULT_PRIORITY)
  );
}

/**
 * Builds a single alternation over every entry, longest first so the longest phrase at a
 * given position wins. One pass beats several hundred individual regexes.
 *
 * Each layer overrides the layers before it on the same key, so a dialect pack passed
 * after the shared lists wins wherever both have a row. Its rows are tried first, and an
 * earlier layer's row is the fallback when every later row is switched off or refused by
 * its context gate. Within a layer, a higher `priority` is tried first.
 */
export function compileLexicon(...layers: LexEntry[][]): CompiledLexicon {
  const grouped = new Map<string, Candidate[]>();
  layers.forEach((entries, layer) => {
    for (const entry of entries) {
      const key = normaliseKey(entry.from);
      const existing = grouped.get(key);
      if (existing) existing.push({ entry, layer });
      else grouped.set(key, [{ entry, layer }]);
    }
  });

  const byKey = new Map<string, LexEntry[]>();
  for (const [key, candidates] of grouped) {
    byKey.set(key, candidates.sort(byPrecedence).map(({ entry }) => entry));
  }

  const alternatives = [...byKey.keys()]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(toPattern);

  const regex = new RegExp(
    `(?<![A-Za-z0-9_])(?:${alternatives.join('|')})(?![A-Za-z0-9_])`,
    'gi',
  );

  return { regex, byKey };
}

/** How much surrounding text a contextual entry can inspect. */
const CONTEXT_WINDOW = 80;

function passesContext(entry: LexEntry, text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const after = text.slice(end, end + CONTEXT_WINDOW);
  if (entry.requireBefore && !entry.requireBefore.test(before)) return false;
  if (entry.requireAfter && !entry.requireAfter.test(after)) return false;
  if (entry.forbidBefore && entry.forbidBefore.test(before)) return false;
  if (entry.forbidAfter && entry.forbidAfter.test(after)) return false;
  if (entry.forbidMatch && entry.forbidMatch.test(text.slice(start, end))) return false;
  return true;
}

export function findLexiconMatches(
  ctx: RuleContext,
  lexicon: CompiledLexicon,
  isEnabled: (entry: LexEntry) => boolean,
): Change[] {
  const changes: Change[] = [];
  lexicon.regex.lastIndex = 0;

  for (const match of ctx.text.matchAll(lexicon.regex)) {
    const start = match.index;

    // The alternation takes the longest phrase at this position, but that phrase may
    // belong to a rule that is switched off. Fall back through shorter prefixes so a
    // disabled `license plate` cannot hide an enabled `license`.
    for (let raw = match[0]; raw.length > 0; ) {
      const change = firstApplicable(ctx, lexicon, isEnabled, raw, start);
      if (change) {
        changes.push(change);
        break;
      }
      const cut = raw.search(/[\s\u00a0][^\s\u00a0]*$/);
      if (cut <= 0) break;
      raw = raw.slice(0, cut);
    }
  }

  return changes;
}

function firstApplicable(
  ctx: RuleContext,
  lexicon: CompiledLexicon,
  isEnabled: (entry: LexEntry) => boolean,
  raw: string,
  start: number,
): Change | undefined {
  const candidates = lexicon.byKey.get(normaliseKey(raw));
  if (!candidates) return undefined;
  const end = start + raw.length;

  for (const entry of candidates) {
    if (!isEnabled(entry)) continue;
    if (entry.needsAmerican && !ctx.american) continue;
    if (!passesContext(entry, ctx.text, start, end)) continue;

    return {
      start,
      end,
      before: raw,
      after: matchCase(raw, entry.to),
      ruleId: entry.ruleId,
      category: entry.category,
      confidence: entry.confidence,
      priority: entry.priority ?? DEFAULT_PRIORITY,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }

  return undefined;
}
