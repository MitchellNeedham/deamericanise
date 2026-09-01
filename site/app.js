import {
  CATEGORIES,
  DIALECTS,
  deamericanise,
  deamericaniseFile,
  ruleIds,
} from './vendor/deamericanise.js';

const $ = (id) => document.getElementById(id);
const input = $('input');
const output = $('output');
const report = $('report');
const tip = $('tip');
const filename = $('filename');

/** Set when a file is dropped or chosen, so a .ts file has only its comments rewritten. */
let currentFile = null;

const SAMPLE =
  'The color of my favorite theater was gray, and the whole neighborhood canceled its ' +
  'plans. It is 6 feet 2 inches wide, weighs 180 pounds, and the oven runs at 350°F. On ' +
  'mild days in the 70s a parked car still gets dangerous. We paid $500 on 3/14/2024 for ' +
  'a 3/8 inch bolt and an aluminum bracket, then drove 50 miles at 60 mph to the gas ' +
  'station on the sidewalk side of the parking lot. Dime to quarter-sized hail dented ' +
  'the hood, and in my judgment the tire was ruined.';

/**
 * Rules the visitor has switched off. Only these are passed to the library: a ticked rule
 * is left unmentioned so the mode and confidence settings still govern it, rather than
 * being forced on.
 */
const disabled = new Set();

function options() {
  const confidence = [...document.querySelectorAll('.tiers input:checked')].map((b) => b.value);
  return {
    preset: $('preset').value,
    dialect: $('dialect').value,
    // An empty tier list would mean "run nothing", which is never what an empty set of
    // ticks is meant to say, so fall back to all of them.
    confidence: confidence.length ? confidence : ['safe', 'moderate', 'risky'],
    rules: Object.fromEntries([...disabled].map((id) => [id, false])),
  };
}

const escape = (s) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Rebuilds the text from the source, since change offsets index the input, not the result. */
function highlight(source, changes) {
  let html = '';
  let cursor = 0;
  for (const c of changes) {
    html += escape(source.slice(cursor, c.start));
    html +=
      `<span class="chg cat-${c.category} conf-${c.confidence}"` +
      ` data-before="${escape(c.before)}" data-after="${escape(c.after)}"` +
      ` data-rule="${c.ruleId}" data-confidence="${c.confidence}"` +
      ` data-note="${escape(c.note ?? '')}">${escape(c.after)}</span>`;
    cursor = c.end;
  }
  return html + escape(source.slice(cursor));
}

