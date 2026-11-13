import { DIALECTS } from '../../dialects/index.js';
import { toPattern } from '../../engine/lexicon.js';
import { FIGURE_DATE } from '../dates.js';
import { CONTRACTIONS, OPENER as AFTER_INITIALISM } from '../punctuation.js';
import { sentenceBounds } from '../sentence.js';
import { spellingEntries } from '../spelling/index.js';
import { DOTTED_TIME, OPENER as AFTER_TIME } from '../times.js';
import { baseVocabulary } from '../vocabulary.js';
import {
  DIGITS,
  HYPHEN,
  INLINE_SPACE,
  NUMBER_PATTERN,
  NUMBER_START,
  SOFT_SPACE,
  UNIT_END,
  canBeRange,
  parseNumber,
  softGap,
} from './number.js';

/**
 * A number straight after `Fahrenheit` makes it a title, as in `Fahrenheit 451` or
 * `Fahrenheit 9/11`, even on the next line of a wrapped paragraph, though not a number past
 * a blank line or one that opens a numbered list item.
 */
export const NOT_A_TITLE = String.raw`(?![^\S\n]*(?:\n[^\S\n]*(?!\d+[.)](?:\s|$)))?\d)`;

/**
 * The stop after an `F` or `℉`, as in `350 degrees F.` or `350°F.`, which the unit rules
 * decide by the form it follows (`fahrenheitKeepsStop` in `index.ts`), past the Celsius value
 * in brackets where the pair collapses. A stop that opens an ellipsis or runs into a word is
 * left in the text. So is one before a figure, where it may end a sentence that the unit
 * rules' test cannot see end: only a date opens one there.
 */
const STOP = String.raw`(?:\.(?![.\w]|\s*\d))?`;

/**
 * Between `degree` and the scale: a space, or the hyphen of `110-degree-Fahrenheit heat`. The
 * Celsius forms read the same, so `43-degree-Celsius` can restate it.
 */
export const DEGREE_GAP = String.raw`(?:\s+|${HYPHEN})`;

/**
 * `°F`, `℉`, `degrees Fahrenheit` and the like: Fahrenheit written as a unit. `º` and `˚`
 * stand in for the degree sign on phone keyboards and Spanish and Portuguese layouts. The
 * word alone counts after a number on the same line, but not after a whole number of four
 * figures, which reads as a year (`In 1724 Fahrenheit proposed his scale`), nor before
 * `thermometers` or `scale`, where the number counts them, nor as a title. An `F` or `℉`
 * takes the `STOP` after it, and the word `Fahrenheit` never does.
 */
export const FAHRENHEIT =
  String.raw`[°º˚]\s*F${UNIT_END}${STOP}|℉${STOP}|[°º˚]\s*Fahrenheit${UNIT_END}|` +
  String.raw`degrees?${DEGREE_GAP}Fahrenheit${UNIT_END}|degrees?${DEGREE_GAP}F${UNIT_END}${STOP}|` +
  String.raw`deg\.?\s*F${UNIT_END}${STOP}|` +
  // The lookahead comes first so the lookbehinds never walk a run of spaces from every place in it.
  String.raw`(?=Fahrenheit${UNIT_END})(?<=\d${INLINE_SPACE}*)(?<!(?<![\d.])\d{4}${INLINE_SPACE}*)` +
  String.raw`Fahrenheit${UNIT_END}(?!${INLINE_SPACE}+(?:thermometers?|scales?)\b)${NOT_A_TITLE}`;
/** A Fahrenheit figure, its thousands grouped as any other unit's may be, as in `2,000°F`. */
export const DEGREES = String.raw`[-−]?(?:${DIGITS})(?:\.\d+)?`;

/** `165F` and `350 F`, with any `STOP` after it. `F-150` and `F-type` are names. */
const BARE = String.raw`${INLINE_SPACE}?F(?![A-Za-z\d'’]|[-–][A-Za-z])${STOP}`;

const JOIN = softGap(String.raw`(?:${HYPHEN}|\u2013|\u2014|to|or)`);
// The lookahead comes first so the lookbehind never walks a run of digits from every split of it.
const BETWEEN_AND =
  String.raw`(?=\s)(?<=\bbetween(?=\s)${SOFT_SPACE}${DEGREES})` + softGap(String.raw`(?<=\s)and(?=\s)`);

/**
 * The units a Fahrenheit degree can be divided by in a rate or a compound unit: time, length,
 * energy and power, as in `°F/min`, `°F/ft` and `°F/W`.
 */
