import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Enforces docs/ui-guideline.md. Each BUDGET map is the remaining debt per file:
// a file may go DOWN (update the number) but never up, and a file not listed
// has a budget of 0. When a number reaches 0, delete the line.
//
// Re-baseline: `UI_BUDGETS=print node test/uiGuideline.test.js` prints every
// budget map with today's counts, ready to paste over the maps below (only
// ever to LOWER a number — a count that went up is a regression to fix).

const SRC = new URL('../src/', import.meta.url).pathname;
const DOCS = new URL('../../docs/', import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = walk(SRC);
const jsx = files.filter((f) => f.endsWith('.jsx'));
const pages = jsx.filter((f) => relative(SRC, f).startsWith('pages/'));
const components = jsx.filter((f) => relative(SRC, f).startsWith('components/'));
const css = files.filter((f) => f.endsWith('.css'));
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(SRC, f);
const TOKENS_CSS = 'styles/tokens.css';

// Comments do not count: CSS block comments, and JSX/JS comments that start a
// line or sit in {/* … */} (a string like accept="image/*" is left alone).
const cssCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const jsxCode = (text) => text
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '');

// Opening JSX tags with their attributes. `top` is the attribute text with
// every {…} expression emptied, so a prop inside a nested expression (a
// render function, a nested element) is not taken for the tag's own prop;
// nested elements are listed as tags of their own.
function jsxTags(text) {
  const tags = [];
  for (const m of text.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = '';
    let top = '';
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = ''; if (!depth) top += ch; continue; }
      if (depth === 0 && (ch === '"' || ch === "'")) { quote = ch; top += ch; continue; }
      if (ch === '{') { depth += 1; if (depth === 1) top += '{'; continue; }
      if (ch === '}') { depth -= 1; if (depth === 0) top += '}'; continue; }
      if (depth === 0 && ch === '>') break;
      if (depth === 0) top += ch;
    }
    tags.push({ name: m[1], top, attrs: text.slice(m.index + m[0].length, i) });
  }
  return tags;
}
const countTags = (text, predicate) => jsxTags(jsxCode(text)).filter(predicate).length;

function checkBudget(name, list, pattern, budget, hint) {
  const over = [];
  const stale = [];
  for (const file of list) {
    const count = countOf(pattern, file);
    const allowed = budget[rel(file)] || 0;
    if (count > allowed) over.push(`${rel(file)} (${count} > ${allowed})`);
    if (budget[rel(file)] !== undefined && count < allowed) stale.push(`${rel(file)}: now ${count}, lower the budget`);
  }
  assert.deepEqual(over, [], `${name}: ${hint}\n  ${over.join('\n  ')}`);
  assert.deepEqual(stale, [], `${name}: budget is higher than needed\n  ${stale.join('\n  ')}`);
}
// A check counts with a RegExp (raw file text) or a function (text, file) → n.
function countOf(pattern, file) {
  const text = read(file);
  return typeof pattern === 'function' ? pattern(text, file) : (text.match(pattern) || []).length;
}

// ============================================================ budgets

// §3.5 / §3.6 — ConfirmDialog + toast, never native browser dialogs.
export const NATIVE_DIALOG_BUDGET = {};
// §3.4 — status/priority tones live only in components/statusTone.js.
export const LOCAL_TONE_MAP_BUDGET = {};
// §1.1 — colours come from tokens only.
export const HEX_BUDGET = {};
// §3.1 — Input / Select / Textarea, never raw form controls in pages.
export const RAW_FIELD_BUDGET = {};
// §3.2 — Button / IconButton, never a raw <button> in pages.
export const RAW_BUTTON_BUDGET = {};
// §3.5 — Modal size="sm|md|lg", never a free maxWidth.
export const MODAL_WIDTH_BUDGET = {};
// §4.2 — inline style only for genuinely dynamic values.
export const INLINE_STYLE_BUDGET = {
  // Revenue bar width per month.
  // Kop preview: the accent colour the user picks (one CSS variable).
  'pages/documents/DocTemplateDialogs.jsx': 1,
  // Escalation bars: each source's share (one CSS variable).
};

// §1.9 — breakpoints still on the old 760/1279/1280 scale, per file.
export const OLD_BREAKPOINT_BUDGET = {};

// ---- audit §3 "New tests" (docs/audit-ui-admin-console.md). Baselined at the
// counts of 30 Sep 2026 while the page packages migrate; only ever lower them.

