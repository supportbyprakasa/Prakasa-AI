const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const reorder = require('../src/services/procurementReorder.service');
const prices = require('../src/services/procurementPrices.service');
const provider = require('../src/management/providers/procurement');
const rules = require('../src/services/procurementRules');
const ctrl = require('../src/controllers/procurementAccurate.controller');
const { permissionsForStandardRole } = require('../src/config/standardOrganization');

const placeholders = (sql) => (sql.match(/\?/g) || []).length;
const flat = (sql) => sql.replace(/\s+/g, ' ').trim();
const migration = (file) => fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// Saran pesan ulang (program 3.1): days-of-cover reorder suggestions from
// approved stock and POs. Total stock only (D2 extended), prices only for
// procurement.price.view (P1), no alarm before the data exists.

const READY = { first_stock_at: '2026-09-01 00:00:00', cover_from: '2026-09-08', history_days: '30', stock_pending: '0', po_ready: '1', receipts_ready: '1' };
// A row as mysql2 returns it here: DECIMAL and SUM() arrive as strings.
const ROW = {
  entity_id: 7, item_id: 11, item_no: 'DAI-OAT', item_name: 'Oatside', department_id: 9, stock_qty: '50.0000', qty_all_units: null,
  out_30d: '300.0000', history_days: '30', daily_out: '10.00000000', cover_reason: null, on_order_base: '0.0000', open_pos: '0', late_pos: '0',
  next_due: null, legacy_base: '6.0000', legacy_pos: '1', vendor_id: 5, vendor_no: 'V-001', vendor_name: 'PT Pemasok Susu', vendor_status: 'Aktif',
  po_unit: 'Ctns', po_ratio: '12.0000', last_po_qty: '10.0000', last_po_id: 1550, last_po_number: 'PO1', last_po_date: '2026-09-24',
  base_unit: 'TetraPk', lead_samples: null, lead_days: '14', position_base: '50.0000', cover_days: '5.00000000', urgency: 'critical',
};

function fakeReorder(calls, { ready = READY, rows = [ROW], counts = { c_total: '3', c_critical: '1', c_reorder: '2', c_out: '0', c_unknown: '4' } } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/AS first_stock_at/.test(sql) || /first_stock_at,/.test(sql)) return [[ready]];
    if (/^WITH r AS/.test(sql)) return [rows.length ? rows.map((r) => ({ ...counts, ...r })) : [{ ...counts, item_id: null }]];
    if (/remaining_base\s+FROM pc_po_lines_accurate l JOIN/.test(sql) || /AS display_state, l\.remaining_qty/.test(sql)) {
      return [[{ item_no: 'DAI-OAT', id: 1400, number: 'PO-OLD', trans_date: '2026-08-01', due_date_eff: '2026-08-15', expected_date: null, display_state: 'legacy', remaining_qty: '1.0000', unit: 'Ctns', remaining_base: '6.0000' }]];
    }
    if (/FROM pc_po_price_lines_accurate l/.test(sql)) return [[{ vendor_no: 'v-001', item_no: 'DAI-OAT', unit: 'CTNS', unit_price: '78000.00', disc_pct: null, net_price: '70270.3333', trans_date: '2026-09-24' }]];
    return [[]];
  };
}

test('how much to order: whole purchase units up to lead + safety + cycle days, at least 1', () => {
  // target 10 × (14 + 7 + 14) = 350, position 50 → 300 base = 25 Ctns of 12.
  assert.deepEqual(reorder.suggestion({ dailyOut: 10, leadDays: 14, stock: 50, onOrder: 0, ratio: 12 }), { units: 25, ratio: 12, baseQty: 300, coverAfterDays: 35 });
  // A negative stock counts as 0, on-order counts in full.
  assert.equal(reorder.suggestion({ dailyOut: 10, leadDays: 14, stock: -40, onOrder: 100, ratio: 1 }).units, 250);
  // Float noise never adds a unit: 0.1 × 35 = 3.5000000000000004 → ⌈3.5 − 0.5⌉ = 3.
  assert.equal(reorder.suggestion({ dailyOut: 0.1, leadDays: 14, stock: 0.5, onOrder: 0, ratio: 1 }).units, 3);
  assert.equal(reorder.suggestion({ dailyOut: 1, leadDays: 14, stock: 1000, onOrder: 0, ratio: 6 }).units, 1, 'never below 1');
  assert.equal(reorder.suggestion({ dailyOut: null, leadDays: 14, stock: 0, onOrder: 0, ratio: 1 }), null, 'no outflow: left for a person');
  assert.equal(reorder.SAFETY_DAYS, 7, 'safety stock = the Warehouse "Menipis" threshold (D7)');
});

