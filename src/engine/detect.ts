import type { AmericanSignals } from '../types.js';

/**
 * Spellings and habits that only Americans have. Used to decide whether `03/04/2024`
 * means March or April, and whether a bare `$` is US dollars.
 */
const MARKERS: Array<[label: string, pattern: RegExp]> = [
  ['-ize spelling', /\b\w{3,}iz(?:e|es|ed|ing|ation)\b/i],
  ['-or spelling', /\b(?:colors?|favor(?:s|ite|ites)?|honor|labor|flavors?|behavior|neighbor)\b/i],
  ['-er spelling', /\b(?:centers?|theaters?|fibers?|meters)\b/i],
  ['-ense spelling', /\b(?:defense|offense|pretense)\b/i],
  ['doubled-l dropped', /\b(?:canceled|traveled|labeled|modeled|fueled|totaled)\b/i],
  ['aluminum', /\baluminum\b/i],
  ['gray', /\bgray(?:s|er|est|ish|scale)?\b/i],
  ['Fahrenheit', /(?:°\s*F\b|\bFahrenheit\b)/i],
  // The number may be written out, as older prose and most recipes do.
  [
    'imperial units',
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|quarters)[\s-]*(?:miles?|feet|foot|inches?|pounds?|ounces?|gallons?|quarts?|pints?|mph|acres?)\b/i,
  ],
  ['US vocabulary', /\b(?:sidewalk|gasoline|elevator|apartment|zip code|freeway|cell phone|diaper|faucet|drugstore|realtor|vacation|soccer|math)\b/i],
  ['MM/DD/YYYY literal', /\bMM[/\-.]DD[/\-.]YY(?:YY)?\b/i],
  ['abbreviations with stops', /\b(?:U\.S\.|U\.S\.A\.|Mr\.|Mrs\.|Ph\.D\.)/],
  ['US spellings of places', /\b(?:Pearl Harbor|World Trade Center|Rockefeller Center|Department of Defense)\b/],
];

const MONTH_FIRST = /\b(0?[1-9]|1[0-2])[/\-.](1[3-9]|2\d|3[01])[/\-.](\d{2}|\d{4})\b/g;
const DAY_FIRST = /\b(1[3-9]|2\d|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.](\d{2}|\d{4})\b/g;

/** `March 5, 2024`: month spelled out and written first, which is an American habit. */
const MONTH_NAME_FIRST =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,\s*(?:19|20)\d\d\b/g;
const DAY_NAME_FIRST =
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d\d\b/g;

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

export function detectAmerican(text: string): AmericanSignals {
  return score({
    markers: MARKERS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label),
    unambiguousMonthFirstDates: count(text, MONTH_FIRST),
    unambiguousDayFirstDates: count(text, DAY_FIRST),
    namedMonthFirstDates: count(text, MONTH_NAME_FIRST),
    namedDayFirstDates: count(text, DAY_NAME_FIRST),
  });
}

/**
 * Combines the signals of two pieces of one document, as if they had been detected
 * together. Lets a document that arrives in pieces build up one verdict without
 * rescanning what it has already seen.
 */
export function mergeSignals(a: AmericanSignals, b: AmericanSignals): AmericanSignals {
  return score({
    markers: MARKERS.map(([label]) => label).filter(
      (label) => a.markers.includes(label) || b.markers.includes(label),
    ),
    unambiguousMonthFirstDates: a.unambiguousMonthFirstDates + b.unambiguousMonthFirstDates,
    unambiguousDayFirstDates: a.unambiguousDayFirstDates + b.unambiguousDayFirstDates,
    namedMonthFirstDates: a.namedMonthFirstDates + b.namedMonthFirstDates,
    namedDayFirstDates: a.namedDayFirstDates + b.namedDayFirstDates,
  });
}

function score(evidence: Omit<AmericanSignals, 'confidence'>): AmericanSignals {
  const { markers } = evidence;
  const monthFirst = evidence.unambiguousMonthFirstDates;
  const dayFirst = evidence.unambiguousDayFirstDates;
  const namedMonthFirst = evidence.namedMonthFirstDates;
  const namedDayFirst = evidence.namedDayFirstDates;

  let confidence = Math.min(0.6, markers.length * 0.15);

  // `12/16/2026` is about as conclusive as evidence gets: no other country writes a date
  // that way, so one of them settles the question on its own.
  if (monthFirst > 0 && dayFirst === 0) confidence += 0.7;
  if (dayFirst > 0 && monthFirst === 0) confidence -= 0.4;
  // A named date is strong but not conclusive about the document's origin, and says
  // nothing about the numeric dates beside it.
  if (namedMonthFirst > 0 && namedDayFirst === 0) confidence += 0.45;
  if (namedDayFirst > 0 && namedMonthFirst === 0) confidence -= 0.4;

  return { confidence: Math.max(0, Math.min(1, confidence)), ...evidence };
}
