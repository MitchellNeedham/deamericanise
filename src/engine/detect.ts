import type { AmericanSignals } from '../types.js';
import { longDates, numericDates } from '../rules/dates.js';
import { fahrenheitTemperatures } from '../rules/units/fahrenheit.js';
import { isUnitInOtherSense } from '../rules/units/index.js';

/** What a marker adds to the confidence unless it names its own weight. */
const ORDINARY = 0.15;

/**
 * Recipe habits strong enough that two of them clear the default bar on their own, while
 * one of them beside an ordinary marker still falls short.
 */
const RECIPE = 0.25;

/**
 * A marker that `pattern` finds, unless `veto` turns up in the same stretch of text: up
 * to `reach` characters either side of the match, stopping at `boundary`. The veto is
 * checked outside the pattern because a lookaround spanning a sentence would rescan it
 * from every position, which is quadratic on a long line with no full stop.
 */
function unlessNear(pattern: RegExp, veto: RegExp, reach: number, boundary: RegExp): Pick<RegExp, 'test'> {
  const all = new RegExp(pattern.source, `${pattern.flags}g`);
  return {
    test(text) {
      for (const match of text.matchAll(all)) {
        const start = match.index;
        const end = start + match[0].length;
        const before = text.slice(Math.max(0, start - reach), start).split(boundary).pop()!;
        const after = text.slice(end, end + reach).split(boundary)[0]!;
        if (!veto.test(before + match[0] + after)) return true;
      }
      return false;
    },
  };
}

/** A number that can only be an oven setting in Fahrenheit: no home oven is set that high in Celsius. */
const SETTING = String.raw`(?:[34]\d\d|500)(?![.,]?\d)`;
const CELSIUS = String.raw`[\s-]*(?:°|º|˚|degrees?)?\s*(?:C\b|Celsius|centigrade)`;

/**
 * A baking word that names a thing rather than the act of cooking. `Bake off` without a
 * hyphen is left out, because bakeries use it as a verb for finishing par-baked bread.
 */
const BAKED_THING =
  String.raw`bake(?:[\s-]+sales?|-offs?)\b|baked\s+(?:goods|beans)\b|` +
  String.raw`baking\s+(?:tins?|trays?|sheets?|dish(?:es)?|pans?|paper|parchment|powder|soda)\b`;

/**
 * A verb that takes an amount of its own, as in `came to 320` or `raised 500`. Forms a
 * recipe uses to change the heat (`reduce to`, `raise the heat to`, `until it gets to`)
 * are left out.
 */
const AMOUNT_VERB =
  String.raw`\b(?:(?:came|got|gotten|rose|fell|grew|climbed|amounted)\s+(?:up\s+|down\s+)?to|` +
  String.raw`raised|raises|totall?ed|totals|totall?ing|costs?|costing|sold|sells?|selling|priced)\b`;

/** An oven setting from 300 to 500 that is not marked Celsius. */
const OVEN_SETTING = new RegExp(
  // The gap may not cross another temperature, so `oven to 180C or to 400F` is read by
  // its first setting. Nor may it cross an amount verb, whose `to` or `at` is its own.
  String.raw`\b(?:ovens?|pre-?heat(?:s|ed|ing)?|(?!${BAKED_THING})bak(?:e|es|ed|ing)|roast(?:s|ed|ing)?)\b` +
    String.raw`(?:(?!\d\s*(?:°|º|˚|degrees?|C\b)|${AMOUNT_VERB})[^.\n]){0,40}?\b(?:to|at)\s+(?:about\s+|around\s+)?` +
    String.raw`${SETTING}(?!${CELSIUS})` +
    // A setting is followed by its unit or the rest of the instruction, never a quantity:
    // `the baking powder to 300 g of flour`, `in the oven for up to 300 minutes`.
    String.raw`(?=\s*(?:°|º|˚)|[\s-]*degrees?\b|\s*F\b|\s*Fahrenheit\b|\s*[.,;:!?()/]|\s*$|` +
    String.raw`\s+(?:for|until|and|then|or|on|in|with|to|while)\b)` +
    String.raw`|\b(?:a|an)\s+${SETTING}[\s-]*(?:(?:degrees?|°|º|˚)[\s-]*(?:F\b[\s-]*)?)?oven\b` +
    String.raw`|\b${SETTING}[\s-]*(?:degrees?|°|º|˚)[\s-]*(?:F\b[\s-]*)?oven\b`,
  'i',
);