test('the query reads total stock only, never per gudang or prices, and binds the company everywhere', () => {
  const sql = reorder.REORDER_SQL;
  assert.equal((sql.match(/\?/g) || []).length, reorder.reorderBinds(7).length);
  assert.deepEqual(reorder.reorderBinds(7).filter((v) => v !== 7), [rules.lateFrom(), rules.lateFrom()]);
  assert.match(sql, /wh_stock_total_accurate/);
  assert.doesNotMatch(sql, /wh_stock_accurate\b/, 'stock per gudang is never read (D2)');
  assert.doesNotMatch(sql, /pc_po_price|unit_price|dpp_amount/, 'no prices in the shared query');
  // Lead time never below the age of the vendor's oldest PO still waiting (no survivor bias).
  assert.match(sql, /MAX\(IF\(p\.po_state IN \('open', 'partial'\), DATEDIFF/);
  assert.match(sql, /HAVING SUM\(g\.last_receipt IS NOT NULL\) >= 3/);
});

test('a page reads numbers, not strings: suggestion, counts and open orders from mysql2-shaped rows', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeReorder(calls));
  const out = await reorder.listReorder(7, { page: 1, limit: 25 }, { prices: false });
  assert.deepEqual(out.counts, { total: 3, critical: 1, reorder: 2, out: 0, unknown: 4 });
  const [item] = out.items;
  assert.equal(item.stock.qty, 50);
  assert.deepEqual(item.suggestion, { units: 25, ratio: 12, baseQty: 300, coverAfterDays: 35, unit: 'Ctns' });
  assert.deepEqual(item.leadTime, { days: 14, source: 'default', samples: 0 });
  assert.equal(item.onOrder.legacyPos, 1);
  assert.equal(item.openOrders[0].counted, false, 'a PO lama is listed, never counted');
  assert.equal('lastPrice' in item || 'estimatedValue' in item, false, 'no price key for a member');
  assert.ok(!calls.some((c) => /pc_po_price/.test(c.sql)), 'members never touch the price views');
  const page = calls.find((c) => /^WITH r AS/.test(c.sql));
  assert.deepEqual(page.args.slice(0, reorder.reorderBinds(7).length), reorder.reorderBinds(7));
  assert.deepEqual(page.args.slice(-2), [25, 0]);
  assert.equal(placeholders(page.sql), page.args.length);
});

test('before stock is approved the page explains itself and runs no heavy query', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeReorder(calls, { ready: { first_stock_at: null, history_days: '0', stock_pending: '1', po_ready: '0', receipts_ready: '0' } }));
  const out = await reorder.listReorder(7, {}, { prices: true });
  assert.equal(out.items.length, 0);
  assert.equal(out.readiness.stockPending, true);
  assert.equal(calls.length, 1);
});

test('price viewers get the net DPP per purchase unit, matched on the unit case-insensitively', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeReorder(calls));
  const out = await reorder.listReorder(7, {}, { prices: true });
  const [item] = out.items;
  // Tax-inclusive PO: 78.000 listed, 70.270,33 before PPN.
  assert.equal(item.lastPrice.netPrice, 70270.33);
  assert.equal(item.estimatedValue, Math.round(25 * 70270.33));
  await assert.rejects(() => prices.reorderPrices(7, [{ itemNo: 'X', vendorNo: 'V', unit: 'Pcs' }], {}), (e) => e.status === 403);
  const priced = calls.find((c) => /FROM pc_po_price_lines_accurate l/.test(c.sql));
  assert.deepEqual(priced.args.slice(0, 2), [7, 7]);
  assert.match(priced.sql, /counts_as_spend = 1 AND v\.currency = 'IDR'/);
});

