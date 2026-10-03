import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECON_FILTERS, RECON_STATUS, ageText, groupTitle, isReconWaiting, itemDiffText, lineReason, matchKindText, reconCardText, reconChipLabel,
  reconEscalates, reconFootnote, reconReasonText, reconStatusKey, reconUrl, readinessNotices, waitingNotice,
} from '../src/pages/warehouse/warehouseReconModel.js';
import { STATUS_LABELS } from '../src/components/statusTone.js';

test('every reconciliation status has a badge; chips carry their counts', () => {
  for (const key of Object.values(RECON_STATUS)) assert.ok(STATUS_LABELS[key], key);
  assert.ok(STATUS_LABELS.recon_explained);
  for (const f of RECON_FILTERS.filter((x) => RECON_STATUS[x.key])) assert.equal(STATUS_LABELS[RECON_STATUS[f.key]], f.label, f.key);
  assert.equal(reconChipLabel('open', { open: 1200 }), 'Perlu dicek (1.200)');
  assert.equal(reconChipLabel('matched', undefined), 'Cocok');
  assert.equal(reconStatusKey({ status: 'qty_diff', explained: true }), 'recon_explained');
  assert.equal(reconStatusKey({ status: 'app_only' }), 'recon_app_only');
});

test('each group says in one line what is wrong, or how it matched', () => {
  assert.equal(reconReasonText({ status: 'app_only', groupKey: 'm-12' }), 'Tanpa nomor referensi — pasangkan manual');
  assert.equal(reconReasonText({ status: 'app_only', groupKey: 'SJ001' }), 'Belum ada dokumen Accurate dengan referensi ini');
  assert.equal(reconReasonText({ status: 'acc_only', direction: 'outbound', pendingMovements: 0 }), 'Belum dicatat sebagai barang keluar di aplikasi');
  assert.equal(reconReasonText({ status: 'acc_only', direction: 'inbound', pendingMovements: 1 }), 'Ada pergerakan menunggu approval dengan referensi ini');
  assert.equal(reconReasonText({ status: 'qty_diff', diffItems: 2 }), '2 barang beda jumlah');
  assert.equal(reconReasonText({ status: 'uncomparable', missingItemLines: 1 }), '1 baris tanpa kode barang');
  assert.equal(reconReasonText({ status: 'uncomparable', missingItemLines: 0, unknownLines: 3 }), '3 baris dengan satuan belum dikenal');
  assert.equal(reconReasonText({ status: 'matched', matchKinds: ['supplier_do'] }), 'Cocok lewat No. SJ pemasok');
  assert.equal(matchKindText(['number', 'manual']), 'nomor dokumen, dipasangkan manual');
});

test('quantities read in base units with a sign; age says when it will escalate', () => {
  assert.equal(itemDiffText({ diff: 2, baseUnit: 'Pcs' }), '+2 Pcs');
  assert.equal(itemDiffText({ diff: -1.5, baseUnit: null }), '−1,5 satuan dasar');
  assert.equal(itemDiffText({ diff: 0, baseUnit: 'Pcs' }), '0 Pcs');
  assert.equal(ageText(0), 'Hari ini · belum dieskalasi');
  // Escalated on the day it is graceDays old (since <= today − grace), not a day later.
  assert.equal(ageText(1), '1 hari · belum dieskalasi');
  assert.equal(ageText(2), '2 hari');
  assert.equal(ageText(2, 3), '2 hari · belum dieskalasi');
  assert.equal(ageText(5), '5 hari');
  assert.equal(ageText(5, 2, false), '5 hari · belum dieskalasi', 'never claims an escalation that did not happen');
  assert.equal(groupTitle({ referenceNo: null, docNumbers: ['RI.1'] }), 'RI.1');
  assert.equal(groupTitle({ referenceNo: null, docNumbers: [], firstMovementId: 9 }), '#9');
  assert.equal(lineReason({ itemNo: null, sku: null }), 'Tanpa kode barang');
  assert.equal(lineReason({ itemNo: 'A', qtyBase: null }), 'Satuan belum dikenal');
  assert.equal(lineReason({ itemNo: 'A', qtyBase: 4 }), '');
  assert.equal(reconUrl('inbound', 'PO 1/2'), '/warehouse/stock?tab=recon&direction=inbound&group=PO%201%2F2');
});

