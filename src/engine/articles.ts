import type { Category, Change } from '../types.js';
import type { Range } from './apply.js';

/** Written with an h but said with a vowel. */
const SILENT_H = /^(?:hour|honest|honou?r|heir)/;
/** Written with a vowel but said with a consonant. */
const YOD = /^(?:uni|use|user|using|usual|utili|euro|eulog|ubiqu|one|once|ewe)/;

/** A currency sign and the letters that name its country, as in `US$` or `€`. */
const CURRENCY = /^[A-Z]{0,3}\p{Sc}\s*/u;

/** A group of up to three digits said with a vowel: one led by 8, or 11 or 18. */
function saidWithVowel(group: string): boolean {
  return group.startsWith('8') || group === '11' || group === '18';
}

/**
 * Whether a leading number is said with a vowel, or undefined when the usual readings
 * disagree. A figure is said in groups of three digits, so `800`, `8.5`, `11,000` and
 * `18 million` start with a vowel and `1.8`, `100` and `110,000` do not.
 *
 * A date's day drops its leading zero and a four-digit year is said in pairs, so
 * `08/03/2024` and `1812-03-14` start with a vowel. A clock time keeps the zero,
 * which is `oh` to some readers and silent to others, so only `08:00` is settled.
 * `1800` is `one thousand eight hundred` or `eighteen hundred`, so it is unsettled.
 */
function numberNeedsAn(text: string, category: Category): boolean | undefined {
  const digits = (/^\d[\d,]*/.exec(text)?.[0] ?? '').replace(/,/g, '');

  if (category === 'times' && digits.startsWith('0')) return digits === '08' ? true : undefined;
  if (category === 'dates') {
    const figure = digits.replace(/^0+/, '');
    return saidWithVowel(figure.length === 4 ? figure.slice(0, 2) : figure);
  }

  // Zero, nought and point all start with a consonant.
  if (digits === '' || digits.startsWith('0')) return false;
  if (/^1[18]\d\d$/.test(digits)) return undefined;
  return saidWithVowel(digits.slice(0, ((digits.length - 1) % 3) + 1));
}

/**
 * Whether a replacement takes `an`, or undefined when that cannot be told. A currency
 * sign is said after its amount, so `US$8` is read from the `8`.
 */
function needsAn(word: string, category: Category): boolean | undefined {
  const spoken = word.replace(CURRENCY, '');
  // Said minus or plus.
  if (/^[-−+]/.test(spoken)) return false;
  if (/^\.?\d/.test(spoken)) return numberNeedsAn(spoken, category);
  if (!/^[A-Za-z]/.test(spoken)) return undefined;

  const stem = word.toLowerCase().replace(/^[^a-z]+/, '');
  if (SILENT_H.test(stem)) return true;
  if (YOD.test(stem)) return false;
  return /^[aeiou]/.test(stem);
}

function matchCase(source: string, replacement: string, beside: string): string {
  // A lone `A` is a capital or part of text in capitals, and only the text it qualifies tells.
  const capitals =
    source.length > 1
      ? source === source.toUpperCase()
      : source === 'A' && /\p{L}/u.test(beside) && beside === beside.toUpperCase();
  if (capitals) return replacement.toUpperCase();
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
    const before = text.slice(Math.max(0, change.start - 24), change.start);
    const match = before.match(ARTICLE);
    if (!match) continue;

    const an = needsAn(change.after, change.category);
    if (an === undefined) continue;
    const wanted = an ? 'an' : 'a';
    if (wanted === match[1]!.toLowerCase()) continue;

    const start = change.start - match[0].length;
    const end = start + match[1]!.length;
    if (taken.some((c) => c.start < end && start < c.end)) continue;

    extra.push({
      start,
      end,
      before: match[1]!,
      after: matchCase(match[1]!, wanted, change.before),
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
