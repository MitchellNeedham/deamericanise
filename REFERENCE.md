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
29.92 inHg      -> 1013 hPa          32 psi     -> 220 kPa
```

A unit that describes the noun after it stays singular: `a 9 inch dish` becomes
`a 23 centimetre dish`, and so do `9 inch pans`, `the 5-6 inch pans` and `one-inch slices`.
A determiner, a hyphen tying the number to the unit, or the singular after a number above
one says so. One and a fraction take the singular anyway, so `one quart small onions` and
`1/2 pound ground beef` keep a plural unit, read as quantities with the `of` left out. A
preposition, a size, an adverb of place, slope or time, a pronoun, a conjunction, a number
or a date after the unit is no noun: `a quarter mile later` becomes `400 metres later`, and
`a mile and a half back` becomes `2.4 kilometres back`. A count before an attributive
measurement counts the noun, so `two quarter-pound burgers` becomes `two 110 gram burgers`.
So does a count in words spaced before a length that a hyphen ties to its size, which leaves
the unit one of itself: `two foot-long subs` becomes `two 30 centimetre long subs`, and a
range or list of such counts reads the same, so `two to three foot-long subs` becomes
`two to three 30 centimetre long subs`. After a determiner that takes one of a noun, or in a
list of sizes, the count is the number of units, so `a two foot-long sub` becomes
`a 61 centimetre long sub`, as `a two-foot-long sub` does, and `a two to three foot-long gap`
becomes `a 61 to 91 centimetre long gap`.
A unit that starts a noun leaves the number counting it, so `Bake 1 pound cake`,
`6 foot soldiers`, `foot traffic`, `8 inch worms`, `5 yard sales`, `3 yard signs`,
`the two pound signs` and `3 mile markers` are left as written, while `a 2-pound cake`
becomes `a 910 gram cake`. The noun is held with the quantity, so no other rule rewrites part
of it: en-ZA leaves `6 foot traffic lights` as written.
A length that gives the size of a noun describes it whatever its number, so
`a 6 foot long table` becomes `a 1.8 metre long table`, `cut into 1/2 inch thick slices`
becomes `cut into 1.3 centimetre thick slices`, and `a 6-foot-tall fence` becomes
`a 1.8 metre tall fence`. A size with no noun after it leaves the unit plural, so
`6 feet long` becomes `1.8 metres long`.

An ounce or a ton measures something else where the words beside it say so. An ounce of a
drink is a fluid ounce, so `Drink 16 oz of water.` becomes `Drink 470 mL of water.`, and so
are `a 12 oz can of soda` and `a 16-oz pint glass of beer`. An ounce of gold, silver, platinum,
palladium or bullion is a troy ounce of 31.1 grams, so `16 oz of gold` becomes `500 g of gold`,
and `troy ounces`, `troy oz`, `ozt` and `oz t` are troy ounces wherever they stand. A ton of
air conditioning is a ton of refrigeration (`12,000 BTU` an hour), so
`a 3-ton central AC unit` becomes `an 11 kilowatt central AC unit`. Circuit boards are ordered
by the ounces of copper on them the world over, so `2 oz copper` is left as written, and so
is an ounce in a sentence that names a PCB, FR-4 or a circuit board. A change in another
sense goes under the id of the measure it converts as, such as `units.volume.fluid-ounce`,
so `rules` and `unitsKeep` switch it with that measure, and its note says how the unit was
read.

A metric value the author gives after the quantity decides the sense by its dimension, so
`8 oz (240 mL) of milk` becomes `240 mL of milk` and `8 oz (230 g) of milk` becomes
`230 g of milk`. Otherwise the phrase after the unit decides: an optional `of`, at most two
words that are not function words, and then the thing measured. A container is read
through to what it holds, so `a 15 oz can of beans` stays a weight. A metal, copper or a
cooling word counts whatever follows it, but not inside the name of something else, so
`a 1 oz gold coin` and `A 5-ton air conditioner cools the hall.` read in the sense while
`2 oz silver polish` is a weight. A drink counts only where it heads the phrase: as its last
noun, before a stop, a function word, an adverb or a verb with its object, or before a vessel,
as in `a 12 oz soda can`. So `Add 8 oz of milk slowly.`, `8 oz chocolate milk` and
`16 oz of water keeps you going.` are fluid ounces, while a food a drink names is a weight, as
in `8 oz rum raisins`, `8 oz cream cheese`, `8 oz milk chocolate` and `12 oz coffee beans`,
and so are the solids whose head is a drink: `sour cream`, `ice cream`, `cream of tartar`,
`baking soda` and `ground coffee`. Where the quantity is the subject of its clause, opening a
sentence or following a conjunction such as `until`, `once` or `when`, a word ending in `s`
after the drink is its verb, so `Heat until 8 oz of milk boils.` and
`16 oz of water goes into the pot.` are fluid ounces. That word is a plural noun where an
auxiliary follows it, or a word that a function word, an adverb or a number follows in turn, as
in `8 oz rum raisins go in first.`, and at the opening of a sentence where a comma or the end of
its line follows it, as in a list of ingredients.
A word ending in `s` between the unit and the thing is a
plural or a verb, so it stands there alone, and `A 3-ton truck needs AC.` is a weight. A
drinking glass before another vessel is its material, so `a 16 oz glass jar of honey` is a
weight. A phrase that names any other
thing keeps the unit's own sense, as `The AC is in a 3-ton truck` and
`Dissolve 2 oz of sugar in water` do. Only where nothing after the quantity names a thing do
the words before the number count, across at most a noun such as `unit` and three function
words, as in `AC units of 2 to 5 tons` and `Copper weight: 2 oz`, and then, for copper, the
rest of the sentence. A plural unit word describes no noun, so the word after it names no
thing, and `AC units of 3 tons cool the hall.` becomes `AC units of 11 kilowatts cool the hall.`,
while `The truck carries 3 tons of gravel.` stays a weight. `tonnage` says nothing, since a ship's tonnage is a weight.

A unit of more than one word is read in the singular as well as the plural, so
`half a pound per square inch` becomes `3.4 kilopascals` and `1 mile per hour` becomes
`1.6 kilometres per hour`. In the singular it describes a noun as a one-word unit does, so
`a 2 square mile park` becomes `a 5.2 square kilometre park` and `a 100 foot-pound wrench`
becomes `a 140 newton metre wrench`. `an hour` before `ago`, `later`, `earlier`, `before` or
`after` is a time, so `2 miles an hour ago` becomes `3.2 kilometres an hour ago`.

Dimensions move as a set, because converting half of a pair is worse than leaving it
alone: `10 x 12 feet` becomes `3 x 3.7 metres`, and `8.5 x 11 inches` becomes
`22 x 28 centimetres`, both ends sharing the unit chosen for the larger. Each side is read
in its own unit, so `2 feet x 6 inches` becomes `61 x 15 centimetres` and `10 ft x 12 in`
becomes `3 x 0.3 m`, where the `in` is the unit because the side before it has one. An `in`
before `x` and another number is the unit too, so `4 in x 6 in` becomes `10 x 15 cm`, while
`6 in by 5 in the morning` stays as written. An apostrophe straight after a number is feet
on a side, when every side has a mark of its own: `2' x 6"` becomes `61 x 15 cm` and
`2' x 4'` becomes `0.61 x 1.2 m`, while a quoted `'6'` stays a number. Sides
that measure different things, as in `2 feet x 6 pounds`, convert as two measurements.
Only a length has sides. Before any other unit a bare number is a count, and the quantity
after it converts on its own: `2 x 4 oz cans` becomes `2 x 110 g cans`, and
`2 x 4 lb 8 oz bags` becomes `2 x 2.04 kg bags`. A dimension is left as written when a side with no unit sits between two different units
(`10 ft x 12 x 6 in`), or when the rule for one of its units is switched off.

