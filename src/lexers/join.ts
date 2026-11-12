import type { Range } from '../engine/apply.js';
import type { Change } from '../types.js';
import { scanSourceComments, type LexerSpec, type SourceComment } from './scan.js';

/** A stretch of a comment's text copied unchanged from the source. */
interface Segment {
  /** Where it starts in the text. */
  at: number;
  /** Where it starts in the source. */
  source: number;
  length: number;
}

/**
 * The prose of one comment, or of a run of line comments, read the way its author wrote it:
 * each line's comment marker, and the `*` that decorates each line of a block comment, are
 * taken out, so a line holding only `//` or `*` is a blank line and the text is Markdown.
 */
export interface CommentText {
  text: string;
  segments: Segment[];
  /**
   * The newlines in `text` that also stand for a marker or decoration in the source. A change
   * across one could not put the marker back, so no change may overlap one.
   */
  boundaries: Range[];
}

type Bounds = [start: number, end: number];

/**
 * Where a comment's prose starts. The extra character of a doc comment belongs to its marker,
 * as in `///`, `//!`, `---` and `/**`, when whitespace or the end of the comment follows it.
 * A repeat as long as the marker, as in `////` or `##`, makes a second marker instead, and
 * stays in the text so the line still reads as a comment commented out.
 */
function proseStart(source: string, comment: SourceComment): number {
  const { open, start, end } = comment;
  let i = start;
  while (i < end && i - start < open.length && source[i] === open.at(-1)) i++;
  if (i - start === open.length) return start;
  if (i < end && source[i] === '!' && (open === '//' || open === '/*')) i++;
  return i === end || /\s/.test(source[i]!) ? i : start;
}

/** The column a position sits at on its line. */
function columnOf(source: string, index: number): number {
  return index - (source.lastIndexOf('\n', index - 1) + 1);
}

/**
 * Each line of a block comment. A block whose opener ends in `*`, as `/*` does, may decorate
 * its lines with one, as JSDoc does. That `*` is taken out when every line after the first
 * that holds anything starts with it, since a comment that leaves it off a line may hold a
 * `*` bullet list.
 */
function blockLines(source: string, comment: SourceComment): Bounds[] {
  const lines: Bounds[] = [];
  let start = proseStart(source, comment);
  for (;;) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 || newline >= comment.end ? comment.end : newline;
    lines.push([start, end]);
    if (end === comment.end) break;
    start = end + 1;
  }
  if (!comment.open.endsWith('*')) return lines;

  const rest = lines.slice(1).map(([s, e]) => source.slice(s, e));
  const decorated = rest.every((line) => /^\s*$/.test(line) || /^[ \t]*\*/.test(line));
  if (!decorated) return lines;
  rest.forEach((line, i) => {
    const decoration = /^[ \t]*\*/.exec(line);
    if (decoration) lines[i + 1]![0] += decoration[0].length;
  });
  return lines;
}

function joinLines(source: string, lines: Bounds[]): CommentText {
  const segments: Segment[] = [];
  const boundaries: Range[] = [];
  let text = '';
  for (const [start, end] of lines) {
    const previous = segments.at(-1);
    if (previous) {
      if (start !== previous.source + previous.length + 1) {
        boundaries.push({ start: text.length, end: text.length + 1 });
      }
      text += '\n';
    }
    segments.push({ at: text.length, source: start, length: end - start });
    text += source.slice(start, end);
  }
  return { text, segments, boundaries };
}

interface Run {
  prefix: string;
  column: number;
  end: number;
  lines: Bounds[];
}

/**
 * Reads each comment as prose, joining a run of line comments into one text. A run is line
 * comments on consecutive lines with the same marker at the same column, each after the first
 * alone on its line, so a comment trailing code joins only the comments lined up beneath it.
 */
export function joinComments(source: string, comments: SourceComment[]): CommentText[] {
  const texts: CommentText[] = [];
  let run: Run | undefined;
  const flush = (): void => {
    if (run) texts.push(joinLines(source, run.lines));
    run = undefined;
  };

  for (const comment of comments) {
    if (comment.kind !== 'line') {
      flush();
      const lines = comment.kind === 'block' ? blockLines(source, comment) : [[comment.start, comment.end] as Bounds];
      texts.push(joinLines(source, lines));
      continue;
    }

    const marker = comment.start - comment.open.length;
    const start = proseStart(source, comment);
    const prefix = source.slice(marker, start);
    const column = columnOf(source, marker);
    if (run?.prefix === prefix && run.column === column && /^\n[ \t]*$/.test(source.slice(run.end, marker))) {
      run.lines.push([start, comment.end]);
      run.end = comment.end;
    } else {
      flush();
      run = { prefix, column, end: comment.end, lines: [[start, comment.end]] };
    }
  }
  flush();
  return texts;
}

/** The prose of every comment in a source file. */
export function commentTexts(source: string, lexer: LexerSpec, includeDocs = false): CommentText[] {
  return joinComments(source, scanSourceComments(source, lexer, includeDocs));
}

/** The last segment that starts at or before `at`. */
function segmentAt(segments: Segment[], at: number): Segment {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (segments[middle]!.at <= at) low = middle;
    else high = middle - 1;
  }
  return segments[low]!;
}

function sourceOffset(comment: CommentText, at: number): number {
  const segment = segmentAt(comment.segments, at);
  return segment.source + at - segment.at;
}

/** Moves changes found in a comment's text to where their text sits in the source. */
export function changesInSource(comment: CommentText, changes: Change[]): Change[] {
  return changes.map((change) => {
    const moved = { ...change, start: sourceOffset(comment, change.start), end: sourceOffset(comment, change.end) };
    if (change.agreesWith) {
      moved.agreesWith = {
        start: sourceOffset(comment, change.agreesWith.start),
        end: sourceOffset(comment, change.agreesWith.end),
      };
    }
    return moved;
  });
}
