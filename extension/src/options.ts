import { resolveOptions } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { Category, Confidence, Dialect, Preset } from '../../src/types.js';
import type { Verdict } from '../../src/dom/index.js';
import { api } from './browser.js';
import { loadSettings, saveSettings, type Settings } from './settings.js';

const dialect = document.getElementById('dialect') as HTMLSelectElement;
const keepOriginalUnits = document.getElementById('keep-original-units') as HTMLInputElement;
const highlight = document.getElementById('highlight') as HTMLInputElement;
const rules = document.getElementById('rules') as HTMLUListElement;
const sites = document.getElementById('sites') as HTMLUListElement;
const saved = document.getElementById('saved') as HTMLParagraphElement;

const inputs = (name: string) => [
  ...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
];
const followButton = (category: string) =>
  document.querySelector(`button[data-follow="${category}"]`) as HTMLButtonElement;
const fromMode = (preset: Preset) => resolveOptions({ preset }).categories;

let savedTimer: ReturnType<typeof setTimeout> | undefined;

async function save(changes: Partial<Settings>): Promise<void> {
  await saveSettings(changes);
  saved.textContent = 'Saved.';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.textContent = ''), 1500);
}

/** One row of a list of things switched off, with the button that switches it back on. */
function switchedOff(label: string, switchOn: () => Promise<void>): HTMLLIElement {
  const item = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = label;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link';
  button.textContent = 'Switch back on';
  button.addEventListener('click', () => void switchOn());
  item.append(name, button);
  return item;
}

function render(settings: Settings): void {
  dialect.value = settings.dialect;
  for (const input of inputs('preset')) input.checked = input.value === settings.preset;
  for (const input of inputs('verdict')) input.checked = input.value === settings.verdict;
  keepOriginalUnits.checked = settings.keepOriginalUnits;
  highlight.checked = settings.highlight;
  for (const input of inputs('confidence')) {
    input.checked = settings.confidence.includes(input.value as Confidence);
  }

  const mode = fromMode(settings.preset);
  for (const input of inputs('category')) {
    const category = input.value as Category;
    const chosen = settings.categories[category];
    input.checked = chosen ?? mode[category];
    followButton(category).hidden = chosen === undefined;
  }

  const off = Object.keys(settings.rules).filter((id) => settings.rules[id] === false);
  rules.replaceChildren(
    ...off.map((id) =>
      switchedOff(id, async () => {
        const { rules: current } = await loadSettings();
        delete current[id];
        await save({ rules: current });
      }),
    ),
  );
  (document.getElementById('no-rules') as HTMLElement).hidden = off.length > 0;

  sites.replaceChildren(
    ...settings.disabledSites.map((site) =>
      switchedOff(site, async () => {
        const current = await loadSettings();
        await save({ disabledSites: current.disabledSites.filter((s) => s !== site) });
      }),
    ),
  );
  (document.getElementById('no-sites') as HTMLElement).hidden = settings.disabledSites.length > 0;
}

async function setCategory(category: Category, on: boolean | undefined): Promise<void> {
  const current = await loadSettings();
  const categories = { ...current.categories };
  // A switch that agrees with the mode follows it again.
  if (on === undefined || on === fromMode(current.preset)[category]) delete categories[category];
  else categories[category] = on;
  await save({ categories });
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
  for (const input of inputs('category')) {
    const category = input.value as Category;
    input.addEventListener('change', () => void setCategory(category, input.checked));
    followButton(category).addEventListener('click', () => void setCategory(category, undefined));
  }
  for (const input of inputs('verdict')) {
    input.addEventListener('change', () => void save({ verdict: input.value as Verdict }));
  }
  keepOriginalUnits.addEventListener('change', () =>
    void save({ keepOriginalUnits: keepOriginalUnits.checked }),
  );
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
