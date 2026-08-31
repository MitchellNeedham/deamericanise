import type { Change, Rule, RuleContext } from '../types.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_PATTERN = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `24` means 2024, `98` means 1998. */
function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function formatDate(
  year: number,
  month: number,
  day: number,
  format: 'iso' | 'dmy' | 'long',
): string {
  if (format === 'iso') return `${year}-${pad(month)}-${pad(day)}`;
  if (format === 'dmy') return `${pad(day)}/${pad(month)}/${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Whether an ambiguous date in this document should be read month-first.
 *
 * A document writes its dates one way round. So a sibling date that states its own order,
 * whether by a day above 12 or by a named month, settles the question on its own and
 * outranks the general American-ness score in both directions.
 */
function readsMonthFirst(ctx: RuleContext): boolean {
  const s = ctx.signals;
  // A numeric sibling is the only direct evidence, so it outranks everything.
  if (s.unambiguousMonthFirstDates > 0 && s.unambiguousDayFirstDates === 0) return true;
  if (s.unambiguousDayFirstDates > 0 && s.unambiguousMonthFirstDates === 0) return false;
  // Failing that, how the prose writes its named dates is a fair guide.
  if (s.namedMonthFirstDates > 0 && s.namedDayFirstDates === 0) return true;
  if (s.namedDayFirstDates > 0 && s.namedMonthFirstDates === 0) return false;
  return ctx.american;
}

function ambiguousNote(ctx: RuleContext): string {
  const s = ctx.signals;
  if (s.unambiguousMonthFirstDates > 0 && s.unambiguousDayFirstDates === 0) {
    return 'read as month-first because another numeric date in this text is month-first';
  }
  if (s.namedMonthFirstDates > 0 && s.namedDayFirstDates === 0) {
    return 'read as month-first because this text writes its named dates month-first';
  }
  return `read as month-first because the surrounding text looks American (confidence ${ctx.signals.confidence.toFixed(2)})`;
}

/**
 * `3/14/2024` is unambiguous: no month is 14. `03/04/2024` is not, so it waits for
 * evidence.
 */
function numericDateRule(): Rule {
  // The trailing guard is only `(?!\d)`; a full stop after `03/04/2024.` ends a sentence.
  // A longer run such as `1/2/3/4` is rejected below by looking for a repeated separator.
  const pattern = /(?<![\w/\-.])(\d{1,2})([/\-.])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/g;

  return {
    id: 'dates.numeric',
    category: 'dates',
    confidence: 'moderate',
    priority: 45,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];
      pattern.lastIndex = 0;

      for (const match of ctx.text.matchAll(pattern)) {
        const end = match.index + match[0].length;
        if (ctx.text[end] === match[2]) continue;

        const first = Number(match[1]);
        const second = Number(match[3]);
        const year = expandYear(match[4]!);

        const monthFirstWorks = isRealDate(year, first, second);
        const dayFirstWorks = isRealDate(year, second, first);
        if (!monthFirstWorks) continue;

        const ambiguous = monthFirstWorks && dayFirstWorks;
        if (ambiguous && !readsMonthFirst(ctx)) continue;

        changes.push({
          start: match.index,
          end,
          before: match[0],
          after: formatDate(year, first, second, ctx.options.dates.format),
          ruleId: 'dates.numeric',
          category: 'dates',
          confidence: ambiguous ? 'risky' : 'safe',
          priority: 45,
          note: ambiguous ? ambiguousNote(ctx) : `unambiguous: there is no month ${second}`,
        });
      }
      return changes;
    },
  };
}

/** `March 5, 2024` and `Mar. 5th` are American orderings whatever the rest of the text says. */
function longDateRule(): Rule {
  const withYear = new RegExp(
    String.raw`(?<![\w])(${MONTH_PATTERN})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,\s*((?:19|20)\d\d)(?![\w])`,
    'g',
  );
  const withoutYear = new RegExp(
    String.raw`(?<![\w])(${MONTH_PATTERN})\.?\s+(\d{1,2})(?:st|nd|rd|th)(?![\w])`,
    'g',
  );

  function monthNumber(name: string): number {
    const lower = name.toLowerCase();
    return MONTHS.findIndex((m) => m.toLowerCase().startsWith(lower.slice(0, 3))) + 1;
  }

  return {
    id: 'dates.long',
    category: 'dates',
    confidence: 'safe',
    priority: 45,
    find(ctx: RuleContext): Change[] {
      if (!ctx.options.dates.reorderLongDates) return [];
      const changes: Change[] = [];

      for (const match of ctx.text.matchAll(withYear)) {
        const month = monthNumber(match[1]!);
        const day = Number(match[2]);
        const year = Number(match[3]);
        if (!isRealDate(year, month, day)) continue;
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: formatDate(year, month, day, ctx.options.dates.format === 'iso' ? 'long' : ctx.options.dates.format),
          ruleId: 'dates.long',
          category: 'dates',
          confidence: 'safe',
          priority: 45,
        });
      }

      for (const match of ctx.text.matchAll(withoutYear)) {
        const month = monthNumber(match[1]!);
        const day = Number(match[2]);
        if (month < 1 || day < 1 || day > 31) continue;
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: `${day} ${MONTHS[month - 1]}`,
          ruleId: 'dates.long',
          category: 'dates',
          confidence: 'safe',
          priority: 44,
        });
      }

      return changes;
    },
  };
}

export function dateRules(): Rule[] {
  return [numericDateRule(), longDateRule()];
}
