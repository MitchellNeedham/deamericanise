import { describe, expect, it, vi } from 'vitest';
import remarkDeamericanise from '../src/plugins/remark.js';
import eslintPlugin from '../src/plugins/eslint.js';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  [key: string]: unknown;
}

const text = (value: string): Node => ({ type: 'text', value });
const paragraph = (...children: Node[]): Node => ({ type: 'paragraph', children });
const root = (...children: Node[]): Node => ({ type: 'root', children });

function run(tree: Node, options = {}): Node {
  return remarkDeamericanise(options)(tree);
}

function flatten(node: Node): string[] {
  if (node.value !== undefined) return [node.value];
  return (node.children ?? []).flatMap(flatten);
}

const EXPECTED_DIALECTS = 'Expected one of en-AU, en-GB, en-NZ, en-IE, en-ZA, en-CA.';

const REJECTED = [
  { options: { dialect: 'en-XX' }, message: `Unknown dialect: en-XX. ${EXPECTED_DIALECTS}` },
  { options: { dialect: 'toString' }, message: `Unknown dialect: toString. ${EXPECTED_DIALECTS}` },
  { options: { preset: 'Localise' }, message: 'Unknown preset: Localise. Expected one of read, localise.' },
  { options: { unitsKeep: ['furlong'] }, message: 'Unknown unit: furlong. Expected the key, name or abbreviation of one of inch,' },
];

const VALID = [
  { dialect: 'en-GB', preset: 'localise' },
  { categories: { spelling: false } },
  { unitsKeep: ['inches', 'MPH'] },
  {},
];

describe('the remark plugin', () => {
  it.each`
    input                              | expected
    ${'The color of the theater.'}     | ${'The colour of the theatre.'}
    ${'They canceled it.'}             | ${'They cancelled it.'}
    ${'It is 6 feet wide.'}            | ${'It is 1.8 metres wide.'}
  `('rewrites the text node "$input"', ({ input, expected }) => {
    const tree = root(paragraph(text(input)));
    expect(flatten(run(tree))).toEqual([expected]);
  });

  it.each`
    nodeType        | why
    ${'code'}       | ${'a fenced block'}
    ${'inlineCode'} | ${'a code span'}
    ${'html'}       | ${'raw markup'}
    ${'yaml'}       | ${'frontmatter'}
  `('never descends into a $nodeType node ($why)', ({ nodeType }) => {
    const tree = root({ type: nodeType as string, value: 'const color = 1;' });
    expect(flatten(run(tree))).toEqual(['const color = 1;']);
  });

  it('leaves a wrapped code span alone and reads past a stray backtick, as the plain path does', () => {
    const tree = root(
      paragraph(text('A span that wraps, '), { type: 'inlineCode', value: 'the\ncolor' }, text(', stays.')),
      paragraph(text("It's a `stray backtick and\nthe color is red.")),
    );
    expect(flatten(run(tree))).toEqual([
      'A span that wraps, ',
      'the\ncolor',
      ', stays.',
      "It's a `stray backtick and\nthe colour is red.",
    ]);
  });

  it.each`
    input                                  | expected
    ${'Wrap it in `the color` quotes.'}    | ${'Wrap it in `the colour` quotes.'}
    ${'Wrap it in `the\ncolor` quotes.'}   | ${'Wrap it in `the\ncolour` quotes.'}
    ${'```\nthe color\n```'}               | ${'```\nthe colour\n```'}
    ${'~~~\nthe color'}                     | ${'~~~\nthe colour'}
  `('reads a backtick or tilde left in a text node as literal: $input', ({ input, expected }) => {
    const tree = root(paragraph(text(input as string)));
    expect(flatten(run(tree, { assumeAmerican: true, syntax: 'markdown' }))).toEqual([expected]);
  });

  it('still protects a URL and an email address in a text node', () => {
    const tree = root(paragraph(text('See https://example.com/color or color@favorite.org for `the color`.')));
    expect(flatten(run(tree))).toEqual(['See https://example.com/color or color@favorite.org for `the colour`.']);
  });

  it('judges American-ness across the whole document, not one node at a time', () => {
    const tree = root(
      paragraph(text('The color of the theater is gray and they canceled it.')),
      paragraph(text('Due 03/04/2024.')),
    );
    expect(flatten(run(tree))[1]).toBe('Due 2024-03-04.');
  });

  it('reports each change through onChange', () => {
    const seen: string[] = [];
    const tree = root(paragraph(text('The color and the center.')));
    run(tree, { onChange: (change: { before: string }) => seen.push(change.before) });
    expect(seen).toEqual(['color', 'center']);
  });

  it('respects the dialect', () => {
    const tree = root(paragraph(text('the sidewalk')));
    expect(flatten(run(tree, { dialect: 'en-GB', preset: 'localise' }))).toEqual(['the pavement']);
  });

  it('leaves vocabulary alone without the localise preset', () => {
    const tree = root(paragraph(text('the sidewalk')));
    expect(flatten(run(tree))).toEqual(['the sidewalk']);
  });

  it('keeps a unit named the way a person writes it', () => {
    const tree = root(paragraph(text('6 inches and 2 miles')));
    expect(flatten(run(tree, { unitsKeep: ['inches', 'miles'] }))).toEqual(['6 inches and 2 miles']);
  });

  it('leaves a tree with no prose alone', () => {
    const tree = root({ type: 'thematicBreak' });
    expect(run(tree)).toBe(tree);
  });

  it('names an unknown preset rather than failing deep inside', () => {
    const tree = root(paragraph(text('the color')));
    expect(() => run(tree, { preset: 'Localise' })).toThrow('Unknown preset: Localise. Expected one of read, localise.');
  });

  it.each(REJECTED)('rejects $options when attached, before any document', ({ options, message }) => {
    expect(() => remarkDeamericanise(options as never)).toThrow(message);
    expect(() => run(root({ type: 'code', value: 'color' }), options)).toThrow(message);
  });

  it.each(VALID)('leaves a document with no prose alone under $options', (options) => {
    const tree = root({ type: 'code', value: 'color' }, { type: 'thematicBreak' });
    expect(run(tree, options)).toBe(tree);
    expect(flatten(tree)).toEqual(['color']);
  });
});

