import type { Range } from './apply.js';
import { commentedCodeRanges } from './code-shape.js';
import { collectVerbatimBlocks } from './indented-code.js';
import type { Syntax } from '../types.js';

/**
 * Names that contain an Americanism as part of their identity. Pearl Harbor does not
 * become Pearl Harbour, and in Australia the Labor Party is spelt that way on purpose.
 */
const PROPER_NOUNS: RegExp[] = [
  /\bPearl Harbor\b/g,
  /\b[A-Z][a-z]+ Harbor\b/g,
  /\bHarbor (?:Freight|City|View|Bridge|Island|Boulevard|Blvd)\b/g,
  /\b(?:One )?World Trade Cent(?:er|re)\b/g,
  /\b(?:Rockefeller|Lincoln|Kennedy|Barclays|Javits|Moscone) Center\b/g,
  /\bCenter for [A-Z]\w+/g,
  // Two or more capitalised words before it make an institution's name rather than a
  // common noun: the Storm Prediction Center keeps its spelling, a data centre does not.
  /\b(?:[A-Z][a-z]+\s+){2,}Cent(?:er|re)s?\b/g,
  /\bCenters? for Disease Control\b/g,
  /\b(?:Department|Secretary|Office) of Defense\b/g,
  /\bDefense (?:Department|Intelligence|Advanced|Logistics)\b/g,
  /\b(?:Australian )?Labor (?:Party|MP|MPs|government|Government|leader|senator|Senator|caucus)\b/g,
  /\bLabor Day\b/g,
  /\brigor mortis\b/gi,
  /\bThe Color (?:Purple|of Money)\b/g,
  /\bFahrenheit 451\b/g,
  // Trademarks keep their American spelling and capitalisation.
  /\bBand-Aid\b/g,
  /\bPopsicle\b/g,
  /\bQ-tips?\b/g,
  /\bDumpster\b/g,
  /\bRealtors?\b/g,
  /\bScotch Tape\b/g,
  /\bJell-O\b/g,
  // Licences: the noun is `licence`, but these are names.
  /\bLICENSE\b/g,
  /\bSPDX-License-Identifier\b/g,
  /\b[A-Z][A-Za-z0-9.+-]* License\b/g,
  /\bLicense (?:Agreement|Version|File|Key)\b/g,
  // Languages and products.
  /\bProlog\b/g,
  /\bDatalog\b/g,
  /\bProgram Files\b/g,
  /\bGray(?=\s+[A-Z])/g,
  /\b[A-Z][a-z]+ Gray\b/g,
  /\bGray'?s Anatomy\b/g,
];

/** An odd run of backslashes, which escapes the character after it. */
const ESCAPE = /(?<!\\)(?:\\\\)*\\/.source;

/**
 * The start of a line that ends the paragraph above it: a blank line, or a heading, quote,
 * list item, fence, rule, setext underline or table row. A missed break lets an unpaired
 * backtick pair with one in the next block and expose the code there, so this errs towards
 * a break, which only leaves a span that wraps onto such a line unprotected.
 */
const PARAGRAPH_BREAK =
  /[ \t]*(?:\r?\n|#{1,6}(?![^ \t\r\n])|>|[-+*](?![^ \t\r\n])|\d{1,9}[.)](?![^ \t\r\n])|`{3}|~{3}|\||(?:[-*_=][ \t]*)+\r?\n)/
    .source;

/** A line that is a block by itself, so no paragraph runs on below it: a heading, fence or table row. */
const ONE_LINE_BLOCK = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]|`{3}|~{3}|\|)[^\n]*/.source;

/**
 * An inline code span as CommonMark reads one: a backtick string closed by the next string of
 * the same length, so ``a ` b`` is one span. It may wrap onto the next line of its paragraph.
 * A backtick with no partner before the paragraph ends, or one escaped with a backslash,
 * opens nothing.
 */
const CODE_SPAN = new RegExp(
  String.raw`(?:(?<!\`|${ESCAPE})|(?<=${ESCAPE}\`))(\`+)(?!\`)` +
    String.raw`(?:[^\`\n]|(?<!${ONE_LINE_BLOCK})\n(?!${PARAGRAPH_BREAK})|(?!\1(?!\`))\`+(?!\`))*\1(?!\`)`,
  'g',
);

/**
 * A line that starts with a run of three or more backticks or tildes, split into its quote
 * markers, its list markers (or the `*` that starts each line of a block comment), its
 * indentation, the run, and the rest of the line.
 */
