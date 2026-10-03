// "Periksa dengan AI" on a Data Accurate batch (Prakasa AI Wave D2):
// services/accurateBatchReview.service.js, POST /accurate/batches/:id/review,
// the read tool `periksa_batch_accurate` and the scoped agent run.
// A review is notes for the human who decides: nothing here may decide.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'uji-secret-panjang-sekali-untuk-tes-saja-0123456789';
const {
  pool, dbReady, inRolledBackTransaction, makeUser, departmentId, shutdown,
} = require('./fixtures/gaDb');

const B = '../src';
const review = require(`${B}/services/accurateBatchReview.service`);
const batches = require(`${B}/services/salesAccurateBatches.service`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const agentRun = require(`${B}/services/ai/agent/agentRun`);
const { verifyAgentToken } = require(`${B}/services/ai/agent/agentToken`);
const aiProvider = require(`${B}/services/ai/provider`);
const aiAgent = require(`${B}/controllers/aiAgent.controller`);
const controller = require(`${B}/controllers/accurateReview.controller`);
const router = require(`${B}/routes/accurateReview.routes`);
const { batchReviewLimiter } = require(`${B}/middleware/rateLimits`);
const { MONEY_KEY, PERSONAL_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const registry = require(`${B}/services/aiToolRegistry.service`);
const coverage = require(`${B}/services/ai/agent/moduleCoverage`);

test.after(() => shutdown());
const DB_TEST = { timeout: 90000 };
const SKIP = 'butuh database lokal dengan skema terbaru';
const tool = (name) => agentTools.byName.get(name);
const codes = (result) => result.findings.map((f) => f.code);
const byCode = (result, code) => result.findings.find((f) => f.code === code);
const RUPIAH_IN_KEYS = (value) => JSON.stringify(value).match(/"(before|after)":/);

// One row as ITEMS_SQL returns it.
const item = (type, action, extKey, fields = {}) => ({
  type, action, extKey: String(extKey), label: fields.number || String(extKey), number: null, transDate: null, customerNo: null, channel: null,
  afterDpp: null, afterTotal: null, beforeDpp: null, beforeTotal: null, soNumbers: null, itemNos: null, mirrorVersion: null, mirrorDpp: null, mirrorTotal: null,
  ...fields,
});
const PULLED = '2026-10-02';
const FIXTURE = [
  // a plain new invoice of this month: nothing to say
  item('sales_invoice', 'create', 1, { number: 'SI-OK', transDate: '2026-10-01', customerNo: 'C-1', channel: 'GT', afterDpp: '1000000', soNumbers: '["SO-1"]', itemNos: '["B-1"]' }),
  // value up 50% against the approved mirror, dated last month
  item('sales_invoice', 'update', 2, { number: 'SI-NAIK', transDate: '2026-09-10', customerNo: 'C-1', channel: 'GT', afterDpp: '15000000', beforeDpp: '9000000', mirrorVersion: 3, mirrorDpp: '10000000.00', soNumbers: '["SO-2"]' }),
  // a small change: below both thresholds
  item('sales_invoice', 'update', 3, { number: 'SI-KECIL', transDate: '2026-10-01', customerNo: 'C-1', channel: 'GT', afterDpp: '1050000', mirrorVersion: 1, mirrorDpp: '1000000.00', soNumbers: '["SO-3"]' }),
  // gone from Accurate, an old document
  item('sales_invoice', 'missing', 4, { number: 'SI-HILANG', transDate: '2026-06-01', customerNo: 'C-1', channel: 'GT', mirrorVersion: 2, mirrorDpp: '500000.00' }),
  // dated in the future, no SO, no channel, unknown customer, item without units
  item('sales_invoice', 'create', 5, { number: 'SI-MASA-DEPAN', transDate: '2026-12-31', customerNo: 'C-BARU', channel: null, afterDpp: '200000', soNumbers: '[]', itemNos: '["B-1","B-TANPA-SATUAN"]' }),
  // the same number twice in the batch
  item('sales_order', 'create', 6, { number: 'SO-GANDA', transDate: '2026-10-02', customerNo: 'C-1', channel: 'GT', afterDpp: '100' }),
  item('sales_order', 'create', 7, { number: 'so-ganda', transDate: '2026-10-02', customerNo: 'C-1', channel: 'GT', afterDpp: '100' }),
  // a purchase order whose value doubled: flagged, but its amounts are never shown
  item('pc_po', 'update', 8, { number: 'PO-1', transDate: '2026-10-01', afterDpp: '40000000', mirrorVersion: 1, mirrorDpp: '20000000.00' }),
  item('customer', 'create', 9, { number: 'C-2', channel: '' }),
];
const checked = (extra = {}) => review.check({
  items: FIXTURE, pulledOn: PULLED, customers: new Set(['C-1']), unitItems: new Set(['B-1']), mirrorDuplicates: [],
  summary: { checks: { complete: false, stock_sum: { mismatched: 4 }, unread_documents: { sales_invoice: 2, delivery_order: 1 } } },
  limits: { valuePercent: 20, valueRupiah: 10000000, backdatedDays: 30 }, ...extra,
});

test('findings on a fixture batch: each check finds exactly its documents', () => {
  const out = checked();
  assert.deepEqual(out.contents.find((c) => c.type === 'sales_invoice'), { type: 'sales_invoice', label: 'Faktur', create: 2, update: 2, missing: 1 });
  assert.deepEqual(out.contents.find((c) => c.type === 'pc_po'), { type: 'pc_po', label: 'Purchase order', create: 0, update: 1, missing: 0 });

  const big = byCode(out, 'NILAI_BERUBAH_BESAR');
  assert.equal(big.count, 2, 'SI-NAIK and PO-1; the 5% change is not flagged');
  assert.deepEqual(big.examples.map((e) => e.number), ['PO-1', 'SI-NAIK'], 'largest change first');
  assert.deepEqual(big.examples[1], { number: 'SI-NAIK', type: 'sales_invoice', percent: 50, before: 10000000, after: 15000000 }, 'against the approved mirror, not the staged "before"');
  assert.deepEqual(big.examples[0], { number: 'PO-1', type: 'pc_po', percent: 100 }, 'a purchase order never carries its amounts');
  assert.equal(big.severity, 'high');

  assert.deepEqual(byCode(out, 'TIDAK_ADA_LAGI').examples.map((e) => e.number), ['SI-HILANG']);
  assert.deepEqual(byCode(out, 'NOMOR_GANDA').examples.map((e) => e.number), ['SO-GANDA']);
  assert.deepEqual(byCode(out, 'TANGGAL_MASA_DEPAN').examples.map((e) => e.number), ['SI-MASA-DEPAN']);
  assert.deepEqual(byCode(out, 'UBAH_DOKUMEN_LAMA').examples.map((e) => e.number), ['SI-HILANG'], 'older than 30 days and changed');
  const period = byCode(out, 'PERIODE_LALU');
  assert.deepEqual([period.severity, period.count, period.title], ['high', 2, 'Perubahan pada dokumen bulan sebelumnya']);
  assert.deepEqual(period.examples.map((e) => e.number), ['SI-NAIK', 'SI-HILANG']);
  assert.deepEqual(byCode(out, 'FAKTUR_TANPA_SO').examples.map((e) => e.number), ['SI-MASA-DEPAN']);
  assert.deepEqual(byCode(out, 'CUSTOMER_BELUM_DI_MASTER').examples, [{ number: 'SI-MASA-DEPAN', type: 'sales_invoice', customerNo: 'C-BARU' }]);
  assert.deepEqual(byCode(out, 'BARANG_TANPA_KONVERSI_SATUAN').examples.map((e) => e.number), ['SI-MASA-DEPAN']);
  assert.deepEqual(byCode(out, 'CHANNEL_KOSONG').examples.map((e) => e.number).sort(), ['C-2', 'SI-MASA-DEPAN']);
  assert.deepEqual([byCode(out, 'TARIKAN_TIDAK_LENGKAP').count, byCode(out, 'STOK_TIDAK_COCOK').count, byCode(out, 'DOKUMEN_BELUM_TERBACA').count], [1, 4, 3]);

  // Ordered by severity; each finding says why it matters and carries at most five examples.
  const order = out.findings.map((f) => ['high', 'medium', 'low'].indexOf(f.severity));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const f of out.findings) {
    assert.ok(f.why.length > 30 && f.title && f.count > 0 && f.examples.length <= 5, f.code);
    assert.deepEqual(Object.keys(f).sort(), ['code', 'count', 'examples', 'severity', 'title', 'why']);
  }
});

test('findings: a clean batch has none; first pulls and an unapproved unit master are said plainly', () => {
  const clean = review.check({ items: [FIXTURE[0]], pulledOn: PULLED, customers: new Set(['C-1']), unitItems: new Set(['B-1']) });
  assert.deepEqual(clean.findings, []);
  assert.deepEqual(clean.notChecked, []);

  // New documents dated in earlier months (a first pull): low, with its own title.
  const first = review.check({
    items: [item('sales_invoice', 'create', 1, { number: 'SI-LAMA', transDate: '2026-02-03', customerNo: 'C-1', channel: 'GT', soNumbers: '["SO-1"]', itemNos: '["B-1"]' })],
    pulledOn: PULLED, customers: new Set(['C-1']), unitItems: null,
  });
  assert.deepEqual(codes(first), ['PERIODE_LALU']);
  assert.deepEqual([first.findings[0].severity, first.findings[0].title], ['low', 'Dokumen baru bertanggal bulan sebelumnya']);
  assert.deepEqual(first.notChecked.map((x) => x.code), ['BARANG_TANPA_KONVERSI_SATUAN'], 'no unit master yet: not judged, and said so');

  // A number the approved mirror already uses under another id.
  const dup = review.check({ items: [FIXTURE[0]], pulledOn: PULLED, customers: new Set(['C-1']), unitItems: new Set(['B-1']), mirrorDuplicates: [{ type: 'sales_invoice', number: 'SI-OK' }] });
  assert.deepEqual(codes(dup), ['NOMOR_GANDA']);

  // More than five documents: the count is whole, the examples are five.
  const many = review.check({
    items: Array.from({ length: 12 }, (_, i) => item('sales_invoice', 'missing', 100 + i, { number: `SI-${i}`, transDate: '2026-10-01', channel: 'GT' })),
    pulledOn: PULLED,
  });
  assert.deepEqual([byCode(many, 'TIDAK_ADA_LAGI').count, byCode(many, 'TIDAK_ADA_LAGI').examples.length], [12, 5]);
});

test('thresholds are configurable', (t) => {
  const keep = { ...process.env };
  t.after(() => { process.env = keep; });
  process.env.ACCURATE_REVIEW_VALUE_PERCENT = '60';
  process.env.ACCURATE_REVIEW_VALUE_RUPIAH = '50000000';
  process.env.ACCURATE_REVIEW_BACKDATED_DAYS = '365';
  assert.deepEqual(review.thresholds(), { valuePercent: 60, valueRupiah: 50000000, backdatedDays: 365 });
  const out = review.check({ items: FIXTURE, pulledOn: PULLED, customers: new Set(['C-1']), unitItems: new Set(['B-1']), limits: review.thresholds() });
  assert.deepEqual(byCode(out, 'NILAI_BERUBAH_BESAR').examples.map((e) => e.number), ['PO-1'], '50% is below 60%, Rp 5 juta below Rp 50 juta');
  assert.equal(byCode(out, 'UBAH_DOKUMEN_LAMA'), undefined);
  process.env.ACCURATE_REVIEW_VALUE_PERCENT = 'abc';
  assert.equal(review.thresholds().valuePercent, 20, 'a bad setting falls back');
});

test('money gating: rupiah only for a reader with the division\'s money permission, never for purchase orders', () => {
  const raw = checked();
  const closed = review.present(raw, { money: false });
  assert.equal(RUPIAH_IN_KEYS(closed.findings), null);
  assert.equal(closed.money, false);
  assert.deepEqual(byCode(closed, 'NILAI_BERUBAH_BESAR').examples.map((e) => [e.number, e.percent]), [['PO-1', 100], ['SI-NAIK', 50]], 'numbers and percent stay');
  const open = review.present(raw, { money: true });
  assert.deepEqual(byCode(open, 'NILAI_BERUBAH_BESAR').examples.find((e) => e.number === 'SI-NAIK').after, 15000000);
  assert.equal('after' in byCode(open, 'NILAI_BERUBAH_BESAR').examples.find((e) => e.number === 'PO-1'), false, 'purchase prices stay closed even with money');
  assert.deepEqual(review.MONEY_PERMISSION, { sales: 'sales.order.view', retail_commerce: 'sales.order.view', finance: 'finance.payable.view' }, 'Warehouse and Procurement batches show no rupiah to anyone');
});

function mockBatch(t, { visible = true, code = 'sales', items = FIXTURE } = {}) {
  const calls = [];
  t.mock.method(batches, 'getBatch', async (user, id) => {
    calls.push({ sql: `getBatch ${id} as ${user.sub}` });
    if (!visible) throw Object.assign(new Error('Batch data Accurate tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });
    return { id, departmentId: 5, departmentName: 'Sales', status: 'pending', itemCount: items.length, summary: {}, approvalRequestId: 77, createdAt: new Date('2026-10-02T03:00:00Z') };
  });
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql: String(sql), args });
    if (/SELECT code FROM departments/.test(sql)) return [[{ code }]];
    if (/FROM sales_accurate_batch_items i\s+LEFT JOIN accurate_latest/.test(sql)) return [items];
    if (/JOIN accurate_latest m\s+ON m\.entity_id = \? AND m\.record_type = i\.record_type AND m\.accurate_id <>/.test(sql)) return [[]];
    if (/FROM sales_customers/.test(sql)) return [[{ code: 'C-1' }]];
    if (/EXISTS\(SELECT 1 FROM item_units_accurate/.test(sql)) return [[{ live: 1 }]];
    if (/FROM item_units_accurate/.test(sql)) return [[{ itemNo: 'B-1' }]];
    if (/FROM accurate_batch_reviews/.test(sql)) return [[{ findings: JSON.stringify(checked()), ai_note: 'Catatan lama', ai_status: 'ok', created_at: new Date('2026-10-02T04:00:00Z'), requested_by_name: 'Uji Head' }]];
    return [{ affectedRows: 1, insertId: 1 }];
  });
  return calls;
}
const supervisor = (permissions) => ({ sub: 15, entityId: 7, departmentId: 5, email: 'uji@example.invalid', permissions });

