// Finance for Prakasa AI: pengajuan pembayaran & reimbursement
// (/finance/payment-requests), Piutang (/finance/receivables) and Utang
// (/finance/payables), through the module's own services.
//
//   - payment requests: financeRequests.service decides who reads what, exactly
//     as on the page (own; a division Head their division's; Finance and the
//     Management Office all; an approver the request waiting for them);
//   - a payee's bank name, account number and account holder are NEVER copied
//     into a result — for anyone (an employee's is not even stored: KantorKu);
//   - piutang/utang: approved Accurate data only, behind finance.receivable.view /
//     finance.payable.view; purchase invoices as owed, never unit purchase prices,
//     payment terms or margin;
//   - no general ledger, journals, balances or tax data: the app never
//     duplicates the books (docs/deployment.md §10);
//   - every tool carries rupiah, so every tool is `money` and private-only.
const requests = require('../../../financeRequests.service');
const receivables = require('../../../financeReceivables.service');
const payables = require('../../../financePayables.service');
const { OPENING_BALANCE_DATE } = require('../../../invoiceRules');
const { hasPerm, text, int } = require('./_shared');

const REQUEST_PAGE = ['finance.request', 'finance.view'];
const REQUEST_ROUTE = '/finance/payment-requests';
const RECEIVABLE_ROUTE = '/finance/receivables';
const PAYABLE_ROUTE = '/finance/payables';

const TYPE_LABELS = Object.freeze({ payment_request: 'Pengajuan pembayaran', reimbursement: 'Reimbursement' });
const TYPE_INPUT = Object.freeze({ pembayaran: 'payment_request', reimbursement: 'reimbursement' });
const STATUS_LABELS = Object.freeze({
  draft: 'Draf (belum diajukan)',
  pending_document_check: 'Menunggu cek dokumen',
  pending_approval: 'Menunggu persetujuan',
  approved: 'Disetujui, menunggu diproses Finance',
  rejected: 'Ditolak',
  revision_requested: 'Diminta revisi',
  processing: 'Sedang diproses Finance',
  paid: 'Sudah dibayar',
  cancelled: 'Dibatalkan',
});
const STATUS_INPUT = Object.freeze({
  draf: 'draft', menunggu_persetujuan: 'pending_approval', disetujui: 'approved', ditolak: 'rejected',
  diminta_revisi: 'revision_requested', diproses: 'processing', dibayar: 'paid', dibatalkan: 'cancelled',
});
const STEP_LABELS = Object.freeze({
  pending: 'Menunggu keputusan', waiting: 'Belum giliran', approved: 'Disetujui', rejected: 'Ditolak',
  revision_requested: 'Diminta revisi', skipped: 'Dilewati', cancelled: 'Dibatalkan',
});
const ATTACHMENT_LABELS = Object.freeze({
  invoice: 'Invoice', receipt: 'Kuitansi/nota', quotation: 'Penawaran harga', po: 'PO',
  bank_proof: 'Bukti transfer', tax_doc: 'Dokumen pajak', other: 'Lainnya',
});

const schema = (properties = {}) => ({ type: 'object', properties, additionalProperties: false });
const NO_ACCOUNT = 'Tidak pernah nama bank, nomor rekening, atau nama pemilik rekening penerima; tanpa jurnal, buku besar, dan data pajak.';

// One request as the list shows it. Explicit fields: the payee's bank details
// of the service's DTO are never copied.
const requestRow = (r) => ({
  id: r.id,
  nomor: r.requestNumber,
  jenis: TYPE_LABELS[r.workflowType] || r.workflowType,
  judul: r.title,
  kategori: r.category,
  status: STATUS_LABELS[r.status] || r.status,
  total_rupiah: r.totalAmount,
  tanggal_pengajuan: r.requestDate,
  diminta_dibayar_tanggal: r.requestedPaymentDate,
  jatuh_tempo: r.dueDate,
  pengaju: r.requesterName,
  divisi: r.departmentName,
  penerima: r.payeeName,
  dibayar_pada: r.paidAt,
  nomor_bukti_accurate: r.accurateReference,
  rute: `${REQUEST_ROUTE}/${r.id}`,
});

const listInputs = {
  status: { type: 'string', enum: Object.keys(STATUS_INPUT), description: 'Saring menurut status' },
  jenis: { type: 'string', enum: Object.keys(TYPE_INPUT), description: 'pembayaran = ke pemasok/pihak lain; reimbursement = penggantian ke karyawan' },
  cari: { type: 'string', maxLength: 100, description: 'Nomor pengajuan, judul, penerima, atau kategori' },
  jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal pengajuan (default 20)' },
};

