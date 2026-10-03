import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  columnAlign, columnNowrap, pageCount, pageRange, pageSizeOptions, selectionState, skeletonWidth, sortKey,
  toggleAllSelection, toggleSelection,
} from '../src/components/datagrid/gridModel.js';
import { EMPTY, formatDate, formatDateTime, formatMoney } from '../src/components/format.js';

// DataGrid follows docs/ui-guideline.md §4.9 (the admin console table). The
// pure helpers are tested directly; the CSS/JSX contract is read as source so
// a later edit cannot quietly drop a measured value.

const SRC = new URL('../src/components/', import.meta.url).pathname;
const read = (path) => readFileSync(`${SRC}${path}`, 'utf8');

test('numbers and money are right-aligned; a column align wins', () => {
  assert.equal(columnAlign({ type: 'number' }), 'right');
  assert.equal(columnAlign({ type: 'money' }), 'right');
  assert.equal(columnAlign({ align: 'end' }), 'right');
  assert.equal(columnAlign({ align: 'right' }), 'right');
  assert.equal(columnAlign({ align: 'center' }), 'center');
  assert.equal(columnAlign({ type: 'number', align: 'left' }), undefined);
  assert.equal(columnAlign({ type: 'date' }), undefined);
  assert.equal(columnAlign({}), undefined);
});

test('short values stay on one line; free text may wrap', () => {
  for (const type of ['date', 'datetime', 'money', 'number', 'boolean']) assert.equal(columnNowrap({ type }), true, type);
  assert.equal(columnNowrap({ align: 'end' }), true);
  assert.equal(columnNowrap({}), false);
  assert.equal(columnNowrap({ type: 'date', nowrap: false }), false);
  assert.equal(columnNowrap({ nowrap: true }), true);
});

test('money columns sort API decimal strings as numbers', () => {
  const column = { key: 'total', type: 'money' };
  assert.equal(sortKey(column, { total: '125000.00' }), 125000);
  assert.equal(sortKey(column, { total: 9 }), 9);
  assert.equal(sortKey({ key: 'code' }, { code: 'A-10' }), 'A-10');
  assert.equal(sortKey({ key: 'x', sortValue: (row) => row.y }, { y: 3 }), 3);
  assert.equal(sortKey({ key: 'name' }, {}), '');
});

test('pager counts pages and keeps the page size a page asked for', () => {
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(20, 20), 1);
  assert.equal(pageCount(21, 20), 2);
  assert.equal(pageCount(undefined, undefined), 1);
  assert.deepEqual(pageSizeOptions(20), [10, 20, 50, 100]);
  assert.deepEqual(pageSizeOptions(25), [10, 20, 25, 50, 100]);
  assert.deepEqual(pageSizeOptions(5), [5, 10, 20, 50, 100]);
});

test('row selection: toggle one, header toggles the page, state for the header box', () => {
  assert.deepEqual(toggleSelection(['1'], '2'), ['1', '2']);
  assert.deepEqual(toggleSelection(['1', '2'], '1'), ['2']);
  // Header box with part of the page selected adds the rest; rows of other pages stay.
  assert.deepEqual(toggleAllSelection(['9', '1'], ['1', '2', '3']), ['9', '1', '2', '3']);
  assert.deepEqual(toggleAllSelection(['9', '1', '2', '3'], ['1', '2', '3']), ['9']);
  assert.deepEqual(toggleAllSelection([], []), []);
  assert.equal(selectionState([], ['1', '2']), 'none');
  assert.equal(selectionState(['1'], ['1', '2']), 'some');
  assert.equal(selectionState(['1', '2', '7'], ['1', '2']), 'all');
});

test('loading skeleton widths are fixed per cell (no random jumps)', () => {
  const first = Array.from({ length: 5 }, (_, r) => Array.from({ length: 6 }, (__, c) => skeletonWidth(r, c)));
  const second = Array.from({ length: 5 }, (_, r) => Array.from({ length: 6 }, (__, c) => skeletonWidth(r, c)));
  assert.deepEqual(first, second);
  for (const width of first.flat()) assert.match(width, /^\d{2}%$/);
  assert.ok(new Set(first.flat()).size > 3, 'bars vary in width like real text');
});