describe('the ESLint plugin', () => {
  const source = 'const a = 1; // the color\n';

  interface Report {
    loc: { start: { line: number; column: number }; end: { line: number; column: number } };
    data: Record<string, string>;
    fix?: (fixer: unknown) => unknown;
  }

  interface Fix {
    range: [number, number];
    text: string;
  }

  /** Applies one report's fix on its own, the way an editor's quick fix does. */
  function quickFix(code: string, report: Report): string {
    const fixer = { replaceTextRange: (range: [number, number], text: string): Fix => ({ range, text }) };
    const fixes = [report.fix?.(fixer) ?? []].flat() as Fix[];
    return fixes
      .sort((a, b) => b.range[0] - a.range[0])
      .reduce((out, { range, text }) => out.slice(0, range[0]) + text + out.slice(range[1]), code);
  }

  function lint(code: string, ruleOptions: unknown[] = []): Report[] {
    const reports: Report[] = [];
    // The code under test holds no strings or regexes for a comment marker to hide in.
    const comments = [...code.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map((match) => {
      const line = match[0].startsWith('//');
      return {
        type: line ? 'Line' : 'Block',
        value: match[0].slice(2, line ? undefined : -2),
        range: [match.index, match.index + match[0].length],
      };
    });
    const context = {
      options: ruleOptions,
      sourceCode: {
        text: code,
        getAllComments: () => comments,
        getLocFromIndex: (index: number) => ({ line: 1, column: index }),
      },
      report: (r: Report) => reports.push(r),
    };
    const visitor = eslintPlugin.rules.comments.create(context as never) as { Program?: () => void };
    visitor.Program?.();
    return reports;
  }

  it('reads a comment as its language documents it, whatever syntax says', () => {
    expect(lint('const a = 1; // ~~~ the color\n', [{ syntax: 'text' }])).toEqual([]);
  });

  it('declares itself fixable with a message and a schema', () => {
    expect(eslintPlugin.rules.comments.meta.fixable).toBe('code');
    expect(eslintPlugin.rules.comments.meta.messages.americanism).toContain('American English');
  });

  it('reports the Americanism and its replacement', () => {
    const [report] = lint(source);
    expect(report?.data).toEqual({ before: 'color', after: 'colour' });
  });

  it('points at the word, not the whole comment', () => {
    const [report] = lint(source);
    expect(source.slice(report!.loc.start.column, report!.loc.start.column + 5)).toBe('color');
  });

  it('offers a fix for exactly that range', () => {
    const [report] = lint(source);
    const applied = report?.fix?.({
      replaceTextRange: (range: [number, number], value: string) => ({ range, value }),
    }) as { range: [number, number]; value: string };
    expect(source.slice(applied.range[0], applied.range[1])).toBe('color');
    expect(applied.value).toBe('colour');
  });

  describe('an article fix and the word it agrees with', () => {
    const code = 'const a = 1; // Use an eraser.\n';
    const reports = lint(code, [{ preset: 'localise' }]);

    it('are one problem', () => {
      expect(reports).toHaveLength(1);
      expect(reports[0]?.data).toEqual({ before: 'an eraser', after: 'a rubber' });
    });

    it('point at the span from the article to the end of the word', () => {
      const { start, end } = reports[0]!.loc;
      expect(code.slice(start.column, end.column)).toBe('an eraser');
    });

    it('share one fix', () => {
      expect(quickFix(code, reports[0]!)).toBe('const a = 1; // Use a rubber.\n');
    });
  });

  describe('an article fix and the measurement it agrees with', () => {
    const code = 'const a = 1; // Build an 8 foot fence.\n';
    const reports = lint(code);

    it('are one problem', () => {
      expect(reports).toHaveLength(1);
      expect(reports[0]?.data).toEqual({ before: 'an 8 foot', after: 'a 2.4 metre' });
    });

    it('point at the span from the article to the end of the measurement', () => {
      const { start, end } = reports[0]!.loc;
      expect(code.slice(start.column, end.column)).toBe('an 8 foot');
    });

    it('share one fix', () => {
      expect(quickFix(code, reports[0]!)).toBe('const a = 1; // Build a 2.4 metre fence.\n');
    });
  });

  describe('a comment read across its lines', () => {
    it.each`
      code                                                           | why
      ${'const a = 1;\n// Use `the\n// color` here.\n'}              | ${'a span that wraps across line comments'}
      ${'/**\n * Use `the\n * color` here.\n */\n'}                  | ${'a span that wraps across the lines of a block comment'}
      ${"/**\n * Don't use a ` here.\n *\n * Use `color`.\n */\n"}   | ${'a span after a bare star line'}
    `('reports nothing in $why', ({ code }) => {
      expect(lint(code)).toEqual([]);
    });

    it.each`
      code                                         | fixed
      ${'/**\n * Use an\n * eraser here.\n */\n'}  | ${'/**\n * Use a\n * rubber here.\n */\n'}
      ${'// Use an\n// eraser here.\n'}            | ${'// Use a\n// rubber here.\n'}
    `('reports an article that ends a line with the word that starts the next: $code', ({ code, fixed }) => {
      const reports = lint(code, [{ preset: 'localise' }]);
      expect(reports).toHaveLength(1);
      expect(reports[0]?.data).toEqual({ before: 'an eraser', after: 'a rubber' });
      expect(quickFix(code, reports[0]!)).toBe(fixed);
    });

    it('reports the word alone when a blank line ends the paragraph after the article', () => {
      const code = '// Use an\n//\n// eraser here.\n';
      const reports = lint(code, [{ preset: 'localise' }]);
      expect(reports).toHaveLength(1);
      expect(reports[0]?.data).toEqual({ before: 'eraser', after: 'rubber' });
      expect(quickFix(code, reports[0]!)).toBe('// Use an\n//\n// rubber here.\n');
    });
  });

  it('takes rule options', () => {
    expect(lint(source, [{ categories: { spelling: false } }])).toHaveLength(0);
  });

  it('keeps a unit named the way a person writes it', () => {
    const code = 'const a = 1; // 6 inches and 2 miles\n';
    expect(lint(code)).toHaveLength(2);
    expect(lint(code, [{ unitsKeep: ['inches', 'miles'] }])).toHaveLength(0);
  });

  it('names an unknown preset in its options rather than failing deep inside', () => {
    expect(() => lint(source, [{ preset: 'Localise' }])).toThrow(
      'Unknown preset: Localise. Expected one of read, localise.',
    );
  });

  it.each(REJECTED)('rejects $options when the rule is created, before any comment', ({ options, message }) => {
    const getAllComments = vi.fn(() => []);
    const context = {
      options: [options],
      sourceCode: { getAllComments, getLocFromIndex: () => ({ line: 1, column: 0 }) },
      report: vi.fn(),
    };
    expect(() => eslintPlugin.rules.comments.create(context as never)).toThrow(message);
    expect(getAllComments).not.toHaveBeenCalled();
  });

  it.each(VALID)('reports nothing in a file with no comments under $options', (options) => {
    const report = vi.fn();
    const context = {
      options: [options],
      sourceCode: { getAllComments: () => [], getLocFromIndex: () => ({ line: 1, column: 0 }) },
      report,
    };
    const visitor = eslintPlugin.rules.comments.create(context as never) as { Program?: () => void };
    visitor.Program?.();
    expect(report).not.toHaveBeenCalled();
  });

  it('takes a dialect and preset in its options', () => {
    const reports = lint('const a = 1; // the sidewalk\n', [{ dialect: 'en-GB', preset: 'localise' }]);
    expect(reports.map((r) => r.data)).toEqual([{ before: 'sidewalk', after: 'pavement' }]);
  });

  it('ships a flat-config preset', () => {
    expect(eslintPlugin.configs.recommended.rules['deamericanise/comments']).toBe('warn');
  });
});
