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
  ['imperial units', /\b\d+\s*(?:miles?|feet|foot|inches|pounds?|ounces?|gallons?|mph|acres?)\b/i],
  ['US vocabulary', /\b(?:sidewalk|gasoline|elevator|apartment|zip code|freeway|cell phone|diaper|faucet|drugstore|realtor|vacation|soccer|math)\b/i],
  ['MM/DD/YYYY literal', /\bMM[/\-.]DD[/\-.]YY(?:YY)?\b/i],
  ['abbreviations with stops', /\b(?:U\.S\.|U\.S\.A\.|Mr\.|Mrs\.|Ph\.D\.)/],
  ['US spellings of places', /\b(?:Pearl Harbor|World Trade Center|Rockefeller Center|Department of Defense)\b/],
];

const MONTH_FIRST = /\b(0?[1-9]|1[0-2])[/\-.](1[3-9]|2\d|3[01])[/\-.](\d{2}|\d{4})\b/g;
const DAY_FIRST = /\b(1[3-9]|2\d|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.](\d{2}|\d{4})\b/g;

/**
 * `March 5, 2024` states its own order as plainly as `3/14/2024` does, and is written
 * that way almost nowhere else, so it counts as the same kind of evidence.
 */
const MONTH_NAME_FIRST =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,\s*(?:19|20)\d\d\b/g;
const DAY_NAME_FIRST =
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d\d\b/g;

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

export function detectAmerican(text: string): AmericanSignals {
  const markers = MARKERS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const monthFirst = count(text, MONTH_FIRST) + count(text, MONTH_NAME_FIRST);
  const dayFirst = count(text, DAY_FIRST) + count(text, DAY_NAME_FIRST);

  let confidence = Math.min(0.6, markers.length * 0.15);
  if (monthFirst > 0 && dayFirst === 0) confidence += 0.4;
  if (dayFirst > 0 && monthFirst === 0) confidence -= 0.5;

  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    markers,
    unambiguousMonthFirstDates: monthFirst,
    unambiguousDayFirstDates: dayFirst,
  };
}
