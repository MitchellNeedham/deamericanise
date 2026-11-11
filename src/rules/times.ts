import type { Change, Rule, RuleContext } from '../types.js';
import { MONTH_PATTERN } from './dates.js';

// The last stop of `P.M.` is matched and goes back only if it ends the sentence. A bare
// `PM.` leaves the sentence's stop outside the match.
const MERIDIEM = String.raw`(?:[ap]\.\s?m\.?|[ap]m)`;

const CLOSERS = /[)\]}"'’”»]*/y;

/** A line break that starts a new paragraph, list item or heading. */
const BREAK = String.raw`\n[^\S\n]*(?:\n|(?:[-*+]|\d+[.)]|#{1,6})[^\S\n])`;
const BLOCK_BREAK = new RegExp(BREAK, 'y');
const BLOCK_END = new RegExp(String.raw`\s*$|[^\S\n]*${BREAK}`, 'y');

const NEXT_WORD = /\s+[([{"'‘“«]*(\p{Lu}\p{L}*)/uy;

/** Capitalised words that carry a time on, as in `8 p.m. Eastern` or `3 p.m. Tuesday`. */
const CARRIES_ON = new RegExp(
  String.raw`^(?:Eastern|Central|Mountain|Pacific|Atlantic|Alaska|Hawaii|` +
    String.raw`Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|` +
    String.raw`Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|Sept|${MONTH_PATTERN})$`,
);

/**
 * Whether the stop just before `end` is also the sentence's full stop. It is when nothing
 * else ends the sentence: past any closing quotes or brackets, a new sentence starts, or
 * the text or block ends after words that could make one.
 *
 * A word in capitals is a time zone such as `ET`, or text set in capitals throughout, so
 * it does not count as a new sentence.
 */
function endsSentence(text: string, start: number, end: number): boolean {
  CLOSERS.lastIndex = end;
  CLOSERS.test(text);
  const from = CLOSERS.lastIndex;

  BLOCK_END.lastIndex = from;
  if (BLOCK_END.test(text)) return wordsBefore(text, start);

  NEXT_WORD.lastIndex = from;
  const next = NEXT_WORD.exec(text)?.[1];
  return next !== undefined && !/^\p{Lu}{2}/u.test(next) && !CARRIES_ON.test(next);
}

/** Whether the block holding `start` has a letter before it, so is more than a bare time. */
function wordsBefore(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const char = text[i]!;
    if (char === '\n') {
      BLOCK_BREAK.lastIndex = i;
      if (BLOCK_BREAK.test(text)) return false;
    } else if (/\p{L}/u.test(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Two separate habits. `P.M.` with capitals and full stops is an American house style,
 * and is normalised whenever times run at all. Moving to the 24-hour clock is a bigger
 * change, since 12-hour times are perfectly normal outside America too.
 */
export function timeRules(): Rule[] {
  const pattern = new RegExp(
    String.raw`(?<![\w:])(\d{1,2})(?::([0-5]\d))?(?::([0-5]\d))?\s*(${MERIDIEM})(?![A-Za-z])`,
    'gi',
  );

  const rule: Rule = {
    id: 'times.clock',
    category: 'times',
    confidence: 'moderate',
    priority: 40,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];
      pattern.lastIndex = 0;

      for (const match of ctx.text.matchAll(pattern)) {
        const hour12 = Number(match[1]);
        if (hour12 < 1 || hour12 > 12) continue;
        const minutes = match[2] ?? '00';
        const seconds = match[3];
        const isPm = /p/i.test(match[4]!);
        const start = match.index;
        const end = start + match[0].length;

        let after: string;
        if (ctx.options.times.to24Hour) {
          const hour = isPm ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12;
          after = `${String(hour).padStart(2, '0')}:${minutes}${seconds ? `:${seconds}` : ''}`;
        } else {
          const clock = `${hour12}:${minutes}${seconds ? `:${seconds}` : ''}`;
          after = `${match[2] ? clock : hour12}${isPm ? 'pm' : 'am'}`;
        }
        if (match[0].endsWith('.') && endsSentence(ctx.text, start, end)) after += '.';

        if (after === match[0]) continue;
        changes.push({
          start,
          end,
          before: match[0],
          after,
          ruleId: 'times.clock',
          category: 'times',
          confidence: 'moderate',
          priority: 40,
        });
      }
      return changes;
    },
  };

  return [rule];
}
