// Warehouse stage 1 — pure normalizers and checks for the Accurate stock pull
// (the pull itself runs in accurateSync.service.js, scope 'warehouse').
//
// Each row is built from an explicit list of Accurate fields; an Accurate object
// is never spread into a record, so a field Accurate adds later (a cost, an
// address) cannot slip into the mirror. Quantities are rounded to 4 decimals.

const { stockKey } = require('./warehouseRecordTypes');
const { channelFromCustomerCode } = require('../salesNumbers');

const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const text = (v) => (v === undefined || v === null || v === '' ? null : String(v));

function warehouseRow(w) {
  return {
    name: text(w.name),
    status: w.suspended ? 'Nonaktif' : 'Aktif',
    data: { is_default: Boolean(w.defaultWarehouse), is_scrap: Boolean(w.scrapWarehouse) },
  };
}

// item/list-stock without a warehouse: the item's total over every gudang.
function stockTotalRow(r) {
  return {
    number: text(r.no),
    name: text(r.name),
    data: { qty: round4(r.quantity), qty_all_units: text(r.quantityInAllUnit), upc: text(r.upcNo) },
  };
}

// item/list-stock for one gudang.
function stockWarehouseRow(r, warehouse) {
  return {
    number: text(r.no),
    name: text(r.name),
    data: {
      item_id: Number(r.id),
      warehouse_id: Number(warehouse.id),
      warehouse: text(warehouse.name),
      qty: round4(r.quantity),
      qty_all_units: text(r.quantityInAllUnit),
    },
  };
}

// Stock per gudang should add up to Accurate's own total. Items whose total
// moved between the first and the last read of the pull (stock changed while
// reading) are left out of the comparison, as "unstable".
function stockSumCheck(totals, perWarehouse, unstable) {
  const sums = new Map();
  for (const { itemNo, qty } of perWarehouse) sums.set(itemNo, round4((sums.get(itemNo) || 0) + qty));
  let matched = 0;
  const mismatched = [];
  for (const [itemNo, qty] of totals) {
    if (unstable.has(itemNo)) continue;
    if (round4(sums.get(itemNo) || 0) === round4(qty)) matched += 1;
    else mismatched.push(itemNo);
  }
  return {
    items: matched + mismatched.length,
    matched,
    mismatched: mismatched.length,
    unstable: unstable.size,
    sample: mismatched.slice(0, 20),
  };
}

// ------------------------------------------------------------------ documents (stage 2)