test('date, datetime and money cells go through the shared format.js', () => {
  // The values DataGrid shows for type: 'date' | 'datetime' | 'money' columns.
  assert.equal(formatDate('2026-09-30'), '30 Sep 2026');
  assert.match(formatDateTime('2026-09-30T08:05:00'), /^30 Sep 2026, 08\.05$/);
  assert.equal(formatMoney(1234567), 'Rp 1.234.567');
  assert.equal(formatMoney('125000.00'), 'Rp 125.000');
  assert.equal(formatDate(''), EMPTY);
  const jsx = read('datagrid/DataGrid.jsx');
  assert.match(jsx, /from '\.\.\/format'/, 'DataGrid imports the shared formatters');
  assert.doesNotMatch(jsx, /toLocale(Date|Time)?String\(/, 'no local date formatting in the grid');
});

test('grid CSS carries the measured admin console values', () => {
  const css = read('datagrid/datagrid.css');
  const panel = css.match(/\n\.pw-grid \{([^}]*)\}/)[1];
  assert.match(panel, /border: 1px solid var\(--pw-outline-panel\)/);
  assert.match(panel, /border-radius: var\(--pw-radius-sm\)/);
  assert.doesNotMatch(panel, /box-shadow/, 'the panel has no shadow');
  for (const value of [
    'min-height: var(--pw-toolbar-height)',
    'font-size: var(--pw-font-panel)',
    'min-height: var(--pw-filterbar-height)',
    'padding: 8px 12px 8px 32px',
    'box-shadow: inset 0 -1px 0 0 var(--pw-divider)',
    'height: var(--pw-header-row-height)',
    'background: var(--pw-surface-container)',
    'border-bottom: 1px solid var(--pw-divider)',
    'color: var(--pw-text-header)',
    'color: var(--pw-text-strong)',
    'padding: 17px 10px',
    'height: var(--pw-row-height)',
    'border-top: 1px solid var(--pw-divider)',
    'padding: 0 10px',
    'padding-left: 24px',
    'padding-right: 24px',
    'padding: 0 16px 0 32px',
    'font-size: var(--pw-font-sm)',
    'background: var(--pw-hover-row)',
    'background: var(--pw-selected)',
    '@media (max-width: 600px)',
    'content: attr(data-label)',
    'padding: 8px 16px',
    '@media (hover: none), (pointer: coarse)',
  ]) assert.ok(css.includes(value), `datagrid.css lost "${value}"`);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/, 'headers are never upper case');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'colours come from tokens');
  // Tooltips are the shared fixed bubble; the old ::after tooltip overrides are gone.
  assert.doesNotMatch(css, /data-pw-tooltip\]::after/, 'no CSS-drawn tooltips in the grid');
  // Row actions stay visible while their (portaled) menu is open.
  assert.ok(css.includes('.pw-grid__actions-inner:has([aria-expanded="true"])'));
});

test('grid search and row checkboxes are the shared SearchField and Checkbox', () => {
  const jsx = read('datagrid/DataGrid.jsx');
  assert.match(jsx, /import Checkbox from '\.\.\/Checkbox'/);
  assert.match(jsx, /import SearchField from '\.\.\/SearchField'/);
  assert.match(jsx, /<SearchField\s+variant="panel"/);
  assert.doesNotMatch(jsx, /type="search"|pw-grid__check/, 'no local search input or checkbox');
  const search = read('search-field.css');
  for (const value of ['height: var(--pw-search-height)', 'border-radius: var(--pw-radius-search)', 'background: var(--pw-surface-container)']) {
    assert.ok(search.includes(value), `search-field.css lost "${value}"`);
  }
  assert.match(search, /\.pw-search--panel \.pw-search__input \{[^}]*font-family: var\(--pw-font-roboto\);[^}]*font-size: var\(--pw-font-body\);/);
  assert.ok(read('datagrid/datagrid.css').includes('.pw-grid__select .pw-checkbox { margin: -10px; }'), 'the 40px touch area keeps the 68px column');
});

test('pager CSS: 57px bar, padding 4px 24px, 56x46 dropdown radius 3, 48px buttons', () => {
  const css = read('datagrid/pager.css');
  for (const value of [
    'min-height: var(--pw-pager-height)',
    'padding: 4px 24px',
    'border-top: 1px solid var(--pw-divider)',
    'width: 56px',
    'height: var(--pw-search-height)',
    'border-radius: var(--pw-radius-sm)',
    'color: var(--pw-text-select)',
    'width: var(--pw-icon-button); height: var(--pw-icon-button)',
  ]) assert.ok(css.includes(value), `pager.css lost "${value}"`);
});

