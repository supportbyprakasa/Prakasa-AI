// Shared machinery of every Accurate pull (Sales, Warehouse, …): the read-only
// session, paged reads with a completeness check, the mirror and pending
// batches, the comparison (diff) and the guards against suspicious drops.
// Division pulls (salesPull.js, warehousePull.js) build on it; the runner and
// the scope registry live in accurateSync.service.js.

const pool = require('../../db/pool');
const connection = require('./accurateConnection.service');
const readOnly = require('./accurateReadOnly');
const batches = require('../salesAccurateBatches.service');

const NOT_FINAL = new Set(['Draf', 'Diajukan', 'Ditolak']);
const PAGE_SIZE = 100;

const delayMs = () => Number(process.env.ACCURATE_SYNC_DELAY_MS ?? 250);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function syncError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

// "24/06/2026" → "2026-06-24"; anything else → null.
function toDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(value || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const money = (value) => (value === null || value === undefined || value === '' ? null : Math.round(Number(value) * 100) / 100);

// Revenue before PPN = total − PPN. Verified 29 Sep 2026 against Accurate's
// "Penjualan per Pelanggan" (September: Rp 534,5 jt). Accurate's own `dppAmount`
// is the tax base of the e-Faktur and is empty for most invoices (e.g.
// "Digunggung"), so it is kept only as a note (data.tax_dpp).
const netOfTax = (r) => (r.totalAmount === undefined || r.totalAmount === null ? null : money(Number(r.totalAmount) - Number(r.tax1Amount || 0)));


// ------------------------------------------------------------------ reading Accurate

async function openSession(entityId, fetchImpl) {
  const { accessToken, dbId } = await connection.getAccessToken(entityId, { fetchImpl });
  const auth = { Authorization: `Bearer ${accessToken}` };
  const res = await readOnly.accurateGet(readOnly.OPEN_DB_URL, { headers: auth, params: { id: dbId }, fetchImpl });
  const body = await res.json();
  if (!body?.host || !body?.session) throw syncError('Gagal membuka sesi database Accurate.', 'ACCURATE_OPEN_DB_FAILED', 502);
  return { base: String(body.host).replace(/\/+$/, ''), headers: { ...auth, 'X-Session-ID': body.session }, fetchImpl };
}

// A long pull (hundreds of reads) must survive a brief network drop or a
// busy moment on Accurate's side: retry with growing pauses, then give up.
const MAX_ATTEMPTS = 4;
const retryPauseMs = (attempt) => Number(process.env.ACCURATE_SYNC_RETRY_MS ?? 2000) * attempt;

async function call(session, resource, kind, params) {
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await readOnly.accurateGet(`${session.base}/accurate/api/${resource}/${kind}.do`, {
        headers: session.headers, params, fetchImpl: session.fetchImpl,
      });
    } catch (error) {
      if (error instanceof readOnly.AccurateWriteBlocked || attempt >= MAX_ATTEMPTS) throw error;
      await sleep(retryPauseMs(attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) { await sleep(retryPauseMs(attempt)); continue; }
    const body = await res.json();
    // httpStatus 200 = Accurate answered and refused (e.g. the record is gone);
    // anything else is a transport or authorisation failure, not an answer.
    if (!body?.s) throw Object.assign(syncError(`Accurate menolak pembacaan ${resource}.`, 'ACCURATE_READ_FAILED', 502), { httpStatus: res.status });
    return body;
  }
}

async function listAll(session, resource, fields, { action = 'list', params = {} } = {}) {
  return (await listAllChecked(session, resource, fields, { action, params })).rows;
}

// Every page of a list, and whether the read is COMPLETE: the row count did not
// move between the first and last page, every row arrived, and no id came
// twice. Only a complete read may turn "absent" into a change.
async function listAllChecked(session, resource, fields, { action = 'list', params = {} } = {}) {
  const rows = [];
  let firstCount = null;
  let lastCount = null;
  for (let page = 1; ; page += 1) {
    const body = await call(session, resource, action, {
      ...(fields ? { fields } : {}), ...params, 'sp.page': page, 'sp.pageSize': PAGE_SIZE, 'sp.sort': 'id|asc',
    });
    rows.push(...(body.d || []));
    const count = Number(body.sp?.rowCount);
    if (firstCount === null) firstCount = count;
    lastCount = count;
    if (page >= Number(body.sp?.pageCount || 1)) break;
    await sleep(delayMs());
  }
  const ids = new Set(rows.map((r) => String(r.id)));
  const complete = Number.isFinite(firstCount) && firstCount === lastCount && rows.length === firstCount && ids.size === rows.length;
  return { rows, complete };
}


// ------------------------------------------------------------------ comparing with the mirror

// The latest version of each record of the given types (one scope's types only,
// so a Warehouse pull never sees — let alone marks missing — Sales records).
async function latestMirror(entityId, types) {
  const [rows] = await pool.query(
    `SELECT r.* FROM accurate_records r
       JOIN (SELECT record_type, accurate_id, MAX(version) AS v FROM accurate_records
              WHERE entity_id = ? AND record_type IN (?) GROUP BY record_type, accurate_id) m
         ON m.record_type = r.record_type AND m.accurate_id = r.accurate_id AND m.v = r.version
      WHERE r.entity_id = ? AND r.record_type IN (?)`,
    [entityId, [...types], entityId, [...types]],
  );
  const map = new Map();
  for (const row of rows) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    map.set(`${row.record_type}:${row.accurate_id}`, { ...row, data });
  }
  return map;
}

