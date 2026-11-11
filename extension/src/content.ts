import { DomRewriter } from '../../src/dom/index.js';
import { api } from './browser.js';
import { Highlighter, type RuleSwitch } from './highlight.js';
import {
  catalogue,
  DEFAULTS,
  domOptions,
  isEnabledOn,
  loadSettings,
  switchOffRule,
  type Settings,
  type Status,
} from './settings.js';

let rewriter: DomRewriter | null = null;
let highlighter: Highlighter | null = null;
let applied = '';
const host = location.hostname;
let current: Settings = DEFAULTS;

const rules: RuleSwitch = {
  canSwitchOff: (ruleId) => catalogue(current.dialect).get(ruleId)?.switchable !== false,
  switchOff: (ruleId) => void switchOffRule(ruleId),
};

function apply(settings: Settings): void {
  current = settings;
  if (!isEnabledOn(settings, host)) {
    highlighter?.stop();
    highlighter = null;
    rewriter?.stop({ restore: true });
    rewriter = null;
    return;
  }

  const options = domOptions(settings);
  // Re-reading every run is the slow part, so a change to another setting skips it.
  const key = JSON.stringify(options);
  if (!rewriter) {
    rewriter = new DomRewriter(document, options);
    rewriter.watch();
  } else if (key !== applied) {
    rewriter.setOptions(options);
  }
  applied = key;

  if (settings.highlight) {
    highlighter ??= new Highlighter(rewriter, rules);
  } else {
    highlighter?.stop();
    highlighter = null;
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
