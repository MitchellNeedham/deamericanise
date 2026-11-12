import type { Range } from './apply.js';

/**
 * The blocks CommonMark opens as it reads a document line by line. Only indented code is
 * collected. The rest decide where indented code may start: never inside a paragraph, and
 * four columns past the content of the list item or quote it sits in.
 */
type Block =
  | { kind: 'document' | 'quote' | 'paragraph' | 'heading' | 'break' }
  | { kind: 'item'; width: number; empty: boolean }
  | { kind: 'fence'; char: string; length: number; indent: number }
  | { kind: 'html'; type: number }
  | { kind: 'code'; start: number; end: number };

const CONTAINERS = new Set<Block['kind']>(['document', 'quote', 'item']);

const CODE_INDENT = 4;
const MAYBE_SPECIAL = /^[#`~*+_=<>0-9-]/;
const NON_SPACE = /[^ \t\f\v\r\n]/;
const THEMATIC_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const ATX_HEADING = /^#{1,6}(?:[ \t]+|$)/;
const CODE_FENCE = /^`{3,}(?!.*`)|^~{3,}/;
const CLOSING_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const BULLET = /^[*+-]/;
const ORDERED = /^(\d{1,9})([.)])/;

const ATTRIBUTE_VALUE = String.raw`(?:[^"'=<>\x60\x00-\x20]+|'[^']*'|"[^"]*")`;
const ATTRIBUTE = String.raw`(?:\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\s*=\s*${ATTRIBUTE_VALUE})?)`;
const OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*${ATTRIBUTE}*\s*\/?>`;
const CLOSE_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`;

/** The lines that open each of CommonMark's seven kinds of HTML block, by kind. */
const HTML_OPEN: Record<number, RegExp> = {
  1: /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  2: /^<!--/,
  3: /^<[?]/,
  4: /^<![A-Za-z]/,
  5: /^<!\[CDATA\[/,
  6: /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  7: new RegExp(`^(?:${OPEN_TAG}|${CLOSE_TAG})\\s*$`, 'i'),
};

/** What ends an HTML block of the first five kinds. The other two end at a blank line. */
const HTML_CLOSE: Record<number, RegExp> = {
  1: /<\/(?:script|pre|textarea|style)>/i,
  2: /-->/,
  3: /\?>/,
  4: />/,
  5: /\]\]>/,
};

const isSpaceOrTab = (c: string | undefined): boolean => c === ' ' || c === '\t';

/**
 * Reads block structure the way the CommonMark reference parser (commonmark.js) does, keeping
 * only what decides indented code: containers, paragraphs and the leaf blocks that end them.
 * Columns count tabs to the next multiple of four. Link reference definitions are read as the
 * paragraphs they sit in.
 */
class Scanner {
  private readonly open: Block[] = [{ kind: 'document' }];
  private line = '';
  private lineStart = 0;
  private offset = 0;
  private column = 0;
  private nextNonspace = 0;
  private nextNonspaceColumn = 0;
  /** Where the scan that found `nextNonspace` started. */
  private scanStart = Infinity;
  private indent = 0;
  private indented = false;
  private blank = false;
  private allClosed = true;
  private lastMatched = 0;

  constructor(private readonly into: Range[]) {}

  private get tip(): Block {
    return this.open[this.open.length - 1]!;
  }

  private findNextNonspace(): void {
    // Each container in turn looks for the same character, so a list nested deep scans its
    // indentation once rather than once per level. A tab ends on a fixed column, so the column
    // found does not depend on where the scan started.
    if (this.offset < this.scanStart || this.offset > this.nextNonspace) {
      let i = this.offset;
      let column = this.column;
      let c = this.line[i];
      while (c === ' ' || c === '\t') {
        column += c === ' ' ? 1 : 4 - (column % 4);
        c = this.line[++i];
      }
      this.scanStart = this.offset;
      this.nextNonspace = i;
      this.nextNonspaceColumn = column;
    }
    const c = this.line[this.nextNonspace];
    this.blank = c === undefined || c === '\r';
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  /** Moves past `count` characters, or past `count` columns of indentation when `columns` is set. */
  private advanceOffset(count: number, columns: boolean): void {
    let c: string | undefined;
    while (count > 0 && (c = this.line[this.offset]) !== undefined) {
      if (c === '\t') {
        const toTab = 4 - (this.column % 4);
        if (columns) {
          const advance = Math.min(toTab, count);
          this.column += advance;
          if (toTab <= count) this.offset += 1;
          count -= advance;
        } else {
          this.column += toTab;
          this.offset += 1;
          count -= 1;
        }
      } else {
        this.offset += 1;
        this.column += 1;
        count -= 1;
      }
    }
  }

  private advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
  }

