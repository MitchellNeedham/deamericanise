// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'static');

type Listener = (changes: Record<string, unknown>, area: string) => void;

/** `storage.sync` with Chrome 148's limits and error messages. */
class FakeSync {
  items = new Map<string, string>();
  writes = 0;
  /** Makes every write reject with this message, as the browser would. */
  failWith: string | null = null;
  readonly listeners: Listener[] = [];

  async get(keys: string[] | null): Promise<Record<string, unknown>> {
    const wanted = keys ?? [...this.items.keys()].sort();
    return Object.fromEntries(
      wanted.filter((key) => this.items.has(key)).map((key) => [key, JSON.parse(this.items.get(key)!)]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.check();
    const next = new Map(this.items);
    for (const [key, value] of Object.entries(items)) {
      const json = JSON.stringify(value);
      if (key.length + json.length > 8192) throw new Error('Resource::kQuotaBytesPerItem quota exceeded');
      next.set(key, json);
    }
    if (next.size > 512) throw new Error('Resource::kMaxItems quota exceeded');
    let bytes = 0;
    for (const [key, json] of next) bytes += key.length + json.length;
    if (bytes > 102_400) throw new Error('Resource::kQuotaBytes quota exceeded');
    this.commit(next);
  }

  async remove(keys: string | string[]): Promise<void> {
    this.check();
    const next = new Map(this.items);
    for (const key of [keys].flat()) next.delete(key);
    this.commit(next);
  }

  private check(): void {
    if (this.failWith) throw new Error(this.failWith);
    this.writes++;
  }

  private commit(next: Map<string, string>): void {
    const changes: Record<string, unknown> = {};
    for (const key of new Set([...this.items.keys(), ...next.keys()])) {
      if (this.items.get(key) !== next.get(key)) changes[key] = {};
    }
    this.items = next;
    if (Object.keys(changes).length > 0) {
      queueMicrotask(() => this.listeners.forEach((listener) => listener(changes, 'sync')));
    }
  }

  fill(items: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(items)) this.items.set(key, JSON.stringify(value));
  }

  stored(): Record<string, unknown> {
    return Object.fromEntries([...this.items].map(([key, json]) => [key, JSON.parse(json)]));
  }
}

const sync = new FakeSync();
let pageHost = 'news.example';

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { sync, onChanged: { addListener: (listener: Listener) => sync.listeners.push(listener) } },
  runtime: { openOptionsPage: async () => {}, onMessage: { addListener: () => {} } },
  tabs: {
    query: async () => [{ id: 1 }],
    // The content script answers from storage, as it would once the change reached it.
    sendMessage: async () => {
      const { loadSettings, isEnabledOn } = await import('../extension/src/settings.js');
      return { host: pageHost, enabled: isEnabledOn(await loadSettings(), pageHost), changes: 3 };
    },
  },
};

type SettingsModule = typeof import('../extension/src/settings.js');
let settings: SettingsModule;

/** `count` hostnames of `length` characters each, all different. */
function hosts(count: number, length: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `s${i}.`;
    return name + 'x'.repeat(length - name.length - 4) + '.com';
  });
}

beforeEach(async () => {
  sync.items.clear();
  sync.writes = 0;
  sync.failWith = null;
  sync.listeners.length = 0;
  pageHost = 'news.example';
  vi.resetModules();
  settings = await import('../extension/src/settings.js');
});