test('only the Procurement Supervisor/Head and the Management Office see it; the route is guarded', () => {
  assert.equal(permissionsForStandardRole('procurement.member').includes('procurement.reorder.view'), false);
  assert.ok(permissionsForStandardRole('procurement.supervisor').includes('procurement.reorder.view'));
  assert.ok(permissionsForStandardRole('management_office.supervisor').includes('procurement.reorder.view'));
  assert.equal(permissionsForStandardRole('warehouse.member').includes('procurement.reorder.view'), false);
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/procurement.routes.js'), 'utf8');
  const at = src.indexOf("router.get('/reorder'");
  assert.ok(at >= 0);
  assert.match(src.slice(at, at + 160), /requirePermission\('procurement\.reorder\.view'\)/);
});

// One escalation row as MySQL returns it (DECIMAL/SUM as strings).
const ESC_ROW = {
  vendor_id: 5, vendor_no: 'V-001', vendor_title: 'PT Pemasok Susu', department_id: 9, department_name: 'Procurement', items: '2', min_cover: '2.2',
  lead_days: '14', lead_samples: '0', with_legacy: '1', negative: '0', days_late: '0', since: '2026-09-30', po_day: '9763',
};
const escalation = () => provider.escalations.find((e) => e.key === 'procurement_reorder_missed');
const reorderKpi = () => provider.kpis.find((k) => k.key === 'procurement_reorder_due');

test('the escalation: one row per vendor, days only, clamped to what the app could know — in one statement', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/AS with_legacy/.test(sql)) return [[ESC_ROW]];
    if (/FROM pc_vendors_accurate WHERE id = \?/.test(sql)) return [[{ entity_id: 1, department_id: 9 }]];
    return [[]];
  });
  const [item] = await escalation().list(1, { departmentId: 9 });
  assert.equal(calls.length, 1, 'the division scope is part of the statement, not a query of its own');
  assert.equal(item.sourceId, 5 * rules.EPISODE_FACTOR + 9763);
  assert.equal(item.severity, 'medium');
  assert.match(item.context, /belum ada PO baru .* 1 dengan PO lama belum ditutup/);
  assert.doesNotMatch(item.context, /stok minus/);
  assert.doesNotMatch(`${item.title} ${item.context}`, /Rp|\d{3}\.\d{3}/, 'no amounts or quantities');
  assert.match(calls[0].sql, /LEAST\(CEIL\(MAX\(r\.lead_days \+ 7 - r\.cover_days\)\), MAX\(r\.history_days\) - 7\)/);
  assert.deepEqual(calls[0].args.slice(0, 2), [1, 9], 'division scope in SQL: entity first, then division');
  assert.deepEqual(await escalation().locate(item.sourceId, { entityId: 1 }), { entityId: 1, departmentId: 9 });
});

test('bind order: the escalation and the KPI bind entity, division, the saran query, in text order', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[]]; });
  for (const departmentId of [9, null]) {
    calls.length = 0;
    await escalation().list(1, { departmentId });
    await reorderKpi().value(1, { departmentId });
    const division = departmentId ? [departmentId] : [];
    const [esc, kpi] = calls;
    assert.deepEqual(esc.args, [1, ...division, ...reorder.reorderBinds(1), 1], `escalation, division ${departmentId}`);
    assert.deepEqual(kpi.args, [1, ...division, ...reorder.reorderBinds(1)], `KPI, division ${departmentId}`);
    for (const c of [esc, kpi]) assert.equal(placeholders(c.sql), c.args.length, 'one bind per placeholder');
    // The scope row is the first table: the heavy part joins on it.
    assert.match(flat(esc.sql), /FROM \(SELECT d\.id, d\.name FROM departments d WHERE d\.entity_id = \? AND d\.code = 'procurement' AND d\.deleted_at IS NULL( AND d\.id = \?)? LIMIT 1\) pd JOIN \(WITH lp AS/);
    assert.match(flat(kpi.sql), /AND d\.deleted_at IS NULL( AND d\.id = \?)? LIMIT 1\) pd LEFT JOIN \(WITH lp AS/);
    assert.equal(/AND d\.id = \?/.test(esc.sql), Boolean(departmentId));
  }
});

test('another division\'s Head gets no rows: the scope row is missing, in the same statement', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return /AS in_scope/.test(sql) ? [[{ in_scope: 0, po_ready: null, stocked: '0', known: '0', n: '0', critical: '0' }]] : [[]]; });
  assert.deepEqual(await escalation().list(1, { departmentId: 4 }), []);
  assert.deepEqual(await reorderKpi().value(1, { departmentId: 4 }), { value: 0, sub: 'Hanya untuk divisi Procurement', alert: false });
  assert.equal(calls.length, 2, 'one query per capability');
  assert.ok(calls.every((c) => c.args[0] === 1 && c.args[1] === 4), 'entity first, then division');
  assert.match(calls[1].sql, /COUNT\(pd\.id\) AS in_scope/);
});