// §1.1 — hex / rgb / rgba in CSS outside tokens.css (print sheets included
// until they get print tokens).
export const CSS_COLOUR_BUDGET = {};
// §1.2 — font-weight 600 or more (700 only for the contextual toolbar count).
export const CSS_HEAVY_WEIGHT_BUDGET = {
  // Contextual toolbar count, 700 by the measurement (§4.9).
  'components/datagrid/datagrid.css': 1,
};
// §1.6 — z-index other than var(--pw-z-*) or a local 0 / 1 / -1.
export const CSS_Z_INDEX_BUDGET = {};
// §1.5 — literal or calc()-derived durations and easings in transition /
// animation (use --pw-dur-* and --pw-ease-*; `linear` and steps() are fine).
export const CSS_MOTION_BUDGET = {
  // Decorative 8–12s float loops of the login doodles.
  'styles/doodles.css': 4,
  // Autofill colour hold (9999s ease-in-out), a browser workaround.
  'styles/layout.css': 2,
};
// §1.4 — box-shadow with a literal colour (elevation comes from --pw-elev-*,
// lines from a colour token).
export const CSS_SHADOW_COLOUR_BUDGET = {};
// §5.3 — raw <button> / <input> in components outside the shared primitives.
export const COMPONENT_RAW_CONTROL_BUDGET = {
  'components/AppLauncher.jsx': 1,
  'components/Navbar.jsx': 8,
  'components/Sidebar.jsx': 1,
  'components/ai/AIAccountMenu.jsx': 1,
  'components/ai/AIConversation.jsx': 1,
  'components/ai/AIDocumentWorkspace.jsx': 1,
  'components/ai/AINewChat.jsx': 1,
  'components/ai/AISessionList.jsx': 4,
  'components/ai/AISteps.jsx': 1,
  'components/datagrid/DataGrid.jsx': 1,
  'components/datagrid/GridImportDialog.jsx': 1,
};
// §4.8 — role="tab" / role="tablist" outside TabBar.
export const ROLE_TAB_BUDGET = {};
// §4.12 — <Badge tone=…> in pages (statuses go through StatusBadge).
export const PAGE_BADGE_TONE_BUDGET = {
  // Dev gallery: shows every Badge tone.
  'pages/dev/gallery/DisplayGallery.jsx': 4,
};
// §4.1 — className="pw-button" on <a>/<Link> (use <Button to|href>).
export const LINK_BUTTON_CLASS_BUDGET = {};
// §4.9 — importing the legacy DataTable (deleted 1 Oct 2026; use DataGrid).
export const DATATABLE_IMPORT_BUDGET = {};
// §4.14 — native title= on an HTML element (use the `tooltip`/`label` prop).
export const NATIVE_TITLE_BUDGET = {};
// §1.11 — lucide-react imports (use <Icon>).
export const LUCIDE_IMPORT_BUDGET = {};
// §4.16 — toLocale*() or "IDR" in pages (use components/format.js).
export const PAGE_LOCALE_FORMAT_BUDGET = {};
// §1.2 — <b>, <strong> or bare <h3>/<h4> in pages (use the type classes).
export const PAGE_BOLD_HEADING_BUDGET = {};
// §4.15 — plain "Memuat…" text (use skeletons, Button loading, LoadingState).
export const LOADING_TEXT_BUDGET = {};
// §3.5 — Modal minWidth (use size).
export const MODAL_MIN_WIDTH_BUDGET = {};
// tokens.css compatibility layer — old names (--pw-on-surface-variant,
// --pw-outline-variant, --color-*, --text-*, --radius-*, --pw-font-2xs,
// --pw-font-display …) used outside tokens.css. The layer is deleted when
// this reaches 0.
export const COMPAT_TOKEN_BUDGET = {};

// ============================================================ counters

// The primitives that ARE the raw controls (docs/ui-guideline.md §5.3).
const PRIMITIVES = new Set([
  'components/Button.jsx', 'components/IconButton.jsx', 'components/Chip.jsx', 'components/Checkbox.jsx',
  'components/Radio.jsx', 'components/Switch.jsx', 'components/Input.jsx', 'components/Select.jsx',
  'components/Textarea.jsx', 'components/DateInput.jsx', 'components/SearchField.jsx', 'components/TabBar.jsx',
  'components/Segmented.jsx', 'components/Menu.jsx', 'components/fieldParts.jsx', 'components/controlParts.jsx',
  'components/datagrid/Pager.jsx', 'components/InfoTip.jsx',
  // The language switch "ID | EN" (its own compact segmented control).
  'components/LanguageSwitch.jsx',
  // The motion chart's month slider (a range input).
  'components/charts/MotionChart.jsx',
]);

