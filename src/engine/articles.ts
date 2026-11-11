import type { Change } from '../types.js';
import type { Range } from './apply.js';

/** Written with an h but said with a vowel. */
const SILENT_H = /^(?:hour|honest|honou?r|heir)/;
/** Written with a vowel but said with a consonant. */
const YOD = /^(?:uni|use|user|using|usual|utili|euro|eulog|ubiqu|one|once|ewe)/;

function needsAn(word: string): boolean {
  const stem = word.toLowerCase().replace(/^[^a-z]+/, '');
  if (SILENT_H.test(stem)) return true;
  if (YOD.test(stem)) return false;
  return /^[aeiou]/.test(stem);
}

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

const ARTICLE = /\b(a|an)(\s+)$/i;

/** Every article fix carries these. */
export const ARTICLE_AGREEMENT = {
  ruleId: 'grammar.article-agreement',
  category: 'punctuation',
  confidence: 'safe',
} as const satisfies Pick<Change, 'ruleId' | 'category' | 'confidence'>;

/**
 * `an eraser` becomes `a rubber`, not `an rubber`. Runs after the main changes are
 * settled, so it only ever sees replacements that are actually going to happen.
 */
export function articleAgreements(text: string, changes: Change[]): Change[] {
  const extra: Change[] = [];
  const taken: Range[] = changes;

  for (const change of changes) {
    // Only words take an article; a converted measurement starts with a digit.
    if (!/^[A-Za-z]/.test(change.after)) continue;

    const before = text.slice(Math.max(0, change.start - 24), change.start);
    const match = before.match(ARTICLE);
    if (!match) continue;

    const wanted = needsAn(change.after) ? 'an' : 'a';
    if (wanted === match[1]!.toLowerCase()) continue;

    const start = change.start - match[0].length;
    const end = start + match[1]!.length;
    if (taken.some((c) => c.start < end && start < c.end)) continue;

    extra.push({
      start,
      end,
      before: match[1]!,
      after: matchCase(match[1]!, wanted),
      ...ARTICLE_AGREEMENT,
      priority: 50,
      note: `the replacement starts with a ${wanted === 'an' ? 'vowel' : 'consonant'} sound`,
      agreesWith: { start: change.start, end: change.end },
    });
  }

  return extra;
}

/** True when `article` is the fix that agrees with `change`. */
export function agreesWith(article: Change, change: Change): boolean {
  return article.agreesWith?.start === change.start && article.agreesWith.end === change.end;
}
