const pool = require('../db/pool');
const { fail } = require('../utils/response');
const { memo } = require('../utils/memo');

// Where Sales transactions (sales order, surat jalan, invoice, payments — and
// the product master they use) are recorded.
//
//   'accurate' — the team records them in Accurate (their accounting system).
//                This app mirrors that data read-only: its own transaction
//                forms are hidden by the frontend and refused here, so the
//                books never fork into two versions.
//   'app'      — transactions are entered in this app (the pre-Accurate
//                behaviour). The forms, printing and numbering all come back.
//
// One env switch, because the owner may bring input back in-app later; the
// code for both modes is kept.
function transactionSource() {
  return process.env.SALES_TRANSACTION_SOURCE === 'app' ? 'app' : 'accurate';
}

// Route guard for transaction writes.
function guardTransactions(req, res, next) {
  if (transactionSource() === 'app') return next();
  return fail(res, 'SOURCE_ACCURATE',
    'Transaksi Sales dicatat di Accurate. Data di aplikasi ini mengikuti Accurate, jadi tidak bisa diubah di sini.', 409);
}

// Whether transaction data can be trusted yet. In app mode the app IS the
// source. In Accurate mode the numbers are only right once Accurate data has
// arrived — and Accurate data only arrives through a batch the division
// approved (salesAccurateBatches.service.js). Until the first batch is
// applied, transactions are the old, incomplete sheet recap. Owner's decision
// (2026-09-29): until then, mark the figures and hold every alarm built on
// them — reminders, the menu badge and Sales escalations to management.
// Only a Sales or Retail Commerce batch counts: an approved Warehouse or
// Finance batch fills other parts of the mirror, not the Sales documents.
const SALES_DIVISIONS = Object.freeze(['sales', 'retail_commerce']);

// Asked by nearly every Sales and management figure (17–89 times per request
// in the load test), so the answer is kept: "connected" for 5 minutes — it
// only ever turns false again if every applied batch were removed — and "not
// yet" for 30 seconds. Applying a batch drops it at once (utils/memo.js,
// invalidateFigures from salesAccurateBatches.applyBatch).
const CONNECTED_TTL_MS = 5 * 60 * 1000;
const NOT_CONNECTED_TTL_MS = 30 * 1000;

async function loadAccurateConnected(entityId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id
      WHERE b.entity_id = ? AND b.status = 'applied' AND d.code IN (?)`,
    [entityId, SALES_DIVISIONS],
  );
  return Number(row?.n || 0) > 0;
}

function accurateConnected(entityId) {
  return memo.get(`salesSrc:${Number(entityId) || 0}`,
    (connected) => (connected ? CONNECTED_TTL_MS : NOT_CONNECTED_TTL_MS),
    () => loadAccurateConnected(entityId));
}

// Tahap B switch (docs/sales-module.md): the Sales numbers read Accurate's
// approved mirror only once this is on. Until then an approved batch fills the
// mirror but must not release the hold — the pages would still show the old recap.
const NUMBERS_FROM_ACCURATE = true;

async function transactionsReliable(entityId) {
  if (transactionSource() === 'app') return true;
  if (!NUMBERS_FROM_ACCURATE) return false;
  return accurateConnected(entityId);
}

// Tahap B: the Sales numbers come from approved Accurate data when
// transactions are recorded in Accurate, Tahap B is on, and at least one batch
// has been approved. Before that, the screens keep showing the old recap
// (marked "belum tersambung").
async function numbersFromAccurate(entityId) {
  if (transactionSource() !== 'accurate' || !NUMBERS_FROM_ACCURATE) return false;
  return accurateConnected(entityId);
}

module.exports = {
  SALES_DIVISIONS,
  transactionSource, guardTransactions, accurateConnected, transactionsReliable, numbersFromAccurate, NUMBERS_FROM_ACCURATE,
};
