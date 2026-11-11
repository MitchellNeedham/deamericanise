/**
 * Promises every result has to keep for any input, checked over the examples and over
 * generated text under several option sets:
 *
 * 1. Idempotence: a second run over the output changes nothing.
 * 2. Offsets: each change's `start` and `end` slice its `before` out of the input, the
 *    changes are sorted and do not overlap, and an `agreesWith` names a change in the list.
 * 3. Reconstruction: applying the changes to the input gives the output text.
 * 4. Structure: no change touches a URL, an email address, inline code, a fenced block or
 *    an HTML tag.
 * 5. Comments only: in a source file every change lies inside a comment, and every byte
 *    outside the comments, string literals included, comes through unchanged.
 * 6. Paragraphs: no change's `before` contains a blank line.
 *
 * The generated runs use a fixed seed so CI is deterministic. `PROPERTY_RUNS` sets the
 * number of inputs per option set, and `PROPERTY_SEED` the seed, for a longer search by
 * hand: `PROPERTY_RUNS=20000 PROPERTY_SEED=7 npx vitest run test/properties.test.ts`.
 * fast-check shrinks a failure to a minimal input and prints it with the seed and path
 * that replay it.
 *
 * `KNOWN_FAILURES` lists the inputs that break a property today, each with the issue that
 * tracks it. A generated failure that one of them recognises is not reported again, and
 * each entry fails once its input starts passing, so the list cannot go stale.
 */
import { readdirSync, readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DIALECTS, MEASURES, commentSpans, deamericanise, deamericaniseCode, lexerFor } from '../src/index.js';
import type { AmericanSignals, Change, CodeOptions, Result } from '../src/index.js';
import { applyChanges, type Range } from '../src/engine/apply.js';
import { spellingEntries } from '../src/rules/spelling/index.js';
import { baseVocabulary } from '../src/rules/vocabulary.js';

const RUNS = Number(process.env.PROPERTY_RUNS ?? 300);
const SEED = Number(process.env.PROPERTY_SEED ?? 32);

type Property = 'idempotence' | 'offsets' | 'reconstruction' | 'structure' | 'comments-only' | 'paragraphs';

interface Violation {
  property: Property;
  /** The text `change` was found in: the output, for idempotence. */
  text: string;
  change?: Change;
  /** For idempotence, the first run's change whose output the second run rewrites. */
  origin?: Change;
  /** For idempotence, the first run's change whose output ends just before `change`. */
  previous?: Change;
  /** For idempotence, the first run's change whose output starts just after `change`. */
  next?: Change;
  /** For idempotence, how American each run judged its input. */
  verdicts?: [first: AmericanSignals, second: AmericanSignals];
  detail: string;
}

const OPTION_SETS: Record<string, CodeOptions> = {
  read: {},
  localise: { preset: 'localise' },
  'en-GB': { dialect: 'en-GB', preset: 'localise' },
  'en-NZ': { dialect: 'en-NZ', preset: 'localise' },
  'en-CA': { dialect: 'en-CA', preset: 'localise' },
  'en-ZA': { dialect: 'en-ZA', preset: 'localise' },
  keepOriginal: { units: { keepOriginal: true } },
  'keepOriginal with localise': { preset: 'localise', units: { keepOriginal: true } },
  assumeAmerican: { assumeAmerican: true },
  'respectConventions off': { units: { respectConventions: false } },
  'long dates and 24-hour times': { dates: { format: 'long' }, times: { to24Hour: true } },
  'day-first dates': { dates: { format: 'dmy' } },
};

const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;
const within = (inner: Range, outer: Range): boolean => inner.start >= outer.start && inner.end <= outer.end;
const BLANK_LINE = /\n[ \t]*\n/;
const show = (c: Change): string =>
  `${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)} at ${c.start} (${c.ruleId})`;
/** The change with the text around it, which is all a long input needs to show. */
const around = (text: string, c: Change): string =>
  JSON.stringify(text.slice(Math.max(0, c.start - 40), c.end + 40));

/** Where each change's `after` landed in the output. */
function outputRanges(changes: Change[]): Range[] {
  let shift = 0;
  return changes.map((c) => {
    const start = c.start + shift;
    shift += c.after.length - (c.end - c.start);
    return { start, end: start + c.after.length };
  });
}

