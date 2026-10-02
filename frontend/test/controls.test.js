import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Shared controls (docs/ui-guideline.md §1.10, §4.1–4.8, §4.14): the CSS of the
// control components takes colours, radii, layers and motion from tokens only,
// every control reaches the one ripple / tooltip layer, and the measured spec
// numbers stay in place.
const SRC = new URL('../src/', import.meta.url).pathname;
const read = (path) => readFileSync(`${SRC}${path}`, 'utf8');

const CONTROL_CSS = [
  'styles/state.css', 'components/button.css', 'components/icon-button.css', 'components/field.css',
  'components/tooltip.css', 'components/chip.css', 'components/tabs.css',
  'components/choice.css', 'components/segmented.css', 'components/search-field.css',
];

test('control CSS uses tokens for colour, radius, z-index and transition timing', () => {
  const problems = [];
  for (const file of CONTROL_CSS) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)) problems.push(`${file}: colour ${m[0]}`);
    for (const m of css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)) {
      if (!/^(0|var\(--pw-radius-[a-z-]+\)|inherit)$/.test(m[1].trim())) problems.push(`${file}: radius ${m[1]}`);
    }
    for (const m of css.matchAll(/z-index:\s*([^;]+);/g)) {
      if (!/^(-1|0|1|var\(--pw-z-[a-z]+\))$/.test(m[1].trim())) problems.push(`${file}: z-index ${m[1]}`);
    }
    for (const m of css.matchAll(/transition(?:-duration|-delay)?:\s*([^;]+);/g)) {
      if (/\b\d+(\.\d+)?m?s\b/.test(m[1].replace(/\b0s\b/g, ''))) problems.push(`${file}: transition timing ${m[1].trim()} (use --pw-dur-*)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every control is covered by the ripple, and the tooltip is installed with it', async () => {
  const { RIPPLE_SELECTOR } = await import('../src/styles/ripple.js');
  for (const cls of ['.pw-button', '.pw-icon-button', '.pw-chip', '.pw-choice', '.pw-segmented__button', '.pw-state-layer', '[role="tab"]']) {
    assert.ok(RIPPLE_SELECTOR.includes(cls), `ripple misses ${cls}`);
  }
  assert.match(read('styles/ripple.js'), /installPwTooltip\(root\)/);
});

test('state layer and ripple values follow §1.10', () => {
  const state = read('styles/state.css');
  assert.match(state, /transition: opacity var\(--pw-dur-state\) linear/);
  assert.match(state, /var\(--pw-state-layer-hover, var\(--pw-state-hover\)\)/);
  assert.match(state, /opacity: var\(--pw-state-focus\)/);
  assert.match(state, /opacity: var\(--pw-state-pressed\)/);
  assert.match(state, /opacity: var\(--pw-ripple-opacity\)/);
  assert.match(state, /animation: pw-ripple-grow var\(--pw-dur-ripple\)/);
  assert.match(read('components/button.css'), /--pw-button-bg: var\(--pw-primary\)/);
  assert.match(read('components/button.css'), /--pw-state-layer-hover: var\(--pw-state-hover-filled\)/);
  assert.doesNotMatch(read('components/button.css'), /:hover[^{]*\{[^}]*box-shadow/, 'buttons have no hover shadow');
});

test('field keeps the measured generation A numbers (§4.3)', () => {
  const css = read('components/field.css');
  assert.match(css, /\.pw-field__area \{[^}]*height: 50px;[^}]*padding-top: 10px;/);
  assert.match(css, /\.pw-field__input \{[^}]*height: 24px;/);
  assert.match(css, /\.pw-field__area::before \{ height: 1px; background: var\(--pw-outline-panel\); \}/);
  assert.match(css, /height: 2px;\s*background: var\(--pw-accent\);\s*transform: scaleX\(0\);/);
  assert.match(css, /\.pw-field__assist \{ min-height: 8px; \}/);
});

test('tooltip follows §4.14 and never uses the native title', () => {
  const css = read('components/tooltip.css');
  for (const rule of [/background: var\(--pw-tooltip-bg\)/, /color: var\(--pw-tooltip-text\)/, /letter-spacing: 0\.4px/, /padding: 4px 8px/, /min-height: 24px/, /z-index: var\(--pw-z-tooltip\)/, /border-radius: var\(--pw-radius-md\)/]) {
    assert.match(css, rule);
  }
  assert.match(read('components/tooltip.js'), /--pw-delay-tooltip/);
  for (const file of ['Button.jsx', 'IconButton.jsx', 'Chip.jsx', 'TabBar.jsx', 'Segmented.jsx', 'SearchField.jsx', 'Checkbox.jsx', 'Radio.jsx', 'Switch.jsx']) {
    assert.doesNotMatch(read(`components/${file}`), /\stitle=\{/, `${file} renders a native title`);
  }
});

test('tooltip opens 4px below (above without room), or 8px beside with placement right', async () => {
  const { tooltipPosition } = await import('../src/components/tooltip.js');
  const viewport = { width: 1440, height: 900 };
  const bubble = { width: 80, height: 24 };
  // A 40px rail pill at x 12–52: the label sits 8px to its right, centred on it.
  assert.deepEqual(tooltipPosition({ top: 100, bottom: 140, left: 12, right: 52 }, bubble, viewport, 'right'), { top: 108, left: 60, placement: 'right' });
  assert.deepEqual(tooltipPosition({ top: 100, bottom: 148, left: 200, right: 248 }, bubble, viewport), { top: 152, left: 184, placement: 'bottom' });
  assert.equal(tooltipPosition({ top: 860, bottom: 890, left: 200, right: 248 }, bubble, viewport).placement, 'top');
  assert.equal(tooltipPosition({ top: 100, bottom: 140, left: 1380, right: 1420 }, bubble, viewport, 'right').placement, 'left');
  const tooltip = read('components/tooltip.js');
  assert.match(tooltip, /data-pw-tooltip-placement/);
  assert.match(read('components/Sidebar.jsx'), /'data-pw-tooltip-placement': rail \? 'right'/, 'the rail uses the shared tooltip');
  assert.doesNotMatch(read('components/Sidebar.jsx'), /prakasa-sidebar__tooltip/, 'no second tooltip layer');
});

test('Chip trailing icon and the shared Menu radio / description / header', () => {
  const chip = read('components/Chip.jsx');
  assert.match(chip, /trailingIcon \? <span className="pw-chip__trailing" aria-hidden="true">/);
  assert.match(read('components/chip.css'), /\.pw-chip--trailing \{ padding-right: 4px; \}/);
  const menu = read('components/Menu.jsx');
  assert.match(menu, /role=\{radio \? 'menuitemradio' : 'menuitem'\}/);
  assert.match(menu, /aria-checked=\{radio \? Boolean\(item\.checked\) : undefined\}/);
  assert.match(menu, /className="pw-menu__description"/);
  assert.match(menu, /className="pw-menu__header" role="none"/);
  const css = read('components/menu.css');
  assert.match(css, /animation: pw-scale-in var\(--pw-dur-menu\)/);
  assert.match(css, /\.pw-menu__description \{[^}]*font-size: var\(--pw-font-xs\);[^}]*line-height: 16px;/);
});