// What batches still waiting for a decision already hold, per record. While
// nobody has decided, the next pulls reuse a pending document's detail (same
// change marker) instead of reading it from Accurate again every few minutes.
async function pendingRows(entityId, types) {
  const [rows] = await pool.query(
    `SELECT i.record_type, i.external_key, i.after_data
       FROM sales_accurate_batch_items i
       JOIN sales_accurate_batches b ON b.id = i.batch_id
      WHERE b.entity_id = ? AND b.status = 'pending' AND i.record_type IN (?) AND i.action <> 'missing'`,
    [entityId, [...types]],
  );
  const map = new Map();
  for (const row of rows) {
    const after = typeof row.after_data === 'string' ? JSON.parse(row.after_data) : row.after_data;
    if (after) map.set(`${row.record_type}:${row.external_key}`, after);
  }
  return map;
}

// Change markers (lastUpdate) already read in full and found to change nothing
// that is kept (e.g. a document was only printed). Remembered in the run log so
// the next pulls do not read that document again every few minutes.
async function lastSeenMarkers(entityId, scope) {
  const [[row]] = await pool.query(
    `SELECT JSON_EXTRACT(stats, '$.seenMarkers') AS seen FROM sales_sync_runs
      WHERE entity_id = ? AND source = 'accurate' AND status IN ('success', 'skipped')
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(stats, '$.scope')), 'sales') = ?
      ORDER BY id DESC LIMIT 1`,
    [entityId, scope],
  );
  if (!row?.seen) return {};
  const seen = typeof row.seen === 'string' ? JSON.parse(row.seen) : row.seen;
  return seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {};
}

const sameContent = (type, row, latest) => batches.contentHash(type, { ...pick(type, row), missing: false })
  === batches.contentHash(type, { ...mirrorToRow(type, latest), missing: false });

// "Tidak ada lagi" only for what is really gone: a list that shifted while it
// was paged (one document deleted, another created) can hide a live document,
// so each candidate is looked up once more. Still there and final → no change.
const RESOURCE_OF = Object.freeze({
  customer: 'customer', item: 'item', sales_order: 'sales-order', sales_invoice: 'sales-invoice',
  delivery_order: 'delivery-order', sales_receipt: 'sales-receipt', sales_return: 'sales-return',
  wh_warehouse: 'warehouse', wh_transfer: 'item-transfer', wh_adjustment: 'item-adjustment',
  wh_receipt: 'receive-item', wh_delivery: 'delivery-order',
  // pc_vendor is left out on purpose: confirming would open vendor detail (closed).
  pc_po: 'purchase-order',
  fin_purchase_invoice: 'purchase-invoice', fin_purchase_payment: 'purchase-payment',
  wh_item_unit: 'item',
  wh_so_open: 'sales-order',
});
// Still there for this record type? Documents: final in Accurate. Units: the
// item is still an inventory item (an item turned service loses its units).
const ALIVE_OF = Object.freeze({
  wh_item_unit: (d) => d?.itemTypeName === 'Persediaan',
  // An open SO leaves the shipping list once fully shipped or closed.
  wh_so_open: (d) => stillFinal(d) && Number(d?.percentShipped) < 100 && !d?.manualClosed && d?.statusName !== 'Ditutup',
});
const MAX_CONFIRMATIONS = 60;
const stillFinal = (d) => !NOT_FINAL.has(d?.statusName) && (!d?.approvalStatus || d.approvalStatus === 'APPROVED');

