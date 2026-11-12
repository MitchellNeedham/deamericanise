import type { Change, Rule, RuleContext } from '../types.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_PATTERN = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|');

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

// The trailing guard is only `(?!\d)`; a full stop after `03/04/2024.` ends a sentence.
// A longer run such as `1/2/3/4` is rejected below by looking for a repeated separator.
const NUMERIC_DATE = /(?<![\w/\-.])(\d{1,2})([/\-.])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/g;

/** A word that a version number follows, as in `version 1.13.24` or `Python 3.12.1`. */
const VERSION_WORD = /^(?:v\.?|ver\.?|version|release|build|firmware|kernel|node(?:\.?js)?|npm|python|php|perl)$/i;

/**
 * The word that ends where the whitespace before `index` begins, with any stops in it.
 * Empty when no whitespace comes right before `index`.
 */
function wordBefore(text: string, index: number): string {
  let end = index;
  while (end > 0 && /\s/.test(text[end - 1]!)) end--;
  if (end === index) return '';
  let start = end;
  while (start > 0 && /[\w.]/.test(text[start - 1]!)) start--;
  return text.slice(start, end);
}

/** A numeric date such as `3/14/2024` or `25.12.2023`, with the readings that fit it. */
export interface NumericDate {
  start: number;
  end: number;
  /** The first and second numbers as written. */
  first: number;
  second: number;
  /** The year, with two figures expanded to four. */
  year: number;
  /** Whether it is a real date read month-first. */
  monthFirst: boolean;
  /** Whether it is a real date read day-first. */
  dayFirst: boolean;
}

/**
 * Every numeric date in the text that is a real date read one way round or the other.
 * The same separator joins all three parts. A dotted date needs a four-figure year,
 * because `1.13.24` is far more often a version, and nothing after a version word such
 * as `version` or `Python` is a date. The numeric date rule converts the month-first
 * ones and detection counts the ones that fit only one reading, so the two always agree
 * on what is a date.
 */
export function* numericDates(text: string): Generator<NumericDate> {
  for (const match of text.matchAll(NUMERIC_DATE)) {
    const start = match.index;
    const end = start + match[0].length;
    const separator = match[2]!;
    if (text[end] === separator) continue;
    if (separator === '.' && match[4]!.length !== 4) continue;
    if (VERSION_WORD.test(wordBefore(text, start))) continue;

    const first = Number(match[1]);
    const second = Number(match[3]);
    const year = expandYear(match[4]!);
    const monthFirst = isRealDate(year, first, second);
    const dayFirst = isRealDate(year, second, first);
    if (monthFirst || dayFirst) yield { start, end, first, second, year, monthFirst, dayFirst };
  }
}

/**
 * `3/14/2024` is unambiguous: no month is 14. `03/04/2024` is not, so it waits for
 * evidence.
 */
function numericDateRule(): Rule {
  return {
    id: 'dates.numeric',
    category: 'dates',
    confidence: 'moderate',
    priority: 45,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];

      for (const { start, end, first, second, year, monthFirst, dayFirst } of numericDates(ctx.text)) {
        if (!monthFirst) continue;

        const ambiguous = dayFirst;
        if (ambiguous && !readsMonthFirst(ctx)) continue;

        changes.push({
          start,
          end,
          before: ctx.text.slice(start, end),
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
