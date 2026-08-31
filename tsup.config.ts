import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// package.json carries a placeholder version; CI stamps it from the release tag.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/plugins/remark.ts',
    'src/plugins/eslint.ts',
    'src/plugins/prettier.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  // Every entry pulls in the same rule data; splitting keeps it in one shared chunk.
  splitting: true,
});