function countBy(changes, key) {
  const counts = new Map();
  for (const c of changes) counts.set(c[key], (counts.get(c[key]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function renderReport(result) {
  const { changes, signals } = result;
  const percent = Math.round(signals.confidence * 100);
  const cleared = signals.confidence >= 0.5;

  const categories = countBy(changes, 'category')
    .map(
      ([cat, n]) =>
        `<li class="cat-${cat}"><span class="swatch"></span>${cat}<span class="tally">${n}</span></li>`,
    )
    .join('');

  const list = changes.length
    ? changes
        .map(
          (c) =>
            `<li class="cat-${c.category}"><span><span class="was">${escape(c.before)}</span> ` +
            `<span class="now">${escape(c.after)}</span><br><span class="rule">${c.ruleId}</span></span></li>`,
        )
        .join('')
    : '<li class="empty">Nothing changed.</li>';

  const dates =
    signals.unambiguousMonthFirstDates + signals.unambiguousDayFirstDates > 0
      ? `<p class="rule">Numeric dates stating their own order: ${signals.unambiguousMonthFirstDates} month-first,
         ${signals.unambiguousDayFirstDates} day-first.</p>`
      : '';

  report.innerHTML = `
    <div class="score">${percent}%<small>American. ${
      cleared ? 'Above' : 'Below'
    } the 0.5 bar, so the rules that need to know where the text came from ${
      cleared ? 'ran' : 'did not run'
    }.</small></div>
    <div class="meter"><i style="width:${percent}%"></i></div>
    ${
      signals.markers.length
        ? `<h3>Markers</h3><ul>${signals.markers
            .map((m) => `<li>${escape(m)}</li>`)
            .join('')}</ul>`
        : '<p class="empty">No American markers found.</p>'
    }
    ${dates}
    <h3>${changes.length} change${changes.length === 1 ? '' : 's'}</h3>
    <ul>${categories}</ul>
    <h3>Detail</h3>
    <ul>${list}</ul>
  `;
}

let lastResult = { text: '' };

function run() {
  const source = input.value;
  if (!source.trim()) {
    output.innerHTML = '';
    report.innerHTML = '<p class="empty">Nothing to report yet.</p>';
    lastResult = { text: '' };
    return;
  }

  const result = currentFile
    ? deamericaniseFile(currentFile, source, options())
    : deamericanise(source, options());

  lastResult = result;
  output.innerHTML = highlight(source, result.changes);
  renderReport(result);
  updateRuleHits(result.changes);
}

// ----- rule browser -----
const GROUP_ORDER = [
  'spelling', 'vocabulary', 'dialect', 'units', 'dates', 'times',
  'currency', 'punctuation', 'grammar', 'misc',
];

function buildRules() {
  const ids = ruleIds($('dialect').value);
  const groups = new Map();
  for (const id of ids) {
    const group = id.split('.')[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
  }

  const rank = (group) => {
    const index = GROUP_ORDER.indexOf(group);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  const ordered = [...groups].sort((a, b) => rank(a[0]) - rank(b[0]));

  $('rules').innerHTML = ordered
    .map(
      ([group, list]) => `<div class="rule-group cat-${group}">
        <h4>${group} <span class="rule">${list.length}</span>
          <button type="button" data-group="${group}">none</button></h4>
        ${list
          .map(
            (id) =>
              `<label data-rule="${id}"><input type="checkbox" value="${id}"${
                disabled.has(id) ? '' : ' checked'
              }><span>${id.slice(group.length + 1) || id}</span><span class="hits"></span></label>`,
          )
          .join('')}
      </div>`,
    )
    .join('');

  $('rules-count').textContent = `${ids.length} in total`;
}

function updateRuleHits(changes) {
  const hits = new Map();
  for (const c of changes) hits.set(c.ruleId, (hits.get(c.ruleId) ?? 0) + 1);
  for (const label of document.querySelectorAll('.rule-group label')) {
    const n = hits.get(label.dataset.rule) ?? 0;
    label.classList.toggle('fired', n > 0);
    label.querySelector('.hits').textContent = n || '';
  }
}

$('rules').addEventListener('change', (event) => {
  const box = event.target;
  if (box.type !== 'checkbox') return;
  if (box.checked) disabled.delete(box.value);
  else disabled.add(box.value);
  run();
});

$('rules').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-group]');
  if (!button) return;
  const boxes = [...$('rules').querySelectorAll(`.cat-${button.dataset.group} input`)];
  const turningOff = boxes.some((b) => b.checked);
  for (const box of boxes) {
    box.checked = !turningOff;
    if (turningOff) disabled.add(box.value);
    else disabled.delete(box.value);
  }
  button.textContent = turningOff ? 'all' : 'none';
  run();
});

$('rules-reset').addEventListener('click', () => {
  disabled.clear();
  buildRules();
  run();
});

// ----- tooltips -----
output.addEventListener('mouseover', (event) => {
  const target = event.target.closest('.chg');
  if (!target) return;
  const note = target.dataset.note;
  tip.innerHTML =
    `<b>${escape(target.dataset.before)}</b> &rarr; <b>${escape(target.dataset.after)}</b>` +
    `<span class="rule">${target.dataset.rule} &middot; ${target.dataset.confidence}</span>` +
    (note ? `<span class="rule">${escape(note)}</span>` : '');
  tip.hidden = false;
  const box = target.getBoundingClientRect();
  const width = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  tip.style.top = `${box.bottom + 8}px`;
});
output.addEventListener('mouseout', (event) => {
  if (event.target.closest('.chg')) tip.hidden = true;
});

// ----- input -----
input.addEventListener('input', () => {
  currentFile = null;
  filename.hidden = true;
  run();
});
$('preset').addEventListener('change', run);
$('dialect').addEventListener('change', () => {
  // The dialect changes which rule ids exist, so the list is rebuilt.
  buildRules();
  run();
});
function updateTierLabel() {
  const chosen = [...document.querySelectorAll('.tiers input:checked')].map((b) => b.value);
  $('tiers-label').textContent =
    chosen.length === 3 ? 'all three' : chosen.length ? chosen.join(', ') : 'none, so all three';
}

for (const box of document.querySelectorAll('.tiers input')) {
  box.addEventListener('change', () => {
    updateTierLabel();
    run();
  });
}

// Clicking away closes the menu, the way a dropdown should.
document.addEventListener('click', (event) => {
  const tiers = $('tiers');
  if (tiers.open && !tiers.contains(event.target)) tiers.open = false;
});

async function loadFile(file) {
  input.value = await file.text();
  currentFile = file.name;
  filename.hidden = false;
  filename.textContent = file.name;
  run();
}

$('file').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file);
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    document.body.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    document.body.classList.remove('dragging');
  });
}
document.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (file) loadFile(file);
});

$('sample').addEventListener('click', () => {
  input.value = SAMPLE;
  currentFile = null;
  filename.hidden = true;
  run();
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(lastResult.text ?? '');
  $('copy').textContent = 'Copied';
  setTimeout(() => ($('copy').textContent = 'Copy'), 1200);
});

$('download').addEventListener('click', () => {
  const blob = new Blob([lastResult.text ?? ''], { type: 'text/plain' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: currentFile ?? 'deamericanised.txt',
  });
  link.click();
  URL.revokeObjectURL(link.href);
});

// ----- boot -----
for (const [id, pack] of Object.entries(DIALECTS)) {
  $('dialect').append(new Option(`${id}: ${pack.label}`, id));
}
void CATEGORIES;
updateTierLabel();
buildRules();
run();
