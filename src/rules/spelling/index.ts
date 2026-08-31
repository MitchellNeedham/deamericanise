import type { Confidence, LexEntry } from '../../types.js';
import { CONTEXTUAL } from './contextual.js';
import {
  DIGRAPH,
  DOUBLE_L_VERBS,
  DOUBLE_OTHER,
  ENCE,
  IRREGULAR,
  IRREGULAR_TECHNICAL,
  METRIC_RE,
  OGUE,
  OGUE_TECHNICAL,
  OUR,
  RE,
  SINGLE_L,
  type Pair,
} from './lists.js';

function group(ruleId: string, confidence: Confidence, pairs: Pair[]): LexEntry[] {
  return pairs.map(([from, to]) => ({
    from,
    to,
    ruleId,
    category: 'spelling' as const,
    confidence,
  }));
}

/** `cancel` -> `cancelled, cancelling, canceller`. */
function doubledL(): Pair[] {
  const pairs: Pair[] = [];
  for (const verb of new Set(DOUBLE_L_VERBS)) {
    for (const suffix of ['ed', 'ing', 'er', 'ers']) {
      pairs.push([verb + suffix, `${verb}l${suffix}`]);
    }
  }
  return pairs;
}

/** Agent and adjective forms that double the `l` but do not come from a verb stem. */
const DOUBLE_L_EXTRA: Pair[] = [
  ['counselor', 'counsellor'],
  ['counselors', 'counsellors'],
  ['marvelous', 'marvellous'],
  ['marvelously', 'marvellously'],
  ['libelous', 'libellous'],
  ['medalist', 'medallist'],
  ['medalists', 'medallists'],
  ['panelist', 'panellist'],
  ['panelists', 'panellists'],
  ['duelist', 'duellist'],
  ['duelists', 'duellists'],
  ['cruelest', 'cruellest'],
];

/** Spellings that collide with a surname, a trademark or an SI unit often enough to flag. */
const MODERATE = new Set(['gray', 'grays', 'grayed', 'grayer', 'grayest', 'grayish', 'toward', 'afterward']);

export function spellingEntries(): LexEntry[] {
  const irregularSafe = IRREGULAR.filter(([from]) => !MODERATE.has(from));
  const irregularModerate = IRREGULAR.filter(([from]) => MODERATE.has(from));

  return [
    ...group('spelling.our', 'safe', OUR),
    ...group('spelling.re', 'safe', RE),
    ...group('spelling.metre', 'safe', METRIC_RE),
    ...group('spelling.ence', 'safe', ENCE),
    ...group('spelling.ogue', 'safe', OGUE),
    ...group('spelling.ogue-technical', 'moderate', OGUE_TECHNICAL),
    ...group('spelling.double-l', 'safe', [...doubledL(), ...DOUBLE_L_EXTRA, ...DOUBLE_OTHER]),
    ...group('spelling.single-l', 'safe', SINGLE_L),
    ...group('spelling.digraph', 'moderate', DIGRAPH),
    ...group('spelling.irregular', 'safe', irregularSafe),
    ...group('spelling.irregular-ambiguous', 'moderate', irregularModerate),
    ...group('spelling.irregular-technical', 'risky', IRREGULAR_TECHNICAL),
    // Gated entries outrank the plain lists when both match the same span.
    ...CONTEXTUAL.map((entry) => ({ ...entry, priority: entry.priority ?? 20 })),
  ];
}

export { suffixRules } from './suffix.js';
