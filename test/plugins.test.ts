import { describe, expect, it } from 'vitest';
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

  it('leaves a tree with no prose alone', () => {
    const tree = root({ type: 'thematicBreak' });
    expect(run(tree)).toBe(tree);
  });
});

describe('the ESLint plugin', () => {
  const source = 'const a = 1; // the color\n';

  interface Report {
    loc: { start: { line: number; column: number } };
    data: Record<string, string>;
    fix?: (fixer: unknown) => unknown;
  }

  function lint(code: string, ruleOptions: unknown[] = []): Report[] {
    const reports: Report[] = [];
    const comments = [{ type: 'Line', value: code.slice(code.indexOf('//') + 2), range: [code.indexOf('//'), code.length] }];
    const context = {
      options: ruleOptions,
      sourceCode: {
        getAllComments: () => comments,
        getLocFromIndex: (index: number) => ({ line: 1, column: index }),
      },
      report: (r: Report) => reports.push(r),
    };
    const visitor = eslintPlugin.rules.comments.create(context as never) as { Program?: () => void };
    visitor.Program?.();
    return reports;
  }

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

  it('takes rule options', () => {
    expect(lint(source, [{ categories: { spelling: false } }])).toHaveLength(0);
  });

  it('ships a flat-config preset', () => {
    expect(eslintPlugin.configs.recommended.rules['deamericanise/comments']).toBe('warn');
  });
});
