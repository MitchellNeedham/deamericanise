import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// package.json carries a placeholder version; CI stamps it from the release tag.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
