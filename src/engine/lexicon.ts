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

function toPattern(from: string): string {
  return from
    .split(WHITESPACE)
    .filter(Boolean)
    .map((word) => escape(word).replace(/'/g, "['’ʼ]"))
    .join('[\\s\\u00a0]+');
}

/**
 * Builds a single alternation over every entry, longest first so the longest phrase at a
 * given position wins. One pass beats several hundred individual regexes.
 */
export function compileLexicon(entries: LexEntry[]): CompiledLexicon {
  const byKey = new Map<string, LexEntry[]>();
  for (const entry of entries) {
    const key = normaliseKey(entry.from);
    const existing = byKey.get(key);
    if (existing) existing.push(entry);
    else byKey.set(key, [entry]);
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
      priority: entry.priority ?? 10,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }

  return undefined;
}