function run(input: string, options: CodeOptions): Result {
  return options.language === undefined ? deamericanise(input, options) : deamericaniseCode(input, options);
}

/**
 * Every property `input` breaks under `options`. `untouchable` lists spans the generator
 * placed that no change may overlap.
 */
function violations(input: string, options: CodeOptions, untouchable: Range[] = []): Violation[] {
  const result = run(input, options);
  const found: Violation[] = [];
  const report = (property: Property, change: Change | undefined, detail: string) =>
    found.push({ property, text: input, change, detail });

  let previousEnd = 0;
  for (const change of result.changes) {
    const actual = input.slice(change.start, change.end);
    if (actual !== change.before) report('offsets', change, `${show(change)} but the input there is ${JSON.stringify(actual)}`);
    if (change.end < change.start || change.start < previousEnd) {
      report('offsets', change, `${show(change)} is out of order or overlaps the change before it`);
    }
    const agrees = change.agreesWith;
    if (agrees && !result.changes.some((c) => c.start === agrees.start && c.end === agrees.end)) {
      report('offsets', change, `${show(change)} agrees with a change that is not in the list`);
    }
    if (BLANK_LINE.test(change.before)) report('paragraphs', change, `${show(change)} spans a blank line`);
    const hit = untouchable.find((span) => overlaps(change, span));
    if (hit) {
      const property = options.language === undefined ? 'structure' : 'comments-only';
      report(property, change, `${show(change)} overlaps ${JSON.stringify(input.slice(hit.start, hit.end))}`);
    }
    previousEnd = Math.max(previousEnd, change.end);
  }

  if (applyChanges(input, result.changes) !== result.text) {
    report('reconstruction', undefined, 'applying the changes to the input does not give the output');
  }

  if (options.language !== undefined) found.push(...commentViolations(input, options.language, result));

  const landed = outputRanges(result.changes);
  const second = run(result.text, options);
  const again = second.changes;
  for (const change of again) {
    // An article fix is reported through the replacement it agrees with.
    const agrees = change.agreesWith;
    if (agrees && again.some((c) => c.start === agrees.start && c.end === agrees.end)) continue;
    const origin = result.changes.find((_, i) => overlaps(change, landed[i]!));
    const previous = result.changes.find((_, i) => {
      const { end } = landed[i]!;
      return end <= change.start && /^\s*$/.test(result.text.slice(end, change.start));
    });
    const next = result.changes.find((_, i) => {
      const { start } = landed[i]!;
      return start >= change.end && /^\s*$/.test(result.text.slice(change.end, start));
    });
    found.push({
      property: 'idempotence',
      text: result.text,
      change,
      origin,
      previous,
      next,
      verdicts: [result.signals, second.signals],
      detail: `a second run makes ${show(change)} in ${around(result.text, change)}`,
    });
  }
  return found;
}

/** Every change is inside a comment, and the source outside the comments is unchanged. */
function commentViolations(input: string, language: string, result: Result): Violation[] {
  const spans = commentSpans(input, lexerFor(language)!);
  const found: Violation[] = [];
  for (const change of result.changes) {
    if (!spans.some((span) => within(change, span))) {
      found.push({ property: 'comments-only', text: input, change, detail: `${show(change)} is outside every comment` });
    }
  }
  if (found.length) return found;

  // With every change inside a comment, each comment moves by what the changes before it added.
  let shift = 0;
  let cursor = 0;
  let outside = '';
  let outsideAfter = '';
  for (const span of spans) {
    const grown = result.changes
      .filter((c) => within(c, span))
      .reduce((total, c) => total + c.after.length - (c.end - c.start), 0);
    outside += input.slice(cursor, span.start);
    outsideAfter += result.text.slice(cursor + shift, span.start + shift);
    shift += grown;
    cursor = span.end;
  }
  outside += input.slice(cursor);
  outsideAfter += result.text.slice(cursor + shift);
  if (outside !== outsideAfter) {
    found.push({ property: 'comments-only', text: input, detail: 'the source outside the comments changed' });
  }
  return found;
}

// ----- known failures -----

interface KnownFailure {
  /** The GitHub issue that tracks it. */
  issue: number;
  property: Property;
  input: string;
  options: CodeOptions;
  /** Recognises the same failure in other text, so generated runs do not report it again. */
  matches(violation: Violation): boolean;
}