// Only CONFIRMED candidates are staged: beyond the lookup budget they wait for
// the next pull (never staged unconfirmed). `skip(change)`: candidates whose
// division still has a batch waiting — not staged now anyway, so not looked up.
// The lookups start at a point that moves every pull, so candidates that keep
// confirming alive cannot hold the budget and starve the ones behind them.
async function confirmMissing(session, changes, { skip = () => false, now = Date.now() } = {}) {
  const out = [];
  const candidates = [];
  for (const change of changes) {
    const resource = RESOURCE_OF[change.recordType];
    if (change.action !== 'missing' || !resource) out.push(change);
    else if (!skip(change)) candidates.push({ change, resource });
  }
  const start = candidates.length ? Math.floor(now / 60000) % candidates.length : 0;
  const turn = [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, MAX_CONFIRMATIONS);
  for (const { change, resource } of turn) {
    let gone;
    try {
      const body = await call(session, resource, 'detail', { id: change.externalKey });
      gone = !(body?.d && (ALIVE_OF[change.recordType] || stillFinal)(body.d));
    } catch (error) {
      if (error instanceof readOnly.AccurateWriteBlocked) throw error;
      // Only Accurate's own refusal means gone; an outage or a rejected token is
      // no answer, so the candidate waits for the next pull.
      gone = error.code === 'ACCURATE_READ_FAILED' && error.httpStatus === 200 ? true : null;
    }
    if (gone === true) out.push(change);
    await sleep(delayMs());
  }
  return out;
}