Feet and inch marks may be straight, curly or primes: `6'2"`, `6’2”` and `6′2″` all become
`1.88 metres`, and `the 2’ x 6” shelf` becomes `the 61 x 15 cm shelf`. A `"` or `”` straight
after a number is the inch mark unless it closes a quotation. A quotation is open after an
odd number of straight double quotes that are not inch marks, or after a `“` with no `”`
since, counting back to a blank line. So `a 6" pan` becomes `a 15 cm pan`, while
`He said "6" twice.` and `“Route 66”` stay as written, and so does a dimension with a side
quoted that way. An inch mark inside a quotation cannot be told from the quotation's close,
so `"It is 6" long," she said.` is left as written too. `″` is never a quote.

A side may be a whole number in words: `a ten by twelve foot room` becomes
`a 3 by 3.7 metre room`, and `two x 4 oz cans` becomes `two x 110 g cans`. A fraction in
words on any side, as in `two and a half by three feet`, leaves the dimension as written. So
does `one by two feet`, since `one` may be a pronoun with `by` giving an amount. After a word
such as `each`, `all` or `that one`, only the amount converts: `raise each one by two inches`
becomes `raise each one by 5.1 centimetres`, and `raise all 4 by 6 inches` becomes
`raise all 4 by 15 centimetres`. A pair in digits before a noun describes it, so
`those 4 by 6 inch photos` becomes `those 10 by 15 centimetre photos`.

A weight in two units is one weight, as a height in feet and inches is one height:
`7 pounds 8 ounces` becomes `3.4 kilograms`, `11st 4lb` becomes `71.7 kg`, and
`11 stone 4 pounds 8 ounces` becomes `71.9 kilograms`. The first part can be a fraction, a
mixed number or a decimal, so `1 1/2 pounds 3 ounces` becomes `765 grams` and
`2.5 feet 3 inches` becomes `83.8 centimetres`. Any part can be a whole number in words, so
`six feet two inches` becomes `1.88 metres`, and `Week 3 seven pounds eight ounces` becomes
`Week 3 3.4 kilograms`. After `foot` or `feet` the inch word can be
left out where nothing that could be a noun follows: before punctuation, the end of the
text, or a word that cannot open a noun, such as a preposition or a conjunction. So
`He is six foot two.` becomes `He is 1.88 metres.` and `6 foot 4 with long arms` becomes
`1.93 metres with long arms`, while `6 feet 2 cars` is two things. Of those words, `in` is
the inch abbreviation, and `to`, `and`, `or` or `by` before a number carry the inches on to
a range or a side, so `6 feet 2 to 3 inches` becomes `1.8 metres 5.1 to 7.6 centimetres`. The
inch word can also be left out before a join and another measurement in feet, so
`6 foot 2 to 6 foot 4` becomes `1.88 metres to 1.93 metres` and `2 feet 6 to 3 feet`
becomes `76.2 centimetres to 91 centimetres`. A spaced `in` after the inches is the
preposition when a word or number that opens its object follows, so
`She stands 5 feet 4 in her socks.` becomes `She stands 1.63 metres in her socks.`, while
`She is 5 feet 4 in tall.` becomes `She is 1.63 metres tall.` and `a 6 ft 2 in man` keeps
the `in` as the unit of a height that describes the man. A hyphen may tie each number to a
unit word or abbreviation, and the inches to the foot word or mark: `six-foot-two` and
`6′-2″` become `1.88 metres`, and `a 6-foot 2-inch pipe` becomes `a 1.88 metre pipe`. Only
inches below a foot, with no unit of their own, are tied that way, so `5 feet-6 feet` stays
a range and `2 feet-18 inches` two lengths, while `5 feet-6 inches` becomes `1.68 metres`. A
height hyphenated to its inches is one word, so a noun after it is what it describes:
`a six-foot-two man` becomes `a 1.88 metre man`. A number straight after a length, or
after stone or pounds, is a smaller unit of it, never the first end of a range in the same
unit, so `5 ft 6 to 6 ft` and `3 yards 2 to 4 yards` are left as written, with `units.range`
or `units.measurement` switched off too. A weight's next
unit word can be left out before a join and another weight in its larger unit too, so
`11 stone 4 to 12 stone` becomes `71.7 kilograms to 76 kilograms` and `7 lb 8 to 9 lb`
becomes `3.4 kg to 4.1 kg`, while `11 stone 14 to 12 stone` is left as written. Together the
parts claim three significant figures. A height that describes the noun after it keeps the singular where its inch unit is
the singular word or a determiner opens it: `a 6 foot 2 inch man` and `a 6 ft 2 in man` both
become `a 1.88 metre man`. Where a unit of the weight is kept, by the dialect or by `unitsKeep`,
the whole weight is left as written, so an `en-GB` `11 stone 4 pounds` never becomes
`11 stone 1.8 kilograms`. Turning on `units.mass.stone` or `units.mass.stone-pounds`
converts it. A weight or height at the end of a range or list, as in `7-8 lb 4 oz`,
`5 to 6 feet 2 inches`, `five to seven pounds eight ounces` or `5, 6, 7 feet 2 inches`, is
left as written too, since its first end could be in either unit. So is a height or weight
that starts where no measurement can (see below), as in `At 7:30 feet 2 inches` and
`catch-22 feet 2 inches`, or whose first number in words is the tail of a longer one, as in
`five-seven pounds eight ounces`.
`st` is read only in such a weight, because `1st` on its own is an ordinal.
A weight in two units describes a noun as one unit does, so `7 pound 8 ounce babies` becomes
`3.4 kilogram babies`.

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
`two thousand five hundred feet` and `twenty-two hundred feet` convert too. The count before
`thousand` may itself be a count of hundreds, with a cardinal after it or not, so
`a hundred thousand miles` becomes `160,000 kilometres` and
`two hundred and fifty thousand pounds` becomes `110 tonnes`. Straight after `between`, the
`and` in such a count joins a range, so `between one hundred and two thousand miles` becomes
`between 160 and 3200 kilometres`. A number never
starts after `hundred` or `thousand` with at most a comma, `and` or `to` between, except as
the second end of a range, so `hundreds of miles` and `a few hundred feet` are left as
written, while
`between one hundred and two hundred miles` becomes `between 160 and 320 kilometres`.
`It cost a hundred pounds.` is still money.

A range joined by `or` converts at both ends, as one joined by `to` does: `5 or 6 feet`
becomes `1.5 or 1.8 metres`. So does every figure of a list before one unit, sharing the unit
chosen for the last and keeping the list's commas and its last `and` or `or`:
`5, 10, and 15 feet` becomes `1.5, 3, and 4.6 metres`, and `4, 6, 8 inches` becomes
`10, 15, 20 centimetres`. One figure and a comma before a measurement is no list, so
`Serves 4, 2 pounds beef` keeps its count. A list starts after a figure that cannot open a
range with the one after it, a figure out of the list's order, or the day of a date, so
`In 2024, 5 and 10 feet` keeps its year and `Serves 4, 2 or 3 pounds beef` its count. A list
that starts as the second end of a range, as in `1 to 2, 4 or 6 feet`, is left as written.

