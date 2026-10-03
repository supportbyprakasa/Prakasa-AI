// Accurate → Prakasa Workspace sync (Tahap A, docs/sales-module.md).
//
// Reads Accurate (read-only, through accurateReadOnly.js), keeps only FINAL
// documents (Draf / Diajukan / Ditolak are left out), compares them with the
// latest approved version in the Accurate mirror (accurate_records), and
// stages what differs as batches for the division's Supervisor or Head
// (salesAccurateBatches.service.js). Nothing is written until a batch is
// approved, and then only new version rows in the mirror — no change or
// removal of any data, in Accurate or in the app (owner, 2026-09-29, "TEGAS").
//
// This file is the runner: the scope registry (which pull reads what), one pull
// at a time (in process and across processes), the run log, and withdrawing a
// batch. The pulls themselves: salesPull.js, warehousePull.js (shared
// machinery in syncCore.js).

const pool = require('../../db/pool');
const logger = require('../../utils/logger');
const batches = require('../salesAccurateBatches.service');
const { log } = require('../activityLog.service');
const { DEFAULT_DIVISION, CUSTOMER_CATEGORY_DIVISION } = require('../salesStatus');
const core = require('./syncCore');
const salesPull = require('./salesPull');
const warehousePull = require('./warehousePull');
const procurementPull = require('./procurementPull');
const financePull = require('./financePull');

const { syncError, countChanges } = core;
const { collectChanges } = salesPull;
const { collectWarehouse } = warehousePull;
const running = new Map(); // entityId → scope of the pull in progress

// ------------------------------------------------------------------ running a pull

// What one pull reads. 'sales' is the default, so the Sales button and job
// behave exactly as before; 'warehouse' is the stock pull; 'procurement' the
// vendors and POs, once switched on (ACCURATE_PROCUREMENT=1) — until then only a
// dry run may read it.
const always = () => true;
const SCOPES = Object.freeze({
  sales: { types: batches.SALES_TYPE_NAMES, collect: collectChanges, enabled: always, label: 'Sales' },
  warehouse: { types: batches.WAREHOUSE_TYPE_NAMES, collect: collectWarehouse, enabled: always, label: 'Warehouse' },
  procurement: {
    types: batches.PROCUREMENT_TYPE_NAMES, collect: procurementPull.collectProcurement,
    enabled: () => process.env.ACCURATE_PROCUREMENT === '1', label: 'Procurement',
  },
  // Finance: purchase invoices and purchase payments only (never the ledger),
  // once switched on (ACCURATE_FINANCE=1) — until then only a dry run may read it.
  finance: {
    types: batches.FINANCE_TYPE_NAMES, collect: financePull.collectFinance,
    enabled: () => process.env.ACCURATE_FINANCE === '1', label: 'Finance',
  },
});

function scopeOf(scope) {
  if (!Object.hasOwn(SCOPES, scope)) throw syncError(`Jenis tarikan Accurate "${scope}" tidak dikenal.`, 'VALIDATION_ERROR', 400);
  return SCOPES[scope];
}

// The divisions a pull can stage for: a record type's own division (stock →
// Warehouse), else those the customer channel routes to (Sales, Retail Commerce).
function syncDivisions(scope = 'sales') {
  const out = new Set();
  for (const name of scopeOf(scope).types) {
    const type = batches.RECORD_TYPES[name];
    if (type.division) out.add(type.division);
    else [DEFAULT_DIVISION, ...Object.values(CUSTOMER_CATEGORY_DIVISION)].forEach((d) => out.add(d));
  }
  return [...out].sort();
}

// When every one of them still has a batch waiting, a pull could stage
// nothing: skip it without reading Accurate at all.
async function everyDivisionWaiting(entityId, scope = 'sales') {
  const codes = syncDivisions(scope);
  const [rows] = await pool.query(
    `SELECT DISTINCT d.code FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id
      WHERE b.entity_id = ? AND b.status = 'pending' AND d.code IN (?)`,
    [entityId, codes],
  );
  return rows.length >= codes.length;
}

// One pull at a time per company, across processes: the scheduled job and the
// "Tarik sekarang" button share a MySQL named lock.
const lockName = (entityId) => `prakasa_accurate_sync_${Number(entityId)}`;

