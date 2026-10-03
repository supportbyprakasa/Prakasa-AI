// The Procurement pull (docs/program-4-divisi.md 2.1, stage 1): vendors (list
// only — vendor detail is closed at the read-only gate) and final purchase
// orders with their lines, quantities, dates and prices (P1). A PO's detail is
// read only when it is new or its marker moved; the per-document loop is a copy
// of the Warehouse documents loop (warehousePull.js), kept separate on purpose.
// Normalizers: procurementCollector.js.

const batches = require('../salesAccurateBatches.service');
const pc = require('./procurementCollector');
const readOnly = require('./accurateReadOnly');
const rules = require('../procurementRules');
const { todayWib } = require('../../utils/wibTime');
const {
  delayMs, sleep, openSession, call, listAllChecked, latestMirror, pendingRows, lastSeenMarkers, sameContent,
  confirmMissing, seenKey, mirrorToRow, diff, assertNoSuspiciousDrop,
} = require('./syncCore');

const TYPES = ['pc_vendor', 'pc_po'];
// Documents not mirrored (yet): their counts go to the approver, so a first one is seen.
const UNMIRRORED = ['purchase-requisition', 'purchase-return', 'vendor-claim', 'roll-over', 'vendor-price'];

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// How the page will call a PO (the same rule as procurementRules.displayStateSql).
function stateOf(row, today = todayWib()) {
  const d = row.data || {};
  if (d.closed || row.status === 'Ditutup') return 'closed';
  if (Number(d.percent_received) >= 100 || row.status === 'Terproses') return 'received';
  if (row.trans_date && row.trans_date < rules.lateFrom()) return 'legacy';
  const due = rules.promisedExpected(row) || (row.trans_date ? addDays(row.trans_date, rules.DEFAULT_LEAD_DAYS) : null);
  if (due && due < addDays(today, -rules.PO_LATE_GRACE_DAYS)) return 'late';
  return Number(d.percent_received) > 0 ? 'partial' : 'open';
}

async function collectProcurement(entityId, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const session = await openSession(entityId, fetchImpl);
  const mirror = await latestMirror(entityId, TYPES);

  onProgress('pc_vendor');
  const vendors = await listAllChecked(session, 'vendor', 'id,vendorNo,name,category,suspended,lastUpdate');
  let namesCleaned = 0;
  const vendorRows = vendors.rows.map((v) => {
    const row = pc.vendorRow(v);
    if ((row.name || null) !== (pc.text(v.name)?.trim() || null)) namesCleaned += 1;
    return { id: v.id, row };
  });

  onProgress('pc_po');
  const listed = await listAllChecked(session, 'purchase-order', 'id,number,transDate,statusName,approvalStatus,percentShipped,shipDate,vendor,lastUpdate');
  const finals = listed.rows.filter(pc.isFinal);
  const pending = await pendingRows(entityId, ['pc_po']);
  const seenBefore = await lastSeenMarkers(entityId, 'procurement');
  const seenNow = {};
  const fetched = [];
  const unread = [];
  let detailCalls = 0;
  let subtotalChecked = 0;
  let subtotalMatched = 0;
  for (const doc of finals) {
    const key = `pc_po:${doc.id}`;
    const latest = mirror.get(key);
    const waiting = pending.get(key);
    const marker = pc.poMarker(doc);
    const known = latest && !latest.missing;
    if (known && latest.data?._rev === marker) { fetched.push({ id: doc.id, row: mirrorToRow('pc_po', latest) }); continue; }
    if (waiting && waiting.data?._rev === marker) { fetched.push({ id: doc.id, row: waiting }); continue; }
    if (known && seenBefore[key] === seenKey(marker, latest.version)) {
      seenNow[key] = seenKey(marker, latest.version);
      fetched.push({ id: doc.id, row: mirrorToRow('pc_po', latest) });
      continue;
    }
    let body = null;
    try {
      body = await call(session, 'purchase-order', 'detail', { id: doc.id });
    } catch (error) {
      if (error instanceof readOnly.AccurateWriteBlocked) throw error;
    }
    detailCalls += 1;
    if (!body?.d) {
      // One unreadable PO never stops the pull: it stays as the mirror has it
      // (or waits, if new) and is read again next time.
      unread.push(doc.id);
      if (known) fetched.push({ id: doc.id, row: mirrorToRow('pc_po', latest) });
      await sleep(delayMs());
      continue;
    }
    const row = pc.poRow(doc, body.d);
    subtotalChecked += 1;
    if (pc.linesMatchSubtotal(body.d)) subtotalMatched += 1;
    if (known && sameContent('pc_po', row, latest)) seenNow[key] = seenKey(marker, latest.version);
    fetched.push({ id: doc.id, row });
    await sleep(delayMs());
  }

  const unmirrored = {};
  for (const resource of UNMIRRORED) {
    try {
      const body = await call(session, resource, 'list', { fields: 'id', 'sp.page': 1, 'sp.pageSize': 1 });
      unmirrored[resource] = Number(body.sp?.rowCount ?? 0);
    } catch (error) {
      if (error instanceof readOnly.AccurateWriteBlocked) throw error;
      unmirrored[resource] = null;
    }
  }

  const today = todayWib();
  const po = { final: finals.length, open: 0, partial: 0, received: 0, closed: 0, late: 0, legacy: 0, no_expected_date: 0, non_idr: 0 };
  let unitsUncertain = 0;
  for (const { row } of fetched) {
    po[stateOf(row, today)] += 1;
    if (!rules.promisedExpected(row)) po.no_expected_date += 1;
    if (row.data?.currency && row.data.currency !== 'IDR') po.non_idr += 1;
    unitsUncertain += pc.unitsUncertain(row);
  }
  const checks = {
    complete: vendors.complete && listed.complete,
    vendors: vendors.rows.length,
    names_cleaned: namesCleaned,
    vendor_detail_calls: 0,
    po,
    lines_match_subtotal: { checked: subtotalChecked, matched: subtotalMatched },
    units_uncertain: unitsUncertain,
    unmirrored,
    ...(unread.length ? { unread_documents: { pc_po: unread.length } } : {}),
  };

  const found = [
    ...diff('pc_vendor', vendorRows, mirror, { complete: vendors.complete }),
    ...diff('pc_po', fetched, mirror, { complete: listed.complete }),
  ];
  // The drop guard judges the raw candidates, before any lookup can thin them out.
  assertNoSuspiciousDrop(found, mirror, TYPES);
  const changes = await confirmMissing(session, found);
  return {
    changes,
    checks: { procurement: checks },
    stats: { read: { pc_vendor: vendors.rows.length, pc_po: finals.length }, detailCalls, seenMarkers: seenNow, checks },
  };
}

module.exports = { collectProcurement, stateOf };