test('run: findings are kept as the batch\'s review and audited with codes only — nothing else is written', async (t) => {
  const calls = mockBatch(t);
  const out = await review.run(supervisor(['accurate.batch.view', 'sales.order.view']), 41, { ai: true });
  assert.equal(out.money, true);
  assert.equal(byCode(out, 'NILAI_BERUBAH_BESAR').examples.find((e) => e.number === 'SI-NAIK').before, 10000000);
  const writes = calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(c.sql));
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /^\s*INSERT INTO accurate_batch_reviews[\s\S]*ON DUPLICATE KEY UPDATE[\s\S]*ai_note = NULL/, 'a re-run replaces the earlier review');
  assert.deepEqual(writes[0].args.slice(0, 3), [7, 41, 15]);
  assert.match(writes[1].sql, /INSERT INTO activity_logs/);
  const [entityId, userId, action, subjectType, subjectId, metadata] = writes[1].args;
  assert.deepEqual([entityId, userId, action, subjectType, subjectId], [7, 15, 'accurate.batch_review', 'sales_accurate_batch', 41]);
  const meta = JSON.parse(metadata);
  assert.deepEqual(Object.keys(meta).sort(), ['ai', 'codes']);
  assert.ok(meta.codes.includes('NILAI_BERUBAH_BESAR') && meta.codes.every((c) => /^[A-Z_]+$/.test(c)));
  assert.doesNotMatch(metadata, /\d{4,}|SI-|PO-/, 'the audit row holds no value and no document number');
  // Every read is bound to the company and the batch.
  const itemsQuery = calls.find((c) => /FROM sales_accurate_batch_items i\s+LEFT JOIN/.test(c.sql));
  assert.deepEqual(itemsQuery.args, [7, 41]);

  // A reader without the money permission gets the same findings without rupiah — from run, from the stored review.
  const closed = await review.run(supervisor(['accurate.batch.view']), 41);
  assert.equal(RUPIAH_IN_KEYS(closed.findings), null);
  const stored = await review.latest(supervisor(['accurate.batch.view']), 41);
  assert.equal(RUPIAH_IN_KEYS(stored.findings), null);
  assert.deepEqual([stored.requestedByName, stored.aiNote, stored.aiStatus], ['Uji Head', 'Catatan lama', 'ok']);
  assert.ok((await review.latest(supervisor(['accurate.batch.view', 'sales.order.view']), 41)).findings.some((f) => RUPIAH_IN_KEYS(f.examples)));
});

