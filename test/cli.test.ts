import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli-main.js';

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

function withFile(name: string, contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'deamericanise-'));
  const path = join(directory, name);
  writeFileSync(path, contents, 'utf8');
  return path;
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
