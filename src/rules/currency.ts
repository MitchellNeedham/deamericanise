import type { Change, Rule, RuleContext } from '../types.js';
import { sentenceBounds } from './sentence.js';

const SCALE = String.raw`[^\S\n]?(billion|million|trillion|thousand|[BMK])(?![\p{L}\p{N}])`;

// Ends at the last digit or a whole scale word: the text after it may belong to another rule.
const bareDollar = new RegExp(String.raw`(?<![A-Za-z$])\$\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)(?:${SCALE})?`, 'giu');

/** `$` and one figure that `bareDollar` reads with no decimal, comma or scale after it. */
const figureVariable = (figures: string) =>
  new RegExp(String.raw`(?<![A-Za-z$])\$${figures}(?![\d,]*\d|\.\d|${SCALE})`, 'iu');

const ANY_FIGURE = figureVariable(String.raw`\d`);
const FIRST_FIGURE = figureVariable('[01]');

/** Words that put a sentence about code, where `$1` names a capture group or an argument. */
const ABOUT_CODE = new RegExp(
  String.raw`\b(?:${[
    'captur(?:e[ds]?|ing)', 'groups?', 'match(?:e[ds]|ing)?', 'regex(?:e?s|ps?)?',
    'regular expressions?', 'replacements?', 'back-?references?', 'arguments?', 'parameters?',
    'positional', 'shells?', 'scripts?', 'scripting', 'variables?', 'sed', 'awk', 'bash', 'perl',
  ].join('|')})\b`,
  'i',
);

/** A shell or Perl variable named by something other than a figure: `$HOME`, `${name}`, `$@`. */
const NAMED_VARIABLE = /(?<![A-Za-z$])\$[A-Za-z_{@*#?!]/;

/** Any capitalised word after a stop starts a new sentence. */
const ANY_OPENER = /(?:)/y;

const REACH = 120;

/**
 * Whether `$` and one figure, with no decimal, comma or scale, is a variable such as a capture
 * group or a script's argument rather than an amount. It is in a sentence about code, or one
 * that names another variable. Positional variables count from `$0` or `$1`, so another figure
 * counts only beside one of those, and `It cost $5, then $6.` is two amounts.
 */
function isVariable(text: string, match: RegExpMatchArray): boolean {
  if (match[0].length !== 2) return false;
  const start = match.index!;
  const [from, to] = sentenceBounds(text, start, start + 2, ANY_OPENER, REACH);
  const around = `${text.slice(from, start)} ${text.slice(start + 2, to)}`;
  if (ABOUT_CODE.test(around) || NAMED_VARIABLE.test(around)) return true;
  return (match[1] === '0' || match[1] === '1' ? ANY_FIGURE : FIRST_FIGURE).test(around);
}

/**
 * Exchange rates move, so amounts are never converted. A bare `$` is instead pinned to
 * the currency it almost certainly means, which is the part a non-American reader
 * actually gets wrong.
 */
export function currencyRules(): Rule[] {
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
        if (isVariable(ctx.text, match)) continue;
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
