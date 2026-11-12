import type { Range } from './apply.js';

/**
 * Front matter as remark-frontmatter reads it: a `---` (YAML) or `+++` (TOML) line that opens
 * the text, closed by the next line that repeats it. Either line may end in spaces or tabs.
 */
const FRONT_MATTER = /\uFEFF?(---|\+\+\+)[ \t]*\r?\n(?:[^\n]*\n)*?\1[ \t]*\r?(?=\n|$)/y;

/** Keys whose values are prose a reader sees, such as a page's title or an image's alt text. */
const PROSE_KEYS = 'title|description|summary|excerpt|subtitle|caption|alt';

/** A YAML prose key, nested or in a list item, up to where its value starts on the same line. */
const YAML_KEY = new RegExp(String.raw`^[ \t]*(?:-[ \t]+)*(?:${PROSE_KEYS})[ \t]*:[ \t]+(?=\S)`, 'i');

const TOML_KEY = new RegExp(String.raw`^[ \t]*(?:${PROSE_KEYS})[ \t]*=[ \t]*(?=\S)`, 'i');

/** A string that closes on its own line, with nothing after it but a comment. */
const YAML_STRING = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')[ \t]*(?:#|\r?$)/;

/** Triple quotes open a string that may run over several lines, so are never read as one line. */
const TOML_STRING = /^(?!"""|''')(?:"((?:[^"\\]|\\.)*)"|'([^']*)')[ \t]*(?:#|\r?$)/;

/** What starts a YAML list, map, block, anchor, tag or quoted string that runs on. */
const YAML_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Where the value of a prose key sits in a line of front matter, inside any quotes. */
function proseValue(line: string, toml: boolean): Range | undefined {
  const key = (toml ? TOML_KEY : YAML_KEY).exec(line);
  if (!key) return undefined;
  const at = key[0].length;
  const rest = line.slice(at);
  const quoted = (toml ? TOML_STRING : YAML_STRING).exec(rest);
  if (quoted) {
    const value = quoted[1] ?? quoted[2] ?? '';
    return { start: at + 1, end: at + 1 + value.length };
  }
  if (toml || YAML_INDICATOR.test(rest)) return undefined;
  const comment = rest.search(/[ \t]#/);
  return { start: at, end: at + (comment === -1 ? rest : rest.slice(0, comment)).trimEnd().length };
}

/**
 * Holds the front matter that opens a Markdown document. Its keys name layouts, URLs and
 * taxonomies, so only the value of a prose key on its own line is rewritten, inside any quotes.
 * Returns where the front matter ends, or 0 when the text opens with none.
 */
export function collectFrontMatter(text: string, into: Range[]): number {
  FRONT_MATTER.lastIndex = 0;
  const block = FRONT_MATTER.exec(text);
  if (!block) return 0;
  const end = block[0].length;
  const toml = block[1] === '+++';
  let held = 0;
  for (let offset = text.indexOf('\n') + 1; offset < end; ) {
    const next = text.indexOf('\n', offset);
    const lineEnd = next === -1 ? end : Math.min(next, end);
    const value = proseValue(text.slice(offset, lineEnd), toml);
    if (value) {
      into.push({ start: held, end: offset + value.start });
      held = offset + value.end;
    }
    offset = lineEnd + 1;
  }
  into.push({ start: held, end });
  return end;
}
