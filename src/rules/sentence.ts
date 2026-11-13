import { FIGURE_DATE } from './dates.js';

/** A closing quote or bracket that can stand between a stop and the sentence after it. */
export const CLOSING = String.raw`[)\]}"'’”»]`;

/** An opening quote or bracket that can stand before the first word of a sentence. */
export const OPENING = String.raw`[([{"'‘“«]`;

const CLOSERS = new RegExp(`${CLOSING}*`, 'y');

/** A list item's marker and the space after it, as in `- ` and `2) `. */
export const LIST_MARKER = String.raw`(?:[-*+]|\d+[.)])[^\S\n]`;

/** A line break that starts a new paragraph, list item or heading. */
const BREAK = String.raw`\n[^\S\n]*(?:\n|${LIST_MARKER}|#{1,6}[^\S\n])`;
const BLOCK_BREAK = new RegExp(BREAK, 'y');
const BLOCK_END = new RegExp(String.raw`\s*$|[^\S\n]*${BREAK}`, 'y');

const NEXT_WORD = new RegExp(String.raw`\s+${OPENING}*(?=\p{Lu}(?!\p{Lu})|${FIGURE_DATE})`, 'uy');

/**
 * Whether the stop just before `end` is also the sentence's full stop. It is when nothing
 * else ends the sentence: past any closing quotes or brackets, a new sentence starts, or
 * the text or block ends after words that could make one.
 *
 * A new sentence starts with a capitalised word, or a date that starts with a figure, that
 * `opener`, a sticky (`y`) pattern, matches where it begins. Such a date counts because the
 * date rules write `December 1, 2024` as `1 December 2024` or `01/12/2024`, and a sentence
 * has to end at the same stop before the rewrite and after it. A word in capitals never
 * starts one: it is a time zone such as `ET`, an acronym, or text set in capitals throughout.
 */
export function endsSentence(text: string, start: number, end: number, opener: RegExp): boolean {
  CLOSERS.lastIndex = end;
  CLOSERS.test(text);
  const from = CLOSERS.lastIndex;

  BLOCK_END.lastIndex = from;
  if (BLOCK_END.test(text)) return wordsBefore(text, start);

  NEXT_WORD.lastIndex = from;
  if (!NEXT_WORD.test(text)) return false;
  opener.lastIndex = NEXT_WORD.lastIndex;
  return opener.test(text);
}

/** The two dots after a stop that make it the first of an ellipsis, and no third. */
const ELLIPSIS_REST = /\.\.(?!\.)/y;

/**
 * Whether the stop just before `end`, the last of an abbreviation, stays where the
 * abbreviation is rewritten without it. It stays where it is also the sentence's full stop,
 * by `endsSentence` with `opener`, or the first dot of an ellipsis, as in `5 p.m...`. Before
 * a whole ellipsis, as in `12 in....`, it is the abbreviation's alone.
 */
export function stopStays(text: string, start: number, end: number, opener: RegExp): boolean {
  ELLIPSIS_REST.lastIndex = end;
  return ELLIPSIS_REST.test(text) || endsSentence(text, start, end, opener);
}

const SENTENCE_BOUND = new RegExp(String.raw`[.!?]|${BREAK}`, 'g');

/**
 * The sentence holding `start` to `end`, as the offsets where it begins and ends. It begins
 * just past the last block break before `start`, or the last stop before it that
 * `endsSentence` accepts with `opener`, and ends at the first of either from `end` on. Neither
 * bound is looked for more than `reach` characters from the span.
 */
export function sentenceBounds(
  text: string,
  start: number,
  end: number,
  opener: RegExp,
  reach = Infinity,
): [from: number, to: number] {
  const bounds = (match: RegExpMatchArray, at: number): boolean =>
    match[0].startsWith('\n') || endsSentence(text, at, at + 1, opener);

  const head = Math.max(0, start - reach);
  let from = head;
  // From the span back, so only the stops after the sentence's start are tested.
  const before = [...text.slice(head, start).matchAll(SENTENCE_BOUND)];
  for (let i = before.length - 1; i >= 0; i--) {
    const at = head + before[i]!.index;
    if (bounds(before[i]!, at)) {
      from = at + before[i]![0].length;
      break;
    }
  }

  const to = Math.min(text.length, end + reach);
  for (const match of text.slice(end, to).matchAll(SENTENCE_BOUND)) {
    const at = end + match.index;
    if (bounds(match, at)) return [from, at];
  }
  return [from, to];
}

/** Whether the block holding `start` has a letter before it, so is more than a bare label. */
function wordsBefore(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const char = text[i]!;
    if (char === '\n') {
      BLOCK_BREAK.lastIndex = i;
      if (BLOCK_BREAK.test(text)) return false;
    } else if (/\p{L}/u.test(char)) {
      return true;
    }
  }
  return false;
}

/** One character that does not end the sentence. A blank line ends one too. */
export const IN_SENTENCE = String.raw`(?:(?![!?](?:\s|$)|(?<!\b(?:e\.g|i\.e))\.(?:\s|$)|\n[ \t]*\n)[\s\S])`;