const FENCE_LINE = /^((?:[ \t]*>)*)((?:[ \t]*(?:[-+*]|\d{1,9}[.)])(?=[ \t]))*)([ \t]*)(`{3,}|~{3,})([^\r\n]*)/;

interface OpenFence {
  /** Where the opening run starts. */
  start: number;
  run: string;
  quotes: string;
  /** The quote and list markers before the run. */
  prefix: string;
  /** The indentation between the markers and the run. */
  indent: number;
  /** The column the run starts at. */
  column: number;
}

/** Whether a fence line closes the open fence: a bare run of its character, at least as long. */
function closesFence(line: RegExpExecArray, open: OpenFence): boolean {
  const [, quotes = '', markers = '', indent = '', run = '', rest = ''] = line;
  if (run[0] !== open.run[0] || run.length < open.run.length || !/^[ \t]*$/.test(rest)) return false;
  if (quotes + markers === open.prefix) return indent.length <= open.indent + 3;
  return quotes === open.quotes && markers === '' && quotes.length + indent.length <= open.column + 3;
}

/**
 * Fenced code blocks as CommonMark reads them: a line that starts with three or more backticks
 * or tildes, closed by a line of the same character at least as long, or by the end of the text
 * if nothing closes it. A backtick fence's info string holds no backtick, so ```a``` is a code
 * span wherever it sits.
 *
 * The list items and quotes a fence sits in are read from its own lines. The opening run may sit
 * any distance in, since a fence in a nested list item sits four or more spaces in. The closing
 * run may sit at most three columns further in than the opening one, which is CommonMark's limit
 * counted from the fence, and needs the same quote markers. It either repeats the opening line's
 * markers, as each line of a block comment repeats its `*`, or drops the list markers and is
 * measured from the start of the line, as a list item's lines are.
 */
function collectFencedCode(text: string, into: Range[]): void {
  let open: OpenFence | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const fence = FENCE_LINE.exec(line);
    if (fence && open && closesFence(fence, open)) {
      into.push({ start: open.start, end: offset + line.length });
      open = undefined;
    } else if (fence && !open) {
      const [, quotes = '', markers = '', indent = '', run = '', rest = ''] = fence;
      if (!(run.startsWith('`') && rest.includes('`'))) {
        const column = quotes.length + markers.length + indent.length;
        open = { start: offset + column, run, quotes, prefix: quotes + markers, indent: indent.length, column };
      }
    }
    offset += line.length + 1;
  }
  if (open) into.push({ start: open.start, end: text.length });
}

/** Fenced code in plain text: three backticks, to the next three anywhere. */
const BACKTICK_PAIRS = /`{3}[\s\S]*?`{3}/g;

/**
 * An initialism, where every part is one or two letters followed by a stop: `U.S.`, `Ph.D.`,
 * `p.m.`, `e.g.`, and a plural such as `P.M.s`. A dotted token of this shape is never a dotted
 * name or a file name.
 */
const INITIALISM = String.raw`(?:(?:[A-Za-z]{1,2}\.){2,}s|(?:[A-Za-z]{1,2}\.)+)(?!\w)`;

/**
 * A unit straight after a number, as in `300 lb.ft` and `32 ft/s/s`, or after a number and a
 * degree sign, as in `225°F/low/slow`, or joined to one, as in `5ft.tall`, `1/2lb.ft` and
 * `3p.m.`. The measurement and time rules read these, so a token here is never a file name or
 * an unrooted path. After a hyphen, a word of up to three letters is a unit, as in `25-lb.ft`,
 * and a longer one is a name, as in `01-colors.md`. The number holds no comma, or a list such
 * as `1,2,3` would be walked to its end from every item.
 */
const UNIT_AFTER_NUMBER =
  String.raw`(?<=(?<![A-Za-z_])\d(?:[^\S\r\n]*[°º˚])?[^\S\r\n]*)|` +
  String.raw`[\d./-]*\d(?:[A-Za-z]|-[A-Za-z]{1,3}\.)`;

/** An extension in one case, so `color.It` is the next sentence run on rather than a file. */
const EXTENSION = String.raw`\.(?:[a-z][a-z\d]*|[A-Z][A-Z\d]*)(?![\w-])`;

/**
 * A file name: a name holding a letter, then a dot and an extension, with no space either side
 * of the dot, as in `behavior.ts`, `Center.vue`, `color-picker.tsx` and `GRAY.PNG`. A name with
 * no letter is a number, as in `3.5mi`.
 */
const FILE_NAME =
  String.raw`(?!${INITIALISM})(?![\d_.-]*${EXTENSION}(?!\.\w))` +
  String.raw`\.?\w[\w-]*(?:\.[\w-]+)*${EXTENSION}`;

const SEPARATOR = String.raw`[\\/]`;

/** A segment of a path, or `.` and `..` before a separator. */
const SEGMENT = String.raw`(?:\.{1,2}(?=[\\/])|\.?[\w@][\w@-]*(?:\.[\w@-]+)*)`;

/** `/`, `./`, `../`, `~/` or a drive letter, with either separator after all but the first. */
const ROOT = String.raw`(?:(?:\.{1,2}|~|[A-Za-z]:)[\\/]|\/)`;

/**
 * A path, held whole: one that starts at a root, runs to three or more segments, or ends in a
 * file name. Two words joined by a slash, as in `color/flavor` or `src/colors`, stay prose.
 */
const PATH = new RegExp(
  String.raw`(?<![\w.~@\\/-])(?=[\w.~@:\\/-]*?[A-Za-z])` +
    String.raw`(?:${ROOT}${SEGMENT}(?:${SEPARATOR}${SEGMENT})*` +
    String.raw`|(?!${UNIT_AFTER_NUMBER})${SEGMENT}(?:${SEPARATOR}${SEGMENT}){2,}` +
    String.raw`|(?!${UNIT_AFTER_NUMBER})${SEGMENT}${SEPARATOR}${FILE_NAME})`,
  'g',
);

/** Code spans and code blocks, read by the rules of the text's syntax. */
function collectCode(text: string, syntax: Syntax | undefined, into: Range[]): void {
  collect(text, [CODE_SPAN], into);
  if (syntax === 'text') collect(text, [BACKTICK_PAIRS], into);
  else collectFencedCode(text, into);
  if (syntax === 'markdown') collectVerbatimBlocks(text, into);
}

const STRUCTURAL: RegExp[] = [
  /\bhttps?:\/\/\S+/g,
  /\bwww\.\S+/g,
  // Starting only where the token starts, so a long dotted token is walked once, not once per word.
  /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /<[a-zA-Z/][^>\n]*>/g,
  PATH,
  // Never after a separator: `PATH` holds those, and starting there walks a path once per segment.
  new RegExp(String.raw`(?<![\w$@.\\/-])(?!${UNIT_AFTER_NUMBER})${FILE_NAME}`, 'g'),
];

/**
 * Things that look like code rather than prose. Rewriting `background-color` or
 * `normalizeInput` inside a comment breaks the reference it was making.
 */
const IDENTIFIERS: RegExp[] = [
  /\b[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b/g,
  /\b\w*_\w+\b/g,
  // Starting only where the token starts, so `M.s` inside `P.M.s` is never a name of its own.
  new RegExp(String.raw`\b(?<![\w$]\.)(?!${INITIALISM})[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b`, 'g'),
  /\b[A-Za-z_$][\w$]*\s*\(\s*\)/g,
  /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/g,
  /--?[A-Za-z][\w-]*/g,
  // A doc tag, its type braces and the identifier it names: `@param {string} color`.
  /@[a-zA-Z]+(?:\s*\{[^}\n]*\})?(?:\s+\[?[\w$.]+\]?)?/g,
];

/** Stems that turn a two-part kebab token into an API name rather than prose. */
const KEBAB_STEMS = new Set([
  'color', 'colors', 'center', 'centers', 'gray', 'normalize', 'serialize', 'deserialize',
  'initialize', 'behavior', 'license', 'catalog', 'dialog', 'analog', 'meter', 'meters',
  'liter', 'liters', 'fiber', 'defense', 'offense', 'artifact', 'artifacts', 'organization',
  'authorization', 'optimize', 'sanitize', 'tokenize',
]);

const KEBAB = /\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g;

function collectTechnicalKebab(text: string, into: Range[]): void {
  KEBAB.lastIndex = 0;
  for (const match of text.matchAll(KEBAB)) {
    if (match[0].split('-').some((segment) => KEBAB_STEMS.has(segment))) {
      into.push({ start: match.index, end: match.index + match[0].length });
    }
  }
}

const IGNORE_LINE = /^.*\bdeamericanise-ignore\b.*$/gim;
const IGNORE_BLOCK = /\bdeamericanise-ignore-start\b[\s\S]*?\bdeamericanise-ignore-end\b/gi;

export interface ProtectOptions {
  properNouns: boolean;
  /** Treat identifier-shaped tokens as code. On for source files, off for prose. */
  identifiers: boolean;
  /** Skip whole lines that read as commented-out code. */
  commentedCode: boolean;
  /** The host language's line-comment markers, for spotting a double-commented line. */
  commentMarkers: string[];
  /** The text's markup, which decides how code fences, indented code and HTML blocks are read. */
  syntax: Syntax | undefined;
  /** The text comes from a parsed document, so a backtick in it is literal and opens no code. */
  parsed: boolean;
  extra: RegExp[];
}

function collect(text: string, patterns: RegExp[], into: Range[]): void {
  for (const pattern of patterns) {
    const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
    global.lastIndex = 0;
    for (const match of text.matchAll(global)) {
      if (match[0].length > 0) into.push({ start: match.index, end: match.index + match[0].length });
    }
  }
}

export function protectedRanges(text: string, options: ProtectOptions): Range[] {
  const ranges: Range[] = [];
  collect(text, [IGNORE_BLOCK, IGNORE_LINE, ...STRUCTURAL], ranges);
  if (!options.parsed) collectCode(text, options.syntax, ranges);
  if (options.properNouns) collect(text, PROPER_NOUNS, ranges);
  if (options.identifiers) {
    collect(text, IDENTIFIERS, ranges);
    collectTechnicalKebab(text, ranges);
  }
  if (options.commentedCode) ranges.push(...commentedCodeRanges(text, options.commentMarkers));
  if (options.extra.length) collect(text, options.extra, ranges);
  return ranges;
}

/** Turns the user's `protect` strings into whole-word patterns. */
export function toPatterns(entries: (string | RegExp)[]): RegExp[] {
  return entries.map((entry) =>
    typeof entry === 'string'
      ? new RegExp(`(?<![A-Za-z0-9_])${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g')
      : entry,
  );
}
