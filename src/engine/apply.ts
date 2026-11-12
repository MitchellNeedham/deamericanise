import type { Change } from '../types.js';

export interface Range {
  start: number;
  end: number;
}

/**
 * The part of the source a change rewrites, without the text it writes back unchanged at
 * either end, such as the `colo` and `r` that `color` keeps when it becomes `colour`.
 */
function rewritten(change: Change): Range {
  const { before, after } = change;
  const most = Math.min(before.length, after.length);
  let head = 0;
  while (head < most && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < most - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
  return { start: change.start + head, end: change.end - tail };
}

/**
 * Spans indexed by where they start, so a question about the spans that start before some
 * point takes time in the logarithm of their number. Spans can be added after the index is
 * built, but only at a start given to the constructor.
 */
class SpanIndex {
  private readonly starts: number[];
  /** A Fenwick tree over `starts` of the greatest end among the spans added. */
  private readonly ends: number[];

  constructor(starts: number[]) {
    this.starts = [...new Set(starts)].sort((a, b) => a - b);
    this.ends = this.starts.map(() => -Infinity);
  }

  static of(spans: Range[]): SpanIndex {
    const index = new SpanIndex(spans.map((s) => s.start));
    for (const span of spans) index.add(span);
    return index;
  }

  add({ start, end }: Range): void {
    for (let i = this.countBefore(start); i < this.ends.length; i |= i + 1) {
      this.ends[i] = Math.max(this.ends[i]!, end);
    }
  }

  /** The greatest end among the spans added that start before `point`. */
  endBefore(point: number): number {
    let end = -Infinity;
    for (let i = this.countBefore(point) - 1; i >= 0; i = (i & (i + 1)) - 1) {
      end = Math.max(end, this.ends[i]!);
    }
    return end;
  }

  /** Some span added overlaps `range`. */
  overlaps(range: Range): boolean {
    return this.endBefore(range.end) > range.start;
  }

  private countBefore(point: number): number {
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.starts[middle]! < point) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

/**
 * `change` would rewrite some of a held span and leave the rest as written. A held span it
 * splits overlaps what it rewrites and either starts before the change or ends after it.
 */
function splitsHeld(change: Change, held: SpanIndex): boolean {
  const { start, end } = rewritten(change);
  return (
    held.endBefore(Math.min(end, change.start)) > start ||
    held.endBefore(end) > Math.max(start, change.end)
  );
}

/**
 * Picks a non-overlapping subset of candidate changes. Higher priority wins outright;
 * at equal priority the longer match wins, which is what makes `6 feet 2 inches`
 * beat the two measurements inside it. A span a rule holds is never split, whatever the
 * priority of the change that would split it.
 */
export function resolveChanges(candidates: Change[], protectedRanges: Range[]): Change[] {
  const held = SpanIndex.of(candidates.filter((c) => c.hold));
  const guarded = SpanIndex.of(protectedRanges);
  const viable = candidates.filter(
    (c) => !c.hold && c.before !== c.after && !guarded.overlaps(c) && !splitsHeld(c, held),
  );

  const ranked = [...viable].sort((a, b) => {
    const priority = (b.priority ?? 0) - (a.priority ?? 0);
    if (priority !== 0) return priority;
    const length = b.end - b.start - (a.end - a.start);
    if (length !== 0) return length;
    return a.start - b.start;
  });

  const taken = new SpanIndex(viable.map((c) => c.start));
  const accepted: Change[] = [];
  for (const candidate of ranked) {
    if (taken.overlaps(candidate)) continue;
    taken.add(candidate);
    accepted.push(candidate);
  }

  return accepted.sort((a, b) => a.start - b.start);
}

export function applyChanges(text: string, changes: Change[]): string {
  let out = '';
  let cursor = 0;
  for (const change of changes) {
    out += text.slice(cursor, change.start) + change.after;
    cursor = change.end;
  }
  return out + text.slice(cursor);
}

/** Shifts offsets so changes found in a slice can be reported against the whole document. */
export function offsetChanges(changes: Change[], delta: number): Change[] {
  if (delta === 0) return changes;
  return changes.map((c) => {
    const shifted = { ...c, start: c.start + delta, end: c.end + delta };
    if (c.agreesWith) {
      shifted.agreesWith = { start: c.agreesWith.start + delta, end: c.agreesWith.end + delta };
    }
    return shifted;
  });
}