test('a Warehouse or Procurement batch shows no rupiah, whatever the reader holds', async (t) => {
  mockBatch(t, { code: 'procurement' });
  const out = await review.run(supervisor(['accurate.batch.view', 'sales.order.view', 'finance.payable.view', 'procurement.price.view']), 41);
  assert.equal(out.money, false);
  assert.equal(RUPIAH_IN_KEYS(out.findings), null);
});

test('visibility: another division\'s batch does not exist for this caller (404), and nothing is read or written', async (t) => {
  const calls = mockBatch(t, { visible: false });
  const user = supervisor(['accurate.batch.view', 'sales.order.view']);
  const notFound = (e) => e.status === 404 && e.code === 'NOT_FOUND';
  await assert.rejects(review.run(user, 41), notFound);
  await assert.rejects(review.findingsFor(user, 41), notFound);
  await assert.rejects(review.latest(user, 41), notFound);
  await assert.rejects(review.writeNote(user, 41), notFound);
  await assert.rejects(review.run(user, 'abc'), notFound);
  assert.ok(calls.every((c) => /^getBatch/.test(c.sql)), 'no batch content is read, no row is written');
  // The tool says "not found" without confirming the batch exists.
  assert.deepEqual(await tool('periksa_batch_accurate').run(user, { id_batch: 41 }), { ditemukan: false, catatan: 'Batch itu tidak ditemukan di antara batch yang boleh Anda lihat.' });
  // The HTTP answers.
  const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  for (const handler of [controller.latest, controller.review]) {
    const r = res();
    await handler({ user, params: { id: '41' }, body: {}, headers: {} }, r, (e) => { throw e; });
    assert.deepEqual([r.statusCode, r.body.error.code], [404, 'NOT_FOUND']);
  }
});