async function readList(user, input, { mine }) {
  const limit = int(input.jumlah, { max: 50, fallback: 20 });
  const out = await requests.list(user, {
    limit,
    ...(mine ? { mine: '1' } : {}),
    ...(STATUS_INPUT[input.status] ? { status: STATUS_INPUT[input.status] } : {}),
    ...(TYPE_INPUT[input.jenis] ? { workflowType: TYPE_INPUT[input.jenis] } : {}),
    ...(text(input.cari, 100) ? { q: text(input.cari, 100) } : {}),
  });
  return { rute: REQUEST_ROUTE, total: out.meta.total, pengajuan: out.rows.map(requestRow) };
}

const mine = {
  name: 'pengajuan_pembayaran_saya',
  module: 'finance',
  label: 'Membaca pengajuan pembayaran Anda',
  description: 'Pengajuan pembayaran dan reimbursement yang DIAJUKAN OLEH pengguna ini sendiri, terbaru dulu: nomor, judul, jenis, status (draf, menunggu persetujuan, diminta revisi, disetujui, diproses, dibayar, ditolak, dibatalkan), '
    + 'total, tanggal, penerima, kapan dibayar dan nomor bukti Accurate. Pakai untuk "pengajuan saya sudah sampai mana", "reimbursement saya sudah dibayar belum". '
    + `Hanya milik pengguna itu sendiri, tidak pernah pengajuan orang lain. ${NO_ACCOUNT}`,
  inputSchema: schema(listInputs),
  permission: REQUEST_PAGE,
  privateOnly: true,
  money: true,
  run: (user, input = {}) => readList(user, input, { mine: true }),
};

const list = {
  name: 'daftar_pengajuan_pembayaran',
  module: 'finance',
  label: 'Membaca daftar pengajuan pembayaran',
  description: 'Pengajuan pembayaran dan reimbursement yang boleh dilihat pengguna ini, persis seperti halaman Pengajuan pembayaran: Finance dan Management Office melihat semua, Head divisi melihat divisinya, '
    + 'selain itu hanya miliknya sendiri. Bisa disaring status, jenis, atau kata kunci. Isi per pengajuan: nomor, judul, jenis, status, total, tanggal, pengaju, divisi, penerima. '
    + `Pakai untuk "pengajuan divisi saya yang belum dibayar", "apa saja yang masih menunggu persetujuan". ${NO_ACCOUNT}`,
  inputSchema: schema(listInputs),
  permission: REQUEST_PAGE,
  privateOnly: true,
  money: true,
  run: (user, input = {}) => readList(user, input, { mine: false }),
};

