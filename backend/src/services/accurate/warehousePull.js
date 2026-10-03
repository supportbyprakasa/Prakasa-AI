// The Warehouse pull: gudang and stock (stage 1) and, once switched on, the
// documents that move goods (stage 2). Quantities only; the normalizers are in
// warehouseCollector.js.

const pool = require('../../db/pool');
const batches = require('../salesAccurateBatches.service');
const wh = require('./warehouseCollector');
const readOnly = require('./accurateReadOnly');
const {
  delayMs, sleep, openSession, call, listAllChecked, latestMirror, pendingRows, lastSeenMarkers, sameContent,
  confirmMissing, seenKey, mirrorToRow, diff, assertNoSuspiciousDrop, assertNoSuspiciousZeroing,
} = require('./syncCore');

async function collectWarehouse(entityId, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const session = await openSession(entityId, fetchImpl);
  const mirror = await latestMirror(entityId, batches.WAREHOUSE_TYPE_NAMES);

  onProgress('wh_warehouse');
  const warehouses = await listAllChecked(session, 'warehouse', 'id,name,defaultWarehouse,scrapWarehouse,suspended');

  onProgress('wh_stock_total');
  const first = await listAllChecked(session, 'item', null, { action: 'list-stock' });

  onProgress('wh_stock');
  const pairs = [];
  let pairsComplete = warehouses.complete;
  for (const warehouse of warehouses.rows) {
    const read = await listAllChecked(session, 'item', null, { action: 'list-stock', params: { warehouseName: warehouse.name } });
    pairsComplete = pairsComplete && read.complete;
    for (const r of read.rows) pairs.push({ r, warehouse });
    await sleep(delayMs());
  }
  const last = await listAllChecked(session, 'item', null, { action: 'list-stock' });

  const firstQty = new Map(first.rows.map((r) => [r.no, wh.round4(r.quantity)]));
  const unstable = new Set(last.rows.filter((r) => firstQty.get(r.no) !== wh.round4(r.quantity)).map((r) => r.no));
  const totals = new Map(last.rows.map((r) => [r.no, wh.round4(r.quantity)]));
  const checks = {
    stock_sum: wh.stockSumCheck(totals, pairs.map(({ r }) => ({ itemNo: r.no, qty: wh.round4(r.quantity) })), unstable),
    negative_total: last.rows.filter((r) => Number(r.quantity) < 0).length,
    negative_positions: pairs.filter(({ r }) => Number(r.quantity) < 0).length,
    complete: warehouses.complete && first.complete && last.complete && pairsComplete,
  };

  // Stage 2: the documents that move goods — only once switched on
  // (ACCURATE_WAREHOUSE_DOCUMENTS=1), so half-built code never stages a batch.
  // Open sales orders (program 2.2), once switched on (ACCURATE_WAREHOUSE_SO=1).
  const stages = { documents: documentsEnabled(), so: soEnabled() };
  const documents = stages.documents || stages.so ? await collectWarehouseDocuments(entityId, session, mirror, onProgress, stages) : null;

  // Units per item (program 1.3), once switched on (ACCURATE_ITEM_UNITS=1).
  let units = null;
  if (unitsEnabled()) {
    onProgress('wh_item_unit');
    units = await listAllChecked(session, 'item', 'id,no,name,itemTypeName,unit1,unit2,unit3,unit4,unit5,ratio2,ratio3,ratio4,ratio5');
    units.rows = units.rows.filter((i) => i.itemTypeName === 'Persediaan');
  }

  const changes = [
    ...diff('wh_warehouse', warehouses.rows.map((w) => ({ id: w.id, row: wh.warehouseRow(w) })), mirror, { complete: warehouses.complete }),
    ...diff('wh_stock_total', last.rows.map((r) => ({ id: r.id, row: wh.stockTotalRow(r) })), mirror, { complete: first.complete && last.complete }),
    ...diff('wh_stock', pairs.map(({ r, warehouse }) => ({ id: wh.stockKey(r.id, warehouse.id), row: wh.stockWarehouseRow(r, warehouse) })),
      mirror, { complete: pairsComplete }),
  ];
  if (documents) changes.push(...documents.changes);
  if (units) changes.push(...diff('wh_item_unit', units.rows.map((i) => ({ id: i.id, row: wh.itemUnitRow(i) })), mirror, { complete: units.complete }));
  // Documents Accurate would not show this time: named on the batch, read again next pull.
  if (documents && Object.keys(documents.unread).length) checks.unread_documents = documents.unread;
  // The drop guard judges the raw candidates, before any lookup can thin them out.
  assertNoSuspiciousDrop(changes, mirror, [
    'wh_warehouse', ...(stages.documents ? DOCUMENT_TYPES : []), ...(stages.so ? SO_TYPES : []), ...(units ? UNIT_TYPES : []),
  ]);
  const confirmed = await confirmMissing(session, changes);
  changes.length = 0;
  changes.push(...confirmed);
  assertNoSuspiciousZeroing(changes, mirror, batches.WAREHOUSE_TYPE_NAMES);
  return {
    changes,
    checks: { warehouse: checks },
    stats: {
      read: {
        wh_warehouse: warehouses.rows.length, wh_stock_total: last.rows.length, wh_stock: pairs.length,
        ...(documents?.read || {}), ...(units ? { wh_item_unit: units.rows.length } : {}),
      },
      ...(documents ? { detailCalls: documents.detailCalls, fullCheckAt: documents.fullCheckAt, seenMarkers: documents.seenMarkers } : {}),
      checks,
    },
  };
}