const tokensText = read(join(SRC, TOKENS_CSS));
// Retired names of the old compatibility layer (deleted from tokens.css on
// 1 Oct 2026 once no file used them): none may come back.
export const COMPAT_TOKENS = [
  '--pw-on-surface', '--pw-on-surface-variant', '--pw-outline', '--pw-outline-variant', '--pw-surface-container-high', '--pw-background',
  '--pw-primary-container', '--pw-on-primary-container', '--pw-error-container', '--pw-font-2xs', '--pw-font-display', '--pw-elev-3',
  '--pw-duration-short', '--pw-duration-medium', '--pw-ease-emphasized', '--pw-control-height-sm', '--pw-google-blue', '--pw-google-blue-tint',
  '--pw-google-red', '--pw-google-red-tint', '--pw-google-yellow', '--pw-google-yellow-tint', '--pw-google-green', '--pw-google-green-tint',
  '--font-family-base', '--navbar-height', '--color-primary', '--color-primary-tint', '--color-secondary', '--color-accent',
  '--color-background', '--color-surface', '--color-text', '--color-text-muted', '--color-success', '--color-warning',
  '--color-error', '--color-border', '--radius-sm', '--radius-md', '--radius-lg', '--text-base',
];
const compatPattern = new RegExp(`var\\(\\s*(?:${COMPAT_TOKENS.map((t) => t.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`, 'g');

const count = (re) => (text) => (text.match(re) || []).length;
const MOTION_DECL = /(?:transition|animation)(?:-(?:duration|delay|timing-function))?\s*:\s*([^;}]+)/g;
const MOTION_LITERAL = /(?<![\w-])(?:\d*\.?\d+m?s\b|ease(?:-in-out|-in|-out)?\b|cubic-bezier\(|calc\()/g;

const CSS_CHECKS = [
  ['CSS colours', CSS_COLOUR_BUDGET, (t) => count(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)(cssCode(t)), 'use var(--pw-*) colour tokens (styles/tokens.css)'],
  ['CSS font-weight', CSS_HEAVY_WEIGHT_BUDGET, (t) => count(/font-weight:\s*(?:[6-9]00|bold|bolder)\b/g)(cssCode(t)), 'use 400 or 500 (§1.2)'],
  ['CSS z-index', CSS_Z_INDEX_BUDGET, (t) => count(/z-index:\s*(?!\s)(?!(?:-1|0|1)\s*(?:[;}!]|$)|var\(--pw-z-)[^;}]+/gm)(cssCode(t)), 'use var(--pw-z-*) (§1.6)'],
  ['CSS motion', CSS_MOTION_BUDGET, (t) => [...cssCode(t).matchAll(MOTION_DECL)]
    .reduce((n, m) => n + (m[1].replace(/\b0m?s\b/g, '').match(MOTION_LITERAL) || []).length, 0), 'use var(--pw-dur-*) and var(--pw-ease-*) (§1.5)'],
  ['CSS shadow colours', CSS_SHADOW_COLOUR_BUDGET, (t) => count(/box-shadow:\s*[^;}]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g)(cssCode(t)), 'use var(--pw-elev-*) or a colour token (§1.4)'],
];

