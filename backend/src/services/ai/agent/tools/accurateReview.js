// "Periksa dengan AI" on a Data Accurate batch (Wave D2): one read tool that
// returns the automatic findings of a batch — the same ones the review panel on
// the batch page shows (services/accurateBatchReview.service.js findingsFor).
// Visibility is the batch service's own rule (own division, or a batch the
// user stands in to decide); another division's batch reads as "not found".
// It is notes for the human who decides: it never approves or rejects, gives
// no verdict, and carries no rupiah (this is not a money tool).
const batches = require('../../../salesAccurateBatches.service');
const batchReview = require('../../../accurateBatchReview.service');
const { WIB_OFFSET_MS } = require('../../../../utils/wibTime');
const { anyPerm, denied } = require('./_shared');

const BATCH_VIEW = Object.freeze(['accurate.batch.view', 'sales.master.manage']);
const BATCH_STATUS_TEXT = Object.freeze({ pending: 'menunggu keputusan', applied: 'disetujui', rejected: 'ditolak', withdrawn: 'ditarik kembali' });
// A moment as WIB wall-clock text ("2026-10-02 09:15 WIB").
const wib = (v) => {
  const at = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(at) ? `${new Date(at + WIB_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} WIB` : null;
};

const REVIEW_SEVERITY = { high: 'tinggi', medium: 'sedang', low: 'rendah' };
const MAX_REVIEWED = 3;

// One batch's automatic findings, as the review panel on the batch page shows
// them — without any rupiah (this is not a money tool).
function reviewOut(result) {
  return {
    id_batch: result.batch.id,
    divisi: result.batch.departmentName,
    status: BATCH_STATUS_TEXT[result.batch.status] || result.batch.status,
    jumlah_data: result.batch.itemCount,
    diajukan: wib(result.batch.createdAt),
    isi: result.contents.map((c) => ({ jenis: c.label, baru: c.create, berubah: c.update, tidak_ada_lagi: c.missing })),
    jumlah_temuan: result.findings.length,
    temuan: result.findings.map((f) => ({
      kode: f.code,
      tingkat: REVIEW_SEVERITY[f.severity] || f.severity,
      judul: f.title,
      jumlah: f.count,
      contoh_nomor: f.examples.map((e) => e.number),
      mengapa_penting: f.why,
    })),
    ...(result.notChecked.length ? { belum_bisa_diperiksa: result.notChecked.map((x) => ({ kode: x.code, judul: x.title, alasan: x.reason })) } : {}),
    rute: `/data-accurate/${result.batch.id}`,
  };
}

const periksaBatch = {
  name: 'periksa_batch_accurate',
  module: ['accurate-batches'],
  label: 'Memeriksa batch Data Accurate',
  description: 'Pemeriksaan otomatis satu batch Data Accurate sebelum Supervisor/Head memutuskannya: isi batch per jenis data (baru, berubah, tidak ada lagi) dan temuan — '
    + 'nilai dokumen yang berubah besar, data yang tidak ada lagi di Accurate, nomor ganda, perubahan pada dokumen bulan sebelumnya atau dokumen lama, tanggal di masa depan, '
    + 'customer yang belum ada di master aplikasi, channel kosong, faktur tanpa SO, barang tanpa konversi satuan, dan peringatan dari tarikan. Tiap temuan memuat tingkat, jumlah, '
    + 'paling banyak lima nomor dokumen contoh, dan mengapa itu penting. Isi id_batch; tanpa id_batch, batch yang menunggu keputusan Anda diperiksa (paling banyak tiga). '
    + 'Dibaca dari isi batch yang sudah tersimpan di aplikasi dibanding data yang sudah disetujui; Accurate tidak dihubungi. Hanya batch divisi Anda sendiri. '
    + 'Ini catatan untuk manusia: alat ini tidak pernah menyetujui atau menolak, dan tidak memberi rekomendasi keputusan. Tanpa nilai rupiah, tanpa harga beli, tanpa isi baris dokumen.',
  inputSchema: {
    type: 'object',
    properties: {
      id_batch: { type: 'integer', minimum: 1, description: 'Nomor batch (lihat batch_data_accurate). Kosong = batch yang menunggu keputusan Anda' },
    },
    additionalProperties: false,
  },
  permission: BATCH_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    if (!anyPerm(user, BATCH_VIEW)) throw denied();
    const note = 'Hasil pemeriksaan otomatis, bukan keputusan. Batch disetujui atau ditolak oleh Supervisor/Head di halaman Data Accurate.';
    if (Number.isInteger(input.id_batch)) {
      let result;
      try {
        result = await batchReview.findingsFor(user, input.id_batch, { money: false });
      } catch (e) {
        // Another division's batch reads exactly like one that does not exist.
        if (e.status === 404) return { ditemukan: false, catatan: 'Batch itu tidak ditemukan di antara batch yang boleh Anda lihat.' };
        throw e;
      }
      return { ditemukan: true, ...reviewOut(result), catatan: note };
    }
    const pending = await batches.listBatches(user, { status: 'pending', page: 1, limit: 10, offset: 0 });
    const mine = [];
    for (const b of pending.items) {
      const deciders = b.approvalRequestId
        ? await batches.deciderIds(user.entityId, { approvalRequestId: b.approvalRequestId, departmentId: b.departmentId })
        : [];
      if (deciders.includes(Number(user.sub))) mine.push(b);
    }
    const reviewed = [];
    for (const b of mine.slice(0, MAX_REVIEWED)) reviewed.push(reviewOut(await batchReview.findingsFor(user, b.id, { money: false })));
    return {
      menunggu_keputusan_anda: mine.length,
      diperiksa: reviewed.length,
      batch: reviewed,
      catatan: mine.length ? note : 'Tidak ada batch Data Accurate yang menunggu keputusan Anda.',
      rute: '/data-accurate',
    };
  },
};

module.exports = [periksaBatch];