A range may have a whole number in words at either end when `to` or `or` joins it, or `and`
after `between`: `five to 10 miles` becomes `8 to 16 kilometres`, and
`between one and two pounds` becomes `between 450 and 910 grams`. A list may have them too,
with no `between` before its `and`, so `five, ten and fifteen feet` becomes
`1.5, 3 and 4.6 metres`. A dash joins a range only between digits, since
`one-half` and `twenty-two` are single numbers, so `five-10 miles` is left as written. So is
a range with a fraction in words at either end, as in `two and a half to three miles`, and
`two to three hundred feet`, which may mean 200 to 300, and
`one hundred to two hundred thousand miles`, which may mean 100,000 to 200,000. `half to` is an idiom, so
`reduce by half to 2 quarts` converts only the quarts.

A hyphen left hanging on a range's first number, as recipes write it, joins the range with
`to`, `and` or `or` after it: `Cut into 2- to 3-inch pieces.` becomes
`Cut into 5.1 to 7.6 centimetre pieces.`, and `Use 8- or 9-inch pans.` becomes
`Use 20 or 23 centimetre pans.`

A range may give its unit at both ends. Joined by `to`, it converts as one range with one
unit, so `from 15 inches to 17 inches` becomes `from 38 to 43 centimetres`. Joined by a
dash, a comma, `and` or `or`, each end keeps its unit, so `5 feet or 6 feet` becomes
`1.5 metres or 1.8 metres` and `5ft-6ft` becomes `1.5 m-1.8 m`. Either way the two ends are
one span to every check that leaves a range as written, so a conventional size is never half
converted: `rims from 15 inches to 17 inches` and `fits 15″-17″ wheels` are left as written.
Two units that differ, as in `from 6 feet to 10 inches`, are two measurements.

A whole number hyphenated to a fraction below one is a mixed number, as trade writing has
it: `a 2-3/4 inch board` becomes `a 7 centimetre board`, the same as `a 2 3/4 inch board`.
`1-3 inches` and `1/2-3/4 inch` are still ranges.

Wherever a hyphen may stand in or beside a measurement, the Unicode hyphen (U+2010) and the
non-breaking hyphen (U+2011) that typesetting puts in `5-10` or `6-foot` read the same as
`-`. So a range written with either still becomes `1.5-3 metres`, `6 feet 2-1/2 inches`
written with either is still one height, and `the 40-yard-line` written with either is still
a conventional size. Neither is a minus sign, so a number straight after one is left as
written, unless it follows a unit or a prefix as a hyphen-minus would (see below), so
`5ft‐6ft` becomes `1.5 m‐1.8 m` with either.

A fraction with a zero denominator, as in `5/0 inches`, is not a quantity, so it is left as
written, and so is a height or weight it is part of, as in `5 feet 1/0 inches`.

A number grouped in thousands with spaces is one number, as one grouped with commas is: one
to three figures, then groups of exactly three after a single space, no-break space (U+00A0)
or narrow no-break space (U+202F), the same kind throughout. So
`The road is 1 000 miles long.` becomes `The road is 1 600 kilometres long.`, and no
measurement starts on a later group. One or two figures after a space are a number of their
own, so `Rooms 3 4 feet apart` becomes `Rooms 3 1.2 metres apart`, and figures that no
number starts at lead no group, as the `98` of `10/20/98 100 feet` does not. Before a
hyphenated size, a number grouped with spaces is one number only after a determiner such as
`a`, `the` or `each`, or a possessive such as `their` or `Sam's`, so `a 1 500-foot tower`
becomes `a 460 metre tower`. Otherwise its last group is the size and the figures before it
count the noun, so `Buy 2 100-pound bags.` becomes `Buy 2 45 kilogram bags.` After `her`,
which may own the noun or be given it, either reading may be meant, so
`I gave her 2 100-pound bags.` is left as written. Before a spaced
singular unit word it may be either, so `They built 3 400 foot towers.` is left as written.
A whole number with a leading zero is a code or a name, so
`Agent 007 feet` and `We drove 025 miles.` are left as written, while `0` and `0.5` are
numbers.

A number never continues onto the next line, so the `14` that ends `Step 14` is never taken
as the whole part of a `1/2 gallon` that opens the next line. The rest of a measurement can
wrap: `6` at the end of one line and `feet` at the start of the next still convert, and so
does a range or dimension broken at its `to`, `-` or `x`. Nothing joins across a blank line
or into a line that opens a list item, heading, quote or table row, so `Serves 4` followed
by `- 2 pounds beef` is a serving count and a bullet, not a range.

A measurement never starts straight after a word and `-`, which join a name to its number, so
`catch-22 feet`, `F-150 pounds` and `Route-66 miles` are left as written. A unit before the
hyphen ends a quantity, so `5ft-6ft` and `5 ft-6 ft` still become `1.5 m-1.8 m`, and
`two feet-three feet` becomes `61 centimetres-91 centimetres`. So does one of the prefixes
`sub`, `under`, `over`, `near` and `mid`, which stays in front of the conversion:
`a sub-2 pound tent` and `a sub-two pound tent` both become `a sub-910 gram tent`. Four
figures from 1000 to 2999 after `mid-` are a year, so `In mid-2024 miles were driven.` is
left as written.

A run of `_` that opens emphasis is no part of a word, so a measurement in underscores
converts as one in asterisks does: `It is _6 feet_ tall` becomes `It is _1.8 metres_ tall`
and `Bake at __350°F__` becomes `Bake at __175°C__`. A letter, digit or stop before the run
joins it to a word, so `MAX_6 feet` is left as written.

A measurement never starts straight after `-`, `/`, `,` or `:` following a digit or a vulgar
fraction, where the number is the tail of a date, a fraction, a grouped number or a clock
time. So `3/14/2024 1/2 gallon` converts the `1/2 gallon` alone, and `a 7:30 mile pace` is
left as written, while `Distance:5 miles` still converts. Nor does one start on a price, so
`a $5 gallon of milk` and `a $5 x 10 foot tarp` are left as written. Four figures straight
after a written-out month, with or without a day, are the year of a date, so
`Oct 22, 2024 1/2 inch`, `October 22 2024 1/2 inch`, `22 October 2024 1/2 inch` and
`In May 2024 1/2 inch` convert the `1/2 inch` alone, and `In May 2000 feet` is left as
written. A comma after a bare month frees the number, so `In May, 2000 feet` converts, and a
shorter number is no year, so
`In May 5-10 feet` is still a range. Four figures from 1000 to 2999 straight after `in`, `by`,
`since`, `until`, `before`, `after` or `during` that opens a sentence or clause may be a
year, so `In 2024 yard sales rose.` and `Last year, in 2024 miles were driven.` are left as
written. So may every figure of a range or list of them that rises, after those words or
`from` or `between`, so `In 2020-2024 miles were driven.`,
`In 2020, 2022 or 2024 miles were driven.` and `From 2019 to 2024 miles driven rose.` are
left as written too. A range or list in feet is a height, never years, so
`From 1000 to 2000 feet the air thins.` becomes `From 300 to 610 metres the air thins.` The preposition opens one at the start of the text or a line, or of a list item
there (`- `, `* `, `+ `, `1. ` or `2) `), or after a stop, comma, semicolon or colon, with
only spaces and opening quotes or brackets between. Inside a
clause the number is a quantity, so `The wreck lies in 1500 feet of water.` becomes
`The wreck lies in 460 metres of water.` A comma in the number, a hyphen before the unit or
an abbreviation for it makes a quantity too, as in `In 2024-mile races` and
`In 1500 ft of water`, and so does a unit word that ends the clause:
`It rose by 1200 feet.` becomes `It rose by 370 metres.` A range's first number is never
more than ten times the size of the second, which makes it a year or a count. Where the first number cannot open the
range, the second converts on its own: `In 2024 - 5 feet` becomes
`In 2024 - 1.5 metres`, and `Price $5 - 10 inches` keeps its price. `from` or `between`
before the first number makes a range of any two, so `fell from 10 to 0.5 miles` converts
whole. With `units.range` or `units.dimensions` switched off, a range or dimension is left as
written, never half converted, so `½-¾ inch`, `½ to ¾ inch`, `1½ x 2 inch`,
`five to 10 miles` and `ten by 12 feet` stay as they are.

