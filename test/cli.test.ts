import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { build } from 'tsup';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli-main.js';
import { DIALECTS } from '../src/dialects/index.js';
import { ruleIds } from '../src/rules/catalogue.js';
import type { Dialect } from '../src/types.js';

// The CLI must report the version the package was built with, never a literal of its own.
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const stdout = () => out.join('');
const stderr = () => err.join('');

function withDirectory(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'deamericanise-'));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents, 'utf8');
  return directory;
}

function withFile(name: string, contents: string): string {
  return join(withDirectory({ [name]: contents }), name);
}

function withStdin(text: string): void {
  const stream = Object.assign(Readable.from([Buffer.from(text)]), { isTTY: false });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin);
}

describe('informational flags', () => {
  it.each`
    flag                  | contains
    ${'--help'}           | ${'rewrite American English'}
    ${'--version'}        | ${version}
    ${'--list-dialects'}  | ${'en-AU'}
    ${'--list-rules'}     | ${'spelling.our'}
  `('$flag prints something containing "$contains"', async ({ flag, contains }) => {
    expect(await main([flag])).toBe(0);
    expect(stdout()).toContain(contains);
  });
});

describe('reading a file', () => {
  it('prints the rewritten text by default', async () => {
    const path = withFile('a.md', 'The color of the theater.');
    expect(await main([path])).toBe(0);
    expect(stdout()).toBe('The colour of the theatre.');
  });

  it('rewrites in place with --write', async () => {
    const path = withFile('a.md', 'The color.');
    expect(await main(['--write', path])).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('The colour.');
    expect(stdout()).toContain('1 change');
  });

  it('only touches comments in a source file', async () => {
    const path = withFile('a.ts', 'const color = "color"; // the color\n');
    await main(['--write', path]);
    expect(readFileSync(path, 'utf8')).toBe('const color = "color"; // the colour\n');
  });

  it('shows a line diff with --diff', async () => {
    const path = withFile('a.md', 'one\nThe color.\nthree');
    await main(['--diff', path]);
    expect(stdout()).toContain('- The color.');
    expect(stdout()).toContain('+ The colour.');
    expect(stdout()).not.toContain('one');
  });

  it('lists rules and positions with --explain', async () => {
    const path = withFile('a.md', 'The color.');
    await main(['--explain', path]);
    expect(stdout()).toContain('spelling.our');
    expect(stdout()).toContain('color -> colour');
  });

  it('emits machine-readable changes with --json', async () => {
    const path = withFile('a.md', 'The color.');
    await main(['--json', path]);
    const parsed = JSON.parse(stdout()) as { changes: Array<{ before: string; after: string }> };
    expect(parsed.changes[0]).toMatchObject({ before: 'color', after: 'colour' });
  });
});

describe('--check is the CI mode', () => {
  it.each`
    contents             | code | why
    ${'The color.'}      | ${1} | ${'a change is needed'}
    ${'The colour.'}     | ${0} | ${'nothing to do'}
  `('exits $code when the file is "$contents" ($why)', async ({ contents, code }) => {
    const path = withFile('a.md', contents as string);
    expect(await main(['--check', path])).toBe(code);
    expect(stdout()).toBe('');
  });
});

describe('rule selection from the command line', () => {
  it.each`
    args                                          | input                        | expected
    ${['--dialect', 'en-GB', '--localise']}       | ${'the sidewalk'}            | ${'the pavement'}
    ${['--dialect', 'en-AU', '--localise']}       | ${'the sidewalk'}            | ${'the footpath'}
    ${['--dialect', 'en-AU']}                     | ${'the sidewalk'}            | ${'the sidewalk'}
    ${['-l']}                                     | ${'a bell pepper'}           | ${'a capsicum'}
    ${['--preset', 'localise']}                   | ${'call 911'}                | ${'call 000'}
    ${['--preset', 'read']}                       | ${'call 911'}                | ${'call 911'}
    ${['--off', 'units']}                         | ${'6 feet'}                  | ${'6 feet'}
    ${['--only', 'spelling', '--localise']}       | ${'the color sidewalk'}      | ${'the colour sidewalk'}
    ${['--confidence', 'safe']}                   | ${'a flat tire'}             | ${'a flat tire'}
    ${['--rule', 'spelling.our=false']}           | ${'the color center'}        | ${'the color centre'}
    ${['--rule', 'spelling.*=false']}             | ${'the color center'}        | ${'the color center'}
    ${['--protect', 'color']}                     | ${'the color center'}        | ${'the color centre'}
    ${['--keep-original']}                        | ${'6 feet'}                  | ${'1.8 metres (6 feet)'}
    ${['--precision', 'exact']}                   | ${'6 feet'}                  | ${'1.8288 metres'}
    ${['--units-keep', 'foot']}                   | ${'6 feet'}                  | ${'6 feet'}
    ${['--assume-american']}                      | ${'due 03/04/2024'}          | ${'due 2024-03-04'}
  `('$args turns "$input" into "$expected"', async ({ args, input, expected }) => {
    const path = withFile('a.md', input as string);
    await main([...(args as string[]), path]);
    expect(stdout()).toBe(expected);
  });
});