test('the KPI holds its alarm until stock, 7 days of history and POs are approved', async (t) => {
  const kpi = reorderKpi();
  const answer = (row) => async (sql) => (/AS stocked/.test(sql) ? [[{ in_scope: '1', ...row }]] : [[]]);
  t.mock.method(pool, 'query', answer({ stocked: '0', known: '0', n: '0', critical: '0', po_ready: 0 }));
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false });
  pool.query.mock.mockImplementation(answer({ stocked: '400', known: '0', n: '0', critical: '0', po_ready: 1 }));
  assert.match((await kpi.value(1, { departmentId: null })).sub, /setelah 7 hari riwayat/);
  pool.query.mock.mockImplementation(answer({ stocked: '400', known: '400', n: '5', critical: '3', po_ready: 0 }));
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 5, sub: 'Menunggu data PO disetujui', alert: false });
  pool.query.mock.mockImplementation(answer({ stocked: '400', known: '400', n: '5', critical: '3', po_ready: 1 }));
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 5, sub: '3 habis sebelum barang datang', alert: true });
  pool.query.mock.mockImplementation(answer({ in_scope: '0', stocked: '0', known: '0', n: '0', critical: '0', po_ready: 1 }));
  assert.equal((await kpi.value(1, { departmentId: 4 })).sub, 'Hanya untuk divisi Procurement');
});

test('a critical item with stock below zero and no PO escalates (counted as 0, named), and the KPI counts it the same way', async (t) => {
  // The saran rule: position = MAX(stock, 0) + on order, so stock −40 with outflow is critical.
  assert.match(flat(reorder.REORDER_SQL), /WHEN GREATEST\(b\.stock_qty, 0\) \+ b\.on_order_base < b\.daily_out \* b\.lead_days THEN 'critical'/);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return /AS with_legacy/.test(sql) ? [[{ ...ESC_ROW, items: '3', negative: '2', min_cover: '0' }]] : [[{ in_scope: '1', stocked: '400', known: '400', n: '3', critical: '3', po_ready: 1 }]];
  });
  const [item] = await escalation().list(1, { departmentId: null });
  assert.match(item.context, /^3 barang habis sebelum barang datang, belum ada PO baru · paling cepat habis ± 0 hari/);
  assert.match(item.context, / · 2 stok minus di Accurate$/);
  const k = await reorderKpi().value(1, { departmentId: null });
  assert.deepEqual(k, { value: 3, sub: '3 habis sebelum barang datang', alert: true });
  const [esc, kpi] = calls;
  // Neither drops a stock below zero: both take the saran's urgency as it is.
  assert.match(flat(esc.sql), /WHERE r\.urgency = 'critical' AND r\.vendor_id IS NOT NULL AND r\.on_order_base = 0 GROUP BY/);
  for (const c of [esc, kpi]) assert.doesNotMatch(c.sql, /stock_qty >= 0|stock_qty > 0/);
  assert.match(kpi.sql, /COALESCE\(SUM\(r\.urgency = 'critical'\), 0\) AS critical/);
});

test('a vendor renamed between two POs stays one row, under its current name', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[ESC_ROW]]; });
  const rows = await escalation().list(1, { departmentId: null });
  const sql = flat(calls[0].sql);
  // Grouped by the vendor's id (and its last PO), never by the name each item's last PO carries.
  assert.match(sql, /GROUP BY r\.vendor_id, lv\.last_po ORDER BY/);
  assert.match(sql, /COALESCE\(MAX\(r\.vendor_master_name\), MAX\(r\.vendor_name\), MAX\(r\.vendor_no\)\) AS vendor_title/);
  assert.match(flat(reorder.REORDER_SQL), /v\.name AS vendor_master_name/, 'the master name comes from pc_vendors_accurate');
  assert.equal(rows[0].title, 'PT Pemasok Susu');
  assert.equal(new Set(rows.map((r) => r.sourceId)).size, rows.length);
});

