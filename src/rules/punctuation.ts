import type { Change, Rule, RuleContext } from '../types.js';

/**
 * Outside America the full stop marks a *truncation*, not an abbreviation. A contraction
 * that already ends in the last letter of the word it stands for drops the stop:
 * Mister -> Mr, Doctor -> Dr, Sergeant -> Sgt, Lieutenant -> Lt.
 *
 * Truncations keep it, so `Prof.` (Professor), `Rev.` (Reverend), `Capt.` (Captain),
 * `Gen.` (General), `Co.` and `No.` are correct everywhere and are not listed here.
 */
const CONTRACTIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Fr', 'Sgt', 'Lt', 'Ltd', 'Mme', 'Mlle'];

function abbreviationRule(): Rule {
  const titles = new RegExp(String.raw`\b(${CONTRACTIONS.join('|')})\.(?=\s+[A-Z])`, 'g');
  const initialisms: Array<[RegExp, string]> = [
    [/\bU\.S\.A\./g, 'USA'],
    [/\bU\.S\.(?=\s|$|[,;:)])/g, 'US'],
    [/\bU\.K\./g, 'UK'],
    [/\bPh\.\s?D\./g, 'PhD'],
    [/\bA\.M\./g, 'am'],
    [/\bP\.M\./g, 'pm'],
  ];

  return {
    id: 'punctuation.abbreviations',
    category: 'punctuation',
    confidence: 'safe',
    priority: 15,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];

      for (const match of ctx.text.matchAll(titles)) {
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: match[1]!,
          ruleId: 'punctuation.abbreviations',
          category: 'punctuation',
          confidence: 'safe',
          priority: 15,
          note: 'a contraction ending in its own last letter takes no full stop',
        });
      }

      for (const [pattern, replacement] of initialisms) {
        for (const match of ctx.text.matchAll(pattern)) {
          changes.push({
            start: match.index,
            end: match.index + match[0].length,
            before: match[0],
            after: replacement,
            ruleId: 'punctuation.abbreviations',
            category: 'punctuation',
            confidence: 'safe',
            priority: 15,
          });
        }
      }

      return changes;
    },
  };
}

/**
 * American typesetting tucks a comma or full stop inside the closing quote even when it
 * is not part of the quotation. Logical quoting puts it where it belongs.
 */
function quotationRule(): Rule {
  const pattern = /([A-Za-z0-9)\]])([,.])(["'’”])/g;

  return {
    id: 'punctuation.logical-quotes',
    category: 'punctuation',
    confidence: 'risky',
    priority: 15,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];
      for (const match of ctx.text.matchAll(pattern)) {
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: `${match[1]}${match[3]}${match[2]}`,
          ruleId: 'punctuation.logical-quotes',
          category: 'punctuation',
          confidence: 'risky',
          priority: 15,
          note: 'punctuation that is not part of the quotation sits outside it',
        });
      }
      return changes;
    },
  };
}

export function punctuationRules(): Rule[] {
  return [abbreviationRule(), quotationRule()];
}
