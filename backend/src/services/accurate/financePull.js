// The Finance pull: purchase invoices (utang ke pemasok) and purchase payments,
// final documents only — nothing else. No general ledger, journal, balance,
// financial statement or tax data is read or mirrored (docs/deployment.md §10:
// the books stay in Accurate). Read-only through accurateReadOnly.js; what it
// finds is staged as a batch for the Finance Supervisor or Head, like every
// other division's pull. Switched on with ACCURATE_FINANCE=1.
//
// A document's detail (PO numbers and term of an invoice, the invoices a
// payment settled) is read only when the document is new or its lastUpdate
// moved; the amounts still owed come from the list on every pull. The loop is
// the Sales one (salesPull.js), kept separate on purpose. Normalizers:
// financeCollector.js.

const fc = require('./financeCollector');
const readOnly = require('./accurateReadOnly');
const { FINANCE_TYPE_NAMES } = require('./financeRecordTypes');
const { todayWib } = require('../../utils/wibTime');
const {
  delayMs, sleep, openSession, call, listAllChecked, latestMirror, pendingRows, lastSeenMarkers, sameContent,
  confirmMissing, seenKey, mirrorToRow, diff, assertNoSuspiciousDrop,
} = require('./syncCore');

const SCOPE = 'finance';
const INVOICE_FIELDS = 'id,number,transDate,dueDate,statusName,approvalStatus,totalAmount,tax1Amount,primeOwing,invoiceDp,vendor,lastUpdate';
const PAYMENT_FIELDS = 'id,number,transDate,statusName,approvalStatus,totalPayment,vendor,bank,lastUpdate';

// The mirror (or a waiting batch) as the detail it was built from.
const invoiceCache = (row) => ({
  po_numbers: row.data?.po_numbers || [], term: row.data?.term ?? null, term_days: row.data?.term_days ?? null, currency: row.data?.currency || 'IDR',
});
const paymentCache = (row) => ({
  detailInvoice: (row.data?.invoices || []).map((p) => ({ invoice: { number: p.number }, paymentAmount: p.amount })),
  currency: { code: row.data?.currency || 'IDR' },
  bank: { name: row.data?.bank ?? null },
});

async function collectFinance(entityId, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const session = await openSession(entityId, fetchImpl);
  const mirror = await latestMirror(entityId, FINANCE_TYPE_NAMES);
  const pending = await pendingRows(entityId, FINANCE_TYPE_NAMES);
  const seenBefore = await lastSeenMarkers(entityId, SCOPE);
  const seenNow = {};
  const unread = {};
  let detailCalls = 0;

  // One document type: list → (cached or fresh) detail → row.
  async function readDocuments(type, resource, fields, fromCache, build) {
    const listed = await listAllChecked(session, resource, fields);
    const finals = listed.rows.filter(fc.isFinal);
    const out = [];
    for (const doc of finals) {
      const key = `${type}:${doc.id}`;
      const latest = mirror.get(key);
      const waiting = pending.get(key);
      const known = latest && !latest.missing;
      const marker = doc.lastUpdate ? String(doc.lastUpdate) : null;
      if (known && marker && latest.data?._last_update === marker) { out.push({ id: doc.id, row: build(doc, fromCache(latest)) }); continue; }
      if (waiting && marker && waiting.data?._last_update === marker) { out.push({ id: doc.id, row: build(doc, fromCache(waiting)) }); continue; }
      if (known && marker && seenBefore[key] === seenKey(marker, latest.version)) {
        // Read before at this marker against this very version; nothing kept had changed.
        seenNow[key] = seenKey(marker, latest.version);
        out.push({ id: doc.id, row: build(doc, fromCache(latest)) });
        continue;
      }
      let body = null;
      try {
        body = await call(session, resource, 'detail', { id: doc.id });
      } catch (error) {
        if (error instanceof readOnly.AccurateWriteBlocked) throw error;
      }
      detailCalls += 1;
      if (!body?.d) {
        // One unreadable document never stops the pull: it stays as the mirror
        // has it (or waits, if new) and is read again next time.
        unread[type] = (unread[type] || 0) + 1;
        if (known) out.push({ id: doc.id, row: mirrorToRow(type, latest) });
        await sleep(delayMs());
        continue;
      }
      const row = build(doc, body.d);
      if (known && marker && sameContent(type, row, latest)) seenNow[key] = seenKey(marker, latest.version);
      out.push({ id: doc.id, row });
      await sleep(delayMs());
    }
    return { rows: out, read: finals.length, complete: listed.complete };
  }

  onProgress('fin_purchase_invoice');
  const invoices = await readDocuments('fin_purchase_invoice', 'purchase-invoice', INVOICE_FIELDS,
    invoiceCache, (doc, d) => fc.purchaseInvoiceRow(doc, d && Object.hasOwn(d, 'po_numbers') ? d : fc.purchaseInvoiceExtra(d)));

  onProgress('fin_purchase_payment');
  const payments = await readDocuments('fin_purchase_payment', 'purchase-payment', PAYMENT_FIELDS,
    paymentCache, (doc, d) => fc.purchasePaymentRow(doc, d));

  // What the approver reads with the batch: how much is owed, how much is late,
  // and what the totals leave out.
  const today = todayWib();
  const owed = { invoices: 0, outstanding_idr: 0, overdue: 0, non_idr: 0, down_payments: 0 };
  for (const { row } of invoices.rows) {
    if (!(Number(row.outstanding_amount) > 0)) continue;
    owed.invoices += 1;
    if (row.data?.dp) { owed.down_payments += 1; continue; }
    if (row.data?.currency && row.data.currency !== 'IDR') { owed.non_idr += 1; continue; }
    owed.outstanding_idr = Math.round((owed.outstanding_idr + Number(row.outstanding_amount)) * 100) / 100;
    if (row.due_date && row.due_date < today) owed.overdue += 1;
  }
  const checks = {
    complete: invoices.complete && payments.complete,
    purchase_invoices: invoices.read,
    purchase_payments: payments.read,
    owed,
    detail_calls: detailCalls,
    ...(Object.keys(unread).length ? { unread_documents: unread } : {}),
  };

  const found = [
    ...diff('fin_purchase_invoice', invoices.rows, mirror, { complete: invoices.complete }),
    ...diff('fin_purchase_payment', payments.rows, mirror, { complete: payments.complete }),
  ];
  // The drop guard judges the raw candidates, before any lookup can thin them out.
  assertNoSuspiciousDrop(found, mirror, FINANCE_TYPE_NAMES);
  const changes = await confirmMissing(session, found);
  return {
    changes,
    checks: { finance: checks },
    stats: {
      read: { fin_purchase_invoice: invoices.read, fin_purchase_payment: payments.read },
      detailCalls, seenMarkers: seenNow, checks,
    },
  };
}

module.exports = { collectFinance, SCOPE, INVOICE_FIELDS, PAYMENT_FIELDS };
