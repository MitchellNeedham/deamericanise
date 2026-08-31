import type { Change, Rule, RuleContext } from '../types.js';

/**
 * Exchange rates move, so amounts are never converted. A bare `$` is instead pinned to
 * the currency it almost certainly means, which is the part a non-American reader
 * actually gets wrong.
 */
export function currencyRules(): Rule[] {
  const bareDollar = /(?<![A-Za-z$])\$\s?(\d[\d,]*(?:\.\d+)?)\s*([BMK]|billion|million|trillion|thousand)?/gi;
  const spelled = /(?<![\w-])(\d[\d,]*(?:\.\d+)?)\s+dollars(?![\w-])/gi;

  const rule: Rule = {
    id: 'currency.disambiguate',
    category: 'currency',
    confidence: 'moderate',
    priority: 25,
    find(ctx: RuleContext): Change[] {
      if (ctx.options.currency.mode === 'off' || !ctx.american) return [];
      const changes: Change[] = [];

      for (const match of ctx.text.matchAll(bareDollar)) {
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: `US${match[0]}`,
          ruleId: 'currency.disambiguate',
          category: 'currency',
          confidence: 'moderate',
          priority: 25,
          note: 'a bare $ is ambiguous outside America',
        });
      }

      for (const match of ctx.text.matchAll(spelled)) {
        changes.push({
          start: match.index,
          end: match.index + match[0].length,
          before: match[0],
          after: `${match[1]} US dollars`,
          ruleId: 'currency.disambiguate',
          category: 'currency',
          confidence: 'moderate',
          priority: 25,
        });
      }

      return changes;
    },
  };

  return [rule];
}
