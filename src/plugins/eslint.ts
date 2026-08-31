import { deamericanise } from '../transform.js';
import type { Options } from '../types.js';

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
        for (const comment of sourceCode.getAllComments()) {
          if (!comment.range) continue;
          const result = deamericanise(comment.value, { protectIdentifiers: true, ...options });
          const base = comment.range[0] + MARKER_LENGTH;

          for (const change of result.changes) {
            const range: [number, number] = [base + change.start, base + change.end];
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(range[0]),
                end: sourceCode.getLocFromIndex(range[1]),
              },
              messageId: 'americanism',
              data: { before: change.before, after: change.after },
              fix: (fixer) => fixer.replaceTextRange(range, change.after),
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
