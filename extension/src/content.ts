import { DomRewriter } from '../../src/dom/index.js';
import { api } from './browser.js';
import { domOptions, isEnabledOn, loadSettings, type Settings, type Status } from './settings.js';

let rewriter: DomRewriter | null = null;
const host = location.hostname;

function apply(settings: Settings): void {
  const options = domOptions(settings);
  if (!isEnabledOn(settings, host)) {
    rewriter?.stop({ restore: true });
    rewriter = null;
  } else if (rewriter) {
    rewriter.setOptions(options);
  } else {
    rewriter = new DomRewriter(document, options);
    rewriter.watch();
  }
}

void loadSettings().then(apply);

api.storage.onChanged.addListener((_, area) => {
  if (area === 'sync') void loadSettings().then(apply);
});

api.runtime.onMessage.addListener((message, _, respond) => {
  if ((message as { type?: string }).type !== 'status') return;
  const status: Status = { host, enabled: rewriter !== null, changes: rewriter?.changes().length ?? 0 };
  respond(status);
});