/** A second run rewrites a replacement the first run wrote. */
const rewritesReplacement =
  (...afters: string[]) =>
  (v: Violation): boolean =>
    v.origin !== undefined && afters.includes(v.origin.after.toLowerCase());

const precedes =
  (pattern: RegExp) =>
  (v: Violation): boolean =>
    v.change !== undefined && pattern.test(v.text.slice(0, v.change.start));

const follows =
  (pattern: RegExp) =>
  (v: Violation): boolean =>
    v.change !== undefined && pattern.test(v.text.slice(v.change.end));

const localise = { preset: 'localise' } as const;
const american = { assumeAmerican: true } as const;

const KNOWN_FAILURES: KnownFailure[] = [
  {
    issue: 152,
    property: 'idempotence',
    input: 'Paid tuition.',
    options: localise,
    matches: rewritesReplacement('tuition fees'),
  },
  {
    issue: 152,
    property: 'idempotence',
    input: 'a garbage truck',
    options: { ...localise, dialect: 'en-GB' },
    matches: rewritesReplacement('rubbish truck', 'rubbish trucks'),
  },
  {
    issue: 152,
    property: 'idempotence',
    input: 'the mailman',
    options: { ...localise, dialect: 'en-GB' },
    matches: rewritesReplacement('postie', 'posties'),
  },
  {
    issue: 152,
    property: 'idempotence',
    input: 'an apartment building',
    options: { ...localise, dialect: 'en-NZ' },
    matches: rewritesReplacement('apartment block', 'apartment blocks'),
  },
  {
    issue: 153,
    property: 'idempotence',
    input: 'Roll it half an inch thick.',
    options: { units: { keepOriginal: true } },
    // The second run converts the original that `keepOriginal` put in brackets.
    matches: (v) => v.change !== undefined && v.origin?.after.endsWith(`(${v.change.before})`) === true,
  },
  {
    issue: 154,
    property: 'idempotence',
    input: '1/13/2024 - 0°F',
    options: american,
    matches: (v) => v.change?.category === 'units' && v.origin?.category === 'dates',
  },
  {
    issue: 154,
    property: 'idempotence',
    input: 'Price $5 - 10 inches long.',
    options: american,
    matches: (v) => v.change?.category === 'currency' && v.origin?.category === 'units',
  },
  {
    issue: 154,
    property: 'idempotence',
    input: '// On 13/4/2024 - 1 inch fell. On 1-13-2024 it cost $971.\n',
    options: { language: 'ts' },
    // The first run broke up a day-first date, so the second run reads the text as more American.
    matches: (v) =>
      v.verdicts !== undefined &&
      (v.verdicts[1].unambiguousDayFirstDates < v.verdicts[0].unambiguousDayFirstDates ||
        v.verdicts[1].namedDayFirstDates < v.verdicts[0].namedDayFirstDates),
  },
  {
    issue: 155,
    property: 'paragraphs',
    input: 'Room 13\n\n- 0°F overnight',
    options: {},
    matches: (v) => v.change?.ruleId === 'units.temperature.fahrenheit',
  },
  {
    issue: 156,
    property: 'paragraphs',
    input: 'It was $5\n\nThen it rose.',
    options: american,
    matches: (v) => v.change?.ruleId === 'currency.disambiguate',
  },
  {
    issue: 156,
    property: 'idempotence',
    input: 'Spend $50 modernizing the kitchen.',
    options: american,
    // The amount took the first letter of the next word as its scale, and kept that word from changing.
    matches: (v) => v.origin?.ruleId === 'currency.disambiguate' && v.change?.category !== 'currency',
  },
  {
    issue: 156,
    property: 'idempotence',
    input: 'We sold $5 bell peppers.',
    options: { ...localise, ...american },
    // The amount lost the overlap with the next word on the first run, and takes the space after it.
    matches: (v) => v.change?.ruleId === 'currency.disambiguate' && v.origin === undefined && /\s$/.test(v.change.before),
  },
  {
    issue: 157,
    property: 'idempotence',
    input: 'grade 10 feet',
    options: localise,
    matches: (v) => v.change?.ruleId === 'vocabulary.grades' && v.origin?.category === 'units',
  },
  {
    issue: 157,
    property: 'idempotence',
    input: 'She measured in 2nd grade inches.',
    options: localise,
    matches: (v) => v.change?.category === 'units' && v.origin?.ruleId === 'vocabulary.grades',
  },
  {
    issue: 158,
    property: 'idempotence',
    input: 'On 03/04/2024 the storm hit.',
    options: { assumeAmerican: true, dates: { format: 'dmy' } },
    matches: (v) => v.change?.ruleId === 'dates.numeric' && v.origin?.ruleId === 'dates.numeric',
  },
  {
    issue: 159,
    property: 'idempotence',
    input: 'Speeds of 2-622 miles an hour cost $1,317.',
    options: {},
    // The first run wrote something the second run's detection counts as a month-first date.
    matches: (v) =>
      v.verdicts !== undefined && v.verdicts[1].unambiguousMonthFirstDates > v.verdicts[0].unambiguousMonthFirstDates,
  },
  {
    issue: 160,
    property: 'idempotence',
    input: 'The ridge is 911 feet high.',
    options: { ...localise, units: { keepOriginal: true } },
    matches: (v) => v.change?.before === '911' || v.origin?.before === '911',
  },
  {
    issue: 160,
    property: 'idempotence',
    input: 'It cost $1,911 to fix.',
    options: { ...localise, ...american },
    matches: (v) => v.change?.before === '911' || v.origin?.before === '911',
  },
  {
    issue: 69,
    property: 'idempotence',
    input: 'Bought 3/14/2024 1/2 gallon of milk.',
    options: american,
    matches: (v) => v.change?.category === 'units' && precedes(/\d{4}-\d\d-\d\d\s+$/)(v),
  },
  {
    issue: 88,
    property: 'idempotence',
    input: 'half a mile May 3, 2024',
    options: localise,
    // A written-out quantity the first run left because a word followed it, which that run
    // then rewrote into something starting with a number.
    matches: (v) =>
      v.change?.category === 'units' &&
      /^[a-z]/i.test(v.change.before) &&
      v.origin === undefined &&
      follows(/^[\s-]+\d/)(v),
  },
  {
    issue: 164,
    property: 'idempotence',
    input: 'At 6:00 PM pound the cutlets thin.',
    options: { times: { to24Hour: true } },
    matches: (v) => v.change?.category === 'units' && precedes(/\d:$/)(v),
  },
  {
    issue: 165,
    property: 'idempotence',
    input: 'Temperatures at 6 p.m. were 10F.',
    options: {},
    // A bare F the first run left: something it rewrote had a stop that cut the sentence short.
    matches: (v) =>
      v.change?.ruleId === 'units.temperature.fahrenheit' &&
      /\d\s?F$/.test(v.change.before) &&
      v.origin === undefined &&
      !precedes(/\bbaking\b[^.!?]*$/i)(v),
  },
  {
    issue: 166,
    property: 'idempotence',
    input: 'Put the cookie sheet in at 350F.',
    options: localise,
    matches: (v) => v.change?.ruleId === 'units.temperature.fahrenheit' && precedes(/\bbaking\b[^.!?]*$/i)(v),
  },
  {
    issue: 167,
    property: 'idempotence',
    input: 'On March 1, 732 square miles burned.',
    options: localise,
    // A number the first run wrote reads as the year of a date before it.
    matches: (v) => v.change?.ruleId === 'dates.long' && v.origin !== undefined,
  },
  {
    issue: 168,
    property: 'idempotence',
    input: 'Choose US Letter or 8.5 x 11 inches.',
    options: localise,
    matches: (v) => v.change?.ruleId === 'misc.paper-size' && /letter/i.test(v.change.before),
  },
  {
    issue: 169,
    property: 'idempotence',
    input: 'Expect slow traffic at 9:00 AM highway exits.',
    options: { ...localise, dialect: 'en-GB' },
    // A word's guard read the word beside it, which the first run then rewrote.
    matches: (v) =>
      v.origin === undefined &&
      (v.previous !== undefined || v.next !== undefined) &&
      (v.change?.category === 'vocabulary' || v.change?.category === 'spelling'),
  },
];

