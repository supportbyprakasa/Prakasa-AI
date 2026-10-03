const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const billing = require('../src/services/subscriptionBilling.service');

// Revision F25/F26 (3 Oct 2026): subscription invoices and payments are a
// register. A small in-memory ledger stands in for MySQL: statements on the
// transaction connection are buffered and only applied on COMMIT, so a failed
// step leaves nothing behind (like InnoDB).

function ledger({ invoices = [], payments = [], subscription = { id: 7, entity_id: 1, currency: 'IDR', department_id: null, product_name: 'Figma' }, failOn = null } = {}) {
  const state = { invoices: invoices.map((i) => ({ ...i })), payments: payments.map((p) => ({ ...p })), logs: [], documents: [] };
  const events = [];
  const read = (sql, args, view) => {
    if (/FROM software_subscriptions WHERE id = \? AND entity_id = \?/.test(sql) || /SELECT \* FROM software_subscriptions WHERE id = \? AND entity_id = \?/.test(sql)) {
      return [[Number(args[0]) === subscription.id && Number(args[1]) === subscription.entity_id ? subscription : undefined].filter(Boolean)];
    }
    if (/FROM subscription_payments WHERE subscription_id = \? AND request_key = \?/.test(sql)) {
      return [view.payments.filter((p) => p.subscription_id === Number(args[0]) && p.request_key === args[1]).map((p) => ({ id: p.id, invoiceId: p.invoice_id }))];
    }
    if (/FROM subscription_invoices WHERE id = \? AND subscription_id = \? FOR UPDATE/.test(sql)) {
      return [view.invoices.filter((i) => i.id === Number(args[0]) && i.subscription_id === Number(args[1]))];
    }
    if (/SUM\(amount\)/.test(sql)) {
      const paid = view.payments.filter((p) => p.invoice_id === Number(args[0]) && p.status === 'processed').reduce((n, p) => n + Number(p.amount), 0);
      return [[{ paid }]];
    }
    if (/FROM subscription_invoices WHERE subscription_id = \? AND invoice_number = \?/.test(sql)) {
      return [view.invoices.filter((i) => i.subscription_id === Number(args[0]) && i.invoice_number === args[1])];
    }
    if (/FROM subscription_invoices i\s+JOIN software_subscriptions s/.test(sql)) {
      return [view.invoices.filter((i) => i.id === Number(args[0]) && Number(args[1]) === subscription.entity_id).map((i) => ({ ...i, entity_id: subscription.entity_id, product_name: subscription.product_name }))];
    }
    return [[]];
  };
  const write = (sql, args, target) => {
    if (failOn && failOn.test(sql)) throw Object.assign(new Error('simulated failure'), { code: 'ER_SIMULATED' });
    if (/^\s*INSERT INTO subscription_payments/.test(sql)) {
      const [subscription_id, invoice_id, paid_at, amount, currency, , , , , request_key] = args;
      if (request_key && target.payments.some((p) => p.subscription_id === subscription_id && p.request_key === request_key)) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      }
      const id = 100 + target.payments.length + 1;
      target.payments.push({ id, subscription_id, invoice_id, paid_at, amount, currency, request_key, status: 'processed' });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (/^\s*UPDATE subscription_invoices SET status = 'paid'/.test(sql)) {
      const inv = target.invoices.find((i) => i.id === Number(args[0]));
      if (inv) inv.status = 'paid';
      return [{ affectedRows: inv ? 1 : 0 }];
    }
    if (/^\s*UPDATE subscription_invoices SET status = \?, verified_by/.test(sql)) {
      const inv = target.invoices.find((i) => i.id === Number(args[2]));
      if (inv) inv.status = args[0];
      return [{ affectedRows: inv ? 1 : 0 }];
    }
    if (/^\s*INSERT INTO subscription_invoices/.test(sql)) {
      const id = 50 + target.invoices.length + 1;
      target.invoices.push({ id, subscription_id: args[0], invoice_number: args[1], currency: args[4], total_amount: args[6], status: args[7], document_id: args[8] });
      return [{ insertId: id }];
    }
    if (/^\s*INSERT INTO documents/.test(sql)) { target.documents.push(args); return [{ insertId: 900 + target.documents.length }]; }
    if (/^\s*INSERT INTO activity_logs/.test(sql)) { target.logs.push(args); return [{ insertId: 1 }]; }
    return [{ affectedRows: 0 }];
  };
  const clone = () => ({ invoices: state.invoices.map((i) => ({ ...i })), payments: state.payments.map((p) => ({ ...p })), logs: [...state.logs], documents: [...state.documents] });
  const conn = () => {
    let tx = null;
    return {
      query: async (sql, args = []) => {
        const text = String(sql);
        events.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        if (/^\s*(INSERT|UPDATE)/.test(text)) return write(text, args, tx || state);
        return read(text, args, tx || state);
      },
      beginTransaction: async () => { tx = clone(); events.push('BEGIN'); },
      commit: async () => { Object.assign(state, tx); tx = null; events.push('COMMIT'); },
      rollback: async () => { tx = null; events.push('ROLLBACK'); },
      release: () => {},
    };
  };
  return { state, events, conn, poolQuery: async (sql, args = []) => read(String(sql), args, state) };
}