// Accurate dates are dd/mm/yyyy.
function toDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(value || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const line = (l) => ({
  item_no: text(l.item?.no),
  item_name: text(l.item?.name || l.detailName),
  qty: round4(l.quantity),
  unit: text(l.itemUnit?.name),
  unit_ratio: l.unitRatio === undefined || l.unitRatio === null ? null : round4(l.unitRatio),
});
const lines = (detail) => (Array.isArray(detail?.detailItem) ? detail.detailItem : []);
const unique = (values) => [...new Set(values.filter(Boolean))];

function transferRow(doc, detail) {
  return {
    number: text(detail.number || doc.number),
    trans_date: toDate(detail.transDate || doc.transDate),
    status: text(detail.statusName || detail.approvalStatus),
    data: {
      transfer_type: text(detail.itemTransferType || doc.itemTransferType),
      out_status: text(detail.itemTransferOutStatus),
      from_wh: text(detail.warehouse?.name),
      to_wh: text(detail.referenceWarehouse?.name),
      transit_wh: text(detail.inTransitWarehouse?.name),
      lines: lines(detail).map((l) => ({ ...line(l), received_qty: l.receivedQuantity === undefined || l.receivedQuantity === null ? null : round4(l.receivedQuantity) })),
      _rev: text(doc.lastUpdate ?? detail.optLock),
    },
  };
}

function adjustmentKind(detail) {
  if (detail.openingBalance) return 'opening';
  if (detail.stockOpnameProcess) return 'opname';
  if (detail.stockCorrection) return 'correction';
  return 'adjustment';
}

function adjustmentRow(doc, detail) {
  return {
    number: text(detail.number || doc.number),
    trans_date: toDate(detail.transDate || doc.transDate),
    status: text(detail.approvalStatus || doc.approvalStatus),
    data: {
      kind: adjustmentKind(detail),
      lines: lines(detail).map((l) => ({
        ...line(l), warehouse: text(l.warehouse?.name), direction: /OUT/i.test(String(l.itemAdjustmentType || '')) ? 'out' : 'in',
      })),
      _rev: text(doc.lastUpdate ?? detail.optLock),
    },
  };
}

function receiptRow(doc, detail) {
  const items = lines(detail);
  return {
    number: text(detail.number || doc.number),
    trans_date: toDate(detail.transDate || doc.transDate),
    status: text(detail.statusName || doc.statusName),
    data: {
      vendor_no: text(detail.vendor?.vendorNo),
      vendor_name: text(detail.vendor?.name),
      supplier_do: text(detail.receiveNumber),
      ship_date: toDate(detail.shipDate),
      po_numbers: unique(items.map((l) => l.purchaseOrder?.number)),
      lines: items.map((l) => ({ ...line(l), warehouse: text(l.warehouse?.name), po_number: text(l.purchaseOrder?.number) })),
      _rev: text(doc.lastUpdate ?? detail.optLock),
    },
  };
}

function deliveryRow(doc, detail) {
  const items = lines(detail);
  const customerNo = text(detail.customer?.customerNo || doc.customer?.customerNo);
  const channel = channelFromCustomerCode(customerNo);
  // The ship-to address (detail.toAddress) is never read into the record.
  return {
    number: text(detail.number || doc.number),
    trans_date: toDate(detail.transDate || doc.transDate),
    customer_no: customerNo,
    customer_name: text(detail.customer?.name || doc.customer?.name),
    channel: text(channel),
    status: text(detail.statusName || doc.statusName),
    data: {
      so_numbers: unique(items.map((l) => l.salesOrder?.number)),
      lines: items.map((l) => ({ ...line(l), warehouse: text(l.warehouse?.name), so_number: text(l.salesOrder?.number) })),
      _rev: text(doc.lastUpdate ?? detail.optLock),
    },
  };
}

// item/list with its units: unit1 is the base unit; ratioN is how many base
// units one unitN holds (Accurate: 1 Ctns = 6 Pack → unit2 Ctns, ratio2 6).
const UNIT_SLOTS = [2, 3, 4, 5];
const unitName = (u) => text(u && typeof u === 'object' ? u.name : u);
function itemUnitRow(item) {
  const units = [];
  for (const n of UNIT_SLOTS) {
    const name = unitName(item[`unit${n}`]);
    const ratio = round4(item[`ratio${n}`]);
    if (name && ratio > 0) units.push({ name, ratio });
  }
  return { number: text(item.no), name: text(item.name), data: { base_unit: unitName(item.unit1), units } };
}

// sales-order list row + detail, for the shipping schedule: what is still to be
// shipped per line. The ship-to address (detail.toAddress) is never read.
// shipped_qty is Accurate's shipQuantity, in BASE units (qty is in the line's
// unit); the views convert (migration 092).
const soMarker = (doc) => `${doc.lastUpdate ?? '-'}|${doc.statusName ?? '-'}|${doc.percentShipped ?? '-'}`;
function soOpenRow(doc, detail) {
  const customerNo = text(detail.customer?.customerNo || doc.customer?.customerNo);
  return {
    number: text(detail.number || doc.number),
    trans_date: toDate(detail.transDate || doc.transDate),
    customer_no: customerNo,
    customer_name: text(detail.customer?.name || doc.customer?.name),
    channel: text(channelFromCustomerCode(customerNo)),
    status: text(detail.statusName || doc.statusName),
    data: {
      ship_date: toDate(detail.shipDate || doc.shipDate),
      percent_shipped: round4(detail.percentShipped ?? doc.percentShipped),
      lines: lines(detail).map((l) => ({
        item_no: text(l.item?.no),
        item_name: text(l.item?.name ?? l.detailName),
        qty: round4(l.quantity),
        unit: text(l.itemUnit?.name),
        unit_ratio: l.unitRatio === undefined || l.unitRatio === null ? null : round4(l.unitRatio),
        shipped_qty: round4(l.shipQuantity),
        warehouse: text(l.warehouse?.name),
        closed: Boolean(l.closed),
      })),
      _rev: soMarker(doc),
    },
  };
}
// Still to ship: final, not fully shipped, not closed (by hand or "Ditutup").
const isOpenSo = (doc) => isFinal(doc) && Number(doc.percentShipped) < 100 && !doc.manualClosed && doc.statusName !== 'Ditutup';

// A document the Warehouse sees is final in Accurate: approved, and not a draft.
const NOT_FINAL = new Set(['Draf', 'Diajukan', 'Ditolak']);
const isFinal = (doc) => (!doc.approvalStatus || doc.approvalStatus === 'APPROVED') && !NOT_FINAL.has(doc.statusName);

module.exports = {
  round4, warehouseRow, stockTotalRow, stockWarehouseRow, stockSumCheck, stockKey,
  toDate, transferRow, adjustmentRow, receiptRow, deliveryRow, isFinal, itemUnitRow, soOpenRow, soMarker, isOpenSo,
};
