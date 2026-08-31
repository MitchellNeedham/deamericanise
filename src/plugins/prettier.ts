import { deamericaniseCode } from '../code.js';
import { deamericaniseText } from '../transform.js';
import { CONFIDENCES, PRESETS } from '../config.js';
import { DIALECTS } from '../dialects/index.js';
import type { Confidence, Dialect, Options, Preset } from '../types.js';

/**
 * A Prettier plugin. Prettier owns the parsers, so this wraps the built-in ones and
 * rewrites the source in `preprocess`, before Prettier records `originalText`. Doing it
 * any later has no effect: the printers re-emit from that original string.
 *
 * Markdown is handled as prose; every other language has only its comments touched.
 */

interface AnyParser {
  parse(text: string, options: unknown): unknown;
  astFormat: string;
  locStart(node: unknown): number;
  locEnd(node: unknown): number;
  preprocess?(text: string, options: unknown): string;
}

interface Wrapped {
  /** Prettier's own module, to borrow the real parser from. */
  module: string;
  /** Known ahead of time, so the parser can be declared without loading anything. */
  astFormat: string;
  /** A language id from this package's lexer registry, or `prose`. */
  language: string;
}

const WRAPPED: Record<string, Wrapped> = {
  markdown: { module: 'prettier/plugins/markdown', astFormat: 'mdast', language: 'prose' },
  mdx: { module: 'prettier/plugins/markdown', astFormat: 'mdast', language: 'prose' },
  babel: { module: 'prettier/plugins/babel', astFormat: 'estree', language: 'js' },
  'babel-ts': { module: 'prettier/plugins/babel', astFormat: 'estree', language: 'ts' },
  typescript: { module: 'prettier/plugins/typescript', astFormat: 'estree', language: 'ts' },
  css: { module: 'prettier/plugins/postcss', astFormat: 'postcss', language: 'css' },
  scss: { module: 'prettier/plugins/postcss', astFormat: 'postcss', language: 'scss' },
  less: { module: 'prettier/plugins/postcss', astFormat: 'postcss', language: 'less' },
  yaml: { module: 'prettier/plugins/yaml', astFormat: 'yaml', language: 'yaml' },
  html: { module: 'prettier/plugins/html', astFormat: 'html', language: 'html' },
  vue: { module: 'prettier/plugins/html', astFormat: 'html', language: 'vue' },
};

const loaded = new Map<string, AnyParser>();

async function realParser(name: string, spec: Wrapped): Promise<AnyParser> {
  const cached = loaded.get(name);
  if (cached) return cached;

  let module: { parsers?: Record<string, AnyParser> };
  try {
    module = (await import(/* @vite-ignore */ spec.module)) as { parsers?: Record<string, AnyParser> };
  } catch {
    throw new Error(`deamericanise/prettier needs Prettier 3 installed to wrap its "${name}" parser.`);
  }

  const parser = module.parsers?.[name];
  if (!parser) throw new Error(`Prettier has no "${name}" parser to wrap.`);
  loaded.set(name, parser);
  return parser;
}

interface PrettierOptions {
  deamericaniseDialect?: Dialect;
  deamericanisePreset?: Preset;
  deamericaniseConfidence?: string;
  deamericaniseOptions?: string;
}

/**
 * Prettier validates option types, and none of them is "arbitrary object", so the
 * common settings are flat and anything else arrives as a JSON string.
 */
function settings(raw: unknown): Options {
  const values = (raw ?? {}) as PrettierOptions;
  const options: Options = {};

  if (values.deamericaniseDialect) options.dialect = values.deamericaniseDialect;
  if (values.deamericanisePreset) options.preset = values.deamericanisePreset;
  if (values.deamericaniseConfidence) {
    options.confidence = values.deamericaniseConfidence
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Confidence => (CONFIDENCES as string[]).includes(s));
  }
  if (values.deamericaniseOptions) {
    try {
      Object.assign(options, JSON.parse(values.deamericaniseOptions) as Options);
    } catch {
      throw new Error('deamericaniseOptions must be a JSON object, for example {"dialect":"en-GB"}.');
    }
  }

  return options;
}

function rewrite(text: string, language: string, options: Options): string {
  if (language === 'prose') return deamericaniseText(text, options);
  try {
    return deamericaniseCode(text, { ...options, language }).text;
  } catch {
    // No lexer for this language means no comments we can find, so leave it alone.
    return text;
  }
}

function wrap(name: string, spec: Wrapped): AnyParser {
  return {
    astFormat: spec.astFormat,
    // None of the parsers wrapped above defines its own `preprocess`. If one ever does,
    // it will need chaining here rather than in `parse`, so that Prettier's
    // `originalText` and the parsed text stay the same string.
    preprocess(text: string, options: unknown) {
      return rewrite(text, spec.language, settings(options));
    },
    async parse(text: string, options: unknown) {
      const parser = await realParser(name, spec);
      return parser.parse(text, options);
    },
    locStart(node: unknown) {
      return loaded.get(name)!.locStart(node);
    },
    locEnd(node: unknown) {
      return loaded.get(name)!.locEnd(node);
    },
  };
}

export const parsers: Record<string, AnyParser> = Object.fromEntries(
  Object.entries(WRAPPED).map(([name, spec]) => [name, wrap(name, spec)]),
);

export const options = {
  deamericaniseDialect: {
    type: 'choice' as const,
    category: 'Global',
    default: 'en-AU',
    choices: Object.keys(DIALECTS).map((value) => ({ value })),
    description: 'Which non-US dialect to write.',
  },
  deamericanisePreset: {
    type: 'choice' as const,
    category: 'Global',
    default: 'read',
    choices: PRESETS.map((value) => ({ value })),
    description: 'read keeps the subject matter American; localise also swaps vocabulary.',
  },
  deamericaniseConfidence: {
    type: 'string' as const,
    category: 'Global',
    default: CONFIDENCES.join(','),
    description: 'Comma-separated confidence tiers to run: safe, moderate, risky.',
  },
  deamericaniseOptions: {
    type: 'string' as const,
    category: 'Global',
    default: '',
    description: 'Any other deamericanise options, as a JSON object.',
  },
};

export default { parsers, options };