const JSX_CHECKS = [
  ['raw controls in components', components.filter((f) => !PRIMITIVES.has(rel(f))), COMPONENT_RAW_CONTROL_BUDGET,
    (t) => countTags(t, (tag) => tag.name === 'button' || tag.name === 'input'), 'build on Button / IconButton / Chip / Input / Checkbox …'],
  ['role tab outside TabBar', jsx.filter((f) => rel(f) !== 'components/TabBar.jsx'), ROLE_TAB_BUDGET,
    (t) => count(/role=(?:"|'|\{['"`])tab(?:list)?['"`]/g)(jsxCode(t)), 'use <TabBar>'],
  ['Badge tone in pages', pages, PAGE_BADGE_TONE_BUDGET,
    (t) => countTags(t, (tag) => tag.name === 'Badge' && /(?:^|\s)tone=/.test(tag.top)), 'use <StatusBadge> / <PriorityBadge>'],
  ['pw-button class on links', jsx, LINK_BUTTON_CLASS_BUDGET,
    (t) => countTags(t, (tag) => /^(?:a|Link|NavLink)$/.test(tag.name) && /className=[^\n]*\bpw-button\b/.test(tag.attrs)), 'use <Button to|href>'],
  ['DataTable imports', jsx.filter((f) => rel(f) !== 'components/DataTable.jsx'), DATATABLE_IMPORT_BUDGET,
    (t) => count(/import[^;]*?from\s+['"][^'"]*\/DataTable['"]/g)(jsxCode(t)), 'use DataGrid'],
  ['native title on HTML elements', jsx, NATIVE_TITLE_BUDGET,
    // An <iframe title> is its accessible name, not a tooltip.
    (t) => countTags(t, (tag) => /^[a-z]/.test(tag.name) && !['svg', 'iframe'].includes(tag.name) && /(?:^|\s)title=/.test(tag.top)), 'use the tooltip / label prop of a shared component'],
  ['lucide imports', files.filter((f) => /\.jsx?$/.test(f)), LUCIDE_IMPORT_BUDGET,
    (t) => count(/from\s+['"]lucide-react['"]/g)(jsxCode(t)), 'use <Icon name="…"> (Material Symbols)'],
  ['toLocale / IDR in pages', pages, PAGE_LOCALE_FORMAT_BUDGET,
    (t) => count(/\.toLocale\w*\(|\bIDR\b/g)(jsxCode(t)), 'use formatDate / formatMoney / formatQty from components/format.js'],
  ['b / strong / bare h3 h4 in pages', pages, PAGE_BOLD_HEADING_BUDGET,
    (t) => count(/<(?:b|strong)[\s>]|<h[34]\s*>/g)(jsxCode(t)), 'use .pw-title-* / KeyValue / a 500-weight class'],
  // <LoadingState label="Memuat …"> and aria-labels are the allowed forms.
  ['plain "Memuat…" text', jsx.filter((f) => rel(f) !== 'components/EmptyState.jsx'), LOADING_TEXT_BUDGET,
    (t) => count(/Memuat[^'"`<>{}\n]*(?:…|\.\.\.)/g)(jsxCode(t)
      .replace(/<LoadingState\b[^>]*>/g, '')
      .replace(/aria-label=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, '')), 'use a skeleton, <Button loading> or <LoadingState />'],
  ['Modal minWidth', jsx, MODAL_MIN_WIDTH_BUDGET,
    (t) => countTags(t, (tag) => tag.name === 'Modal' && /(?:^|\s)minWidth=/.test(tag.top)), 'use <Modal size="sm|md|lg">'],
  ['compatibility tokens', files.filter((f) => /\.(css|jsx?)$/.test(f) && rel(f) !== TOKENS_CSS), COMPAT_TOKEN_BUDGET,
    (t, f) => count(compatPattern)(f.endsWith('.css') ? cssCode(t) : jsxCode(t)), 'use the new --pw-* names (docs/ui-guideline.md §1)'],
];

// Old 760/1279/1280 breakpoints in one CSS file (§1.9).
function oldBreakpoints(text) {
  let legacy = 0;
  for (const m of text.matchAll(/@media[^{]*?\((max|min)-width:\s*([0-9]+)px\)/g)) {
    if ((m[1] === 'max' && (m[2] === '760' || m[2] === '1279')) || (m[1] === 'min' && m[2] === '1280')) legacy += 1;
  }
  return legacy;
}

// Every budgeted check: `map` is the exported budget's name (for the print
// mode), `test` the test title of the older checks.
const CHECKS = [
  { map: 'NATIVE_DIALOG_BUDGET', name: 'native dialogs', test: 'no native alert/confirm/prompt (use toast / ConfirmDialog)', list: jsx,
    counter: /(?<![\w$.])(?:window\.)?(?:alert|confirm|prompt)\(/g, budget: NATIVE_DIALOG_BUDGET, hint: 'use toast() or <ConfirmDialog>' },
  { map: 'LOCAL_TONE_MAP_BUDGET', name: 'local tone maps', test: 'no local status tone maps (add statuses to components/statusTone.js)',
    list: files.filter((f) => /\.(jsx|js)$/.test(f) && !rel(f).endsWith('components/statusTone.js')),
    counter: /const [A-Z_]*TONES?\s*=/g, budget: LOCAL_TONE_MAP_BUDGET, hint: 'use statusTone()/priorityTone() or StatusBadge/PriorityBadge' },
  { map: 'HEX_BUDGET', name: 'hex/rgb colours', test: 'no hard-coded colours in JSX (use --pw-* tokens)', list: jsx,
    counter: /['"`]#[0-9a-fA-F]{3,8}\b|rgba?\(/g, budget: HEX_BUDGET, hint: 'use var(--pw-*) tokens or Badge tones' },
  { map: 'RAW_FIELD_BUDGET', name: 'raw form controls', test: 'pages use Input / Select / Textarea instead of raw form controls', list: pages,
    counter: /<input(?![^>]*type="(hidden|checkbox|radio|file|color|range)")[\s>]|<select[\s>]|<textarea[\s>]/g, budget: RAW_FIELD_BUDGET, hint: 'use components/Input, Select, Textarea' },
  { map: 'RAW_BUTTON_BUDGET', name: 'raw buttons', test: 'pages use Button / IconButton instead of raw <button>', list: pages,
    counter: /<button[\s>]/g, budget: RAW_BUTTON_BUDGET, hint: 'use components/Button or IconButton' },
  { map: 'MODAL_WIDTH_BUDGET', name: 'modal widths', test: 'modals use size="sm|md|lg" instead of a free maxWidth', list: jsx,
    counter: /<Modal[^>]*maxWidth=/g, budget: MODAL_WIDTH_BUDGET, hint: 'use <Modal size="sm|md|lg">' },
  { map: 'INLINE_STYLE_BUDGET', name: 'inline styles', test: 'pages keep inline style for dynamic values only', list: pages,
    counter: /style=\{\{/g, budget: INLINE_STYLE_BUDGET, hint: 'move static styles to a class' },
  { map: 'OLD_BREAKPOINT_BUDGET', name: 'old breakpoints', list: css, counter: oldBreakpoints, budget: OLD_BREAKPOINT_BUDGET, hint: 'use 600 / 1023 / 1024' },
  ...CSS_CHECKS.map(([name, budget, counter, hint]) => ({ name, list: css.filter((f) => rel(f) !== TOKENS_CSS), budget, counter, hint })),
  ...JSX_CHECKS.map(([name, list, budget, counter, hint]) => ({ name, list, budget, counter, hint })),
];
const MAP_NAMES = {
  'CSS colours': 'CSS_COLOUR_BUDGET', 'CSS font-weight': 'CSS_HEAVY_WEIGHT_BUDGET', 'CSS z-index': 'CSS_Z_INDEX_BUDGET',
  'CSS motion': 'CSS_MOTION_BUDGET', 'CSS shadow colours': 'CSS_SHADOW_COLOUR_BUDGET',
  'raw controls in components': 'COMPONENT_RAW_CONTROL_BUDGET', 'role tab outside TabBar': 'ROLE_TAB_BUDGET',
  'Badge tone in pages': 'PAGE_BADGE_TONE_BUDGET', 'pw-button class on links': 'LINK_BUTTON_CLASS_BUDGET',
  'DataTable imports': 'DATATABLE_IMPORT_BUDGET', 'native title on HTML elements': 'NATIVE_TITLE_BUDGET',
  'lucide imports': 'LUCIDE_IMPORT_BUDGET', 'toLocale / IDR in pages': 'PAGE_LOCALE_FORMAT_BUDGET',
  'b / strong / bare h3 h4 in pages': 'PAGE_BOLD_HEADING_BUDGET', 'plain "Memuat…" text': 'LOADING_TEXT_BUDGET',
  'Modal minWidth': 'MODAL_MIN_WIDTH_BUDGET', 'compatibility tokens': 'COMPAT_TOKEN_BUDGET',
};
for (const check of CHECKS) check.map ??= MAP_NAMES[check.name];

// `UI_BUDGETS=print node test/uiGuideline.test.js` prints every map with
// today's counts (a comment on an entry is not kept); tests do not run.
if (process.env.UI_BUDGETS === 'print') {
  for (const check of CHECKS) {
    const counts = check.list.map((f) => [rel(f), countOf(check.counter, f)]).filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const body = counts.map(([f, n]) => `  '${f}': ${n},`).join('\n');
    console.log(`export const ${check.map} = {${body ? `\n${body}\n` : ''}};`);
  }
  process.exit(0);
}

// ============================================================ tests

for (const check of CHECKS.filter((c) => c.test)) {
  test(check.test, () => checkBudget(check.name, check.list, check.counter, check.budget, check.hint));
}

test('CSS uses only the token type scale, radius scale and three breakpoints', () => {
  const problems = [];
  for (const file of css) {
    const text = read(file);
    for (const m of text.matchAll(/font-size:\s*([0-9.]+px)/g)) problems.push(`${rel(file)}: font-size ${m[1]} (use var(--pw-font-*))`);
    for (const m of text.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]*[0-9.]+px[^;]*)/g)) problems.push(`${rel(file)}: radius ${m[1]} (use var(--pw-radius-*))`);
    for (const m of text.matchAll(/@media[^{]*?\((max|min)-width:\s*([0-9]+)px\)/g)) {
      const ok = (m[1] === 'max' && (m[2] === '600' || m[2] === '1023')) || (m[1] === 'min' && m[2] === '1024');
      const old = (m[1] === 'max' && (m[2] === '760' || m[2] === '1279')) || (m[1] === 'min' && m[2] === '1280');
      if (!ok && !old) problems.push(`${rel(file)}: breakpoint ${m[1]}-width ${m[2]}px (only 600 / 1023 / 1024)`);
    }
  }
  assert.deepEqual(problems, []);
  // The design program moves every file to the admin console breakpoints
  // (docs/ui-guideline.md §1.9); the old 760/1279/1280 may only go down.
  checkBudget('old breakpoints', css, oldBreakpoints, OLD_BREAKPOINT_BUDGET, 'use 600 / 1023 / 1024');
});

for (const check of CHECKS.filter((c) => !c.test && c.map !== 'OLD_BREAKPOINT_BUDGET')) {
  test(`guideline budget: ${check.name}`, () => checkBudget(check.name, check.list, check.counter, check.budget, check.hint));
}

test('every token named in docs/ui-guideline.md exists in tokens.css', () => {
  const doc = readFileSync(join(DOCS, 'ui-guideline.md'), 'utf8');
  const named = [...new Set([...doc.matchAll(/--pw-[a-z0-9-]*[a-z0-9]/g)].map((m) => m[0]))];
  assert.ok(named.length > 50, 'the guideline names its tokens');
  const defined = new Set([...tokensText.matchAll(/(--pw-[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual(named.filter((token) => !defined.has(token)), [], 'tokens named in the guideline but missing in tokens.css');
});

test('the budget counters see what they are meant to see', () => {
  const tags = jsxTags('<a className="pw-button" href="/x" onClick={() => go(1)} title="t"><Badge tone="info" render={() => <b title="n" />} /></a>');
  assert.deepEqual(tags.map((tag) => tag.name), ['a', 'Badge', 'b']);
  assert.match(tags[0].top, /title="t"/);
  assert.doesNotMatch(tags[1].top, /title=/, 'a prop inside {…} is not the tag\'s own');
  assert.equal(countTags('<span title="x">a</span><Button title="y" />', (tag) => /^[a-z]/.test(tag.name) && /(?:^|\s)title=/.test(tag.top)), 1);
  const motion = CSS_CHECKS.find(([name]) => name === 'CSS motion')[2];
  assert.equal(motion('.a { transition: opacity var(--pw-dur-state) linear, width 0s; }'), 0);
  assert.equal(motion('.a { transition: opacity 200ms ease-in; animation: x calc(var(--pw-dur-xs) * 2) cubic-bezier(0,0,1,1); }'), 4);
  const z = CSS_CHECKS.find(([name]) => name === 'CSS z-index')[2];
  assert.equal(z('.a { z-index: 1; } .b { z-index: var(--pw-z-menu); } .c { z-index: 30; } .d { z-index: -1 }'), 1);
  assert.ok(COMPAT_TOKENS.includes('--pw-on-surface-variant') && COMPAT_TOKENS.includes('--color-primary') && !COMPAT_TOKENS.includes('--pw-primary'));
  assert.equal(count(compatPattern)('color: var(--pw-outline-variant); border: var(--pw-outline-panel); x: var(--pw-outline)'), 2);
});
