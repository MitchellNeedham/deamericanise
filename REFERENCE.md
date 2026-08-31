# deamericanise

Rewrites American English into the version the rest of the world reads. Spelling,
vocabulary, units, dates, times and currency. Give it a source file and it rewrites
only the comments, leaving code, strings and identifiers exactly as they were.

```
The color of my favorite theater was gray. It is 6 feet 2 inches wide,
350°F inside, and cost $500 on 3/14/2024. I canceled the order.

  ->

The colour of my favourite theatre was grey. It is 1.88 metres wide,
175°C inside, and cost US$500 on 2024-03-14. I cancelled the order.
```

## Two modes

By default it makes an American text **readable** without changing what it is about:
spelling, units, dates, times and currency. An article about America keeps its sidewalks,
its gas stations and its 911.

`preset: 'localise'` (or `--localise`) also swaps the **content** for local equivalents
and applies local house style: vocabulary, colloquialisms, emergency numbers, school
years, paper sizes, punctuation. That is the
mode for a recipe you are going to cook from, where you want `bell pepper` to say
`capsicum`.

```ts
deamericaniseText('Add a bell pepper, then call 911.');
// 'Add a bell pepper, then call 911.'
deamericaniseText('Add a bell pepper, then call 911.', { preset: 'localise' });
// 'Add a capsicum, then call 000.'
```

## Install

```sh
npm install deamericanise
```

## Command line

```sh
deamericanise README.md                 # print the result
deamericanise --localise recipe.md      # also swap vocabulary for local words
deamericanise --write src/ docs/        # rewrite in place, walking directories
deamericanise --diff CHANGELOG.md       # show what would change
deamericanise --check .                 # exit 1 if anything would change (CI)
deamericanise --explain notes.md        # every change, with the rule that made it
cat notes.txt | deamericanise --language md
```

`--explain` is the one to reach for when something surprises you:

```
$ echo 'A flat tire on the sidewalk, 10 miles away.' | deamericanise -l --language md --explain
--- stdin
  stdin:1  tire -> tyre  [spelling.contextual.tyre, risky]
  stdin:1  sidewalk -> footpath  [dialect.en-AU, moderate]
  stdin:1  10 miles -> 16 kilometres  [units.length.mile, moderate]
```

Run `deamericanise --help` for the full list of flags.

## Library

```ts
import { deamericanise, deamericaniseText, deamericaniseCode } from 'deamericanise';

deamericaniseText('The color of the theater.');
// 'The colour of the theatre.'

const result = deamericanise('They canceled it on 3/14/2024.');
result.text;     // 'They cancelled it on 2024-03-14.'
result.changes;  // [{ start, end, before, after, ruleId, category, confidence, note? }]
result.signals;  // how American the input looked, and why

deamericaniseCode('const color = "color"; // set the color', { language: 'ts' }).text;
// 'const color = "color"; // set the colour'
```

Every change carries offsets into the input, so you can build your own diff, editor
decoration or review UI from `result.changes` without re-running anything.

`deamericaniseFile(filename, source)` picks prose or comment-only handling from the
extension, which is what the CLI uses.

## Dialects

Dialects only affect vocabulary, so they need `localise`. `en-AU` is the default. The shared rules do the heavy lifting; the overlays cover the
words that genuinely differ.

| | en-AU | en-GB | en-NZ |
| --- | --- | --- | --- |
| `sidewalk` | footpath | pavement | footpath |
| `candy` | lollies | sweets | lollies |
| `potato chips` | chips | crisps | chips |
| `popsicle` | icy pole | ice lolly | ice block |
| `cotton candy` | fairy floss | candy floss | candy floss |
| `apartment` | apartment | flat | flat |
| `soccer` | soccer | football | football |
| `call 911` | call 000 | call 999 | call 111 |

`en-IE` and `en-ZA` follow British usage with local emergency numbers and a few words of
their own. `en-CA` is the hybrid: it keeps `colour`, `centre` and `defence` but also keeps
`-ize`, `aluminum`, `math`, `tire` and `gas`.

`en-GB` leaves miles, mph, pints and stone alone, because Britain still uses them. Turn a
unit back on by id if you disagree:

