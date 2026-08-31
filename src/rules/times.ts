import type { Change, Rule, RuleContext } from '../types.js';

// `P.M.` keeps its stops; a bare `PM.` at the end of a sentence keeps the sentence's.
const MERIDIEM = String.raw`(?:[ap]\.\s?m\.?|[ap]m)`;

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

        let after: string;
        if (ctx.options.times.to24Hour) {
          const hour = isPm ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12;
          after = `${String(hour).padStart(2, '0')}:${minutes}${seconds ? `:${seconds}` : ''}`;
        } else {
          const clock = `${hour12}:${minutes}${seconds ? `:${seconds}` : ''}`;
          after = `${match[2] ? clock : hour12}${isPm ? 'pm' : 'am'}`;
        }

        if (after === match[0]) continue;
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
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
