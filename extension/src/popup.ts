import { api } from './browser.js';
import {
  failureMessage,
  isEnabledOn,
  loadSettings,
  migrateSites,
  saveSettings,
  saveSite,
  type Settings,
  type Status,
  type StatusRequest,
} from './settings.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function activeTab(): Promise<number | undefined> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** The top frame's answer, or null where no content script runs. */
async function status(tab: number): Promise<Status | null> {
  const request: StatusRequest = { type: 'status' };
  try {
    return ((await api.tabs.sendMessage(tab, request, { frameId: 0 })) as Status | undefined) ?? null;
  } catch {
    return null;
  }
}

function show(current: Status): void {
  $('running').hidden = false;
  $('host').textContent = current.host || 'local files';
  $<HTMLInputElement>('enabled').checked = current.enabled;
  const count = $('count');
  count.hidden = !current.enabled;
  count.textContent =
    current.changes === 1 ? '1 change on this page.' : `${current.changes} changes on this page.`;
}

/** Waits for the page to pick up a change of setting, which arrives through storage. */
async function settle(tab: number, enabled: boolean): Promise<Status | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await status(tab);
    if (!current || current.enabled === enabled) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return status(tab);
}

/**
 * Stores what a switch was set to. When storage refuses it, says why and sets the switch to
 * what storage holds. Resolves to whether it was stored.
 */
async function store(
  input: HTMLInputElement,
  write: () => Promise<void>,
  stored: (settings: Settings) => boolean,
): Promise<boolean> {
  const failed = $('failed');
  try {
    await write();
  } catch (error) {
    failed.textContent = failureMessage(error);
    failed.hidden = false;
    input.checked = stored(await loadSettings());
    return false;
  }
  failed.hidden = true;
  return true;
}

async function main(): Promise<void> {
  $('settings').addEventListener('click', () => {
    void api.runtime.openOptionsPage().then(() => window.close());
  });

  const tab = await activeTab();
  const current = tab === undefined ? null : await status(tab);
  if (tab === undefined || !current) {
    $('unavailable').hidden = false;
    return;
  }
  show(current);
  // A failed move loses nothing, because the old list is still read.
  await migrateSites().catch(() => undefined);

  const highlight = $<HTMLInputElement>('highlight');
  highlight.checked = (await loadSettings()).highlight;
  highlight.addEventListener('change', () => {
    void store(
      highlight,
      () => saveSettings({ highlight: highlight.checked }),
      (settings) => settings.highlight,
    );
  });

  const rewrite = $<HTMLInputElement>('enabled');
  rewrite.addEventListener('change', async () => {
    const enabled = rewrite.checked;
    const saved = await store(
      rewrite,
      () => saveSite(current.host, { enabled: enabled ? undefined : false }),
      (settings) => isEnabledOn(settings, current.host),
    );
    if (!saved) return;
    const after = await settle(tab, enabled);
    if (after) show(after);
  });
}

void main();
