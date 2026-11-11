// Renders the store screenshots and the promo tile into extension/store/images.
// Run `npm run build:extension` first. Needs Google Chrome, or set CHROME to another binary.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = dirname(STORE);
const BUILD = join(EXTENSION, 'dist', 'chrome');
const IMAGES = join(STORE, 'images');

// Reserved for examples, so it can never be a real site. Chrome maps it to the local server.
const HOST = 'weeknighttable.example';

const SETTINGS = {
  dialect: 'en-AU',
  preset: 'read',
  confidence: ['safe', 'moderate', 'risky'],
  verdict: 'detect',
  highlight: true,
  // Pages from 127.0.0.1 show the American original, and the same pages from HOST show the
  // rewrite.
  disabledSites: ['127.0.0.1'],
};

// ------- Serving the pages -------

const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((request, response) => {
  const file = join(EXTENSION, normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)));
  try {
    if (!file.startsWith(EXTENSION)) throw new Error('Outside the extension');
    const body = readFileSync(file);
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const original = (page) => `http://127.0.0.1:${port}/store/${page}`;
const rewritten = (page) => `http://${HOST}:${port}/store/${page}`;

// ------- Talking to Chrome -------

const profile = mkdtempSync(join(tmpdir(), 'deamericanise-store-'));
// Branded Chrome ignores --load-extension, so the extension is loaded over the pipe.
const chrome = spawn(
  process.env.CHROME ?? 'google-chrome',
  [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

let buffer = '';
let nextId = 1;
const waiting = new Map();
const watchers = new Set();
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id) {
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
    for (const watcher of watchers) watcher(message);
  }
});

/** Resolves on the next event called `method` from one tab. */
function next(method, sessionId) {
  return new Promise((resolve) => {
    const watcher = (message) => {
      if (message.method !== method || message.sessionId !== sessionId) return;
      watchers.delete(watcher);
      resolve(message.params);
    };
    watchers.add(watcher);
  });
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, (message) =>
      message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result),
    );
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(session, expression) {
  const { result, exceptionDetails } = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    session,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/** Opens a tab at the given size in light mode, running `before` ahead of the page's scripts. */
async function open(url, width, height, before) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
  if (before) await send('Page.addScriptToEvaluateOnNewDocument', { source: before }, sessionId);
  const loaded = next('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url }, sessionId);
  await loaded;
  // Highlights are painted in the frame after the rewrite.
  await sleep(600);
  return sessionId;
}

async function save(session, name) {
  // A tab in the background never paints, so a screenshot of it waits forever.
  await send('Page.bringToFront', {}, session);
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, session);
  writeFileSync(join(IMAGES, name), Buffer.from(data, 'base64'));
  console.log(`wrote ${name}`);
}

/** Moves the pointer to the middle of the first text that reads `text`. */
async function hover(session, text) {
  await send('Page.bringToFront', {}, session);
  const [x, y] = await evaluate(session, `(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(text)});
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + ${text.length});
      const box = range.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    }
    throw new Error('No text reads ' + ${JSON.stringify(text)});
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, session);
  await sleep(400);
}

// ------- The images -------

try {
  mkdirSync(IMAGES, { recursive: true });
  const { id } = await send('Extensions.loadUnpacked', { path: BUILD });
  const extensionPage = (page) => `chrome-extension://${id}/${page}`;

  const options = await open(extensionPage('options.html'), 1280, 800);
  await evaluate(options, `chrome.storage.sync.clear().then(() => chrome.storage.sync.set(${JSON.stringify(SETTINGS)}))`);

  const page = await open(rewritten('sample.html'), 1280, 800);
  await hover(page, '175°C');
  await save(page, 'screenshot-1-highlights.png');

  const after = encodeURIComponent(rewritten('sample.html'));
  const comparison = await open(original(`before-after.html?after=${after}`), 1280, 800);
  await save(comparison, 'screenshot-2-before-after.png');

  // The popup asks for the active tab, which in a headless tab is the popup itself, so it is
  // pointed at the sample page.
  const tab = await evaluate(options, `(async () => {
    for (const tab of await chrome.tabs.query({})) {
      const status = await chrome.tabs.sendMessage(tab.id, { type: 'status' }, { frameId: 0 }).catch(() => null);
      if (status?.host === '${HOST}') return tab.id;
    }
    throw new Error('The sample page is not open');
  })()`);
  const popup = await open(extensionPage('popup.html'), 280, 600, `
    chrome.tabs.query = async () => [{ id: ${tab} }];
  `);
  const height = await evaluate(popup, `Math.ceil(document.querySelector('main').getBoundingClientRect().height)`);
  // Drawn at twice the size and shown at 1.3 times, so it stays sharp and readable.
  const { data } = await send(
    'Page.captureScreenshot',
    { format: 'png', clip: { x: 0, y: 0, width: 280, height, scale: 2 } },
    popup,
  );
  // Closes the description the first screenshot left open.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }, page);
  await evaluate(page, `(() => {
    const frame = document.createElement('div');
    frame.style.cssText = 'position: fixed; top: 10px; right: 24px; border-radius: 10px; overflow: hidden; ' +
      'box-shadow: 0 0 0 1px rgb(0 0 0 / 12%), 0 12px 40px rgb(0 0 0 / 22%);';
    const image = new Image();
    image.src = 'data:image/png;base64,${data}';
    image.style.cssText = 'display: block; width: ${280 * 1.3}px;';
    frame.append(image);
    document.documentElement.append(frame);
    return image.decode();
  })()`);
  await save(page, 'screenshot-3-popup.png');

  // Empty, or the site switched off for the comparison would show in the list.
  await evaluate(options, `chrome.storage.sync.set({ disabledSites: [] })`);
  const settings = await open(extensionPage('options.html'), 1280, 800);
  // Zoomed out just enough to fit the whole page, so the store shows every setting.
  const zoom = await evaluate(settings, `(() => {
    const zoom = Math.min(1, Math.floor((innerHeight / document.documentElement.scrollHeight) * 100) / 100);
    document.documentElement.style.zoom = String(zoom);
    return zoom;
  })()`);
  console.log(`settings at ${Math.round(zoom * 100)}% zoom`);
  await save(settings, 'screenshot-4-settings.png');

  const promo = await open(original('promo.html'), 440, 280);
  await save(promo, 'promo-440x280.png');

  // Edge Add-ons asks for a square logo of at least 128 pixels and recommends 300.
  const logo = await open(`http://127.0.0.1:${port}/icons/icon.svg`, 300, 300);
  // Keeps the corners outside the rounded square transparent.
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, logo);
  await save(logo, 'logo-300x300.png');
} finally {
  if (chrome.exitCode === null) {
    // Closing over the pipe lets Chrome's helper processes finish writing to the profile.
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    await Promise.race([send('Browser.close'), sleep(5000)]).catch(() => {});
    const killer = setTimeout(() => chrome.kill(), 5000);
    await exited;
    clearTimeout(killer);
  }
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