```ts
deamericaniseText('10 miles', { dialect: 'en-GB', rules: { 'units.length.mile': true } });
// '16 kilometres'
```

## What it changes

**Spelling.** `-ize` to `-ise`, `-yze` to `-yse`, `-or` to `-our`, `-er` to `-re`,
`-ense` to `-ence`, `-og` to `-ogue`, the doubled `l` (`canceled` to `cancelled`) and the
undoubled one (`enrollment` to `enrolment`), the `ae`/`oe` digraphs, and a long list of
one-offs from `aluminium` to `yoghurt`.

The derivatives are handled explicitly, because they are where naive rules go wrong:
`humour` but `humorous`, `vigour` but `vigorous`, `labour` but `laborious`, `vapour` but
`vaporise`, `glamour` but `glamorous`. All of those keep the American-looking form in
every dialect, and all of them are left alone.

**Sense-dependent spellings.** American English collapsed distinctions the rest of us
keep, so these depend on what the word means:

| | changes | stays |
| --- | --- | --- |
| tire | a flat **tyre** | I **tire** of this |
| check | a **cheque** in the post | **check** the value |
| licence | a valid **licence** | a **licensed** operator |
| practise | we **practise** daily | best **practice** |
| storey | a two-**storey** building | a good **story** |
| kerb | parked at the **kerb** | **curb** inflation |
| draught | **draught** beer | the first **draft** |
| metre | 400 **metres** | a parking **meter** |

Each of these is a guess about meaning, so they are all tagged `risky` and come off
together with `--confidence safe,moderate`.

**Vocabulary** (`localise` only). `gasoline` to petrol, `elevator` to lift, `faucet` to tap, `diaper` to
nappy, `zip code` to postcode, `parking lot` to car park, `windshield` to windscreen,
`ground beef` to mince, `5th grade` to Year 5, and about two hundred more. Context-gated
where the word has an innocent sense: `buying gas` becomes petrol but `a gas giant` does
not; `in the fall of 2024` becomes autumn but `prices will fall` does not.

**Units.** Length, area, mass, volume, temperature, speed, pressure, power, torque and
fuel economy. The volume measures are the US ones, which are not the imperial ones.

```
6 feet          -> 1.8 metres        350°F      -> 175°C
6 feet 2 inches -> 1.88 metres       60 mph     -> 97 km/h
10 miles        -> 16 kilometres     30 mpg     -> 7.8 L/100km
1/2 gallon      -> 1.9 litres        5-10 feet  -> 1.5-3 metres
180 lbs         -> 82 kg             10 acres   -> 4 hectares
```

Dimensions move as a set, because converting half of a pair is worse than leaving it
alone: `10 x 12 feet` becomes `3 x 3.7 metres`, and `8.5 x 11 inches` becomes
`22 x 28 centimetres`, both ends sharing the unit chosen for the larger.

The target unit follows the magnitude, so `2 feet` gives centimetres and `0.5 miles` gives
metres. Precision defaults to `natural`, which matches the significant figures of the
source and never claims more accuracy than was written down. `exact` and a fixed number of
decimal places are both available, as is keeping the original alongside:

```ts
deamericaniseText('6 feet', { units: { precision: 'exact' } });        // '1.8288 metres'
deamericaniseText('6 feet', { units: { precision: 1 } });              // '1.8 metres'
deamericaniseText('6 feet', { units: { keepOriginal: true } });        // '1.8 metres (6 feet)'
```

Measurements that are imperial worldwide are left alone: screens, wheels, pipes, vinyl.
`a 15 inch laptop` stays a 15 inch laptop.

**Dates.** `3/14/2024` becomes `2024-03-14` without needing to be told anything, because
there is no month 14. `03/04/2024` is genuinely ambiguous, so it only moves when the
surrounding text is American enough to trust; see below. Output is ISO by default, with `dmy` and `long` available.

`March 5, 2024` names its month, so nobody can misread it. Reordering it to `5 March 2024`
is local convention rather than translation, and waits for `localise` (or
`dates: { reorderLongDates: true }`). It is still read as evidence: a named month written
first is about the strongest signal there is that a document is American, and it settles
the ambiguous numeric dates around it.

