import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALWAYS_UI_ATTRIBUTES, TRANSLATED_ATTRIBUTES, areAttributesTranslatable, contextTranslation, hasLabelValue, isHardSkipped, isTranslatable, nextState, ownZone, restoreValue,
} from '../src/i18n/domCore.js';
import contexts from '../src/i18n/en/contexts.js';
import { cellTranslation } from '../src/components/datagrid/gridModel.js';

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// A minimal element: a tag, attributes and a parent (no browser needed).
function el(tagName, attrs = {}, parentElement = null) {
  return {
    tagName: tagName.toUpperCase(),
    parentElement,
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };
}
const translate = (text) => ({ Simpan: 'Save', Batal: 'Cancel', Selesai: 'Done' }[text] ?? text);

test('own writes are told apart from React updates', () => {
  // First sight: translate and remember.
  let step = nextState(undefined, 'Simpan', translate);
  assert.deepEqual(step, { record: { original: 'Simpan', written: 'Save' }, write: 'Save' });
  // The mutation caused by our own write: nothing to do, same record.
  const record = step.record;
  step = nextState(record, 'Save', translate);
  assert.equal(step.write, null);
  assert.equal(step.record, record);
  // React sets a new Indonesian text: a new original.
  step = nextState(record, 'Batal', translate);
  assert.deepEqual(step, { record: { original: 'Batal', written: 'Cancel' }, write: 'Cancel' });
  // React sets text with no translation: remembered, not written.
  step = nextState(step.record, 'PT Maju Jaya', translate);
  assert.deepEqual(step, { record: { original: 'PT Maju Jaya', written: 'PT Maju Jaya' }, write: null });
  // …and back to a known text.
  assert.equal(nextState(step.record, 'Simpan', translate).write, 'Save');
});

test('restoring gives the original back only while the page still shows our text', () => {
  assert.equal(restoreValue({ original: 'Simpan', written: 'Save' }, 'Save'), 'Simpan');
  assert.equal(restoreValue({ original: 'Simpan', written: 'Save' }, 'Batal'), null, 'React changed it since');
  assert.equal(restoreValue({ original: 'Toko', written: 'Toko' }, 'Toko'), null);
  assert.equal(restoreValue(undefined, 'Save'), null);
});

test('record data is skipped: the nearest marker decides', () => {
  const body = el('body');
  const page = el('div', {}, body);
  assert.equal(isTranslatable(page), true, 'no marker: interface text');

  const cell = el('td', { 'data-no-translate': '' }, el('tr', {}, page));
  const name = el('span', {}, cell);
  assert.equal(isTranslatable(cell), false);
  assert.equal(isTranslatable(name), false, 'a customer name deep in a data cell');

  // A status label inside the data cell opts back in…
  const badge = el('span', { 'data-translate': '' }, cell);
  assert.equal(isTranslatable(badge), true);
  assert.equal(isTranslatable(el('b', {}, badge)), true);
  // …and record data inside that label opts out again.
  assert.equal(isTranslatable(el('span', { 'data-no-translate': '' }, badge)), false);
  // On one element, no-translate wins.
  assert.equal(ownZone(el('span', { 'data-no-translate': '', 'data-translate': '' })), false);
});

test('an icon ligature is never translated, its label still is', () => {
  const button = el('button', {});
  const icon = el('span', { 'data-no-translate': 'text', 'aria-label': 'Tutup' }, button);
  assert.equal(isTranslatable(icon), false, 'the ligature ("close", "search", "error") is a symbol name');
  assert.equal(areAttributesTranslatable(icon), true);
  const inCell = el('span', { 'data-no-translate': 'text' }, el('td', { 'data-no-translate': '' }));
  assert.equal(areAttributesTranslatable(inCell), false, 'attributes follow the zone the icon sits in');
  assert.equal(areAttributesTranslatable(el('td', { 'data-no-translate': '' })), false);
  assert.match(src('components/Icon.jsx'), /aria-hidden="true" data-no-translate="text">\{name\}/);
});

test('code, preformatted text, scripts, styles and editable content are never translated', () => {
  for (const tag of ['script', 'style', 'code', 'pre', 'textarea', 'noscript']) {
    assert.equal(isHardSkipped(el(tag)), true);
    assert.equal(isTranslatable(el('span', {}, el(tag))), false, tag);
  }
  assert.equal(isHardSkipped(el('STYLE')), true);
  assert.equal(isHardSkipped({ tagName: 'style' }), true, 'SVG elements have lower-case tag names');
  assert.equal(isTranslatable(el('div', { contenteditable: 'true' })), false);
  assert.equal(isTranslatable(el('div', { contenteditable: '' })), false);
  assert.equal(isTranslatable(el('p', {}, el('div', { contenteditable: 'plaintext-only' }))), false);
  assert.equal(isTranslatable(el('div', { contenteditable: 'false' })), true);
  // SVG text is ordinary text.
  assert.equal(isTranslatable(el('tspan', {}, el('text', {}, el('svg')))), true);
});

