import { applyChanges, offsetChanges } from './engine/apply.js';
import { detectAmerican } from './engine/detect.js';
import { resolveOptions } from './config.js';
import { commentSpans, lexerFor, PROSE_EXTENSIONS } from './lexers/index.js';
import { deamericanise, findChanges } from './transform.js';
import type { Change, Options, Result } from './types.js';

export interface CodeOptions extends Options {
  /** A language id (`python`), an extension (`.ts`) or a filename (`Dockerfile`). */
  language?: string;
  /**
   * Also rewrite documentation strings such as Python docstrings. Off by default,
   * because a docstring is a string literal and something may be asserting on it.
   */
  docstrings?: boolean;
}

export class UnknownLanguageError extends Error {
  constructor(public readonly language: string) {
    super(`No lexer for "${language}". Pass a known language, or treat the file as prose.`);
    this.name = 'UnknownLanguageError';
  }
}

/**
 * Rewrites only the comments of a source file. Code, string literals and identifiers are
 * left exactly as they were, so the file still compiles and still does the same thing.
 */
export function deamericaniseCode(source: string, options: CodeOptions = {}): Result {
  const { language, docstrings, ...rest } = options;
  const lexer = lexerFor(language ?? '');
  if (!lexer) throw new UnknownLanguageError(language ?? '(none given)');

  const resolved = resolveOptions(rest, { protectIdentifiers: true });
  // Lets the detector spot a line that was commented on top of a comment.
  resolved.commentMarkers = lexer.lineComments;
  const spans = commentSpans(source, lexer, docstrings ?? false);

  // The verdict on whether this file is American comes from its prose, not its syntax.
  const prose = spans.map((s) => source.slice(s.start, s.end)).join('\n');
  const signals =
    resolved.assumeAmerican === undefined
      ? detectAmerican(prose)
      : { ...detectAmerican(prose), confidence: resolved.assumeAmerican ? 1 : 0 };

  const changes: Change[] = [];
  for (const span of spans) {
    const text = source.slice(span.start, span.end);
    changes.push(...offsetChanges(findChanges({ text, options: resolved, signals }), span.start));
  }

  changes.sort((a, b) => a.start - b.start);
  return { text: applyChanges(source, changes), changes, signals };
}

/** Strips the options that only mean something to a source file. */
function proseOptions({ language, docstrings, ...rest }: CodeOptions): Options {
  return rest;
}

/** Picks prose or comment-only handling from the filename. */
export function deamericaniseFile(filename: string, source: string, options: CodeOptions = {}): Result {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const isProse = PROSE_EXTENSIONS.has(extension) || !lexerFor(filename);
  if (isProse) return deamericanise(source, proseOptions(options));
  return deamericaniseCode(source, { ...options, language: options.language ?? filename });
}
