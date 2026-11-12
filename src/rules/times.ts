import type { Change, Rule, RuleContext } from '../types.js';
import { FIGURE_DATE, MONTH_PATTERN } from './dates.js';
import { stopStays } from './sentence.js';

// The last stop of `P.M.` is matched and goes back only if it ends the sentence or opens an
// ellipsis. A bare `PM.` leaves the sentence's stop outside the match.
const MERIDIEM = String.raw`(?:[ap]\.\s?m\.?|[ap]m)`;

/**
 * Any capitalised word after a time starts a new sentence, except one that carries the time
 * on, as in `8 p.m. Eastern` or `3 p.m. Tuesday`. A date carries it on whichever way round it
 * is written, as in `3 p.m. December 1` and `3 p.m. 1 December`.
 */
export const OPENER = new RegExp(
  String.raw`(?!(?:Eastern|Central|Mountain|Pacific|Atlantic|Alaska|Hawaii|` +
    String.raw`Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|` +
    String.raw`Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|Sept|${MONTH_PATTERN})(?!\p{L})|${FIGURE_DATE})`,
  'uy',
);

/**
 * A time the clock rule rewrites, up to the last stop of a dotted meridiem as in `6 p.m.`:
 * the stops `OPENER` decides. Spelt out in both cases, so it reads alike with or without `i`.
 */
export const DOTTED_TIME = String.raw`(?<![\w:])(?:0?[1-9]|1[0-2])(?::[0-5]\d){0,2}\s*[aApP]\.\s?[mM]\.`;

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
        if (match[0].endsWith('.') && stopStays(ctx.text, start, end, OPENER)) after += '.';

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