describe('bad input', () => {
  it.each`
    args                              | message
    ${['--dialect', 'en-XX']}         | ${'unknown dialect'}
    ${['--preset', 'nonsense']}       | ${'unknown preset'}
    ${['--off', 'nonsense']}          | ${'unknown category'}
    ${['--confidence', 'maybe']}      | ${'unknown confidence'}
    ${['--precision', 'half']}        | ${'--precision expects'}
  `('$args reports "$message"', async ({ args, message }) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);
    await expect(main(args as string[])).rejects.toThrow('exited');
    expect(stderr()).toContain(message);
    exit.mockRestore();
  });
});

describe('--dialect', () => {
  const UNKNOWN = ['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'en-XX'];

  function exits(): void {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exited ${code}`);
    }) as never);
  }

  it.each(UNKNOWN)('rejects --dialect %s with exit 2 before reading anything', async (dialect) => {
    exits();
    const path = withFile('a.md', 'The color.');
    await expect(main(['--write', '--dialect', dialect, path])).rejects.toThrow('exited 2');
    expect(stderr()).toBe(`deamericanise: unknown dialect "${dialect}". Try --list-dialects.\n`);
    expect(readFileSync(path, 'utf8')).toBe('The color.');
    expect(stdout()).toBe('');
  });

  it('rejects a bad --dialect before reading stdin', async () => {
    exits();
    const stdin = vi.fn();
    vi.spyOn(process, 'stdin', 'get').mockImplementation(stdin);
    await expect(main(['--language', 'md', '--dialect', '__proto__'])).rejects.toThrow('exited 2');
    expect(stdin).not.toHaveBeenCalled();
  });

  it.each(UNKNOWN)('rejects --list-rules --dialect %s in the same words', async (dialect) => {
    exits();
    await expect(main(['--list-rules', '--dialect', dialect])).rejects.toThrow('exited 2');
    expect(stderr()).toBe(`deamericanise: unknown dialect "${dialect}". Try --list-dialects.\n`);
    expect(stdout()).toBe('');
  });

  it.each(Object.keys(DIALECTS))('runs under --dialect %s', async (dialect) => {
    const path = withFile('a.md', 'the color');
    expect(await main(['--dialect', dialect, path])).toBe(0);
    expect(stdout()).toBe('the colour');
  });

  it.each(Object.keys(DIALECTS))('lists the rules of --dialect %s', async (dialect) => {
    expect(await main(['--list-rules', '--dialect', dialect])).toBe(0);
    expect(stdout()).toBe(ruleIds(dialect as Dialect).map((id) => `${id}\n`).join(''));
  });

  it('lists the en-AU rules with no --dialect', async () => {
    expect(await main(['--list-rules'])).toBe(0);
    expect(stdout()).toBe(ruleIds('en-AU').map((id) => `${id}\n`).join(''));
  });

  it('still prints the dialects alongside an unknown --dialect', async () => {
    expect(await main(['--list-dialects', '--dialect', 'toString'])).toBe(0);
    expect(stdout()).toContain('en-AU\tAustralian English\n');
  });
});

describe('choosing which files to read', () => {
  const json = '{ "color": "gray" }\n';

  it('skips a named file of unknown type and says so on stderr', async () => {
    const path = withFile('settings.json', json);
    expect(await main([path])).toBe(0);
    expect(stdout()).toBe('');
    expect(stderr()).toContain(`skipping ${path}`);
    expect(stderr()).toContain('--language md');
  });

  it('never writes a skipped file', async () => {
    const path = withFile('settings.json', json);
    expect(await main(['--write', path])).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(json);
    expect(stdout()).toBe('');
  });

  it.each`
    prose              | code | why
    ${'The color.'}    | ${1} | ${'the prose file needs a change'}
    ${'The colour.'}   | ${0} | ${'the skipped file does not count'}
  `('--check exits $code beside a skipped file when $why', async ({ prose, code }) => {
    const skipped = withFile('settings.json', json);
    const read = withFile('a.md', prose as string);
    expect(await main(['--check', skipped, read])).toBe(code);
    expect(stderr()).toContain(`skipping ${skipped}`);
  });

  it('reads nothing from stdin when every named file is skipped', async () => {
    withStdin('The color.');
    expect(await main(['--check', withFile('settings.json', json)])).toBe(0);
    expect(await main([withFile('settings.json', json)])).toBe(0);
    expect(stdout()).toBe('');
  });

  it.each(['README', 'CHANGELOG', 'CHANGES', 'HISTORY', 'NEWS', 'CONTRIBUTING', 'readme'])(
    'reads %s as prose by name',
    async (name) => {
      expect(await main([withFile(name, 'The color.')])).toBe(0);
      expect(stdout()).toBe('The colour.');
    },
  );

  it.each(['LICENSE', 'LICENCE', 'COPYING', 'AUTHORS', 'script', 'yarn.lock', 'data.csv'])(
    'skips %s',
    async (name) => {
      const path = withFile(name, 'The color.');
      expect(await main(['--write', path])).toBe(0);
      expect(readFileSync(path, 'utf8')).toBe('The color.');
      expect(stderr()).toContain(`skipping ${path}`);
    },
  );

  it('reads a named file of unknown type as prose with --language md', async () => {
    const path = withFile('NOTES', 'The color.');
    expect(await main(['--language', 'md', path])).toBe(0);
    expect(stdout()).toBe('The colour.');
    expect(stderr()).toBe('');
  });

  it('walks past unknown files in a directory without a word', async () => {
    const directory = withDirectory({ 'a.md': 'The color.', CHANGELOG: 'The color.', 'settings.json': json });
    expect(await main(['--write', directory])).toBe(0);
    expect(readFileSync(join(directory, 'a.md'), 'utf8')).toBe('The colour.');
    expect(readFileSync(join(directory, 'CHANGELOG'), 'utf8')).toBe('The colour.');
    expect(readFileSync(join(directory, 'settings.json'), 'utf8')).toBe(json);
    expect(stderr()).toBe('');
  });

  it('still reads stdin with --language', async () => {
    withStdin('The color.');
    expect(await main(['--language', 'md'])).toBe(0);
    expect(stdout()).toBe('The colour.');
  });
});

describe('--language', () => {
  function exits(): void {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exited ${code}`);
    }) as never);
  }

  it.each(['nosuchlang', '', 'settings.json'])(
    'rejects "%s" on stdin with exit 2 and a pointer to --list-languages',
    async (language) => {
      exits();
      withStdin('The color.');
      await expect(main(['--language', language])).rejects.toThrow('exited 2');
      expect(stderr()).toBe(`deamericanise: unknown language "${language}". Try --list-languages.\n`);
      expect(stdout()).toBe('');
    },
  );

  it.each(['settings.json', 'a.md', 'a.ts'])('rejects an unknown value before touching %s', async (name) => {
    exits();
    const path = withFile(name, 'The color.');
    await expect(main(['--write', '--language', 'nosuchlang', path])).rejects.toThrow('exited 2');
    expect(readFileSync(path, 'utf8')).toBe('The color.');
    expect(stderr()).toContain('unknown language "nosuchlang"');
    expect(stdout()).toBe('');
  });

  it.each`
    language        | input                            | expected
    ${'python'}     | ${'x = "gray" # the color\n'}    | ${'x = "gray" # the colour\n'}
    ${'ruby'}       | ${'x = "gray" # the color\n'}    | ${'x = "gray" # the colour\n'}
    ${'shell'}      | ${'x="gray" # the color\n'}      | ${'x="gray" # the colour\n'}
    ${'golang'}     | ${'x := "gray" // the color\n'}  | ${'x := "gray" // the colour\n'}
    ${'Dockerfile'} | ${'ENV X=gray # the color\n'}    | ${'ENV X=gray # the colour\n'}
    ${'ts'}         | ${'x = "gray"; // the color\n'}  | ${'x = "gray"; // the colour\n'}
    ${'.ts'}        | ${'x = "gray"; // the color\n'}  | ${'x = "gray"; // the colour\n'}
    ${'py'}         | ${'x = "gray" # the color\n'}    | ${'x = "gray" # the colour\n'}
    ${'jsonc'}      | ${'{"color": 1} // the color\n'} | ${'{"color": 1} // the colour\n'}
    ${'md'}         | ${'x = "gray" # the color\n'}    | ${'x = "grey" # the colour\n'}
    ${'MD'}         | ${'x = "gray" # the color\n'}    | ${'x = "grey" # the colour\n'}
    ${'txt'}        | ${'x = "gray" # the color\n'}    | ${'x = "grey" # the colour\n'}
  `('reads stdin as $language', async ({ language, input, expected }) => {
    withStdin(input as string);
    expect(await main(['--language', language as string])).toBe(0);
    expect(stdout()).toBe(expected);
    expect(stderr()).toBe('');
  });

  it.each`
    language    | name           | input                           | expected
    ${'python'} | ${'notes.txt'} | ${'x = "gray" # the color\n'}   | ${'x = "gray" # the colour\n'}
    ${'ruby'}   | ${'script'}    | ${'x = "gray" # the color\n'}   | ${'x = "gray" # the colour\n'}
    ${'md'}     | ${'a.ts'}      | ${'x = "gray"; // the color\n'} | ${'x = "grey"; // the colour\n'}
    ${'ts'}     | ${'a.py'}      | ${'x = "gray"; // the color\n'} | ${'x = "gray"; // the colour\n'}
  `('forces $name through $language', async ({ language, name, input, expected }) => {
    const path = withFile(name as string, input as string);
    expect(await main(['--write', '--language', language as string, path])).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(expected);
    expect(stderr()).toBe('');
  });

  it('reads only the comments of JSON, so plain JSON is left alone', async () => {
    const plain = withFile('settings.json', '{ "color": "gray" }\n');
    const commented = withFile('tsconfig.json', '{\n  // the color\n  "color": "gray"\n}\n');
    expect(await main(['--write', '--language', 'json', plain, commented])).toBe(0);
    expect(readFileSync(plain, 'utf8')).toBe('{ "color": "gray" }\n');
    expect(readFileSync(commented, 'utf8')).toBe('{\n  // the colour\n  "color": "gray"\n}\n');
  });

  it('reads JSON on stdin the same way', async () => {
    withStdin('{"color":"gray"}');
    expect(await main(['--language', 'json'])).toBe(0);
    expect(stdout()).toBe('{"color":"gray"}');
  });

  it('still skips a .json file named without --language', async () => {
    const path = withFile('settings.json', '{ "color": "gray" }\n');
    expect(await main(['--write', path])).toBe(0);
    expect(stderr()).toContain(`skipping ${path}`);
  });

  it('--list-languages prints every value --language accepts', async () => {
    expect(await main(['--list-languages'])).toBe(0);
    const names = stdout().trimEnd().split('\n');
    for (const name of ['md', 'markdown', 'txt', 'json', 'jsonc', 'python', 'ruby', 'ts']) expect(names).toContain(name);
    expect(names).toEqual([...names].sort());
  });
});

