// The one definition of Procurement's PO rules (docs/program-4-divisi.md 2.1),
// shared by the services, the management provider and their tests.
//
// Owner decision 1 (recommended default, 29 Sep 2026): a PO is late when it is
// not closed and not fully received, more than PO_LATE_GRACE_DAYS past Accurate's
// "Tgl kirim"; without one it is due DEFAULT_LEAD_DAYS after the PO date,
// labelled "(perkiraan)". A Tgl kirim on or before the PO date is Accurate's
// default (341 of 347 POs), not a promise, so it counts as "not set" (Head
// Supply Chain, 30 Sep 2026; migration 098 and promisedExpected()).
// Only POs dated on or after LATE_FROM can escalate —
// older open POs are "PO lama belum ditutup" (listed, no alarm), because the
// Accurate database was filled on 22 September 2026.
const DEFAULT_LEAD_DAYS = 14;
const PO_LATE_GRACE_DAYS = 1;
const DUE_SOON_DAYS = 7;
const ACTIVE_VENDOR_DAYS = 90;
const DATA_STALE_HOURS = 48;
// Episode id for a late PO: a new promised date opens a new follow-up.
const EPISODE_FACTOR = 100000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const lateFrom = () => (DATE_RE.test(process.env.PROCUREMENT_LATE_FROM || '') ? process.env.PROCUREMENT_LATE_FROM : '2026-09-22');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
// The promised date of a mirrored PO row, or null: the same rule as the
// pc_po_accurate view (migration 098). Dates are ISO 'YYYY-MM-DD' strings.
const promisedExpected = (row) => {
  const d = row?.data?.expected_date || null;
  return d && row.trans_date && d > row.trans_date ? d : null;
};
// When the PO is due: Accurate's Tgl kirim, else the PO date + DEFAULT_LEAD_DAYS.
const dueSql = (a) => `COALESCE(${a}.expected_date, ${a}.trans_date + INTERVAL ${DEFAULT_LEAD_DAYS} DAY)`;
// What the page and the provider call a PO. LATE_FROM is bound (one `?`).
const displayStateSql = (a) => `CASE
    WHEN ${a}.po_state IN ('closed', 'received') THEN ${a}.po_state
    WHEN ${a}.trans_date < ? THEN 'legacy'
    WHEN ${dueSql(a)} < ${TODAY} - INTERVAL ${PO_LATE_GRACE_DAYS} DAY THEN 'late'
    ELSE ${a}.po_state END`;

module.exports = {
  DEFAULT_LEAD_DAYS, PO_LATE_GRACE_DAYS, DUE_SOON_DAYS, ACTIVE_VENDOR_DAYS, DATA_STALE_HOURS, EPISODE_FACTOR,
  TODAY, lateFrom, promisedExpected, dueSql, displayStateSql,
};
