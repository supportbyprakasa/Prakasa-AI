const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../src/services/warehouseRules');
const { orderRow } = require('../src/services/accurate/salesPull');
const batches = require('../src/services/salesAccurateBatches.service');

// Program 3.4: one promise ("Janji kirim") for Jadwal kirim, Hari ini, the
// OTIF view and the escalation; Tgl kirim and "ditutup" stored on SOs only
// when they mean something.

const stripComments = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const m099 = stripComments(fs.readFileSync(path.join(__dirname, '../migrations/099_warehouse_so_fulfilment.sql'), 'utf8'));

test('the promise: Tgl kirim only when after the SO date, else 2×24 jam (a Sunday moves to Monday)', () => {
  assert.equal(rules.promisedSql('z'), 'IF(z.ship_date > z.trans_date, z.ship_date, z.trans_date + INTERVAL (2 + (DAYOFWEEK(z.trans_date + INTERVAL 2 DAY) = 1)) DAY)');
  assert.ok(m099.includes(rules.promisedSql('z')), 'the view uses the same rule, verbatim');
  assert.ok(m099.includes(`INTERVAL ${rules.SHIP_SLA_DAYS} DAY`));
});

test('a standard promise moved from Sunday to Monday is flagged by the same rule and said so', () => {
  // Only without a Tgl kirim of its own, and only when the promise is later than the standard (a Friday SO).
  assert.equal(rules.promiseShiftedSql('s'), `(NOT COALESCE(s.ship_date > s.trans_date, FALSE) AND DATEDIFF(${rules.promisedSql('s')}, s.trans_date) > 2)`);
  assert.equal(rules.standardPromiseText(0), 'standar 2×24 jam dari tanggal SO');
  assert.equal(rules.standardPromiseText(null), 'standar 2×24 jam dari tanggal SO');
  assert.equal(rules.standardPromiseText('1'), 'standar 2×24 jam dari tanggal SO, digeser ke Senin');
  assert.equal(rules.standardPromiseText(true), 'standar 2×24 jam dari tanggal SO, digeser ke Senin');
});

