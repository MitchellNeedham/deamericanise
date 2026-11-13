/**
 * `pounds` as an amount of sterling rather than a weight. British prose spells amounts
 * out: `It cost 500 pounds`, `a fine of 200 pounds`, `earns 30,000 pounds a year`,
 * `5 pounds 50`.
 *
 * A money word reaches only the amount it governs, which is the next number after it,
 * across at most a pronoun or a hedge such as `nearly` or `up to`. `It cost $20 for 5
 * pounds of beef` stays a weight, because `cost` already has its amount in `$20`. A `£`
 * reaches the whole sentence, because a writer pricing in sterling means sterling by a
 * bare `pounds` too. Anything in the measurement's own phrase that makes it a weight, such
 * as `lost` before it or `of beef` after it, outranks the `£`.
 */

/** How far either side of a measurement its phrase and sentence are read. */
const REACH = 200;

/**
 * Words that may sit between a money or weight word and its amount: `cost him nearly`,
 * `a fine of up to`, `paid a total of`. An article counts only with one of these after
 * it, so the `a` in `won a 20-pound salmon` does not join `won` to the salmon.
 */
const FILLER =
  String.raw`(?:(?:an?|the)\s+)?(?:me|you|him|her|it|us|them|just|only|about|around|roughly|` +
  String.raw`nearly|almost|approximately|over|under|some|another|extra|further|whopping|mere|` +
  String.raw`total|at|least|most|up|to|as|much|little|more|less|than|upwards|of|in|excess|` +
  String.raw`between|from|is|was|are|were|will|be|been|well)`;

/** Verbs and adjectives that take an amount of money straight after them. */
const MONEY_VERBS =
  String.raw`cost(?:s|ing)?|pa(?:y|ys|id|ying)|spen(?:d|ds|t|ding)|earn(?:s|ed|t|ing)?|` +
  String.raw`ow(?:e|es|ed|ing)|charg(?:e|es|ed|ing)|fined|w(?:in|ins|on)|bet(?:s|ting)?|` +
  String.raw`len(?:d|ds|t|ding)|borrow(?:s|ed|ing)?|donat(?:e|es|ed|ing)|rais(?:e|es|ed|ing)|` +
  String.raw`sav(?:e|es|ed|ing)|invest(?:s|ed|ing)?|award(?:s|ed|ing)?|fetch(?:es|ed|ing)?|` +
  String.raw`worth|priced|valued|` +
  String.raw`(?:sold|sells?|selling|bought|buys?|buying)(?:\s+[a-z]+){0,3}?\s+for`;

/**
 * Nouns that name an amount of money. Each needs a linking word or a colon before the
 * amount, because straight before a number most of them are adjectives: `a fine 20-pound
 * pike`, `a prize 20-pound marrow`.
 */
const MONEY_NOUNS =
  String.raw`prices?|fees?|fines?|salar(?:y|ies)|budgets?|prizes?|wages?|rents?|fares?|` +
  String.raw`bonus(?:es)?|deposits?|donations?|grants?|loans?|debts?|tickets?|refunds?|` +
  String.raw`payments?|rewards?|sums?|cheques?|tax(?:es)?|earnings|savings|income|pensions?|` +
  String.raw`profits?|revenue|turnover`;

/** Things priced in pounds, after the unit: `a 5-pound note`, `a 200 pound fine`. */
const PRICED_THINGS =
  String.raw`notes?|coins?|fines?|fees?|vouchers?|bets?|prizes?|tips?|bonus(?:es)?|deposits?|` +
  String.raw`discounts?|refunds?|charges?|tickets?|cheques?|payments?|donations?|rewards?|` +
  String.raw`tax(?:es)?|rents?|fares?`;

/**
 * A spaced `in` after a number, with no stop after it, which the unit rules read as the
 * preposition, as in `6 in total`. Straight after the number, as in `6in`, or before a stop,
 * as in `12 in.`, it is the inch.
 */
export const PREPOSITION_IN = String.raw`(?<=\s)in(?![.\w])`;

/**
 * Pence after the pounds: `5 pounds 50`, `five pounds fifty`, `3 pounds 99p`. Bare pence
 * have to end the phrase, or the number belongs to whatever follows: `5 pounds 2 inches`,
 * `5 pounds 12 in. wide`, `1 pound 85% lean beef`. A figure that starts a measurement the
 * unit rules read is not pence either, which `isMoney` asks of the unit rules: the `16` of
 * `5 pounds 16 to 20 feet` and the `12` of `5 pounds 12 in by 3 in`.
 */
