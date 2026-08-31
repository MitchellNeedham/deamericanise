import type { Change, Rule, RuleContext } from '../types.js';

/** The American default page size; everywhere else prints on A4. */
export function paperSizeRule(): Rule {
  const INCH = String.raw`(?:\s*(?:"|”|″|in\.?|inches))?`;
  // Either the name, or the dimensions that give it away.
  const pattern = new RegExp(
    String.raw`(?<![\w-])(?:` +
      String.raw`(?:us\s+)?letter(?:[\s-]sized?)?(?:\s+paper)?` +
      String.raw`|8\.5${INCH}\s*(?:x|×|by)\s*11${INCH}` +
      String.raw`)(?![\w-])`,
    'gi',
  );

  const NAME_ONLY = /^(?:us\s+)?letter$/i;
  const PAPER_CONTEXT =
    /\b(?:paper|print(?:s|ed|ing|er|ers)?|pages?|pdf|margins?|portrait|landscape|tray|letterhead|a4)\b/i;
  const GLUE = /^[\s,;:()–—-]*(?:or|i\.e\.|that is|which is|aka)?[\s,;:()–—-]*$/i;
  // `US Letter is 8.5 x 11 inches` states what the size is. Rewriting either half of a
  // sentence like that destroys the thing it was explaining, so neither half fires.
  const DEFINITION = /^\s*(?:is|are|was|were|means|measures|=)\s*$/i;

  return {
    id: 'misc.paper-size',
    category: 'misc',
    confidence: 'risky',
    // Above the unit rules, so `8.5 x 11 inches` becomes a paper size rather than
    // two unrelated measurements.
    priority: 50,
    find(ctx: RuleContext): Change[] {
      const changes: Change[] = [];
      const all = [...ctx.text.matchAll(pattern)];

      // Checked before the context filter, because a definition often has no other
      // mention of paper in it at all.
      const definitional = new Set<number>();
      for (let i = 0; i < all.length - 1; i++) {
        const name = all[i]!;
        const dimensions = all[i + 1]!;
        if (!NAME_ONLY.test(name[0]) || NAME_ONLY.test(dimensions[0])) continue;
        const gap = ctx.text.slice(name.index + name[0].length, dimensions.index);
        if (!DEFINITION.test(gap)) continue;
        definitional.add(i);
        definitional.add(i + 1);
      }

      const matches = all.filter((match, i) => {
        if (definitional.has(i)) return false;
        const end = match.index + match[0].length;
        const around = ctx.text.slice(Math.max(0, match.index - 60), end + 60);
        // `letter` on its own is far too common a word, and bare `8.5 x 11` could be a
        // ratio or a grid. Both need the surrounding text to be about paper.
        if (NAME_ONLY.test(match[0])) return PAPER_CONTEXT.test(around);
        return /["”″]|in\b|inch/i.test(match[0]) || PAPER_CONTEXT.test(around);
      });

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i]!;
        let end = match.index + match[0].length;
        const next = matches[i + 1];
        const gap = next ? ctx.text.slice(end, next.index) : '';

        // `letter paper, 8.5 x 11 inches` names the size and then spells it out.
        // Swallow both so the result is one `A4` rather than two.
        if (next && GLUE.test(gap)) {
          end = next.index + next[0].length;
          i++;
        }

        changes.push({
          start: match.index,
          end,
          before: ctx.text.slice(match.index, end),
          after: 'A4',
          ruleId: 'misc.paper-size',
          category: 'misc',
          confidence: 'risky',
          priority: 50,
          note: 'US Letter is 216 x 279 mm and A4 is 210 x 297 mm, so layouts may need checking',
        });
      }
      return changes;
    },
  };
}

export function miscRules(): Rule[] {
  return [paperSizeRule()];
}