// Division codes that already have a batch waiting for a decision: their
// changes cannot be staged now, so a pull spends no Accurate reads on them.
async function waitingDivisions(entityId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT d.code FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id
      WHERE b.entity_id = ? AND b.status = 'pending'`,
    [entityId],
  );
  return new Set(rows.map((r) => r.code));
}

// A remembered marker holds for one mirror version only: once a batch moves the
// mirror on, the document is compared again.
const seenKey = (marker, version) => `${marker}@${version}`;

const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

function mirrorToRow(recordType, m) {
  const allowed = batches.RECORD_TYPES[recordType].fields;
  const row = {};
  for (const f of allowed) {
    if (f === 'data') row.data = m.data || null;
    else if (f === 'trans_date' || f === 'due_date') row[f] = dateOnly(m[f]);
    else if (['dpp_amount', 'total_amount', 'outstanding_amount'].includes(f)) row[f] = m[f] === null ? null : money(m[f]);
    else row[f] = m[f] ?? null;
  }
  return row;
}

function pick(recordType, row) {
  return Object.fromEntries(batches.RECORD_TYPES[recordType].fields.map((f) => [f, row[f] ?? null]));
}

const labelOf = (recordType, row) => {
  const type = batches.RECORD_TYPES[recordType];
  if (type.labelOf) return type.labelOf(row);
  return batches.MASTER_TYPES.has(recordType) ? `${row.name} (${row.number})` : `${row.number} · ${row.customer_name || '-'}`;
};
// Money on Sales documents, and on a type that names its amount (a PO's value,
// for its price-eligible deciders); Warehouse records carry quantities only.
const amountOf = (recordType, row) => {
  const type = batches.RECORD_TYPES[recordType];
  if (type.amount) return row[type.amount] ?? null;
  if (type.division || batches.MASTER_TYPES.has(recordType)) return null;
  return row.dpp_amount ?? row.total_amount ?? null;
};

// What changed between Accurate and the mirror for one record type.
//   missing 'flag' (documents, masters): absent from Accurate → "tidak ada lagi".
//   missing 'snapshot' (stock): never "missing" — absent from a COMPLETE read →
//     a version with quantity 0; rows that are zero and were never stored stay out.
function diff(recordType, fetched, mirror, { complete = true } = {}) {
  const type = batches.RECORD_TYPES[recordType];
  const snapshot = type.missing === 'snapshot';
  const changes = [];
  const seen = new Set();
  for (const { id, row } of fetched) {
    seen.add(String(id));
    const after = pick(recordType, row);
    const latest = mirror.get(`${recordType}:${id}`);
    const label = labelOf(recordType, after);
    const amount = amountOf(recordType, after);
    if (!latest) {
      if (snapshot && !Number(after.data?.qty)) continue;
      changes.push({ recordType, action: 'create', externalKey: String(id), label, amount, after });
      continue;
    }
    // Both sides hashed the same way now, from the mirror row itself — not from
    // the stored content_hash, which older versions computed less strictly.
    const unchanged = !latest.missing
      && batches.contentHash(recordType, { ...mirrorToRow(recordType, latest), missing: false })
        === batches.contentHash(recordType, { ...after, missing: false });
    if (!unchanged) {
      const before = mirrorToRow(recordType, latest);
      // Stock that was there and now reads 0 counts towards the zeroing guard.
      const zeroed = snapshot && Number(before.data?.qty) !== 0 && Number(after.data?.qty) === 0;
      changes.push({ recordType, action: 'update', externalKey: String(id), label, amount, before, after, ...(zeroed ? { zeroed: true } : {}) });
    }
  }
  if (!complete) return changes;
  for (const [key, latest] of mirror) {
    const [kind, id] = key.split(':');
    if (kind !== recordType || latest.missing || seen.has(id)) continue;
    const before = mirrorToRow(recordType, latest);
    if (snapshot) {
      if (!Number(before.data?.qty)) continue;
      const after = type.zeroRow(before);
      changes.push({ recordType, action: 'update', externalKey: id, label: labelOf(recordType, before), amount: null, before, after, zeroed: true });
      continue;
    }
    changes.push({ recordType, action: 'missing', externalKey: id, label: labelOf(recordType, before), amount: amountOf(recordType, before), before });
  }
  return changes;
}

// A pull where much of what was there is suddenly gone is more likely a read
// problem than reality: stop and let a person look (the old sheet sync did too).
function assertNoSuspiciousDrop(changes, mirror, types = batches.SALES_TYPE_NAMES) {
  for (const type of types) {
    const known = [...mirror.entries()].filter(([k, v]) => k.startsWith(`${type}:`) && !v.missing).length;
    const gone = changes.filter((c) => c.recordType === type && c.action === 'missing').length;
    if (known >= 50 && gone > Math.max(20, known * 0.2)) {
      throw syncError(`${gone} dari ${known} ${batches.RECORD_TYPES[type].label.toLowerCase()} tiba-tiba tidak ada di Accurate. Sinkron dihentikan untuk diperiksa.`, 'SUSPICIOUS_DROP');
    }
  }
}

// The same for stock: a pull that would suddenly zero much of the stock held —
// whether the rows vanished from the read or came back as 0.
function assertNoSuspiciousZeroing(changes, mirror, types) {
  for (const type of types) {
    if (batches.RECORD_TYPES[type].missing !== 'snapshot') continue;
    const held = [...mirror.entries()].filter(([k, v]) => k.startsWith(`${type}:`) && !v.missing && Number(v.data?.qty)).length;
    const zeroed = changes.filter((c) => c.recordType === type && c.zeroed).length;
    if (held >= 50 && zeroed > Math.max(20, held * 0.2)) {
      throw syncError(`${zeroed} dari ${held} ${batches.RECORD_TYPES[type].label.toLowerCase()} tiba-tiba hilang dari Accurate. Sinkron dihentikan untuk diperiksa.`, 'SUSPICIOUS_DROP');
    }
  }
}


function countChanges(changes) {
  const counts = {};
  for (const c of changes) {
    counts[c.recordType] = counts[c.recordType] || { create: 0, update: 0, missing: 0 };
    counts[c.recordType][c.action] += 1;
  }
  return counts;
}

module.exports = {
  NOT_FINAL, PAGE_SIZE, delayMs, sleep, syncError, toDate, money, netOfTax,
  openSession, call, listAll, listAllChecked,
  latestMirror, pendingRows, lastSeenMarkers, sameContent, RESOURCE_OF, confirmMissing, waitingDivisions, seenKey,
  dateOnly, mirrorToRow, pick, labelOf, amountOf, diff, assertNoSuspiciousDrop, assertNoSuspiciousZeroing, countChanges,
};
