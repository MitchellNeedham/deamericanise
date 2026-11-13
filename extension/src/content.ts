import { DomRewriter, type DomOptions } from '../../src/dom/index.js';
import { api } from './browser.js';
import { Highlighter, type RuleSwitch } from './highlight.js';
import {
  affectsHost,
  catalogue,
  DEFAULTS,
  domOptions,
  isEnabledOn,
  loadSettings,
  switchOffRule,
  writingOptions,
  type Settings,
  type Status,
} from './settings.js';
import { Suggester } from './suggest.js';

let rewriter: DomRewriter | null = null;
let highlighter: Highlighter | null = null;
let suggester: Suggester | null = null;
let applied = '';
/** The options the suggester was last given. */
let writing = '';
const host = location.hostname;
let current: Settings = DEFAULTS;

const rules: RuleSwitch = {
  canSwitchOff: (ruleId) => catalogue(current.dialect).get(ruleId)?.switchable !== false,
  switchOff: (ruleId) => void switchOffRule(ruleId),
};

/** Finds closed shadow roots as well as open ones. */
function shadowRootOf(host: Element): ShadowRoot | null {
  if (api.dom) return api.dom.openOrClosedShadowRoot(host as HTMLElement);
  // Firefox has no `dom` API, and shows extensions a closed root on the element itself.
  const element = host as Element & { openOrClosedShadowRoot?: ShadowRoot | null };
  return element.openOrClosedShadowRoot ?? host.shadowRoot;
}

function apply(settings: Settings): void {
  current = settings;
  if (!isEnabledOn(settings, host)) {
    highlighter?.stop();
    highlighter = null;
    rewriter?.stop({ restore: true });
    rewriter = null;
    suggester?.stop();
    suggester = null;
    writing = '';
    return;
  }

  const options: DomOptions = { ...domOptions(settings), shadowRoot: shadowRootOf };
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

  // Last, and on its own, so nothing that goes wrong in it can keep the page from being rewritten.
  try {
    suggest(settings);
  } catch (error) {
    suggester?.stop();
    suggester = null;
    writing = '';
    console.error('deamericanise: suggestions while writing stopped', error);
  }
}

function suggest(settings: Settings): void {
  if (!settings.suggest) {
    suggester?.stop();
    suggester = null;
    writing = '';
    return;
  }
  const options = writingOptions(settings);
  // A change to another setting leaves the marks where they are.
  const key = JSON.stringify(options);
  if (!suggester) suggester = new Suggester(options, shadowRootOf);
  else if (key !== writing) suggester.setOptions(options);
  writing = key;
}

void loadSettings().then(apply);

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && affectsHost(changes, host)) void loadSettings().then(apply);
});

api.runtime.onMessage.addListener((message, _, respond) => {
  if ((message as { type?: string }).type !== 'status') return;
  const status: Status = { host, enabled: rewriter !== null, changes: rewriter?.changes().length ?? 0 };
  respond(status);
});
