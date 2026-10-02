// The Sales & Retail Commerce pull: customers, items, sales orders, invoices
// (with lines), delivery orders, receipts and returns — final documents only.
// Normalizers here build each mirror row from named Accurate fields.

const batches = require('../salesAccurateBatches.service');
const { channelFromCustomerCode } = require('../salesNumbers');
const { divisionForAccurateChannel } = require('../salesStatus');
const {
  NOT_FINAL, delayMs, sleep, toDate, money, netOfTax, openSession, call, listAllChecked,
  latestMirror, pendingRows, lastSeenMarkers, sameContent, confirmMissing, waitingDivisions, seenKey, mirrorToRow, diff, assertNoSuspiciousDrop,
} = require('./syncCore');

// ------------------------------------------------------------------ normalizing

function customerRow(r) {
  return {
    number: r.customerNo || null,
    name: r.name || null,
    // Channel from the customer number (Accurate's categories are not consistent); category kept as a note.
    channel: channelFromCustomerCode(r.customerNo),
    status: r.suspended ? 'Nonaktif' : 'Aktif',
    data: { category: r.category?.name || null, created: toDate(r.createDate) },
  };
}

function orderRow(r, channels) {
  const transDate = toDate(r.transDate);
  const shipDate = toDate(r.shipDate);
  return {
    number: r.number,
    trans_date: transDate,
    customer_no: r.customer?.customerNo || null,
    customer_name: r.customer?.name || null,
    channel: channels.get(r.customer?.customerNo) || channelFromCustomerCode(r.customer?.customerNo),
    status: r.statusName || null,
    dpp_amount: netOfTax(r),
    total_amount: money(r.totalAmount),
    // Tgl kirim only when Sales set it after the SO date (a promise, program
    // 3.4) and closed only when closed by hand: stored only when meaningful,
    // so every other SO keeps its content and gets no new version.
    data: {
      percent_shipped: r.percentShipped ?? null, tax_amount: money(r.tax1Amount),
      ...(shipDate && transDate && shipDate > transDate ? { ship_date: shipDate } : {}),
      ...(r.manualClosed === true ? { closed: true } : {}),
    },
  };
}

function invoiceRow(r, channels, extra) {
  return {
    number: r.number,
    trans_date: toDate(r.transDate),
    due_date: toDate(r.dueDate),
    customer_no: r.customer?.customerNo || null,
    customer_name: r.customer?.name || null,
    channel: channels.get(r.customer?.customerNo) || channelFromCustomerCode(r.customer?.customerNo),
    salesman: extra.salesman || null,
    status: r.statusName || null,
    dpp_amount: netOfTax(r),
    total_amount: money(r.totalAmount),
    outstanding_amount: money(r.primeOwing),
    // Keys starting with "_" are bookkeeping, not content (see contentHash).
    data: {
      tax_amount: money(r.tax1Amount), tax_dpp: money(r.dppAmount), so_numbers: extra.soNumbers || [], lines: extra.lines || [],
      // A down-payment invoice (left out of revenue). Stored only when true, so
      // no other invoice gets a new version because of it.
      ...(r.invoiceDp === true ? { dp: true } : {}),
      _last_update: r.lastUpdate || null,
    },
  };
}

// Salesman, linked SO numbers and the product lines only exist on the invoice
// detail. A line's `salesAmount` is its revenue before PPN; the lines add up to
// the invoice's total − PPN, so revenue per product matches revenue in total.
function invoiceExtra(detail) {
  const lines = Array.isArray(detail?.detailItem) ? detail.detailItem : [];
  const salesman = detail?.masterSalesmanName || lines.map((l) => l.salesmanName).find(Boolean) || null;
  const soNumbers = [...new Set(lines.map((l) => l.salesOrder?.number).filter(Boolean))];
  return {
    salesman,
    soNumbers,
    lines: lines.map((l) => ({
      item_no: l.item?.no || null,
      item_name: l.item?.name || l.detailName || null,
      qty: l.quantity === undefined ? null : Number(l.quantity),
      unit: l.itemUnit?.name || null,
      amount: money(l.salesAmount),
    })),
  };
}

function deliveryRow(r, channels, extra) {
  const lines = Array.isArray(extra?.detailItem) ? extra.detailItem : [];
  return {
    number: r.number,
    trans_date: toDate(r.transDate),
    customer_no: r.customer?.customerNo || null,
    customer_name: r.customer?.name || null,
    channel: channels.get(r.customer?.customerNo) || channelFromCustomerCode(r.customer?.customerNo),
    status: r.statusName || null,
    data: { so_numbers: [...new Set(lines.map((l) => l.salesOrder?.number).filter(Boolean))], _last_update: r.lastUpdate || null },
  };
}

