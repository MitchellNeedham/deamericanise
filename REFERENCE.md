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

A directory is walked for the files it knows: source in any language `--list-languages`
prints, and prose (`.md`, `.txt`, `.rst` and the like, plus `README`, `CHANGELOG`,
`CHANGES`, `HISTORY`, `NEWS` and `CONTRIBUTING` with no extension). A file named on the
command line has to pass the same test, so a glob such as `deamericanise --write *` never
rewrites `settings.json` or `yarn.lock` as prose. Each named file that fails is skipped
with a line on stderr, and it does not change the exit status in any mode, `--check`
included. To read one anyway, force the language:

```sh
deamericanise --language md NOTES
```

`--language` takes any name `--list-languages` prints: a lexer, or a prose type such as `md`
or `txt`. It applies to stdin and to every file read, named or walked. Any other value stops
the run before anything is read, with `unknown language "..."` on stderr and exit status 2.
`--language json` reads only comments, so plain JSON, which has none, comes back untouched
and a commented file such as `tsconfig.json` has just its comments rewritten. A `.json`
file is still skipped unless it is forced this way.

`--dialect` takes any id `--list-dialects` prints. Any other value stops the run before
anything is read, `--list-rules` included, with `unknown dialect "..."` on stderr and exit
status 2.

`--syntax markdown` or `--syntax text` names the markup of stdin and of every prose file
read, as the `syntax` option does (see [What it will not touch](#what-it-will-not-touch)).
Without it, the file's type decides, and stdin is plain text unless `--language md` is
given. Any other value stops the run with `unknown syntax "..."` and exit status 2.

`--rule` and `--units-keep` are checked up front, as `--language` is. A `--rule` pattern
has to match a rule id of at least one dialect, so a command line shared across dialects
still runs under `en-CA`, which has no `dialect.*` rules. `--units-keep` takes a unit's
key, such as `inch` or `square-foot`, or any name the unit is written as, such as `inches`
or `in`. Any other value stops the run with `unknown rule "..."` or `unknown unit "..."`
and exit status 2. The value after a rule's `=` is `true`, `on`, `1` or `yes` to switch it
on, or `false`, `off`, `0` or `no` to switch it off, in any case. A pattern with no `=`
switches the rule off, and any other value stops the run with `unknown rule value "..."`
and exit status 2.

`LICENSE`, `COPYING` and `AUTHORS` are not on the list. A licence has to stay verbatim, and
a list of names is no place for spelling rules.

Run `deamericanise --help` for the full list of flags.

## Library

```ts
import { deamericanise, deamericaniseText, deamericaniseCode } from 'deamericanise';

deamericaniseText('The color of the theater.');
// 'The colour of the theatre.'

const result = deamericanise('They canceled it on 3/14/2024.');
result.text;     // 'They cancelled it on 2024-03-14.'
result.changes;  // [{ start, end, before, after, ruleId, category, confidence, note?, agreesWith? }]
result.signals;  // how American the input looked, and why

deamericaniseCode('const color = "color"; // set the color', { language: 'ts' }).text;
// 'const color = "color"; // set the colour'
```

Every change carries offsets into the input, so you can build your own diff, editor
decoration or review UI from `result.changes` without re-running anything.

An article fix also carries `agreesWith`, the `start` and `end` of the replacement it was
fixed to suit, which is in the same list. Under `localise`, `an eraser` gives two changes:
`an` to `a` with `agreesWith: { start: 3, end: 9 }`, and `eraser` to `rubber` at 3 to 9.
Apply the two together or not at all, because either one alone leaves `a eraser` or
`an rubber`.

`deamericaniseFile(filename, source)` picks prose or comment-only handling from the
extension, which is what the CLI uses. It reads any file it has no lexer for as prose, JSON
included, so choose the files before calling it. The CLI does that with the test described
under [Command line](#command-line).

It also sets `syntax` from the extension: `md`, `markdown` and `mdx` are `markdown`, and
`txt`, `rst` and the other prose types are `text`. Any other name, such as `CHANGELOG`,
leaves the syntax unknown. A `syntax` option wins over the extension.

A `language` option overrides the filename, as `--language` does. A prose type such as `md`
reads the source as prose, any other value has to name a lexer, and an unknown one throws
`UnknownLanguageError` whatever the filename:

```ts
deamericaniseFile('stdin', source, { language: 'python' });  // comments only
deamericaniseFile('a.ts', source, { language: 'md' });       // prose
deamericaniseFile('a.json', source, { language: 'nosuch' }); // throws UnknownLanguageError
```

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
| `field trip` | excursion | school trip | excursion |
| `call 911` | call 000 | call 999 | call 111 |

Where an overlay and the shared rules both have a word, the overlay's row is tried first,
which is how `field trip` becomes a school trip in `en-GB` and an excursion in `en-AU`.
The shared row is the fallback when the overlay's row is switched off or its context does
not fit: an `en-GB` `mailbox` is a postbox only when it is one for posting letters (`the
nearest mailbox`), and otherwise the letterbox the other dialects say. A mailbox that holds
email or voicemail is neither, so it stays a mailbox in every dialect.

`en-IE` and `en-ZA` follow British usage with local emergency numbers and a few words of
their own, such as the Irish `school tour` for a field trip. `en-CA` is the hybrid: it
keeps `colour`, `centre` and `defence` but also keeps `-ize`, `aluminum`, `math`, `tire`
and `gas`.

`en-GB` leaves miles, mph, pints and stone alone, because Britain still uses them, and a
weight in stone and pounds stays whole. Turn a unit back on by id if you disagree:

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
not; `in the fall of 2024` becomes autumn but `prices will fall` does not; `bake the
cookies` becomes biscuits but `Accept all cookies`, `This site uses cookies` and a lone
`Cookies` link do not; `Check the mailbox for the parcel` becomes a letterbox but `Your
mailbox is full`, `a shared mailbox in Outlook`, `a voicemail mailbox` and a lone `Mailbox`
label do not; `take out the trash` becomes rubbish but `Empty the trash in Gmail` and
`Drag the file to the Trash` do not; `my vacation` becomes a holiday but Gmail's `Vacation
responder` does not. Phrases the rest of the world already says keep their words:
`fortune cookie`, `food truck`, `my way or the highway`, `Highway 101`, `seat of your
pants`, `ants in his pants`, `yoga pants`. In British English a `fire truck` is a fire engine
and a `pickup truck` stays one. Only a trailer people live or holiday in becomes a caravan:
a `travel trailer` does, while a `boat trailer` and a `movie trailer` stay trailers. The
verb stays too: `the dog pants heavily` keeps its `pants`, while `his pants were wet`
becomes `his trousers were wet`.

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
`22 x 28 centimetres`, both ends sharing the unit chosen for the larger. Each side is read
in its own unit, so `2 feet x 6 inches` becomes `61 x 15 centimetres` and `10 ft x 12 in`
becomes `3 x 0.3 m`, where the `in` is the unit because the side before it has one. Sides
that measure different things, as in `2 feet x 6 pounds`, convert as two measurements.
Only a length has sides. Before any other unit a bare number is a count, and the quantity
after it converts on its own: `2 x 4 oz cans` becomes `2 x 110 g cans`, and
`2 x 4 lb 8 oz bags` becomes `2 x 2.04 kg bags`. A dimension is left as written when a side with no unit sits between two different units
(`10 ft x 12 x 6 in`), or when the rule for one of its units is switched off.

A side may be a whole number in words: `a ten by twelve foot room` becomes
`a 3 by 3.7 metre room`, and `two x 4 oz cans` becomes `two x 110 g cans`. A fraction in
words on any side, as in `two and a half by three feet`, leaves the dimension as written. So
does `one by two feet`, since `one` may be a pronoun with `by` giving an amount. After a word
such as `each`, `all` or `that one`, only the amount converts: `raise each one by two inches`
becomes `raise each one by 5.1 centimetres`.

A weight in two units is one weight, as a height in feet and inches is one height:
`7 pounds 8 ounces` becomes `3.4 kilograms`, `11st 4lb` becomes `71.7 kg`, and
`11 stone 4 pounds 8 ounces` becomes `71.9 kilograms`. The first part can be a fraction, a
mixed number or a decimal, so `1 1/2 pounds 3 ounces` becomes `765 grams` and
`2.5 feet 3 inches` becomes `83.8 centimetres`. Together the parts claim three
significant figures. Where a unit of the weight is kept, by the dialect or by `unitsKeep`,
the whole weight is left as written, so an `en-GB` `11 stone 4 pounds` never becomes
`11 stone 1.8 kilograms`. Turning on `units.mass.stone` or `units.mass.stone-pounds`
converts it. A weight at the end of a range, as in `7-8 lb 4 oz`, is left as written too,
and so is a height or weight that starts where no measurement can (see below), as in
`At 7:30 feet 2 inches`.
`st` is read only in such a weight, because `1st` on its own is an ordinal.

Numbers written out in words are read too, fractions and all: `two and a half feet` becomes
`76 centimetres` and `a quarter mile away` becomes `400 metres away`. So do `half a mile`,
`a quarter of a mile`, `a mile and a half` and `two pounds and a half`, which put the unit
inside the number. `third`, `fourth`, `eighth` and `sixteenth` are ordinals as well, so they
read as a fraction only with a count before them or `of a` after them: `one-third mile`,
`a third mile` and `the last third of a mile` convert, while `the third mile` and
`every third mile` are left alone. `half` and `quarter` need neither.

A tens word and a units word are one number, joined by a hyphen or a space:
`twenty-two pounds` and `twenty two pounds` both become `10 kilograms`. A number never
starts inside a hyphenated word or straight after a tens word, so a compound that cannot be
read whole is left as written. That covers `catch-twenty-two miles`, and
`twenty five-pound bags`, which may be twenty bags or one weight.

`hundred` and `thousand` multiply the count before them (`a`, `an` or a cardinal of one or
two words), and a cardinal may follow, with or without `and`: `a hundred miles` becomes
`160 kilometres`, `one hundred and twenty feet` becomes `37 metres`, and
`two thousand five hundred feet` and `twenty-two hundred feet` convert too. A number never
starts after `hundred` or `thousand` with at most a comma, `and` or `to` between, except as
the second end of a range, so `hundreds of miles`, `a few hundred feet` and
`a hundred thousand miles` are left as written, while
`between one hundred and two hundred miles` becomes `between 160 and 320 kilometres`.
`It cost a hundred pounds.` is still money.

A range may have a whole number in words at either end when `to` joins it, or `and` after
`between`: `five to 10 miles` becomes `8 to 16 kilometres`, and `between one and two pounds`
becomes `between 450 and 910 grams`. A dash joins a range only between digits, since
`one-half` and `twenty-two` are single numbers, so `five-10 miles` is left as written. So is
a range with a fraction in words at either end, as in `two and a half to three miles`, and
`two to three hundred feet`, which may mean 200 to 300. `half to` is an idiom, so
`reduce by half to 2 quarts` converts only the quarts.

A whole number hyphenated to a fraction below one is a mixed number, as trade writing has
it: `a 2-3/4 inch board` becomes `a 7 centimetre board`, the same as `a 2 3/4 inch board`.
`1-3 inches` and `1/2-3/4 inch` are still ranges.

A fraction with a zero denominator, as in `5/0 inches`, is not a quantity, so it is left as
written, and so is a height or weight it is part of, as in `5 feet 1/0 inches`.

A number never continues onto the next line, so the `14` that ends `Step 14` is never taken
as the whole part of a `1/2 gallon` that opens the next line. The rest of a measurement can
wrap: `6` at the end of one line and `feet` at the start of the next still convert, and so
does a range or dimension broken at its `to`, `-` or `x`. Nothing joins across a blank line
or into a line that opens a list item, heading, quote or table row, so `Serves 4` followed
by `- 2 pounds beef` is a serving count and a bullet, not a range.

A measurement never starts straight after `-`, `/`, `,` or `:` following a digit, where the
number is the tail of a date, a fraction, a grouped number or a clock time. So
`3/14/2024 1/2 gallon` converts the `1/2 gallon` alone, and `a 7:30 mile pace` is left as
written, while `Distance:5 miles` still converts. Nor does one start on a price, so
`a $5 gallon of milk` and `a $5 x 10 foot tarp` are left as written. Four figures straight
after a written-out month and day are the year of a date, so `Oct 22, 2024 1/2 inch` and
`22 October 2024 1/2 inch` convert the `1/2 inch` alone. A bare month says too little, so
`In May 5-10 feet` is still a range. A range's first number is never more than ten times the
size of the second, which makes it a year or a count. Where the first number cannot open the
range, the second converts on its own: `In 2024 - 5 feet` becomes
`In 2024 - 1.5 metres`, and `Price $5 - 10 inches` keeps its price. `from` or `between`
before the first number makes a range of any two, so `fell from 10 to 0.5 miles` converts
whole.

Temperatures convert at both ends of a range too, so `Bake at 350-375°F` becomes
`Bake at 175-190°C`. A change in temperature has no 32° offset to take off, so
`dropped 20°F` becomes `dropped 11°C` and `10°F warmer` becomes `5.6°C warmer`. The words
beside the number tell the two apart: a verb of change or `by` before it, a comparative
or a noun such as `drop` after it. `fell to 20°F` names the new temperature and converts
as one, and `10°F below zero` becomes `-23.3°C`. Changes have a rule of their own,
`units.temperature.difference`, so they can be switched off apart from temperatures.

Fahrenheit is read as `°F`, `℉`, `degrees F`, `deg F` or `degrees Fahrenheit`. A bare `F`,
as in `165F` or `350 F`, is more often a letter, so it counts only as an upper case `F`
after a number of two or three figures, in a sentence about heat (an oven, cooking, the
weather, a fever or a temperature) that gives no Celsius value. `Cook until the chicken
reaches 165F` becomes `73.9°C`, while `Apartment 3F`, `seat 23F`, `the Boeing 777F`,
`#33F`, `F-150` and the courtesy figure in `180C/350F/gas 4` stay as they are.

The target unit follows the magnitude, so `2 feet` gives centimetres and `0.5 miles` gives
metres. Precision defaults to `natural`, which matches the significant figures of the
source and never claims more accuracy than was written down. `exact` and a fixed number of
decimal places are both available, as is keeping the original alongside:

```ts
deamericaniseText('6 feet', { units: { precision: 'exact' } });        // '1.8288 metres'
deamericaniseText('6 feet', { units: { precision: 1 } });              // '1.8 metres'
deamericaniseText('6 feet', { units: { keepOriginal: true } });        // '1.8 metres (6 feet)'
```

A measurement that already gives both values is converted once, not twice. `6 feet (1.8 m)`
becomes `1.8 m`, keeping the figure the author rounded. That needs a bracket that restates
the conversion: the same dimension, and each figure within a quarter of the converted one
(10 °C for a temperature) once both are read to the figures they are written to. So
`1 pound (500 g)` and an imperial `1 pint (568 ml)` collapse, while `6 feet (2 kg)` and
`6 feet (5 m)` convert as normal and keep their bracket. The bracket may start on the next
line, but not after a blank line. `1.8 metres (6 feet)` is left as
it is, because the bracket only restates the metric value in front of it. That is the
form `keepOriginal` writes, so running it again changes nothing. The bracket can open
with a word such as `about`, but it has to hold nothing else, and the dimension has to
match: `2 metres (6 pounds)` still converts.

A `/` or `or` between the two values reads the same way as a bracket, by the same test of
agreement. `350°F/180°C` and `350°F or 180°C` become `180°C`, and
`Preheat to 350°F/180°C/gas 4` becomes `Preheat to 180°C/gas 4`. `180°C/350°F` and
`180°C or 350°F` are left as they are. A pair can also offer two different measurements,
so the values have to agree with the metric one first too: `Cut 6 feet or 3 metres of rope`
becomes `Cut 1.8 metres or 3 metres of rope`, and `Cut 3 metres or 6 feet of rope` becomes
`Cut 3 metres or 1.8 metres of rope`. A slash with no figure after it is a rate, so
`5 gallons/minute` becomes `19 litres/minute`.

Measurements that are imperial worldwide are left alone: screens, wheels, pipes, vinyl.
`a 15 inch laptop` stays a 15 inch laptop. So does a unit that is part of a name, such as
`the 40 yard line` or `the 147-pound division`. A range or dimension of them stays whole,
so `bolts of ½-¾ inch` and `a 15" x 17" panel` are left exactly as written, with no
piece of them converted on its own. `units: { respectConventions: false }` converts all
of them.

Pounds of money are left alone, because British prose spells amounts out. A money word
such as `cost`, `paid`, `earns`, `worth` or `a fine of` claims the amount straight after
it, across at most a pronoun or a hedge: `It cost him nearly 500 pounds`. So do
`sterling`, a rate (`30,000 pounds a year`), pence (`5 pounds 50`) and a thing priced in
pounds (`a 10-pound note`). A money word reaches only its own amount, so
`It cost $20 for 5 pounds of beef` still converts. A `£` reaches the whole sentence, but a
weight word in the measurement's own phrase (`lost`, `weighs`, `of beef`, `a 5-pound bag`)
outranks it. `lb` and `lbs` are never money, and `respectConventions: false` does not
convert money. An amount of money is held whole, as a conventional size is, so no other
rule rewrites any part of it.

**Dates.** `3/14/2024` becomes `2024-03-14` without needing to be told anything, because
there is no month 14. `03/04/2024` is genuinely ambiguous, so it only moves when the
surrounding text is American enough to trust; see below. Output is ISO by default, with `dmy` and `long` available.

A `dmy` date whose day is 12 or under, such as `04/03/2024`, reads as an ambiguous
month-first date again. So a second run forced American with `assumeAmerican: true`
(`--assume-american`) over `dmy` output swaps that date back. Detect mode leaves it alone
where the first run removed the American evidence, but not where that evidence survives,
as the named date in `Filed March 5, 2024. Due 03/04/2024.` does under the default preset.
`long` and `iso` write a date no second run can read the other way round, so use one of
them with `--write` and the plugins.

The same separator has to appear twice, so `3.22-1000` is a range, not a date. A dotted
date needs a four-figure year, because `1.13.24` is far more often a version number, and
no dotted date straight after a version word such as `version`, `v`, `release`, `Node` or
`Python` is a date. So `On 3.14.2024 we left.` becomes `On 2024-03-14 we left.`, while
`Upgrade to version 1.13.24` and `Node 3.14.2024` stay as written. A version number is
written with dots, so a slash or hyphen date after one of those words is still a date:
`Press release 3/14/2024` becomes `Press release 2024-03-14`.

`March 5, 2024` names its month, so nobody can misread it. Reordering it to `5 March 2024`
is local convention rather than translation, and waits for `localise` (or
`dates: { reorderLongDates: true }`). It is still read as evidence: a named month written
first is about the strongest signal there is that a document is American, and it settles
the ambiguous numeric dates around it. Four figures followed by a unit or by the rest of a
numeric date are not its year, so `On March 1, 1900 square kilometres burned.` and
`May 24, 2024-03-28` stay as written and count for nothing.

**Times and currency.** `3:00 P.M.` becomes `3:00pm`; a 12-hour clock is
normal outside America too, so only the styling goes. The last stop stays when it also
ends the sentence, so `It starts at 3 P.M. Bring snacks.` becomes
`It starts at 3pm. Bring snacks.` A time that runs on, as in `3 P.M. Tuesday` or
`8 P.M. ET`, loses it. `times: { to24Hour: true }` gives `15:00` if you want it.
Amounts are never converted, because exchange rates move; a bare
`$500` becomes `US$500` when the text is American. 
A scale stays with the amount only as a whole word: `$5 million` and `$50k` become
`US$5 million` and `US$50k`, and the word after `$50 modernizing` is still respelt.

**Punctuation** (`localise` only). House style rather than comprehension, so it waits to
be asked for. `U.S.` becomes `US`, and punctuation that is not part of a quotation moves
outside the closing quote.

An initialism keeps its last stop when that stop also ends the sentence, as a time does,
so `She moved to the U.S. It was cold.` becomes `She moved to the US. It was cold.` A
capital after an initialism is more often the rest of a name, so `the U.S. Army` becomes
`the US Army`: only a word that opens sentences and never names anything, such as `It`,
`The`, `In` or `However`, counts as a new sentence.

`P.M.` and `A.M.` take the lower case only after a time, so `3 P.M.` becomes `3 pm` even
with times switched off. Without a time they stand for something else, such as a prime
minister or AM radio, so `The P.M. said no.` becomes `The PM said no.`

Full stops on titles follow the contraction rule rather than a list of titles: a
contraction that already ends in the word's own last letter drops the stop, so `Mr.`,
`Dr.`, `Sgt.` and `Lt.` become `Mr`, `Dr`, `Sgt` and `Lt`. A truncation keeps it, so
`Prof.`, `Rev.`, `Capt.`, `Gen.`, `Co.` and `No.` are correct as they stand and are left
alone.

**Articles.** Replacements drag their article along: `an eraser` becomes `a rubber`, and
`a popsicle` becomes `an icy pole`. A converted number takes the article it is said with,
so `an 8 foot fence` becomes `a 2.4 metre fence` and `a 60 foot tree` becomes
`an 18 metre tree`. Eight, eleven and eighteen take `an`, and so does any figure whose
spoken form starts with one of them, such as `80`, `8.5`, `11,000` or `18 million`. A
temperature below zero takes `a`, for minus. A currency sign is said after its amount, so
`US$8` takes `an` as `$8` does. A date's day drops its leading zero
(`a 05/03/2024 deadline`) and a year is said in pairs (`an 1812-03-14 letter`). Where the
usual readings disagree, the article is left as it was: `1100` to `1199` and `1800` to
`1899` (one thousand eight hundred, or eighteen hundred), and a 24-hour time with a
leading zero other than `08:00` (`05:00` is oh five hundred to some readers and five to
others).

## Deciding whether the text is American

Some rules cannot fire without knowing where the text came from. `03/04/2024` is March or
April depending, and `$500` is dollars of some kind. `analyse` scores the input on
spellings, vocabulary, imperial units, kitchen habits and date habits:

```ts
import { analyse } from 'deamericanise';

analyse('The color of the theater is gray and they canceled it.');
// { confidence: 0.6, markers: ['-or spelling', '-er spelling', 'doubled-l dropped', 'gray'], ... }
```

Each marker counts once however often it appears, and together they count for at most
`0.6`. Most are worth `0.15`. Two kitchen habits are worth `0.25`, because nobody outside
the United States has them: a stick of butter, and an oven set between 300 and 500
without a Celsius unit, which no home oven reaches in Celsius. The two together reach the
default bar of `0.5` below, so a short recipe card with no American spelling in it still
reads as American:

```ts
analyse('Preheat the oven to 350 degrees. Mix 2 cups of flour with 1 stick of butter.');
// { confidence: 0.5, markers: ['Fahrenheit oven setting', 'stick of butter'], ... }
```

The oven is not counted in a sentence about a pizza oven, a wood-fired oven or a
pyrolytic clean, all of which do run that hot in Celsius. The number has to belong to
the cooking: a word that names a thing (`bake sale`, `bake-off`, `baked goods`,
`baked beans`, `baking tin`) is no cue, and a verb that takes an amount of its own
(`came to`, `rose to`, `raised`, `cost`, `sold`) stops the search, so
`The bake sale takings came to 320.` has no oven in it, while
`Bake at 350 and sell them at the bake sale.` does. A cup is no evidence at all,
since Australia and New Zealand cook in metric cups. A measured ingredient under a name
only Americans use, such as `1 cup all-purpose flour` or `2 tablespoons cornstarch`,
counts like any other vocabulary, unless the local name sits beside it, as it does in
`1 cup plain flour (all-purpose flour)`.

A temperature counts as `Fahrenheit` in exactly the forms the unit rules convert, so
`165 degrees F` counts, `Cook until the chicken reaches 165F` counts, and `Apartment 3F`
does not. The word `Fahrenheit` on its own counts too where it names the scale, as in
`Set the thermostat in Fahrenheit`, but not straight before a number, where it is part
of a title such as `Fahrenheit 451` or `Fahrenheit 9/11`.

Pounds count as `imperial units` only where the unit rules read them as a weight, so
`2 pounds of ground beef` counts, and the money in `It cost 1,500 pounds` or
`400 pounds a week` does not.

A numeric date counts as month-first or day-first in exactly the forms the date rule
reads, so `3/14/2024` counts as month-first and `14/3/2024` as day-first, while the range
`3.22-1000` and the version in `Node 14.2.10` count for neither. A named date counts as
month-first in exactly the forms the long date rule reorders, `Sep. 1, 1939` among them.

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

A forced verdict reads the tool's own `dmy` output as American too, so a second forced run
swaps back a `dmy` date whose day is 12 or under; see Dates above.

## What it will not touch

- **Proper nouns.** Pearl Harbor, the World Trade Center, the Department of Defense, the
  Australian Labor Party, rigor mortis, Fahrenheit 451, the MIT License, Prolog, and
  trademarks such as Band-Aid and Realtor.
- **Structure.** URLs, email addresses, inline code, fenced code blocks and HTML tags.
  Inline code is paired the way CommonMark pairs it: a span closes on a run of as many
  backticks as opened it, so ``` ``a ` b`` ``` is one span, and it may wrap onto the next
  line of its paragraph. A backtick with no partner before the paragraph ends, or one
  escaped as `` \` ``, protects nothing. A fenced code block opens on a line that starts with
  three or more backticks or tildes and closes on a line of the same character at least as
  long, so a fence of four backticks can hold one of three. A fence that never closes runs to
  the end of the text. The `syntax` option says how the text is marked up:

  | `syntax` | |
  | --- | --- |
  | `'markdown'` | Fences as above, and indented code blocks as CommonMark reads them |
  | `'text'` | No such fences, since a line of tildes underlines a heading in `.rst` or `.txt`: three backticks protect everything up to the next three |
  | none (default) | Fences as above, and an indented line is prose |

  An indented code block is a run of lines four or more columns past the content of the list
  item or quote it sits in, after a blank line or a block that is not a paragraph. A line
  indented that far inside a paragraph continues it, so a list item's wrapped line or second
  paragraph is still rewritten.
- **File names and paths,** read from their shape rather than a list of extensions. A file
  name is a name holding a letter, then a dot and an extension in one case with no space
  either side, so `behavior.ts`, `Center.vue` and `GRAY.PNG` are held, and so is a domain or
  a dotted name such as `theme.colors.gray`. A path is held whole when it starts at a root
  (`/`, `./`, `../`, `~/` or a drive letter such as `C:\`), runs to three or more segments,
  or ends in a file name, so `src/colors/center.ts` and `~/favorites` are held. Each rule
  leaves a common prose shape alone: two words joined by a slash, such as `color/flavor` or
  `src/colors`, are prose (write `./src/colors` or a code span to hold one); `The color.It`
  is a missing space, since `It` is mixed case; `3.5mi` is a number, since `3` has no
  letter; an initialism such as `U.S.` or `Ph.D.` is an initialism; and a unit straight
  after a number, such as `300 lb.ft` or `32 ft/s/s`, is a measurement.
- **Identifiers,** when `protectIdentifiers` is on (the default for source files):
  `normalizeInput`, `MAX_COLOR_VALUE`, `background-color`, `theme.colors.gray`,
  `--color-scheme`, `getColor()`. An initialism, where every part is one or two letters
  followed by a stop, is not a dotted name, so `U.S.`, `Ph.D.` and `p.m.` in a comment are
  rewritten as they are in prose.
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
`true` brings a rule back even if its preset, category or tier would have dropped it.
`ruleIds()` lists every id, and so does `--list-rules`.

`ruleCatalogue(dialect)` describes each rule for a settings screen. Each entry has the
rule's category, the tiers it runs under, a short label and an example, whether the
dialect leaves it off until `rules` turns it on, and whether `rules` can switch it at all:

```ts
ruleCatalogue('en-GB').find((rule) => rule.id === 'units.length.mile');
// { id: 'units.length.mile', category: 'units', confidence: ['moderate'], label: 'Miles',
//   example: '16 kilometres for 10 miles', offByDefault: true, switchable: true }
```

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

Comments are read in the markup their language documents in, whatever `syntax` says. That
is Markdown for most languages, so a tilde or backtick fence protects its example. Python's
docstrings are reStructuredText by convention, so Python reads as `syntax: 'text'` does,
and a line of tildes underlines a heading. `LexerSpec.docMarkup` sets this per language.
Indented lines in a comment are prose.

`lexerFor` accepts an id, an extension, a filename or a common alias, so `ruby`, `rb`,
`shell`, `golang`, `c++` and `Dockerfile` all resolve. `languageNames()` lists the lot,
and `--list-languages` prints them with the prose types added.

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

### How a comment is read

A comment is read the way its author wrote it. A block comment is one text, and so is a run
of line comments on consecutive lines with the same marker at the same column. A comment
after code joins only the comments lined up beneath it. Each line's marker (`//`, `#`, `///`,
`//!`) and the `*` that starts each line of a `/*` comment are taken out first, so the text
is Markdown: a line left holding only `//` or `*` is a blank line that ends a paragraph, a
backtick span or a fence may wrap from one line to the next, and an article that ends one
line agrees with the word that starts the next.

```
/**                          /// ```
 * Use `the                  /// let color = 1;      <- all left alone
 * color` here.              /// ```
 */
```

The `*` is taken out only when every line after the first starts with one, so a block
comment that leaves it off a line can hold a `*` bullet list. As in Markdown, a stray
backtick pairs with the next one in its paragraph. A change never reaches across the marker
that starts the next line, since its replacement could not put the marker back, so `It is 6`
above `feet tall.` is left as written.

## Integrations

The remark, ESLint and Prettier plugins check their options before they read a file, so
an option the library rejects, such as an unknown `dialect` or `preset`, fails the run on
its first file with the library's own message, whatever that file holds.

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

A backtick or tilde left in a text node is literal, since the parser has already taken out
every code span and block, so it protects nothing and `syntax` has no effect.

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
just that word, so `--fix` never rewrites more than it flagged. An article fixed to suit a
replacement is reported with it, as one problem whose one fix covers both words, so a quick
fix in the editor never leaves `a eraser` or `an rubber`. The editor shows
`"an eraser" is American English. Use "a rubber".` `deamericanise.configs.recommended` is
there if you want the defaults. Comments are read as `deamericaniseCode` reads them (see
[How a comment is read](#how-a-comment-is-read)), so a run of `//` lines is one text.

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
JavaScript, TypeScript, CSS, SCSS, Less, YAML, HTML and Vue are covered: Markdown and MDX
are handled as prose with `syntax: 'markdown'`, so indented code is left alone, and the
rest have only their comments touched.

Prettier validates option types and has no object type, so the two settings people
actually change are flat and anything else goes through `deamericaniseOptions` as JSON.
Requires Prettier 3.

### Web pages

```ts
import { deamericaniseDom, DomRewriter } from 'deamericanise/dom';

// Once, in place.
deamericaniseDom(document, { dialect: 'en-GB' });

// Or follow the page while it loads and changes.
const rewriter = new DomRewriter(document);
rewriter.watch();
rewriter.setOptions({ preset: 'localise' }); // re-reads every run from its original text
rewriter.changes();                          // the changes in place now
rewriter.highlights();                       // where each change in the text sits now
rewriter.stop({ restore: true });            // puts the page back
```

Both take the usual options, plus `verdict` (below) and `attributes`, which is `true` by
default and rewrites `title`, `alt` and `placeholder` as well as text.

**Runs of text.** A run is the text of one block, joined across inline elements such as
`b`, `em`, `span` and `a`. So `6 feet <b>2</b> inches` converts as one measurement. Any
other element ends the run, so a change never reaches across a paragraph, a table cell or a
line break. So does an inline element that the page lays out in a box of its own, such as a
span that is a flex item or is styled as a block or an inline-block, because its text never
reads as part of the word beside it. The layout comes from the page's computed styles, and
is read again once the page's stylesheets have loaded. A document with no window, such as
one from `DOMParser`, has no styles, so there the tag alone decides. A change that crosses elements puts its replacement in the first text node and
empties its share of the others: `6 feet <b>2</b> inches` becomes `1.88 metres<b></b>`. A
change that would move text into or out of a link, button or label is skipped, and so is
an article fix that depended on it.

**Originals.** Every node keeps its original text. A run that grows is re-read from the
originals, never from its own output, and `stop({ restore: true })` puts them all back.
Text a script writes over a rewritten node becomes the new original. A node that a script
keeps putting back is left to it after three attempts.

**Left alone:**

- `code`, `pre`, `kbd`, `samp`, `tt`, `xmp`, `listing`, `plaintext`, `script`, `style`,
  `noscript`, `template`, `textarea`, `input`, `select`, `iframe`, `object`, `canvas`,
  `audio`, `video`, SVG and MathML, and any element with `role="code"`, which also ends the
  run. Attributes on these elements are still rewritten.
- Code drawn as code, whatever its markup: an element that starts a run of its own, whose
  computed `font-family` falls back to the generic `monospace` or `ui-monospace`, and whose
  `white-space` is anything but `normal`. That finds code views that lay out each line in a
  `div`, `td` or `span`, such as GitHub's file view and Monaco, which keeps its lines
  unwrapped with `nowrap`. Prose that keeps its white space in a proportional font, as chat
  apps show it, still converts, and so does a heading in a monospace font that wraps as
  usual. On a page set wholly in a monospace font, a label kept on one line with `nowrap` is
  left alone too. The styles are read again once the page's stylesheets have loaded, and
  attributes are still rewritten.
- Anything editable: `contenteditable`, and a document in design mode. Text that becomes
  editable after it was rewritten gets its original back.
- Anything marked `translate="no"` or `class="notranslate"`, the markers sites already use
  to opt out of machine translation. `translate="yes"` inside `translate="no"` turns
  rewriting back on. Nothing turns it back on under `notranslate`. Both markers are ignored
  on `<html>` and `<body>`. Apps such as Outlook mark the whole page to stop Google
  Translate replacing their text nodes, which breaks React, and rewriting changes text in
  place without replacing nodes.
- Any element whose `lang` is not English. An element with no `lang` takes its parent's.

**Deciding whether a page is American.** `verdict` picks how:

| `verdict` | |
| --- | --- |
| `'detect'` (default) | From the page's own text, built up as it loads |
| `'lang'` | `en-US` is American and any other English region is not. A bare `en`, or no `lang`, falls back to `detect` |
| `'american'` | Always |

`detect` is the default because WordPress writes `lang="en-US"` unless the site owner
changes the site language, so many Australian and British WordPress sites claim to be
American. An explicit `assumeAmerican` wins over `verdict`.

Each region with its own `lang` is judged on its own text. A British page that quotes an
American source in a `lang="en-US"` block reads its own `04/05/2025` as 4 May. When more of
the page arrives and changes the verdict, the runs already rewritten are read again.

**While the page loads.** Call `watch()` at document start and each run is rewritten as
the parser adds it, before it is painted. The run the parser is still adding to waits until
the parser moves past it, or until `DOMContentLoaded`. So a measurement split across two
network packets is still read whole.

**Highlighting.** `highlights()` returns each change in the text with a `StaticRange` over
its replacement, ready for the CSS Custom Highlight API. It leaves out changes to attributes
and changes that only remove text, and the list is in no particular order.
`onRewrite(listener)` calls the listener after each batch of rewrites and returns a function
that removes it. The listener runs inside the observer callback, so paint in the next frame:

```ts
rewriter.onRewrite(() =>
  requestAnimationFrame(() => {
    const ranges = rewriter.highlights().map(({ range }) => range);
    CSS.highlights.set('deamericanised', new Highlight(...ranges));
  }),
);
```

```css
::highlight(deamericanised) { background-color: rgb(47 128 237 / 22%); }
```

**Shadow DOM.** The text a web component renders into its own shadow root is rewritten
too, along with the attributes in it. By default the rewriter finds open roots through
`element.shadowRoot`. The `shadowRoot` option takes a lookup of your own, such as one that
also finds closed roots in a browser extension, and `shadowRoot: () => null` stays out of
shadow DOM altogether. Inside a root, the host's `lang`, `translate`, `notranslate` and
`contenteditable` still apply, so a component on a `lang="fr"` element is left alone. A
shadow root starts a run of text of its own, so no change reaches across its edge or across
a `<slot>`.

`watch()` finds a root when its host is added to the page, and looks for new roots again at
`DOMContentLoaded` and `load`. Nothing in the page reports a root attached after `load` to
an element already there, which is what a custom element defined late does. Its text stays
as it is until `setOptions` reads the page again.

`highlights()` includes the changes inside shadow roots. Chrome paints them with the page's
own `::highlight()` rules. Firefox does not apply the page's rules inside a shadow root, so
there each root needs the rules in its own styles.

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
| `protectIdentifiers` | `false` (`true` for code) | camelCase, snake_case, kebab API names, dotted names |
| `syntax` | unknown | `markdown` or `text`: how code fences and indented code are read |
| `unitsKeep` | `[]` | Units to leave alone, by key |
| `units.precision` | `'natural'` | `natural`, `exact`, or a number of decimal places |
| `units.keepOriginal` | `false` | Write `1.8 metres (6 ft)` |
| `units.fuelEconomy` | `'l-per-100km'` | Or `km-per-l` |
| `units.respectConventions` | `true` | Leave screen sizes, yard lines and weight classes alone |
| `dates.format` | `'iso'` | `iso`, `dmy`, `long` |
| `dates.reorderLongDates` | `localise` only | `March 5, 2024` to `5 March 2024` |
| `times.to24Hour` | `false` | On gives `15:00` rather than `3pm` |
| `currency.mode` | `'annotate'` | Or `off` |
| `assumeAmerican` | inferred | Skip detection |
| `minAmericanConfidence` | `0.5` | The bar detection has to clear |

`units`, `dates`, `times` and `currency` each accept `false` to switch the category off.

A `dialect`, `preset` or `syntax` outside its list throws an `Error` that names the value
and the ones it accepts, such as `Unknown preset: Localise. Expected one of read, localise.`
Only the ids in `DIALECTS` are dialects, so a name every object has, such as `toString`, is
rejected the same way.

## Known limits

- The sense-dependent rules are heuristics over a window of surrounding text. They are
  right most of the time and tagged `risky` for the rest. Review a diff before committing
  one, or run `--confidence safe,moderate`.
- Identifier protection is deliberately over-eager in code: a hyphenated token containing
  `color`, `center` or `license` is treated as an API name, so `color-coded` in a comment
  survives. Turn it off with `protectIdentifiers: false`.
- File names and paths are read from their shape, so a few prose shapes read as one: three
  words joined by slashes (`color/flavor/size`) and a run-on sentence with a lower-case
  word after the stop (`the color.it was`) are held. A file name straight after a number,
  as in `Copy 2 color.ts`, reads as a measurement and is rewritten.
- Outside the remark plugin, the paragraph an inline code span may wrap within is found
  from its lines: a blank line, or a line that opens a heading, quote, list item, fence,
  rule or table row, ends it. A span that wraps onto the next `>` line of a block quote is
  therefore not protected. The remark plugin reads the real structure.
- Outside the remark plugin, a fence is read from its own lines, without the list items and
  quotes around it. A fence that a list item or quote ends without a closing line therefore
  runs on to the next line that would close it, or to the end of the text. A comment in a
  language that documents in Markdown is read that way, so a tilde heading underline in a
  reStructuredText block comment there leaves the text up to the next one as written.
- Outside the remark plugin, an indented code block is rewritten like the prose around it
  unless the text is known to be Markdown: a Markdown file, `syntax: 'markdown'`, or
  Prettier's Markdown parser. So `deamericaniseText` with no `syntax`, stdin without
  `--language md` or `--syntax markdown`, and comments rewrite it.
- Unit conversion is lossy at the default precision, by design. Use `precision: 'exact'`
  or `keepOriginal` where the numbers matter.
- A number that a hard wrap splits, such as `1` at the end of one line and `1/2 gallons` at
  the start of the next, or `two and a` then `half feet`, is not read as one. The fraction
  converts on its own and the written-out number is left as written. A web page is read the
  way it is usually laid out, with a line break in its source counting as a space.
- On a web page, only an element that starts a run of its own is checked for being drawn as
  code. A `span` inside a sentence that is set in a monospace font, with no `code` element
  or `role="code"` to mark it, is read as part of the sentence.
- `a third mile` is read as a fraction, though it can also mean one more mile after two.
  The same goes for `a fourth`, `an eighth` and `a sixteenth`.
- A line that ends in a number and a line that opens with a unit word are read as one
  measurement, so `Track 7` above `Miles Davis` becomes `Track 11 kilometres Davis`. A
  blank line or a list marker between them keeps them apart.
- Pounds with nothing beside them to say money or weight, as in `It's 5 pounds.`, are read
  as a weight.
- A weight with a comma between its parts, as in `7 pounds, 8 ounces`, converts as two
  weights, because a comma also separates a list such as `180 pounds, 3 ounces and 12 stone`.
- Currency amounts are never converted. Rates move; the output would be wrong by the time
  anyone read it.
- Grade-to-year mapping assumes the Australian and British numbering, which does not line
  up with every system.
- A web cookie is told from a baked one by the words in its own sentence. A short line
  with a second word but nothing about the web in it, such as `About cookies`, still
  becomes biscuits.
- An email mailbox is told from a letterbox the same way, by the words in its own
  sentence. `Set up your voicemail. Your mailbox has not been set up.` still gives a
  letterbox, because the second sentence says nothing about voicemail. A bare `The mailbox
  is full.` reads as a bounce notice and stays a mailbox, though it can be a letterbox.
- The trash of an email client or file manager is told from household rubbish the same way,
  and a capitalised `Trash` partway through a sentence is read as the folder's name. So a
  heading in title case, such as `How to Take Out the Trash`, keeps its trash.
- `localise` rewrites emergency numbers, which is right for a translated recipe and wrong
  for a news story about America. It changes `911` only where the text calls it or names
  the service by it (`call 911`, `dial 911`, `a 911 call`, `911 dispatchers`), so `$1,911`,
  `911 feet`, `Porsche 911` and `Room 911` stay as written, and so does a bare
  `Emergency: 911`. It is `risky`-tagged; `--confidence safe,moderate` drops
  it, and so does `--rule 'dialect.*=false'`.

## The browser demo

`site/` is a static page that runs the package client-side: paste or drop a file, and the
result comes back with each change coloured by category, underlined by confidence tier,
and explained on hover, beside a report of the changes and the American-ness score.
Dropping a source file uses `deamericaniseFile`, so a `.ts` file has only its comments
rewritten.

A collapsible panel lists all 84 rules grouped by family, each with a tick box and a
count of how many changes it made to the text on the left. Unticking forces a rule off;
leaving it ticked means the mode and confidence settings still govern it, so the count is
the honest answer to what actually ran.

The library imports no Node built-ins, so it runs in a browser unchanged. `npm run
build:site` bundles it to `site/vendor/`, which is generated rather than committed. CI
runs that build too, so breaking the bundle fails a pull request rather than a deploy.

To serve it locally:

```sh
npm run build:site
npx http-server site      # or: python3 -m http.server --directory site
```

## Browser extension

`extension/` is a Manifest V3 extension for Chrome, Edge and Firefox. It runs
`DomRewriter` on every page and frame you visit, starting before the page has any content,
so text is rewritten before it is painted. Everything runs on your machine. The
extension asks for one permission, `storage`, to keep its settings.

```sh
npm run build:extension
```

That writes `extension/dist/chrome` (also used for Edge) and `extension/dist/firefox`. They
are the same build with a different `manifest.json`: the Firefox one carries the add-on ID
and the data collection declaration that Firefox Add-ons requires. Both are generated, not
committed.

To load a build without a store:

- **Chrome:** open `chrome://extensions`, turn on **Developer mode**, choose **Load
  unpacked** and pick `extension/dist/chrome`.
- **Edge:** the same from `edge://extensions`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on** and pick `extension/dist/firefox/manifest.json`. Firefox removes it again when
  it closes. Firefox 140 or later is required.

Pages that were already open need a reload before the extension can rewrite them.

The toolbar button shows how many changes the current page has, switches the extension
off for that site, and switches highlighting on and off. The settings page has the dialect,
the mode, a switch for each category, the confidence tiers, the `verdict`, highlighting,
and the lists of rules and sites switched off. A category switched by hand beats the mode,
and stays that way when the mode changes, until you choose **Follow the mode**.

**Fine-tune** on a category opens its options and a switch for each of its rules, labelled
from `ruleCatalogue()`. Units have `keepOriginal`, `precision`, `fuelEconomy` and
`respectConventions`, dates have `format` and `reorderLongDates`, and times have
`to24Hour`. An option you leave alone follows the mode. A rule switched on there still needs its category on and its tier
ticked, unlike `rules` in the package. Currency and Other have one rule each, so their
category switch is the only one.

Highlighting is off by default. When it is on, each change gets a background in its
category's colour and an underline that is solid for safe, dashed for moderate and dotted
for risky. Point at a change to see what it replaced, the rule and its confidence. Move the
pointer onto that description and choose **Switch off this rule** to stop the rule on every
site. An article fixed to suit a replacement, such as `an` to `a`, follows that replacement
and has no switch of its own. The highlights are painted with the CSS Custom Highlight
API, so the page's elements stay as they were. Changes to `title`, `alt` and `placeholder` are not highlighted, and there is no
description on a touch screen. Settings sync between browsers signed in to
the same account, and changes apply to open pages straight away.

Limits:

- Settings are read asynchronously, so on a page that renders very fast the first paint can
  happen before the settings arrive. The page is rewritten as soon as they do.
- A site is switched off by its hostname, frame by frame. A frame from another site embedded
  in a page you switched off is still rewritten.
- At most 480 sites can be switched off. Browsers sync at most 512 items for an extension,
  and each site switched off takes one, so the rest are kept for the other settings. At the
  limit the toolbar button says so, and switching a site back on in the settings page makes
  room. Any change the browser refuses to store is reported in the same way, and the switch
  goes back to what is stored.
- Web components are rewritten, closed shadow roots included. A component defined after the
  page has loaded, whose tag was already on the page, keeps its American text.
- Changes inside a web component are highlighted in Chrome and Edge but not in Firefox.
  Pointing at one shows its description in Chrome and Edge 128 or later, and in Firefox 150
  or later.

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

The same tag also builds the browser extension. Once the npm publish succeeds, CI zips
`extension/dist/chrome` and `extension/dist/firefox` and attaches them to the GitHub
release for the tag, creating the release if it does not exist yet. The Chrome zip is the
one for Edge too. Uploading to the Chrome Web Store, Microsoft Edge Add-ons and Firefox
Add-ons is manual.

The store screenshots and the 440×280 promo tile are in `extension/store/images`, at sizes
all three stores accept, along with the 300×300 logo Edge asks for. The screenshots show an
invented American recipe page, `extension/store/sample.html`. To make them again after the
extension changes, run `npm run build:extension` and then `node extension/store/capture.mjs`,
which needs Google Chrome.

The privacy policy the stores link to is `site/privacy.html`, which GitHub Pages publishes
with the demo at <https://mitchellneedham.github.io/deamericanise/privacy.html>.

Firefox Add-ons asks for the source of any bundled code. Upload the source archive GitHub
makes for the same tag, and give `npm ci && npm run build:extension` as the build steps.

The Firefox add-on ID, `deamericanise@mitchellneedham.github.io`, is set in
`tsup.extension.config.ts`. Once the add-on is listed it can never change.

## Licence

MIT