Fuel economy is read as `mpg`, `miles per gallon`, `miles-per-gallon`, `miles/gallon` or
`mi/gal`, so `30 miles/gallon` becomes `7.8 L/100km`, never kilometres per gallon, and
`7.8 L/100km (30 mi/gal)` is a restatement. A range converts at both ends and gives the
smaller number first, though litres per 100 km fall as miles per gallon rise: `20 to 30 mpg`
becomes `7.8 to 12 L/100km`, and `8.5 to 13 km/L` with `fuelEconomy: 'km-per-l'`. After
`from` the order shows a direction, so it stays: `improved from 20 to 30 mpg` becomes
`improved from 12 to 7.8 L/100km`. A list gives its smallest first too, so
`20, 25 or 30 mpg` becomes `7.8, 9.4 or 12 L/100km`. A range or list of fuel economy with a
figure in words or a fraction before its last, or a figure of zero, as in `twenty to 30 mpg`,
is left as written.

Temperatures convert at both ends of a range too, so `Bake at 350-375°F` becomes
`Bake at 175-190°C`, and at every figure of a list, so `Bake at 325, 350 or 375°F` becomes
`Bake at 165, 175 or 190°C`. A gas mark before a dash, `to` or `or` gives the same heat on
another scale, so `gas mark 4 or 350°F` becomes `gas mark 4 or 175°C` and
`gas mark 4 - 350°F` becomes `gas mark 4 - 175°C`. A temperature range wraps and stops at
a new block as the others do, so `Room 13` above a bullet `- 0°F overnight` is a room and a
temperature. A change in temperature has no 32° offset to take off, so
`dropped 20°F` becomes `dropped 11°C` and `10°F warmer` becomes `5.6°C warmer`. The words
beside the number tell the two apart: a verb of change or `by` before it, a comparative
or a noun such as `drop` after it. They are read past a Celsius value given beside the
number, so `It was 20°F (11°C) warmer` becomes `It was 11°C warmer`, and
`It rose 11°C or 20°F` stays as it is. `fell to 20°F` names the new temperature and
converts as one, and `10°F below zero` becomes `-23.3°C`. Changes have a rule of their own,
`units.temperature.difference`, so they can be switched off apart from temperatures.

Fahrenheit is read as `°F`, `℉`, `degrees F`, `deg F`, `degrees Fahrenheit` or
`95 Fahrenheit`, with `º` or `˚` accepted for the degree sign, as phone keyboards type it.
A bare letter `F`, as in `degrees F`, `deg F` or `350 F`, takes the stop after it as an
abbreviation does, so `Bake at 350 degrees F. for 20 minutes` becomes
`Bake at 175 degrees Celsius for 20 minutes`, while a stop that also ends the sentence
stays, and so does one before a figure or a bracket. `°F` and `℉` are symbols, whose stop
is usually the sentence's own, so it goes only where a word in lower case carries the
sentence on: `Bake at 350°F. for 20 minutes` becomes `Bake at 175°C for 20 minutes`, while
`- 350°F.`, `"Bake at 350°F." he said` and `It was 90°F. Then it rained.` keep their stop.
Before its own Celsius value in brackets, the pair still collapses, and the same test runs
past the bracket: `Bake at 350°F. (175°C) Then stir.` becomes `Bake at 175°C. Then stir.`,
and `Bake at 350 degrees F. (175°C) for an hour.` becomes `Bake at 175°C for an hour.`
The word `Fahrenheit` takes no stop. A spelled-out value keeps the author's singular
where it describes the noun after it, so `a 350 degree F oven` becomes
`a 175 degree Celsius oven`, while `Preheat to 350 degrees F` keeps the plural. A hyphen may
join the number, `degree` and the scale in a modifier, and goes with the conversion as a
length's does, so `110-degree-Fahrenheit heat` becomes `43.3 degree Celsius heat`. A degree
that is one factor of a compound unit measures no temperature, so `0.45 °F·ft²·h/BTU` and
`2 °F/min` are left as written. A slash makes one only before a unit of time, length, energy
or power, so `225°F/low/slow` and `350°F/gas 4` still convert.
The word alone does not count after a whole number of four figures, which reads as a year
(`In 1724 Fahrenheit proposed his scale`), before `thermometers` or `scale`, where the
number counts them, or before a number, where it is a title (`Fahrenheit 451`). A bare `F`,
as in `165F` or `350 F`, is more often a letter, so it counts only as an upper case `F`
after a number of two or three figures, in a sentence about heat (an oven, cooking, the
weather, a fever or a temperature) that gives no Celsius value. An American word the
vocabulary rewrites into one of those, such as `cookie sheet`, `broiler` or `skillet`,
counts too, whether or not the vocabulary runs. The sentence wraps across lines and ends
at a blank line, a list item, a heading, or a stop before a capitalised word, but not at
the stops of `10 min. at` or `6 p.m. were`. As the abbreviation rules decide, a title such
as `Mr.` never ends one before a name, and an initialism such as `U.S.` ends one only
before a word that cannot continue a name. A number, in figures or in words, never opens
a sentence, but a date that starts with a figure does, as `1 December 2024` and
`01/12/2024` do, since those are what the date rules write for `December 1, 2024`.
`Cook until the chicken
reaches 165F` becomes `73.9°C`, while `Apartment 3F`, `seat 23F`, `the Boeing 777F`,
`#33F`, `F-150` and the courtesy figure in `180C/350F/gas 4` stay as they are.

A Celsius value beside a Fahrenheit one is read in the same forms (`175ºC`, `175℃`,
`175 deg C`, `175 Celsius`), as `175 centigrade` or `175 degrees centigrade`, and as a bare
upper case `C` after a number of two or three figures with at most one space.
So `Bake at 350°F (180C)` becomes `Bake at 180C` and `180C/350°F/gas 4` stays as it is,
while `Apartment 3C (65°F)` is a flat and its temperature converts. The bracket may give the
gas mark after the Celsius value, joined by `/`, `,`, `;` or `or`, and the gas mark stays in
it: `Preheat to 350°F (180°C/gas mark 4)` becomes `Preheat to 180°C (gas mark 4)`, and
`180°C (350°F/gas mark 4)` stays as it is. The words are read in
any case, as the Fahrenheit value's are, so `350 degrees fahrenheit (180 degrees celsius)`
becomes `180 degrees celsius`, but a lone `C` only in upper case, after a degree sign or
`degrees` too, so `Bake at 350°F (180c)` becomes `Bake at 175°C (180c)`.

A Fahrenheit decade near a word about heat or the weather becomes a range, since it
straddles the Celsius decades: `on mild days in the 70s` becomes
`on mild days between 21 and 26°C`, and `highs in the mid 90s` becomes
`highs between 34 and 36°C`. Two decades joined as a range's figures are, by `to`, `and`,
`or` or a dash, become one range, so `highs in the 70s or 80s` becomes
`highs between 21 and 32°C`. A decade of the calendar, as in `Back in the 70s`, stays as it
is, and so does a decade with a Celsius unit after it, in any of the forms above or as a
bare upper case `C`: `temperatures in the 30s Celsius` and `highs in the 20s °C`.

