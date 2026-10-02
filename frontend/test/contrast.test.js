import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// WCAG 2.x contrast of the colour token pairs that carry text
// (docs/ui-guideline.md §1.1): normal-size text needs 4.5:1.
const SRC = new URL('../src/', import.meta.url).pathname;
const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
const root = tokens.slice(tokens.indexOf(':root'), tokens.indexOf('}', tokens.indexOf(':root')));
const value = (name) => {
  const m = root.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(m, `${name} is defined in tokens.css`);
  return m[1].trim();
};

function rgba(text) {
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const fn = text.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(fn, `colour literal: ${text}`);
  const [r, g, b, a = 1] = fn[1].split(',').map((x) => Number(x.trim()));
  return [r, g, b, a];
}
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
const luminance = (rgb) => {
  const [R, G, B] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
export function contrast(fgText, bgText) {
  const bg = rgba(bgText);
  const fg = over(rgba(fgText), bg);
  const [hi, lo] = [luminance(fg), luminance(bg.slice(0, 3))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const check = (fgs, bgs) => {
  const fails = [];
  for (const f of fgs) for (const b of bgs) {
    const ratio = contrast(value(f), value(b));
    if (ratio < 4.5) fails.push(`${f} on ${b}: ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(fails, []);
};

test('text tokens reach 4.5:1 on the white surface', () => {
  check(['--pw-text', '--pw-text-secondary', '--pw-text-header', '--pw-text-muted', '--pw-text-meta', '--pw-text-stat',
    '--pw-primary', '--pw-accent', '--pw-tab', '--pw-error', '--pw-warning', '--pw-success', '--pw-info'], ['--pw-surface']);
});

test('on-tint text tokens reach 4.5:1 on every tinted surface', () => {
  check(['--pw-text-meta-on-tint', '--pw-text-muted-on-tint', '--pw-error-on-tint', '--pw-warning-on-tint',
    '--pw-info-on-tint', '--pw-success-on-tint', '--pw-text-header', '--pw-text-secondary', '--pw-text-stat'],
  ['--pw-surface-tint', '--pw-surface-container', '--pw-hover-row', '--pw-selected']);
});

test('on-tint tokens also stay readable on the white surface (a nested white panel inherits them)', () => {
  check(['--pw-text-meta-on-tint', '--pw-error-on-tint', '--pw-warning-on-tint', '--pw-info-on-tint', '--pw-success-on-tint'], ['--pw-surface']);
});

test('the tinted card swaps in the on-tint tokens', () => {
  const card = readFileSync(join(SRC, 'components/card.css'), 'utf8');
  for (const name of ['--pw-text-meta', '--pw-text-muted', '--pw-error', '--pw-warning', '--pw-info']) {
    assert.match(card, new RegExp(`${name}:\\s*var\\(${name}-on-tint\\)`));
  }
});

test('--pw-chart-axis (2.7:1) is never a text colour', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const offenders = [];
  for (const file of walk(SRC).filter((f) => f.endsWith('.css'))) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, selector, body] = rule;
      if (/(?:^|;|\s)color:\s*var\(--pw-chart-axis\)/.test(body)) offenders.push(`${file}: ${selector.trim()}`);
      if (/fill:\s*var\(--pw-chart-axis\)/.test(body) && /text|tick|label|month/i.test(selector)) offenders.push(`${file}: ${selector.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
