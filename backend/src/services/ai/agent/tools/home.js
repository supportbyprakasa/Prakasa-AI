// Beranda and Pencarian (Wave B). The home tool answers "apa yang perlu saya
// kerjakan hari ini" with the caller's OWN work only: the cards of the home
// page (controllers/workSummary.controller.js build — each source gated by the
// same permission as its page), their notifications, and two parts read through
// the SAME service calls as the tools that answer the same question, so the
// answers cannot differ:
//   tasks      task.service listTasksForUser({ mine: true })  = tugas_saya (tools/work.js)
//   approvals  approvalRead.service pendingForUser            = persetujuan_menunggu_saya (tools/approvals.js)
// The search tool is the page's search (services/globalSearch.service.js): only
// the record types the user may open, with each module's division/own-data rule.
// Neither returns rupiah: an amount inside a text is taken out.
const workSummaryPage = require('../../../../controllers/workSummary.controller');
const tasks = require('../../../task.service');
const approvalRead = require('../../../approvalRead.service');
const globalSearch = require('../../../globalSearch.service');
const morningBriefing = require('../../../morningBriefing.service');
const { todayWib } = require('../../../../utils/wibTime');
const { text, int, hasPerm } = require('./_shared');

const MONEY_TEXT = /\b(?:Rp|IDR)\.?\s*-?\d[\d.,]*(?:\s*(?:rb|ribu|jt|juta|m|miliar|t|triliun)\b)?/gi;
const NO_MONEY = '(nilai rupiah tidak ditampilkan)';
// A text as stored, with any rupiah amount taken out (these tools carry no money).
const plain = (value) => (typeof value === 'string' && value.trim() ? value.replace(MONEY_TEXT, NO_MONEY).trim() : null);
const route = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null);
const day = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
};

const GROUP = { action: 'perlu_ditindak', mine: 'milik_saya_berjalan', team: 'antrean_tim' };
const PRIORITY = { urgent: 'mendesak', high: 'tinggi', normal: 'normal', low: 'rendah' };
const iso = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const REQUEST_TYPE = {
  sales_accurate_sync: 'Data Accurate Sales',
  sales_accurate_batch: 'Data Accurate Sales',
  warehouse_inbound: 'Barang masuk',
  warehouse_outbound: 'Barang keluar',
  finance_payment_request: 'Pengajuan pembayaran',
  finance_reimbursement: 'Reimbursement',
  finance_workflow: 'Pengajuan pembayaran',
  ga_request_other: 'Permintaan GA',
  ga_request: 'Permintaan GA',
  ga_vehicle_booking: 'Peminjaman kendaraan',
  ga_booking: 'Peminjaman GA',
  hrga_onboarding: 'Onboarding',
  hrga_offboarding: 'Offboarding',
  hrga_workflow: 'Onboarding/offboarding',
  document_approval: 'Persetujuan dokumen',
};

const SEARCH_TYPES = {
  dokumen: 'document',
  tugas: 'task',
  customer: 'customer',
  sales_order: 'sales_order',
  perangkat: 'device',
  langganan: 'subscription',
  pengajuan_pembayaran: 'finance_workflow',
  onboarding_offboarding: 'hrga_workflow',
  persetujuan: 'approval_request',
  tanda_tangan: 'signature_request',
};
const SEARCH_LABEL = Object.fromEntries(Object.entries(SEARCH_TYPES).map(([label, type]) => [type, label]));

function cardOut(card, perCard) {
  return {
    judul: card.title,
    jumlah: card.count,
    rute: route(card.to),
    contoh: (card.items || []).slice(0, perCard).map((item) => ({
      judul: plain(item.title),
      keterangan: plain(item.meta),
      waktu: item.at || null,
      rute: route(item.to),
    })),
  };
}

const BRIEFING_SEVERITY = { danger: 'mendesak', warning: 'perlu perhatian', info: 'informasi' };
const BRIEFING_GROUP = { action: 'perlu_ditindak', attention: 'perlu_diperhatikan', upcoming: 'akan_datang' };
// The home page's "Ringkasan pagi", row for row: same ids, counts and order.
function briefingOut(briefing) {
  return {
    judul: briefing.headline.text,
    jumlah_perlu_ditindak: briefing.headline.total,
    semua_beres: briefing.allClear,
    butir: briefing.items.map((item) => ({
      id: item.key,
      nama: item.label,
      jumlah: item.count,
      tingkat: BRIEFING_SEVERITY[item.severity] || item.severity,
      kelompok: BRIEFING_GROUP[item.group] || item.group,
      ...(item.ageHours != null ? { menunggu_jam: item.ageHours } : {}),
      contoh: item.examples.map((e) => e.title),
      rute: route(item.route),
    })),
    ...(briefing.tertunda.length ? { belum_sempat_dimuat: briefing.tertunda } : {}),
    ...(briefing.gagal.length ? { gagal_dibaca: briefing.gagal } : {}),
    keterangan: 'Sama dengan kartu "Ringkasan pagi" di Beranda. Angka modul mengikuti izin dan divisi Anda; tanpa nilai rupiah.',
  };
}