test('DataGrid wiring: keyboard rows, shared pager, no random widths, no lucide', () => {
  const jsx = read('datagrid/DataGrid.jsx');
  assert.match(jsx, /tabIndex=\{clickable \? 0 : undefined\}/, 'rows that open a detail take keyboard focus');
  assert.match(jsx, /event\.key === 'Enter' \|\| event\.key === ' '/, 'Enter/Space open the row');
  assert.match(jsx, /<Pager/, 'client and server paging share <Pager>');
  assert.match(jsx, /tone="error"/, 'load errors render EmptyState tone="error"');
  assert.match(jsx, /Coba lagi/);
  assert.doesNotMatch(jsx, /Math\.random/);
  assert.doesNotMatch(jsx, /lucide-react/);
  const pager = read('datagrid/Pager.jsx');
  for (const label of ['Baris per halaman:', 'Halaman pertama', 'Halaman sebelumnya', 'Halaman berikutnya', 'Halaman terakhir']) {
    assert.ok(pager.includes(label), `Pager lost "${label}"`);
  }
  assert.match(pager, /Halaman \{current\} dari \{last\}/);
});

test('legacy DataTable, Toolbar and FilterBar are gone (DataGrid holds the toolbar and filter bar)', () => {
  for (const file of ['DataTable.jsx', 'Toolbar.jsx', 'FilterBar.jsx', 'toolbar.css']) {
    assert.equal(existsSync(`${SRC}${file}`), false, `${file} came back`);
  }
});

test('pager range "a–b dari N" (Material data table)', () => {
  assert.deepEqual(pageRange(1, 20, 45), { from: 1, to: 20, total: 45 });
  assert.deepEqual(pageRange(3, 20, 45), { from: 41, to: 45, total: 45 });
  assert.deepEqual(pageRange(9, 20, 45), { from: 41, to: 45, total: 45 }, 'a page past the end shows the last one');
  assert.deepEqual(pageRange(1, 20, 0), { from: 0, to: 0, total: 0 });
  const pager = read('datagrid/Pager.jsx');
  assert.match(pager, /dari \{formatNumber\(range\.total\)\}/);
  assert.doesNotMatch(read('datagrid/pager.css'), /select:hover[^{]*\{[^}]*background/, 'the select hover is the shared state layer');
});

test('DataGrid: a portaled menu choice or the actions cell never opens the row', () => {
  const jsx = read('datagrid/DataGrid.jsx');
  assert.match(jsx, /!\(event\.target instanceof Node\) \|\| !event\.currentTarget\.contains\(event\.target\)/);
  assert.match(jsx, /<td className="pw-grid__actions" onClick=\{stopRowClick\}>/);
  assert.match(jsx, /const stopRowClick = \(event\) => event\.stopPropagation\(\)/);
});

test('DataGrid: count in the toolbar, error Banner over rows already shown, one pager rule', () => {
  const jsx = read('datagrid/DataGrid.jsx');
  assert.match(jsx, /className="pw-grid__count"/);
  assert.match(jsx, /const fatalError = Boolean\(loadError\) && !rows\.length/);
  assert.match(jsx, /<Banner tone="error" title="Data gagal dimuat" action=\{retryButton\}>/);
  assert.match(jsx, /const showPager = !fatalError && \(manual \|\| \(!loading && filteredCount > PAGE_SIZES\[0\]\)\)/);
  // Inline editors are the shared dense fields and Checkbox; the old CSS is gone.
  assert.match(jsx, /<Input\s+\{\.\.\.common\}/);
  assert.match(jsx, /dense: true/);
  const css = read('datagrid/datagrid.css');
  assert.doesNotMatch(css, /\.pw-grid__(?:input|bool|banner)\b/);
  // Filter bar: one 56px line from 601px up, scrolling inside itself.
  // No filter is ever hidden off the edge: the chips wrap onto another line.
  assert.match(css, /\.pw-grid__filters \{[^}]*flex-wrap: wrap;[^}]*min-height: var\(--pw-filterbar-height\);/);
});