The target unit follows the magnitude, so `2 feet` gives centimetres and `0.5 miles` gives
metres. Precision defaults to `natural`, which matches the significant figures of the
source and never claims more accuracy than was written down. Inches of mercury are the
exception: an altimeter setting is read in whole hectopascals, so `30 inHg` becomes
`1016 hPa` and each end of a range is whole too, while a value under one hectopascal keeps
the figures, as `0.01 inHg` becomes `0.34 hPa`. `exact` and a fixed number of
decimal places are both available, as is keeping the original alongside:

```ts
deamericaniseText('6 feet', { units: { precision: 'exact' } });        // '1.8288 metres'
deamericaniseText('6 feet', { units: { precision: 1 } });              // '1.8 metres'
deamericaniseText('6 feet', { units: { keepOriginal: true } });        // '1.8 metres (6 feet)'
```

A converted number groups its thousands as its source did. From a source grouped with
commas, four figures are grouped too, so `2,025 miles` becomes `3,259 kilometres`, while
`2025 miles` becomes `3259 kilometres`. A source grouped with spaces gets the same kind of
space back, so `12 500 miles` becomes `20 100 kilometres`. From a source with no separator,
five figures and more are grouped with commas, so `12500 miles` becomes `20,100 kilometres`.
In a range or list, one grouped figure groups them all.

A measurement that already gives both values is converted once, not twice. `6 feet (1.8 m)`
becomes `1.8 m`, keeping the figure the author rounded. That needs a bracket that restates
the conversion: the same dimension, and each figure within a quarter of the converted one
(10 °C for a temperature) once both are read to the figures they are written to. So
`1 pound (500 g)` and an imperial `1 pint (568 ml)` collapse, while `6 feet (2 kg)` and
`6 feet (5 m)` convert as normal and keep their bracket. The bracket may start on the next
line, but not after a blank line. `1.8 metres (6 feet)` is left as
it is, because the bracket only restates the metric value in front of it. That is the
form `keepOriginal` writes, so running it again changes nothing. The same holds for any
quantity in words the unit rules convert, as in `1.3 centimetres (half an inch)` and
`2.4 kilometres (a mile and a half)`. Here too the bracket may start on the next line,
but not after a blank line. The bracket can open
with a word such as `about`, but it has to hold nothing else, and the dimension has to
match: `2 metres (6 pounds)` still converts.

Inline markup on either value or on the bracket is read past: emphasis, code or an inline
HTML tag that closes on the first value, opens on the bracket or the second value, or wraps
the measurement inside the bracket. So `**1.8 metres** (6 feet)`,
`<b>1.8 metres</b> (6 feet)`, `1.8 metres *(6 feet)*` and `1.8 metres (*6 feet*)` are left
as they are. Where the bracket goes, markup that closes on the imperial value closes on the
metric one, and the bracket's own markup goes with it: `**6 feet** (1.8 m)` becomes
`**1.8 m**`, and `6 feet *(1.8 m)*` becomes `1.8 m`. Markup that opens on the bracket has to
close on it, or the bracket is not read. No change rewrites across an HTML tag, so
`<b>6 feet</b> (1.8 m)` is left as it is.

A `/` or `or` between the two values reads the same way as a bracket, by the same test of
agreement. `350°F/180°C` and `350°F or 180°C` become `180°C`, and
`Preheat to 350°F/180°C/gas 4` becomes `Preheat to 180°C/gas 4`. `180°C/350°F` and
`180°C or 350°F` are left as they are, and markup reads as it does with a bracket:
`**350°F**/180°C` becomes `**180°C**`. A pair can also offer two different measurements,
so the values have to agree with the metric one first too: `Cut 6 feet or 3 metres of rope`
becomes `Cut 1.8 metres or 3 metres of rope`, and `Cut 3 metres or 6 feet of rope` becomes
`Cut 3 metres or 1.8 metres of rope`. A slash with no figure after it is a rate, so
`5 gallons/minute` becomes `19 litres/minute`.

Measurements that are imperial worldwide are left alone: screens, wheels, pipes, vinyl,
drive bays, audio jacks and telescopes. `a 15 inch laptop` stays a 15 inch laptop, and so do
`a 2.5-inch SATA SSD`, `the 1/4-inch TRS jack`, `monitors of 27 inches` and
`wheels between 15 and 17 inches`, which name the thing first. So does a unit that is part
of a name, such as `the 40 yard line`, `the 26-mile marker` or `the 147-pound division`. A
range or dimension of them stays whole, so `bolts of ½-¾ inch`, `a 3/8" to 1/2" socket` and
`a 15" x 17" panel` are left exactly as written, with no piece of them converted on its own.
`units: { respectConventions: false }` converts all of them.

A distance or a position from such a thing is a measurement. `away`, `apart`, `off`,
`above`, `below`, `behind`, `beneath` or `from` straight after the size makes it one, so
`Place the monitor 20 inches from your eyes` becomes
`Place the monitor 51 centimetres from your eyes`. `from corner to corner` spans the thing
itself, so `The screen is 27 inches from corner to corner.` is left as written. `jack` and
`plug` name a thing only after its size, since before one they are verbs, so
`Plug the 2 inch hole` converts.

A shipping container of a standard length in feet, one of `10`, `20`, `40`, `45`, `48` and
`53`, is named by it, so `a 40-foot high-cube container` and `the twenty-foot equivalent unit`
are left as written, while `a 30-foot container` converts. An aviation altitude stays in feet beside `MSL`,
`AMSL`, `AGL`, `QNH` or `QFE`, or in a sentence with `flight level`, `cruising altitude` or a
service, absolute or cloud `ceiling`, so `35,000 feet MSL` is left as written. A room has a
ceiling too, so `a 10-foot ceiling` converts, and so does `The plane is 200 feet long.`

A unit word with a capital is part of a name when the next word has one too, or when the
next word that title case would capitalise does. So `Track 7 Miles Davis`,
`a 1983 Foot Locker ad` and the title `It is 10 Miles to Town` are left as written, whatever
`respectConventions` says, while `10 miles North of town` and `Walk 10 Miles` convert. A
capitalised singular after a number above one is a name whatever follows, so
`I watched 8 Mile last night.` is left as written, while `Walk 1 Mile` and `an 8 mile hike`
convert.

A number can be part of a name before it too. After `Model`, `Version`, `Route`, `Highway`,
`Interstate`, `Flight`, `Episode`, `Chapter` or `Room` it is a designation whatever its unit,
so `Route 66 miles from here.` is left as written, while `Season 2 pounds of pork.` and
`Track 3 miles a day.` convert. After any other capitalised word that does not open the
sentence, an abbreviation makes it one, since a quantity before an abbreviation rarely has a
name in front of it: `A Boeing 747 mph record.` is left as written, while `About 5 mph.` and
`Version 2 weighs 3 pounds.` convert. A labelled figure such as `Top Speed 155 mph` is left as
written too. A day or a month is no name, so `On Monday 40 mph gusts hit the coast.` and
`In March 40 mph winds are common.` convert, and nor is a figure grouped with a comma part of
one, so `Mount Everest 29,032 ft. is the summit.` converts. A version number with two figures
after its point, after any capitalised word and before `ft.` and a word that may open a noun
but is no plural in lower case, is a version and a credit, so `Python 3.12 ft. new syntax.` is
left as written, while `About 3.12 ft. of snow fell.` and `Cut 2.25 ft. lengths of pipe.`
convert. The name is left as written with its number, so no other rule rewrites it into words
that name nothing: `The Paycheck 5 lb bonus` stays as it is under `localise`.

