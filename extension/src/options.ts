import { resolveOptions } from '../../src/config.js';
import { DIALECTS } from '../../src/dialects/index.js';
import type { Verdict } from '../../src/dom/index.js';
import type { RuleInfo } from '../../src/rules/catalogue.js';
import type { Category, Confidence, Dialect, Preset } from '../../src/types.js';
import { api } from './browser.js';
import {
  catalogue,
  categoriesOn,
  DATE_FORMATS,
  domOptions,
  failureMessage,
  FUEL_ECONOMY,
  loadSettings,
  migrateSites,
  PRECISIONS,
  ruleOnByDefault,
  saveSettings,
  saveSite,
  withRule,
  type Settings,
  type SettingsChanges,
} from './settings.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialect = element<HTMLSelectElement>('dialect');
const highlight = element<HTMLInputElement>('highlight');
const rules = element<HTMLUListElement>('rules');
const sites = element<HTMLUListElement>('sites');
const saved = element<HTMLParagraphElement>('saved');
const tune = element<HTMLDialogElement>('tune');

const inputs = (name: string) => [
  ...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
];
const followButton = (category: string) =>
  document.querySelector(`button[data-follow="${category}"]`) as HTMLButtonElement;
const tuneButton = (category: string) =>
  document.querySelector(`button[data-tune="${category}"]`) as HTMLButtonElement;
const categoryLabel = (category: string) =>
  document.querySelector(`label[for="category-${category}"]`)?.textContent ?? category;
const fromMode = (preset: Preset) => resolveOptions({ preset }).categories;

/** The settings as last read, for the controls that need them between reads. */
let latest: Settings;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Runs a write and says in the live region whether it was stored. When storage refuses it,
 * the page is drawn again from storage, so no control keeps a value that was not stored.
 */
async function store(write: () => Promise<void>): Promise<void> {
  clearTimeout(savedTimer);
  try {
    await write();
  } catch (error) {
    saved.textContent = failureMessage(error);
    render(await loadSettings());
    return;
  }
  saved.textContent = 'Saved.';
  savedTimer = setTimeout(() => (saved.textContent = ''), 1500);
}

const save = (changes: SettingsChanges): Promise<void> => store(() => saveSettings(changes));

