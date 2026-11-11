import { readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { CATEGORIES, CONFIDENCES, PRESETS, matchesRuleId } from './config.js';
import { DIALECTS } from './dialects/index.js';
import { PROSE_EXTENSIONS, languageNames, lexerFor } from './lexers/index.js';
import { ruleIds } from './rules/catalogue.js';
import { MEASURES } from './rules/units/definitions.js';
import { deamericaniseFile, isKnownLanguage } from './code.js';
import type { Category, Change, Confidence, Dialect, Options, Preset, Precision } from './types.js';

/** Replaced at build time from package.json, which CI stamps from the release tag. */
declare const __VERSION__: string;

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', 'vendor', 'target',
]);

/**
 * Prose files that conventionally have no extension. Licence texts and lists of names are
 * left out: a licence must stay verbatim, and a surname is not a misspelling.
 */
const PROSE_FILENAMES = new Set(['readme', 'changelog', 'changes', 'history', 'news', 'contributing']);

const HELP = `deamericanise - rewrite American English into the version the rest of the world reads

Usage
  deamericanise [options] [files or directories...]
  cat README.md | deamericanise --language md

Output
  -w, --write            Rewrite the files in place
  -d, --diff             Print a diff instead of the result
  -c, --check            Print nothing, exit 1 if anything would change (for CI)
      --json             Print every change as JSON
      --explain          List each change with the rule that made it

Rules
      --dialect <id>     ${Object.keys(DIALECTS).join(', ')} (default en-AU)
  -l, --localise         Also swap vocabulary for local words: bell pepper to capsicum,
                         911 to 000, 5th grade to Year 5. Off by default, because an
                         American article should keep its sidewalks and gas stations.
      --preset <name>    ${PRESETS.join(' | ')} (default read)
      --off <list>       Categories to skip: ${CATEGORIES.join(', ')}
      --only <list>      Run only these categories
      --confidence <list>  Tiers to run: ${CONFIDENCES.join(', ')} (default all)
      --rule <id>=<bool> Turn one rule on or off; repeatable, accepts a trailing *
      --protect <word>   Never rewrite this word; repeatable
      --assume-american  Skip detection and treat the input as American
      --no-assume-american

Units
      --keep-original    Write "1.8 metres (6 ft)"
      --precision <p>    natural (default), exact, or a number of decimal places
      --units-keep <list>  Units to leave alone, e.g. mile,pint,inch

Files
      --language <id>    Force a language: ts, python, ruby, sql, md, ... (needed for stdin)
                         A named file of unknown type, such as settings.json, is skipped
                         unless this is given. --language md reads it as prose, and
                         --language json reads only its comments.
      --docstrings       Also rewrite Python docstrings
      --no-code-guard    Rewrite comment lines that look like commented-out code too
      --list-languages   Print every language name --language accepts

Other
      --list-rules       Print every rule id
      --list-dialects    Print the supported dialects
  -h, --help
  -v, --version
`;

/** Writes to stdout until the reader has gone, as `head` does after its first lines. */
function print(text: string): void {
  if (!process.stdout.errored) process.stdout.write(text);
}

function fail(message: string): never {
  process.stderr.write(`deamericanise: ${message}\n`);
  process.exit(2);
}

function list(value: string | undefined): string[] {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** The `unitsKeep` key of the unit a name such as `inch`, `inches` or `in` stands for. */
function unitKey(name: string): string | undefined {
  const lower = name.toLowerCase();
  return MEASURES.find((measure) =>
    [measure.keep, ...measure.words, ...measure.abbrevs].some((form) => form.toLowerCase() === lower),
  )?.keep;
}

/** Whether a file has a lexer or reads as prose, from its name alone. */
function isKnownFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return Boolean(lexerFor(name)) || PROSE_EXTENSIONS.has(extension) || PROSE_FILENAMES.has(name);
}

function walk(path: string, into: string[]): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(join(path, entry.name), into);
    } else if (entry.isFile() && isKnownFile(entry.name)) {
      into.push(join(path, entry.name));
    }
  }
}

const ESC = String.fromCharCode(27);
const COLOUR = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint =
  (code: string, reset: string) =>
  (s: string): string =>
    COLOUR ? `${ESC}[${code}m${s}${ESC}[${reset}m` : s;