test('the endpoint: batch view permission, six runs per hour per user, a strict body', async () => {
  const layer = (method) => router.stack.find((l) => l.route && l.route.path === '/batches/:id/review' && l.route.methods[method]);
  const post = layer('post').route.stack.map((l) => l.handle);
  assert.equal(post.length, 4);
  assert.equal(post[1], batchReviewLimiter);
  assert.equal(post[3], controller.review);
  assert.equal(layer('get').route.stack.at(-1).handle, controller.latest);
  // The permission middleware: the batch view permission (or the Sales master permission), nothing else.
  const guard = (permissions) => new Promise((resolve) => {
    const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve(this.statusCode); return this; } };
    post[0]({ user: { sub: 1, permissions } }, r, () => resolve('next'));
  });
  assert.equal(await guard(['accurate.batch.view']), 'next');
  assert.equal(await guard(['sales.master.manage']), 'next');
  assert.equal(await guard(['sales.order.view', 'approval.decide']), 403);
  // { ai } only.
  const valid = (body) => new Promise((resolve) => {
    const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { resolve(false); return this; } };
    post[2]({ body }, r, () => resolve(true));
  });
  assert.equal(await valid({}), true);
  assert.equal(await valid({ ai: true }), true);
  assert.equal(await valid({ ai: true, approve: true }), false);
  assert.equal(await valid({ ai: 'ya' }), false);

  const hit = (sub) => new Promise((resolve) => {
    const r = {
      statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, append() {},
      status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, body: b }); return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    batchReviewLimiter({ user: { sub }, ip: '203.0.113.7', headers: {}, app: { get: () => false } }, r, () => resolve({ status: 'next' }));
  });
  const who = 900000 + (process.pid % 1000);
  for (let i = 0; i < 6; i += 1) assert.equal((await hit(who)).status, 'next', `run ${i + 1}`);
  const blocked = await hit(who);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.equal((await hit(who + 1)).status, 'next', 'another user is not affected');
});

