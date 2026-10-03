// Approvals, delegations and signature requests of the asking user.
//
// Rules these tools keep:
//   - the agent never decides: every result carries the page (`rute`) where a
//     human approves, rejects or signs;
//   - "menunggu keputusan saya" is asked of the functions the decision itself
//     uses (approvalEngine.canDecide + the owning module's rule), so the list
//     is exactly what the user could decide on the module's page;
//   - a request of another division is visible only by the approvals page's
//     own rule (approvalVisibilitySql): own division, own request, or decider;
//   - no rupiah: the amount of a request and its free-text description (which
//     can carry an amount) are never returned — the module page shows them;
//   - never a signature image, a signed file, a hash or a verification code;
//   - private conversations only.
const approvals = require('../../../approvalRead.service');
const signatures = require('../../../signatureRead.service');
const { hasPerm, int } = require('./_shared');

const MAX_ROWS = 50;
const REQUEST_STATUS = {
  menunggu: 'pending', disetujui: 'approved', ditolak: 'rejected', perlu_revisi: 'revision_requested', dibatalkan: 'cancelled',
};
const REQUEST_STATUS_LABEL = Object.fromEntries(Object.entries(REQUEST_STATUS).map(([label, code]) => [code, label]));
const STEP_STATUS_LABEL = { pending: 'menunggu', approved: 'disetujui', rejected: 'ditolak', skipped: 'dilewati' };
const SIGN_STATUS = { menunggu: 'pending', disetujui: 'approved', ditolak: 'rejected', ditandatangani: 'signed', dibatalkan: 'cancelled' };
const SIGN_STATUS_LABEL = Object.fromEntries(Object.entries(SIGN_STATUS).map(([label, code]) => [code, label]));
const VIA_LABEL = { user: 'ditunjuk langsung', role: 'lewat peran Anda', delegation: 'delegasi', escalation: 'eskalasi' };
// The module whose page holds the request, in words.
const MODULE_LABEL = {
  warehouse_inbound: 'Warehouse — barang masuk',
  warehouse_outbound: 'Warehouse — barang keluar',
  sales_accurate_batch: 'Data Accurate',
  sales_accurate_sync: 'Data Accurate',
  ga_request: 'Layanan GA — permintaan',
  ga_request_other: 'Layanan GA — permintaan',
  ga_booking: 'Layanan GA — peminjaman',
  ga_vehicle_booking: 'Layanan GA — peminjaman kendaraan',
  finance_workflow: 'Finance — pengajuan pembayaran',
  finance_payment_request: 'Finance — pengajuan pembayaran',
  finance_reimbursement: 'Finance — reimbursement',
  hrga_workflow: 'People & Culture — onboarding/offboarding',
  hrga_onboarding: 'People & Culture — onboarding',
  hrga_offboarding: 'People & Culture — offboarding',
  document: 'Dokumen',
};
const NO_PAGE = 'Pengajuan ini tidak punya halaman sendiri di aplikasi; keputusannya diambil dari notifikasi atau dokumen terkait.';

const id = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const moduleOf = (row) => MODULE_LABEL[row.subjectType] || MODULE_LABEL[row.requestType] || row.requestType || row.subjectType || null;
const isPast = (v) => Boolean(v) && new Date(v).getTime() < Date.now();