**Times and currency.** `3:00 P.M.` becomes `3:00pm`; a 12-hour clock is
normal outside America too, so only the styling goes. `times: { to24Hour: true }` gives
`15:00` if you want it. Amounts are never converted, because exchange rates move; a bare
`$500` becomes `US$500` when the text is American. 

**Punctuation** (`localise` only). House style rather than comprehension, so it waits to
be asked for. `U.S.` becomes `US`, and punctuation that is not part of a quotation moves
outside the closing quote.

Full stops on titles follow the contraction rule rather than a list of titles: a
contraction that already ends in the word's own last letter drops the stop, so `Mr.`,
`Dr.`, `Sgt.` and `Lt.` become `Mr`, `Dr`, `Sgt` and `Lt`. A truncation keeps it, so
`Prof.`, `Rev.`, `Capt.`, `Gen.`, `Co.` and `No.` are correct as they stand and are left
alone.

**Articles.** Replacements drag their article along: `an eraser` becomes `a rubber`, and
`a popsicle` becomes `an icy pole`.

## Deciding whether the text is American

Some rules cannot fire without knowing where the text came from. `03/04/2024` is March or
April depending, and `$500` is dollars of some kind. `analyse` scores the input on
spellings, vocabulary, imperial units and date habits:

```ts
import { analyse } from 'deamericanise';

analyse('The color of the theater is gray and they canceled it.');
// { confidence: 0.6, markers: ['-or spelling', '-er spelling', 'doubled-l dropped', 'gray'], ... }
```

Ambiguous dates ask a narrower question first, because a document writes its dates one way
round: a sibling date that states its own order, whether by a day above 12 or by a named
month, settles it on its own and outranks the score in both directions. So
`Filed March 5, 2024. Due 03/04/2024.` resolves to 4 March, and
`Filed 25/12/2023. Due 03/04/2024.` stays put however American the prose around it looks.

Everything else that needs the verdict runs above `minAmericanConfidence`, which defaults
to `0.5`. That bar is
deliberately high: reading a date the wrong way round produces a plausible-looking wrong
answer rather than an obvious one. Override it, or skip the question entirely:

```ts
deamericaniseText(text, { assumeAmerican: true });
deamericaniseText(text, { minAmericanConfidence: 0.4 });
```

## What it will not touch

- **Proper nouns.** Pearl Harbor, the World Trade Center, the Department of Defense, the
  Australian Labor Party, rigor mortis, Fahrenheit 451, the MIT License, Prolog, and
  trademarks such as Band-Aid and Realtor.
- **Structure.** URLs, email addresses, inline code, fenced code blocks and HTML tags.
- **Identifiers,** when `protectIdentifiers` is on (the default for source files):
  `normalizeInput`, `MAX_COLOR_VALUE`, `background-color`, `theme.colors.gray`,
  `--color-scheme`, `getColor()`.
- **Anything you name:**

  ```ts
  deamericaniseText(text, { protect: ['Color', /Acme [A-Z]\w+/] });
  ```
- **Anything marked in the text itself.** A line containing `deamericanise-ignore` is left
  alone, as is everything between `deamericanise-ignore-start` and
  `deamericanise-ignore-end`.

## Turning things off

There are five ways to change what runs, from blunt to precise:

```ts
// A preset: read (default) or localise
deamericaniseText(text, { preset: 'localise' });

// A whole category: spelling, vocabulary, units, dates, times, currency, punctuation, misc
deamericaniseText(text, { categories: { units: false } });

// A confidence tier: safe, moderate, risky
deamericaniseText(text, { confidence: ['safe', 'moderate'] });

// A family of rules, or one rule
deamericaniseText(text, { rules: { 'spelling.contextual.*': false } });
deamericaniseText(text, { rules: { 'vocabulary.contextual.autumn': false } });

// A single unit
deamericaniseText(text, { unitsKeep: ['mile', 'pint'] });
```

A category set by hand beats the preset, and `rules` beats everything, so an explicit
`true` brings a rule back even if its preset, category or tier would have dropped it. `ruleIds()` lists every id, and so does `--list-rules`.