  private close(): void {
    const block = this.open.pop()!;
    if (block.kind === 'code') this.into.push({ start: block.start, end: block.end });
  }

  private closeUnmatched(): void {
    if (this.allClosed) return;
    while (this.open.length - 1 > this.lastMatched) this.close();
    this.allClosed = true;
  }

  private addChild(block: Block): void {
    while (!CONTAINERS.has(this.tip.kind)) this.close();
    const parent = this.tip;
    if (parent.kind === 'item') parent.empty = false;
    this.open.push(block);
  }

  /** 0 if the line continues the block, 1 if it does not, 2 if it closed a fence and is done. */
  private continues(block: Block): 0 | 1 | 2 {
    switch (block.kind) {
      case 'document':
        return 0;
      case 'quote':
        if (this.indented || this.line[this.nextNonspace] !== '>') return 1;
        this.advanceNextNonspace();
        this.advanceOffset(1, false);
        if (isSpaceOrTab(this.line[this.offset])) this.advanceOffset(1, true);
        return 0;
      case 'item':
        if (this.blank) {
          if (block.empty) return 1;
          this.advanceNextNonspace();
        } else if (this.indent >= block.width) {
          this.advanceOffset(block.width, true);
        } else {
          return 1;
        }
        return 0;
      case 'fence': {
        const closing = this.indent <= 3 && this.line[this.nextNonspace] === block.char
          ? CLOSING_FENCE.exec(this.line.slice(this.nextNonspace))
          : null;
        if (closing && closing[0].length >= block.length) {
          this.close();
          return 2;
        }
        for (let i = block.indent; i > 0 && isSpaceOrTab(this.line[this.offset]); i--) {
          this.advanceOffset(1, true);
        }
        return 0;
      }
      case 'code':
        if (this.indented) this.advanceOffset(CODE_INDENT, true);
        else if (this.blank) this.advanceNextNonspace();
        else return 1;
        return 0;
      case 'html':
        return this.blank && block.type >= 6 ? 1 : 0;
      case 'paragraph':
        return this.blank ? 1 : 0;
      default:
        return 1;
    }
  }

  /** The content column of a list item starting here, measured from the current offset. */
  private listItem(container: Block): number | undefined {
    if (this.indent >= CODE_INDENT) return undefined;
    const rest = this.line.slice(this.nextNonspace);
    const markerOffset = this.indent;
    let marker = BULLET.exec(rest);
    if (!marker) {
      marker = ORDERED.exec(rest);
      // Only a list starting at 1 interrupts a paragraph.
      if (!marker || (container.kind === 'paragraph' && Number(marker[1]) !== 1)) return undefined;
    }
    const length = marker[0].length;
    const after = this.line[this.nextNonspace + length];
    if (after !== undefined && after !== ' ' && after !== '\t') return undefined;
    if (container.kind === 'paragraph' && !NON_SPACE.test(this.line.slice(this.nextNonspace + length))) {
      return undefined;
    }

    this.advanceNextNonspace();
    this.advanceOffset(length, true);
    const spacesColumn = this.column;
    const spacesOffset = this.offset;
    do this.advanceOffset(1, true);
    while (this.column - spacesColumn < 5 && isSpaceOrTab(this.line[this.offset]));
    const spaces = this.column - spacesColumn;
    // Five or more spaces after the marker start indented code inside the item.
    if (spaces >= 5 || spaces < 1 || this.line[this.offset] === undefined) {
      this.column = spacesColumn;
      this.offset = spacesOffset;
      if (isSpaceOrTab(this.line[this.offset])) this.advanceOffset(1, true);
      return markerOffset + length + 1;
    }
    return markerOffset + length + spaces;
  }