const { DOCUMENT_TYPE_NAMES: DOCUMENT_TYPES, UNIT_TYPE_NAMES: UNIT_TYPES, SO_TYPE_NAMES: SO_TYPES } = require('./warehouseRecordTypes');
const documentsEnabled = () => process.env.ACCURATE_WAREHOUSE_DOCUMENTS === '1';
const unitsEnabled = () => process.env.ACCURATE_ITEM_UNITS === '1';
const soEnabled = () => process.env.ACCURATE_WAREHOUSE_SO === '1';
// Documents without a change marker in their list (item adjustments) are read
// again in full at most once a day; in between, only new ones are read.
const FULL_CHECK_MS = 24 * 60 * 60 * 1000;

async function lastFullCheck(entityId) {
  const [[row]] = await pool.query(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(stats, '$.fullCheckAt')) AS at FROM sales_sync_runs
      WHERE entity_id = ? AND source = 'accurate' AND status = 'success'
        AND JSON_UNQUOTE(JSON_EXTRACT(stats, '$.scope')) = 'warehouse'
        AND JSON_EXTRACT(stats, '$.fullCheckAt') IS NOT NULL
        -- A full check only counts when what it found was not thrown away.
        AND NOT EXISTS (SELECT 1 FROM sales_accurate_batches b WHERE b.sync_run_id = sales_sync_runs.id AND b.status IN ('rejected', 'withdrawn'))
      ORDER BY id DESC LIMIT 1`,
    [entityId],
  );
  const at = row?.at && row.at !== 'null' ? new Date(row.at) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

async function collectWarehouseDocuments(entityId, session, mirror, onProgress, stages = { documents: true, so: false }) {
  const previous = await lastFullCheck(entityId);
  const pending = await pendingRows(entityId, [...DOCUMENT_TYPES, ...SO_TYPES]);
  const seenBefore = await lastSeenMarkers(entityId, 'warehouse');
  const seenNow = {};
  const fullCheck = !previous || Date.now() - previous.getTime() >= FULL_CHECK_MS;
  let detailCalls = 0;
  const read = {};
  const unread = {};
  const changes = [];
  // One document type: final documents only (or those `keep` says); the detail
  // is read when the document is new, its change marker moved, or (no marker) on
  // the daily check. `markerOf`: a marker made of more than lastUpdate.
  const pull = async (type, resource, fields, build, { keep = wh.isFinal, markerOf = (doc) => doc.lastUpdate ?? null } = {}) => {
    onProgress(type);
    const listed = await listAllChecked(session, resource, fields);
    const finals = listed.rows.filter(keep);
    const fetched = [];
    for (const doc of finals) {
      const latest = mirror.get(`${type}:${doc.id}`);
      const waiting = pending.get(`${type}:${doc.id}`);
      const marker = markerOf(doc);
      const same = (rev) => (marker !== null ? rev === String(marker) : !fullCheck);
      const key = `${type}:${doc.id}`;
      if (latest && !latest.missing && same(latest.data?._rev)) { fetched.push({ id: doc.id, row: mirrorToRow(type, latest) }); continue; }
      if (waiting && same(waiting.data?._rev)) { fetched.push({ id: doc.id, row: waiting }); continue; }
      if (latest && !latest.missing && marker !== null && seenBefore[key] === seenKey(marker, latest.version)) {
        // Read before at this marker against this very version, and nothing kept had changed.
        seenNow[key] = seenKey(marker, latest.version);
        fetched.push({ id: doc.id, row: mirrorToRow(type, latest) });
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
        // One unreadable document must not stop the pull (stock included): it
        // stays as the mirror has it, or waits if it is new, and is read again
        // on the next pull.
        unread[type] = (unread[type] || 0) + 1;
        if (latest && !latest.missing) fetched.push({ id: doc.id, row: mirrorToRow(type, latest) });
        await sleep(delayMs());
        continue;
      }
      const row = build(doc, body.d);
      if (latest && !latest.missing && marker !== null && sameContent(type, row, latest)) seenNow[key] = seenKey(marker, latest.version);
      fetched.push({ id: doc.id, row });
      await sleep(delayMs());
    }
    read[type] = finals.length;
    changes.push(...diff(type, fetched, mirror, { complete: listed.complete }));
  };
  if (stages.documents) {
    await pull('wh_transfer', 'item-transfer', 'id,number,transDate,approvalStatus,itemTransferType,lastUpdate', wh.transferRow);
    await pull('wh_adjustment', 'item-adjustment', 'id,number,transDate,approvalStatus', wh.adjustmentRow);
    await pull('wh_receipt', 'receive-item', 'id,number,transDate,statusName,approvalStatus,lastUpdate', wh.receiptRow);
    await pull('wh_delivery', 'delivery-order', 'id,number,transDate,statusName,approvalStatus,customer,lastUpdate', wh.deliveryRow);
  }
  // Shipping moves a SO's percentage without always moving its lastUpdate.
  if (stages.so) {
    await pull('wh_so_open', 'sales-order', 'id,number,transDate,statusName,approvalStatus,percentShipped,shipDate,manualClosed,customer,lastUpdate',
      wh.soOpenRow, { keep: wh.isOpenSo, markerOf: wh.soMarker });
  }
  // A daily check counts only when the documents were read, all of them (an
  // unreadable SO does not hold it back; the next pull tries it again).
  const checked = stages.documents && fullCheck && !Object.keys(unread).some((t) => DOCUMENT_TYPES.includes(t));
  return {
    changes, read, unread, detailCalls, seenMarkers: seenNow,
    fullCheckAt: checked ? new Date().toISOString() : (previous?.toISOString() || null),
  };
}


module.exports = { collectWarehouse };