The three confidence tiers mean:

- **safe**: no plausible false positive. `colour`, `aluminium`, `organise`.
- **moderate**: a wordlist that could collide with a name. Most vocabulary and all units.
- **risky**: a guess about what a word means. `tyre`, `cheque`, `autumn`, logical quoting.

## Source files

`deamericaniseCode` finds comments with a small hand-written lexer per language family,
which tracks strings, template literals, nested block comments and JavaScript regex
literals. That means `// color` inside a string is left alone, and so is `/https?:\/\//`.

```ts
deamericaniseCode(source, { language: 'ts' });
deamericaniseCode(source, { language: 'python', docstrings: true });
```

Supported out of the box: JavaScript and TypeScript, C, C++, C#, Java, Go, Rust, Swift,
Kotlin, Scala, Dart, PHP, Objective-C, Zig, Solidity, CSS/SCSS/Less, Python, Ruby, shell,
YAML, TOML, R, Perl, Julia, Nim, Terraform, Elixir, PowerShell, SQL, Lua, Haskell, Elm,
Clojure and other Lisps, Erlang, LaTeX, HTML/XML/Vue/Svelte, INI, Visual Basic and Fortran.
`LEXERS` is exported if you want to see or extend the list.

Python docstrings are off by default, on the grounds that a docstring is a string literal
and something may be asserting on it. `docstrings: true` includes them.

`lexerFor` accepts an id, an extension, a filename or a common alias, so `ruby`, `rb`,
`shell`, `golang`, `c++` and `Dockerfile` all resolve. `languageNames()` lists the lot,
and so does `--list-languages`.

### Commented-out code

Select a file, press ctrl+/, and every line becomes a comment. Rewriting the words in
those lines breaks the code the moment anyone uncomments it, so comment lines that read
as code are skipped:

```
// const color = "color";        <- left alone
// theme.color = normalize(c);   <- left alone
// Set the default color.        <- rewritten
```

This needs no grammar per language. Commented-out code gives itself away at the
punctuation level, and every language punctuates alike: something is assigned to,
something is called, a line ends in a terminator or a bracket, a key takes a single-token
value. A weighted score over those signals separates code from prose across C, Python,
SQL, CSS and the rest with one rule set, and a line that already starts with the host
language's comment marker is taken as commented-out on sight.

The costs are lopsided: a missed rewrite inside a commented-out block is invisible, while
a rewrite there is a broken build. The threshold is set accordingly, so the occasional
prose line that reads like code is left alone. It works line by line, so a block comment
can hold prose and an `@example` at once, and doc tags keep their operands: the name in
`@param {string} color` is protected while the description beside it is not.

Turn it off with `protectCommentedCode: false` or `--no-code-guard`.

## Integrations

### remark

Working on the syntax tree means code fences, inline code, link targets, HTML blocks and
frontmatter are structurally out of reach rather than guessed at.

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkDeamericanise from 'deamericanise/remark';

const file = await unified()
  .use(remarkParse)
  .use(remarkDeamericanise, { dialect: 'en-GB' })
  .use(remarkStringify)
  .process(markdown);
```

Pass `onChange` to report changes instead of, or as well as, applying them.

### ESLint

```js
// eslint.config.js
import deamericanise from 'deamericanise/eslint';