  /** Tries each block start in CommonMark's order: 0 for none, 1 for a container, 2 for a leaf. */
  private startBlock(container: Block): 0 | 1 | 2 {
    const rest = this.line.slice(this.nextNonspace);
    if (!this.indented) {
      if (rest[0] === '>') {
        this.advanceNextNonspace();
        this.advanceOffset(1, false);
        if (isSpaceOrTab(this.line[this.offset])) this.advanceOffset(1, true);
        this.closeUnmatched();
        this.addChild({ kind: 'quote' });
        return 1;
      }
      if (ATX_HEADING.test(rest)) {
        this.closeUnmatched();
        this.addChild({ kind: 'heading' });
        this.offset = this.line.length;
        return 2;
      }
      const fence = CODE_FENCE.exec(rest);
      if (fence) {
        this.closeUnmatched();
        this.addChild({ kind: 'fence', char: fence[0][0]!, length: fence[0].length, indent: this.indent });
        this.advanceNextNonspace();
        this.advanceOffset(fence[0].length, false);
        return 2;
      }
      if (rest[0] === '<') {
        const lazy = !this.allClosed && !this.blank && this.tip.kind === 'paragraph';
        for (let type = 1; type <= 7; type++) {
          // The seventh kind cannot interrupt a paragraph.
          if (HTML_OPEN[type]!.test(rest) && (type < 7 || (container.kind !== 'paragraph' && !lazy))) {
            this.closeUnmatched();
            this.addChild({ kind: 'html', type });
            return 2;
          }
        }
      }
      if (container.kind === 'paragraph' && SETEXT_UNDERLINE.test(rest)) {
        this.closeUnmatched();
        this.open[this.open.length - 1] = { kind: 'heading' };
        this.offset = this.line.length;
        return 2;
      }
      if (THEMATIC_BREAK.test(rest)) {
        this.closeUnmatched();
        this.addChild({ kind: 'break' });
        this.offset = this.line.length;
        return 2;
      }
      const width = this.listItem(container);
      if (width !== undefined) {
        this.closeUnmatched();
        this.addChild({ kind: 'item', width, empty: true });
        return 1;
      }
    } else if (this.tip.kind !== 'paragraph' && !this.blank) {
      const start = this.lineStart + this.nextNonspace;
      this.advanceOffset(CODE_INDENT, true);
      this.closeUnmatched();
      this.addChild({ kind: 'code', start, end: this.lineStart + this.line.length });
      return 2;
    }
    return 0;
  }

  /** Reads one line, without its line ending, that starts at `lineStart` in the text. */
  read(line: string, lineStart: number): void {
    this.line = line;
    this.lineStart = lineStart;
    this.offset = 0;
    this.column = 0;
    this.blank = false;
    this.scanStart = Infinity;
    const oldTip = this.open.length - 1;

    let matched = 0;
    for (let i = 1; i < this.open.length; i++) {
      this.findNextNonspace();
      const result = this.continues(this.open[i]!);
      if (result === 2) return;
      if (result === 1) break;
      matched = i;
    }
    this.allClosed = matched === oldTip;
    this.lastMatched = matched;

    let container = this.open[matched]!;
    let leaf = container.kind === 'fence' || container.kind === 'code' || container.kind === 'html';
    while (!leaf) {
      this.findNextNonspace();
      if (!this.indented && !MAYBE_SPECIAL.test(this.line.slice(this.nextNonspace))) {
        this.advanceNextNonspace();
        break;
      }
      const started = this.startBlock(container);
      if (started === 0) {
        this.advanceNextNonspace();
        break;
      }
      container = this.tip;
      leaf = started === 2;
    }

    // A line that would continue a paragraph keeps the containers it failed to match open.
    if (!this.allClosed && !this.blank && this.tip.kind === 'paragraph') return;
    this.closeUnmatched();
    if (container.kind === 'code') {
      if (!this.blank) container.end = this.lineStart + this.line.length;
    } else if (container.kind === 'html') {
      if (container.type <= 5 && HTML_CLOSE[container.type]!.test(this.line.slice(this.offset))) this.close();
    } else if (container.kind !== 'paragraph' && container.kind !== 'fence') {
      if (this.offset < this.line.length && !this.blank) this.addChild({ kind: 'paragraph' });
    }
  }

  finish(): void {
    while (this.open.length > 1) this.close();
  }
}

/**
 * Indented code blocks as CommonMark reads them: lines four or more columns past the content
 * of the list item or quote they sit in, opened after a blank line or any block that is not a
 * paragraph. A line indented that far inside a paragraph continues it, so a list item's
 * wrapped line or second paragraph stays prose. Each range runs from the first character of
 * the block's code to the end of its last line that is not blank.
 */
export function collectIndentedCode(text: string, into: Range[]): void {
  const scanner = new Scanner(into);
  let start = 0;
  for (const line of text.split('\n')) {
    scanner.read(line.endsWith('\r') ? line.slice(0, -1) : line, start);
    start += line.length + 1;
  }
  scanner.finish();
}