test('the tab explains itself until documents, movements and units are approved; never mentions prices', () => {
  assert.equal(readinessNotices({ documents: 0 })[0].title, 'Dokumen gudang dari Accurate belum disetujui');
  assert.match(readinessNotices({ documents: 3, units: 1, reconFrom: '2026-09-22' })[0].title, /^Belum ada barang masuk\/keluar yang disetujui sejak/);
  assert.equal(readinessNotices({ documents: 3, units: 0, inboundFrom: '2026-09-23' })[0].title, 'Satuan barang belum disetujui');
  assert.deepEqual(readinessNotices({ documents: 3, units: 1, inboundFrom: '2026-09-23' }), []);
  const foot = reconFootnote({ windowDays: 180, inboundFrom: '2026-09-23' });
  assert.match(foot, /180 hari terakhir/);
  assert.doesNotMatch(foot, /Rp|harga beli/);
});

test('a difference the Accurate data does not cover yet waits: its own badge, no escalation claimed', () => {
  const waiting = { status: 'app_only', groupKey: 'SJ001', judged: false, dataThrough: '2026-09-24', daysOpen: 4 };
  assert.equal(isReconWaiting(waiting), true);
  assert.equal(reconStatusKey(waiting), 'recon_waiting');
  assert.equal(STATUS_LABELS.recon_waiting, 'Menunggu data Accurate');
  assert.equal(reconStatusKey({ ...waiting, status: 'qty_diff' }), 'recon_waiting', 'not "Selisih jumlah"');
  assert.equal(reconStatusKey({ ...waiting, judged: true }), 'recon_app_only');
  assert.equal(reconStatusKey({ ...waiting, status: 'matched' }), 'recon_matched', 'a match needs no judging');
  assert.equal(reconStatusKey({ ...waiting, status: 'acc_only' }), 'recon_acc_only');
  assert.equal(reconStatusKey({ ...waiting, explained: true }), 'recon_explained');
  assert.equal(reconReasonText(waiting), 'Belum ada dokumen Accurate dengan referensi ini · data Accurate baru sampai 24 Sep 2026');
  assert.equal(reconEscalates(waiting), false);
  assert.equal(ageText(waiting.daysOpen, 2, reconEscalates(waiting)), '4 hari · belum dieskalasi');
  assert.equal(reconEscalates({ ...waiting, judged: true }), true);
  assert.equal(reconEscalates({ status: 'uncomparable', missingItemLines: 0, unknownLines: 2 }), false, 'a unit Accurate has not approved is not escalated');
  assert.equal(reconEscalates({ status: 'acc_only', pendingMovements: 1 }), false);
  assert.equal(waitingNotice({ dataThrough: '2026-09-24' }, { waiting: 0 }), null);
  const notice = waitingNotice({ dataThrough: '2026-09-24' }, { waiting: 3 });
  assert.equal(notice.title, '3 selisih menunggu data Accurate');
  assert.match(notice.body, /baru lengkap sampai 24 Sep 2026/);
  assert.ok(RECON_FILTERS.some((f) => f.key === 'waiting'), 'a chip of its own');
});

test('the movement card says why a movement is not compared, and when it still waits for Accurate data', () => {
  assert.equal(reconCardText({ inScope: false, reason: 'outside_window', windowDays: 180, reconFrom: '2026-09-22' }), 'Lebih dari 180 hari lalu — diselesaikan lewat stock opname.');
  assert.equal(reconCardText({ inScope: false, reason: 'before_recon_from', reconFrom: '2026-09-22' }), 'Di luar periode pencocokan (sebelum 22 Sep 2026).');
  assert.equal(reconCardText({ inScope: false, reason: 'not_approved' }), 'Dicocokkan setelah disetujui.');
  assert.equal(reconCardText({ inScope: true, docsReady: false }), 'Dokumen gudang dari Accurate belum disetujui.');
  assert.equal(reconCardText({ inScope: true, docsReady: true, status: 'matched', docNumbers: ['RI.1'] }), 'Dokumen Accurate: RI.1.');
  assert.equal(
    reconCardText({ inScope: true, docsReady: true, status: 'app_only', judged: false, dataThrough: '2026-09-24', docNumbers: [] }),
    'Belum ada dokumen Accurate yang cocok. Data Accurate baru lengkap sampai 24 Sep 2026; dicek lagi setelah datanya lengkap.',
  );
});