function useLedger(t, options) {
  const db = ledger(options);
  t.mock.method(pool, 'getConnection', async () => db.conn());
  t.mock.method(pool, 'query', db.poolQuery);
  return db;
}

const INVOICE = { id: 11, subscription_id: 7, invoice_number: 'INV-1', currency: 'IDR', total_amount: 1000, status: 'verified', document_id: 5 };
const pay = (body) => billing.recordPayment({ entityId: 1, subscriptionId: 7, actorId: 3, body, now: new Date('2026-10-03T03:00:00Z') });

test('F25: amount 0 or negative is refused before anything is written', async (t) => {
  const db = useLedger(t, { invoices: [INVOICE] });
  for (const amount of [0, -100, 'x', 10.123]) {
    await assert.rejects(pay({ invoiceId: 11, amount }), { code: 'VALIDATION_ERROR' }, String(amount));
  }
  assert.equal(db.state.payments.length, 0);
  assert.equal(db.state.invoices[0].status, 'verified');
});

test('F25 (partial supported): 100 leaves 900 outstanding and the invoice unpaid; 900 more makes it paid', async (t) => {
  const db = useLedger(t, { invoices: [INVOICE] });
  const first = await pay({ invoiceId: 11, amount: 100, requestKey: 'key-aaaa-0001' });
  assert.equal(first.paymentState, 'partial');
  assert.equal(first.outstandingAmount, 900);
  assert.equal(db.state.invoices[0].status, 'verified', 'not paid after a partial payment');
  const second = await pay({ invoiceId: 11, amount: 900, requestKey: 'key-aaaa-0002' });
  assert.equal(second.paymentState, 'paid');
  assert.equal(second.outstandingAmount, 0);
  assert.equal(db.state.invoices[0].status, 'paid');
  assert.equal(db.state.payments.length, 2);
  assert.equal(db.state.logs.length, 2, 'one audit row per payment, in the same transaction');
});

test('F25: 1000 at once pays the invoice; 1100 is refused as an overpayment', async (t) => {
  const db = useLedger(t, { invoices: [INVOICE] });
  await assert.rejects(pay({ invoiceId: 11, amount: 1100 }), (e) => e.code === 'OVERPAYMENT' && e.outstandingAmount === 1000);
  assert.equal(db.state.payments.length, 0);
  const full = await pay({ invoiceId: 11, amount: 1000 });
  assert.equal(full.paymentState, 'paid');
  assert.equal(db.state.invoices[0].status, 'paid');
});

test('F25: a paid or void invoice takes no payment, and a USD payment never pays an IDR invoice', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, status: 'paid' }, { ...INVOICE, id: 12, invoice_number: 'INV-2', status: 'void' }, { ...INVOICE, id: 13, invoice_number: 'INV-3' }] });
  await assert.rejects(pay({ invoiceId: 11, amount: 10 }), { code: 'INVOICE_NOT_PAYABLE' });
  await assert.rejects(pay({ invoiceId: 12, amount: 10 }), { code: 'INVOICE_NOT_PAYABLE' });
  await assert.rejects(pay({ invoiceId: 13, amount: 10, currency: 'USD' }), { code: 'CURRENCY_MISMATCH' });
  assert.equal(db.state.payments.length, 0);
});

test('F25: without a currency the payment takes the invoice currency — never a silent IDR default', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, currency: 'USD' }] });
  const out = await pay({ invoiceId: 11, amount: 1000 });
  assert.equal(out.currency, 'USD');
  assert.equal(db.state.payments[0].currency, 'USD');
  assert.equal(db.state.invoices[0].status, 'paid');
});

test('F25: an invoice of another subscription (or a missing id) is refused before the INSERT', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, subscription_id: 8 }] });
  await assert.rejects(pay({ invoiceId: 11, amount: 100 }), { code: 'INVOICE_NOT_FOUND' });
  await assert.rejects(pay({ invoiceId: 999, amount: 100 }), { code: 'INVOICE_NOT_FOUND' });
  assert.equal(db.state.payments.length, 0);
  assert.ok(!db.events.some((e) => e.startsWith('INSERT INTO subscription_payments')));
  // A subscription of another company is not found at all.
  await assert.rejects(billing.recordPayment({ entityId: 2, subscriptionId: 7, actorId: 3, body: { amount: 10 } }), { code: 'NOT_FOUND' });
});