describe('extension: sites switched off', () => {
  it('reads a site from its own key', async () => {
    sync.fill({ 'site:news.example': { enabled: false } });
    const loaded = await settings.loadSettings();
    expect(settings.isEnabledOn(loaded, 'news.example')).toBe(false);
    expect(settings.isEnabledOn(loaded, 'other.example')).toBe(true);
  });

  it('still reads the list older versions kept', async () => {
    sync.fill({ disabledSites: ['old.example'], 'site:news.example': { enabled: false } });
    const loaded = await settings.loadSettings();
    expect(settings.isEnabledOn(loaded, 'old.example')).toBe(false);
    expect(settings.isEnabledOn(loaded, 'news.example')).toBe(false);
  });

  it('ignores a site key it cannot read', async () => {
    sync.fill({ 'site:a.example': 'off', 'site:b.example': { enabled: 'no' }, 'site:c.example': [false] });
    const loaded = await settings.loadSettings();
    for (const host of ['a.example', 'b.example', 'c.example']) {
      expect(settings.isEnabledOn(loaded, host)).toBe(true);
    }
  });

  it.each(['constructor', '__proto__', 'toString', ''])('handles a host called %j', async (host) => {
    expect(settings.isEnabledOn(await settings.loadSettings(), host)).toBe(true);
    await settings.saveSite(host, { enabled: false });
    expect(settings.isEnabledOn(await settings.loadSettings(), host)).toBe(false);
    expect(sync.stored()).toEqual({ [`site:${host}`]: { enabled: false } });
  });

  it('switches a site off and on with a key of its own', async () => {
    await settings.saveSite('news.example', { enabled: false });
    expect(sync.stored()).toEqual({ 'site:news.example': { enabled: false } });
    await settings.saveSite('news.example', { enabled: undefined });
    expect(sync.stored()).toEqual({});
  });

  it('keeps what a newer version stored for the site', async () => {
    sync.fill({ 'site:news.example': { enabled: false, preset: 'localise' } });
    await settings.saveSite('news.example', { enabled: undefined });
    expect(sync.stored()).toEqual({ 'site:news.example': { preset: 'localise' } });
  });

  it('switches back on a site in the list older versions kept', async () => {
    sync.fill({ disabledSites: ['old.example', 'news.example'] });
    await settings.saveSite('news.example', { enabled: undefined });
    expect(sync.stored()).toEqual({ disabledSites: ['old.example'] });
  });

  it('has room for MAX_SITES sites and refuses the next', async () => {
    sync.fill(Object.fromEntries(hosts(settings.MAX_SITES - 1, 20).map((h) => [`site:${h}`, { enabled: false }])));
    sync.fill({ dialect: 'en-GB', rules: { 'spelling.color': false } });
    await settings.saveSite('news.example', { enabled: false });
    await expect(settings.saveSite('more.example', { enabled: false })).rejects.toThrow(
      settings.SitesFullError,
    );
    expect(sync.items.has('site:more.example')).toBe(false);
    // Room is kept for every setting to get a key of its own.
    const all = Object.keys(settings.DEFAULTS).filter((key) => key !== 'sites');
    expect(sync.items.size + all.length).toBeLessThanOrEqual(512);
    // Switching a site back on still works at the limit.
    await settings.saveSite('news.example', { enabled: undefined });
    expect(sync.items.has('site:news.example')).toBe(false);
  });

  it('lets the browser refusal reach the caller', async () => {
    sync.failWith = 'Resource::kMaxItems quota exceeded';
    await expect(settings.saveSite('news.example', { enabled: false })).rejects.toThrow('kMaxItems');
    await expect(settings.saveSettings({ highlight: true })).rejects.toThrow('kMaxItems');
  });
});

describe('extension: moving the old list to keys of their own', () => {
  it('moves every site in one write and empties the list', async () => {
    const list = hosts(454, 15);
    sync.fill({ disabledSites: list, dialect: 'en-GB' });
    await settings.migrateSites();
    expect(sync.writes).toBe(1);
    const stored = sync.stored();
    expect(stored.disabledSites).toEqual([]);
    for (const host of list) expect(stored[`site:${host}`]).toEqual({ enabled: false });
    expect(stored.dialect).toBe('en-GB');
  });

  it('writes nothing when run again', async () => {
    sync.fill({ disabledSites: ['a.example', 'b.example'] });
    await settings.migrateSites();
    const after = sync.stored();
    await settings.migrateSites();
    expect(sync.writes).toBe(1);
    expect(sync.stored()).toEqual(after);
  });

  it('gives the same result when two browsers run it at once', async () => {
    sync.fill({ disabledSites: ['a.example', 'b.example'], 'site:c.example': { enabled: false } });
    await Promise.all([settings.migrateSites(), settings.migrateSites()]);
    expect(sync.stored()).toEqual({
      disabledSites: [],
      'site:a.example': { enabled: false },
      'site:b.example': { enabled: false },
      'site:c.example': { enabled: false },
    });
  });

  it('keeps what a newer version stored for a site it moves', async () => {
    sync.fill({ disabledSites: ['a.example'], 'site:a.example': { preset: 'localise' } });
    await settings.migrateSites();
    expect(sync.stored()['site:a.example']).toEqual({ preset: 'localise', enabled: false });
  });

  it('leaves the list alone when the sites would not fit, and still reads it', async () => {
    const list = hosts(settings.MAX_SITES + 1, 10);
    sync.fill({ disabledSites: list });
    await settings.migrateSites();
    expect(sync.writes).toBe(0);
    const loaded = await settings.loadSettings();
    expect(list.every((host) => !settings.isEnabledOn(loaded, host))).toBe(true);
  });
});

