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

const STRUCTURAL: RegExp[] = [
  /\bhttps?:\/\/\S+/g,
  /\bwww\.\S+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /`{3}[\s\S]*?`{3}/g,
  /`[^`\n]+`/g,
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
