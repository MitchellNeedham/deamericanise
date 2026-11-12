import { applyChanges } from './engine/apply.js';
import { detectAmerican } from './engine/detect.js';
import { resolveOptions } from './config.js';
import { lexerFor, PROSE_EXTENSIONS } from './lexers/index.js';
import { changesInSource, commentTexts } from './lexers/join.js';
import { findChanges, transformProse } from './transform.js';
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
  const comments = commentTexts(source, lexer, docstrings ?? false);

  // The verdict on whether this file is American comes from its prose, not its syntax.
  const prose = comments.map((c) => c.text).join('\n');
  const signals =
    resolved.assumeAmerican === undefined
      ? detectAmerican(prose)
      : { ...detectAmerican(prose), confidence: resolved.assumeAmerican ? 1 : 0 };

  const changes: Change[] = [];
  for (const comment of comments) {
    const found = findChanges({ text: comment.text, options: resolved, signals, boundaries: comment.boundaries });
    changes.push(...changesInSource(comment, found));
  }

  changes.sort((a, b) => a.start - b.start);
  return { text: applyChanges(source, changes), changes, signals };
}

/** Strips the options that only mean something to a source file. */
function proseOptions({ language, docstrings, ...rest }: CodeOptions): Options {
  return rest;
}

function isProseLanguage(language: string): boolean {
  return PROSE_EXTENSIONS.has(language.replace(/^\./, '').toLowerCase());
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/**
 * Rewrites a prose file of the given type. A prose type other than Markdown, such as `rst` or
 * `txt`, turns off CommonMark's fences, since a line of tildes there underlines a heading or
 * divides sections. A type that is not a prose type says nothing, so it is read as
 * `deamericanise` reads text.
 */
function deamericaniseProse(source: string, type: string, options: CodeOptions): Result {
  const resolved = resolveOptions(proseOptions(options));
  const cleaned = type.replace(/^\./, '').toLowerCase();
  resolved.markdownFences = MARKDOWN_EXTENSIONS.has(cleaned) || !PROSE_EXTENSIONS.has(cleaned);
  return transformProse(source, resolved);
}

/** Whether `deamericaniseFile` accepts this as `language`: a prose type or a name `lexerFor` knows. */
export function isKnownLanguage(language: string): boolean {
  return isProseLanguage(language) || Boolean(lexerFor(language));
}

/**
 * Picks prose or comment-only handling from the filename. A `language` option overrides the
 * filename: a prose type such as `md` reads the source as prose, and anything else must name
 * a lexer or this throws `UnknownLanguageError`.
 */
export function deamericaniseFile(filename: string, source: string, options: CodeOptions = {}): Result {
  if (options.language !== undefined) {
    if (isProseLanguage(options.language)) return deamericaniseProse(source, options.language, options);
    return deamericaniseCode(source, options);
  }
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const isProse = PROSE_EXTENSIONS.has(extension) || !lexerFor(filename);
  if (isProse) return deamericaniseProse(source, extension, options);
  return deamericaniseCode(source, { ...options, language: filename });
}