function text(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

/** One row of a list of things switched off, with the button that switches it back on. */
function switchedOff(label: Node[], switchOn: () => Promise<void>): HTMLLIElement {
  const item = document.createElement('li');
  const name = document.createElement('span');
  name.append(...label);
  const button = text('button', 'Switch back on', 'link') as HTMLButtonElement;
  button.type = 'button';
  button.addEventListener('click', () => void switchOn());
  item.append(name, button);
  return item;
}

// ------- Fine-tuning a category -------

type Group = 'units' | 'dates' | 'times';
type Value = string | number | boolean;

interface Field {
  group: Group;
  key: string;
  label: string;
  hint?: string;
  /** The values of a list and how each reads. Without them the field is a tick box. */
  choices?: [value: Value, text: string][];
  /** A rule that does nothing unless this option is on, so the rule list leaves it out. */
  rule?: string;
}

const choices = (values: readonly Value[], names: Record<string, string>): [Value, string][] =>
  values.map((value) => [value, names[String(value)] ?? String(value)]);

const FIELDS: Partial<Record<Category, Field[]>> = {
  units: [
    {
      group: 'units',
      key: 'keepOriginal',
      label: 'Keep the original',
      hint: 'Such as 1.8 metres (6 feet).',
    },
    {
      group: 'units',
      key: 'precision',
      label: 'Precision',
      hint: 'As precise as the original gives 1.8 metres for 6 feet. Exact gives 1.8288 metres.',
      choices: choices(PRECISIONS, {
        natural: 'As precise as the original',
        exact: 'Exact',
        0: 'Whole numbers',
        1: 'One decimal place',
        2: 'Two decimal places',
      }),
    },
    {
      group: 'units',
      key: 'fuelEconomy',
      label: 'Fuel economy',
      choices: choices(FUEL_ECONOMY, {
        'l-per-100km': 'Litres per 100 km',
        'km-per-l': 'Kilometres per litre',
      }),
    },
    {
      group: 'units',
      key: 'respectConventions',
      label: 'Leave named measurements alone',
      hint: 'Such as a 15 inch laptop, the 40 yard line and the 147-pound division.',
    },
  ],
  dates: [
    {
      group: 'dates',
      key: 'format',
      label: 'Date format',
      hint: 'For a date written month-first.',
      choices: choices(DATE_FORMATS, { iso: '2024-03-14', dmy: '14/03/2024', long: '14 March 2024' }),
    },
    {
      group: 'dates',
      key: 'reorderLongDates',
      label: 'Reorder long dates',
      hint: 'Such as 5 March 2024 for March 5, 2024. On by default in Localise mode.',
      rule: 'dates.long',
    },
  ],
  times: [
    { group: 'times', key: 'to24Hour', label: '24-hour clock', hint: 'Such as 15:00 for 3:00 P.M.' },
  ],
};

/** The rules worth a switch of their own. A category's only rule is the category switch. */
function tunableRules(category: Category, dialectId: Dialect): RuleInfo[] {
  const covered = new Set((FIELDS[category] ?? []).map((field) => field.rule));
  const list = [...catalogue(dialectId).values()].filter(
    (rule) => rule.category === category && rule.switchable && !covered.has(rule.id),
  );
  return list.length >= 2 ? list : [];
}

function tunable(category: Category, dialectId: Dialect): boolean {
  return (FIELDS[category]?.length ?? 0) > 0 || tunableRules(category, dialectId).length > 0;
}

const fieldId = (field: Field) => `tune-${field.group}-${field.key}`;

function optionValue(settings: Settings, field: Field): Value {
  const resolved = resolveOptions(domOptions(settings))[field.group] as Record<string, Value>;
  if (field.rule && settings.rules[field.rule] === false) return false;
  return resolved[field.key]!;
}

async function setOption(field: Field, value: Value): Promise<void> {
  const current = await loadSettings();
  const fallback = (resolveOptions({ preset: current.preset })[field.group] as Record<string, Value>)[
    field.key
  ];
  const options: Record<string, Value> = { ...current[field.group] };
  // A value that agrees with the mode follows it again.
  if (value === fallback) delete options[field.key];
  else options[field.key] = value;

  const changes: SettingsChanges = { [field.group]: options };
  if (field.rule) {
    changes.rules = { ...current.rules };
    delete changes.rules[field.rule];
  }
  await save(changes);
}

function fieldElement(field: Field): HTMLElement {
  const id = fieldId(field);
  if (!field.choices) {
    const row = document.createElement('label');
    row.className = 'choice';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.addEventListener('change', () => void setOption(field, box.checked));
    row.append(box, text('span', field.label), ...(field.hint ? [text('small', field.hint)] : []));
    return row;
  }

  const row = document.createElement('div');
  row.className = 'field';
  const label = text('label', field.label) as HTMLLabelElement;
  label.htmlFor = id;
  const list = document.createElement('select');
  list.id = id;
  for (const [value, name] of field.choices) list.append(new Option(name, String(value)));
  list.addEventListener('change', () => {
    const chosen = field.choices!.find(([value]) => String(value) === list.value);
    if (chosen) void setOption(field, chosen[0]);
  });
  row.append(label, list, ...(field.hint ? [text('small', field.hint)] : []));
  return row;
}

function ruleElement(rule: RuleInfo): HTMLElement {
  const row = document.createElement('label');
  row.className = 'choice';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.rule = rule.id;
  box.addEventListener('change', async () => {
    await save({ rules: withRule(await loadSettings(), rule.id, box.checked) });
  });
  const details = [rule.example, rule.confidence.join(' or ')];
  if (rule.offByDefault) details.push('off by default');
  const small = text('small', `${details.join(' · ')} · `);
  small.append(text('span', rule.id, 'rule-id'));
  row.append(box, text('span', rule.label), small);
  return row;
}

/** The category the dialogue shows, and the dialect its rule list was built for. */
let tuning: { category: Category; dialect: Dialect } | null = null;

function buildTune(category: Category, settings: Settings): void {
  tuning = { category, dialect: settings.dialect };
  element('tune-title').textContent = categoryLabel(category);
  element('tune-options').replaceChildren(...(FIELDS[category] ?? []).map(fieldElement));
  const list = tunableRules(category, settings.dialect);
  element('tune-rules').replaceChildren(...list.map(ruleElement));
  element('tune-rules-section').hidden = list.length === 0;
}

function updateTune(settings: Settings): void {
  if (!tuning) return;
  if (tuning.dialect !== settings.dialect) buildTune(tuning.category, settings);
  const { category } = tuning;

  element('tune-off').hidden = categoriesOn(settings)[category];
  for (const field of FIELDS[category] ?? []) {
    const control = element<HTMLInputElement | HTMLSelectElement>(fieldId(field));
    const value = optionValue(settings, field);
    if (control instanceof HTMLInputElement) control.checked = value === true;
    else control.value = String(value);
  }
  for (const box of element('tune-rules').querySelectorAll<HTMLInputElement>('input[data-rule]')) {
    const id = box.dataset.rule!;
    box.checked = settings.rules[id] ?? ruleOnByDefault(settings, id);
  }
}

function openTune(category: Category): void {
  buildTune(category, latest);
  updateTune(latest);
  tune.showModal();
}

async function resetCategory(category: Category): Promise<void> {
  const current = await loadSettings();
  const changes: SettingsChanges = {};
  for (const field of FIELDS[category] ?? []) changes[field.group] = {};
  changes.rules = Object.fromEntries(
    Object.entries(current.rules).filter(
      ([id]) => catalogue(current.dialect).get(id)?.category !== category,
    ),
  );
  await save(changes);
}

// ------- The page -------

function render(settings: Settings): void {
  latest = settings;
  dialect.value = settings.dialect;
  for (const input of inputs('preset')) input.checked = input.value === settings.preset;
  for (const input of inputs('verdict')) input.checked = input.value === settings.verdict;
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
    tuneButton(category).hidden = !tunable(category, settings.dialect);
  }

  const off = Object.keys(settings.rules).filter((id) => settings.rules[id] === false);
  rules.replaceChildren(
    ...off.map((id) => {
      const label = catalogue(settings.dialect).get(id)?.label;
      const name = label
        ? [document.createTextNode(`${label} `), text('span', id, 'rule-id')]
        : [text('span', id)];
      return switchedOff(name, async () => {
        const { rules: current } = await loadSettings();
        delete current[id];
        await save({ rules: current });
      });
    }),
  );
  element('no-rules').hidden = off.length > 0;

  const hosts = Object.keys(settings.sites)
    .filter((host) => settings.sites[host]!.enabled === false)
    .sort();
  sites.replaceChildren(
    ...hosts.map((host) =>
      switchedOff([document.createTextNode(host)], () =>
        store(() => saveSite(host, { enabled: undefined })),
      ),
    ),
  );
  element('no-sites').hidden = hosts.length > 0;

  updateTune(settings);
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
  for (const input of inputs('category')) {
    const category = input.value as Category;
    const button = text('button', 'Fine-tune', 'link tune-open') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.tune = category;
    button.setAttribute('aria-label', `Fine-tune ${categoryLabel(category)}`);
    button.addEventListener('click', () => openTune(category));
    input.parentElement!.append(button);
  }

  // A failed move loses nothing, because the old list is still read.
  await migrateSites().catch(() => undefined);
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

  element('tune-close').addEventListener('click', () => tune.close());
  element('tune-done').addEventListener('click', () => tune.close());
  element('tune-reset').addEventListener('click', () => {
    if (tuning) void resetCategory(tuning.category);
  });
  // The dialogue fills its own box, so a click that lands on it directly is on the backdrop.
  tune.addEventListener('click', (event) => {
    if (event.target === tune) tune.close();
  });
  tune.addEventListener('close', () => (tuning = null));

  api.storage.onChanged.addListener((_, area) => {
    if (area === 'sync') void loadSettings().then(render);
  });
}

void main();