const isKnown = (v: Violation): boolean => KNOWN_FAILURES.some((k) => k.property === v.property && k.matches(v));
const unknownViolations = (input: string, options: CodeOptions, untouchable: Range[] = []): Violation[] =>
  violations(input, options, untouchable).filter((v) => !isKnown(v));

// ----- generated text -----

const unique = (words: string[]): string[] => [...new Set(words)].sort();

const LEXICON = unique([
  ...spellingEntries().map((e) => e.from),
  ...baseVocabulary().map((e) => e.from),
  ...Object.values(DIALECTS).flatMap((pack) => pack.vocabulary.map((e) => e.from)),
  // The suffix rules respell open-ended `-ize` and `-yze` words, which no list holds.
  'organize', 'realized', 'analyzing', 'apologizes', 'prioritization',
]);

const UNITS = unique(MEASURES.flatMap((m) => [...m.words, ...m.abbrevs]));

const FILLER = [
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'by', 'in', 'on', 'at', 'for', 'per', 'with', 'is',
  'was', 'about', 'nearly', 'over', 'it', 'we', 'they', 'Step', 'Track', 'Day', 'see', 'from',
];

const cased = (words: string[]): fc.Arbitrary<string> =>
  fc
    .tuple(fc.constantFrom(...words), fc.constantFrom('lower', 'title', 'upper'))
    .map(([word, form]) =>
      form === 'upper' ? word.toUpperCase() : form === 'title' ? word[0]!.toUpperCase() + word.slice(1) : word,
    );

