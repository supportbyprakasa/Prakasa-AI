// Finance normalizers (pure): purchase invoices and purchase payments. Every
// row is built from named Accurate fields; an Accurate object is never spread,
// so nothing unlisted (vendor NPWP, bank accounts, notes, GL accounts) can slip
// through. Names are cleaned of personal data with the Procurement cleaner —
// the same patterns the staging guard refuses.
const { toDate, isFinal } = require('./warehouseCollector');
const { text, money, cleanText } = require('./procurementCollector');

const unique = (values) => [...new Set(values.filter(Boolean))];
const termDays = (term) => (term && term.netDays !== undefined && term.netDays !== null && Number.isFinite(Number(term.netDays))
  ? Number(term.netDays) : null);
// Value before PPN = total − PPN (the Sales rule), not Accurate's dppAmount (the e-Faktur base).
const netOfTax = (r) => (r.totalAmount === undefined || r.totalAmount === null ? null : money(Number(r.totalAmount) - Number(r.tax1Amount || 0)));

// What only the purchase invoice's detail holds: the linked PO numbers, the
// payment term and the currency. Kept with the mirror version and reused while
// the invoice's lastUpdate does not move.
function purchaseInvoiceExtra(detail = {}) {
  const lines = Array.isArray(detail?.detailItem) ? detail.detailItem : [];
  return {
    po_numbers: unique(lines.map((l) => text(l.purchaseOrder?.number))),
    term: cleanText(detail?.paymentTerm?.name),
    term_days: termDays(detail?.paymentTerm),
    currency: text(detail?.currency?.code) || 'IDR',
  };
}

// purchase-invoice list row (+ the detail extras). The outstanding amount is
// Accurate's primeOwing from the LIST, read on every pull: a payment changes it
// without always moving the invoice's lastUpdate.
function purchaseInvoiceRow(doc, extra = {}) {
  return {
    number: text(doc.number),
    trans_date: toDate(doc.transDate),
    due_date: toDate(doc.dueDate),
    customer_no: text(doc.vendor?.vendorNo),
    customer_name: cleanText(doc.vendor?.name) || text(doc.vendor?.vendorNo),
    status: text(doc.statusName),
    dpp_amount: netOfTax(doc),
    total_amount: money(doc.totalAmount),
    outstanding_amount: money(doc.primeOwing),
    data: {
      tax_amount: money(doc.tax1Amount),
      po_numbers: extra.po_numbers || [],
      term: extra.term ?? null,
      term_days: extra.term_days ?? null,
      currency: extra.currency || 'IDR',
      // A down-payment invoice (left out of aging, as in Sales). Stored only when true.
      ...(doc.invoiceDp === true ? { dp: true } : {}),
      _last_update: text(doc.lastUpdate),
    },
  };
}

// purchase-payment list row + detail: which invoices it paid, and how much each.
function purchasePaymentRow(doc, detail = {}) {
  const paid = Array.isArray(detail?.detailInvoice) ? detail.detailInvoice : [];
  return {
    number: text(doc.number ?? detail?.number),
    trans_date: toDate(doc.transDate ?? detail?.transDate),
    customer_no: text(doc.vendor?.vendorNo ?? detail?.vendor?.vendorNo),
    customer_name: cleanText(doc.vendor?.name ?? detail?.vendor?.name) || text(doc.vendor?.vendorNo ?? detail?.vendor?.vendorNo),
    total_amount: money(doc.totalPayment ?? detail?.totalPayment ?? doc.totalAmount ?? detail?.totalAmount),
    data: {
      bank: cleanText(doc.bank?.name ?? detail?.bank?.name),
      currency: text(detail?.currency?.code ?? doc.currency?.code) || 'IDR',
      invoices: paid.map((p) => ({ number: text(p.invoice?.number), amount: money(p.paymentAmount) })),
      _last_update: text(doc.lastUpdate),
    },
  };
}

module.exports = { purchaseInvoiceExtra, purchaseInvoiceRow, purchasePaymentRow, isFinal, netOfTax };
