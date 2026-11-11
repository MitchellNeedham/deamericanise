/** A closing quote or bracket that can stand between a stop and the sentence after it. */
export const CLOSING = String.raw`[)\]}"'’”»]`;

const CLOSERS = new RegExp(`${CLOSING}*`, 'y');

/** A line break that starts a new paragraph, list item or heading. */
const BREAK = String.raw`\n[^\S\n]*(?:\n|(?:[-*+]|\d+[.)]|#{1,6})[^\S\n])`;
const BLOCK_BREAK = new RegExp(BREAK, 'y');
const BLOCK_END = new RegExp(String.raw`\s*$|[^\S\n]*${BREAK}`, 'y');

const NEXT_WORD = /\s+[([{"'‘“«]*(?=\p{Lu}(?!\p{Lu}))/uy;

/**
 * Whether the stop just before `end` is also the sentence's full stop. It is when nothing
 * else ends the sentence: past any closing quotes or brackets, a new sentence starts, or
 * the text or block ends after words that could make one.
 *
 * A new sentence starts with a capitalised word that `opener`, a sticky (`y`) pattern, matches
 * where that word begins. A word in capitals never starts one: it is a time zone such as
 * `ET`, an acronym, or text set in capitals throughout.
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