const integer = fc.integer({ min: 0, max: 2500 }).map(String);

const number = fc.oneof(
  integer,
  fc.tuple(integer, fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a}.${b}`),
  fc
    .tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 0, max: 999 }))
    .map(([a, b]) => `${a},${String(b).padStart(3, '0')}`),
  fc.tuple(fc.integer({ min: 1, max: 15 }), fc.integer({ min: 2, max: 16 })).map(([a, b]) => `${a}/${b}`),
  fc
    .tuple(integer, fc.integer({ min: 1, max: 3 }), fc.constantFrom(2, 4, 8))
    .map(([a, b, c]) => `${a} ${b}/${c}`),
  fc.constantFrom('½', '¼', '¾', '1½', '2¼'),
  fc.constantFrom(
    'one', 'two', 'three', 'ten', 'twelve', 'twenty', 'twenty-five', 'a hundred', 'a', 'an',
    'half a', 'half an', 'a quarter', 'one-half', 'one-fourth of a', 'one and a half', 'a dozen',
  ),
  integer.map((n) => `-${n}`),
  fc
    .tuple(integer, fc.constantFrom('-', '\u2013', ' to ', ' or ', ' x ', ' by '), integer)
    .map(([a, join, b]) => `${a}${join}${b}`),
);

const measurement = fc
  .tuple(number, fc.constantFrom('', ' ', '-', '\u00a0'), fc.constantFrom(...UNITS))
  .map(([n, gap, unit]) => `${n}${gap}${unit}`);

const height = fc
  .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 11 }))
  .chain(([feet, inches]) =>
    fc.constantFrom(`${feet}'${inches}"`, `${feet} feet ${inches} inches`, `${feet} ft ${inches} in`, `${feet}′${inches}″`),
  );

const temperature = fc
  .tuple(
    fc.integer({ min: -40, max: 500 }),
    fc.constantFrom('°F', ' °F', ' degrees Fahrenheit', ' degrees F', 'F', '°', ' degrees'),
  )
  .map(([n, unit]) => `${n}${unit}`);

const MONTHS = ['January', 'March', 'May', 'September', 'December', 'Feb', 'Oct'];

const date = fc
  .tuple(fc.integer({ min: 1, max: 13 }), fc.integer({ min: 1, max: 32 }), fc.constantFrom('2024', '24', '1999', '98'))
  .chain(([month, day, year]) => {
    const name = MONTHS[month % MONTHS.length]!;
    const pad = (n: number) => String(n).padStart(2, '0');
    return fc.constantFrom(
      `${month}/${day}/${year}`,
      `${pad(month)}/${pad(day)}/${year}`,
      `${month}-${day}-${year}`,
      `${name} ${day}, ${year}`,
      `${day} ${name} ${year}`,
      `${name} ${day}`,
    );
  });

