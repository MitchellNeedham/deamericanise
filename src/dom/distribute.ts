import { agreesWith } from '../engine/articles.js';
import type { Change } from '../types.js';

export interface Distribution {
  /** The new text of each node, in the same order as the sources. */
  outputs: string[];
  applied: Change[];
  /** Where each applied change's replacement sits in the outputs. An empty one has no place. */
  placed: Placement[];
}

export interface Placement {
  change: Change;
  /** Index into the sources. */
  node: number;
  start: number;
  end: number;
}

type Edit = [start: number, end: number, replacement: string, change: Change | null];

/**
 * Spreads changes found in a run of text back over the nodes the run was joined from.
 *
 * A change inside one node is a plain replacement. A change that crosses nodes puts its
 * whole replacement in the first node and empties its share of the others. It is
 * skipped if the nodes sit in different links, buttons or labels, or if any of them is
 * locked. An article fix is skipped with the replacement it agrees with.
 */
export function distribute(
  text: string,
  sources: string[],
  anchors: Array<Element | null>,
  locked: boolean[],
  changes: Change[],
): Distribution {
  const starts: number[] = [];
  let offset = 0;
  for (const source of sources) {
    starts.push(offset);
    offset += source.length;
  }
  const endOf = (i: number) => starts[i]! + sources[i]!.length;

  const planned: Array<[Change, number[]]> = [];
  const skipped: Change[] = [];
  for (const change of changes) {
    const touched = nodesUnder(change, sources, starts, endOf);
    const anchorsTouched = new Set(touched.map((i) => anchors[i]));
    if (touched.length === 0 || touched.some((i) => locked[i]) || anchorsTouched.size > 1) {
      skipped.push(change);
    } else {
      planned.push([change, touched]);
    }
  }

  const edits: Edit[][] = sources.map(() => []);
  const applied: Change[] = [];
  for (const [change, touched] of planned) {
    if (skipped.some((s) => agreesWith(change, s))) continue;

    touched.forEach((i, position) => {
      const from = Math.max(change.start, starts[i]!) - starts[i]!;
      const to = Math.min(change.end, endOf(i)) - starts[i]!;
      edits[i]!.push(position === 0 ? [from, to, change.after, change] : [from, to, '', null]);
    });
    applied.push(change);
  }

  const placed: Placement[] = [];
  const outputs = sources.map((source, i) => applyEdits(source, edits[i]!, i, placed));
  return { outputs, applied, placed };
}

function nodesUnder(
  change: Change,
  sources: string[],
  starts: number[],
  endOf: (i: number) => number,
): number[] {
  const touched: number[] = [];
  for (let i = 0; i < sources.length; i++) {
    if (sources[i]!.length === 0) continue;
    const overlaps = starts[i]! < change.end && endOf(i) > change.start;
    const holdsInsertion =
      change.start === change.end && starts[i]! <= change.start && change.start <= endOf(i);
    if (overlaps || holdsInsertion) {
      touched.push(i);
      if (holdsInsertion) break;
    }
  }
  return touched;
}

function applyEdits(source: string, edits: Edit[], node: number, placed: Placement[]): string {
  let out = '';
  let cursor = 0;
  for (const [start, end, replacement, change] of edits) {
    out += source.slice(cursor, start);
    if (change && replacement !== '') {
      placed.push({ change, node, start: out.length, end: out.length + replacement.length });
    }
    out += replacement;
    cursor = end;
  }
  return out + source.slice(cursor);
}