function receiptRow(r, channels, detail) {
  const paid = Array.isArray(detail?.detailInvoice) ? detail.detailInvoice : [];
  return {
    number: r.number,
    trans_date: toDate(r.transDate),
    customer_no: r.customer?.customerNo || null,
    customer_name: r.customer?.name || null,
    channel: channels.get(r.customer?.customerNo) || channelFromCustomerCode(r.customer?.customerNo),
    total_amount: money(r.totalPayment),
    data: {
      bank: r.bank?.name || null,
      invoices: paid.map((p) => ({ number: p.invoice?.number || null, amount: money(p.paymentAmount) })),
      _last_update: r.lastUpdate || null,
    },
  };
}

function returnRow(r, channels) {
  return {
    number: r.number,
    trans_date: toDate(r.transDate),
    customer_no: r.customer?.customerNo || null,
    customer_name: r.customer?.name || null,
    channel: channels.get(r.customer?.customerNo) || channelFromCustomerCode(r.customer?.customerNo),
    status: r.statusName || null,
    dpp_amount: netOfTax(r),
    total_amount: money(r.totalAmount),
    data: { tax_amount: money(r.tax1Amount) },
  };
}

function itemRow(r) {
  return {
    number: r.no || null,
    name: r.name || null,
    status: r.suspended ? 'Nonaktif' : 'Aktif',
    data: { category: r.itemCategory?.name || null, type: r.itemTypeName || null, unit_price: money(r.unitPrice) },
  };
}


// ------------------------------------------------------------------ one pull

