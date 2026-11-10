import { defineConfig } from 'tsup';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// The browser extension. Content scripts cannot be ES modules, so every entry is a
// self-contained IIFE. Left unminified so store reviewers can read what they approve.
const OUT = 'extension/dist';
const BUILD = `${OUT}/build`;

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// Browsers accept only dotted integers, so a pre-release suffix lives in version_name.
const numeric = version.split(/[-+]/)[0]!;

const ICONS = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/icon-${size}.png`]));

const manifest = {
  manifest_version: 3,
  name: 'deamericanise',
  description:
    'Rewrites American English on the pages you visit into the English the rest of the world reads.',
  version: numeric,
  icons: ICONS,
  action: { default_popup: 'popup.html', default_title: 'deamericanise', default_icon: ICONS },
  options_ui: { page: 'options.html', open_in_tab: true },
  permissions: ['storage'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content.js'],
      css: ['highlight.css'],
      run_at: 'document_start',
      all_frames: true,
    },
  ],
};

const browsers: Record<string, object> = {
  chrome: { ...manifest, ...(numeric === version ? {} : { version_name: version }) },
  firefox: {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        // Permanent once the add-on is listed.
        id: 'deamericanise@mitchellneedham.github.io',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

export default defineConfig({
  entry: {
    content: 'extension/src/content.ts',
    popup: 'extension/src/popup.ts',
    options: 'extension/src/options.ts',
  },
  format: ['iife'],
  outDir: BUILD,
  outExtension: () => ({ js: '.js' }),
  platform: 'browser',
  target: 'es2022',
  splitting: false,
  minify: false,
  sourcemap: false,
  dts: false,
  clean: true,
  async onSuccess() {
    for (const [browser, contents] of Object.entries(browsers)) {
      const dir = `${OUT}/${browser}`;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(`${dir}/icons`, { recursive: true });
      cpSync(BUILD, dir, { recursive: true });
      cpSync('extension/static', dir, { recursive: true });
      for (const path of Object.values(ICONS)) cpSync(`extension/${path}`, `${dir}/${path}`);
      writeFileSync(`${dir}/manifest.json`, `${JSON.stringify(contents, null, 2)}\n`);
    }
    rmSync(BUILD, { recursive: true, force: true });
  },
});
