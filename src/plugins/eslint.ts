import { resolveOptions } from '../config.js';
import { agreesWith } from '../engine/articles.js';
import { changesInSource, joinComments } from '../lexers/join.js';
import type { SourceComment } from '../lexers/scan.js';
import { transformProse } from '../transform.js';
import type { Change, Options } from '../types.js';

interface Comment {
  type: 'Line' | 'Block' | string;
  value: string;
  range?: [number, number];
}

interface Position {
  line: number;
  column: number;
}

interface SourceCode {
  text: string;
  getAllComments(): Comment[];
  getLocFromIndex(index: number): Position;
}

interface Fixer {
  replaceTextRange(range: [number, number], text: string): unknown;
}

interface Context {
  sourceCode?: SourceCode;
  getSourceCode?(): SourceCode;
  options: unknown[];
  report(descriptor: {
    loc: { start: Position; end: Position };
    messageId: string;
    data: Record<string, string>;
    fix?: (fixer: Fixer) => unknown;
  }): void;
}

/**
 * `//` and `/*` are both two characters, so a comment's text always starts two
 * characters into its range. ESLint has no other comment shapes.
 */
const MARKER_LENGTH = 2;

function sourceComments(sourceCode: SourceCode): SourceComment[] {
  return sourceCode.getAllComments().flatMap((comment): SourceComment[] => {
    if (!comment.range) return [];
    const [marker] = comment.range;
    const start = marker + MARKER_LENGTH;
    const end = start + comment.value.length;
    return comment.type === 'Block'
      ? [{ kind: 'block', open: '/*', start, end }]
      : [{ kind: 'line', open: sourceCode.text.slice(marker, start), start, end }];
  });
}

const rule = {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'Write comments in English the whole world reads, not just America',
      url: 'https://www.npmjs.com/package/deamericanise',
    },
    fixable: 'code' as const,
    schema: [{ type: 'object', additionalProperties: true }],
    messages: {
      americanism: '"{{before}}" is American English. Use "{{after}}".',
    },
  },

  create(context: Context) {
    const options = (context.options[0] ?? {}) as Options;
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    if (!sourceCode) return {};

    return {
      Program(): void {
        for (const comment of joinComments(sourceCode.text, sourceComments(sourceCode))) {
          const resolved = resolveOptions({ protectIdentifiers: true, ...options });
          const found = transformProse(comment.text, resolved, comment.boundaries).changes;
          const changes = changesInSource(comment, found);
          const rangeOf = (change: Change): [number, number] => [change.start, change.end];

          for (const change of changes) {
            // Reported with the replacement it agrees with, so no quick fix applies one alone.
            if (change.agreesWith) continue;
            const article = changes.find((a) => agreesWith(a, change));
            const parts = article ? [article, change] : [change];

            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(rangeOf(parts[0]!)[0]),
                end: sourceCode.getLocFromIndex(rangeOf(change)[1]),
              },
              messageId: 'americanism',
              data: {
                before: parts.map((c) => c.before).join(' '),
                after: parts.map((c) => c.after).join(' '),
              },
              fix: (fixer) => {
                const fixes = parts.map((c) => fixer.replaceTextRange(rangeOf(c), c.after));
                return fixes.length === 1 ? fixes[0] : fixes;
              },
            });
          }
        }
      },
    };
  },
};

export const rules = { comments: rule };

/** Flat-config preset: `import deamericanise from 'deamericanise/eslint'`. */
export const configs = {
  recommended: {
    plugins: { deamericanise: { rules } },
    rules: { 'deamericanise/comments': 'warn' as const },
  },
};

export default { meta: { name: 'deamericanise' }, rules, configs };
