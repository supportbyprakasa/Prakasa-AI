import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  buildPageContext, cleanCounts, cleanFilters, cleanSelection, gridPart, isSensitiveKey, queryFilters, routeSelection,
} from '../src/components/ai/aiPageContext.js';
import { resolveToolForPath } from '../src/components/ai/aiToolModel.js';

// Wave A (docs/prakasa-ai-rencana.md §9): every page tells Prakasa AI at least
// its route and title through the shared path; pages marked publishesState:
// false tell it nothing; money and personal fields never leave the browser.
const require = createRequire(import.meta.url);
const registry = require('../../backend/src/services/aiToolRegistry.service.js');
const SRC = path.join(import.meta.dirname, '../src');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

// The catalog as the browser receives it (GET /ai-command/tools).
const everything = { permissions: registry.TOOLS.flatMap((entry) => [].concat(entry.readPermission || [])) };
const CATALOG = registry.listToolsForUser(everything, 'head');
const resolve = (pathname) => resolveToolForPath(CATALOG, pathname);
const sample = (route) => route.replace(':type', 'inbound').replace(/:[a-zA-Z]+/g, '7');

// App.jsx: which routes render inside <Layout> (where the provider lives).
function appRoutes() {
  const source = read('App.jsx');
  const layoutAt = source.indexOf('<Layout />');
  assert.ok(layoutAt > 0, 'the Layout route');
  return [...source.matchAll(/<Route\s+(index|path="([^"]+)")/g)].map((match) => ({
    route: match[1] === 'index' ? '/' : (match[2].startsWith('/') ? match[2] : `/${match[2]}`),
    inLayout: match.index > layoutAt,
  })).filter((entry) => !['/login', '/verify/:code', '/*', '/__design'].includes(entry.route));
}

test('every route publishes at least route + title through the shared path, or is publishesState:false', () => {
  const routes = appRoutes();
  assert.ok(routes.length > 60, `expected the full route table, got ${routes.length}`);
  const silent = [];
  for (const { route, inLayout } of routes) {
    const pathname = sample(route);
    const resolved = resolve(pathname);
    assert.ok(resolved, `${route} has no page tool`);
    const page = buildPageContext({ resolved, pathname, search: '', parts: {} });
    if (resolved.tool.publishesState === false) {
      assert.equal(page, null, `${route} must publish nothing`);
      silent.push(route);
      continue;
    }
    assert.ok(inLayout, `${route} publishes state but renders outside <Layout>, where nothing publishes for it`);
    assert.equal(page.route, pathname, route);
    assert.equal(page.title, resolved.tool.title, route);
    assert.deepEqual(page.filters, {});
    assert.deepEqual(page.counts, {});
  }
  assert.ok(silent.includes('/ai-command') && silent.includes('/admin/users') && silent.includes('/akun'));
});

test('the browser catalog carries publishesState exactly as the registry declares it', () => {
  for (const entry of registry.TOOLS) {
    const dto = CATALOG.find((candidate) => candidate.key === entry.key);
    assert.equal(dto.publishesState, entry.publishesState, entry.key);
  }
});