const actions = {
  name: 'pengajuan_pembayaran_perlu_tindakan',
  module: 'finance',
  label: 'Membaca pengajuan pembayaran yang perlu ditindak',
  description: 'Pengajuan pembayaran yang menunggu tindakan pengguna ini: (1) menunggu KEPUTUSAN-nya sebagai approver yang sedang bergiliran, (2) untuk Finance: yang sudah disetujui dan siap diproses/dibayar serta yang sedang diproses, '
    + '(3) pengajuan miliknya sendiri yang diminta revisi. Pakai untuk "apa yang harus saya putuskan", "apa yang siap dibayar hari ini". Agen hanya membaca: keputusan dan pembayaran tetap dilakukan orangnya di halaman. '
    + NO_ACCOUNT,
  inputSchema: schema({ jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal pengajuan per bagian (default 20)' } }),
  permission: REQUEST_PAGE,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const limit = int(input.jumlah, { max: 50, fallback: 20 });
    const decide = await requests.awaitingMyDecision(user, { limit });
    const revise = await requests.list(user, { mine: '1', status: 'revision_requested', limit });
    const out = {
      rute: REQUEST_ROUTE,
      menunggu_keputusan_saya: { total: decide.total, pengajuan: decide.rows.map(requestRow) },
      milik_saya_diminta_revisi: { total: revise.meta.total, pengajuan: revise.rows.map(requestRow) },
    };
    // Paying is Finance's step (finance.process), as on the page.
    if (hasPerm(user, 'finance.process')) {
      const approved = await requests.list(user, { status: 'approved', limit });
      const processing = await requests.list(user, { status: 'processing', limit });
      out.siap_dibayar = { total: approved.meta.total, pengajuan: approved.rows.map(requestRow) };
      out.sedang_diproses = { total: processing.meta.total, pengajuan: processing.rows.map(requestRow) };
    } else {
      out.catatan = 'Bagian "siap dibayar" hanya untuk Finance yang memproses pembayaran.';
    }
    return out;
  },
};

const detail = {
  name: 'detail_pengajuan_pembayaran',
  module: 'finance',
  label: 'Membaca detail pengajuan pembayaran',
  description: 'Satu pengajuan pembayaran atau reimbursement (isi id atau nomor, mis. PR-2026-0012) yang boleh dilihat pengguna ini: isi pengajuan, subtotal, pajak dan total, status, langkah persetujuan (siapa yang memutuskan, statusnya, catatannya), '
    + 'lampiran yang sudah ada dan lampiran wajib yang belum ada, hasil cek dokumen, dan apa yang bisa dilakukan pengguna di halaman. Pakai untuk "pengajuan ini menunggu siapa", "kenapa ditolak", "dokumen apa yang kurang". '
    + NO_ACCOUNT,
  inputSchema: schema({
    id: { type: 'integer', minimum: 1, description: 'Id pengajuan (dari daftar)' },
    nomor: { type: 'string', maxLength: 60, description: 'Nomor pengajuan, bila id tidak diketahui' },
  }),
  permission: REQUEST_PAGE,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    let id = Number.isInteger(input.id) && input.id > 0 ? input.id : null;
    const number = text(input.nomor, 60);
    if (!id && number) {
      const found = await requests.list(user, { q: number, limit: 20 });
      const hit = found.rows.find((r) => String(r.requestNumber).toLowerCase() === number.toLowerCase());
      id = hit ? hit.id : null;
    }
    const missing = { ditemukan: false, catatan: 'Pengajuan tidak ditemukan atau bukan untuk Anda.' };
    if (!id) return number ? missing : { ditemukan: false, catatan: 'Isi id atau nomor pengajuan.' };
    let r;
    try {
      r = await requests.get(user, id);
    } catch (e) {
      if (e instanceof requests.FinanceError && e.status === 404) return missing;
      throw e;
    }
    const uploaded = new Set(r.attachments.map((a) => a.attachmentType));
    const can = r.can || {};
    return {
      ditemukan: true,
      pengajuan: {
        ...requestRow(r),
        keterangan: r.description,
        subtotal_rupiah: r.amount,
        pajak_rupiah: r.taxAmount,
        catatan_pengajuan: r.notes,
        cek_dokumen: r.documentCheckSummary || (r.documentCheckStatus === 'not_run' ? 'Belum dijalankan' : r.documentCheckStatus),
        diproses_oleh: r.financePicName,
        dibayar_oleh: r.paidByName,
      },
      langkah_persetujuan: r.approvalSteps.map((s) => ({
        urutan: s.order,
        pemutus: s.approverName,
        status: s.status === 'pending' && !s.activatedAt ? STEP_LABELS.waiting : (STEP_LABELS[s.status] || s.status),
        diputuskan_oleh: s.decidedByName,
        diputuskan_pada: s.decidedAt,
        catatan: s.note,
      })),
      lampiran: r.attachments.map((a) => ({ jenis: ATTACHMENT_LABELS[a.attachmentType] || a.attachmentType, nama_file: a.name, diunggah_oleh: a.uploadedByName })),
      lampiran_wajib_belum_ada: r.requiredAttachments.filter((type) => !uploaded.has(type)).map((type) => ATTACHMENT_LABELS[type] || type),
      yang_bisa_anda_lakukan_di_halaman: [
        can.edit && 'melengkapi/merevisi isian', can.submit && 'mengajukan ke persetujuan', can.decide && 'memutuskan (setuju/tolak/minta revisi)',
        can.process && 'menandai sedang diproses', can.markPaid && 'menandai sudah dibayar', can.cancel && 'membatalkan',
      ].filter(Boolean),
    };
  },
};

// ---------------------------------------------------------------- piutang / utang