test('"Belum ada PO": the escalation opens exactly the items it counts (critical, its vendor, nothing on order)', async (t) => {
  // The filter is the escalation's own test.
  assert.equal(reorder.NO_PO_SQL, 'r.on_order_base = 0');
  assert.deepEqual(reorder.filters({ noPo: true }), { sql: ' AND r.on_order_base = 0', args: [] });
  assert.deepEqual(reorder.filters({ vendor: 'V-001', noPo: true }), { sql: ' AND (r.vendor_no = ? OR r.vendor_name LIKE ?) AND r.on_order_base = 0', args: ['V-001', '%V-001%'] });
  assert.deepEqual(reorder.filters({ noPo: false }), { sql: '', args: [] });
  const calls = [];
  t.mock.method(pool, 'query', fakeReorder(calls));
  await reorder.listReorder(7, { urgency: 'critical', vendor: 'V-001', noPo: true }, { prices: false });
  const page = calls.find((c) => /^WITH r AS/.test(c.sql));
  // Counts and the page both carry it, so the chips count what the list shows.
  assert.equal((page.sql.match(/AND r\.on_order_base = 0/g) || []).length, 2);
  assert.equal(placeholders(page.sql), page.args.length);
  pool.query.mock.mockImplementation(async (sql, args) => (/AS with_legacy/.test(sql) ? [[{ ...ESC_ROW, vendor_no: 'V 001/A' }]] : [[]]));
  const [item] = await escalation().list(1, { departmentId: null });
  assert.equal(item.link, '/procurement/reorder?urgency=critical&vendor=V%20001%2FA&noPo=1');
  const url = new URL(item.link, 'http://x');
  assert.deepEqual([url.searchParams.get('urgency'), url.searchParams.get('vendor'), url.searchParams.get('noPo')], ['critical', 'V 001/A', '1']);
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/procurement.routes.js'), 'utf8');
  assert.match(src, /noPo: z\.enum\(\['1'\]\)\.optional\(\)/);
});

// The controller is where the price permission is read (P1).
function responseDouble() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('the reorder route shows last prices only with procurement.price.view (controller gate)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeReorder(calls));
  const run = async (permissions) => {
    calls.length = 0;
    const res = responseDouble();
    let failed = null;
    await ctrl.listReorder({ user: { entityId: 7, sub: 3, permissions }, query: { noPo: '1' } }, res, (e) => { failed = e; });
    assert.equal(failed, null);
    assert.equal(res.statusCode, 200);
    return res.body;
  };
  const member = await run(['procurement.reorder.view']);
  assert.ok(!calls.some((c) => /pc_po_price/.test(c.sql)), 'no price view is read');
  assert.ok(member.data.length > 0);
  for (const item of member.data) assert.equal('lastPrice' in item || 'estimatedValue' in item, false);
  assert.equal(member.meta.readiness.stockReady, true);
  assert.equal(member.meta.rules.minHistoryDays, 7);
  assert.match(calls.find((c) => /^WITH r AS/.test(c.sql)).sql, /AND r\.on_order_base = 0/, 'noPo=1 reaches the query');
  const viewer = await run(['procurement.reorder.view', 'procurement.price.view']);
  assert.ok(calls.some((c) => /FROM pc_po_price_lines_accurate l/.test(c.sql)));
  assert.equal(viewer.data[0].lastPrice.netPrice, 70270.33);
  assert.equal(viewer.data[0].estimatedValue, Math.round(25 * 70270.33));
});