const PER_UNIT = [
  's', 'secs?', 'seconds?', 'mins?', 'minutes?', 'h', 'hrs?', 'hours?', 'd', 'days?', 'wks?',
  'weeks?', 'mos?', 'months?', 'yrs?', 'years?', 'decades?', 'century', 'centuries', 'ft', 'foot',
  'feet', 'inch(?:es)?', 'mi', 'miles?', 'k?m', 'cm', 'mm', 'BTUs?', 'k?W', 'k?J', 'k?cal',
].join('|');

/**
 * A Fahrenheit degree that is one factor of a compound unit, as in `0.45 °F·ft²·h/BTU` and
 * `2 °F/min`, which measures no temperature. A slash makes one only before a unit, since
 * `225°F/low/slow` and `350°F/gas 4` give a setting and another word for it.
 */
const IN_COMPOUND = String.raw`[·⋅][A-Za-z]|/(?:${PER_UNIT})${UNIT_END}`;

/**
 * One temperature, or a range of them with the unit written once: `350-375°F`,
 * `350 to 375°F`, `350 or 375°F`, `between 60 and 70°F`. `and` joins a range only after
 * `between`. A range crosses a line break that only wraps the paragraph, never a new block.
 * A hyphen may tie the number to `degree`, as in `110-degree-Fahrenheit heat`.
 */
const PATTERN = new RegExp(
  // No join can follow part of a number, so the lookahead reads the first number whole and
  // gives none of it back, and a long grouped figure is not split at every group to try one.
  String.raw`${NUMBER_START}(?:(?=(${DEGREES}))\1(${JOIN}|${BETWEEN_AND}))?` +
    String.raw`(${DEGREES})(?:(?:\s*|${HYPHEN}(?=degree))(${FAHRENHEIT})|(${BARE}))` +
    String.raw`(?!${IN_COMPOUND})`,
  'gi',
);

/** One figure before a bare `F` is more often a floor, a grade or a hex digit than a temperature. */
const BARE_FIGURE = String.raw`[1-9]\d{1,2}(?:\.\d+)?`;
/** A figure grouped in thousands, as `DEGREES` reads it, is a quantity and never a name. */
const BARE_VALUE = new RegExp(String.raw`^[-−]?(?:${BARE_FIGURE}|[1-9]\d{0,2}(?:[,\s]\d{3})+(?:\.\d+)?)$`);

/** A hex colour such as `#33F`, or a designation such as `A330-200F` or `MiG-21F`. */
const DESIGNATION_END = String.raw`(?:#|(?<!\w)[A-Za-z]\w*[-–])`;
const DESIGNATION = new RegExp(`${DESIGNATION_END}$`);

/**
 * What a bare `C` has to follow to be a unit: a figure that a bare `F` could follow, then
 * at most one space. `180C` is a temperature, while `Apartment 3C` and `A330-200C` are not.
 */
export const BARE_CELSIUS_FIGURE = String.raw`(?<![\w.]|${DESIGNATION_END})${BARE_FIGURE}${INLINE_SPACE}?`;

const HEAT_WORDS =
  String.raw`temperatures?|temps?|degrees|thermometers?|thermostats?|fevers?|weather|forecasts?|` +
  String.raw`highs|lows|freezing|humidity|ovens?|pre-?heat(?:s|ed|ing)?|heat(?:s|ed|ing)?|` +
  String.raw`bak(?:e|es|ed|ing)|roast(?:s|ed|ing)?|broil(?:s|ed|ing)?|grill(?:s|ed|ing)?|` +
  String.raw`fr(?:y|ies|ied|ying)|cook(?:s|ed|ing)?|simmer(?:s|ed|ing)?|boil(?:s|ed|ing)?`;
const HEAT_WORD = new RegExp(String.raw`\b(?:${HEAT_WORDS})\b`, 'i');

/** The American words the lexicon rewrites into a word about heat, as `cookie sheet` into `baking tray`. */
const AMERICAN_HEAT_WORDS = [
  ...new Set(
    [...spellingEntries(), ...baseVocabulary(), ...Object.values(DIALECTS).flatMap((pack) => pack.vocabulary)]
      .filter((entry) => HEAT_WORD.test(entry.to))
      .map((entry) => toPattern(entry.from)),
  ),
];

/**
 * Words that put a bare `F` in a sentence about heat. Without one, `350F` is as likely a
 * seat, a size or a model as a temperature. Every rule reads the input, so an American word
 * counts wherever its replacement would.
 */
const ABOUT_HEAT = new RegExp(String.raw`\b(?:${[HEAT_WORDS, ...AMERICAN_HEAT_WORDS].join('|')})\b`, 'i');

/** A Celsius value beside a bare `F` makes it the courtesy figure, as in `180C/350F/gas 4`. */
const CELSIUS = /\d(?:\s*[°º˚]\s*|\s?)C\b|℃|\b[Cc](?:elsius|entigrade)\b/;