const bucketRow = (b) => ({ umur: b.label, jumlah_faktur: b.invoices, sisa_rupiah: b.amount, porsi_persen: b.share });
const REPORT_LIMIT = { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal baris daftar (default 10)' };

const piutang = {
  name: 'ringkasan_piutang',
  module: 'finance-receivables',
  label: 'Membaca ringkasan piutang',
  description: 'Laporan Piutang Finance dari faktur penjualan Accurate yang sudah disetujui (seluruh perusahaan): total piutang, yang lewat jatuh tempo, yang lewat 90 hari, yang jatuh tempo 14 hari ke depan, penerimaan bulan ini, perkiraan DSO, '
    + 'umur piutang (belum jatuh tempo, 1–30, 31–60, 61–90, >90 hari) total dan per channel, dan satu daftar: customer dengan tunggakan terbesar (default) atau faktur yang segera jatuh tempo. '
    + 'Menyebut juga apa yang tidak dihitung (faktur uang muka) dan bahwa saldo awal Accurate tetap terhitung sebagai piutang. '
    + 'Tidak pernah jurnal, buku besar, saldo akun, data pajak, rekening, alamat, atau kontak customer.',
  inputSchema: schema({
    daftar: { type: 'string', enum: ['customer_terlambat', 'segera_jatuh_tempo'], description: 'Daftar yang disertakan (default customer_terlambat)' },
    jumlah: REPORT_LIMIT,
  }),
  permission: 'finance.receivable.view',
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const out = await receivables.overview(user.entityId);
    if (!out.ready) return { tersedia: false, rute: RECEIVABLE_ROUTE, catatan: `Data Accurate menunggu persetujuan. ${out.reason}` };
    const limit = int(input.jumlah, { max: 50, fallback: 10 });
    const s = out.summary;
    const soon = input.daftar === 'segera_jatuh_tempo';
    return {
      tersedia: true,
      sumber: 'Accurate, hanya dibaca, setelah disetujui Supervisor/Head Sales atau Retail Commerce',
      data_disetujui_terakhir: out.asOf,
      rute: RECEIVABLE_ROUTE,
      ringkasan: {
        total_piutang: s.outstanding,
        jumlah_faktur_terbuka: s.invoices,
        jumlah_customer: s.customers,
        piutang_lewat_jatuh_tempo: s.overdue.amount,
        faktur_lewat_jatuh_tempo: s.overdue.invoices,
        piutang_lewat_90_hari: s.over90.amount,
        faktur_lewat_90_hari: s.over90.invoices,
        piutang_jatuh_tempo_14_hari: s.dueSoon.amount,
        faktur_jatuh_tempo_14_hari: s.dueSoon.invoices,
        penerimaan_bulan_ini_rupiah: s.collectedThisMonth.amount,
        jumlah_penerimaan_bulan_ini: s.collectedThisMonth.receipts,
        perkiraan_dso_hari: s.dso.days,
      },
      umur_piutang: out.aging.buckets.map(bucketRow),
      umur_piutang_per_channel: out.aging.channels.map((c) => ({
        channel: c.channel, total_piutang: c.total.amount, jumlah_faktur: c.total.invoices, umur: c.buckets.filter((b) => b.invoices).map(bucketRow),
      })),
      ...(soon
        ? {
          faktur_segera_jatuh_tempo: out.dueSoon.slice(0, limit).map((r) => ({
            nomor_faktur: r.invoiceNumber, tanggal_faktur: r.date, jatuh_tempo: r.dueDate, hari_lagi: r.daysLeft,
            kode_customer: r.customerCode, customer: r.customerName, channel: r.channel, total_faktur_rupiah: r.total, sisa_piutang: r.outstanding,
          })),
        }
        : {
          customer_tunggakan_terbesar: out.customers.slice(0, limit).map((r) => ({
            kode_customer: r.customerCode, customer: r.customerName, channel: r.channel,
            piutang_lewat_jatuh_tempo: r.overdueAmount, faktur_lewat_jatuh_tempo: r.overdueInvoices,
            total_piutang: r.outstanding, jumlah_faktur_terbuka: r.invoices, terlambat_paling_lama_hari: r.oldestDays, jatuh_tempo_tertua: r.oldestDue,
            ...(r.customerId ? { rute: `/sales/customers/${r.customerId}` } : {}),
          })),
        }),
      tidak_dihitung: {
        faktur_uang_muka_terbuka: s.downPaymentsOpen,
        penjelasan: 'Faktur uang muka (DP) tidak pernah dihitung sebagai piutang atau tunggakan; jumlahnya hanya disebut terpisah.',
      },
      catatan: `Piutang = sisa faktur termasuk PPN, seperti di Accurate. Saldo awal Accurate (faktur bertanggal sampai ${OPENING_BALANCE_DATE} tanpa baris produk) TETAP terhitung sebagai piutang karena masih ditagih, tetapi bukan revenue. `
        + 'DSO = piutang sekarang ÷ penagihan 90 hari terakhir × 90 (perkiraan). Ini bukan laporan keuangan: buku, jurnal dan pajak ada di Accurate.',
    };
  },
};

const INVOICE_LISTS = Object.freeze(['faktur_terlambat', 'pemasok_terbesar', 'segera_jatuh_tempo']);
const purchaseInvoice = (r, daysKey) => ({
  nomor_faktur: r.invoiceNumber, tanggal_faktur: r.date, jatuh_tempo: r.dueDate, [daysKey]: r.days,
  kode_pemasok: r.vendorNo, pemasok: r.vendorName, total_faktur_rupiah: r.total, sisa_utang: r.outstanding,
});