test('F25: a retried request (same key) is recorded once; two real payments of the same amount are both kept', async (t) => {
  const db = useLedger(t, { invoices: [INVOICE] });
  const a = await pay({ invoiceId: 11, amount: 100, requestKey: 'retry-key-0001' });
  const again = await pay({ invoiceId: 11, amount: 100, requestKey: 'retry-key-0001' });
  assert.equal(again.duplicate, true);
  assert.equal(again.id, a.id);
  const other = await pay({ invoiceId: 11, amount: 100, requestKey: 'retry-key-0002' });
  assert.equal(other.duplicate, false);
  assert.equal(db.state.payments.length, 2, 'same amount, different requests: two payments');
  assert.equal(db.state.payments.reduce((n, p) => n + p.amount, 0), 200);
});

test('F25: a failing invoice update or audit rolls the payment back', async (t) => {
  for (const failOn of [/UPDATE subscription_invoices SET status = 'paid'/, /INSERT INTO activity_logs/]) {
    const db = useLedger(t, { invoices: [INVOICE], failOn });
    await assert.rejects(pay({ invoiceId: 11, amount: 1000 }), { code: 'ER_SIMULATED' });
    assert.equal(db.state.payments.length, 0, `no payment left after ${failOn}`);
    assert.equal(db.state.invoices[0].status, 'verified');
    assert.ok(db.events.includes('ROLLBACK'));
    pool.getConnection.mock.restore();
    pool.query.mock.restore();
  }
});

test('F25: a payment without an invoice is an unallocated register entry in an explicit currency', async (t) => {
  const db = useLedger(t, { invoices: [INVOICE] });
  const out = await pay({ amount: 250, currency: 'usd' });
  assert.equal(out.invoiceId, null);
  assert.equal(out.currency, 'USD');
  assert.equal(db.state.payments[0].invoice_id, null);
  assert.equal(db.state.invoices[0].status, 'verified', 'no invoice is paid by an unallocated payment');
  const metadata = JSON.parse(db.state.logs[0][5]);
  assert.equal(metadata.allocated, false);
  const defaulted = await pay({ amount: 10 });
  assert.equal(defaulted.currency, 'IDR', 'the subscription currency when none is given');
  await assert.rejects(pay({ amount: 10, currency: 'RUPIAH' }), { code: 'VALIDATION_ERROR' });
});

test('F25: a payment date in the future or not a date is refused', async (t) => {
  useLedger(t, { invoices: [INVOICE] });
  await assert.rejects(pay({ invoiceId: 11, amount: 10, paidAt: '2026-10-04' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(pay({ invoiceId: 11, amount: 10, paidAt: '2026-02-30' }), { code: 'VALIDATION_ERROR' });
  const ok = await pay({ invoiceId: 11, amount: 10, paidAt: '2026-10-03' });
  assert.equal(ok.paymentState, 'partial');
});

test('paymentState reads the ledger: unpaid, partial, paid, void', () => {
  assert.equal(billing.paymentState({ status: 'verified', total_amount: 1000 }, 0).paymentState, 'unpaid');
  assert.deepEqual(billing.paymentState({ status: 'verified', total_amount: 1000 }, 10000), { paidAmount: 100, outstandingAmount: 900, paymentState: 'partial' });
  assert.equal(billing.paymentState({ status: 'paid', total_amount: 1000 }, 100000).paymentState, 'paid');
  assert.equal(billing.paymentState({ status: 'void', total_amount: 1000 }, 0).paymentState, 'void');
});

// ------------------------------------------------------------------- F26

const fakeDrive = () => {
  const calls = { uploads: 0, deletes: [] };
  return {
    calls,
    uploadFile: async () => { calls.uploads += 1; return { id: `drive-${calls.uploads}`, webViewLink: 'https://drive.example/x' }; },
    deleteFile: async (id) => { calls.deletes.push(id); },
  };
};
const PDF = { originalname: 'inv.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };
const invoiceBody = { invoiceNumber: 'INV-9', invoiceDate: '2026-10-01', amount: 900, taxAmount: 100, totalAmount: 1000 };

test('F26: without a file the invoice is "pending_upload", never "uploaded"', async (t) => {
  const db = useLedger(t);
  const drive = fakeDrive();
  const out = await billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: invoiceBody, file: null, drive });
  assert.equal(out.status, 'pending_upload');
  assert.equal(out.documentId, null);
  assert.equal(db.state.invoices[0].status, 'pending_upload');
  assert.equal(drive.calls.uploads, 0);
});

test('F26: with a PDF the invoice is "uploaded" with its document; a non-PDF is refused', async (t) => {
  const db = useLedger(t);
  const drive = fakeDrive();
  const out = await billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: invoiceBody, file: PDF, drive });
  assert.equal(out.status, 'uploaded');
  assert.ok(out.documentId);
  assert.equal(db.state.invoices[0].document_id, out.documentId);
  await assert.rejects(billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: { ...invoiceBody, invoiceNumber: 'INV-10' }, file: { ...PDF, mimetype: 'image/png' }, drive }), { code: 'INVOICE_NOT_PDF' });
});

