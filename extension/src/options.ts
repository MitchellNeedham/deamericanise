import { DIALECTS } from '../../src/dialects/index.js';
import type { Confidence, Dialect, Preset } from '../../src/types.js';
import type { Verdict } from '../../src/dom/index.js';
import { api } from './browser.js';
import { loadSettings, saveSettings, type Settings } from './settings.js';

const dialect = document.getElementById('dialect') as HTMLSelectElement;
const highlight = document.getElementById('highlight') as HTMLInputElement;
const sites = document.getElementById('sites') as HTMLUListElement;
const saved = document.getElementById('saved') as HTMLParagraphElement;

const inputs = (name: string) => [
  ...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
];

let savedTimer: ReturnType<typeof setTimeout> | undefined;

async function save(changes: Partial<Settings>): Promise<void> {
  await saveSettings(changes);
  saved.textContent = 'Saved.';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.textContent = ''), 1500);
}

function render(settings: Settings): void {
  dialect.value = settings.dialect;
  for (const input of inputs('preset')) input.checked = input.value === settings.preset;
  for (const input of inputs('verdict')) input.checked = input.value === settings.verdict;
  highlight.checked = settings.highlight;
  for (const input of inputs('confidence')) {
    input.checked = settings.confidence.includes(input.value as Confidence);
  }

  sites.replaceChildren(
    ...settings.disabledSites.map((site) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = site;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = 'Switch back on';
      remove.addEventListener('click', async () => {
        const current = await loadSettings();
        await save({ disabledSites: current.disabledSites.filter((s) => s !== site) });
      });
      item.append(name, remove);
      return item;
    }),
  );
  (document.getElementById('no-sites') as HTMLElement).hidden = settings.disabledSites.length > 0;
}

async function main(): Promise<void> {
  for (const pack of Object.values(DIALECTS)) {
    dialect.append(new Option(pack.label, pack.id));
  }

  render(await loadSettings());

  dialect.addEventListener('change', () => void save({ dialect: dialect.value as Dialect }));
  for (const input of inputs('preset')) {
    input.addEventListener('change', () => void save({ preset: input.value as Preset }));
  }
  for (const input of inputs('verdict')) {
    input.addEventListener('change', () => void save({ verdict: input.value as Verdict }));
  }
  highlight.addEventListener('change', () => void save({ highlight: highlight.checked }));
  for (const input of inputs('confidence')) {
    input.addEventListener('change', () => {
      const ticked = inputs('confidence').filter((i) => i.checked).map((i) => i.value as Confidence);
      if (ticked.length === 0) {
        input.checked = true;
        return;
      }
      void save({ confidence: ticked });
    });
  }

  api.storage.onChanged.addListener((_, area) => {
    if (area === 'sync') void loadSettings().then(render);
  });
}

void main();