describe('--syntax', () => {
  const indented = 'Set the theme:\n\n    color = "gray";\n';
  const kept = indented;
  const rewritten = 'Set the theme:\n\n    colour = "grey";\n';
  const rst = 'Colors\n~~~~~~\n\nThe color of things.\n';

  it.each`
    args                                           | input       | expected
    ${[]}                                          | ${indented} | ${rewritten}
    ${['--syntax', 'markdown']}                    | ${indented} | ${kept}
    ${['--language', 'md']}                        | ${indented} | ${kept}
    ${['--language', 'md', '--syntax', 'text']}    | ${indented} | ${rewritten}
    ${[]}                                          | ${rst}      | ${'Colours\n~~~~~~\n\nThe colour of things.\n'}
    ${['--syntax', 'markdown']}                    | ${rst}      | ${'Colours\n~~~~~~\n\nThe color of things.\n'}
  `('reads stdin with $args', async ({ args, input, expected }) => {
    withStdin(input as string);
    expect(await main(args as string[])).toBe(0);
    expect(stdout()).toBe(expected);
  });

  it('applies to a named prose file too', async () => {
    const path = withFile('notes.txt', indented);
    expect(await main(['--write', '--syntax', 'markdown', path])).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(kept);
  });

  it('rejects an unknown value with exit 2', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exited ${code}`);
    }) as never);
    withStdin('The color.');
    await expect(main(['--syntax', 'md'])).rejects.toThrow('exited 2');
    expect(stderr()).toBe('deamericanise: unknown syntax "md". Known: markdown, text\n');
    expect(stdout()).toBe('');
  });
});

describe('--rule and --units-keep', () => {
  function exits(): void {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exited ${code}`);
    }) as never);
  }

  it.each`
    args                                                       | id
    ${['--rule', 'spelling.ourr=false']}                       | ${'spelling.ourr'}
    ${['--rule', 'spellingg.*=false']}                         | ${'spellingg.*'}
    ${['--rule', 'spelling.our.*=false']}                      | ${'spelling.our.*'}
    ${['--rule', 'units.length=false']}                        | ${'units.length'}
    ${['--rule', 'spelling.our', '--rule', 'nope=true']}       | ${'nope'}
    ${['--dialect', 'en-CA', '--rule', 'dialect.en-US=false']} | ${'dialect.en-US'}
  `('rejects $args with exit 2 before reading anything', async ({ args, id }) => {
    exits();
    const path = withFile('a.md', 'The color.');
    await expect(main(['--write', ...(args as string[]), path])).rejects.toThrow('exited 2');
    expect(stderr()).toBe(`deamericanise: unknown rule "${id}". Try --list-rules.\n`);
    expect(readFileSync(path, 'utf8')).toBe('The color.');
    expect(stdout()).toBe('');
  });

  it.each`
    args                                                                | value           | entry
    ${['--rule', 'spelling.our=flase']}                                 | ${'flase'}      | ${'spelling.our=flase'}
    ${['--rule', 'spelling.our=']}                                      | ${''}           | ${'spelling.our='}
    ${['--rule', 'spelling.*=nope']}                                    | ${'nope'}       | ${'spelling.*=nope'}
    ${['--rule', 'spelling.our=2']}                                     | ${'2'}          | ${'spelling.our=2'}
    ${['--rule', 'spelling.our=true=false']}                            | ${'true=false'} | ${'spelling.our=true=false'}
    ${['--rule', 'spelling.our=false', '--rule', 'dates.long=disable']} | ${'disable'}    | ${'dates.long=disable'}
  `('rejects the value in $args with exit 2 before reading anything', async ({ args, value, entry }) => {
    exits();
    const path = withFile('a.md', 'The color.');
    await expect(main(['--write', ...(args as string[]), path])).rejects.toThrow('exited 2');
    expect(stderr()).toBe(
      `deamericanise: unknown rule value "${value}" in "${entry}". Known: true, on, 1, yes, false, off, 0, no\n`,
    );
    expect(readFileSync(path, 'utf8')).toBe('The color.');
    expect(stdout()).toBe('');
  });

  it('rejects a bad --rule value before reading stdin', async () => {
    exits();
    const stdin = vi.fn();
    vi.spyOn(process, 'stdin', 'get').mockImplementation(stdin);
    await expect(main(['--language', 'md', '--rule', 'spelling.our=flase'])).rejects.toThrow('exited 2');
    expect(stdin).not.toHaveBeenCalled();
  });

  it.each`
    rule                       | expected
    ${'spelling.our=false'}    | ${'the color centre'}
    ${'spelling.our=0'}        | ${'the color centre'}
    ${'spelling.our=off'}      | ${'the color centre'}
    ${'spelling.our=no'}       | ${'the color centre'}
    ${'spelling.our=False'}    | ${'the color centre'}
    ${'spelling.our=OFF'}      | ${'the color centre'}
    ${'spelling.our=No'}       | ${'the color centre'}
    ${'spelling.our'}          | ${'the color centre'}
    ${'spelling.our=true'}     | ${'the colour centre'}
    ${'spelling.our=1'}        | ${'the colour centre'}
    ${'spelling.*=FALSE'}      | ${'the color center'}
  `('reads --rule $rule as on or off and turns "the color center" into $expected', async ({ rule, expected }) => {
    const path = withFile('a.md', 'the color center');
    expect(await main(['--rule', rule as string, path])).toBe(0);
    expect(stdout()).toBe(expected);
    expect(stderr()).toBe('');
  });

  it.each(['true', '1', 'on', 'yes', 'TRUE', 'On', 'YES'])(
    'reads --rule spelling.our=%s as on, beating --confidence risky',
    async (value) => {
      const path = withFile('a.md', 'the color center');
      expect(await main(['--confidence', 'risky', '--rule', `spelling.our=${value}`, path])).toBe(0);
      expect(stdout()).toBe('the colour center');
    },
  );

  it.each(['furlong', 'inchs', 'fahrenheit', 'units.length.inch', 'mile,furlong'])(
    'rejects --units-keep %s with exit 2, listing the known units',
    async (value) => {
      exits();
      withStdin('6 inches');
      await expect(main(['--language', 'md', '--units-keep', value])).rejects.toThrow('exited 2');
      const name = value.split(',').at(-1)!;
      expect(stderr()).toMatch(new RegExp(`^deamericanise: unknown unit "${name}"\\. Known: inch, foot, .*\\bpint\\b.*\\n$`));
      expect(stdout()).toBe('');
    },
  );

  it.each`
    args                                                             | input                             | expected
    ${['--rule', 'spelling.our=false']}                              | ${'the color center'}             | ${'the color centre'}
    ${['--rule', 'spelling.*=false']}                                | ${'the color center'}             | ${'the color center'}
    ${['--rule', 'spelling.our=true', '--confidence', 'risky']}      | ${'the color center'}             | ${'the colour center'}
    ${['--dialect', 'en-AU', '-l', '--rule', 'dialect.en-GB=false']} | ${'the sidewalk'}                 | ${'the footpath'}
    ${['--units-keep', 'mile,pint,inch']}                            | ${'6 inches, 2 miles and 1 pint'} | ${'6 inches, 2 miles and 1 pint'}
    ${['--units-keep', 'inches']}                                    | ${'6 inches and 2 feet'}          | ${'6 inches and 61 centimetres'}
    ${['--units-keep', 'in']}                                        | ${'6 inches'}                     | ${'6 inches'}
    ${['--units-keep', 'Fl Oz, sq ft']}                              | ${'8 fl oz on 100 square feet'}   | ${'8 fl oz on 100 square feet'}
    ${['--units-keep', 'MPH']}                                       | ${'60 mph'}                       | ${'60 mph'}
  `('accepts $args and turns "$input" into "$expected"', async ({ args, input, expected }) => {
    const path = withFile('a.md', input as string);
    expect(await main([...(args as string[]), path])).toBe(0);
    expect(stdout()).toBe(expected);
    expect(stderr()).toBe('');
  });

  it.each(Object.keys(DIALECTS))("accepts --rule 'dialect.*=false' under %s", async (dialect) => {
    const path = withFile('a.md', 'the sidewalk');
    expect(await main(['--dialect', dialect, '-l', '--rule', 'dialect.*=false', path])).toBe(0);
    expect(stdout()).toBe('the sidewalk');
    expect(stderr()).toBe('');
  });
});