module.exports = [
  {
    name: 'pekerjaan_saya_hari_ini',
    module: ['dashboard'],
    label: 'Membaca pekerjaan Anda hari ini',
    description: 'Ringkasan kerja pengguna yang bertanya, sama seperti halaman Beranda: hal yang perlu ia tindak (persetujuan, tanda tangan, tiket, '
      + 'pengajuan yang perlu dilengkapi), pekerjaannya yang masih berjalan, antrean tim yang ia proses, tugas yang ditugaskan kepadanya atau ia laporkan '
      + '(aktif, terlambat, jatuh tempo 7 hari ke depan), pengajuan yang menunggu keputusannya, notifikasi terbaru, dan ringkasan_pagi: '
      + 'daftar berprioritas yang sama dengan kartu "Ringkasan pagi" di Beranda (yang perlu ditindak hari ini, lalu angka modul sesuai perannya: Sales, Warehouse, '
      + 'Procurement, piutang, GA, IT, eskalasi, target, batch Data Accurate yang menunggu keputusannya). '
      + 'Pakai untuk "apa yang perlu saya kerjakan hari ini" atau "apa yang menunggu saya". Setiap bagian hanya muncul bila pengguna punya izin halamannya. '
      + 'Hanya milik pengguna itu sendiri: tidak pernah pekerjaan orang lain, tanpa nilai rupiah, tanpa data pribadi.',
    inputSchema: {
      type: 'object',
      properties: {
        jumlah: { type: 'integer', minimum: 1, maximum: 25, description: 'Maksimal baris per daftar tugas/persetujuan (default 10)' },
      },
      additionalProperties: false,
    },
    // The home page has no permission of its own; every employee holds
    // notification.view (COMMON_MEMBER), and each section re-checks its page's permission.
    permission: 'notification.view',
    privateOnly: true,
    async run(user, input = {}) {
      const limit = int(input.jumlah, { min: 1, max: 25, fallback: 10 });
      const incomplete = [];
      const page = await workSummaryPage.build(user);
      // The same calls, with the same scope, as tugas_saya and persetujuan_menunggu_saya.
      const [mine, waiting] = await Promise.all([
        hasPerm(user, 'task.view')
          ? tasks.listTasksForUser({ user, filters: { mine: true, state: 'open', limit } }).catch(() => { incomplete.push('tugas'); return null; })
          : null,
        hasPerm(user, 'approval.view') && hasPerm(user, 'approval.decide')
          ? approvalRead.pendingForUser(user, { limit }).catch(() => { incomplete.push('persetujuan'); return null; })
          : null,
      ]);
      const groups = { perlu_ditindak: [], milik_saya_berjalan: [], antrean_tim: [] };
      for (const card of page.cards || []) (groups[GROUP[card.group]] || groups.perlu_ditindak).push(cardOut(card, 3));
      const out = {
        tanggal: todayWib(),
        cakupan: 'hanya pekerjaan Anda sendiri',
        ...groups,
      };
      if (mine) {
        const me = Number(user.sub);
        out.tugas_saya = {
          cakupan: 'tugas yang ditugaskan ke Anda atau Anda laporkan',
          aktif: mine.counts.open,
          terlambat: mine.counts.overdue,
          jatuh_tempo_7_hari: mine.counts.dueSoon,
          rute: '/tasks',
          daftar: mine.rows.map((t) => ({
            id: Number(t.id),
            judul: plain(t.title),
            papan: t.boardName || null,
            prioritas: PRIORITY[t.priority] || t.priority,
            tenggat: day(t.dueDate),
            terlambat_hari: Number(t.daysLate) > 0 ? Number(t.daysLate) : 0,
            peran_anda: Number(t.assigneeId) === me ? 'penanggung jawab' : (Number(t.reporterId) === me ? 'pelapor' : null),
            progres_persen: Number(t.progressPercent) || 0,
            rute: `/tasks/${Number(t.id)}`,
          })),
        };
      }
      if (waiting) {
        out.persetujuan_menunggu_saya = {
          total_menunggu: waiting.total,
          daftar: waiting.items.map((a) => ({
            id: a.id,
            judul: plain(a.title),
            jenis: REQUEST_TYPE[a.requestType] || a.requestType,
            diajukan_oleh: a.requesterName,
            divisi: a.departmentName,
            diajukan_pada: iso(a.createdAt),
            tenggat_keputusan: iso(a.deadlineAt),
            // The module page where the user decides; null when the request has none.
            rute: route(a.page),
          })),
          keputusan: 'Diambil oleh Anda di halaman modulnya (rute); Prakasa AI hanya membaca.',
        };
      }
      out.notifikasi = {
        belum_dibaca: Number(page.notifications?.unread) || 0,
        rute: '/notifications',
        terbaru: (page.notifications?.recent || []).map((n) => ({
          judul: plain(n.title), sudah_dibaca: Boolean(n.isRead), waktu: n.at, rute: route(n.to),
        })),
      };
      // "Ringkasan pagi": the very answer the card on the home page shows
      // (services/morningBriefing.service.js build — the same cached value), so
      // "apa yang perlu saya kerjakan hari ini?" and the card cannot differ.
      const briefing = await morningBriefing.build(user).catch(() => { incomplete.push('ringkasan pagi'); return null; });
      if (briefing) out.ringkasan_pagi = briefingOut(briefing);
      const notes = [];
      if (incomplete.length) notes.push(`Bagian ${incomplete.join(' dan ')} gagal dibaca; coba lagi.`);
      if (waiting && !waiting.complete) notes.push('Daftar pengajuan sangat panjang; jumlah yang menunggu keputusan Anda bisa belum lengkap.');
      if (notes.length) out.catatan = notes.join(' ');
      return out;
    },
  },
  {
    name: 'pencarian_global',
    module: ['search'],
    label: 'Mencari di Prakasa Workspace',
    description: 'Pencarian di semua modul yang boleh dibuka pengguna, sama seperti halaman Pencarian: dokumen, tugas, customer, sales order '
      + '(nomor SO, surat jalan, faktur), perangkat, langganan, pengajuan pembayaran, onboarding/offboarding, persetujuan, dan tanda tangan. '
      + 'Memberi jenis, judul, status, tanggal, dan rute untuk membukanya. Pakai saat pengguna menyebut nama atau nomor tanpa menyebut modulnya. '
      + 'Hanya jenis yang diizinkan untuk pengguna dan sesuai batas divisinya (anggota Sales hanya customer/SO miliknya). '
      + 'Tidak pernah isi dokumen, nilai rupiah, kontak, atau alamat.',
    inputSchema: {
      type: 'object',
      properties: {
        kata_kunci: { type: 'string', minLength: 2, maxLength: 200, description: 'Nama, judul, atau nomor yang dicari (minimal 2 karakter)' },
        jenis: { type: 'string', enum: Object.keys(SEARCH_TYPES), description: 'Batasi ke satu jenis record' },
        jumlah: { type: 'integer', minimum: 1, maximum: 25, description: 'Maksimal hasil (default 10)' },
      },
      required: ['kata_kunci'],
      additionalProperties: false,
    },
    permission: 'search.global',
    privateOnly: true,
    async run(user, input = {}) {
      const q = text(input.kata_kunci, 200);
      if (q.length < 2) return { hasil: [], catatan: 'Kata kunci minimal 2 karakter.' };
      const allowed = globalSearch.getAllowedSearchTypes(user);
      const wanted = SEARCH_TYPES[input.jenis] || null;
      const searchable = allowed.map((type) => SEARCH_LABEL[type] || type);
      if (wanted && !allowed.includes(wanted)) {
        return { kata_kunci: q, hasil: [], jenis_yang_bisa_dicari: searchable, catatan: `Jenis "${input.jenis}" tidak termasuk hak akses Anda.` };
      }
      // Always the user's own company: the tool never passes another entity.
      const result = await globalSearch.search({
        user, q, entityId: null, types: wanted ? [wanted] : null, page: 1, limit: int(input.jumlah, { min: 1, max: 25, fallback: 10 }),
      });
      const notes = [];
      if (result.meta.partial) notes.push('Sebagian modul gagal dicari; hasil mungkin belum lengkap.');
      if (result.meta.totalCapped) notes.push('Hasil sangat banyak; persempit kata kunci.');
      return {
        kata_kunci: q,
        jenis_yang_dicari: result.meta.requestedTypes.map((type) => SEARCH_LABEL[type] || type),
        total_cocok: result.meta.total,
        ditampilkan: result.rows.length,
        hasil: result.rows.map((r) => ({
          jenis: SEARCH_LABEL[r.type] || r.type,
          id: r.id,
          judul: plain(r.title),
          // A customer's second line can be a contact person: only the city is kept.
          keterangan: r.type === 'customer' ? (r.meta?.city || null) : plain(r.subtitle),
          status: r.status || null,
          tanggal: day(r.createdAt),
          rute: route(r.actionUrl),
        })),
        ...(notes.length ? { catatan: notes.join(' ') } : {}),
      };
    },
  },
];
