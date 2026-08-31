import { scanComments, type LexerSpec, type Span } from './scan.js';

const DOUBLE = { open: '"', close: '"', escape: true };
const SINGLE = { open: "'", close: "'", escape: true };

export const LEXERS: LexerSpec[] = [
  {
    id: 'javascript',
    aliases: ['javascript','typescript','node','esm','commonjs'],
    extensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [DOUBLE, SINGLE, { open: '`', close: '`', escape: true, multiline: true }],
    regexLiterals: true,
  },
  {
    id: 'c-like',
    aliases: ['cpp','c++','csharp','c#','objective-c','objc','golang','kotlin','sass','stylesheet'],
    extensions: [
      'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'java', 'go', 'swift', 'kt', 'kts',
      'scala', 'dart', 'groovy', 'gradle', 'proto', 'sol', 'glsl', 'hlsl', 'm', 'mm', 'zig',
      'css', 'scss', 'less', 'sass', 'json5', 'jsonc',
    ],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'rust',
    aliases: ['rust'],
    extensions: ['rs'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    nestedBlocks: true,
    strings: [{ open: '"', close: '"', escape: true, multiline: true }],
  },
  {
    id: 'php',
    aliases: ['php'],
    extensions: ['php'],
    lineComments: ['//', '#'],
    blockComments: [['/*', '*/']],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'python',
    aliases: ['python','python3'],
    extensions: ['py', 'pyi', 'pyw'],
    lineComments: ['#'],
    blockComments: [],
    strings: [
      { open: '"""', close: '"""', escape: true, multiline: true, doc: true },
      { open: "'''", close: "'''", escape: true, multiline: true, doc: true },
      DOUBLE,
      SINGLE,
    ],
  },
  {
    id: 'hash',
    aliases: ['ruby','shell','perl','elixir','crystal','julia','terraform','make','makefile','dockerfile','docker'],
    extensions: [
      'rb', 'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'r', 'pl', 'pm', 'jl',
      'nim', 'tf', 'tfvars', 'ex', 'exs', 'cr', 'gemspec', 'rake', 'env', 'conf', 'cfg',
      'properties', 'gitignore', 'dockerignore', 'editorconfig',
    ],
    filenames: ['Dockerfile', 'Makefile', 'Gemfile', 'Rakefile', 'Procfile', '.gitignore'],
    lineComments: ['#'],
    blockComments: [],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'powershell',
    aliases: ['pwsh'],
    extensions: ['ps1', 'psm1', 'psd1'],
    lineComments: ['#'],
    blockComments: [['<#', '#>']],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'sql',
    aliases: ['postgres','postgresql','sqlite','tsql','plsql'],
    extensions: ['sql', 'psql', 'mysql'],
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    strings: [{ open: "'", close: "'", doubled: true }, { open: '"', close: '"', doubled: true }],
  },
  {
    id: 'lua',
    aliases: ['lua'],
    extensions: ['lua'],
    lineComments: ['--'],
    blockComments: [['--[[', ']]']],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'haskell',
    aliases: ['elm','purescript'],
    extensions: ['hs', 'lhs', 'elm', 'purs'],
    lineComments: ['--'],
    blockComments: [['{-', '-}']],
    nestedBlocks: true,
    strings: [DOUBLE],
  },
  {
    id: 'lisp',
    aliases: ['clojure','scheme','racket','elisp','emacs-lisp','commonlisp'],
    extensions: ['clj', 'cljs', 'cljc', 'edn', 'el', 'lisp', 'scm', 'rkt'],
    lineComments: [';'],
    blockComments: [['#|', '|#']],
    strings: [DOUBLE],
  },
  {
    id: 'erlang',
    aliases: ['latex','matlab','octave'],
    extensions: ['erl', 'hrl', 'tex', 'sty', 'cls', 'mat'],
    lineComments: ['%'],
    blockComments: [],
    strings: [DOUBLE],
  },
  {
    id: 'markup',
    aliases: ['html','xml','svg','markup','jsx-html'],
    extensions: ['html', 'htm', 'xml', 'xhtml', 'svg', 'vue', 'svelte', 'xsl', 'plist', 'resx'],
    lineComments: [],
    blockComments: [['<!--', '-->']],
    strings: [],
  },
  {
    id: 'ini',
    aliases: ['ini','cfg'],
    extensions: ['ini'],
    lineComments: [';', '#'],
    blockComments: [],
    strings: [DOUBLE, SINGLE],
  },
  {
    id: 'vb',
    aliases: ['visualbasic','vbnet','basic'],
    extensions: ['vb', 'vbs', 'bas'],
    lineComments: ["'"],
    blockComments: [],
    strings: [DOUBLE],
  },
  {
    id: 'fortran',
    aliases: ['fortran'],
    extensions: ['f90', 'f95', 'f03'],
    lineComments: ['!'],
    blockComments: [],
    strings: [DOUBLE, SINGLE],
  },
];

const BY_EXTENSION = new Map<string, LexerSpec>();
const BY_ID = new Map<string, LexerSpec>();
const BY_FILENAME = new Map<string, LexerSpec>();
const BY_ALIAS = new Map<string, LexerSpec>();

for (const lexer of LEXERS) {
  BY_ID.set(lexer.id, lexer);
  for (const extension of lexer.extensions) BY_EXTENSION.set(extension, lexer);
  for (const filename of lexer.filenames ?? []) BY_FILENAME.set(filename.toLowerCase(), lexer);
  for (const alias of lexer.aliases ?? []) BY_ALIAS.set(alias.toLowerCase(), lexer);
}

/** Extensions handled as prose rather than as source with comments in it. */
export const PROSE_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'adoc', 'org']);

export function lexerFor(nameOrExtension: string): LexerSpec | undefined {
  const cleaned = nameOrExtension.replace(/^\./, '').toLowerCase();
  return (
    BY_ID.get(cleaned) ??
    BY_EXTENSION.get(cleaned) ??
    BY_ALIAS.get(cleaned) ??
    BY_FILENAME.get(cleaned) ??
    BY_FILENAME.get(cleaned.split(/[\\/]/).pop() ?? '') ??
    BY_EXTENSION.get(cleaned.split('.').pop() ?? '')
  );
}

/** Every name `lexerFor` accepts, for `--help` and error messages. */
export function languageNames(): string[] {
  const names = new Set<string>();
  for (const lexer of LEXERS) {
    names.add(lexer.id);
    for (const alias of lexer.aliases ?? []) names.add(alias);
    for (const extension of lexer.extensions) names.add(extension);
  }
  return [...names].sort();
}

export function commentSpans(source: string, lexer: LexerSpec, includeDocs = false): Span[] {
  return scanComments(source, lexer, includeDocs);
}

export type { LexerSpec, Span };
