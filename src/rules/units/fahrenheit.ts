import { INLINE_SPACE, NUMBER_START, canBeRange, parseNumber } from './number.js';

/**
 * A number straight after `Fahrenheit` makes it a title, as in `Fahrenheit 451` or
 * `Fahrenheit 9/11`, even on the next line of a wrapped paragraph, though not a number past
 * a blank line or one that opens a numbered list item.
 */
export const NOT_A_TITLE = String.raw`(?![^\S\n]*(?:\n[^\S\n]*(?!\d+[.)](?:\s|$)))?\d)`;

/**
 * `°F`, `℉`, `degrees Fahrenheit` and the like: Fahrenheit written as a unit. `º` and `˚`
 * stand in for the degree sign on phone keyboards and Spanish and Portuguese layouts. The
 * word alone counts after a number on the same line, but not after a whole number of four
 * figures, which reads as a year (`In 1724 Fahrenheit proposed his scale`), nor before
 * `thermometers` or `scale`, where the number counts them, nor as a title.
 */
export const FAHRENHEIT =
  String.raw`[°º˚]\s*F\b|℉|[°º˚]\s*Fahrenheit\b|degrees?\s+Fahrenheit\b|degrees?\s+F\b|deg\.?\s*F\b|` +
  // The lookahead comes first so the lookbehinds never walk a run of spaces from every place in it.
  String.raw`(?=Fahrenheit\b)(?<=\d${INLINE_SPACE}*)(?<!(?<![\d.])\d{4}${INLINE_SPACE}*)` +
  String.raw`Fahrenheit\b(?!${INLINE_SPACE}+(?:thermometers?|scales?)\b)${NOT_A_TITLE}`;
const DEGREES = String.raw`[-−]?\d+(?:\.\d+)?`;

/** `165F` and `350 F`. `F-150` and `F-type` are names. */
const BARE = String.raw`${INLINE_SPACE}?F(?![\w'’]|[-–][A-Za-z])`;

/**
 * One temperature, or a range of them with the unit written once: `350-375°F`,
 * `350 to 375°F`, `between 60 and 70°F`. `and` joins a range only after `between`.
 */
const PATTERN = new RegExp(
  String.raw`${NUMBER_START}(?:(${DEGREES})(\s*(?:-|\u2013|\u2014|to)\s*|(?<=\bbetween\s+${DEGREES})\s+and\s+))?` +
    String.raw`(${DEGREES})(?:\s*(${FAHRENHEIT})|(${BARE}))`,
  'gi',
);

/** One figure before a bare `F` is more often a floor, a grade or a hex digit than a temperature. */
const BARE_FIGURE = String.raw`[1-9]\d{1,2}(?:\.\d+)?`;
const BARE_VALUE = new RegExp(String.raw`^[-−]?${BARE_FIGURE}$`);

/** A hex colour such as `#33F`, or a designation such as `A330-200F` or `MiG-21F`. */
const DESIGNATION_END = String.raw`(?:#|(?<!\w)[A-Za-z]\w*[-–])`;
const DESIGNATION = new RegExp(`${DESIGNATION_END}$`);

/**
 * What a bare `C` has to follow to be a unit: a figure that a bare `F` could follow, then
 * at most one space. `180C` is a temperature, while `Apartment 3C` and `A330-200C` are not.
 */
export const BARE_CELSIUS_FIGURE = String.raw`(?<![\w.]|${DESIGNATION_END})${BARE_FIGURE}${INLINE_SPACE}?`;

/**
 * Words that put a bare `F` in a sentence about heat. Without one, `350F` is as likely a
 * seat, a size or a model as a temperature.
 */
const ABOUT_HEAT = new RegExp(
  String.raw`\b(?:temperatures?|temps?|degrees|thermometers?|thermostats?|fevers?|weather|forecasts?|` +
    String.raw`highs|lows|freezing|humidity|ovens?|pre-?heat(?:s|ed|ing)?|heat(?:s|ed|ing)?|` +
    String.raw`bak(?:e|es|ed|ing)|roast(?:s|ed|ing)?|broil(?:s|ed|ing)?|grill(?:s|ed|ing)?|` +
    String.raw`fr(?:y|ies|ied|ying)|cook(?:s|ed|ing)?|simmer(?:s|ed|ing)?|boil(?:s|ed|ing)?)\b`,
  'i',
);

/** A Celsius value beside a bare `F` makes it the courtesy figure, as in `180C/350F/gas 4`. */
const CELSIUS = /\d(?:\s*[°º˚]\s*|\s?)C\b|℃|\b[Cc](?:elsius|entigrade)\b/;

/** A full stop inside a number such as `98.6` does not end the sentence. */
const SENTENCE_END = /[.!?](?!\d)|\n/;
const REACH = 120;

function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - REACH), start).split(SENTENCE_END).pop()!;
  const after = text.slice(end, end + REACH).split(SENTENCE_END)[0]!;
  return `${before} ${after}`;
}

/**
 * A bare `F` is a letter far more often than a unit, so it counts only in upper case,
 * after a number of two or three figures, in a sentence about heat that gives no
 * Celsius value.
 */
function bareIsFahrenheit(text: string, match: RegExpExecArray): boolean {
  if (!match[5]!.endsWith('F') || !BARE_VALUE.test(match[3]!)) return false;
  if (DESIGNATION.test(text.slice(Math.max(0, match.index - 32), match.index))) return false;
  const sentence = sentenceAround(text, match.index, match.index + match[0].length);
  return ABOUT_HEAT.test(sentence) && !CELSIUS.test(sentence);
}

/**
 * Every Fahrenheit temperature in the text. Groups 1 and 2 are the first number of a
 * range and what joins it to the second, group 3 is the number the unit follows, and
 * group 4 or 5 is the unit. The temperature rules convert exactly these, and detection
 * counts them, so the two always agree on what is Fahrenheit.
 */
export function* fahrenheitTemperatures(text: string): Generator<RegExpExecArray> {
  const pattern = new RegExp(PATTERN);
  for (let match: RegExpExecArray | null; (match = pattern.exec(text)) !== null; ) {
    const low = match[1] === undefined ? null : parseNumber(match[1]);
    if (low !== null && !canBeRange(text, match.index, low, parseNumber(match[3]!)!)) {
      // The scan goes on as past a start the pattern refused, so the second number can still
      // be a temperature of its own.
      pattern.lastIndex = match.index + 1;
      continue;
    }
    if (match[5] === undefined || bareIsFahrenheit(text, match)) yield match;
  }
}
