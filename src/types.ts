/** Dialects the output can be written in. All are non-US; they differ in vocabulary and a few spellings. */
export type Dialect = 'en-AU' | 'en-GB' | 'en-NZ' | 'en-CA' | 'en-IE' | 'en-ZA';

export type Category =
  | 'spelling'
  | 'vocabulary'
  | 'units'
  | 'dates'
  | 'times'
  | 'currency'
  | 'punctuation'
  | 'misc';

/**
 * How likely a rule is to be right without human review.
 * `safe`     - no plausible false positive (colour, aluminium).
 * `moderate` - relies on a wordlist that could collide with a proper noun.
 * `risky`    - relies on guessing the sense of a word (tire, check, fall).
 */
export type Confidence = 'safe' | 'moderate' | 'risky';

export interface Change {
  /** Offset into the text that was passed to the transform. */
  start: number;
  end: number;
  before: string;
  after: string;
  ruleId: string;
  category: Category;
  confidence: Confidence;
  /** Why this rule fired, when it is not self-evident. */
  note?: string;
  /** Overlap tie-break; higher wins. Set by the rule, not usually read by callers. */
  priority?: number;
  /**
   * Set only on an article fix (`grammar.article-agreement`): the `start` and `end` of the
   * replacement it agrees with, which is in the same list of changes. Apply both or
   * neither, since either one alone leaves `a eraser` or `an rubber`.
   */
  agreesWith?: { start: number; end: number };
  /**
   * Set only by a rule, never on a change in a result: the rule left this span as written
   * on purpose, as with a conventional size. It is never applied, and a change that would
   * rewrite part of it but not all of it is dropped, so `15-17 inch wheels` is never left
   * half converted.
   */
  hold?: true;
}

/** Evidence that the input really is American, used to gate the ambiguous rules. */
export interface AmericanSignals {
  /** 0-1. Rules that need American-ness compare against `dates.minConfidence`. */
  confidence: number;
  /** Labels for the American spellings, words and habits found in the text. */
  markers: string[];
  /**
   * Numeric dates that state their own order, by carrying a day component above 12.
   * These are the only reliable guide to how a document punches its other numeric dates.
   */
  unambiguousMonthFirstDates: number;
  unambiguousDayFirstDates: number;
  /**
   * Dates written with the month spelled out. Strong evidence that the prose is
   * American, but no evidence at all about the numeric dates beside it: a US agency can
   * publish `February 4, 2022` in its prose and `20/02/2026` in its data.
   */
  namedMonthFirstDates: number;
  namedDayFirstDates: number;
}

export interface Result {
  text: string;
  changes: Change[];
  signals: AmericanSignals;
}

export type Precision = 'natural' | 'exact' | number;

export interface UnitOptions {
  /** Append the original, e.g. `1.8 metres (6 ft)`. */
  keepOriginal?: boolean;
  /**
   * `natural` matches the significant figures of the source, so `6 feet` reads `1.8 metres`.
   * `exact` keeps up to `maxDecimals` places. A number fixes the decimal places.
   */
  precision?: Precision;
  /** Cap for `precision: 'exact'`. */
  maxDecimals?: number;
  /**
   * Leave a measurement alone where the unit is part of a name: inches for screens,
   * wheels, pipes, vinyl and lumber, yards for the lines on a field, and pounds for weight
   * classes. On by default.
   */
  respectConventions?: boolean;
  /** Convert `mpg` to `L/100km` rather than `km/L`. */
  fuelEconomy?: 'l-per-100km' | 'km-per-l';
}

export interface DateOptions {
  /** Output shape for a numeric date that was written month-first. */
  format?: 'iso' | 'dmy' | 'long';
  /**
   * Rewrite `March 5, 2024` as `5 March 2024`. Defaults to on only under `localise`: a
   * named month is unambiguous to everyone, so the order is convention, not clarity.
   */
  reorderLongDates?: boolean;
}

export interface TimeOptions {
  /** Rewrite `3:00 PM` as `15:00`. */
  to24Hour?: boolean;
}

export interface CurrencyOptions {
  /** `annotate` turns a bare `$5` into `US$5`. `off` leaves it alone. */
  mode?: 'annotate' | 'off';
}

