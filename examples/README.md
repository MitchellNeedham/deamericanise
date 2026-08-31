# Examples

Real American text, and what `deamericanise` does to it. Each `*.md` is the source and
each `*.deamericanised.md` is the result, with every change in **bold** and a table at
the bottom naming the rule behind each one.

| Source | Mode | What it shows |
| --- | --- | --- |
| [extreme-heat.md](./extreme-heat.md) | `read` | Fahrenheit, and the `-ize` and `-our` spellings |
| [bear-safety.md](./bear-safety.md) | `read` | Yards and feet, and the sense-dependent spellings |
| [anemia.md](./anemia.md) | `read` | Medical prose, where the `ae` and `oe` digraphs carry it |
| [apollo.md](./apollo.md) | `read` | Miles and altitudes, in a mission that stays American |
| [fasteners.md](./fasteners.md) | `read` | Bolt sizes in inches, which are names and must not move |
| [aluminum.md](./aluminum.md) | `read` | The metal, and tons the document says are already metric |
| [fuel-tips.md](./fuel-tips.md) | `localise` | `gas` meaning petrol, without touching the other senses |
| [cookbook.md](./cookbook.md) | `localise` | A 1919 recipe: cups and pounds, written out in words |
| [storm-reports.md](./storm-reports.md) | `read` | An ambiguous date, resolved by how American the prose is |
| [recalls.md](./recalls.md) | `read` | American prose whose numeric dates are day-first |
| [flood-safety.md](./flood-safety.md) | `localise` | The emergency number and the vocabulary move too |

Most run in the default `read` mode, which fixes what stops a non-American reading the
text and leaves the subject matter alone. `flood-safety.md` and `cookbook.md` use
`localise`, because they are things you would act on rather than read, so `911` becoming
`000` is the point rather than a mistake.

`storm-reports.md` and `recalls.md` are a matched pair, and worth reading together. Both
contain ambiguous numeric dates. The storm reports score 90% American, so `4/3/2024`
becomes `2024-04-03`. The recall records write their numeric dates day-first, so
`12/08/2022` is left alone. Same rule, opposite outcomes, decided by the evidence in each
document rather than by a guess.

Three of them are worth reading for what does *not* change. `recalls.md` is the sharpest:
it is US government prose, it says `aluminum`, and it writes its named dates the American
way round, but the numeric dates in its data are day-first. A tool that scored the whole
document and then rewrote every date would turn `12/08/2022` into 8 December. The numeric
dates settle their own order, so all five are left exactly as they are. `aluminum.md` opens by saying
its figures are in metric tons, so the tonnages are left alone even though `aluminum`
itself is corrected. `bear-safety.md` already gives its own metric conversions, so the
imperial half is dropped rather than a second conversion being invented.

## Sources

All but one are works of the United States federal government, in the public domain and
not subject to copyright under 17 U.S.C. section 105: the National Weather Service, the
National Park Service, MedlinePlus, NASA and the United States Geological Survey.
Government writing is both freely reusable and about as American as prose gets.

`cookbook.md` is from a 1919 cookbook published before 1929, so it is in the public
domain too. Each file names its source at the bottom.

Anything added here should clear the same bar. Most articles and recipes on the web are
copyrighted, and this directory ships in a public repository.

## Regenerating

The output changes whenever the rules do, so it is generated rather than written:

```sh
npm run build
npm run examples
```