const red = paint('31', '39');
const green = paint('32', '39');
const dim = paint('2', '22');

/** Line-level diff: every line that differs, with its number. */
function printDiff(label: string, before: string, after: string): void {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  print(`${dim(`--- ${label}`)}\n`);
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
    if (beforeLines[i] === afterLines[i]) continue;
    const number = String(i + 1).padStart(5);
    if (beforeLines[i] !== undefined) print(`${dim(number)} ${red(`- ${beforeLines[i]}`)}\n`);
    if (afterLines[i] !== undefined) print(`${dim(number)} ${green(`+ ${afterLines[i]}`)}\n`);
  }
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function printExplanation(label: string, source: string, changes: Change[]): void {
  print(`${dim(`--- ${label}`)}\n`);
  for (const change of changes) {
    const where = `${label}:${lineOf(source, change.start)}`;
    print(
      `  ${where}  ${red(change.before)} -> ${green(change.after)}  ${dim(`[${change.ruleId}, ${change.confidence}]`)}\n`,
    );
    if (change.note) print(`      ${dim(change.note)}\n`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parsePrecision(value: string | undefined): Precision | undefined {
  if (value === undefined) return undefined;
  if (value === 'natural' || value === 'exact') return value;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) fail('--precision expects natural, exact, or a whole number');
  return number;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        write: { type: 'boolean', short: 'w' },
        diff: { type: 'boolean', short: 'd' },
        check: { type: 'boolean', short: 'c' },
        json: { type: 'boolean' },
        explain: { type: 'boolean' },
        dialect: { type: 'string' },
        localise: { type: 'boolean', short: 'l' },
        localize: { type: 'boolean' },
        preset: { type: 'string' },
        off: { type: 'string' },
        only: { type: 'string' },
        confidence: { type: 'string' },
        rule: { type: 'string', multiple: true },
        protect: { type: 'string', multiple: true },
        'assume-american': { type: 'boolean' },
        'no-assume-american': { type: 'boolean' },
        'keep-original': { type: 'boolean' },
        precision: { type: 'string' },
        'units-keep': { type: 'string' },
        language: { type: 'string' },
        docstrings: { type: 'boolean' },
        'no-code-guard': { type: 'boolean' },
        'list-languages': { type: 'boolean' },
        'list-rules': { type: 'boolean' },
        'list-dialects': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    fail((error as Error).message);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    print(HELP);
    return 0;
  }
  if (values.version) {
    print(`${__VERSION__}\n`);
    return 0;
  }
  if (values['list-dialects']) {
    for (const pack of Object.values(DIALECTS)) print(`${pack.id}\t${pack.label}\n`);
    return 0;
  }
  if (values['list-languages']) {
    for (const name of [...languageNames(), ...PROSE_EXTENSIONS].sort()) print(`${name}\n`);
    return 0;
  }
  if (values['list-rules']) {
    for (const id of ruleIds((values.dialect as Dialect) ?? 'en-AU')) print(`${id}\n`);
    return 0;
  }

  const dialect = (values.dialect ?? 'en-AU') as Dialect;
  if (!(dialect in DIALECTS)) fail(`unknown dialect "${dialect}". Try --list-dialects.`);

  const wantsLocalise = Boolean(values.localise || values.localize);
  const preset = (values.preset ?? (wantsLocalise ? 'localise' : 'read')) as Preset;
  if (!PRESETS.includes(preset)) fail(`unknown preset "${preset}". Known: ${PRESETS.join(', ')}`);

  const language = values.language;
  if (language !== undefined && !isKnownLanguage(language)) fail(`unknown language "${language}". Try --list-languages.`);

  const only = list(values.only) as Category[];
  const off = list(values.off) as Category[];
  for (const category of [...only, ...off]) {
    if (!CATEGORIES.includes(category)) fail(`unknown category "${category}". Known: ${CATEGORIES.join(', ')}`);
  }

  const categories: Partial<Record<Category, boolean>> = {};
  if (only.length) for (const c of CATEGORIES) categories[c] = only.includes(c);
  for (const c of off) categories[c] = false;

  const confidence = list(values.confidence) as Confidence[];
  for (const tier of confidence) {
    if (!CONFIDENCES.includes(tier)) fail(`unknown confidence "${tier}". Known: ${CONFIDENCES.join(', ')}`);
  }

  const rules: Record<string, boolean> = {};
  const ruleEntries = values.rule ?? [];
  // Every dialect's ids, so one command line runs under them all: en-CA has no dialect.* rule.
  const knownRules = ruleEntries.length ? (Object.keys(DIALECTS) as Dialect[]).flatMap((d) => ruleIds(d)) : [];
  for (const entry of ruleEntries) {
    const [id, value = 'false'] = entry.split('=');
    if (!id) fail('--rule expects <id>=<true|false>');
    if (!knownRules.some((ruleId) => matchesRuleId(id, ruleId))) fail(`unknown rule "${id}". Try --list-rules.`);
    rules[id] = value !== 'false' && value !== '0' && value !== 'off';
  }

  const unitsKeep = list(values['units-keep']).map((name) => {
    const key = unitKey(name);
    if (key === undefined) fail(`unknown unit "${name}". Known: ${MEASURES.map((m) => m.keep).join(', ')}`);
    return key;
  });

  const precision = parsePrecision(values.precision);
  const options: Options = {
    dialect,
    preset,
    categories,
    rules,
    protect: values.protect ?? [],
    ...(confidence.length ? { confidence } : {}),
    ...(values['assume-american'] ? { assumeAmerican: true } : {}),
    ...(values['no-assume-american'] ? { assumeAmerican: false } : {}),
    units: {
      keepOriginal: values['keep-original'] ?? false,
      ...(precision !== undefined ? { precision } : {}),
    },
    unitsKeep,
    ...(values['no-code-guard'] ? { protectCommentedCode: false } : {}),
  };
  const fileOptions = {
    ...options,
    ...(values.docstrings ? { docstrings: true } : {}),
    ...(language !== undefined ? { language } : {}),
  };

  const targets: string[] = [];
  for (const path of positionals) {
    try {
      if (!statSync(path).isFile()) walk(path, targets);
      else if (values.language || isKnownFile(path)) targets.push(path);
      else process.stderr.write(`deamericanise: skipping ${path}: unknown file type. Use --language md to read it as prose.\n`);
    } catch {
      fail(`cannot read ${path}`);
    }
  }

  let changed = false;

  if (positionals.length === 0) {
    if (process.stdin.isTTY) {
      print(HELP);
      return 0;
    }
    const source = await readStdin();
    const result = deamericaniseFile('stdin.txt', source, fileOptions);
    changed = result.changes.length > 0;

    if (values.json) print(`${JSON.stringify(result.changes, null, 2)}\n`);
    else if (values.explain) printExplanation('stdin', source, result.changes);
    else if (values.diff) printDiff('stdin', source, result.text);
    else if (!values.check) print(result.text);

    return values.check && changed ? 1 : 0;
  }

  for (const path of targets) {
    const source = readFileSync(path, 'utf8');
    let result;
    try {
      result = deamericaniseFile(path, source, fileOptions);
    } catch (error) {
      process.stderr.write(`deamericanise: skipping ${path}: ${(error as Error).message}\n`);
      continue;
    }
    const label = relative(process.cwd(), path) || path;
    const untouched = result.changes.length === 0;
    if (!untouched) changed = true;

    // The default mode is a filter, so it prints the file whether or not anything moved.
    // Every other mode has nothing to say about a file that needs no work.
    if (values.json) {
      if (untouched) continue;
      print(`${JSON.stringify({ file: label, changes: result.changes }, null, 2)}\n`);
    } else if (values.explain) {
      if (untouched) continue;
      printExplanation(label, source, result.changes);
    } else if (values.diff) {
      if (untouched) continue;
      printDiff(label, source, result.text);
    } else if (values.write) {
      if (untouched) continue;
      writeFileSync(path, result.text, 'utf8');
      const n = result.changes.length;
      print(`${label}: ${n} change${n === 1 ? '' : 's'}\n`);
    } else if (!values.check) {
      print(result.text);
    }
  }

  if (values.check && changed) {
    process.stderr.write('deamericanise: changes are needed. Run with --diff to see them.\n');
    return 1;
  }
  return 0;
}