/** From a stop to the word after it, past any closing and opening marks. */
const TO_WORD = String.raw`[^\p{L}\p{N}]+`;
const TIME_STOP = String.raw`${DOTTED_TIME}${TO_WORD}`;
const INITIALISM_STOP = String.raw`\p{L}\.\s?\p{L}\.${TO_WORD}`;
const TITLE_STOP = String.raw`\b(?:${CONTRACTIONS.join('|')})\.${TO_WORD}`;

/**
 * A word that starts a new sentence after a stop, by the test of the rule that rewrites that
 * stop, so no rewrite moves a sentence's end: after a time such as `6 p.m.`, the time rule's;
 * after an initialism such as `U.S.`, the abbreviation rule's; after a title such as `Mr.`,
 * none, since that rule drops the stop before a name. After any other word, any capitalised
 * word starts one, and so does a date that starts with a figure, as `1 December 2024` does.
 * No other number does, in words or in figures, since the unit rules write `Two feet` as
 * `61 centimetres`.
 */
const OPENER = new RegExp(
  String.raw`(?!(?!${FIGURE_DATE})(?:${NUMBER_PATTERN})(?![\p{L}\p{N}]))(?:` +
    String.raw`(?<=${TIME_STOP})${AFTER_TIME.source}` +
    String.raw`|(?<!${TIME_STOP})(?<=${INITIALISM_STOP})${AFTER_INITIALISM.source}` +
    String.raw`|(?<!${INITIALISM_STOP}|${TITLE_STOP}))`,
  'iuy',
);

const REACH = 120;

/** The words either side of a match in its sentence. */
export function sentenceAround(text: string, start: number, end: number): string {
  const [from, to] = sentenceBounds(text, start, end, OPENER, REACH);
  return `${text.slice(from, start)} ${text.slice(end, to)}`;
}

/**
 * A bare `F` is a letter far more often than a unit, so it counts only in upper case,
 * after a number of two or three figures or one grouped in thousands, in a sentence about
 * heat that gives no Celsius value.
 */
function bareIsFahrenheit(text: string, match: RegExpExecArray): boolean {
  if (!/F\.?$/.test(match[5]!) || !BARE_VALUE.test(match[3]!)) return false;
  if (DESIGNATION.test(text.slice(Math.max(0, match.index - 32), match.index))) return false;
  // The sentence's end is looked for after the span, so the span ends before a stop that may be it.
  const end = match.index + match[0].length - (match[5]!.endsWith('.') ? 1 : 0);
  const sentence = sentenceAround(text, match.index, end);
  return ABOUT_HEAT.test(sentence) && !CELSIUS.test(sentence);
}

/** The words before a gas mark's figure, in any case. */
const GAS_WORDS = String.raw`\b[Gg][Aa][Ss](?:\s+[Mm][Aa][Rr][Kk])?\s+`;
const GAS_MARK_BEFORE = new RegExp(`${GAS_WORDS}$`);

/** A gas mark, as in `gas mark 4`, `Gas 4`, `gas mark ½` and `gas 4-5`. */
export const GAS_MARK = String.raw`${GAS_WORDS}(?:\d+|[¼½¾]|1/[24])(?:\s*[-–]\s*\d+)?`;

/**
 * `gas mark 4 - 350°F`, `gas mark 4 to 350°F` and `gas mark 4 or 350°F` give one heat on
 * two scales, so whatever joins them joins no range.
 */
function givesGasMark(text: string, match: RegExpExecArray): boolean {
  return GAS_MARK_BEFORE.test(text.slice(Math.max(0, match.index - 16), match.index));
}

/**
 * Every Fahrenheit temperature in the text. Groups 1 and 2 are the first number of a
 * range and what joins it to the second, group 3 is the number the unit follows, and
 * group 4 or 5 is the unit, with any stop after its `F` or `℉`. The temperature rules
 * convert exactly these, and detection counts them, so the two always agree on what is
 * Fahrenheit.
 */
export function* fahrenheitTemperatures(text: string): Generator<RegExpExecArray> {
  const pattern = new RegExp(PATTERN);
  for (let match: RegExpExecArray | null; (match = pattern.exec(text)) !== null; ) {
    const low = match[1] === undefined ? null : parseNumber(match[1]);
    if (
      low !== null &&
      (!canBeRange(text, match.index, low, parseNumber(match[3]!)!) || givesGasMark(text, match))
    ) {
      // The scan goes on as past a start the pattern refused, so the second number can still
      // be a temperature of its own.
      pattern.lastIndex = match.index + 1;
      continue;
    }
    if (match[5] === undefined || bareIsFahrenheit(text, match)) yield match;
  }
}
