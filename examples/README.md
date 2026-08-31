# Examples

Real American text, and what `deamericanise` does to it. Each `*.md` is the source and
each `*.deamericanised.md` is the result, with every change in **bold** and a table at
the bottom naming the rule behind each one.

| Source | Mode | What it shows |
| --- | --- | --- |
| [extreme-heat.md](./extreme-heat.md) | `read` | Fahrenheit, and the `-ize` and `-our` spellings |
| [bear-safety.md](./bear-safety.md) | `read` | Yards and feet, and the sense-dependent spellings |
| [anemia.md](./anemia.md) | `read` | Medical prose, where the `ae` and `oe` digraphs carry it |
| [flood-safety.md](./flood-safety.md) | `localise` | The emergency number and the vocabulary move too |

Three of the four run in the default `read` mode, which fixes what stops a non-American
reading the text and leaves the subject matter alone. `flood-safety.md` uses `localise`,
because it is advice you would act on rather than an article you would read, so `911`
becoming `000` is the point rather than a mistake.

## Sources

All four are works of the United States federal government, in the public domain and not
subject to copyright under 17 U.S.C. section 105. Each names its source at the bottom.
They come from the National Weather Service, the National Park Service and MedlinePlus,
chosen because government writing is both freely reusable and about as American as prose
gets.

Anything added here should clear the same bar. Most articles and recipes on the web are
copyrighted, and this directory ships in a public repository.

## Regenerating

The output changes whenever the rules do, so it is generated rather than written:

```sh
npm run build
npm run examples
```
