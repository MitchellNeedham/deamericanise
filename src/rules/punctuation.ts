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
export const CONTRACTIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Fr', 'Sgt', 'Lt', 'Ltd', 'Mme', 'Mlle'];

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
export const OPENER = new RegExp(String.raw`(?:${OPENERS.join('|')})(?![\p{L}\p{N}.‐‑-])`, 'uy');

/** Number words that can end a written time, as in `ten P.M.` or `ten forty-five P.M.`. */
const TIME_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty',
];

// `times.clock` outranks this rule, so a time in figures only reaches here when that rule is
// off or cannot read the hour.
const AFTER_TIME = new RegExp(
  String.raw`(?<=(?:(?<![\w:])\d{1,2}(?::[0-5]\d){0,2}|\b(?:${TIME_WORDS.join('|')}))\s*)` +
    String.raw`[AP]\.M\.(?![A-Za-z])`,
  'iy',
);

/**
 * After a time, `A.M.` and `P.M.` are the meridiem and take the lower case, as in `3 pm`.
 * Without one they stand for something else, as in a prime minister or AM radio, so they
 * keep their capitals.
 */
function meridiem(text: string, start: number): string {
  const letter = text[start]!;
  AFTER_TIME.lastIndex = start;
  return AFTER_TIME.test(text) ? `${letter.toLowerCase()}m` : `${letter}M`;
}

function abbreviationRule(): Rule {
  const titles = new RegExp(String.raw`\b(${CONTRACTIONS.join('|')})\.(?=\s+[A-Z])`, 'g');
  const initialisms: Array<[RegExp, string | ((text: string, start: number) => string)]> = [
    [/\bU\.S\.A\./g, 'USA'],
    [new RegExp(String.raw`\bU\.S\.(?=\s|$|[,;:]|${CLOSING})`, 'g'), 'US'],
    [/\bU\.K\./g, 'UK'],
    [/\bPh\.\s?D\./g, 'PhD'],
    [/\b[AP]\.M\./g, meridiem],
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
          const written = typeof replacement === 'string' ? replacement : replacement(ctx.text, start);
          changes.push({
            start,
            end,
            before: match[0],
            after: endsSentence(ctx.text, start, end, OPENER) ? `${written}.` : written,
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
  // Only the stop and the quote are rewritten, so a rule that rewrites the quotation's last
  // word applies too. A quote mark before a letter or digit is an apostrophe or opens a quote.
  const pattern = /(?<=[A-Za-z0-9)\]])([,.])(["'’”])(?![\p{L}\p{N}])/gu;

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
          after: `${match[2]}${match[1]}`,
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