const persetujuanMenunggu = {
  name: 'persetujuan_menunggu_saya',
  module: ['approvals', 'general'],
  label: 'Membaca persetujuan yang menunggu Anda',
  description: 'Pengajuan dari semua modul (Finance, Layanan GA, Warehouse, Data Accurate, People & Culture, dokumen) yang sedang menunggu keputusan pengguna ini: '
    + 'judul, modul, pengaju, divisi, sejak kapan, tenggat keputusan dan apakah sudah lewat, lewat jalur apa sampai ke dia (langsung, peran, delegasi, eskalasi), '
    + 'dan `rute` halaman modul tempat keputusan diambil. Yang terlama di atas. Pakai untuk "apa yang harus saya setujui". '
    + 'Prakasa AI tidak pernah memutuskan: pengguna sendiri yang menyetujui atau menolak di halaman itu. Tanpa nominal rupiah dan tanpa rincian isi pengajuan.',
  inputSchema: {
    type: 'object',
    properties: {
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal pengajuan (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'approval.view',
  privateOnly: true,
  async run(user, input = {}) {
    if (!hasPerm(user, 'approval.decide')) {
      return { total_menunggu: 0, pengajuan: [], catatan: 'Peran Anda tidak memutuskan persetujuan, jadi tidak ada yang menunggu keputusan Anda. Untuk pengajuan Anda sendiri, lihat status pengajuan.' };
    }
    const result = await approvals.pendingForUser(user, { limit: int(input.jumlah, { max: MAX_ROWS, fallback: 20 }) });
    const notes = [];
    if (result.total > result.items.length) notes.push(`Hanya ${result.items.length} dari ${result.total} pengajuan ditampilkan (yang terlama lebih dulu).`);
    if (!result.complete) notes.push('Daftar pengajuan sangat panjang; jumlah ini bisa belum lengkap.');
    if (result.items.some((item) => !item.page)) notes.push(NO_PAGE);
    return {
      total_menunggu: result.total,
      lewat_tenggat: result.items.filter((item) => isPast(item.deadlineAt)).length,
      pengajuan: result.items.map((item) => ({
        id: item.id,
        judul: item.title,
        modul: moduleOf(item),
        diajukan_oleh: item.requesterName,
        divisi: item.departmentName,
        diajukan_pada: iso(item.createdAt),
        tahap: item.level,
        tenggat_keputusan: iso(item.deadlineAt),
        lewat_tenggat: isPast(item.deadlineAt),
        jalur: VIA_LABEL[item.via] || null,
        rute: item.page,
      })),
      keputusan: 'Diambil oleh Anda di halaman modulnya (rute); Prakasa AI hanya membaca.',
      ...(notes.length ? { catatan: notes.join(' ') } : {}),
    };
  },
};

const stepOut = (s) => ({
  tahap: s.level,
  pemutus: s.approverUserName || s.approverRoleName || null,
  ...(s.delegatedFromUserName ? { didelegasikan_dari: s.delegatedFromUserName } : {}),
  ...(s.escalatedAt ? { dieskalasi_ke: s.escalatedToUserName || s.escalatedToRoleName || null, dieskalasi_pada: iso(s.escalatedAt) } : {}),
  opsional: Boolean(s.isOptional),
  status: STEP_STATUS_LABEL[s.status] || s.status,
  sedang_berjalan: s.status === 'pending' && Boolean(s.activatedAt),
  tenggat: iso(s.deadlineAt),
  diputuskan_oleh: s.decidedByName || null,
  diputuskan_pada: iso(s.decidedAt),
  catatan_pemutus: s.note || null,
});

const pengajuanSaya = {
  name: 'pengajuan_saya',
  module: ['approvals'],
  label: 'Membaca status pengajuan Anda',
  description: 'Status pengajuan persetujuan milik pengguna. Tanpa pengajuan_id: daftar pengajuan yang ia ajukan (judul, modul, status, sudah berapa tahap disetujui, sedang menunggu siapa) dan jumlah per status. '
    + 'Dengan pengajuan_id: riwayat lengkap satu pengajuan yang boleh ia lihat — setiap tahap, siapa pemutusnya, status, waktu keputusan, dan catatan pemutus (mis. alasan ditolak atau diminta revisi). '
    + 'Pakai untuk "pengajuan saya sudah sampai mana", "kenapa ditolak". '
    + 'Pengajuan divisi lain yang bukan urusannya dijawab "tidak ditemukan". Tanpa nominal rupiah dan tanpa rincian isi pengajuan.',
  inputSchema: {
    type: 'object',
    properties: {
      pengajuan_id: { type: 'integer', minimum: 1, description: 'Id pengajuan untuk riwayat lengkapnya' },
      status: { type: 'string', enum: Object.keys(REQUEST_STATUS), description: 'Saring daftar; kosong = semua' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal pengajuan (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'approval.view',
  privateOnly: true,
  async run(user, input = {}) {
    const requestId = id(input.pengajuan_id);
    if (requestId) {
      const request = await approvals.visibleRequest(user, requestId);
      if (!request) return { ditemukan: false, catatan: 'Pengajuan tidak ditemukan, atau bukan pengajuan yang boleh Anda lihat.' };
      return {
        ditemukan: true,
        id: Number(request.id),
        judul: request.title,
        modul: moduleOf(request),
        status: REQUEST_STATUS_LABEL[request.status] || request.status,
        milik_anda: Number(request.requestedBy) === Number(user.sub),
        diajukan_oleh: request.requesterName || null,
        divisi: request.departmentName || null,
        diajukan_pada: iso(request.createdAt),
        diputuskan_oleh: request.decidedByName || null,
        diputuskan_pada: iso(request.decidedAt),
        catatan_keputusan: request.decisionNote || null,
        tahap: request.steps.map(stepOut),
        rute: request.page,
        ...(request.page ? {} : { catatan: NO_PAGE }),
      };
    }
    const result = await approvals.requestsOf(user, {
      status: REQUEST_STATUS[input.status] || null,
      limit: int(input.jumlah, { max: MAX_ROWS, fallback: 20 }),
    });
    return {
      ringkasan: Object.fromEntries(Object.entries(REQUEST_STATUS).map(([label, code]) => [label, result.counts[code] || 0])),
      total_cocok: result.total,
      ditampilkan: result.rows.length,
      pengajuan: result.rows.map((r) => ({
        id: Number(r.id),
        judul: r.title,
        modul: moduleOf(r),
        status: REQUEST_STATUS_LABEL[r.status] || r.status,
        tahap_disetujui: Number(r.approvedSteps) || 0,
        total_tahap: Number(r.totalSteps) || 0,
        menunggu: r.status === 'pending' ? (r.waitingOn || null) : null,
        diajukan_pada: iso(r.createdAt),
        diputuskan_pada: iso(r.decidedAt),
        rute: r.page,
      })),
      ...(result.total > result.rows.length ? { catatan: `Hanya ${result.rows.length} dari ${result.total} pengajuan ditampilkan.` } : {}),
    };
  },
};

const delegasiSaya = {
  name: 'delegasi_persetujuan_saya',
  module: ['approval-delegations'],
  label: 'Membaca delegasi persetujuan Anda',
  description: 'Delegasi persetujuan yang melibatkan pengguna: yang ia berikan ke orang lain dan yang ia terima dari orang lain — siapa, berlaku dari kapan sampai kapan, untuk jenis pengajuan apa, alasannya, dan apakah sedang berlaku sekarang. '
    + 'Default hanya yang sedang atau akan berlaku. Pakai untuk "siapa yang menggantikan saya menyetujui", "saya sedang menerima delegasi dari siapa". '
    + 'Tidak pernah delegasi antara orang lain, dan Prakasa AI tidak membuat atau mencabut delegasi.',
  inputSchema: {
    type: 'object',
    properties: {
      termasuk_berakhir: { type: 'boolean', description: 'true = sertakan delegasi yang sudah berakhir atau dinonaktifkan' },
    },
    additionalProperties: false,
  },
  permission: 'approval_delegation.view',
  privateOnly: true,
  async run(user, input = {}) {
    const rows = await approvals.delegationsOf(user, { current: input.termasuk_berakhir !== true });
    const me = Number(user.sub);
    const out = (r) => ({
      dari: r.fromUserName,
      kepada: r.toUserName,
      berlaku_mulai: iso(r.startsAt),
      berlaku_sampai: iso(r.endsAt),
      untuk_jenis_pengajuan: r.requestType || 'semua jenis',
      ...(r.documentTypeName ? { untuk_jenis_dokumen: r.documentTypeName } : {}),
      alasan: r.reason || null,
      sedang_berlaku: Boolean(Number(r.inForce)),
      aktif: Boolean(Number(r.isActive)),
    });
    const given = rows.filter((r) => Number(r.fromUserId) === me);
    const received = rows.filter((r) => Number(r.toUserId) === me);
    return {
      saya_berikan: given.map(out),
      saya_terima: received.map(out),
      ...(rows.length ? {} : { catatan: 'Tidak ada delegasi persetujuan yang melibatkan Anda saat ini.' }),
    };
  },
};

const signOut = (r) => ({
  id: Number(r.id),
  dokumen: r.documentTitle,
  jenis_dokumen: r.documentType || null,
  jenis_tanda_tangan: r.signatureType || null,
  status: SIGN_STATUS_LABEL[r.status] || r.status,
  diminta_oleh: r.requesterName || null,
  penanda_tangan: r.signedByName || r.assignedSignerUserName || r.assignedSignerRoleName || null,
  diminta_pada: iso(r.createdAt),
  ditandatangani_pada: iso(r.signedAt),
  rute: `/signatures/${Number(r.id)}`,
});

const tandaTanganSaya = {
  name: 'tanda_tangan_saya',
  module: ['signatures'],
  label: 'Membaca permintaan tanda tangan Anda',
  description: 'Permintaan tanda tangan dokumen: yang sedang menunggu tanda tangan pengguna (ditunjuk langsung atau lewat perannya, dengan keterangan apakah persetujuannya sudah selesai sehingga siap ditandatangani) '
    + 'dan permintaan yang ia ajukan beserta statusnya (menunggu, ditandatangani, ditolak, dibatalkan, oleh siapa, kapan). `rute` membuka halaman tanda tangannya. '
    + 'Pakai untuk "dokumen apa yang harus saya tanda tangani", "permintaan tanda tangan saya sudah ditandatangani belum". '
    + 'Prakasa AI tidak pernah menandatangani. Tidak pernah gambar tanda tangan, isi dokumen, atau kode verifikasi.',
  inputSchema: {
    type: 'object',
    properties: {
      bagian: { type: 'string', enum: ['semua', 'menunggu_saya', 'permintaan_saya'], description: 'Default semua' },
      status: { type: 'string', enum: Object.keys(SIGN_STATUS), description: 'Saring permintaan_saya; kosong = semua' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal per bagian (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'signature.view',
  privateOnly: true,
  async run(user, input = {}) {
    const part = ['menunggu_saya', 'permintaan_saya'].includes(input.bagian) ? input.bagian : 'semua';
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 20 });
    const out = {};
    if (part !== 'permintaan_saya') {
      const waiting = await signatures.waitingFor(user, { limit });
      out.menunggu_saya = {
        total: waiting.total,
        permintaan: waiting.rows.map((r) => ({
          ...signOut(r),
          siap_ditandatangani: !r.approvalRequestId || r.approvalStatus === 'approved',
          ...(r.approvalRequestId && r.approvalStatus !== 'approved' ? { menunggu_persetujuan: REQUEST_STATUS_LABEL[r.approvalStatus] || r.approvalStatus || null } : {}),
        })),
      };
      if (!hasPerm(user, 'signature.sign')) out.catatan = 'Peran Anda tidak punya hak menandatangani dokumen.';
    }
    if (part !== 'menunggu_saya') {
      const mine = await signatures.requestedBy(user, { status: SIGN_STATUS[input.status] || null, limit });
      out.permintaan_saya = { total: mine.total, permintaan: mine.rows.map(signOut) };
    }
    return out;
  },
};

module.exports = [persetujuanMenunggu, pengajuanSaya, delegasiSaya, tandaTanganSaya];
