import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createTranslator, hasLetters, normalizeText, replacementGroups, templateGroups, templateToRegexSource,
} from '../src/i18n/translate.js';
import manualPatterns from '../src/i18n/en/patterns.js';

// Coverage of the language switch (src/i18n). The structural checks always
// run. "Every catalog string has an English translation" is enforced once
// src/i18n/en/.complete exists (the marker is created when the dictionary is
// filled); until then the missing count is only reported.
//
// One chunk only (for a translator):  I18N_CHUNK=pages-sales-1 node --test test/i18nCoverage.test.js
// — that run fails on any untranslated string of that chunk, marker or not.

const I18N = fileURLToPath(new URL('../src/i18n/', import.meta.url));
const EN = `${I18N}en/`;
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const CHUNK = process.env.I18N_CHUNK || '';

const catalog = json(`${I18N}catalog/strings.json`);
const globalSame = json(`${I18N}same.json`);
const enFiles = readdirSync(EN).filter((name) => name.endsWith('.json')).sort();
const exactFiles = enFiles.filter((name) => !name.endsWith('.patterns.json') && !name.endsWith('.same.json'));
const patternFiles = enFiles.filter((name) => name.endsWith('.patterns.json'));
const sameFiles = enFiles.filter((name) => name.endsWith('.same.json'));

const exact = {};
const templates = {};
const same = new Set(globalSame.map(normalizeText));
for (const name of exactFiles) for (const [key, value] of Object.entries(json(EN + name))) exact[normalizeText(key)] = value;
for (const name of patternFiles) Object.assign(templates, json(EN + name));
for (const name of sameFiles) for (const text of json(EN + name)) same.add(normalizeText(text));

const covered = (entry) => {
  if (same.has(entry.text)) return true;
  const value = entry.kind === 'exact' ? exact[entry.text] : templates[entry.text];
  return typeof value === 'string' && value.trim() !== '';
};

test('the catalog is current (re-run scripts/i18n-extract.mjs after changing interface text)', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/i18n-extract.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('the catalog is well-formed', () => {
  assert.ok(catalog.length > 1000, 'the catalog lists the interface text');
  const seen = new Set();
  for (const entry of catalog) {
    assert.ok(entry.kind === 'exact' || entry.kind === 'pattern', entry.text);
    assert.equal(entry.text, normalizeText(entry.text), 'catalog text is normalised');
    assert.ok(hasLetters(entry.text), `no letters: ${entry.text}`);
    assert.ok(entry.chunk && entry.sources.length, entry.text);
    const id = `${entry.kind}:${entry.text}`;
    assert.ok(!seen.has(id), `duplicate: ${entry.text}`);
    seen.add(id);
    if (entry.kind === 'pattern') {
      assert.equal(entry.regex, templateToRegexSource(entry.text), entry.text);
      assert.doesNotThrow(() => new RegExp(entry.regex));
      const groups = templateGroups(entry.text);
      assert.ok(groups.length > 0, `a pattern has placeholders: ${entry.text}`);
      assert.equal(entry.vars.length, groups.length, entry.text);
    }
  }
});

test('dictionary files are flat { Indonesian: English } objects', () => {
  for (const name of [...exactFiles, ...patternFiles]) {
    const content = json(EN + name);
    assert.ok(content && typeof content === 'object' && !Array.isArray(content), name);
    for (const [key, value] of Object.entries(content)) {
      assert.equal(typeof value, 'string', `${name}: ${key}`);
      assert.equal(key, normalizeText(key), `${name}: key is not normalised: ${JSON.stringify(key)}`);
    }
  }
  for (const name of sameFiles) assert.ok(Array.isArray(json(EN + name)), name);
  assert.ok(Array.isArray(globalSame) && globalSame.every((text) => typeof text === 'string'));
  assert.ok(json(`${I18N}ignore.json`).every((text) => typeof text === 'string'));
});

test('no translation is empty, or identical to the Indonesian without being listed as same', () => {
  const problems = [];
  for (const name of exactFiles) {
    for (const [key, value] of Object.entries(json(EN + name))) {
      if (value.trim() === '') problems.push(`${name}: empty: ${key}`);
      else if (normalizeText(value) === key && !same.has(key)) problems.push(`${name}: identical (add to a same list or translate): ${key}`);
      else if (/^\s|\s$/.test(value)) problems.push(`${name}: leading/trailing space: ${key}`);
    }
  }
  for (const name of patternFiles) {
    for (const [key, value] of Object.entries(json(EN + name))) {
      if (value.trim() === '') problems.push(`${name}: empty: ${key}`);
      else if (value === key && !same.has(key)) problems.push(`${name}: identical (add to a same list or translate): ${key}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('pattern placeholders match their groups', () => {
  const problems = [];
  for (const name of patternFiles) {
    for (const [template, to] of Object.entries(json(EN + name))) {
      const groups = [...new Set(templateGroups(template))].sort((a, b) => a - b);
      const used = [...new Set(replacementGroups(to).map((g) => g.n))].sort((a, b) => a - b);
      if (!groups.length) problems.push(`${name}: no $n in the Indonesian side: ${template}`);
      const unknown = used.filter((n) => !groups.includes(n));
      const dropped = groups.filter((n) => !used.includes(n));
      if (unknown.length) problems.push(`${name}: $${unknown.join(', $')} is not in the Indonesian side: ${template}`);
      if (dropped.length) problems.push(`${name}: $${dropped.join(', $')} is missing in the English side: ${template}`);
    }
  }
  manualPatterns.forEach((pattern, index) => {
    let re;
    try { re = pattern.match instanceof RegExp ? pattern.match : new RegExp(pattern.match); } catch { problems.push(`patterns.js #${index}: bad regex`); return; }
    if (!re.source.startsWith('^') || !re.source.endsWith('$')) problems.push(`patterns.js #${index}: must be anchored ^…$`);
    if (typeof pattern.to === 'function') return;
    const count = new RegExp(`${re.source}|`).exec('').length - 1;
    for (const group of replacementGroups(pattern.to)) {
      if (group.n < 1 || group.n > count) problems.push(`patterns.js #${index}: $${group.n} has no group in ${re.source}`);
    }
  });
  assert.deepEqual(problems, []);
});

test('the dictionary loads and translates', () => {
  const translate = createTranslator({ exact, templates, patterns: manualPatterns });
  assert.equal(translate('Simpan'), 'Save');
  assert.equal(translate('Batal'), 'Cancel');
  assert.equal(translate('PT Contoh Pelanggan 123'), 'PT Contoh Pelanggan 123');
});

test('every catalog string has an English translation', (t) => {
  const scope = CHUNK ? catalog.filter((entry) => entry.chunk === CHUNK) : catalog;
  if (CHUNK) assert.ok(scope.length, `no such chunk: ${CHUNK}`);
  const missing = scope.filter((entry) => !covered(entry));
  const enforced = Boolean(CHUNK) || existsSync(`${EN}.complete`);
  if (!enforced) {
    t.diagnostic(`${missing.length} of ${scope.length} catalog strings are not translated yet (enforced once src/i18n/en/.complete exists)`);
    return;
  }
  const list = missing.slice(0, 40).map((entry) => `  [${entry.chunk}] ${entry.kind}: ${entry.text}  (${entry.sources[0]})`).join('\n');
  assert.equal(missing.length, 0, `${missing.length} untranslated string(s):\n${list}`);
});
