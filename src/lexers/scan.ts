export interface Span {
  start: number;
  end: number;
}

/** A comment's text, with the delimiter that opened it. */
export interface SourceComment extends Span {
  /** `doc` is a documentation string, such as a Python docstring. */
  kind: 'line' | 'block' | 'doc';
  open: string;
}

export interface StringSpec {
  open: string;
  close: string;
  /** Backslash escaping. */
  escape?: boolean;
  /** A doubled closing delimiter escapes it, as in SQL `''`. */
  doubled?: boolean;
  /** May span newlines. Single-line strings end at the newline, which keeps a stray
   *  apostrophe in a comment from swallowing the rest of the file. */
  multiline?: boolean;
  /** Treat the contents as documentation rather than data, e.g. a Python docstring. */
  doc?: boolean;
}

export interface LexerSpec {
  id: string;
  extensions: string[];
  filenames?: string[];
  /** Names people actually type: `ruby` rather than `rb`, `shell` rather than `sh`. */
  aliases?: string[];
  lineComments: string[];
  blockComments: Array<[open: string, close: string]>;
  /** Rust and Haskell allow a block comment inside a block comment. */
  nestedBlocks?: boolean;
  strings: StringSpec[];
  /** Skip `/regex/` literals so the slashes inside them are not read as comments. */
  regexLiterals?: boolean;
}

/** A `/` opens a regex only where a value is expected, never after one. */
const REGEX_ALLOWED_BEFORE = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n',
]);

const KEYWORD_BEFORE = /\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|yield|await|case)\s*$/;

function previousSignificant(source: string, index: number): { char: string; upto: string } {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i]!)) i--;
  return { char: i >= 0 ? source[i]! : '\n', upto: source.slice(0, i + 1) };
}

function startsWith(source: string, index: number, token: string): boolean {
  return source.startsWith(token, index);
}

/**
 * Walks the source once, tracking whether it is inside a string, a comment or neither.
 * Only the comment spans come back, so `// not a comment` inside a string stays put.
 */
export function scanComments(source: string, spec: LexerSpec, includeDocs = false): Span[] {
  return scanSourceComments(source, spec, includeDocs).map(({ start, end }) => ({ start, end }));
}

/** `scanComments`, with what opened each comment. */
export function scanSourceComments(source: string, spec: LexerSpec, includeDocs = false): SourceComment[] {
  const spans: SourceComment[] = [];
  const blocks = [...spec.blockComments].sort((a, b) => b[0].length - a[0].length);
  const lines = [...spec.lineComments].sort((a, b) => b.length - a.length);
  const strings = [...spec.strings].sort((a, b) => b.open.length - a.open.length);

  let i = 0;
  const n = source.length;

  outer: while (i < n) {
    // Block comments, checked before line comments so `--[[` beats `--`.
    for (const [open, close] of blocks) {
      if (!startsWith(source, i, open)) continue;
      const contentStart = i + open.length;
      let depth = 1;
      let j = contentStart;
      while (j < n && depth > 0) {
        if (spec.nestedBlocks && startsWith(source, j, open)) {
          depth++;
          j += open.length;
        } else if (startsWith(source, j, close)) {
          depth--;
          j += close.length;
        } else {
          j++;
        }
      }
      const contentEnd = depth === 0 ? j - close.length : n;
      spans.push({ start: contentStart, end: contentEnd, kind: 'block', open });
      i = j;
      continue outer;
    }

    for (const marker of lines) {
      if (!startsWith(source, i, marker)) continue;
      const contentStart = i + marker.length;
      const newline = source.indexOf('\n', contentStart);
      const end = newline === -1 ? n : newline;
      spans.push({ start: contentStart, end, kind: 'line', open: marker });
      i = end;
      continue outer;
    }

    for (const string of strings) {
      if (!startsWith(source, i, string.open)) continue;
      const contentStart = i + string.open.length;
      let j = contentStart;
      let closed = false;
      while (j < n) {
        const char = source[j]!;
        if (string.escape && char === '\\') {
          j += 2;
          continue;
        }
        if (!string.multiline && char === '\n') break;
        if (startsWith(source, j, string.close)) {
          if (string.doubled && startsWith(source, j + string.close.length, string.close)) {
            j += string.close.length * 2;
            continue;
          }
          closed = true;
          j += string.close.length;
          break;
        }
        j++;
      }
      if (includeDocs && string.doc && closed) {
        spans.push({ start: contentStart, end: j - string.close.length, kind: 'doc', open: string.open });
      }
      i = closed ? j : contentStart;
      continue outer;
    }

    if (spec.regexLiterals && source[i] === '/') {
      const { char, upto } = previousSignificant(source, i);
      if (REGEX_ALLOWED_BEFORE.has(char) || KEYWORD_BEFORE.test(upto)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const char2 = source[j]!;
          if (char2 === '\\') {
            j += 2;
            continue;
          }
          if (char2 === '\n') break;
          if (char2 === '[') inClass = true;
          else if (char2 === ']') inClass = false;
          else if (char2 === '/' && !inClass) {
            j++;
            break;
          }
          j++;
        }
        i = j;
        continue;
      }
    }

    i++;
  }

  return spans;
}
