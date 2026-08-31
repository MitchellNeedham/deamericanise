import type { Change, Rule, RuleContext } from '../../types.js';

/**
 * `-ize` and `-yze` are open-ended, so they are patterns rather than wordlists.
 * Requiring at least two letters before the digraph already excludes `size` and
 * `wizard`; the rest need naming.
 */
const IZE =
  /(?<![A-Za-z0-9_])([A-Za-z]{2,}?)(iz)(e|es|ed|er|ers|ing|ings|able|ability|ation|ations|ational|ance)(?![A-Za-z0-9_])/gi;

const YZE = /(?<![A-Za-z0-9_])([A-Za-z]{2,}?)(yz)(e|es|ed|er|ers|ing|able)(?![A-Za-z0-9_])/gi;

/** Words where `iz` is part of the stem, not the suffix. */
const IZE_EXCEPTIONS = new Set([
  'size', 'sizes', 'sized', 'sizing', 'sizings', 'sizer', 'sizers', 'sizable', 'sizably',
  'resize', 'resizes', 'resized', 'resizing', 'resizable', 'resizer',
  'downsize', 'downsizes', 'downsized', 'downsizing',
  'upsize', 'upsizes', 'upsized', 'upsizing',
  'oversize', 'oversized', 'oversizing',
  'undersize', 'undersized', 'unsized', 'midsize', 'midsized',
  'supersize', 'supersizes', 'supersized', 'supersizing',
  'capsize', 'capsizes', 'capsized', 'capsizing',
  'prize', 'prizes', 'prized', 'prizing', 'disprize',
  'seize', 'seizes', 'seized', 'seizing', 'seizer',
  'maize', 'baize', 'assize', 'assizes',
]);

/**
 * Both suffixes differ from ours by exactly one letter, so swapping that letter in
 * place preserves the casing of everything around it.
 */
function swapZ(word: string, zIndex: number): string {
  const z = word[zIndex]!;
  return word.slice(0, zIndex) + (z === 'Z' ? 'S' : 's') + word.slice(zIndex + 1);
}

function suffixRule(id: string, pattern: RegExp, exceptions: Set<string>, note: string): Rule {
  return {
    id,
    category: 'spelling',
    confidence: 'safe',
    priority: 0,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];
      pattern.lastIndex = 0;
      for (const match of ctx.text.matchAll(pattern)) {
        const word = match[0];
        if (exceptions.has(word.toLowerCase())) continue;
        const start = match.index;
        changes.push({
          start,
          end: start + word.length,
          before: word,
          after: swapZ(word, match[1]!.length + 1),
          ruleId: id,
          category: 'spelling',
          confidence: 'safe',
          priority: 0,
          note,
        });
      }
      return changes;
    },
  };
}

export const izeRule = suffixRule(
  'spelling.ise',
  IZE,
  IZE_EXCEPTIONS,
  'the -ize suffix is spelled -ise outside America',
);

export const yzeRule = suffixRule(
  'spelling.yse',
  YZE,
  new Set<string>(),
  'the -yze suffix is spelled -yse outside America',
);

export const suffixRules: Rule[] = [izeRule, yzeRule];
