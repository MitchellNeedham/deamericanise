export { deamericanise, deamericaniseText, analyse, findChanges } from './transform.js';
export { deamericaniseCode, deamericaniseFile, UnknownLanguageError } from './code.js';
export type { CodeOptions } from './code.js';
export { resolveOptions, buildGate, CATEGORIES, CONFIDENCES, PRESETS } from './config.js';
export { DIALECTS, dialectPack } from './dialects/index.js';
export type { DialectPack } from './dialects/index.js';
export { ruleCatalogue, ruleIds } from './rules/catalogue.js';
export type { RuleInfo } from './rules/catalogue.js';
export { LEXERS, PROSE_EXTENSIONS, lexerFor, commentSpans, languageNames } from './lexers/index.js';
export { looksLikeCode } from './engine/code-shape.js';
export type { LexerSpec, Span } from './lexers/index.js';
export { MEASURES } from './rules/units/definitions.js';
export type {
  AmericanSignals,
  Category,
  Change,
  Confidence,
  CurrencyOptions,
  DateOptions,
  Dialect,
  LexEntry,
  Options,
  Precision,
  Preset,
  ResolvedOptions,
  Result,
  Rule,
  RuleContext,
  TimeOptions,
  UnitOptions,
} from './types.js';
