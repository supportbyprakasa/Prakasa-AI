// The one definition of the Warehouse promise and the OTIF rules (program
// 3.4), shared by Jadwal kirim, Hari ini, the management provider and the
// view wh_so_fulfilment_accurate (migrations 099 and 103), and kept in step by
// a test.
//
// Decision (Head Supply Chain, 30 Sep 2026, delegated by the owner): an SO is
// promised on Accurate's "Tgl kirim" only when Sales set it AFTER the SO date.
// Accurate fills Tgl kirim with the document date by default (341 of 347 POs
// carry it; the open SOs too), so otherwise the standard applies: the SO date
// + SHIP_SLA_DAYS (2×24 jam). On time and in full = shipped 100% (last surat
// jalan, or the faktur when there is none) by the promise. Only SOs from
// OTIF_FROM count: the Accurate database was filled from 22 September 2026.
// While Sales transactions are recorded in the app (SALES_TRANSACTION_SOURCE
// = app), the Accurate SOs are not the source of truth: no OTIF, no alarm.
const SHIP_SLA_DAYS = 2;
// A target rate needs at least this many SOs due in the period.
const OTIF_MIN_SOS = 5;
// Episode id for a late SO: a new promise opens a new follow-up.
const SO_EPISODE_FACTOR = 100000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const otifFrom = () => (DATE_RE.test(process.env.WAREHOUSE_OTIF_FROM || '') ? process.env.WAREHOUSE_OTIF_FROM : '2026-09-22');
const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
// `a` has ship_date (Accurate's Tgl kirim, or NULL) and trans_date (the SO date).
// A standard promise that falls on a Sunday moves to Monday: no surat jalan is
// ever dated on a Sunday (Head Supply Chain). An explicit Tgl kirim stays.
const promisedSql = (a) => `IF(${a}.ship_date > ${a}.trans_date, ${a}.ship_date, ${a}.trans_date + INTERVAL (${SHIP_SLA_DAYS} + (DAYOFWEEK(${a}.trans_date + INTERVAL ${SHIP_SLA_DAYS} DAY) = 1)) DAY)`;
// 1 when that standard promise was moved from Sunday to Monday: no Tgl kirim of
// its own and promised more than SHIP_SLA_DAYS after the SO date (a Friday SO).
// `a` as above: the open SOs and wh_so_fulfilment_accurate both carry the columns.
const promiseShiftedSql = (a) => `(NOT COALESCE(${a}.ship_date > ${a}.trans_date, FALSE) AND DATEDIFF(${promisedSql(a)}, ${a}.trans_date) > ${SHIP_SLA_DAYS})`;
// Marketplace sales are booked in Accurate as one recap SO per platform per
// month (number series ECOM, e.g. SO.1/ECOM-PFN/IX/2026, customer "Ecommerce
// Shopee/Tokopedia"): a bookkeeping recap, not a delivery anyone waits for, so
// it is never a late shipment. Marketplace channel AND the ECOM series, so an
// individual marketplace SO in another series is still judged.
const MARKETPLACE_CHANNELS = Object.freeze(['Shopee', 'TokoPedia']);
const RECAP_SO_SERIES = '/ECOM-';
const marketplaceRecapSql = (a) => `(${a}.channel IN (${MARKETPLACE_CHANNELS.map((c) => `'${c}'`).join(', ')}) AND ${a}.number LIKE '%${RECAP_SO_SERIES}%')`;
// THE late-SO rule (Warehouse, Retail Commerce and Alur penjualan count the same
// SOs): open or part-shipped, past its promise while the mirror can judge it,
// dated from OTIF_FROM, and not a marketplace recap. `a` is a row of
// wh_so_fulfilment_accurate. otifFrom() is a validated YYYY-MM-DD, safe inline.
const lateSoSql = (a) => `(${a}.so_state IN ('open', 'partial') AND ${a}.judged AND ${a}.promised_date < ${TODAY}`
  + ` AND ${a}.trans_date >= '${otifFrom()}' AND NOT ${marketplaceRecapSql(a)})`;
// The standard promise in words (escalation context, Prakasa AI); the pages say the same.
const standardPromiseText = (shifted) => `standar ${SHIP_SLA_DAYS}×24 jam dari tanggal SO${Number(shifted) ? ', digeser ke Senin' : ''}`;

module.exports = {
  SHIP_SLA_DAYS, OTIF_MIN_SOS, SO_EPISODE_FACTOR, TODAY, otifFrom, promisedSql, promiseShiftedSql, standardPromiseText,
  MARKETPLACE_CHANNELS, RECAP_SO_SERIES, marketplaceRecapSql, lateSoSql,
};