test('typed values are never touched; only button-like inputs have a label value', () => {
  assert.equal(TRANSLATED_ATTRIBUTES.includes('value'), false);
  for (const name of ['placeholder', 'aria-label', 'title', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext']) {
    assert.ok(TRANSLATED_ATTRIBUTES.includes(name), name);
  }
  assert.equal(hasLabelValue(el('input', { type: 'submit' })), true);
  assert.equal(hasLabelValue(el('input', { type: 'button' })), true);
  assert.equal(hasLabelValue(el('input', { type: 'text' })), false);
  assert.equal(hasLabelValue(el('input', {})), false);
  assert.equal(hasLabelValue(el('textarea', { type: 'submit' })), false);
  assert.ok(ALWAYS_UI_ATTRIBUTES.has('data-label'), 'a cell\'s column header is interface text');
  assert.equal(ALWAYS_UI_ATTRIBUTES.has('aria-label'), false);
});

test('DataGrid: cell values are record data unless the column shows labels', () => {
  const no = { 'data-no-translate': '' };
  const yes = { 'data-translate': '' };
  assert.deepEqual(cellTranslation({ key: 'customerName' }), no, 'plain text from the record');
  assert.deepEqual(cellTranslation({ key: 'notes', type: 'text' }), no);
  assert.deepEqual(cellTranslation({ key: 'total', type: 'money' }), no);
  assert.deepEqual(cellTranslation({ key: 'x', render: () => 'Wajib' }), no, 'a render is data until the column says otherwise');
  assert.deepEqual(cellTranslation({ key: 'x', render: () => 'Wajib', translate: true }), yes);
  assert.deepEqual(cellTranslation({ key: 'isActive', type: 'boolean' }), yes, 'Ya / Tidak');
  assert.deepEqual(cellTranslation({ key: 'kind', type: 'select', options: [] }), yes, 'option labels');
  assert.deepEqual(cellTranslation({ key: 'channel', type: 'select', translate: false }), no, 'options that are stored values');
  assert.deepEqual(cellTranslation({ key: 'kind', type: 'select', render: () => null }), no);
});

test('a context gives an ambiguous label its meaning in that place', () => {
  const cell = el('td', { 'data-translate': '', 'data-i18n-context': 'direction' }, el('tr'));
  const inside = el('span', {}, cell);
  assert.equal(contextTranslation(contexts, inside, 'Masuk'), 'In', 'stock direction, not "Sign in"');
  assert.equal(contextTranslation(contexts, cell, 'Keluar'), 'Out');
  assert.equal(contextTranslation(contexts, inside, 'Simpan'), null, 'other words use the dictionary');
  assert.equal(contextTranslation(contexts, el('span', {}, el('td')), 'Masuk'), null, 'no context: the dictionary decides');
  assert.equal(contextTranslation(null, inside, 'Masuk'), null);
  assert.deepEqual(cellTranslation({ key: 'direction', translate: true, translateContext: 'direction' }), { 'data-translate': '', 'data-i18n-context': 'direction' });
  assert.deepEqual(cellTranslation({ key: 'qty', translateContext: 'quantity' }), { 'data-no-translate': '', 'data-i18n-context': 'quantity' }, 'a context alone does not make a cell translatable: it names the column header');
  assert.equal(contextTranslation(contexts, el('th', { 'data-i18n-context': 'quantity' }), 'Jumlah'), 'Quantity', 'the header of a quantity column');
  assert.deepEqual(cellTranslation({ key: 'title', translate: 'strict' }), { 'data-translate': 'strict' }, 'a sentence zone');
  assert.match(src('components/datagrid/DataGrid.jsx'), /data-i18n-context=\{column\.translateContext\}/, 'the <th> carries the context');
  assert.match(src('i18n/NoTranslate.jsx'), /'data-i18n-context': context \|\| undefined/);
  assert.match(src('components/KeyValue.jsx'), /data-i18n-context=\{item\.translateContext\}/);
  assert.match(src('pages/warehouse/WarehouseStock.jsx'), /<Translate context="direction">/);
});

test('record-data options and chips: the shared controls mark them', () => {
  assert.match(src('components/Select.jsx'), /const data = option\.data \?\? \(option\.suffix \? true : \(dataOptions && !option\.translate\)\);/);
  assert.match(src('components/Select.jsx'), /\{\.\.\.optionZone\(option, dataOptions\)\}>\{optionText\(option\)\}<\/option>/, 'a suffix is translated at render, the name is not');
  assert.match(src('components/Select.jsx'), /<option value="" data-translate="">\{placeholder\}<\/option>/, 'the placeholder is always interface text');
  assert.match(src('components/Chip.jsx'), /pw-chip__label" data-no-translate=\{data \? '' : undefined\}/);
  assert.match(src('components/Menu.jsx'), /pw-menu__label" data-no-translate=\{item\.data \? '' : undefined\}/);
  assert.match(src('components/FilterMenuChip.jsx'), /option\.data \?\? \(dataOptions && !option\.translate\)/);
  assert.match(src('components/Segmented.jsx'), /data-no-translate=\{option\.data \? '' : undefined\}/);
  assert.match(src('components/TabBar.jsx'), /data-no-translate=\{tab\.data \? '' : undefined\}/);
  assert.match(src('components/Checkbox.jsx'), /pw-choice__label" data-no-translate=\{data \? '' : undefined\}/);
  assert.match(src('components/tasks/Kanban.jsx'), /pw-kanban__name" data-no-translate=\{dataTitle \? '' : undefined\}/);
  assert.match(src('components/UserRoleSelects.jsx'), /placeholder=\{placeholder\}\s+dataOptions\s+options=\{users\.map/, 'user names are record data');
  assert.doesNotMatch(src('components/UserRoleSelects.jsx'), /dataOptions\s+options=\{roles\.map/, 'role names stay translatable');
  assert.match(src('pages/sales/SalesPrint.jsx'), /sp-receipt__words" data-no-translate="">\{terbilang\(/, 'the amount in words is printed in Indonesian');
});

test('the shared components mark their zones', () => {
  assert.match(src('components/datagrid/DataGrid.jsx'), /<td key=\{column\.key\} data-label=\{column\.header\}[^>]*\{\.\.\.cellTranslation\(column\)\}/);
  assert.match(src('components/KeyValue.jsx'), /pw-kv__value" \{\.\.\.valueZone\(item\.translate\)\}/);
  assert.doesNotMatch(src('components/KeyValue.jsx'), /pw-kv__label"[^>]*data-no-translate/, 'labels stay translatable');
  for (const file of ['StatusBadge.jsx', 'PriorityBadge.jsx']) assert.match(src(`components/${file}`), /<Badge [^>]*\btranslate\b/, file);
  assert.match(src('components/Badge.jsx'), /data-translate=\{translate \? '' : undefined\}/);
  assert.match(src('components/Button.jsx'), /<button ref=\{ref\} data-translate=""/);
  assert.match(src('components/IconButton.jsx'), /pw-tooltip-anchor" data-translate=""/);
  assert.match(src('components/LanguageSwitch.jsx'), /role="group" aria-label="Bahasa \/ Language" data-no-translate=""/);
  assert.match(src('components/tooltip.js'), /setAttribute\('data-no-translate', ''\)/, 'the bubble repeats an attribute that is already handled');
  assert.match(src('components/PageHeader.jsx'), /pw-page-header__title" \{\.\.\.dataZone\(dataTitle\)\}/);
  for (const file of ['Modal.jsx', 'SideSheet.jsx', 'FullScreenDialog.jsx', 'Card.jsx']) assert.match(src(`components/${file}`), /\{\.\.\.dataZone\(dataTitle\)\}/, file);
  assert.match(src('components/Avatar.jsx'), /aria-hidden="true" data-no-translate=""/, 'initials come from a name');
  assert.match(src('components/ai/AIMarkdown.jsx'), /className="ai-markdown" data-no-translate=""/);
});

test('Indonesian pays nothing: the translator and the dictionary load only for English', () => {
  const boot = src('i18n/boot.js');
  assert.match(boot, /if \(getLanguage\(\) !== 'en'\) return;/);
  assert.match(boot, /import\('\.\/en\/index\.js'\)/);
  assert.match(boot, /import\('\.\/domTranslator\.js'\)/);
  assert.doesNotMatch(boot, /^import .*(domTranslator|en\/index|translate\.js)/m, 'no static import of the English layer');
  const main = src('main.jsx');
  assert.match(main, /bootLanguage\(\)\.finally\(\(\) => \{\s*ReactDOM\.createRoot/, 'the language is settled before the first render');
  const dom = src('i18n/domTranslator.js');
  assert.doesNotMatch(dom, /appendChild|insertBefore|replaceChild|removeChild|replaceWith|innerHTML|textContent\s*=/, 'only nodeValue and attribute values are written');
});