const time = fc
  .tuple(
    fc.integer({ min: 0, max: 13 }),
    fc.constantFrom('00', '05', '30', '59'),
    fc.constantFrom(' AM', ' PM', ' a.m.', ' p.m.', 'am', 'pm', ''),
  )
  .map(([h, m, suffix]) => `${h}:${m}${suffix}`);

const money = fc
  .tuple(number, fc.constantFrom('', ' million', 'M', 'K', ' billion'))
  .chain(([n, scale]) => fc.constantFrom(`$${n}${scale}`, `$ ${n}`, `${n} dollars`, `US$${n}`));

const PHRASES = [
  'Mr. Smith', 'Dr. Jones', 'the U.S.', 'U.S.A.', 'a Ph.D.', 'letter paper', 'US Letter',
  '8.5 x 11 inches', 'call 911', 'zip code', 'first grade', 'grade 5', '20 mpg',
  '30 miles per gallon', '2x4', 'a 9 inch dish', 'the 40 yard line', 'a 27 inch monitor',
  '£5', 'metric tons', '1.8 metres (6 feet)', '6 feet (1.8 metres)', '"quoted"', "it's",
  'e.g.', 'i.e.',
];

const prose = fc.oneof(
  { weight: 4, arbitrary: cased(LEXICON) },
  { weight: 3, arbitrary: fc.constantFrom(...FILLER) },
  { weight: 4, arbitrary: measurement },
  { weight: 1, arbitrary: height },
  { weight: 1, arbitrary: number },
  { weight: 1, arbitrary: temperature },
  { weight: 1, arbitrary: date },
  { weight: 1, arbitrary: time },
  { weight: 1, arbitrary: money },
  { weight: 1, arbitrary: fc.constantFrom(...PHRASES) },
);

const SEPARATORS = [' ', ' ', ' ', ', ', '. ', '! ', '? ', '; ', ': ', ' - ', ' (', ') ', '\n', '\n\n', '\n- ', '\n1. ', '\t'];

const slug = cased(LEXICON).map((word) => word.replace(/[^A-Za-z0-9]+/g, '-'));
const words = fc.array(fc.oneof(cased(LEXICON), measurement), { minLength: 1, maxLength: 3 });

interface Structure {
  text: string;
  /** Sits on lines of its own, as a fence must. */
  block: boolean;
}

/** Text that must come through untouched, whatever is in it. */
const structure: fc.Arbitrary<Structure> = fc.oneof(
  slug.map((w) => ({ text: `https://example.com/${w}?q=${w}`, block: false })),
  slug.map((w) => ({ text: `www.${w}.com`, block: false })),
  slug.map((w) => ({ text: `${w}.${w}@example.com`, block: false })),
  words.map((ws) => ({ text: `\`${ws.join(' ')}\``, block: false })),
  slug.map((w) => ({ text: `<span class="${w}">`, block: false })),
  words.map((ws) => ({ text: `\`\`\`\n${ws.join('\n')}\n\`\`\``, block: true })),
);

type Piece = { prose: string } | { structure: Structure };

const pieces = fc.array(
  fc.tuple(
    fc.oneof(
      { weight: 6, arbitrary: prose.map((text): Piece => ({ prose: text })) },
      { weight: 1, arbitrary: structure.map((s): Piece => ({ structure: s })) },
    ),
    fc.constantFrom(...SEPARATORS),
  ),
  { minLength: 1, maxLength: 14 },
);

interface Generated {
  text: string;
  untouchable: Range[];
}

/** Joins the pieces, with whitespace around each piece of structure so nothing runs into it. */
function assemble(parts: Array<[Piece, string]>): Generated {
  let text = '';
  const untouchable: Range[] = [];
  for (const [part, separator] of parts) {
    if ('prose' in part) {
      text += part.prose + separator;
      continue;
    }
    const pad = part.structure.block ? '\n' : ' ';
    if (text && !text.endsWith(pad)) text += pad;
    untouchable.push({ start: text.length, end: text.length + part.structure.text.length });
    text += part.structure.text + pad;
  }
  return { text, untouchable };
}

const generatedProse: fc.Arbitrary<Generated> = pieces.map(assemble);

// ----- generated source files -----

interface Language {
  id: string;
  /** Places one line of prose in a line comment, a block of it in a block comment, and a string literal. */
  render(line: string, block: string, literal: string): Array<[text: string, literal: boolean]>;
}