test('AI unavailable or daily limit reached: the findings stay, with a note; the model is never called', async (t) => {
  const calls = mockBatch(t);
  const user = supervisor(['accurate.batch.view', 'sales.order.view']);
  t.mock.method(aiProvider, 'getModuleContext', async () => ({ provider: 'claude_team' }));
  t.mock.method(aiProvider, 'withAccessContext', async () => ({ resolvedProvider: 'claude_team' }));
  const runModule = t.mock.method(aiProvider, 'runModule', async () => { throw new Error('must not run'); });
  const prepare = t.mock.method(agentRun, 'prepareScoped', async () => { throw new Error('must not prepare'); });
  const decide = t.mock.method(agentRun, 'decide', async () => ({ ok: false, reason: 'daily_limit', notice: 'Batas harian 50 jawaban dengan akses data tercapai.' }));
  const limit = await review.writeNote(user, 41);
  assert.equal(limit.status, 'daily_limit');
  assert.match(limit.notice, /Batas harian 50[\s\S]*Hasil pemeriksaan otomatis di atas tetap berlaku/);
  assert.equal(limit.note, undefined);
  assert.deepEqual(decide.mock.calls[0].arguments[0].session, { id: null, visibility: 'private', web_research: 0 }, 'private, no web research');
  for (const reason of ['disabled', 'provider', 'not_configured', 'no_tools']) {
    decide.mock.mockImplementation(async () => ({ ok: false, reason }));
    const out = await review.writeNote(user, 41);
    assert.equal(out.status, reason);
    assert.match(out.notice, /tetap berlaku/);
  }
  // A division routed to an engine without tools: said before anything is sent.
  aiProvider.withAccessContext.mock.mockImplementation(async () => ({ resolvedProvider: 'gemini' }));
  decide.mock.mockImplementation(async ({ provider }) => (provider === 'claude_team' ? { ok: true } : { ok: false, reason: 'provider' }));
  assert.equal((await review.writeNote(user, 41)).status, 'provider');
  assert.equal(runModule.mock.callCount(), 0);
  aiProvider.withAccessContext.mock.mockImplementation(async () => ({ resolvedProvider: 'claude_team' }));
  // The engine itself failing is not an error for the page either.
  decide.mock.mockImplementation(async () => ({ ok: true }));
  prepare.mock.mockImplementation(async () => ({ tools: [{ name: 'periksa_batch_accurate', label: 'Memeriksa batch Data Accurate' }], cleanup: async () => {} }));
  runModule.mock.mockImplementation(async () => { throw Object.assign(new Error('CLI timeout'), { code: 'AI_TIMEOUT' }); });
  assert.equal((await review.writeNote(user, 41)).status, 'failed');
  const saved = calls.filter((c) => /UPDATE accurate_batch_reviews SET ai_note = \?, ai_status = \?/.test(c.sql)).map((c) => c.args.slice(0, 2));
  assert.deepEqual(saved, [[null, 'daily_limit'], [null, 'disabled'], [null, 'provider'], [null, 'not_configured'], [null, 'no_tools'], [null, 'provider'], [null, 'failed']]);
  assert.ok(!calls.some((c) => /ai_usage_events/.test(c.sql)), 'no usage is counted when nothing was written');

  // The HTTP answer without a stream: findings + the note about the engine.
  decide.mock.mockImplementation(async () => ({ ok: false, reason: 'disabled' }));
  const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.review({ user, params: { id: '41' }, body: { ai: true }, headers: {} }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.data.findings.length > 0);
  assert.deepEqual([r.body.data.aiNote, r.body.data.aiStatus], [null, 'disabled']);
  assert.match(r.body.data.aiNotice, /tetap berlaku/);
});

test('AI note: one run, one read tool, private, no web research — and never a verdict', async (t) => {
  const calls = mockBatch(t);
  const user = supervisor(['accurate.batch.view', 'sales.order.view']);
  t.mock.method(aiProvider, 'getModuleContext', async () => ({ provider: 'claude_team' }));
  t.mock.method(aiProvider, 'withAccessContext', async () => ({ resolvedProvider: 'claude_team' }));
  t.mock.method(agentRun, 'decide', async () => ({ ok: true }));
  t.mock.method(agentRun, 'userLanguage', async () => 'id');
  let cleaned = 0;
  const prepared = [];
  t.mock.method(agentRun, 'prepareScoped', async (args) => { prepared.push(args); return { tools: [{ name: 'periksa_batch_accurate', label: 'Memeriksa batch Data Accurate' }], cleanup: async () => { cleaned += 1; } }; });
  const runs = [];
  t.mock.method(aiProvider, 'runModule', async (module, prompt, ctx) => {
    runs.push({ module, prompt, ctx });
    ctx.onStatus({ type: 'step', id: 's1', tool: 'periksa_batch_accurate', label: 'Memeriksa batch Data Accurate', status: 'running' });
    ctx.onDelta('Isi batch: ');
    return { content: 'Isi batch: 5 faktur. Yang perlu dicermati: SI-NAIK naik 50%. Menurut saya sebaiknya batch ini disetujui saja. Pertanyaan untuk tim: siapa yang mengubah SI-NAIK?', provider: 'claude_team', model: 'sonnet', agentUsed: true };
  });
  const seen = { delta: '', steps: [] };
  const out = await review.writeNote(user, 41, { onDelta: (text) => { seen.delta += text; }, onStatus: (s) => seen.steps.push(s.tool) });
  assert.equal(out.status, 'ok');
  assert.equal(runs.length, 1, 'the model runs once per click');
  assert.equal(runs[0].module, 'ai_command_center', 'the Command Center\'s own provider path');
  assert.deepEqual(prepared[0], { user, toolNames: ['periksa_batch_accurate'], purpose: 'accurate_batch_review', subjectId: 41 });
  assert.equal(runs[0].ctx.webResearch, null);
  assert.deepEqual(runs[0].ctx.agent.tools.map((x) => x.name), ['periksa_batch_accurate']);
  assert.deepEqual([runs[0].ctx.subjectType, runs[0].ctx.subjectId, runs[0].ctx.userId], ['sales_accurate_batch', 41, 15]);
  assert.match(runs[0].prompt, /kamu tidak memutuskan/i);
  assert.match(runs[0].prompt, /Tidak ada yang janggal menurut pemeriksaan otomatis/);
  assert.doesNotMatch(runs[0].prompt, /SI-NAIK|10000000/, 'the findings reach the model through the tool only, never the prompt');
  assert.deepEqual([seen.delta, seen.steps], ['Isi batch: ', ['periksa_batch_accurate']]);
  assert.doesNotMatch(out.note, /sebaiknya[^.]*disetujui/, 'a sentence that advises the decision is taken out');
  assert.match(out.note, /keputusan ada pada Anda/);
  assert.match(out.note, /SI-NAIK naik 50%/);
  assert.equal(cleaned, 1, 'the private agent config is removed');
  const saved = calls.find((c) => /UPDATE accurate_batch_reviews SET ai_note = \?, ai_status = \?/.test(c.sql));
  assert.deepEqual(saved.args, [out.note, 'ok', 41, 7]);
  const usage = calls.find((c) => /INSERT INTO ai_usage_events/.test(c.sql));
  assert.match(usage.sql, /'agent_message'/, 'counts toward the daily agent limit');

  // The cleaner, on its own.
  assert.equal(review.cleanNote('Tidak ada yang janggal menurut pemeriksaan otomatis.'), 'Tidak ada yang janggal menurut pemeriksaan otomatis.');
  assert.doesNotMatch(review.cleanNote('Catatan. I recommend you approve this batch. Tanyakan tim.'), /approve/);
  assert.doesNotMatch(review.cleanNote('Saya sarankan batch ini ditolak karena ganda.'), /ditolak/);
  assert.match(review.cleanNote('Dokumen SI-1 ditolak bank? Tanyakan admin.'), /ditolak bank/, 'a plain mention is not a verdict');
});