const PENCE =
  String.raw`(?:\d{1,2}(?![\d.,]?\d)|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)` +
  String.raw`(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|` +
  String.raw`thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)` +
  String.raw`(?:p\b|\s+pence\b|(?=\s*(?:[.,;:!?)]|$)|\s+(?:for|each|a|an|per|at|on|to|and|or|` +
  String.raw`but|plus|please|then|now)\b|\s+${PREPOSITION_IN}))`;

const MONEY_BEFORE = new RegExp(
  String.raw`\b(?:(?:${MONEY_VERBS})(?:\s+${FILLER}){0,5}|` +
    String.raw`(?:${MONEY_NOUNS})(?:\s*:(?:\s+${FILLER}){0,5}|(?:\s+${FILLER}){1,5}))\s*$`,
  'i',
);

const MONEY_AFTER = new RegExp(
  String.raw`^(?:\s+sterling\b|['’]?\s+worth\b|\s+(?:in\s+)?cash\b|[\s-]+(?:${PRICED_THINGS})\b|` +
    String.raw`\s+(?:an?|per)\s+(?:hour|week|month|year)\b|\s+per\s+annum\b)`,
  'i',
);

/** Pence straight after the pounds, with what comes before their figure in the first group. */
const PENCE_AFTER = new RegExp(String.raw`^(\s+(?:and\s+)?)${PENCE}`, 'i');

/** Whether the unit rules read a measurement that starts at offset `at` of `text`. */
export type MeasurementStart = (text: string, at: number) => boolean;

let startsMeasurement: MeasurementStart = () => false;

/**
 * Gives the pence check the unit rules' test for where a measurement starts. The unit rules
 * reach this module through their definitions, so they hand the test over and this module
 * imports none of them.
 */
export function readMeasurementsWith(test: MeasurementStart): void {
  startsMeasurement = test;
}

const WEIGHT_BEFORE = new RegExp(
  String.raw`\b(?:weigh(?:s|ed|ing)?|los(?:e|es|t|ing)|gain(?:s|ed|ing)?|shed(?:s|ding)?|` +
    String.raw`put(?:s|ting)?\s+on|lift(?:s|ed|ing)?|weights?(?=\s*:|\s+of\b))(?:\s*:)?` +
    String.raw`(?:\s+${FILLER}){0,5}\s*$`,
  'i',
);

const WEIGHT_AFTER = new RegExp(
  String.raw`^(?:\s+of\s+(?!(?:[\w'’-]+\s+){0,3}?(?:money|cash|savings|funds?|funding|wages?|` +
    String.raw`salary|pay|budget|winnings|earnings|pension)\b)[\w'’]|` +
    String.raw`,?\s+(?:and\s+)?[\w½¼¾⅓⅔⅛⅜⅝⅞./-]+\s*(?:ounces?|oz)\b)`,
  'i',
);

/** A singular unit naming the size of the noun after it: `a 5-pound bag of flour`. */
const SIZES_A_NOUN =
  /^[\s-]+(?!(?:of|in|on|at|by|for|and|or|but|to|from|with|per|each|a|an|the|is|was|are|were|this|that|so|then|than|plus|less|more|off|back|too)\b)[a-z]/i;

/** A price by the pound, which puts the sentence's other pounds on the scales. */
const PRICE_PER_WEIGHT =
  /(?:[£$€]\s?\d[\d,]*(?:\.\d+)?|\b\d+\s?p)\s*(?:per\s+|an?\s+|\/\s*)(?:pound|lb)\b/i;

/** A full stop, `!` or `?` before a space, or a blank line. `£5.50` has no boundary in it. */
const SENTENCE_END = /[.!?](?=["'”’)\]]*\s)|\n[ \t]*\n/;

/**
 * Whether the written-out `pound` or `pounds` in the quantity `text.slice(start, end)` is
 * money. `start` is where the number begins.
 */
export function isMoney(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - REACH), start);
  const after = text.slice(end, end + REACH);
  if (/£\s*$/.test(before)) return true;
  if (WEIGHT_BEFORE.test(before) || WEIGHT_AFTER.test(after)) return false;
  if (MONEY_BEFORE.test(before) || MONEY_AFTER.test(after)) return true;
  const pence = PENCE_AFTER.exec(after);
  if (pence !== null && !startsMeasurement(text, end + pence[1]!.length)) return true;
  if (/pound$/i.test(text.slice(start, end)) && SIZES_A_NOUN.test(after)) return false;
  const sentence = `${before.split(SENTENCE_END).pop()!} ${after.split(SENTENCE_END)[0]!}`;
  return sentence.includes('£') && !PRICE_PER_WEIGHT.test(sentence);
}
