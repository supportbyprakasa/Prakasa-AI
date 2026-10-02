const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const invoiceRules = require('../src/services/invoiceRules');
const warehouseRules = require('../src/services/warehouseRules');
const targets = require('../src/services/targets.service');
const dd = require('../src/services/divisionDashboard.service');
const { validateProvider } = require('../src/management/contract');

// Data-consistency audit (migration 125 and the shared rules): one figure,
// one rule, on every page.
const MIGRATION = path.join(__dirname, '..', 'migrations', '125_sales_figures_consistency.sql');
const code = () => fs.readFileSync(MIGRATION, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('migration 125 holds only views over the insert-only mirror', () => {
  const sql = code();
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    assert.match(stmt, /^(SET NAMES utf8mb4|CREATE OR REPLACE VIEW \w+ AS\b)/, stmt.slice(0, 60));
  }
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE TABLE|GRANT)\b/i);
  assert.doesNotMatch(sql, /JSON_TABLE\(\w+\.data, /, 'JSON_TABLE reads the array through JSON_EXTRACT (MySQL 9.6)');
});

test('the opening-balance date in the view is the one in invoiceRules', () => {
  const sql = code();
  assert.ok(sql.includes(`a.trans_date <= '${invoiceRules.OPENING_BALANCE_DATE}'`), 'is_opening uses OPENING_BALANCE_DATE');
  assert.match(sql, /JSON_LENGTH\(a\.data, '\$\.lines'\), 0\) = 0/, 'no product line');
  assert.match(sql, /JSON_LENGTH\(a\.data, '\$\.so_numbers'\), 0\) = 0/, 'no sales order');
  assert.match(sql, /WHERE NOT i\.is_dp AND NOT i\.is_opening/, 'revenue leaves out down payments and the opening balance');
  assert.match(sql, /IF\(y\.opening_invoices > 0, NULL, y\.first_order_at\) AS noo_date/, 'an opening-balance customer is never NOO');
});

test('invoice rules: receivables keep the opening balance, revenue does not; down payments are neither', () => {
  assert.equal(invoiceRules.openReceivableSql('i'), 'NOT i.is_dp AND i.outstanding_amount > 0');
  assert.equal(invoiceRules.revenueInvoiceSql('x'), 'NOT x.is_dp AND NOT x.is_opening');
  assert.doesNotMatch(invoiceRules.openReceivableSql('i'), /is_opening/);
  assert.equal(invoiceRules.billedMonthlyFor({ billedMonthly: true }, 'sales'), true);
  assert.equal(invoiceRules.billedMonthlyFor({ billedMonthly: ['retail_commerce'] }, 'retail_commerce'), true);
  assert.equal(invoiceRules.billedMonthlyFor({ billedMonthly: ['retail_commerce'] }, 'sales'), false);
  assert.equal(invoiceRules.billedMonthlyFor({}, 'retail_commerce'), false);
});

test('late SO: one rule with the OTIF_FROM cut and without the monthly marketplace recap', () => {
  const sql = warehouseRules.lateSoSql('x');
  assert.match(sql, /x\.so_state IN \('open', 'partial'\) AND x\.judged AND x\.promised_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/);
  assert.ok(sql.includes(`x.trans_date >= '${warehouseRules.otifFrom()}'`));
  assert.match(sql, /NOT \(x\.channel IN \('Shopee', 'TokoPedia'\) AND x\.number LIKE '%\/ECOM-%'\)/);
  // Every place that counts late SOs uses it.
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  for (const f of ['management/providers/warehouse.js', 'management/providers/retailCommerce.js',
    'services/retailCommerce.service.js', 'services/managementFlow.service.js']) {
    assert.match(read(f), /lateSoSql\('x'\)/, f);
  }
});

test('targets: a lower-is-better cumulative target judges spending ahead of pace as behind', () => {
  const budget = { better: 'lower', cumulative: true };
  const half = 0.5;
  const over = targets.evaluate(budget, 100, 80, half);
  assert.equal(over.pacePct, 62.5);
  assert.equal(over.status, 'off_track');
  const under = targets.evaluate(budget, 100, 20, half);
  assert.equal(under.pacePct, 100);
  assert.equal(under.status, 'on_track');
  assert.equal(targets.evaluate(budget, 100, 55, half).status, 'at_risk');
  // Higher is better is unchanged.
  assert.equal(targets.evaluate({ better: 'higher', cumulative: true }, 100, 80, half).status, 'on_track');
  assert.equal(targets.evaluate({ better: 'higher', cumulative: true }, 100, 20, half).status, 'off_track');
});

test('targets: a figure billed monthly has no pace while its period runs, and is judged once it ended', () => {
  const rc = { better: 'higher', cumulative: true };
  assert.deepEqual(targets.evaluate(rc, 100, 0, 0.1, { billedMonthly: true }), { achievementPct: null, pacePct: null, status: 'billed_monthly' });
  assert.equal(targets.evaluate(rc, 100, 120, 1, { billedMonthly: true }).status, 'achieved');
  assert.equal(targets.evaluate(rc, null, 0, 0.1, { billedMonthly: true }).status, 'no_target');
});

test('division dashboard: an exact company-wide rate is not marked as a mean of divisions', async () => {
  assert.equal(dd.isAveraged({ cumulative: false }, 'entity'), true);
  assert.equal(dd.isAveraged({ cumulative: false, entityActuals: async () => 1 }, 'entity'), false);
  assert.equal(dd.isAveraged({ cumulative: true }, 'entity'), false);
  assert.equal(dd.isAveraged({ cumulative: false }, 'division'), false);
  const metric = {
    cumulative: false,
    async actuals() { return new Map([[1, 90], [2, 10]]); },
    async entityActuals() { return 82.5; },
  };
  assert.equal(await dd.entityMonthValue(1, metric, {}, { id: null, code: 'all' }, 'entity'), 82.5);
  const mean = { cumulative: false, async actuals() { return new Map([[1, 90], [2, 10]]); } };
  assert.equal(await dd.entityMonthValue(1, mean, {}, { id: null, code: 'all' }, 'entity'), 50);
  assert.deepEqual(dd.HIDE.retail_commerce.metrics, ['sales.sales_revenue', 'sales.sales_orders']);
});

test('contract: entityActuals must be a function and billedMonthly true or division codes', () => {
  const base = (extra) => ({
    key: 'demo', label: 'Demo', navPaths: ['/demo'],
    metrics: [{ key: 'demo_rate', label: 'Rasio', unit: '%', better: 'higher', cumulative: false, async actuals() { return new Map(); }, ...extra }],
  });
  assert.ok(validateProvider(base({ entityActuals: async () => null, billedMonthly: ['retail_commerce'] })));
  assert.throws(() => validateProvider(base({ entityActuals: 5 })), /entityActuals/);
  assert.throws(() => validateProvider(base({ billedMonthly: 'yes' })), /billedMonthly/);
});

test('real providers: the rates with an exact company value, and the RC figures billed monthly', () => {
  const registry = require('../src/management/registry');
  const exact = registry.metrics().filter((m) => m.entityActuals).map((m) => m.key).sort();
  assert.ok(exact.includes('finance_receivable_overdue_share'));
  const billed = Object.fromEntries(registry.metrics().filter((m) => m.billedMonthly).map((m) => [m.key, m.billedMonthly]));
  assert.equal(billed.rc_marketplace_revenue, true);
  assert.equal(billed.rc_orders, true);
  assert.deepEqual([...billed.sales_revenue], ['retail_commerce']);
});
