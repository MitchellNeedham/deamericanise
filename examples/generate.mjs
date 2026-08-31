#!/usr/bin/env node
// Regenerates every *.deamericanised.md from its source. Run after changing any rule:
//   npm run build && node examples/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deamericanise } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Which mode suits each document, and why. */
const EXAMPLES = [
  {
    file: 'extreme-heat.md',
    preset: 'read',
    note: 'An American article stays about America. Only the spellings and the measurements move.',
  },
  {
    file: 'bear-safety.md',
    preset: 'read',
    note: 'Distances and temperatures, in a document that already carries its own metric conversions.',
  },
  {
    file: 'anemia.md',
    preset: 'read',
    note: 'Medical prose, where the ae and oe digraphs do the work rather than the units.',
  },
  {
    file: 'truck-review.md',
    preset: 'localise',
    note: 'A car review, where the vocabulary matters as much as the torque figures.',
  },
  {
    file: 'flood-safety.md',
    preset: 'localise',
    note: 'Advice you would act on, so the emergency number and the vocabulary move too.',
  },
];

/**
 * Wraps each rewritten span in bold. Offsets index the source, not the result, so the
 * marked-up version has to be rebuilt from the source rather than from the output.
 */
function highlight(source, changes) {
  let out = '';
  let cursor = 0;
  for (const change of changes) {
    out += source.slice(cursor, change.start) + `**${change.after}**`;
    cursor = change.end;
  }
  return out + source.slice(cursor);
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
  return line;
}

const cell = (s) => `\`${s.replace(/\|/g, '\\|').replace(/\n/g, ' ')}\``;

for (const { file, preset, note } of EXAMPLES) {
  const source = readFileSync(join(here, file), 'utf8');
  const { changes, signals } = deamericanise(source, { preset });

  const rows = changes.map(
    (c) => `| ${lineOf(source, c.start)} | ${cell(c.before)} | ${cell(c.after)} | \`${c.ruleId}\` | ${c.confidence} |`,
  );

  const out = [
    `> Generated from [${file}](./${file}) by [deamericanise](https://www.npmjs.com/package/deamericanise).`,
    `> Preset \`${preset}\`, dialect \`en-AU\`, ${changes.length} changes. Every change is in **bold**.`,
    `>`,
    `> ${note}`,
    `>`,
    `> The text read ${(signals.confidence * 100).toFixed(0)}% American` +
      (signals.markers.length ? ` (${signals.markers.join(', ')}).` : '.'),
    '',
    highlight(source, changes),
    '## What changed',
    '',
    '| Line | Before | After | Rule | Confidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

  const target = file.replace(/\.md$/, '.deamericanised.md');
  writeFileSync(join(here, target), out);
  console.log(`${target.padEnd(34)} ${String(changes.length).padStart(3)} changes  [${preset}]`);
}
