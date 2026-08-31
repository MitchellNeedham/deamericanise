import { defineConfig } from 'tsup';

export default defineConfig({
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