export default [
  {
    plugins: { deamericanise },
    rules: {
      'deamericanise/comments': ['warn', { dialect: 'en-AU', confidence: ['safe', 'moderate'] }],
    },
  },
];
```

The rule reports each Americanism in a comment at its exact position and offers a fix for
just that word, so `--fix` never rewrites more than it flagged. `deamericanise.configs.recommended`
is there if you want the defaults.

### Prettier

```js
// prettier.config.js
export default {
  plugins: ['deamericanise/prettier'],
  deamericaniseDialect: 'en-GB',
  deamericanisePreset: 'localise',
  deamericaniseConfidence: 'safe,moderate',
  deamericaniseOptions: '{"units":{"keepOriginal":true}}',
};
```

Prettier owns the parsers, so the plugin wraps the built-in ones and rewrites the source
in `preprocess`, before Prettier records the text its printers work from. Markdown, MDX,
JavaScript, TypeScript, CSS, SCSS, Less, YAML, HTML and Vue are covered: markdown is
handled as prose, the rest have only their comments touched.

Prettier validates option types and has no object type, so the two settings people
actually change are flat and anything else goes through `deamericaniseOptions` as JSON.
Requires Prettier 3.

## Options

| Option | Default | |
| --- | --- | --- |
| `dialect` | `'en-AU'` | `en-AU`, `en-GB`, `en-NZ`, `en-IE`, `en-ZA`, `en-CA` |
| `preset` | `'read'` | `read` keeps the subject matter American; `localise` swaps vocabulary too |
| `categories` | from the preset | Per-category switches; beats the preset |
| `confidence` | all three | Tiers to run |
| `rules` | `{}` | Per-rule overrides; a trailing `*` matches a prefix |
| `protect` | `[]` | Strings or patterns never to rewrite |
| `protectProperNouns` | `true` | The built-in name list |
| `protectIdentifiers` | `false` (`true` for code) | camelCase, snake_case, kebab API names, dotted paths |
| `unitsKeep` | `[]` | Units to leave alone, by key |
| `units.precision` | `'natural'` | `natural`, `exact`, or a number of decimal places |
| `units.keepOriginal` | `false` | Write `1.8 metres (6 ft)` |
| `units.fuelEconomy` | `'l-per-100km'` | Or `km-per-l` |
| `dates.format` | `'iso'` | `iso`, `dmy`, `long` |
| `dates.reorderLongDates` | `localise` only | `March 5, 2024` to `5 March 2024` |
| `times.to24Hour` | `false` | On gives `15:00` rather than `3pm` |
| `currency.mode` | `'annotate'` | Or `off` |
| `assumeAmerican` | inferred | Skip detection |
| `minAmericanConfidence` | `0.5` | The bar detection has to clear |

`units`, `dates`, `times` and `currency` each accept `false` to switch the category off.

## Known limits

- The sense-dependent rules are heuristics over a window of surrounding text. They are
  right most of the time and tagged `risky` for the rest. Review a diff before committing
  one, or run `--confidence safe,moderate`.
- Identifier protection is deliberately over-eager in code: a hyphenated token containing
  `color`, `center` or `license` is treated as an API name, so `color-coded` in a comment
  survives. Turn it off with `protectIdentifiers: false`.
- Unit conversion is lossy at the default precision, by design. Use `precision: 'exact'`
  or `keepOriginal` where the numbers matter.
- Currency amounts are never converted. Rates move; the output would be wrong by the time
  anyone read it.
- Grade-to-year mapping assumes the Australian and British numbering, which does not line
  up with every system.
- `localise` rewrites emergency numbers, which is right for a translated recipe and wrong
  for a news story about America. It is `risky`-tagged; `--confidence safe,moderate` drops
  it, and so does `--rule 'dialect.*=false'`.

## Releasing

The git tag is the source of truth for the version. `package.json` carries `0.0.0` as a
placeholder; CI stamps the real version from the tag before publishing, and the build
bakes it into the CLI, so `deamericanise --version` and the published package can never
disagree.

```sh
git tag v0.1.0
git push --tags
```

That is the whole release. There is no version to bump by hand and nothing to keep in
sync. A tag that is not valid semver fails the job before anything is published, and the
workflow can also be run by hand from the Actions tab with a version typed in.

CI authenticates with npm through OIDC rather than a token, so there is no `NPM_TOKEN`
secret to create, rotate or leak, and two-factor authentication on the account is not in
the way. It requires this repository and the `Publish` workflow to be set as a trusted
publisher on the package's settings page at npmjs.com.

Provenance is requested on the publish command rather than in `publishConfig`, because it
describes how a particular publish happened rather than anything about the package. Set
in `publishConfig` it applies to every publish everywhere, which makes publishing from a
laptop fail: provenance needs OIDC claims that only a CI provider can issue. If you ever
do need to publish by hand, `npm publish --no-provenance` is the escape hatch.

## Licence

MIT