test('a bonus line (below Rp 10 per base unit) is never the last price, in saran pesan ulang or Harga beli', async (t) => {
  assert.equal(prices.MIN_COST_PER_BASE, 10);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return /COUNT\(\*\) AS total/.test(sql) ? [[{ total: 0, up: 0, down: 0, single: 0 }]] : [[]]; });
  await prices.reorderPrices(1, [{ itemNo: 'MKR-160', vendorNo: 'MKR-50', unit: 'Pcs' }], { prices: true });
  await prices.priceList(1, {}, { prices: true });
  await prices.priceHistory(1, { vendor: 'MKR-50', item: 'MKR-160', unit: 'Pcs' }, { prices: true });
  await prices.lastPrices(1, 'MKR-50', { prices: true });
  const [reorderSql, listSql, countSql, historySql, othersSql, vendorSql] = calls.map((c) => flat(c.sql));
  // The net cost per base unit, as latestCosts and pc_po_price_costs_accurate read it, before the latest line is picked.
  assert.match(reorderSql, /AND l\.line_total \/ NULLIF\(q\.qty_base, 0\) \* v\.dpp_amount \/ NULLIF\(t\.lines_total, 0\) >= 10\) x WHERE x\.rn = 1/);
  // Harga beli: the listed price per base unit; the previous price and the count skip bonus lines too.
  for (const sql of [listSql, countSql, othersSql]) assert.match(sql, /WHERE l\.entity_id = \? AND l\.unit_price IS NOT NULL AND COALESCE\(l\.price_per_base, l\.unit_price\) >= 10\) x WHERE x\.rn = 1/);
  assert.match(historySql, /AND COALESCE\(l\.price_per_base, l\.unit_price\) >= 10 ORDER BY/);
  assert.match(vendorSql, /AND l\.vendor_no = \? AND COALESCE\(l\.price_per_base, l\.unit_price\) >= 10\) x/);
  for (const c of calls) assert.equal(placeholders(c.sql), c.args.length);
});

test('migration 105: the cover view reads only its 30-day window, same columns; the last PO line is the main line', () => {
  const sql = migration('105_procurement_cover_window.sql');
  const statements = sql.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
  for (const stmt of statements) {
    assert.match(stmt, /^(SET NAMES utf8mb4|CREATE OR REPLACE VIEW \w+ AS\b|SET @c := \(SELECT COUNT\(\*\) FROM information_schema\.STATISTICS|SET @s := IF\(@c = 0, 'ALTER TABLE accurate_records ADD INDEX idx_accurate_records_type_created \(record_type, created_at\)', 'SELECT 1'\)|PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt)/, stmt.slice(0, 80));
  }
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE TABLE|GRANT)\b/i, 'no row is written');
  const view = (name) => { const at = sql.indexOf(`CREATE OR REPLACE VIEW ${name} AS`); return flat(sql.slice(at, sql.indexOf(';', at))); };
  const cover = view('wh_stock_cover_accurate');
  assert.match(cover, /^CREATE OR REPLACE VIEW wh_stock_cover_accurate AS SELECT f\.entity_id, f\.accurate_id AS item_id, COALESCE\(w\.out_30d, 0\) AS out_30d, LEAST\(30, GREATEST\(0, DATEDIFF\(NOW\(\), f\.created_at\)\)\) AS history_days FROM/);
  assert.match(cover, /AND p\.version = c\.version - 1/, 'each version against the one before it');
  assert.match(cover, /WHERE c\.record_type = 'wh_stock_total' AND c\.created_at >= NOW\(\) - INTERVAL 30 DAY/);
  assert.match(cover, /WHERE f\.record_type = 'wh_stock_total' AND f\.version = 1$/, 'history from the first version, through the unique key');
  assert.doesNotMatch(cover, /LAG\(|OVER \(/, 'no window over every version ever approved');
  const last = view('pc_item_last_po_accurate');
  assert.match(last, /ORDER BY l\.trans_date DESC, l\.po_id DESC, l\.qty_base DESC, l\.line_no DESC\) AS rn/);
  // A later migration that redefines either view must keep this.
  const dir = path.join(__dirname, '../migrations');
  const latest = (name) => fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().filter((f) => migration(f).includes(`CREATE OR REPLACE VIEW ${name} AS`)).pop();
  assert.equal(latest('wh_stock_cover_accurate'), '105_procurement_cover_window.sql');
  assert.equal(latest('pc_item_last_po_accurate'), '105_procurement_cover_window.sql');
});

test('Accurate\'s default Tgl kirim (= the PO date) is not a promise, in JS and in the view', () => {
  assert.equal(rules.promisedExpected({ trans_date: '2026-09-24', data: { expected_date: '2026-09-24' } }), null);
  assert.equal(rules.promisedExpected({ trans_date: '2026-09-24', data: { expected_date: '2026-09-20' } }), null);
  assert.equal(rules.promisedExpected({ trans_date: '2026-09-24', data: { expected_date: '2026-10-01' } }), '2026-10-01');
  const view = fs.readFileSync(path.join(__dirname, '../migrations/098_procurement_ship_date_default.sql'), 'utf8');
  assert.match(view, /IF\(JSON_VALUE\(r\.data, '\$\.expected_date' RETURNING DATE\) > r\.trans_date,/);
});
