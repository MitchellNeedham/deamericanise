import { resolveOptions } from '../config.js';
import { detectAmerican } from '../engine/detect.js';
import { transformProse } from '../transform.js';
import type { Change, Options } from '../types.js';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  [key: string]: unknown;
}

/** Node types whose text is content rather than markup or code. */
const PROSE_NODES = new Set(['text']);

/** Node types never descended into: their contents are code, markup or URLs. */
const OPAQUE_NODES = new Set(['code', 'inlineCode', 'html', 'yaml', 'toml', 'definition', 'math', 'inlineMath']);

function collect(node: Node, into: Node[]): void {
  if (OPAQUE_NODES.has(node.type)) return;
  if (PROSE_NODES.has(node.type) && typeof node.value === 'string') into.push(node);
  for (const child of node.children ?? []) collect(child, into);
}

export interface RemarkOptions extends Options {
  /** Called once per change, for reporting alongside the rewrite. */
  onChange?: (change: Change, node: Node) => void;
}

/**
 * A remark transformer. Working on the syntax tree means code fences, inline code,
 * link targets, HTML blocks and frontmatter are structurally out of reach rather than
 * guessed at, which no amount of regular expressions gets right.
 *
 *     unified().use(remarkParse).use(remarkDeamericanise, { dialect: 'en-GB' })
 */
export default function remarkDeamericanise(options: RemarkOptions = {}) {
  const { onChange, ...transformOptions } = options;

  return function transformer(tree: Node): Node {
    const nodes: Node[] = [];
    collect(tree, nodes);
    if (nodes.length === 0) return tree;

    // One verdict for the whole document; a single sentence is not enough to judge.
    const signals = detectAmerican(nodes.map((n) => n.value).join('\n'));
    const resolved = resolveOptions({
      assumeAmerican: signals.confidence >= (transformOptions.minAmericanConfidence ?? 0.5),
      ...transformOptions,
    });
    resolved.parsed = true;

    for (const node of nodes) {
      const result = transformProse(node.value as string, resolved);
      if (result.changes.length === 0) continue;
      if (onChange) for (const change of result.changes) onChange(change, node);
      node.value = result.text;
    }

    return tree;
  };
}