async function collectChanges(entityId, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const session = await openSession(entityId, fetchImpl);
  const mirror = await latestMirror(entityId, batches.SALES_TYPE_NAMES);
  const pending = await pendingRows(entityId, batches.SALES_TYPE_NAMES);
  const seenBefore = await lastSeenMarkers(entityId, 'sales');
  const seenNow = {};
  const waiting = await waitingDivisions(entityId);

  onProgress('customer');
  // Every list is read with a completeness check: only a complete read may mark
  // something "tidak ada lagi" (a short read never does).
  const complete = {};
  const readList = async (type, resource, fields) => {
    const read = await listAllChecked(session, resource, fields);
    complete[type] = read.complete;
    return read.rows;
  };
  const customers = await readList('customer', 'customer', 'id,customerNo,name,category,suspended,createDate');
  const channels = new Map(customers.map((c) => [c.customerNo, channelFromCustomerCode(c.customerNo)]));

  onProgress('sales_order');
  const orders = (await readList('sales_order', 'sales-order', 'id,number,transDate,statusName,dppAmount,tax1Amount,totalAmount,percentShipped,shipDate,manualClosed,customer'))
    .filter((o) => !NOT_FINAL.has(o.statusName));

  onProgress('sales_invoice');
  const invoiceList = (await readList('sales_invoice', 'sales-invoice', 'id,number,transDate,dueDate,statusName,dppAmount,tax1Amount,totalAmount,primeOwing,invoiceDp,customer,lastUpdate'))
    .filter((i) => !NOT_FINAL.has(i.statusName));
  let detailCalls = 0;
  // A document's detail is read only when it is new or changed since the
  // approved version — or since the version a pending batch already holds.
  const sameMarker = (m, doc) => Boolean(m?.data?._last_update) && m.data._last_update === doc.lastUpdate;
  const divisionOf = (customerNo) => divisionForAccurateChannel(channels.get(customerNo) || channelFromCustomerCode(customerNo));
  const withDetail = async (type, resource, list, fromMirror, build) => {
    const out = [];
    for (const doc of list) {
      const key = `${type}:${doc.id}`;
      const latest = mirror.get(key);
      const inBatch = pending.get(key);
      const known = latest && !latest.missing;
      let row;
      if (known && sameMarker(latest, doc)) {
        row = build(doc, fromMirror(latest));
      } else if (sameMarker(inBatch, doc)) {
        row = build(doc, fromMirror(inBatch));
      } else if (known && doc.lastUpdate && seenBefore[key] === seenKey(doc.lastUpdate, latest.version)) {
        // Read before at this marker against this very version, and nothing kept had changed.
        row = build(doc, fromMirror(latest));
        seenNow[key] = seenKey(doc.lastUpdate, latest.version);
      } else if (waiting.has(divisionOf(doc.customer?.customerNo))) {
        // Its division still has a batch waiting: nothing can be staged for it
        // now, so no detail is read; the pull after the decision picks it up.
        // The mirror's own row, untouched: a list row over an old detail could
        // be staged as a half-new document if the batch is decided mid-pull.
        if (!known) continue;
        row = mirrorToRow(type, latest);
      } else {
        const body = await call(session, resource, 'detail', { id: doc.id });
        row = build(doc, body.d);
        detailCalls += 1;
        if (known && doc.lastUpdate && sameContent(type, row, latest)) seenNow[key] = seenKey(doc.lastUpdate, latest.version);
        await sleep(delayMs());
      }
      out.push({ id: doc.id, row });
    }
    return out;
  };
  const invoices = await withDetail('sales_invoice', 'sales-invoice', invoiceList,
    (m) => ({ masterSalesmanName: m.salesman, _cached: m.data }),
    (doc, d) => invoiceRow(doc, channels, d?._cached
      ? { salesman: d.masterSalesmanName, soNumbers: d._cached.so_numbers || [], lines: d._cached.lines || [] }
      : invoiceExtra(d)));

  onProgress('delivery_order');
  const doList = (await readList('delivery_order', 'delivery-order', 'id,number,transDate,statusName,customer,lastUpdate'))
    .filter((d) => !NOT_FINAL.has(d.statusName));
  const deliveries = await withDetail('delivery_order', 'delivery-order', doList,
    (m) => ({ detailItem: (m.data?.so_numbers || []).map((n) => ({ salesOrder: { number: n } })) }),
    (doc, d) => deliveryRow(doc, channels, d));

  onProgress('sales_receipt');
  const receiptList = await readList('sales_receipt', 'sales-receipt', 'id,number,transDate,totalPayment,customer,bank,lastUpdate');
  const receipts = await withDetail('sales_receipt', 'sales-receipt', receiptList,
    (m) => ({ detailInvoice: (m.data?.invoices || []).map((p) => ({ invoice: { number: p.number }, paymentAmount: p.amount })) }),
    (doc, d) => receiptRow(doc, channels, d));

  onProgress('sales_return');
  const returns = (await readList('sales_return', 'sales-return', 'id,number,transDate,statusName,totalAmount,tax1Amount,customer,lastUpdate'))
    .filter((r) => !NOT_FINAL.has(r.statusName));

  onProgress('item');
  const items = await readList('item', 'item', 'id,no,name,itemTypeName,itemCategory,unitPrice,suspended,lastUpdate');

  const found = [
    ...diff('customer', customers.map((c) => ({ id: c.id, row: customerRow(c) })), mirror, { complete: complete.customer }),
    ...diff('item', items.map((i) => ({ id: i.id, row: itemRow(i) })), mirror, { complete: complete.item }),
    ...diff('sales_order', orders.map((o) => ({ id: o.id, row: orderRow(o, channels) })), mirror, { complete: complete.sales_order }),
    ...diff('sales_invoice', invoices, mirror, { complete: complete.sales_invoice }),
    ...diff('delivery_order', deliveries, mirror, { complete: complete.delivery_order }),
    ...diff('sales_receipt', receipts, mirror, { complete: complete.sales_receipt }),
    ...diff('sales_return', returns.map((r) => ({ id: r.id, row: returnRow(r, channels) })), mirror, { complete: complete.sales_return }),
  ];
  // The drop guard judges the raw candidates, before any lookup can thin them out.
  assertNoSuspiciousDrop(found, mirror, batches.SALES_TYPE_NAMES);
  const changes = await confirmMissing(session, found, {
    skip: (change) => waiting.has(divisionOf(change.before?.customer_no ?? change.before?.number)),
  });
  return {
    changes,
    stats: {
      seenMarkers: seenNow,
      read: {
        customer: customers.length, item: items.length, sales_order: orders.length, sales_invoice: invoiceList.length,
        delivery_order: doList.length, sales_receipt: receiptList.length, sales_return: returns.length,
      },
      detailCalls,
      categories: [...new Set(customers.map((c) => c.category?.name).filter(Boolean))].sort(),
    },
  };
}

// Warehouse stage 1: gudang and stock from Accurate's own numbers — the total
// per item (item/list-stock) and the same per gudang (list-stock?warehouseName).
// The total is read at the start and again at the end: items that moved in
// between are "unstable" and left out of the per-gudang check.

module.exports = {
  customerRow, orderRow, invoiceRow, invoiceExtra, deliveryRow, receiptRow, returnRow, itemRow, collectChanges,
};