Pounds of money are left alone, because British prose spells amounts out. A money word
such as `cost`, `paid`, `earns`, `worth` or `a fine of` claims the amount straight after
it, across at most a pronoun or a hedge: `It cost him nearly 500 pounds`. So do
`sterling`, a rate (`30,000 pounds a year`), pence (`5 pounds 50`) and a thing priced in
pounds (`a 10-pound note`). Pence may come before the preposition `in`, as in
`5 pounds 50 in total`, but `12 in.` and `12in` are inches and never pence, so
`The box is 5 pounds 12 in. wide.` becomes `The box is 2.3 kilograms 30 cm wide.` A money
word reaches only its own amount, so `It cost $20 for 5 pounds of beef` still converts.
A `£` reaches the whole sentence, but a
weight word in the measurement's own phrase (`lost`, `weighs`, `of beef`, `a 5-pound bag`)
outranks it. `lb` and `lbs` are never money, and `respectConventions: false` does not
convert money. An amount of money is held whole, as a conventional size is, so no other
rule rewrites any part of it.

An abbreviation's stop goes with it, so `It is 12 in. long.` becomes `It is 30 cm long.` and
`Add 5 lb. of beef.` becomes `Add 2.3 kg of beef.` The stop stays when it also ends the
sentence, as a time's does, so `The fence is 6 ft. It is new.` becomes
`The fence is 1.8 m. It is new.` Any capitalised word after the stop starts a new sentence,
a number in words included, and so does a date that starts with a figure, as
`1 December 2024` does, but a word in capitals does not, so `Buy a 6 ft. HDMI cable.`
becomes `Buy a 1.8 m HDMI cable.` The stop also stays as the first dot of an ellipsis, so
`The board is 12 in...` becomes `The board is 30 cm...`, while `It is 12 in.... long`
becomes `It is 30 cm... long`. Where a measurement collapses into its own metric value, the
stop is decided past that value, so `The bag weighs 2.2 lb. (1 kg) Then stir.` becomes
`The bag weighs 1 kg. Then stir.` and `The bag weighs 2.2 lb. (1 kg) of flour.` becomes
`The bag weighs 1 kg of flour.`

A spaced `in` with no stop after it is the preposition, so `There are 6 in total.` stays as
written. A spaced `in.` that ends the sentence is the particle of a verb that takes `in`
when that verb governs the count, across at most a word such as `only`, `another` or `the`.
The verbs are `let`, `put`, `bring`, `come`, `fit`, `squeeze`, `pack`, `invite`, `allow`,
`send` and `call`, in any form. So `The driver let only 3 in.` and `I put 2-3 in.` stay as
written, while `Trim the board to 12 in.` becomes `Trim the board to 30 cm.` and
`Put a 12 in. tile in the gap.` becomes `Put a 30 cm tile in the gap.`

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
`It starts at 3pm. Bring snacks.`, and as the first dot of an ellipsis, so `5 p.m...`
becomes `5pm...`. A time that runs on, as in `3 P.M. Tuesday`, `3 P.M. 5 March` or
`8 P.M. ET`, loses it. `times: { to24Hour: true }` gives `15:00` if you want it.
Amounts are never converted, because exchange rates move; a bare
`$500` becomes `US$500` when the text is American. 
A scale stays with the amount only as a whole word: `$5 million` and `$50k` become
`US$5 million` and `US$50k`, and the word after `$50 modernizing` is still respelt.
A `$` and one figure, with no decimal, comma or scale, is a variable rather than an amount
in a sentence about code: one that says `capture group`, `regex`, `regular expression`,
`replacement string`, `back-reference`, `script name`, `sed`, `awk`, `bash` or `perl`, or
names a variable such as `$HOME`, `${name}` or `$@`. Words that prices share, such as
`group` or `match`, are no sign, and nor is another figure, so `Swap $1 and $2 in sed.`
stays as written while `Group tickets cost $5.` becomes `Group tickets cost US$5.` and
`Kids pay $1 and adults pay $2.` becomes `Kids pay US$1 and adults pay US$2.`

**Punctuation** (`localise` only). House style rather than comprehension, so it waits to
be asked for. `U.S.` becomes `US`, and punctuation that is not part of a quotation moves
outside the closing quote.

Logical quoting moves only the stop or comma, so the quotation's last word is still
rewritten: `He said "The color is gray."` becomes `He said "The colour is grey".` A quote
mark with a letter or digit straight after it closes nothing, so `Acme Inc.'s` keeps its
stop.

An initialism keeps its last stop when that stop also ends the sentence or opens an
ellipsis, as a time does, so `She moved to the U.S. It was cold.` becomes
`She moved to the US. It was cold.` and `She moved to the U.K...` becomes
`She moved to the UK...` A
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
`a popsicle` becomes `an icy pole`. A word is read by its sound, so `a pickup truck`
becomes `a ute`. A converted number takes the article it is said with, so
`an 8 foot fence` becomes `a 2.4 metre fence` and `a 60 foot tree` becomes
`an 18 metre tree`. Eight, eleven and eighteen take `an`, and so does any figure whose
spoken form starts with one of them, such as `80`, `8.5`, `11,000` or `18 million`. A
temperature below zero takes `a`, for minus. A currency sign is said after its amount, so
`US$8` takes `an` as `$8` does. A date's day drops its leading zero
(`a 05/03/2024 deadline`) and a year is said in pairs (`an 1812-03-14 letter`). Where the
usual readings disagree, the article is left as it was: `1100` to `1199` and `1800` to
`1899` (one thousand eight hundred, or eighteen hundred), and a 24-hour time with a
leading zero other than `08:00` (`05:00` is oh five hundred to some readers and five to
others).

An article and its word share a paragraph. A single line break between them is a hard
wrap, so `Use an` at the end of one line still agrees with `eraser` at the start of the
next, but a blank line ends the paragraph and the article is left as it was. A capital
`A` counts as the article only where a capital is expected: at the start of the text, a
line, a list item, a heading or a table cell; after a sentence end or a colon, past any
closing quotes or brackets; straight after an opening quote, bracket or emphasis marker;
or between two capitalised words, as in a title or text in capitals. Anywhere else it is
a label, so `a Grade A eggplant` becomes `a Grade A aubergine` in `en-GB` and
`Hall A 60 foot ceiling` becomes `Hall A 18 metre ceiling`. A label is a single letter,
so `An` and `AN` are always the article, as a lower case `a` or `an` is.

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
`Bake at 350 and sell them at the bake sale.` does. Another temperature, in any unit a
setting takes or in any Celsius form the unit rules read, stops the search too, so the oven
in `Heat the oven to 180℃ or to 400F` is set by its first value and counts for nothing. A
setting has to be followed by its
unit (any Fahrenheit unit the temperature rule reads, a bare `F`, or a degree with no
scale, as in `350 deg F`, `a 350℉ oven` or `350 degrees`) or by the rest of the
instruction: punctuation, a joining word such as `for`, `until`, `till` or `before`, a
manner such as `uncovered`, a dash between clauses, or a cooking time such as
`20 minutes`. A quantity never follows it, so `in the oven for up to 300 minutes` has no
oven setting, and nor does `300 - 400 minutes`. A cup is no evidence at all,
since Australia and New Zealand cook in metric cups. A measured ingredient under a name
only Americans use, such as `1 cup all-purpose flour` or `2 tablespoons cornstarch`,
counts like any other vocabulary, unless the local name sits beside it, as it does in
`1 cup plain flour (all-purpose flour)`.

