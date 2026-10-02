// Finance record types in the Accurate mirror: purchase invoices (utang) and
// purchase payments only. Owned by the Finance division: every batch of these
// is decided by the Finance Supervisor or Head (approval matrix
// 'sales_accurate_sync:finance', migration 072).
//
// docs/deployment.md §10: the app never duplicates the books. No general
// ledger, journal, account balance, financial statement or tax record is ever
// mirrored — only these two document types, so Finance can follow what is owed
// to vendors and what was paid.
//
// The vendor sits in customer_no / customer_name (the mirror's "counterparty"
// columns). Vendor personal data (NPWP, NIK, bank account, contacts, address)
// is never read: the normalizers name every field they keep, and the
// `dataKeys` allowlist plus `personalScan` refuse anything else at staging.

const FINANCE_RECORD_TYPES = Object.freeze({
  fin_purchase_invoice: {
    label: 'Faktur pembelian',
    division: 'finance',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'due_date', 'customer_no', 'customer_name', 'status',
      'dpp_amount', 'total_amount', 'outstanding_amount', 'data'],
    dataKeys: {
      tax_amount: null, po_numbers: null, term: null, term_days: null, currency: null, dp: null, _last_update: null,
    },
    // The deciders (Finance Supervisor/Head) see the invoice value on the batch.
    amount: 'total_amount',
    personalScan: ['customer_name', 'data.term'],
    labelOf: (row) => `${row.number} · ${row.customer_name || '-'}`,
  },
  fin_purchase_payment: {
    label: 'Pembayaran pembelian',
    division: 'finance',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'total_amount', 'data'],
    dataKeys: { bank: null, currency: null, invoices: ['number', 'amount'], _last_update: null },
    amount: 'total_amount',
    // The paying account's NAME only (e.g. "Bank BCA"); an account number is cleaned out.
    personalScan: ['customer_name', 'data.bank'],
    labelOf: (row) => `${row.number} · ${row.customer_name || '-'}`,
  },
});

const FINANCE_TYPE_NAMES = Object.freeze(Object.keys(FINANCE_RECORD_TYPES));

module.exports = { FINANCE_RECORD_TYPES, FINANCE_TYPE_NAMES };
