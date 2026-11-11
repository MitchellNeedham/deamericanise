import type { Change } from '../types.js';

export interface Range {
  start: number;
  end: number;
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/** `change` would rewrite some of `held` and leave the rest as written. */
function splits(change: Range, held: Range): boolean {
  return overlaps(change, held) && (change.start > held.start || change.end < held.end);
}

/**
 * Picks a non-overlapping subset of candidate changes. Higher priority wins outright;
 * at equal priority the longer match wins, which is what makes `6 feet 2 inches`
 * beat the two measurements inside it. A span a rule holds is never split, whatever the
 * priority of the change that would split it.
 */
export function resolveChanges(candidates: Change[], protectedRanges: Range[]): Change[] {
  const held = candidates.filter((c) => c.hold);
  const viable = candidates.filter(
    (c) =>
      !c.hold &&
      c.before !== c.after &&
      !protectedRanges.some((p) => overlaps(c, p)) &&
      !held.some((h) => splits(c, h)),
  );

  const ranked = [...viable].sort((a, b) => {
    const priority = (b.priority ?? 0) - (a.priority ?? 0);
    if (priority !== 0) return priority;
    const length = b.end - b.start - (a.end - a.start);
    if (length !== 0) return length;
    return a.start - b.start;
  });

  const accepted: Change[] = [];
  for (const candidate of ranked) {
    if (!accepted.some((a) => overlaps(a, candidate))) accepted.push(candidate);
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