test('the tool contract: periksa_batch_accurate reads, in private, without rupiah, and is offered where the batch page is', async (t) => {
  mockBatch(t);
  const def = tool('periksa_batch_accurate');
  assert.ok(def, 'registered');
  assert.equal(def.privateOnly, true);
  assert.notEqual(def.money, true);
  assert.deepEqual([...def.module], ['accurate-batches']);
  assert.deepEqual([].concat(def.permission), ['accurate.batch.view', 'sales.master.manage']);
  assert.match(def.description, /tidak pernah menyetujui atau menolak/);
  assert.match(def.description, /Tanpa nilai rupiah/);
  assert.equal(def.inputSchema.additionalProperties, false);
  assert.ok(coverage.coverage().covered['accurate-batches'].includes('periksa_batch_accurate'));
  assert.deepEqual(coverage.coverage().problems, []);

  const holder = supervisor(['accurate.batch.view', 'sales.order.view']);
  await assert.rejects(def.run(supervisor(['sales.order.view']), { id_batch: 41 }), (e) => e.status === 403);
  assert.ok(!agentTools.toolsFor(supervisor(['sales.order.view']), { visibility: 'private' }).some((x) => x.name === 'periksa_batch_accurate'));
  assert.ok(agentTools.toolsFor(holder, { visibility: 'private' }).some((x) => x.name === 'periksa_batch_accurate'));
  assert.ok(!agentTools.toolsFor(holder, { visibility: 'shared' }).some((x) => x.name === 'periksa_batch_accurate'), 'never in a shared conversation');
  assert.ok(!agentTools.toolsFor(holder, { visibility: 'private', web_research: 1 }).some((x) => x.name === 'periksa_batch_accurate'), 'never with web research');

  const out = await def.run(holder, { id_batch: 41 });
  assert.equal(out.ditemukan, true);
  assert.deepEqual([out.id_batch, out.divisi, out.status, out.rute], [41, 'Sales', 'menunggu keputusan', '/data-accurate/41']);
  assert.equal(out.temuan.length, out.jumlah_temuan);
  const big = out.temuan.find((x) => x.kode === 'NILAI_BERUBAH_BESAR');
  assert.deepEqual(Object.keys(big).sort(), ['contoh_nomor', 'judul', 'jumlah', 'kode', 'mengapa_penting', 'tingkat']);
  assert.deepEqual(big.contoh_nomor, ['PO-1', 'SI-NAIK']);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /15000000|10000000\b(?!\D*atau lebih)/, 'no document value, even for a money holder: this is not a money tool');
  const keys = [];
  JSON.stringify(out, (k, v) => { if (k) keys.push(k); return v; });
  assert.deepEqual(keys.filter((k) => MONEY_KEY.test(k) || PERSONAL_KEY.test(k)), []);
  assert.match(out.catatan, /bukan keputusan/);

  // The starter is offered to those who decide, and answered by this tool.
  const entry = registry.TOOLS_BY_KEY.get('accurate-batches');
  const starter = 'Periksa batch Accurate yang menunggu keputusan saya: apa yang janggal?';
  const decider = supervisor(['accurate.batch.view', 'approval.decide']);
  assert.equal(registry.startersFor(entry, 'supervisor', decider)[0], starter);
  assert.equal(registry.startersFor(entry, 'head', decider)[0], starter);
  assert.ok(!registry.startersFor(entry, 'member', decider).includes(starter));
  assert.ok(!registry.startersFor(entry, 'supervisor', holder).includes(starter), 'only for someone who decides');
  assert.ok(!registry.startersFor(entry, 'supervisor', supervisor(['sales.order.view', 'approval.decide'])).includes(starter));
});