/**
 * `read` makes an American text readable without changing what it is about, which is what
 * you want when the text is an American article that should stay American.
 * `localise` also swaps the content for local equivalents, which is what you want when
 * you are going to cook from the recipe.
 */
export type Preset = 'read' | 'localise';

export interface Options {
  /** Defaults to `en-AU`. */
  dialect?: Dialect;
  /** Defaults to `read`. */
  preset?: Preset;
  /** Turn categories on or off individually. Overrides the preset. */
  categories?: Partial<Record<Category, boolean>>;
  /** Confidence tiers to run. Defaults to all three. */
  confidence?: Confidence[];
  /**
   * Per-rule overrides, checked after categories and confidence.
   * Supports a trailing wildcard: `{ 'spelling.contextual.*': false }`.
   */
  rules?: Record<string, boolean>;
  /** Spans matching these are never rewritten. Added to the built-in proper nouns. */
  protect?: (string | RegExp)[];
  /** Drop the built-in proper noun list (Pearl Harbor, Labor Party, World Trade Center...). */
  protectProperNouns?: boolean;
  /**
   * Leave identifier-shaped tokens alone: `camelCase`, `snake_case`, `background-color`,
   * `obj.prop`, `--flags`. Defaults to true for code and false for prose.
   */
  protectIdentifiers?: boolean;
  /**
   * Leave comment lines that read as commented-out code alone. Defaults to the same as
   * `protectIdentifiers`, so it is on for source files and off for prose.
   */
  protectCommentedCode?: boolean;
  /** Units to leave alone, by their `keep` key: `mile`, `pint`, `inch`, and so on. */
  unitsKeep?: string[];
  units?: UnitOptions | false;
  dates?: DateOptions | false;
  times?: TimeOptions | false;
  currency?: CurrencyOptions | false;
  /** Force the American-ness verdict instead of inferring it from the text. */
  assumeAmerican?: boolean;
  /**
   * How sure we must be that the text is American before running the rules that need it:
   * an ambiguous `03/04/2024`, and pinning a bare `$` to US dollars. Self-disambiguating
   * dates such as `3/14/2024` ignore this. Defaults to 0.5.
   */
  minAmericanConfidence?: number;
}

export interface ResolvedOptions {
  dialect: Dialect;
  preset: Preset;
  categories: Record<Category, boolean>;
  confidence: Confidence[];
  rules: Record<string, boolean>;
  protect: RegExp[];
  protectProperNouns: boolean;
  protectIdentifiers: boolean;
  protectCommentedCode: boolean;
  /** The host language's line-comment markers, set when transforming a source file. */
  commentMarkers: string[];
  unitsKeep: string[];
  units: Required<UnitOptions> & { enabled: boolean };
  dates: Required<DateOptions> & { enabled: boolean };
  times: Required<TimeOptions> & { enabled: boolean };
  currency: Required<CurrencyOptions> & { enabled: boolean };
  assumeAmerican: boolean | undefined;
  minAmericanConfidence: number;
}

/** A word or phrase swap, optionally gated on what surrounds it. */
export interface LexEntry {
  from: string;
  to: string;
  ruleId: string;
  category: Category;
  confidence: Confidence;
  note?: string;
  /** Tested against the text immediately preceding the match. Anchor with `$`. */
  requireBefore?: RegExp;
  /** Tested against the text immediately following the match. Anchor with `^`. */
  requireAfter?: RegExp;
  forbidBefore?: RegExp;
  forbidAfter?: RegExp;
  /** Tested against the matched text as written, so it can refuse on case. */
  forbidMatch?: RegExp;
  /** Only fire when the document looks American. */
  needsAmerican?: boolean;
  /**
   * Overlap tie-break. Gated entries outrank plain ones, which outrank suffix patterns.
   * Rows for the same word are tried dialect pack first, then shared lists, and by
   * priority within each.
   */
  priority?: number;
}

export interface RuleContext {
  text: string;
  options: ResolvedOptions;
  signals: AmericanSignals;
  /** True when the text is American enough for the ambiguous rules to fire. */
  american: boolean;
}

export interface Rule {
  id: string;
  category: Category;
  confidence: Confidence;
  /** Higher wins when two changes overlap. Lexicon entries sit at 0. */
  priority?: number;
  find(ctx: RuleContext): Change[];
}
