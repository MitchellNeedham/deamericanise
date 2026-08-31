import type { Range } from './apply.js';

/**
 * Recognising a line of code that has been commented out, without parsing it.
 *
 * This does not need a grammar per language, because commented-out code gives itself
 * away at the punctuation level and every language punctuates alike: something is
 * assigned to, something is called, a line ends in a terminator, brackets are opened.
 * Prose comments do almost none of that. A weighted score over those signals separates
 * the two across C, Python, SQL, CSS and the rest with one rule set.
 *
 * The costs here are lopsided. Missing a rewrite inside a commented-out block is
 * invisible; rewriting one breaks the code the moment someone uncomments it. So the
 * threshold is deliberately low and the signals are generous.
 */
const SIGNALS: Array<[weight: number, pattern: RegExp]> = [
  // A declaration keyword opening the line. Prose rarely starts this way.
  [
    3,
    /^\s*(?:const|let|var|function|func|fn|def|defn|defun|lambda|class|struct|enum|interface|impl|trait|namespace|package|import|export|require|include|using|public|private|protected|internal|static|final|abstract|async|extern|pub|val|sub|select|insert|update|create|alter|drop|from|where|join|group by|order by)\b/i,
  ],
  // Something being assigned to: the heart of almost every statement.
  [3, /^\s*[A-Za-z_$@][\w$.[\]'"]*\s*(?:=|:=|<-|\+=|-=)\s*[^=\s]/],
  // A keyword followed by exactly one token, as in `return color`. Prose keeps going:
  // `Return the color to the caller` has an article and more words after it.
  [3, /^\s*(?:return|yield|throw|raise|await|delete|print|puts|echo|assert)\s+[\w$.[\]()"'-]+;?\s*$/i],
  // A statement that carries a value with it.
  [2, /^\s*(?:return|throw|raise|yield|await|break|continue|goto|pass|elif|assert|delete|new)\b/i],
  // Operators with no use in a sentence.
  [2, /=>|->|::|===|!==|!=|>=|<=|\|\||&&|\+\+|--|\*=|\/=|\?\?|\.\.\.|\breturn\s+\w+;/],
  // A call. No space before the bracket, unlike prose such as `the note (below)`.
  [2, /[A-Za-z_$][\w$]*\([^)]*\)/],
  // A terminator ending the line.
  [2, /[;{},][ \t]*$/],
  [1, /[{}[\]]/],
  // A quoted literal butted against punctuation rather than sitting in a sentence.
  [1, /['"][^'"]*['"]\s*[,;:)\]}]|[=:(\[,]\s*['"]/],
  // A lowercase key with a single-token value, filling the whole line: YAML, CSS, object
  // literals. Prose such as `Note: this is deliberate.` has a sentence after the colon.
  [3, /^\s*-?\s*[a-z][\w$-]*\s*:\s*[^\s.]+\s*$/],
  // A key with any value at all.
  [1, /^\s*-?\s*[\w$-]+\s*:\s*\S/],
  // Member access. Both sides need two characters, so `e.g.` and `i.e.` stay prose.
  [1, /[A-Za-z_$][\w$]+\.[A-Za-z_$][\w$]+/],
];

const THRESHOLD = 3;

/** A line already carrying a comment marker was commented out on top of a comment. */
function isDoubleCommented(line: string, markers: string[]): boolean {
  const body = line.replace(/^[\s*]+/, '');
  return markers.some((marker) => body.startsWith(marker)) || body.startsWith('/*');
}

export function looksLikeCode(line: string, markers: string[] = []): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (isDoubleCommented(line, markers)) return true;

  let score = 0;
  for (const [weight, pattern] of SIGNALS) {
    if (pattern.test(trimmed)) score += weight;
    if (score >= THRESHOLD) return true;
  }
  return false;
}

/**
 * Marks every line of a comment that reads as code. Works line by line rather than on
 * the whole comment, so a block comment can hold prose and an `@example` at once.
 */
export function commentedCodeRanges(text: string, markers: string[] = []): Range[] {
  const ranges: Range[] = [];
  let offset = 0;

  for (const line of text.split('\n')) {
    if (looksLikeCode(line, markers)) ranges.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  }

  return ranges;
}