test('the tool without a batch number reviews the batches waiting for my decision (at most three)', async (t) => {
  mockBatch(t);
  const user = supervisor(['accurate.batch.view']);
  t.mock.method(batches, 'listBatches', async () => ({
    items: [1, 2, 3, 4, 5].map((id) => ({ id, departmentId: 5, departmentName: 'Sales', status: 'pending', approvalRequestId: id === 5 ? 500 : 100 + id })), total: 5,
  }));
  t.mock.method(batches, 'deciderIds', async (entityId, { approvalRequestId }) => (approvalRequestId === 500 ? [99] : [15]));
  const out = await tool('periksa_batch_accurate').run(user, {});
  assert.deepEqual([out.menunggu_keputusan_anda, out.diperiksa, out.batch.map((b) => b.id_batch)], [4, 3, [1, 2, 3]]);
  batches.deciderIds.mock.mockImplementation(async () => [99]);
  const none = await tool('periksa_batch_accurate').run(user, {});
  assert.deepEqual([none.menunggu_keputusan_anda, none.batch], [0, []]);
  assert.match(none.catatan, /Tidak ada batch/);
});

test('a scoped agent token: no session, private, bound to its one batch whatever the model asks', async (t) => {
  mockBatch(t);
  const user = supervisor(['accurate.batch.view']);
  const agent = await agentRun.prepareScoped({ user, toolNames: ['periksa_batch_accurate', 'omzet_sales', 'isi_form'], purpose: 'accurate_batch_review', subjectId: 41 });
  t.after(() => agent.cleanup());
  assert.deepEqual(agent.tools.map((x) => x.name), ['periksa_batch_accurate'], 'only the named tools the user holds; never a page tool');
  const claims = verifyAgentToken(agent.token);
  assert.deepEqual([claims.sub, claims.eid, claims.sid, claims.pur, claims.rid, claims.tools], [15, 7, null, 'accurate_batch_review', 41, ['periksa_batch_accurate']]);
  assert.equal(agent.clientTools, false);
  await assert.rejects(agentRun.prepareScoped({ user, toolNames: ['periksa_batch_accurate'], purpose: 'lain', subjectId: 1 }), (e) => e.code === 'AGENT_PURPOSE_UNKNOWN');
  await assert.rejects(agentRun.prepareScoped({ user: supervisor([]), toolNames: ['periksa_batch_accurate'], purpose: 'accurate_batch_review', subjectId: 41 }), (e) => e.status === 403);
});

test('the review code path holds no approve or reject call', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const files = ['services/accurateBatchReview.service.js', 'controllers/accurateReview.controller.js', 'routes/accurateReview.routes.js'];
  const DECIDES = /approvalEngine|approvalDecision|approvals\.controller|approvals\.routes|\/decide\b|engine\.(decide|approve|reject)|applyApprovalDecision|applyBatch|assertCanDecide|afterDecision|stageChanges|approval_steps|approval_requests|accurateSync|accurateClient|accurate\/accurate/;
  for (const file of files) {
    const code = read(file).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, DECIDES, `${file} must not reach the approval engine, the batch applier or Accurate`);
    assert.doesNotMatch(code, /(UPDATE|DELETE FROM|INSERT INTO)\s+(sales_accurate_batches|sales_accurate_batch_items|accurate_records)\b/, `${file} never writes the batch or the mirror`);
  }
  // Everything the service writes, by table.
  const service = read('services/accurateBatchReview.service.js');
  const written = [...service.matchAll(/(?:INSERT INTO|(?<!KEY )UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(written)].sort(), ['accurate_batch_reviews', 'ai_usage_events']);
  // The tool: the service's read only.
  const impl = String(tool('periksa_batch_accurate').impl);
  assert.doesNotMatch(impl, /batchReview\.(run|writeNote)|engine\.|\/decide|\bdecide\(|approve|reject/i);
  assert.match(impl, /batchReview\.findingsFor/);
  // The routes of the review: a GET and a POST on /batches/:id/review, nothing else.
  assert.deepEqual(router.stack.filter((l) => l.route).map((l) => [Object.keys(l.route.methods)[0], l.route.path]), [['get', '/batches/:id/review'], ['post', '/batches/:id/review']]);
});

// ---------------------------------------------------------------- real schema