A temperature counts as `Fahrenheit` in exactly the forms the unit rules convert, so
`165 degrees F` counts, `Cook until the chicken reaches 165F` counts, and `Apartment 3F`
does not. The word `Fahrenheit` on its own counts too where it names the scale, as in
`Set the thermostat in Fahrenheit`, but not straight before a number, where it is part
of a title such as `Fahrenheit 451` or `Fahrenheit 9/11`. A Fahrenheit value that restates
the Celsius value before it, as in `Bake at 175°C (350°F)` or `180°C or 350°F`, is the
courtesy figure the unit rules leave as written, so neither it nor the word `Fahrenheit`
inside it counts. `Bake at 350°F (175°C)` converts and counts, and so does
`Heat to 180°C or 400°F`, where the two values disagree.

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
- **Structure.** URLs, email addresses, long command-line flags, inline code, fenced code
  blocks and HTML tags. A long flag is two hyphens and a letter at the start of a token, with
  any `=value` after it, so `--center`, `--color=gray` and `--label="dark gray"` are held in
  prose as well as in comments. Two hyphens straight after a word are a dash, so
  `the color--that is` is still rewritten.
  An @mention or a #hashtag is held where a token starts, so `Thanks @gray` and `#color`
  keep their spelling. A lone `@` or `#`, a Markdown heading and a hashtag with no letter,
  such as `#3`, are left to the rules. A Liquid, Jinja or Nunjucks tag on one line, such as
  `{% if favorite %}`, `{{ color }}` or `{# gray #}`, is held, and the text between two tags
  is prose. An emoji shortcode such as `:colorful:` is held when no letter, digit or colon
  touches it, so `1:2:3` and `std::color::gray` are not shortcodes.
  A CSS declaration in a sentence is held from its property name to the end of its value,
  which stops at a function word such as `and`, `to` or `the`, so
  `Set text-align: center to center it` keeps the first `center` and rewrites the second.
  A hyphenated name from a CSS property family, such as `text-align` or `background-color`,
  a vendor prefix or a custom property marks a declaration by itself. A bare name such as
  `color` or `border`, or any other hyphenated word, needs more: another declaration beside
  it, a value only CSS writes (a hex colour, a call, a length such as `2px`, or
  `!important`), a closing brace, or a semicolon that ends the line. So `Eye color: blue`
  and `a follow-up: color it` are still rewritten. A held declaration is held from every
  rule, so `max-width: 2in` keeps its inches.
  Inline code is paired the way CommonMark pairs it: a span closes on a run of as many
  backticks as opened it, so ``` ``a ` b`` ``` is one span, and it may wrap onto the next
  line of its paragraph. A backtick with no partner before the paragraph ends, or one
  escaped as `` \` ``, protects nothing. A fenced code block opens on a line that starts with
  three or more backticks or tildes and closes on a line of the same character at least as
  long, so a fence of four backticks can hold one of three. A fence that never closes runs to
  the end of the text. The `syntax` option says how the text is marked up:

  | `syntax` | |
  | --- | --- |
  | `'markdown'` | Fences as above, and indented code blocks and `pre`, `script`, `style` and `textarea` blocks and elements as CommonMark reads them, front matter, and `$` and `$$` maths |
  | `'text'` | No such fences, since a line of tildes underlines a heading in `.rst` or `.txt`: three backticks protect everything up to the next three |
  | none (default) | Fences as above, and an indented line is prose |

  An indented code block is a run of lines four or more columns past the content of the list
  item or quote it sits in, after a blank line or a block that is not a paragraph. A line
  indented that far inside a paragraph continues it, so a list item's wrapped line or second
  paragraph is still rewritten.

  A `pre`, `script`, `style` or `textarea` block starts on a line that opens with that tag,
  and runs to the end of the line that holds a closing tag of any of the four, blank lines
  included, or to the end of the list item or quote it sits in. CommonMark passes it through
  as raw HTML, so all of it is held, including text after the closing tag on its last line.

  Another HTML block, such as one opened by `<div align="center">` or `<details>` on a line
  of its own, runs to the next blank line. Inside it, each `pre`, `script`, `style` or
  `textarea` element is held from its opening tag to the next closing tag of the same name,
  or to the end of the block. The rest of that block, and HTML comments, hold text that is
  still rewritten, as is a tag in the middle of a sentence.

  Front matter is read as remark-frontmatter reads it: a `---` (YAML) or `+++` (TOML) line
  that opens the text, closed by the next line that repeats it. Its keys name layouts, URLs
  and tags, so it is held, except the value of a `title`, `description`, `summary`,
  `excerpt`, `subtitle`, `caption` or `alt` key that sits on the key's own line, which is
  rewritten inside any quotes. So `layout: color-page` stays as written and
  `title: "The color guide"` becomes `title: "The colour guide"`. A value that is a list, a
  block or a string over several lines is held. A text that opens with a `---` thematic break
  and has another `---` line further down is read as front matter, as remark-frontmatter
  reads it.

  Maths is read as Pandoc and GitHub read it. `$$` opens display maths, closed by the next `$$`.
  A single `$` with no space after it opens inline maths, closed by the next unescaped `$` with
  no space before it and no digit after it, so `$2^n$` and `$5x + 3 = 8$` are held while
  `$5 and $10` is two amounts. Neither may cross a blank line, and a code span or maths that
  opens first holds the other's delimiters.
- **TeX commands.** A backslash and the letters after it, such as `\centering` or `\color`,
  with the arguments of colour commands that name a colour, colour model or colour
  definition (`\color`, `\textcolor`, `\colorbox`, `\fcolorbox`, `\definecolor`, `\colorlet`,
  `\pagecolor`, `\rowcolor`, `\cellcolor` and `\columncolor`) and the environment that
  `\begin` and `\end` name. TeX knows each by one spelling. The text a command colours is
  prose, so `\textcolor{gray}{gray word}` becomes `\textcolor{gray}{grey word}`.
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
  after a number, or after a number and a degree sign, such as `300 lb.ft`, `32 ft/s/s` or
  `225°F/low/slow`, is a measurement.
- **Identifiers,** when `protectIdentifiers` is on (the default for source files):
  `normalizeInput`, `MAX_COLOR_VALUE`, `background-color`, `theme.colors.gray`,
  a one-hyphen flag such as `-color`, `getColor()`. An initialism, where every part is one or
  two letters followed by a stop, is not a dotted name, so `U.S.`, `Ph.D.` and `p.m.` in a
  comment are rewritten as they are in prose.
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

// A single unit, by key or by name: 'inch', 'inches' and 'in' all keep inches
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
- **risky**: a guess about what a word means. `tyre`, `cheque`, `autumn`, logical quoting,
  and the emergency number.

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

An s-expression puts its name after the bracket, so a line also reads as code when it opens
with a Lisp declaration or special form in lower case, such as `(defun`, `(setq`, `(let` or
`(when`, or when it opens or closes two of the same bracket at once, as `((color` and
`color))` do. A mixed pair, as in the citation `(see [1])`, counts for nothing.
`; (setq color 1)` and `;; (let ((color 1)) color)` are left alone, while
`; (See the color chart.)` is rewritten.

A call alone on a line, a name (dotted or not) straight against its bracket with nothing
after the bracket closes, reads as code: `// pick(color)` and `// render(color, size)` are
left alone. A bracket holding only a plural ending is prose, so `// color(s)` is rewritten.

A line that reads as code and leaves a bracket open opens a form, and every line up to the
one that closes it is left alone, however it reads by itself. That keeps the body of a
commented-out block whole, and the inside of a commented-out Lisp form:

```
// if (x) {                      <- left alone
//   paint the center            <- left alone, inside the block
// }                             <- left alone
```

Brackets of every kind count, but not those in a string or a character literal, such as
`"("`, `'('`, `?\(` and `#\(`, nor those in a line commented on top of a comment. A
closing bracket closes the innermost open bracket of its own kind, so the `)` of the
interval `[a, b)` closes nothing. A form may run to the end of the comment and no further.
One still open there holds no line beyond those that read as code by themselves.

A run of the marker that a language writes by convention is one marker, not two: `;;`,
`;;;` and `;;;;` in Lisp, `'''` in Visual Basic, `%%` and `%%%` in Erlang, MATLAB and
LaTeX, and `!!` in Fortran. So `;; Pick the color.` is rewritten, while `;;; ;; old note`,
`; ; old note` and `;;;;; old note` are still commented on top of a comment. Other repeats
are a second marker, so `//// the color` in TypeScript and `## the color` in Python are left
alone. `LexerSpec.markerRuns` sets these per language.

The costs are lopsided: a missed rewrite inside a commented-out block is invisible, while
a rewrite there is a broken build. The threshold is set accordingly, so the occasional
prose line that reads like code is left alone, such as `// (when ready, center it)` in any
language, and so are the lines up to the end of a parenthetical that such a line leaves
open. Outside a form it works line by line, so a block comment can hold prose and an
`@example` at once, and doc tags keep their operands: the name in `@param {string} color`
is protected while the description beside it is not.

Turn it off with `protectCommentedCode: false` or `--no-code-guard`.

### How a comment is read

A comment is read the way its author wrote it. A block comment is one text, and so is a run
of line comments on consecutive lines with the same marker at the same column. A comment
after code joins only the comments lined up beneath it. Each line's marker (`//`, `#`, `///`,
`//!`, `;;`) and the `*` that starts each line of a `/*` comment are taken out first, so the text
is Markdown: a line left holding only `//` or `*` is a blank line that ends a paragraph, a
backtick span or a fence may wrap from one line to the next, and an article that ends one
line agrees with the word that starts the next, but not with one after a blank line.

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
are handled as prose with `syntax: 'markdown'`, so indented code and `pre`, `script`,
`style` and `textarea` blocks are left alone, and the rest have only their comments touched.

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
  left alone too. Inside a sentence, a `span` or other inline element in such a font whose
  `white-space` keeps every space (`pre`, `pre-wrap` or `break-spaces`) is inline code: it
  ends the run, as `code` does, and the sentence around it still converts. A span that is only kept on one line
  with `nowrap` still joins the sentence, so on a monospace page
  `6 feet <span>2 inches</span>` held together that way converts as one measurement. The
  styles are read again once the page's stylesheets have loaded, and attributes are still
  rewritten.
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
| `syntax` | unknown | `markdown` or `text`: how code fences, indented code and HTML blocks are read |
| `unitsKeep` | `[]` | Units to leave alone, by key (`inch`, `square-foot`) or by name (`inches`, `in`), in any case |
| `units.precision` | `'natural'` | `natural`, `exact`, or a number of decimal places |
| `units.keepOriginal` | `false` | Write `1.8 metres (6 ft)` |
| `units.fuelEconomy` | `'l-per-100km'` | Or `km-per-l` |
| `units.respectConventions` | `true` | Leave screen sizes, yard lines, container lengths, altitudes and weight classes alone |
| `dates.format` | `'iso'` | `iso`, `dmy`, `long` |
| `dates.reorderLongDates` | `localise` only | `March 5, 2024` to `5 March 2024` |
| `times.to24Hour` | `false` | On gives `15:00` rather than `3pm` |
| `currency.mode` | `'annotate'` | Or `off` |
| `assumeAmerican` | inferred | Skip detection |
| `minAmericanConfidence` | `0.5` | The bar detection has to clear |

`units`, `dates`, `times` and `currency` each accept `false` to switch the category off.

A `dialect`, `preset` or `syntax` outside its list, or a `unitsKeep` entry that names no
unit, throws an `Error` that names the value and the ones it accepts, such as `Unknown
preset: Localise. Expected one of read, localise.` For a unit, those are the unit keys. It
throws even when there is no text to read, such as a source file with no comments or a page
with no prose. Only the ids in `DIALECTS` are dialects, so a name every object has, such as
`toString`, is rejected the same way. A `DomRewriter` whose `setOptions` throws keeps the
options it had and goes on following the page under them.

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
- A CSS declaration in a sentence is read from its shape. One with a bare property name and
  nothing else only CSS writes, as in `Set color: gray on it`, reads as a key and its value
  in prose, as `Eye color: gray` does, and is rewritten.
- Outside the remark plugin, the paragraph an inline code span may wrap within is found
  from its lines: a blank line, or a line that opens a heading, quote, list item, fence,
  rule or table row, ends it. A span that wraps onto the next `>` line of a block quote is
  therefore not protected. The remark plugin reads the real structure.
- Outside the remark plugin, a fence is read from its own lines, without the list items and
  quotes around it. A fence that a list item or quote ends without a closing line therefore
  runs on to the next line that would close it, or to the end of the text. A comment in a
  language that documents in Markdown is read that way, so a tilde heading underline in a
  reStructuredText block comment there leaves the text up to the next one as written.
- Outside the remark plugin, an indented code block, the contents of a `pre`, `script`,
  `style` or `textarea` block, front matter and maths are rewritten like the prose around
  them unless the text is known to be Markdown: a Markdown file, `syntax: 'markdown'`, or
  Prettier's Markdown parser.
  So `deamericaniseText` with no `syntax`, stdin without `--language md` or
  `--syntax markdown`, and comments rewrite them.
- Unit conversion is lossy at the default precision, by design. Use `precision: 'exact'`
  or `keepOriginal` where the numbers matter.
- A number that a hard wrap splits, such as `1` at the end of one line and `1/2 gallons` at
  the start of the next, or `two and a` then `half feet`, is not read as one. The fraction
  converts on its own and the written-out number is left as written. A web page is read the
  way it is usually laid out, with a line break in its source counting as a space.
- On a web page, a `span` inside a sentence that is set in a monospace font but wraps as
  usual, keeps only its line breaks (`pre-line`) or is only kept on one line (`nowrap`),
  with no `code` element or `role="code"` to mark it, is read as part of the sentence.
- `a third mile` is read as a fraction, though it can also mean one more mile after two.
  The same goes for `a fourth`, `an eighth` and `a sixteenth`.
- A word after a unit that is an adverb in one phrase and an adjective in another is always
  read the same way. `inside`, `outside` and `overhead` are adverbs, so `a 2 inch inside
  diameter` becomes `a 5.1 centimetres inside diameter`, and `round` describes a noun, so
  `a quarter mile round the bend` becomes `a 400 metre round the bend`. `a 2 pound cake` is
  left as written, because it may be a pound cake.
- A word ending in `s` after a drink is read by where the quantity stands, not by what the
  word means. Where the quantity is a subject, a plural food before an adjective or a comma
  reads as the drink's verb, so `Once 8 oz rum raisins soften, add them.` converts as fluid
  ounces. Elsewhere a word before a determiner reads as a verb, so
  `Soak 8 oz rum raisins the night before.` converts as fluid ounces too.
- Four figures after a preposition that takes a year are read by where the preposition
  stands. In the middle of a sentence they are converted before a unit word even where they
  are a year, so `Traffic grew in 2024 miles of road.` becomes
  `Traffic grew in 3257 kilometres of road.` Opening a sentence or clause they are left as
  written even where they are a quantity, as in `In 1500 feet of water, it lies.` and
  `Between 1500 and 2000 miles the road climbs.`
- A line that ends in a number and a line that opens with a unit word are read as one
  measurement, so `Track 7` above `Feet first` becomes `Track 2.1 metres first`. A
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