describe('extension: which changes a page reacts to', () => {
  it.each([
    [{ 'site:news.example': {} }, true],
    [{ 'site:other.example': {} }, false],
    [{ 'site:other.example': {}, highlight: {} }, true],
    [{ disabledSites: {} }, true],
    [{ dialect: {} }, true],
  ])('%j', (changes, expected) => {
    expect(settings.affectsHost(changes, 'news.example')).toBe(expected);
  });
});

describe('extension: saying why a change was not stored', () => {
  it.each([
    ['Resource::kMaxItems quota exceeded', /storage is full/],
    ['Resource::kQuotaBytes quota exceeded', /storage is full/],
    ['Resource::kQuotaBytesPerItem quota exceeded', /storage is full/],
    ['This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.', /too many changes/],
    ['Something else', /Something else/],
  ])('%s', (message, expected) => {
    const text = settings.failureMessage(new Error(message));
    expect(text).toMatch(/^Not saved/);
    expect(text).toMatch(expected);
  });

  it('names the limit on sites', () => {
    expect(settings.failureMessage(new settings.SitesFullError())).toContain(String(settings.MAX_SITES));
  });
});

/** Loads one of the extension's pages into the document and runs its script. */
async function openPage(name: 'popup' | 'options'): Promise<void> {
  const html = readFileSync(join(STATIC, `${name}.html`), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  await (name === 'popup' ? import('../extension/src/popup.js') : import('../extension/src/options.js'));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function toggle(input: HTMLInputElement): void {
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change'));
}

describe('extension: the popup', () => {
  async function openPopup(): Promise<void> {
    await openPage('popup');
    await vi.waitFor(() => expect($('running').hidden).toBe(false));
    // The switches get their handlers a moment after the popup shows them.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it('switches a site off when 454 sites already fill the old list', async () => {
    sync.fill({ disabledSites: hosts(454, 15) });
    await openPopup();
    const enabled = $<HTMLInputElement>('enabled');
    expect(enabled.checked).toBe(true);
    toggle(enabled);
    await vi.waitFor(async () => {
      expect(settings.isEnabledOn(await settings.loadSettings(), 'news.example')).toBe(false);
    });
    const loaded = await settings.loadSettings();
    expect(hosts(454, 15).every((host) => !settings.isEnabledOn(loaded, host))).toBe(true);
    expect(enabled.checked).toBe(false);
  });

  it('says so when a site cannot be switched off, and shows what is stored', async () => {
    await openPopup();
    sync.failWith = 'Resource::kMaxItems quota exceeded';
    const enabled = $<HTMLInputElement>('enabled');
    toggle(enabled);
    await vi.waitFor(() => expect($('failed').hidden).toBe(false));
    expect($('failed').textContent).toMatch(/^Not saved.*storage is full/);
    expect(enabled.checked).toBe(true);
  });

  it('says so when the site limit is reached', async () => {
    sync.fill(Object.fromEntries(hosts(480, 20).map((h) => [`site:${h}`, { enabled: false }])));
    await openPopup();
    const enabled = $<HTMLInputElement>('enabled');
    toggle(enabled);
    await vi.waitFor(() => expect($('failed').hidden).toBe(false));
    expect($('failed').textContent).toContain('480');
    expect(enabled.checked).toBe(true);
  });

  it('says so when highlighting cannot be switched on', async () => {
    await openPopup();
    sync.failWith = 'This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.';
    const highlight = $<HTMLInputElement>('highlight');
    toggle(highlight);
    await vi.waitFor(() => expect($('failed').hidden).toBe(false));
    expect($('failed').textContent).toMatch(/too many changes/);
    expect(highlight.checked).toBe(false);
  });

  it('moves the old list when it opens', async () => {
    sync.fill({ disabledSites: ['old.example'] });
    await openPopup();
    await vi.waitFor(() => expect(sync.stored()['site:old.example']).toEqual({ enabled: false }));
  });
});

describe('extension: the settings page', () => {
  async function openOptions(): Promise<void> {
    await openPage('options');
    // The page listens for changes once everything else is in place.
    await vi.waitFor(() => expect(sync.listeners.length).toBe(1));
  }

  it('says in the live region when a change was not stored, and shows what is stored', async () => {
    await openOptions();
    sync.failWith = 'Resource::kMaxItems quota exceeded';
    const spelling = $<HTMLInputElement>('category-spelling');
    expect(spelling.checked).toBe(true);
    toggle(spelling);
    await vi.waitFor(() => expect($('saved').textContent).toMatch(/^Not saved.*storage is full/));
    expect(spelling.checked).toBe(true);
    // A failure stays on screen.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect($('saved').textContent).toMatch(/^Not saved/);
  });

  it('lists the sites switched off and switches one back on', async () => {
    sync.fill({ 'site:b.example': { enabled: false }, 'site:a.example': { enabled: false } });
    await openOptions();
    const rows = () => [...$('sites').querySelectorAll('li')].map((li) => li.firstChild!.textContent);
    expect(rows()).toEqual(['a.example', 'b.example']);
    $('sites').querySelector('button')!.click();
    await vi.waitFor(() => expect(rows()).toEqual(['b.example']));
    expect(sync.stored()).toEqual({ 'site:b.example': { enabled: false } });
    expect($('saved').textContent).toBe('Saved.');
  });

  it('shows a site switched off elsewhere', async () => {
    await openOptions();
    expect($('no-sites').hidden).toBe(false);
    await settings.saveSite('news.example', { enabled: false });
    await vi.waitFor(() => expect($('sites').textContent).toContain('news.example'));
    expect($('no-sites').hidden).toBe(true);
  });

  it('moves the old list when it opens', async () => {
    sync.fill({ disabledSites: ['old.example'] });
    await openOptions();
    await vi.waitFor(() => expect(sync.stored()['site:old.example']).toEqual({ enabled: false }));
    expect($('sites').textContent).toContain('old.example');
  });

  it('leaves named measurements alone until the box is unticked', async () => {
    // jsdom has no modal dialogues.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    await openOptions();
    document.querySelector<HTMLButtonElement>('button[data-tune="units"]')!.click();
    const box = $<HTMLInputElement>('tune-units-respectConventions');
    expect(box.checked).toBe(true);

    toggle(box);
    await vi.waitFor(() => expect(sync.stored().units).toEqual({ respectConventions: false }));
    toggle(box);
    await vi.waitFor(() => expect(sync.stored().units).toEqual({}));
  });
});

describe('extension: suggestions while writing', () => {
  it('is on until switched off', async () => {
    expect((await settings.loadSettings()).suggest).toBe(true);
    sync.fill({ suggest: 'no' });
    expect((await settings.loadSettings()).suggest).toBe(true);
    sync.fill({ suggest: false });
    expect((await settings.loadSettings()).suggest).toBe(false);
  });

  it('reads what is written as American, whatever the setting for pages', async () => {
    sync.fill({ verdict: 'lang', categories: { units: false }, rules: { 'spelling.color': false } });
    const options = settings.writingOptions(await settings.loadSettings());
    expect(options).toMatchObject({ assumeAmerican: true, categories: { units: false } });
    expect(options.rules).toEqual({ 'spelling.color': false });
    expect(options).not.toHaveProperty('verdict');
  });

  it.each([
    ['typing at the end', 'The colo', 'The colou', [8, 0, 'u']],
    ['typing a letter that repeats', 'aa', 'aaa', [2, 0, 'a']],
    ['deleting a letter', 'colour', 'color', [4, 1, '']],
    ['replacing a selection', 'the gray car', 'the grey car', [6, 1, 'e']],
    ['changing nothing', 'gray', 'gray', [4, 0, '']],
  ])('gives the copy of a text box one edit for %s', async (_, before, after, edit) => {
    const { textEdit } = await import('../extension/src/suggest.js');
    expect(textEdit(before, after)).toEqual(edit);
  });

  it('gives the copy of a text box an edit that always makes the new text', async () => {
    const { textEdit } = await import('../extension/src/suggest.js');
    fc.assert(
      fc.property(fc.string(), fc.string(), (before, after) => {
        const [start, count, data] = textEdit(before, after);
        expect(before.slice(0, start) + data + before.slice(start + count)).toBe(after);
      }),
    );
  });

  it('is switched off from the settings page', async () => {
    await openPage('options');
    await vi.waitFor(() => expect(sync.listeners.length).toBe(1));
    const suggest = $<HTMLInputElement>('suggest');
    expect(suggest.checked).toBe(true);
    toggle(suggest);
    await vi.waitFor(() => expect(sync.stored().suggest).toBe(false));
  });
});

describe('extension: named measurements', () => {
  it('passes a stored respectConventions through to the rewriter', async () => {
    sync.fill({ units: { respectConventions: false } });
    expect(settings.domOptions(await settings.loadSettings()).units).toEqual({ respectConventions: false });
  });

  it('drops a stored respectConventions that is not a boolean', async () => {
    sync.fill({ units: { respectConventions: 'no' } });
    expect(settings.domOptions(await settings.loadSettings()).units).toEqual({});
  });
});