test('F26: subtotal + tax must equal the total; the currency defaults to the subscription', async (t) => {
  useLedger(t);
  const drive = fakeDrive();
  await assert.rejects(billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: { ...invoiceBody, totalAmount: 1200 }, file: null, drive }), { code: 'INVOICE_TOTAL_MISMATCH' });
  await assert.rejects(billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: { ...invoiceBody, invoiceDate: '2026-13-01' }, file: null, drive }), { code: 'VALIDATION_ERROR' });
  assert.equal(drive.calls.uploads, 0, 'nothing reaches Drive when the amounts are wrong');
});

test('F26: a duplicate number is refused before Drive; a DB failure after Drive removes the file', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, invoice_number: 'INV-9' }] });
  const drive = fakeDrive();
  await assert.rejects(billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: invoiceBody, file: PDF, drive }), { code: 'INVOICE_EXISTS' });
  assert.equal(drive.calls.uploads, 0);
  pool.getConnection.mock.restore();
  pool.query.mock.restore();

  const failing = useLedger(t, { failOn: /INSERT INTO subscription_invoices/ });
  await assert.rejects(billing.recordInvoice({ entityId: 1, subscriptionId: 7, actorId: 3, body: invoiceBody, file: PDF, drive }), { code: 'ER_SIMULATED' });
  assert.deepEqual(drive.calls.deletes, ['drive-1'], 'the uploaded file is removed again');
  assert.equal(failing.state.documents.length, 0, 'the document row rolled back');
  assert.equal(failing.state.invoices.length, 0);
  assert.equal(db.state.invoices.length, 1);
});

test('F26: verify only an uploaded invoice; void is refused once paid or with payments', () => {
  assert.equal(billing.verifyAllowed({ status: 'uploaded' }, 'verified', false), null);
  assert.match(billing.verifyAllowed({ status: 'pending_upload' }, 'verified', false), /Unggah PDF/);
  assert.ok(billing.verifyAllowed({ status: 'paid' }, 'verified', true));
  assert.ok(billing.verifyAllowed({ status: 'paid' }, 'void', true));
  assert.ok(billing.verifyAllowed({ status: 'verified' }, 'void', true), 'a recorded payment blocks void');
  assert.equal(billing.verifyAllowed({ status: 'verified' }, 'void', false), null);
});

test('F26: verifying a paid invoice changes nothing', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, status: 'paid' }], payments: [{ id: 1, invoice_id: 11, amount: 1000, status: 'processed', subscription_id: 7 }] });
  await assert.rejects(billing.verifyInvoice({ entityId: 1, invoiceId: 11, actorId: 3, status: 'void' }), { code: 'INVALID_TRANSITION' });
  await assert.rejects(billing.verifyInvoice({ entityId: 1, invoiceId: 11, actorId: 3, status: 'verified' }), { code: 'INVALID_TRANSITION' });
  assert.equal(db.state.invoices[0].status, 'paid');
});

test('F26: attaching the PDF later moves pending_upload to uploaded', async (t) => {
  const db = useLedger(t, { invoices: [{ ...INVOICE, status: 'pending_upload', document_id: null }] });
  const drive = fakeDrive();
  await assert.rejects(billing.attachInvoiceFile({ entityId: 1, invoiceId: 11, actorId: 3, file: null, drive }), { code: 'VALIDATION_ERROR' });
  t.mock.method(pool, 'getConnection', async () => {
    const c = db.conn();
    const query = c.query;
    c.query = async (sql, args) => (/UPDATE subscription_invoices\s+SET document_id/.test(String(sql)) ? [{ affectedRows: 1 }] : query(sql, args));
    return c;
  });
  const out = await billing.attachInvoiceFile({ entityId: 1, invoiceId: 11, actorId: 3, file: PDF, drive });
  assert.equal(out.id, 11);
  assert.equal(drive.calls.uploads, 1);
  await assert.rejects(billing.attachInvoiceFile({ entityId: 2, invoiceId: 11, actorId: 3, file: PDF, drive }), { code: 'NOT_FOUND' });
});