test('the OTIF view carries dates and quantities only, and reads JSON arrays the way MySQL 9.6 accepts', () => {
  assert.doesNotMatch(m099, /dpp_amount|total_amount|outstanding_amount|price|tax_amount/i, 'no amounts (D1)');
  assert.doesNotMatch(m099, /JSON_TABLE\(\w+\.data, '\$\.so_numbers\[\*\]'/);
  assert.match(m099, /JSON_TABLE\(JSON_EXTRACT\(o\.data, '\$\.so_numbers'\), '\$\[\*\]'/);
  assert.match(m099, /JSON_TABLE\(JSON_EXTRACT\(i\.data, '\$\.so_numbers'\), '\$\[\*\]'/);
});

test('the OTIF view keeps its rules: cancelled only by the promise, judged only on complete data', () => {
  assert.ok(m099.includes('p.closed_on <= p.promised_date'), 'a close after the promise is short, not a cancellation');
  assert.ok(m099.includes('LEFT JOIN sales_accurate_batches cb ON cb.id = v.batch_id'), 'closed on = the pull that saw it, not the approval');
  assert.ok(m099.includes("b.status IN ('pending', 'applied')"));
  assert.ok(m099.includes('FROM sales_sync_runs r'), 'a stale mirror (no pull) is never judged');
  assert.ok(m099.includes('(y.data_through IS NULL OR y.promised_date < y.data_through) AS judged'));
  assert.ok(m099.includes("NOT COALESCE(JSON_EXTRACT(i.data, '$.dp') = TRUE, FALSE)"), 'down-payment fakturs never count as shipping');
  assert.doesNotMatch(m099, /accurate_latest/, 'latest version per record type, not over the whole mirror');
});

test('data_through counts only the Sales pulls whose data reached the mirror (103 = 099 + that filter)', () => {
  const dir = path.join(__dirname, '../migrations');
  const m103 = stripComments(fs.readFileSync(path.join(dir, '103_warehouse_so_data_through.sql'), 'utf8'));
  const skippedDivision = "AND NOT JSON_CONTAINS(COALESCE(JSON_EXTRACT(r.stats, '$.skipped[*].departmentId'), JSON_ARRAY()), CAST(d.id AS JSON))";
  const decidedAgainst = "AND NOT EXISTS (SELECT 1 FROM sales_accurate_batches x WHERE x.sync_run_id = r.id AND x.department_id = d.id AND x.status IN ('rejected', 'withdrawn'))";
  const flat = (sql) => sql.replace(/\s+/g, ' ').trim();
  const view = (sql) => {
    const start = sql.indexOf('CREATE OR REPLACE VIEW wh_so_fulfilment_accurate AS');
    return flat(sql.slice(start, sql.indexOf(';', start) + 1));
  };
  assert.ok(view(m103).includes(skippedDivision), 'a pull that skipped the division brought none of its data');
  assert.ok(view(m103).includes(decidedAgainst), 'nor did a pull whose batch for the division was rejected or withdrawn');
  assert.equal(view(m103).replace(` ${skippedDivision} ${decidedAgainst}`, ''), view(m099), 'otherwise the view of 099, verbatim');
  assert.ok(m103.includes(rules.promisedSql('z')), 'the same promise');
  assert.equal(m103.split('CREATE OR REPLACE VIEW').length, 2, 'wh_so_open_lines_accurate has no data_through and is not redefined');
  // A later migration that redefines the view must keep the filter.
  const last = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('CREATE OR REPLACE VIEW wh_so_fulfilment_accurate')).pop();
  assert.ok(view(stripComments(fs.readFileSync(path.join(dir, last), 'utf8'))).includes(skippedDivision), `${last} keeps the filter`);
});

test('Jadwal kirim lines keep every column of 092, plus the SO date', () => {
  const m092 = stripComments(fs.readFileSync(path.join(__dirname, '../migrations/092_warehouse_so_open_units.sql'), 'utf8'));
  const cols = (sql) => {
    const v = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW wh_so_open_lines_accurate'));
    return v.slice(v.indexOf('SELECT') + 6, v.indexOf('FROM')).split(',').map((c) => c.trim().split(/\s+/).pop().replace(/^y\./, ''));
  };
  assert.deepEqual(cols(m099), [...cols(m092), 'trans_date']);
});

test('an SO stores Tgl kirim only when later than its date, and "ditutup" only when closed by hand', () => {
  const A = { number: 'SO1', transDate: '01/10/2026', statusName: 'Menunggu diproses', percentShipped: 0, tax1Amount: 0, totalAmount: 100, customer: { customerNo: 'C-1', name: 'Toko' } };
  const channels = new Map();
  assert.equal(orderRow({ ...A, shipDate: '03/10/2026' }, channels).data.ship_date, '2026-10-03');
  assert.equal('ship_date' in orderRow({ ...A, shipDate: '01/10/2026' }, channels).data, false);
  assert.equal('ship_date' in orderRow({ ...A, shipDate: '30/09/2026' }, channels).data, false);
  assert.equal(orderRow({ ...A, manualClosed: true }, channels).data.closed, true);
  assert.equal('closed' in orderRow({ ...A, manualClosed: false }, channels).data, false);
  // An SO without a promise or a manual close keeps its content: no new version.
  assert.equal(
    batches.contentHash('sales_order', orderRow(A, channels)),
    batches.contentHash('sales_order', orderRow({ ...A, shipDate: '01/10/2026', manualClosed: false }, channels)),
  );
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.sales_order, { percent_shipped: 100, tax_amount: 1, ship_date: '2026-10-03', closed: true }), []);
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.sales_order, { address: 'x' }), ['address']);
});

test('Hari ini counts SOs due by the same promise', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/warehouseDocuments.service.js'), 'utf8');
  assert.ok(src.includes("${promisedSql('o')} <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS so_due"));
});