/** Pizza ovens and cleaning cycles do run from 300 to 500 in Celsius. */
const HOT_APPLIANCE = /\b(?:pizza\s+ovens?|wood[- ]?fired|pyrolytic|self[- ]clean)/i;

const FAHRENHEIT_OVEN = unlessNear(OVEN_SETTING, HOT_APPLIANCE, 120, /[.\n]/);

const STICK = String.raw`(?:\b(?:\d+(?:\/\d+)?|one|two|three|four|a|half(?:\s+a)?)|[½¼¾⅓⅔])[\s-]*sticks?\b`;

/** Butter and margarine are sold in quarter-pound sticks only in the United States. */
const STICK_OF_BUTTER = new RegExp(
  String.raw`${STICK}(?:\s*\([^)\n]{0,20}\))?\)?[\s,]+(?:of\s+)?` +
    String.raw`(?:(?:cold|chilled|softened|melted|unsalted|salted|sweet|cream|vegan|room[- ]temperature)\s+){0,2}` +
    String.raw`(?:butter|margarine)\b` +
    String.raw`|\b(?:butter|margarine)\b[^()\n]{0,20}\([^)\n]{0,15}?${STICK}`,
  'i',
);

/**
 * A measured ingredient under a name only Americans use. The measure has to sit right
 * before the name. A cup alone counts for nothing, because Australia and New Zealand
 * cook in metric cups.
 */
const MEASURED_US_INGREDIENT = new RegExp(
  String.raw`\b(?:cups?|tablespoons?|tbsps?|teaspoons?|tsps?)\.?\s+(?:\([^)\n]{0,20}\)\s*)?(?:of\s+)?` +
    String.raw`(?:(?:sifted|packed|unbleached|cold|chilled)\s+)?` +
    String.raw`(?:all[- ]purpose flour|confectioner(?:s['’]?|['’]s)\s+sugar|powdered sugar|superfine sugar|` +
    String.raw`heavy (?:whipping )?cream|half[- ]and[- ]half|cornstarch|graham cracker crumbs)\b`,
  'i',
);

/**
 * An Australian or British recipe written for everyone gives the US name as a courtesy
 * beside its own, as in `1 cup plain flour (all-purpose flour)`.
 */
const COMMONWEALTH_INGREDIENT =
  /\b(?:plain flour|icing sugar|caster sugar|thickened cream|double cream|single cream|pure cream|cornflour)\b/i;

const US_INGREDIENTS = unlessNear(MEASURED_US_INGREDIENT, COMMONWEALTH_INGREDIENT, 30, /\n/);

/**
 * The word `Fahrenheit` where it names the scale. A number straight after it makes it a
 * title, as in `Fahrenheit 451` or `Fahrenheit 9/11`, even on the next line of a wrapped
 * paragraph, though not a number past a blank line or one that opens a numbered list item.
 */
const SCALE_NAMED = /\bFahrenheit\b(?![^\S\n]*(?:\n[^\S\n]*(?!\d+[.)](?:\s|$)))?\d)/i;

/** Every temperature the Fahrenheit rules convert, and the scale named on its own. */
const FAHRENHEIT: Pick<RegExp, 'test'> = {
  test: (text) => !fahrenheitTemperatures(text).next().done || SCALE_NAMED.test(text),
};

