// Procurement record types in the Accurate mirror (docs/program-4-divisi.md 2.1,
// Procurement stage 1). Owned by the Procurement division: every batch of these
// is decided by the Procurement Head (stand-in: the Management Office Head, P3).
//
// Purchase prices ARE stored on the PO (P1: only the Procurement Head/Supervisor
// and the Management Office see them). Every person who can open a Procurement
// batch may see prices, and the app shows them through the price views only.
// Vendor personal data (NIK, NPWP, bank, contacts, address) is never read:
// vendor detail is closed at the read-only gate, and the `dataKeys` allowlist
// plus `personalScan` refuse anything else at staging.

const PROCUREMENT_RECORD_TYPES = Object.freeze({
  pc_vendor: {
    label: 'Pemasok',
    division: 'procurement',
    missing: 'flag',
    required: ['number', 'name'],
    fields: ['number', 'name', 'status', 'data'],
    dataKeys: { category: null },
    personalScan: ['name', 'data.category'],
    labelOf: (row) => `${row.name || '-'} (${row.number})`,
  },
  pc_po: {
    label: 'Purchase order',
    division: 'procurement',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'status', 'dpp_amount', 'total_amount', 'data'],
    dataKeys: {
      vendor_no: null, vendor_name: null, expected_date: null, percent_received: null, closed: null,
      payment_term: null, term_days: null, currency: null, tax_amount: null,
      lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'received_qty', 'remaining_qty', 'returned_qty', 'closed',
        'warehouse', 'pr_id', 'unit_price', 'disc_pct', 'line_total'],
      _rev: null,
    },
    // The PO value is shown to the deciders on the batch (all price-eligible).
    amount: 'dpp_amount',
    personalScan: ['data.vendor_name'],
    labelOf: (row) => `${row.number} · ${row.data?.vendor_name || '-'}`,
  },
});

const PROCUREMENT_TYPE_NAMES = Object.freeze(Object.keys(PROCUREMENT_RECORD_TYPES));

// Where prices live in a pc_po record; only price viewers ever get them.
const PRICE_KEYS = Object.freeze(['dpp_amount', 'total_amount', 'data.tax_amount', 'data.lines[].unit_price', 'data.lines[].disc_pct', 'data.lines[].line_total']);

// Personal data in free text: a phone number, an e-mail, or a long number (an
// ID, NPWP or bank account: 10+ digits, single separators allowed). One set of
// patterns: the collector removes exactly what the staging guard refuses, so a
// cleaned value can never block a pull.
const PERSONAL_PATTERNS = Object.freeze([
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /(\+?62|\(?0)[\s.\-()]*\d([\s.\-()]*\d){7,}/,
  /\d(?:[\s.\-/]?\d){9,}/,
]);
// The last-line guard at staging. Non-global regexes: .test() never depends on lastIndex.
const scanPersonal = (value) => value !== null && value !== undefined && PERSONAL_PATTERNS.some((re) => re.test(String(value)));
// The collector's cleaner: every match removed.
function stripPersonal(value) {
  let out = String(value);
  for (const re of PERSONAL_PATTERNS) out = out.replace(new RegExp(re.source, 'g'), ' ');
  return out;
}

module.exports = { PROCUREMENT_RECORD_TYPES, PROCUREMENT_TYPE_NAMES, PRICE_KEYS, PERSONAL_PATTERNS, scanPersonal, stripPersonal };
