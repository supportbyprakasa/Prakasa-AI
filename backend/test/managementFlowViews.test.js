const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Program 3.3 migrations 100–102: views only, over the insert-only mirror.
const DIR = path.join(__dirname, '..', 'migrations');
const FILES = ['100_management_flow_views.sql', '101_management_margin_views.sql', '102_management_stock_idle.sql'];
const code = (file) => fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const views = (file) => code(file).split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

test('migrations 100–102 exist and hold only SET NAMES and CREATE OR REPLACE VIEW', () => {
  for (const file of FILES) {
    assert.ok(fs.existsSync(path.join(DIR, file)), file);
    for (const stmt of views(file)) {
      assert.match(stmt, /^(SET NAMES utf8mb4|CREATE OR REPLACE VIEW \w+ AS\b)/, `${file}: ${stmt.slice(0, 60)}`);
    }
    assert.doesNotMatch(code(file), /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE TABLE|GRANT)\b/i, file);
  }
});

test('the views are the ones the services read', () => {
  const names = FILES.flatMap((f) => [...code(f).matchAll(/CREATE OR REPLACE VIEW (\w+)/g)].map((m) => m[1]));
  assert.deepEqual(names, [
    'mg_so_links_accurate', 'mg_invoice_payments_accurate', 'mg_sales_flow_accurate', 'mg_buy_flow_accurate',
    'mg_invoice_lines_accurate', 'pc_po_price_costs_accurate', 'mg_stock_idle_accurate',
  ]);
});

test('every JSON_TABLE reads the mirror through JSON_EXTRACT, and its text columns are unicode_ci', () => {
  for (const file of FILES) {
    const sql = code(file);
    const tables = (sql.match(/JSON_TABLE\(/g) || []).length;
    const extracted = (sql.match(/JSON_TABLE\(JSON_EXTRACT\(r\.data, '\$\.\w+'\), '\$\[\*\]'/g) || []).length;
    assert.equal(extracted, tables, `${file}: every JSON_TABLE(JSON_EXTRACT(r.data, '$.x'), '$[*]')`);
    for (const m of sql.matchAll(/(\w+) VARCHAR\(\d+\)( COLLATE \w+)?/g)) assert.equal(m[2], ' COLLATE utf8mb4_unicode_ci', `${file}: ${m[1]}`);
    assert.doesNotMatch(sql, /accurate_latest/, 'JSON_TABLE over accurate_latest is refused by MySQL 9.6; the MAX(version) join is used');
  }
});

test('shipping state comes from the Warehouse promise view (099), no second rule', () => {
  const sql = code('100_management_flow_views.sql');
  assert.match(sql, /FROM wh_so_fulfilment_accurate w/);
  assert.match(sql, /IF\(w\.so_state = 'shipped', w\.shipped_on, NULL\) AS shipped_on/, 'terkirim lengkap = the day the metric warehouse_ship_days uses');
  assert.match(sql, /w\.percent_shipped >= 100 OR w\.closed/, 'paid only when shipped in full or closed');
  assert.doesNotMatch(sql, /wh_so_open|ship_date|INTERVAL 3 DAY|Shopee', 'TokoPedia'\) THEN/);
});

test('prices: only pc_po_price_costs_accurate carries a purchase price; it follows the 3.1 net-price rule', () => {
  const mg = [code('100_management_flow_views.sql'), code('102_management_stock_idle.sql'), code('101_management_margin_views.sql').split('CREATE OR REPLACE VIEW pc_po_price_costs_accurate')[0]].join('\n');
  assert.doesNotMatch(mg, /unit_price|line_total|disc_pct|cost_per_base|pc_po_price/);
  const cost = code('101_management_margin_views.sql').split('CREATE OR REPLACE VIEW pc_po_price_costs_accurate')[1];
  assert.match(cost, /FROM pc_po_price_lines_accurate pl/);
  assert.match(cost, /JOIN pc_po_prices_accurate v/);
  assert.match(cost, /v\.counts_as_spend = 1 AND v\.currency = 'IDR'/);
  assert.match(cost, /pl\.line_total \* v\.dpp_amount \/ t\.lines_total \/ q\.qty_base AS cost_per_base/);
});

test('days are WIB days; no session date and no CAST(NULLIF(...) AS DATE)', () => {
  for (const file of FILES) {
    const sql = code(file);
    assert.doesNotMatch(sql, /CURDATE|CURRENT_DATE|NOW\(\)/, file);
    assert.doesNotMatch(sql, /CAST\(NULLIF\(JSON_UNQUOTE/i, file);
  }
  assert.match(code('102_management_stock_idle.sql'), /DATEDIFF\(DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), y\.idle_since\)/);
});