async function withSyncLock(entityId, fn) {
  const conn = await pool.getConnection();
  try {
    const [[row]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [lockName(entityId)]);
    if (Number(row?.got) !== 1) throw syncError('Sinkron Accurate sedang berjalan.', 'SYNC_RUNNING');
    try {
      return await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName(entityId)]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

async function syncRunningElsewhere(entityId) {
  const [[row]] = await pool.query('SELECT IS_USED_LOCK(?) AS holder', [lockName(entityId)]);
  return row?.holder != null;
}

// Reads Accurate and stages batches. dryRun: read and compare only — nothing
// is written anywhere, not even the sync log.
async function runSync({ entityId, requestedBy, dryRun = false, scope = 'sales', fetchImpl = globalThis.fetch }) {
  const { collect, enabled, label } = scopeOf(scope);
  if (!dryRun && !enabled()) throw syncError(`Tarikan ${label} belum dinyalakan.`, 'SCOPE_OFF', 409);
  // One Accurate pull at a time per company, whatever its scope.
  if (running.has(entityId)) throw syncError('Sinkron Accurate sedang berjalan.', 'SYNC_RUNNING');
  running.set(entityId, scope);
  try {
    if (!dryRun && await everyDivisionWaiting(entityId, scope)) return { scope, skipped: 'ALL_PENDING', batches: [] };
    return await withSyncLock(entityId, () => pull({ entityId, requestedBy, dryRun, scope, collect, fetchImpl }));
  } finally {
    running.delete(entityId);
  }
}

async function pull({ entityId, requestedBy, dryRun, scope, collect, fetchImpl }) {
  let runId = null;
  try {
    if (!dryRun) {
      const [run] = await pool.query(
        "INSERT INTO sales_sync_runs (entity_id, source, status, triggered_by, stats) VALUES (?, 'accurate', 'running', ?, JSON_OBJECT('scope', ?))",
        [entityId, requestedBy, scope],
      );
      runId = run.insertId;
    }
    const { changes, stats, checks = {} } = await collect(entityId, { fetchImpl });
    const summary = { scope, ...stats, changes: countChanges(changes) };
    if (dryRun) return { dryRun: true, ...summary };

    const staged = changes.length
      ? await batches.stageChanges({ entityId, requestedBy, syncRunId: runId, changes, checks })
      : { batches: [], skipped: [] };
    const result = { ...summary, batches: staged.batches.map((b) => ({ id: b.id, departmentId: b.departmentId, items: b.itemCount })), skipped: staged.skipped };
    await pool.query(
      "UPDATE sales_sync_runs SET status = ?, stats = ?, finished_at = NOW() WHERE id = ?",
      [staged.skipped.length && !staged.batches.length ? 'skipped' : 'success', JSON.stringify(result), runId],
    );
    await log({
      entityId, userId: requestedBy, action: 'sales.accurate_sync', subjectType: 'sales_sync_run', subjectId: runId,
      metadata: { changes: result.changes, batches: result.batches, skipped: result.skipped.length },
    }).catch(() => {});
    return { runId, ...result };
  } catch (error) {
    if (runId) {
      await pool.query(
        "UPDATE sales_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?",
        [String(error.message).slice(0, 1000), runId],
      ).catch(() => {});
    }
    if (!error.status) logger.error({ err: error.message }, '[accurateSync] gagal');
    throw error;
  }
}

// The latest run of one scope (runs from before scopes existed are Sales runs).
async function latestRun(entityId, { scope = 'sales' } = {}) {
  const [[row]] = await pool.query(
    `SELECT r.id, r.status, r.stats, r.error_message AS errorMessage, r.started_at AS startedAt, r.finished_at AS finishedAt, u.name AS triggeredBy
       FROM sales_sync_runs r LEFT JOIN users u ON u.id = r.triggered_by
      WHERE r.entity_id = ? AND r.source = 'accurate'
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.stats, '$.scope')), 'sales') = ?
      ORDER BY r.id DESC LIMIT 1`,
    [entityId, scope],
  );
  if (!row) return null;
  const stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : row.stats;
  // Bookkeeping for the next pull, not for the page.
  if (stats && typeof stats === 'object') delete stats.seenMarkers;
  return {
    ...row,
    stats,
    // Any pull holds the one Accurate session, so the button waits either way.
    running: running.has(entityId) || await syncRunningElsewhere(entityId),
  };
}

// The submitter takes back a batch nobody has decided yet (e.g. a mapping
// mistake found before approval): its approval is cancelled and the batch is
// kept, marked "withdrawn" — nothing is deleted. The next pull can then stage again.
async function withdrawBatch({ batchId, userId, reason }) {
  const note = String(reason || '').trim().slice(0, 500);
  if (!note) throw syncError('Tulis alasan penarikan batch.', 'VALIDATION_ERROR', 400);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[batch]] = await db.query('SELECT * FROM sales_accurate_batches WHERE id = ? FOR UPDATE', [batchId]);
    if (!batch) throw syncError('Batch tidak ditemukan.', 'NOT_FOUND', 404);
    if (batch.status !== 'pending') throw syncError('Hanya batch yang belum diputuskan yang bisa ditarik.', 'CONFLICT', 409);
    await db.query(
      "UPDATE sales_accurate_batches SET status = 'withdrawn', decision_note = ?, decided_by = ?, decided_at = NOW() WHERE id = ?",
      [`Ditarik kembali: ${note}`, userId, batch.id],
    );
    if (batch.approval_request_id) {
      await db.query(
        "UPDATE approval_requests SET status = 'cancelled', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ? AND status = 'pending'",
        [userId, `Ditarik kembali oleh pengaju: ${note}`, batch.approval_request_id],
      );
      await db.query("UPDATE approval_steps SET status = 'skipped' WHERE approval_request_id = ? AND status = 'pending'", [batch.approval_request_id]);
    }
    await db.commit();
    await log({
      entityId: batch.entity_id, userId, action: 'sales.accurate_batch.withdrawn', subjectType: 'sales_accurate_batch',
      subjectId: batch.id, metadata: { reason: note },
    }).catch(() => {});
    return { id: batch.id, status: 'withdrawn' };
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

module.exports = {
  withdrawBatch,
  // Kept here too, so callers and tests keep one entry point.
  NOT_FINAL: core.NOT_FINAL, toDate: core.toDate, diff: core.diff,
  customerRow: salesPull.customerRow, orderRow: salesPull.orderRow, invoiceRow: salesPull.invoiceRow, invoiceExtra: salesPull.invoiceExtra,
  deliveryRow: salesPull.deliveryRow, receiptRow: salesPull.receiptRow, returnRow: salesPull.returnRow, itemRow: salesPull.itemRow,
  runSync, latestRun, collectChanges, collectWarehouse, syncDivisions, everyDivisionWaiting, SCOPES,
};