const LANGUAGES: Language[] = [
  {
    id: 'ts',
    render: (line, block, literal) => [
      [`// ${line}\nconst note = "`, false], [literal, true], [`";\n/* ${block} */\nlet other = '`, false],
      [literal, true], [`'; // ${line}\n`, false],
    ],
  },
  {
    id: 'python',
    render: (line, _block, literal) => [
      [`# ${line}\nnote = "`, false], [literal, true], [`"\nother = '`, false], [literal, true], [`'  # ${line}\n`, false],
    ],
  },
  {
    id: 'sql',
    render: (line, block, literal) => [
      [`-- ${line}\nSELECT '`, false], [literal, true], [`' AS note;\n/* ${block} */\n`, false],
    ],
  },
  {
    id: 'sh',
    render: (line, _block, literal) => [[`# ${line}\necho "`, false], [literal, true], [`"\n`, false]],
  },
  {
    id: 'rs',
    render: (line, block, literal) => [
      [`// ${line}\nlet note = "`, false], [literal, true], [`";\n/* ${block} */\n`, false],
    ],
  },
];

interface GeneratedSource extends Generated {
  language: string;
}

/** Generated prose without the characters that would end the comment or string it goes in. */
const proseWithout = (ending: RegExp) => pieces.map((parts) => assemble(parts).text.replace(ending, ' '));

const generatedSource: fc.Arbitrary<GeneratedSource> = fc
  .tuple(fc.constantFrom(...LANGUAGES), proseWithout(/\n/g), proseWithout(/\*/g), proseWithout(/["'\\\n]/g))
  .map(([language, line, block, literal]) => {
    let text = '';
    const untouchable: Range[] = [];
    for (const [part, isLiteral] of language.render(line, block, literal)) {
      if (isLiteral) untouchable.push({ start: text.length, end: text.length + part.length });
      text += part;
    }
    return { text, untouchable, language: language.id };
  });

// ----- the properties -----

const EXAMPLES_DIR = new URL('../examples/', import.meta.url);
const EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((file) => file.endsWith('.md') && !file.endsWith('.deamericanised.md') && file !== 'README.md')
  .sort();

describe('the examples keep every promise', () => {
  for (const [name, options] of Object.entries(OPTION_SETS)) {
    it.each(EXAMPLES)(`%s with ${name}`, (file) => {
      const text = readFileSync(new URL(file, EXAMPLES_DIR), 'utf8');
      expect(unknownViolations(text, options)).toEqual([]);
    });
  }
});

describe('generated text keeps every promise', () => {
  for (const [name, options] of Object.entries(OPTION_SETS)) {
    it(`with ${name}`, () => {
      fc.assert(
        fc.property(generatedProse, ({ text, untouchable }) => {
          expect(unknownViolations(text, options, untouchable)).toEqual([]);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });
  }
});

describe('generated source files keep every promise', () => {
  for (const [name, options] of Object.entries(OPTION_SETS)) {
    it(`with ${name}`, () => {
      fc.assert(
        fc.property(generatedSource, ({ text, untouchable, language }) => {
          expect(unknownViolations(text, { ...options, language }, untouchable)).toEqual([]);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    });
  }
});

describe('inputs that once broke a property', () => {
  it.each([
    ['It is 6 feet tall.', { units: { keepOriginal: true } }],
    ['It is 1.8 metres (6 feet) tall.', { units: { keepOriginal: true } }],
    ['Step 14\n\n1/2 gallon of milk.', {}],
    ['Step 14\n1/2 gallon of milk.', american],
  ] satisfies Array<[string, CodeOptions]>)('%j with %j', (input, options) => {
    expect(violations(input, options)).toEqual([]);
  });
});

describe('known failures', () => {
  it.each(KNOWN_FAILURES.map((k) => [k.issue, k.property, JSON.stringify(k.input), k] as const))(
    '#%i breaks %s on %s',
    (issue, property, _input, known) => {
      const found = violations(known.input, known.options).filter((v) => v.property === property);
      expect(found, `now keeps the promise: remove it from KNOWN_FAILURES and check #${issue}`).not.toEqual([]);
      expect(found.some(known.matches), 'the failure no longer matches its own pattern').toBe(true);
    },
  );
});
