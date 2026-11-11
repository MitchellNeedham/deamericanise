import type { Change, Rule, RuleContext } from '../types.js';
import { CLOSING, endsSentence } from './sentence.js';

/**
 * Outside America the full stop marks a *truncation*, not an abbreviation. A contraction
 * that already ends in the last letter of the word it stands for drops the stop:
 * Mister -> Mr, Doctor -> Dr, Sergeant -> Sgt, Lieutenant -> Lt.
 *
 * Truncations keep it, so `Prof.` (Professor), `Rev.` (Reverend), `Capt.` (Captain),
 * `Gen.` (General), `Co.` and `No.` are correct everywhere and are not listed here.
 */
const CONTRACTIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Fr', 'Sgt', 'Lt', 'Ltd', 'Mme', 'Mlle'];

/**
 * Words that can open a sentence but never continue a name. A capital after an initialism
 * is more often the rest of a name, as in `the U.S. Army`, so only these start a new sentence.
 */
const OPENERS = [
  'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'There', 'Here',
  'I', 'It', 'Its', 'He', 'His', 'She', 'Her', 'We', 'Our', 'They', 'Their', 'You', 'Your', 'My',
  'Some', 'Many', 'Most', 'Each', 'Every', 'Both', 'No', 'Not', 'Never', 'Yes',
  'And', 'But', 'Or', 'So', 'Yet', 'If', 'When', 'While', 'Although', 'Though', 'Because',
  'As', 'Once', 'Unless', 'In', 'On', 'At', 'For', 'From', 'With', 'Without', 'By', 'After',
  'Before', 'Since', 'Until', 'During', 'Despite', 'What', 'Why', 'How', 'Who', 'Which', 'Where',
  'Then', 'Now', 'Later', 'However', 'Meanwhile', 'Instead', 'Also', 'Even',
];
// A word joined to a hyphen, digit or stop belongs to a name, as in `A-10`, `I-95` or `A.I.`.
const OPENER = new RegExp(String.raw`(?:${OPENERS.join('|')})(?![\p{L}\p{N}.‐‑-])`, 'uy');

function abbreviationRule(): Rule {
  const titles = new RegExp(String.raw`\b(${CONTRACTIONS.join('|')})\.(?=\s+[A-Z])`, 'g');
  const initialisms: Array<[RegExp, string]> = [
    [/\bU\.S\.A\./g, 'USA'],
    [new RegExp(String.raw`\bU\.S\.(?=\s|$|[,;:]|${CLOSING})`, 'g'), 'US'],
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
          const start = match.index;
          const end = start + match[0].length;
          changes.push({
            start,
            end,
            before: match[0],
            after: endsSentence(ctx.text, start, end, OPENER) ? `${replacement}.` : replacement,
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
