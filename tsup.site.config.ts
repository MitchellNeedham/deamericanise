import { defineConfig } from 'tsup';

// The browser bundle for the GitHub Pages demo. Separate from the package build: one
// self-contained ESM file, no types, no CJS, no code splitting.
export default defineConfig({
  entry: { deamericanise: 'src/index.ts' },
  format: ['esm'],
  outDir: 'site/vendor',
  platform: 'browser',
  target: 'es2022',
  splitting: false,
  minify: true,
  sourcemap: false,
  dts: false,
  clean: true,
});