test('the shared building blocks publish: provider (route, title, record id), PageHeader (title), DataGrid (search, sort, counts), panel (sends it)', () => {
  const provider = read('context/PrakasaAIToolContext.jsx');
  assert.match(provider, /buildPageContext\(\{\s*resolved,\s*pathname,\s*search,/);
  assert.match(provider, /export function usePublishPrakasaAIPart\(/);
  assert.match(provider, /export function usePublishPrakasaAIPage\(/);
  assert.match(provider, /<PrakasaAIPublishContext\.Provider value=\{enabled \? publishPart : null\}>/, 'no AI permission, nothing published');
  assert.match(read('components/Layout.jsx'), /<PrakasaAIToolProvider>/);

  const header = read('components/PageHeader.jsx');
  assert.match(header, /usePublishPrakasaAIPart\('header', typeof title === 'string' && title && !dataTitle \? \{ title \} : null\)/, 'a record name as title is not published automatically');
  assert.match(read('components/Page.jsx'), /<PageHeader /);

  const grid = read('components/datagrid/DataGrid.jsx');
  const call = grid.match(/usePublishPrakasaAIPart\(gridSlot,[\s\S]*?\}\)\);/);
  assert.ok(call, 'DataGrid publishes its part');
  assert.doesNotMatch(call[0], /rows\b(?!\.length)|row\./, 'never row content');
  assert.match(call[0], /search: searchText/);
  assert.match(call[0], /sort: activeSort/);

  const panel = read('components/ai/PrakasaAIToolPanel.jsx');
  assert.match(panel, /\.\.\.\(page \? \{ page \} : \{\}\)/);
});

test('route selection: the open record id and type come from the route, only for numeric ids', () => {
  assert.deepEqual(routeSelection(resolve('/tasks/12')), { type: 'task', id: '12' });
  assert.deepEqual(routeSelection(resolve('/approvals/5')), { type: 'approval_request', id: '5' });
  assert.deepEqual(routeSelection(resolve('/it/devices/9')), { type: 'devices', id: '9' });
  assert.deepEqual(routeSelection(resolve('/warehouse/movements/outbound/3')), { type: 'warehouse_movement', id: '3' });
  assert.equal(routeSelection(resolve('/tasks')), null);
  assert.equal(routeSelection(resolve('/people/directory/budi%40prakasa.test')), null, 'a person key is not published');
  assert.equal(routeSelection(resolve('/tasks/abc')), null);
});

test('parts merge into the standard shape: header title, URL filters, grid search/sort/counts, explicit page part wins', () => {
  const resolved = resolve('/procurement');
  const page = buildPageContext({
    resolved,
    pathname: '/procurement',
    search: '?tab=orders&state=late&token=abc&harga=5',
    parts: {
      header: { title: 'Procurement' },
      grids: [gridPart({ title: 'Purchase order', search: '  PT   Pemasok ', sort: { id: 'due_date', desc: true }, shown: 20, total: 57 })],
      page: { selection: { type: 'purchase_order', id: 'PO.1', name: 'PO.1' }, counts: { terlambat: 4 } },
    },
  });
  assert.deepEqual(page, {
    route: '/procurement',
    title: 'Procurement',
    filters: { tab: 'orders', state: 'late', cari: 'PT Pemasok', urut: 'due_date turun', daftar: 'Purchase order' },
    selection: { type: 'purchase_order', id: 'PO.1', name: 'PO.1' },
    counts: { baris_tampil: 20, baris_cocok: 57, terlambat: 4 },
  });
  const withForm = buildPageContext({ resolved, pathname: '/procurement', parts: { page: { formState: { id: 'po-note', dirty: 1, values: { x: 1 } } } } });
  assert.deepEqual(withForm.formState, { id: 'po-note', dirty: true });
  assert.equal(buildPageContext({ resolved: null, pathname: '/x' }), null);
});

test('money, personal and secret keys never leave the browser; counts are whole numbers; no row content', () => {
  for (const key of ['harga', 'total_amount', 'nilai_po', 'dpp', 'omzet', 'margin', 'gaji', 'rekening', 'npwp', 'nik', 'email', 'telepon', 'alamat', 'password', 'token']) {
    assert.equal(isSensitiveKey(key), true, key);
  }
  assert.deepEqual(cleanFilters({ status: 'late', harga_min: 1000, email: 'a@b', rows: [{ id: 1 }], nested: { a: 1 }, kosong: ' ', aktif: true, halaman: 2 }), { status: 'late', aktif: true, halaman: 2 });
  assert.deepEqual(cleanCounts({ baris: 3, total_nilai: 5000000, pecahan: 1.5, minus: -2, teks: '4' }), { baris: 3 });
  assert.equal(cleanFilters({ q: 'x'.repeat(500) }).q.length, 120);
  assert.equal(Object.keys(cleanFilters(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'v'])))).length, 12);
  assert.equal(cleanSelection({ type: 'task' }), null);
  assert.deepEqual(cleanSelection({ type: 'task', id: 4, name: '  Lapor  mingguan ', amount: 5 }), { type: 'task', id: '4', name: 'Lapor mingguan' });
  assert.deepEqual(queryFilters({ queryKeys: ['tab'] }, '?tab=a&secret=b'), { tab: 'a' });
  const part = gridPart({ title: 'Daftar', search: '', sort: null, shown: 0, total: 0 });
  assert.deepEqual(part, { daftar: 'Daftar', filters: {}, counts: { baris_tampil: 0, baris_cocok: 0 } });
});