describe('a reader that stops early', () => {
  let cli: string;

  beforeAll(async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deamericanise-cli-'));
    await build({
      config: false,
      entry: { cli: 'src/cli.ts' },
      outDir: directory,
      format: 'esm',
      outExtension: () => ({ js: '.mjs' }),
      define: { __VERSION__: JSON.stringify(version) },
      silent: true,
    });
    cli = join(directory, 'cli.mjs');
  }, 30_000);

  /** Runs the built CLI and closes its stdout after the first chunk, as `head` does. */
  async function closedEarly(args: string[]): Promise<{ code: number | null; errors: string }> {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.stdout.once('data', () => child.stdout.destroy());
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    return { code, errors };
  }

  // Every case prints well over a pipe buffer, so the CLI is still writing when the reader leaves.

  it('exits 0 with nothing on stderr when the run succeeds', async () => {
    const source = withFile('big.ts', 'const x = 1;\n'.repeat(100_000));
    expect(await closedEarly([source])).toEqual({ code: 0, errors: '' });
  });

  it('keeps the status --check settles on', async () => {
    const source = withFile('big.md', 'The color.\n'.repeat(20_000));
    expect(await closedEarly(['--check', '--diff', source])).toEqual({
      code: 1,
      errors: 'deamericanise: changes are needed. Run with --diff to see them.\n',
    });
  });

  it('still rewrites every file under --write', async () => {
    const names = Array.from({ length: 1_000 }, (_, i) => `${'long-name-'.repeat(20)}${i}.md`);
    const directory = withDirectory(Object.fromEntries(names.map((name) => [name, 'The color.'])));
    expect(await closedEarly(['--write', directory])).toEqual({ code: 0, errors: '' });
    for (const name of names) expect(readFileSync(join(directory, name), 'utf8')).toBe('The colour.');
  });
});
