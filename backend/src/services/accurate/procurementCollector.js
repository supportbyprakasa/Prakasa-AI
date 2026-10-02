// Procurement normalizers (pure): every row is built from named Accurate fields;
// an Accurate object is never spread, so nothing unlisted can slip through
// (vendor/list returns lookupSubText even with explicit fields — never read).
const { toDate, round4, isFinal } = require('./warehouseCollector');
const { stripPersonal, scanPersonal } = require('./procurementRecordTypes');

const text = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const money = (v) => (v === undefined || v === null || v === '' ? null : Math.round(Number(v) * 100) / 100);

// A name keeps no phone number, e-mail or long ID/account number — the same
// patterns the staging guard refuses (procurementRecordTypes.PERSONAL_PATTERNS).
// Cleaned until nothing matches (closing a gap can join two fragments); if a
// value still matches, it is dropped — the guard can never refuse a cleaned value.
function cleanText(value) {
  let out = text(value);
  for (let i = 0; out !== null && i < 3 && scanPersonal(out); i += 1) {
    out = stripPersonal(out).replace(/\(\s*\)/g, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,;:·(-]+$/, '').trim() || null;
  }
  return out === null || scanPersonal(out) ? null : out;
}

// vendor/list — number, name, category and whether it is suspended; nothing else.
// A name that was nothing but personal data becomes its vendor number.
function vendorRow(v) {
  return {
    number: text(v.vendorNo),
    name: cleanText(v.name) || text(v.vendorNo),
    status: v.suspended ? 'Nonaktif' : 'Aktif',
    data: { category: cleanText(v.category?.name) },
  };
}

// A PO changes when its marker, status or receipt progress moves.
const poMarker = (doc) => `${doc.lastUpdate ?? '-'}|${doc.statusName ?? '-'}|${doc.percentShipped ?? '-'}`;

// received/remaining/returned are Accurate's shipQuantity, remainingQuantity and
// returnQuantity, in BASE units (qty is in the line's unit); the views convert
// (migration 088).
function poLine(l) {
  return {
    item_no: text(l.item?.no),
    item_name: cleanText(l.item?.name ?? l.detailName),
    qty: round4(l.quantity),
    unit: text(l.itemUnit?.name),
    unit_ratio: l.unitRatio === undefined || l.unitRatio === null ? null : round4(l.unitRatio),
    received_qty: round4(l.shipQuantity),
    remaining_qty: l.remainingQuantity === undefined || l.remainingQuantity === null ? null : round4(l.remainingQuantity),
    returned_qty: round4(l.returnQuantity),
    closed: Boolean(l.closed),
    warehouse: text(l.warehouse?.name ?? l.defaultWarehouseReceiveItem?.name),
    pr_id: Number(l.purchaseRequisitionId) > 0 ? Number(l.purchaseRequisitionId) : null,
    unit_price: money(l.unitPrice),
    disc_pct: l.itemDiscPercent === undefined || l.itemDiscPercent === null || l.itemDiscPercent === '' ? null : round4(l.itemDiscPercent),
    line_total: money(l.totalPrice),
  };
}

// purchase-order list row + detail. Value before PPN = total − PPN (the Sales
// rule), not Accurate's dppAmount (the e-Faktur base).
function poRow(doc, detail = {}) {
  const total = Number(detail.totalAmount ?? 0);
  const tax = Number(detail.tax1Amount ?? 0);
  const lines = Array.isArray(detail.detailItem) ? detail.detailItem : [];
  return {
    number: text(doc.number ?? detail.number),
    trans_date: toDate(doc.transDate ?? detail.transDate),
    status: text(doc.statusName ?? detail.statusName),
    dpp_amount: money(total - tax),
    total_amount: money(total),
    data: {
      vendor_no: text(detail.vendor?.vendorNo ?? doc.vendor?.vendorNo),
      vendor_name: cleanText(detail.vendor?.name ?? doc.vendor?.name),
      expected_date: toDate(detail.shipDate ?? doc.shipDate),
      percent_received: money(detail.percentShipped ?? doc.percentShipped),
      closed: Boolean(detail.manualClosed),
      payment_term: text(detail.paymentTerm?.name),
      term_days: Number.isFinite(Number(detail.paymentTerm?.netDays)) && detail.paymentTerm?.netDays !== null ? Number(detail.paymentTerm.netDays) : null,
      currency: text(detail.currency?.code) || 'IDR',
      tax_amount: money(tax),
      lines: lines.map(poLine),
      _rev: poMarker(doc),
    },
  };
}

// Approver checks: lines add up to the subtotal; lines without a unit ratio.
function linesMatchSubtotal(detail) {
  const lines = Array.isArray(detail?.detailItem) ? detail.detailItem : [];
  const sum = lines.reduce((n, l) => n + Number(l.totalPrice || 0), 0);
  return Math.abs(sum - Number(detail?.subTotal || 0)) < 1;
}
const unitsUncertain = (row) => (row?.data?.lines || []).filter((l) => !(Number(l.unit_ratio) > 0)).length;

module.exports = { text, money, cleanText, vendorRow, poRow, poLine, poMarker, linesMatchSubtotal, unitsUncertain, isFinal };