test('real schema: a review reads the stored batch, writes its own row and audit, and leaves the batch pending', DB_TEST, async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const [[table]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'accurate_batch_reviews'");
    if (!Number(table.n)) return t.skip(SKIP);
    const sup = await makeUser(conn, { name: 'AI Review Sales Sup', division: 'sales', roles: ['sales.supervisor'] });
    const other = await makeUser(conn, { name: 'AI Review WH Sup', division: 'warehouse', roles: ['warehouse.supervisor'] });
    const sales = await departmentId(conn, 'sales');
    const [created] = await conn.query(
      "INSERT INTO sales_accurate_batches (entity_id, department_id, item_count, summary, requested_by, status) VALUES (1, ?, 3, '{}', ?, 'pending')", [sales, sup.id],
    );
    const batchId = created.insertId;
    const row = (type, action, key, before, after) => [batchId, type, action, String(key), after?.number || before?.number, null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null];
    await conn.query('INSERT INTO sales_accurate_batch_items (batch_id, record_type, action, external_key, label, amount, before_data, after_data) VALUES ?', [[
      row('sales_invoice', 'create', 990000001, null, { number: 'UJI-SI-BARU', trans_date: '2099-01-01', customer_no: 'UJI-TIDAK-ADA', channel: null, dpp_amount: 100000, data: { so_numbers: [], lines: [{ item_no: 'UJI-B', qty: 1 }] } }),
      row('sales_invoice', 'update', 990000002, { number: 'UJI-SI-UBAH', trans_date: '2026-01-05', channel: 'GT', dpp_amount: 1000000 }, { number: 'UJI-SI-UBAH', trans_date: '2026-01-05', customer_no: 'UJI-TIDAK-ADA', channel: 'GT', dpp_amount: 90000000, data: { so_numbers: ['UJI-SO'] } }),
      row('sales_invoice', 'missing', 990000003, { number: 'UJI-SI-HILANG', trans_date: '2026-01-06', channel: 'GT', dpp_amount: 5 }, null),
    ]]);
    const statements = [];
    const original = conn.query.bind(conn);
    conn.query = (...args) => { statements.push(String(typeof args[0] === 'string' ? args[0] : args[0]?.sql)); return original(...args); };
    let out;
    let stored;
    try {
      out = await review.run(sup.user, batchId);
      stored = await review.latest(sup.user, batchId);
      await assert.rejects(review.run(other.user, batchId), (e) => e.status === 404, 'another division');
      await assert.rejects(review.latest(other.user, batchId), (e) => e.status === 404);
    } finally { delete conn.query; }
    assert.deepEqual(out.contents, [{ type: 'sales_invoice', label: 'Faktur', create: 1, update: 1, missing: 1 }]);
    for (const code of ['NILAI_BERUBAH_BESAR', 'TIDAK_ADA_LAGI', 'PERIODE_LALU', 'UBAH_DOKUMEN_LAMA', 'TANGGAL_MASA_DEPAN', 'CUSTOMER_BELUM_DI_MASTER', 'CHANNEL_KOSONG', 'FAKTUR_TANPA_SO']) {
      assert.ok(codes(out).includes(code), code);
    }
    assert.equal(out.money, true, 'a Sales Supervisor holds sales.order.view');
    assert.deepEqual(byCode(out, 'NILAI_BERUBAH_BESAR').examples[0], { number: 'UJI-SI-UBAH', type: 'sales_invoice', percent: 8900, before: 1000000, after: 90000000 });
    assert.deepEqual(codes(stored), codes(out));
    assert.match(stored.requestedByName, /AI Review Sales Sup/);
    const writes = statements.filter((s) => !/^\s*(SELECT|\(SELECT|SHOW|WITH)\b/i.test(s)).map((s) => s.trim().split(/\s+/).slice(0, 3).join(' '));
    assert.deepEqual(writes, ['INSERT INTO accurate_batch_reviews', 'INSERT INTO activity_logs']);
    const [[batch]] = await conn.query('SELECT status, decided_by, applied_at, approval_request_id FROM sales_accurate_batches WHERE id = ?', [batchId]);
    assert.deepEqual([batch.status, batch.decided_by, batch.applied_at], ['pending', null, null], 'the batch is exactly as it was');
    const [[mirror]] = await conn.query('SELECT COUNT(*) AS n FROM accurate_records WHERE accurate_id IN (990000001, 990000002, 990000003)');
    assert.equal(Number(mirror.n), 0, 'nothing reached the mirror');
    const [[audit]] = await conn.query("SELECT metadata FROM activity_logs WHERE action = 'accurate.batch_review' AND subject_id = ? ORDER BY id DESC LIMIT 1", [batchId]);
    const meta = typeof audit.metadata === 'string' ? JSON.parse(audit.metadata) : audit.metadata;
    assert.deepEqual(Object.keys(meta).sort(), ['ai', 'codes']);

    // The agent's tool server, with a scoped token: the token's batch, whatever the model sends.
    const agent = await agentRun.prepareScoped({ user: sup.user, toolNames: ['periksa_batch_accurate'], purpose: 'accurate_batch_review', subjectId: batchId });
    try {
      const req = { headers: { authorization: `Bearer ${agent.token}` }, params: { name: 'periksa_batch_accurate' }, body: { input: { id_batch: 1 } } };
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await new Promise((resolve, reject) => { aiAgent.requireAgent(req, res, (e) => (e ? reject(e) : resolve())).then(() => { if (res.body) resolve(); }, reject); });
      assert.equal(res.body, undefined, 'the scoped token is accepted without a chat session');
      assert.equal(req.agentSession.visibility, 'private');
      await aiAgent.callTool(req, res, (e) => { throw e; });
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.id_batch, batchId);
      assert.doesNotMatch(JSON.stringify(res.body.data), /90000000/);
      const [[toolAudit]] = await conn.query("SELECT subject_type, subject_id FROM activity_logs WHERE action = 'ai_tool.call' AND user_id = ? ORDER BY id DESC LIMIT 1", [sup.id]);
      assert.deepEqual([toolAudit.subject_type, Number(toolAudit.subject_id)], ['sales_accurate_batch', batchId]);
      // The same token cannot call a tool it does not name.
      const res2 = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await aiAgent.callTool({ ...req, params: { name: 'batch_data_accurate' } }, res2, (e) => { throw e; });
      assert.equal(res2.statusCode, 403);
    } finally { await agent.cleanup(); }
  });
});