const utang = {
  name: 'ringkasan_utang',
  module: 'finance-payables',
  label: 'Membaca ringkasan utang',
  description: 'Laporan Utang Finance dari faktur dan pembayaran pembelian Accurate yang sudah disetujui Supervisor/Head Finance: total utang rupiah, yang lewat jatuh tempo, yang lewat 90 hari, yang jatuh tempo 14 hari ke depan, pembayaran bulan ini, '
    + 'umur utang (belum jatuh tempo, 1–30, 31–60, 61–90, >90 hari), dan satu daftar: faktur terlambat paling lama (default), pemasok dengan utang terbesar, atau faktur yang segera jatuh tempo. '
    + 'Menyebut juga apa yang tidak dihitung (faktur uang muka, faktur mata uang asing). '
    + 'Tidak pernah harga beli per barang, margin, syarat bayar, rekening atau kontak pemasok, jurnal, buku besar, atau data pajak.',
  inputSchema: schema({
    daftar: { type: 'string', enum: [...INVOICE_LISTS], description: 'Daftar yang disertakan (default faktur_terlambat)' },
    jumlah: REPORT_LIMIT,
  }),
  permission: 'finance.payable.view',
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const out = await payables.overview(user.entityId);
    if (!out.ready) {
      return {
        tersedia: false,
        rute: PAYABLE_ROUTE,
        catatan: `Data Accurate menunggu persetujuan. ${out.reason}.${out.pending ? ' Ada satu tarikan yang sedang menunggu keputusan.' : ''}`,
      };
    }
    const limit = int(input.jumlah, { max: 50, fallback: 10 });
    const s = out.summary;
    const which = INVOICE_LISTS.includes(input.daftar) ? input.daftar : 'faktur_terlambat';
    const lists = {
      faktur_terlambat: () => ({ faktur_terlambat: out.overdue.slice(0, limit).map((r) => purchaseInvoice(r, 'terlambat_hari')) }),
      segera_jatuh_tempo: () => ({ faktur_segera_jatuh_tempo: out.dueSoon.slice(0, limit).map((r) => purchaseInvoice(r, 'hari_lagi')) }),
      pemasok_terbesar: () => ({
        pemasok_utang_terbesar: out.vendors.slice(0, limit).map((r) => ({
          kode_pemasok: r.vendorNo, pemasok: r.vendorName, total_utang: r.outstanding, jumlah_faktur_terbuka: r.invoices,
          utang_lewat_jatuh_tempo: r.overdueAmount, faktur_lewat_jatuh_tempo: r.overdueInvoices,
          terlambat_paling_lama_hari: r.oldestDays, jatuh_tempo_berikutnya: r.nextDue,
        })),
      }),
    };
    return {
      tersedia: true,
      sumber: 'Accurate, hanya dibaca, setelah disetujui Supervisor/Head Finance',
      data_disetujui_terakhir: out.asOf ? out.asOf.approvedAt : null,
      disetujui_oleh: out.asOf ? out.asOf.approvedBy : null,
      rute: PAYABLE_ROUTE,
      ringkasan: {
        total_utang: s.outstanding,
        jumlah_faktur_terbuka: s.invoices,
        jumlah_pemasok: s.vendors,
        utang_lewat_jatuh_tempo: s.overdue.amount,
        faktur_lewat_jatuh_tempo: s.overdue.invoices,
        utang_lewat_90_hari: s.over90.amount,
        faktur_lewat_90_hari: s.over90.invoices,
        utang_jatuh_tempo_14_hari: s.dueSoon.amount,
        faktur_jatuh_tempo_14_hari: s.dueSoon.invoices,
        dibayar_bulan_ini_rupiah: s.paidThisMonth.amount,
        jumlah_bayar_bulan_ini: s.paidThisMonth.payments,
      },
      umur_utang: out.aging.buckets.map(bucketRow),
      ...lists[which](),
      tidak_dihitung: {
        faktur_uang_muka_terbuka: s.downPaymentsOpen,
        faktur_mata_uang_asing_terbuka: s.nonIdrOpen,
        penjelasan: 'Faktur uang muka (DP) tidak dihitung sebagai utang; faktur selain rupiah dihitung jumlahnya saja, tidak pernah dijumlahkan ke rupiah.',
      },
      catatan: 'Utang = sisa faktur pembelian termasuk PPN, seperti di Accurate. Ini bukan laporan keuangan: buku, jurnal dan pajak ada di Accurate.',
    };
  },
};

module.exports = [mine, list, actions, detail, piutang, utang];
