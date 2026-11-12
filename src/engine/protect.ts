import type { Range } from './apply.js';
import { commentedCodeRanges } from './code-shape.js';

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

/** Fenced code in a prose file that is not Markdown: three backticks, to the next three anywhere. */
const BACKTICK_PAIRS = /`{3}[\s\S]*?`{3}/g;

const STRUCTURAL: RegExp[] = [
  /\bhttps?:\/\/\S+/g,
  /\bwww\.\S+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  CODE_SPAN,
  /<[a-zA-Z/][^>\n]*>/g,
];

/**
 * Things that look like code rather than prose. Rewriting `background-color` or
 * `normalizeInput` inside a comment breaks the reference it was making.
 */
const IDENTIFIERS: RegExp[] = [
  /\b[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b/g,
  /\b\w*_\w+\b/g,
  /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g,
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
  /** Read code fences by CommonMark's rule. Off for a prose file that is not Markdown. */
  markdownFences: boolean;
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
  if (options.markdownFences) collectFencedCode(text, ranges);
  else collect(text, [BACKTICK_PAIRS], ranges);
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