// The number may be written out, as older prose and most recipes do.
const IMPERIAL_UNIT =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|quarters)[\s-]*(miles?|feet|foot|inches?|pounds?|ounces?|gallons?|quarts?|pints?|mph|acres?)\b/gi;

/**
 * An imperial unit, unless the unit rules read it in another sense, as they read
 * `It cost 400 pounds` as money.
 */
const IMPERIAL_UNITS: Pick<RegExp, 'test'> = {
  test(text) {
    for (const match of text.matchAll(IMPERIAL_UNIT)) {
      const unitEnd = match.index + match[0].length;
      if (!isUnitInOtherSense(text, unitEnd - match[1]!.length, unitEnd)) return true;
    }
    return false;
  },
};

/**
 * Spellings and habits that only Americans have. Used to decide whether `03/04/2024`
 * means March or April, and whether a bare `$` is US dollars. Each counts once however
 * often it appears, for its weight, which is `ORDINARY` unless it names another.
 */
const MARKERS: Array<[label: string, pattern: Pick<RegExp, 'test'>, weight?: number]> = [
  ['-ize spelling', /\b\w{3,}iz(?:e|es|ed|ing|ation)\b/i],
  ['-or spelling', /\b(?:colors?|favor(?:s|ite|ites)?|honor|labor|flavors?|behavior|neighbor)\b/i],
  ['-er spelling', /\b(?:centers?|theaters?|fibers?|meters)\b/i],
  ['-ense spelling', /\b(?:defense|offense|pretense)\b/i],
  ['doubled-l dropped', /\b(?:canceled|traveled|labeled|modeled|fueled|totaled)\b/i],
  ['aluminum', /\baluminum\b/i],
  ['gray', /\bgray(?:s|er|est|ish|scale)?\b/i],
  ['Fahrenheit', FAHRENHEIT],
  ['Fahrenheit oven setting', FAHRENHEIT_OVEN, RECIPE],
  ['imperial units', IMPERIAL_UNITS],
  ['US vocabulary', /\b(?:sidewalk|gasoline|elevator|apartment|zip code|freeway|cell phone|diaper|faucet|drugstore|realtor|vacation|soccer|math)\b/i],
  ['MM/DD/YYYY literal', /\bMM[/\-.]DD[/\-.]YY(?:YY)?\b/i],
  ['abbreviations with stops', /\b(?:U\.S\.|U\.S\.A\.|Mr\.|Mrs\.|Ph\.D\.)/],
  ['US spellings of places', /\b(?:Pearl Harbor|World Trade Center|Rockefeller Center|Department of Defense)\b/],
  ['stick of butter', STICK_OF_BUTTER, RECIPE],
  ['US ingredient names', US_INGREDIENTS],
];

const WEIGHTS = new Map(MARKERS.map(([label, , weight = ORDINARY]) => [label, weight]));

/**
 * An oven set in Fahrenheit is the strong form of `Fahrenheit`, so `oven to 350°F` is
 * one sighting rather than two.
 */
const OUTRANKS = new Map([['Fahrenheit oven setting', 'Fahrenheit']]);

const DAY_NAME_FIRST =
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d\d\b/g;

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

export function detectAmerican(text: string): AmericanSignals {
  let monthFirst = 0;
  let dayFirst = 0;
  for (const date of numericDates(text)) {
    if (date.monthFirst && !date.dayFirst) monthFirst++;
    if (date.dayFirst && !date.monthFirst) dayFirst++;
  }
  return score({
    markers: MARKERS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label),
    unambiguousMonthFirstDates: monthFirst,
    unambiguousDayFirstDates: dayFirst,
    namedMonthFirstDates: [...longDates(text)].length,
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

  const counted = markers.filter((label) => !markers.some((other) => OUTRANKS.get(other) === label));
  let confidence = Math.min(0.6, counted.reduce((sum, label) => sum + WEIGHTS.get(label)!, 0));

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
