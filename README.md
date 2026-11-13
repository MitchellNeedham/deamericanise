# deamericanise

Rewrites American English into the version the rest of the world reads. Spelling,
units, dates, times and currency. Point it at a source file and it rewrites only the
comments, leaving code, strings, identifiers and commented-out code alone.

[**Try it in your browser**](https://mitchellneedham.github.io/deamericanise/): paste text
or drop a file, and every change is highlighted and explained. It runs the package itself
client-side, so nothing you type is uploaded.

## Install

```sh
npm install deamericanise
```

## Usage

```sh
deamericanise README.md            # print the result
deamericanise --write src/ docs/   # rewrite in place
deamericanise --diff notes.md      # show what would change
deamericanise --check .            # exit 1 if anything would change (CI)
deamericanise --localise recipe.md # also swap vocabulary for local words
```

```ts
import { deamericanise, deamericaniseText, deamericaniseCode } from 'deamericanise';

deamericaniseText('The color of the theater was gray.');
// 'The colour of the theatre was grey.'

deamericaniseText('It is 6 feet 2 inches wide. Bake at 350°F on 3/14/2024.');
// 'It is 1.88 metres wide. Bake at 175°C on 2024-03-14.'

deamericaniseCode('const color = "color"; // set the color', { language: 'ts' }).text;
// 'const color = "color"; // set the colour'

deamericanise('They canceled it.').changes;
// [{ start: 5, end: 13, before: 'canceled', after: 'cancelled', ruleId: 'spelling.double-l', ... }]
```

## Two modes

**`read`** (default) makes the text readable without changing what it is about: spelling,
units, dates, times, currency. An article about America keeps its sidewalks, its gas
stations and its 911, and house style such as `Mr.` is left alone.

**`localise`** also swaps the content for local equivalents, and applies local house
style. That is the mode for a recipe you are going to cook from.

```ts
deamericaniseText('Add a bell pepper, then call 911.');
// 'Add a bell pepper, then call 911.'

deamericaniseText('Add a bell pepper, then call 911.', { preset: 'localise' });
// 'Add a capsicum, then call 000.'
```

## Common options

```ts
deamericaniseText(text, {
  dialect: 'en-GB',                    // en-AU (default), en-GB, en-NZ, en-IE, en-ZA, en-CA
  preset: 'localise',                  // read (default) or localise
  confidence: ['safe', 'moderate'],    // drop the rules that guess at meaning
  categories: { units: false },        // beats the preset
  rules: { 'spelling.contextual.*': false },
  protect: ['Color', /Acme [A-Z]\w+/], // never rewrite these
  units: { keepOriginal: true },       // '1.8 metres (6 feet)'
});
```

## Integrations

```js
import remarkDeamericanise from 'deamericanise/remark';   // unified().use(remarkDeamericanise)
import deamericanise from 'deamericanise/eslint';         // rule: deamericanise/comments
import { deamericaniseDom } from 'deamericanise/dom';      // deamericaniseDom(document)
// prettier.config.js: plugins: ['deamericanise/prettier']
```

## Browser extension

`extension/` is an extension for Chrome, Edge and Firefox that rewrites the pages you visit
as they load, before the text is painted. Everything runs on your machine. Switch on
highlighting from the toolbar button to see each change and the rule that made it, and to
switch that rule off. The settings page switches whole categories on or off, and fine-tunes
each one. It can also underline what it would change in a text box or editor as you type.
Click an underline to replace it. Your text changes only when you choose Replace.

```sh
npm run build:extension   # writes extension/dist/chrome and extension/dist/firefox
```

In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, turn on Developer
mode and load `extension/dist/chrome` unpacked. In Firefox, open
`about:debugging#/runtime/this-firefox` and load `extension/dist/firefox/manifest.json` as
a temporary add-on.

Full rule list, dialect tables, supported languages and every option:
[REFERENCE.md](./REFERENCE.md). Or run `deamericanise --help`.

## Licence

MIT
