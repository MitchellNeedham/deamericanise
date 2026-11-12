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
const SIGNALS: Array<[weight: number, pattern: { test(line: string): boolean }]> = [
  // A declaration keyword opening the line. Prose rarely starts this way.
  [
    3,
    /^\s*(?:const|let|var|function|func|fn|def|defn|defun|lambda|class|struct|enum|interface|impl|trait|namespace|package|import|export|require|include|using|public|private|protected|internal|static|final|abstract|async|extern|pub|val|sub|select|insert|update|create|alter|drop|from|where|join|group by|order by)\b/i,
  ],
  // An s-expression opened by a declaration or special form, which puts the name after the
  // bracket. Lower case only, so a parenthetical sentence such as `(When it is gray, ...)` is prose.
  [
    3,
    /^\s*\((?:def|defn|defun|defmacro|defvar|defparameter|defconst|defconstant|defcustom|defstruct|defclass|defmethod|defonce|define|lambda|fn|let\*?|setq|setf|ns|require|progn|cond|when|unless)(?=[\s()[\]{}]|$)/,
  ],
  // The same bracket closing or opening two forms at once, as in `color))` and `((color`. A
  // mixed pair is a citation in prose, as in `(see [1])` and `([1])`. A run after `:`, `;`,
  // `=` or `-` is a face such as `:))`, which no Lisp writes.
  [
    3,
    /(?:(?<![:;=)-])\){2,}|(?<![:;=\]-])\]{2,}|(?<![:;=}-])\}{2,})\s*$|(?<![:;=(-])\(\(|(?<![:;=[-])\[\[|(?<![:;={-])\{\{/,
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
  [3, { test: isLoneCall }],
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

const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * The brackets of every kind left open so far, outside string and character literals. A
 * backslash escapes the character after it, as in `?\(` and `#\(` in Lisp and `\(` in
 * Clojure, and a quote either side of one character, as in `'('`, is a character literal.
 *
 * A closing bracket closes the innermost open one of its kind, and with it any opened inside
 * that never closed. One with none of its kind open is prose and closes nothing, as the `)`
 * of the interval `[a, b)` is.
 */
class Brackets {
  private readonly open: string[] = [];
  private readonly counts: Record<string, number> = { '(': 0, '[': 0, '{': 0 };
  /** Whether the text read so far ends inside a double-quoted string. */
  inString = false;
  /** How many closing brackets closed nothing. */
  stray = 0;

  get depth(): number {
    return this.open.length;
  }

  /** Reads one line, and returns the fewest brackets that were open at any point on it. */
  read(line: string): number {
    let low = this.open.length;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '\\') i++;
      else if (c === '"') this.inString = !this.inString;
      else if (this.inString) continue;
      else if (c === "'") {
        const close = line[i + 1] === '\\' ? i + 3 : i + 2;
        if (line[close] === "'") i = close;
      } else if (c in this.counts) {
        this.open.push(c);
        this.counts[c]!++;
      } else if (c in OPENER) {
        const opener = OPENER[c]!;
        if (this.counts[opener] === 0) {
          this.stray++;
          continue;
        }
        let top: string;
        do {
          top = this.open.pop()!;
          this.counts[top]!--;
        } while (top !== opener);
        low = Math.min(low, this.open.length);
      }
    }
    return low;
  }

  clear(): void {
    this.open.length = 0;
    for (const kind in this.counts) this.counts[kind] = 0;
    this.inString = false;
  }
}

const CALLEE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(/;
/** What prose puts in brackets after a word to allow for its plural, as in `color(s)`. */
const PLURAL_ENDING = /^e?s$/i;

/** A line that is one call and nothing else, as in `pick(color)` or `theme.render(color, size)`. */
function isLoneCall(line: string): boolean {
  const callee = CALLEE.exec(line);
  if (!callee || !line.endsWith(')')) return false;
  const args = line.slice(callee[0].length, -1);
  // A backslash there escapes the closing bracket.
  if (PLURAL_ENDING.test(args) || args.endsWith('\\')) return false;
  const brackets = new Brackets();
  brackets.read(args);
  return brackets.depth === 0 && brackets.stray === 0 && !brackets.inString;
}

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
 * Marks every line of a comment that reads as code. Each line is judged by itself rather
 * than the whole comment at once, so a block comment can hold prose and an `@example`.
 *
 * The exception is a form. A line that reads as code and leaves a bracket open opens one,
 * and every line up to the one that closes it is code as well, however it reads alone: the
 * body of a commented-out block, or the inside of a Lisp form. A form may run to the end of
 * the comment and no further, and one still open there marks no line of its own.
 */
export function commentedCodeRanges(text: string, markers: string[] = []): Range[] {
  const lines = text.split('\n');
  const code = lines.map((line) => looksLikeCode(line, markers));
  // Each closed form adds one at its first line and takes it away after its last.
  const cover = new Array<number>(lines.length + 1).fill(0);
  // Innermost last, so the depth each closes at rises along the stack.
  const forms: Array<{ line: number; closesAt: number }> = [];
  const brackets = new Brackets();

  lines.forEach((line, i) => {
    // The brackets of a comment commented out are prose, and open and close no form.
    const low = isDoubleCommented(line, markers) ? brackets.depth : brackets.read(line);
    let closes = false;
    while (forms.length > 0 && forms.at(-1)!.closesAt >= low) {
      cover[forms.pop()!.line]!++;
      cover[i + 1]!--;
      closes = true;
    }
    if ((code[i] || closes) && brackets.depth > low) forms.push({ line: i, closesAt: low });
    // Only a form's brackets count, and a string runs on to the next line only inside one,
    // as a docstring does.
    if (forms.length === 0) brackets.clear();
  });

  const ranges: Range[] = [];
  let offset = 0;
  let covered = 0;
  lines.forEach((line, i) => {
    covered += cover[i]!;
    if (line.length > 0 && (code[i] || covered > 0)) ranges.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  });
  return ranges;
}
