// Layanan GA (requests, room bookings) and Operasional GA (upkeep, contracts,
// utility bills) — docs/program-people-culture.md. Read only, through the GA
// services, so the page rules apply unchanged:
//   - a requester sees their own requests; People & Culture (ga.request.process)
//     sees every request; an approver sees what waits for their decision;
//   - the room agenda shows other people's bookings masked (slot and division
//     only) to anyone who does not process GA;
//   - vehicles are borrowed in TrackCar, not here: the tools say so;
//   - Operasional GA needs ga.ops.view; rupiah (bill amounts) only from the one
//     `money` tool, for those who administer the bills (ga.ops.manage), in a
//     private conversation.
const requests = require('../../../gaRequests.service');
const bookings = require('../../../gaBookings.service');
const ops = require('../../../gaOps.service');
const rules = require('../../../gaRules');
const { gaCards } = require('../../../gaWorkSummary.service');
const { hasPerm, text, int } = require('./_shared');

const GA_USE = 'ga.request.create';
const GA_PROCESS = 'ga.request.process';
const OPS_VIEW = 'ga.ops.view';
const OPS_MANAGE = 'ga.ops.manage';
const MAX_ROWS = 50;
const DAY_MS = 24 * 3600 * 1000;

const TRACKCAR = rules.VEHICLES_IN_TRACKCAR;
const REQUEST_STATUS = {
  pending_approval: 'Menunggu persetujuan', open: 'Baru', in_progress: 'Diproses', done: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan',
};
const REQUEST_STATUS_FILTER = {
  menunggu_persetujuan: 'pending_approval', baru: 'open', diproses: 'in_progress', selesai: 'done', ditolak: 'rejected', dibatalkan: 'cancelled', terlambat: 'overdue',
};
const REQUEST_TYPE_FILTER = { atk: 'atk', perbaikan_fasilitas: 'facility_repair', lainnya: 'other' };
const RUNNING_REQUEST = ['pending_approval', 'open', 'in_progress'];
const BOOKING_STATUS = {
  pending_approval: 'Menunggu persetujuan', confirmed: 'Terkonfirmasi', in_use: 'Dipakai', returned: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
};
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const notFound = (e) => e && (e.status === 404 || e.code === 'NOT_FOUND');

const requestRow = (r) => ({
  id: r.id,
  nomor: r.requestNumber,
  jenis: r.typeLabel,
  judul: r.title,
  lokasi: r.locationName,
  area: r.area,
  mendesak: r.urgency === 'urgent',
  divisi: r.departmentName,
  pengaju: r.requester?.name || null,
  petugas: r.assignee?.name || null,
  status: REQUEST_STATUS[r.status] || r.status,
  target_selesai: r.dueAt,
  terlambat: r.overdue,
  diajukan: r.createdAt,
  rute: `/ga/requests/${r.id}`,
});

const bookingRow = (b, roomName, me) => (b.masked ? {
  ruang: roomName(b.resourceId),
  mulai: b.startsAt,
  selesai: b.endsAt,
  divisi: b.departmentName,
  disamarkan: true,
} : {
  id: b.id,
  nomor: b.bookingNumber,
  ruang: b.resourceName || roomName(b.resourceId),
  lokasi: b.locationName,
  mulai: b.startsAt,
  selesai: b.endsAt,
  divisi: b.departmentName,
  pemesan: b.requester?.name || null,
  keperluan: b.purpose,
  status: BOOKING_STATUS[b.status] || b.status,
  milik_saya: Number(b.requester?.id) === me,
  rute: `/ga/bookings/${b.id}`,
});

// A home-page card item ("GA-202610-0001 · ATK: Kertas A4") as a plain row.
const cardItem = (item) => {
  const [nomor, ...rest] = String(item.title || '').split(' · ');
  return { nomor, judul: rest.join(' · ') || null, keterangan: item.meta || null, waktu: item.at || null, rute: item.to || null };
};

// ------------------------------------------------------------------ Layanan GA

const layananGaSaya = {
  name: 'layanan_ga_saya',
  module: ['ga-services'],
  label: 'Membaca layanan GA Anda',
  description: 'Ringkasan Layanan GA untuk pengguna yang bertanya: permintaan GA miliknya yang masih berjalan (ATK, perbaikan fasilitas, lainnya) dengan status, petugas, dan target selesai; '
    + 'pemesanan ruang miliknya yang akan datang; permintaan yang menunggu persetujuannya; dan, bagi tim GA, permintaan yang ditugaskan kepadanya. '
    + 'Pakai untuk "permintaan GA saya sampai mana" dan "apa yang menunggu saya di GA". Peminjaman kendaraan tidak ada di sini: lewat TrackCar. '
    + 'Hanya milik pengguna itu atau yang menunggu tindakannya; tanpa permintaan orang lain dan tidak pernah angka rupiah.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  permission: GA_USE,
  privateOnly: true,
  async run(user) {
    const me = Number(user.sub);
    const mine = await requests.list(user, { scope: 'mine', page: 1, limit: 100 });
    const running = mine.rows.filter((r) => RUNNING_REQUEST.includes(r.status));
    const counts = mine.meta.statusCounts || {};
    const myBookings = (await bookings.listBookings(user, { mine: '1', kind: 'room' }))
      .filter((b) => ['pending_approval', 'confirmed', 'in_use'].includes(b.status) && new Date(b.endsAt).getTime() > Date.now())
      .reverse();
    const cards = await gaCards(user);
    const card = (key) => cards.find((c) => c.key === key) || { count: 0, items: [] };
    const approval = card('ga_approval');
    const out = {
      permintaan_saya: {
        berjalan: running.length,
        terlambat: running.filter((r) => r.overdue).length,
        selesai: counts.done || 0,
        ditolak: counts.rejected || 0,
        dibatalkan: counts.cancelled || 0,
        daftar: running.slice(0, 25).map(requestRow),
      },
      pemesanan_ruang_saya: {
        akan_datang: myBookings.length,
        daftar: myBookings.slice(0, 25).map((b) => bookingRow(b, () => null, me)),
      },
      menunggu_persetujuan_saya: {
        jumlah: approval.count,
        contoh: approval.items.map(cardItem),
        catatan: approval.count ? 'Keputusan dilakukan di menu Approval atau di halaman permintaannya.' : 'Tidak ada yang menunggu persetujuan Anda.',
      },
      kendaraan: TRACKCAR,
      rute: '/ga',
    };
    if (hasPerm(user, GA_PROCESS)) {
      const all = await requests.list(user, { scope: 'all', page: 1, limit: 100 });
      const assigned = all.rows.filter((r) => ['open', 'in_progress'].includes(r.status) && Number(r.assignee?.id) === me);
      const queue = card('ga_assigned');
      out.ditugaskan_ke_saya = {
        jumlah: assigned.length,
        terlambat: assigned.filter((r) => r.overdue).length,
        daftar: assigned.slice(0, 25).map(requestRow),
        // The GA PIC also answers for requests nobody has taken yet (home card).
        antrean_saya_termasuk_belum_ditugaskan: queue.count,
      };
    }
    return out;
  },
};

const permintaanGa = {
  name: 'permintaan_ga',
  module: ['ga-services'],
  label: 'Membaca permintaan GA',
  description: 'Permintaan GA (ATK, perbaikan fasilitas, lainnya): daftar dengan saringan status, jenis, atau kata cari, atau rincian satu permintaan (isi id atau nomor) — '
    + 'barang yang diminta, keterangan, status, petugas, target selesai, catatan penyelesaian atau alasan ditolak. cakupan "saya" = permintaan milik pengguna; '
    + '"ditugaskan_ke_saya" dan "semua" hanya untuk tim GA (People & Culture). Rincian permintaan orang lain hanya untuk tim GA, penyetujunya, dan manajemen divisinya. '
    + 'Tanpa lampiran dan riwayat perubahan; tidak pernah angka rupiah. Peminjaman kendaraan lewat TrackCar, bukan di sini.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 1, description: 'Id permintaan untuk rinciannya' },
      nomor: { type: 'string', maxLength: 40, description: 'Nomor permintaan, mis. GA-202610-0001' },
      cakupan: { type: 'string', enum: ['saya', 'ditugaskan_ke_saya', 'semua'], description: 'Default saya' },
      status: { type: 'string', enum: Object.keys(REQUEST_STATUS_FILTER), description: 'terlambat = lewat target selesai' },
      jenis: { type: 'string', enum: Object.keys(REQUEST_TYPE_FILTER) },
      cari: { type: 'string', maxLength: 100, description: 'Nomor, judul, atau nama pengaju' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal permintaan (default 20)' },
    },
    additionalProperties: false,
  },
  permission: GA_USE,
  privateOnly: true,
  async run(user, input = {}) {
    const processor = hasPerm(user, GA_PROCESS);
    const nomor = text(input.nomor, 40);
    let id = Number.isInteger(input.id) && input.id > 0 ? input.id : null;
    if (!id && nomor) {
      const found = await requests.list(user, { scope: processor ? 'all' : 'mine', q: nomor, page: 1, limit: 10 });
      id = found.rows.find((r) => String(r.requestNumber).toLowerCase() === nomor.toLowerCase())?.id || null;
      if (!id) return { ditemukan: false, catatan: 'Permintaan dengan nomor ini tidak ada, atau bukan milik Anda.' };
    }
    if (id) {
      let r;
      try {
        r = await requests.get(user, id);
      } catch (e) {
        if (notFound(e)) return { ditemukan: false, catatan: 'Permintaan ini tidak ada, atau Anda tidak berhak membukanya.' };
        throw e;
      }
      return {
        ditemukan: true,
        permintaan: {
          ...requestRow(r),
          keterangan: r.description,
          barang: (r.items || []).map((i) => ({ nama: i.itemName, jumlah: i.qty, satuan: i.unit })),
          target_hari: r.slaDays,
          mulai_dikerjakan: r.startedAt,
          selesai_pada: r.doneAt,
          tepat_waktu: r.onTime,
          catatan_penyelesaian: r.resolutionNote,
          alasan_ditolak: r.rejectedReason,
          alasan_dibatalkan: r.cancelReason,
          jumlah_lampiran: (r.attachments || []).length,
          menunggu_keputusan_anda: Boolean(r.can?.decide),
        },
      };
    }
    const cakupan = ['ditugaskan_ke_saya', 'semua'].includes(input.cakupan) ? input.cakupan : 'saya';
    if (cakupan !== 'saya' && !processor) {
      return { catatan: 'Hanya tim GA (People & Culture) yang melihat permintaan orang lain. Pakai cakupan "saya" untuk permintaan Anda sendiri.' };
    }
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 20 });
    const assignedOnly = cakupan === 'ditugaskan_ke_saya';
    const out = await requests.list(user, {
      scope: cakupan === 'saya' ? 'mine' : 'all',
      status: REQUEST_STATUS_FILTER[input.status] || null,
      type: REQUEST_TYPE_FILTER[input.jenis] || null,
      q: text(input.cari, 100),
      page: 1,
      limit: assignedOnly ? 100 : limit,
    });
    const me = Number(user.sub);
    const matched = assignedOnly ? out.rows.filter((r) => Number(r.assignee?.id) === me) : out.rows;
    const c = out.meta.statusCounts || {};
    return {
      cakupan,
      ...(assignedOnly ? {} : {
        ringkasan: {
          menunggu_persetujuan: c.pending_approval || 0, baru: c.open || 0, diproses: c.in_progress || 0, selesai: c.done || 0,
          ditolak: c.rejected || 0, dibatalkan: c.cancelled || 0, terlambat: out.meta.overdue || 0,
        },
      }),
      total_cocok: assignedOnly ? matched.length : out.meta.total,
      ditampilkan: Math.min(limit, matched.length),
      permintaan: matched.slice(0, limit).map(requestRow),
    };
  },
};

// Monday 00:00 WIB of the week `day` (YYYY-MM-DD) falls in.
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}
const plusDays = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

const pemesananRuang = {
  name: 'pemesanan_ruang',
  module: ['ga-services'],
  label: 'Membaca pemesanan ruang',
  description: 'Agenda pemesanan ruang rapat (Layanan GA) untuk hari ini, minggu ini (Senin–Minggu), atau rentang tanggal (paling panjang 31 hari), beserta daftar ruang yang bisa dipesan '
    + '(nama, lokasi, kapasitas). Pakai untuk "ruang apa yang terpakai hari ini" dan "jadwal ruang minggu ini". Pemesanan milik orang lain tampil tersamar (jam dan divisi saja) '
    + 'kecuali bagi tim GA, seperti di halamannya. Peminjaman kendaraan tidak ada di sini: lewat TrackCar (trackcar.prakasafoods.com). '
    + 'Tanpa nama pemesan dan keperluan milik orang lain; tidak pernah angka rupiah.',
  inputSchema: {
    type: 'object',
    properties: {
      periode: { type: 'string', enum: ['hari_ini', 'minggu_ini'], description: 'Default hari_ini; diabaikan bila dari/sampai diisi' },
      dari: { type: 'string', description: 'Tanggal mulai (YYYY-MM-DD)' },
      sampai: { type: 'string', description: 'Tanggal akhir, termasuk hari itu (YYYY-MM-DD)' },
      ruang: { type: 'string', maxLength: 80, description: 'Bagian dari nama ruang' },
      hanya_saya: { type: 'boolean', description: 'true = hanya pemesanan milik pengguna' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal pemesanan (default 30)' },
    },
    additionalProperties: false,
  },
  permission: GA_USE,
  privateOnly: true,
  async run(user, input = {}) {
    const today = rules.wibDay();
    let first = today;
    let last = today;
    if (isDay(input.dari) || isDay(input.sampai)) {
      first = isDay(input.dari) ? input.dari : input.sampai;
      last = isDay(input.sampai) ? input.sampai : first;
    } else if (input.periode === 'minggu_ini') {
      first = weekStart(today);
      last = plusDays(first, 6);
    }
    if (last < first) return { catatan: 'Tanggal "sampai" harus sama atau setelah "dari".' };
    if ((new Date(`${last}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / DAY_MS + 1 > rules.BOOKING_LIST_MAX_DAYS) {
      return { catatan: `Rentang paling panjang ${rules.BOOKING_LIST_MAX_DAYS} hari.` };
    }
    const rooms = await bookings.listResources(user, { kind: 'room' });
    const names = new Map(rooms.map((r) => [r.id, r.name]));
    const roomName = (id) => names.get(Number(id)) || null;
    const wanted = text(input.ruang, 80).toLowerCase();
    const me = Number(user.sub);
    const all = await bookings.listBookings(user, {
      kind: 'room', from: rules.wibDayStart(first).toISOString(), to: rules.wibDayStart(plusDays(last, 1)).toISOString(),
    });
    const matched = all
      .filter((b) => !wanted || String(b.resourceName || roomName(b.resourceId) || '').toLowerCase().includes(wanted))
      .filter((b) => input.hanya_saya !== true || (!b.masked && Number(b.requester?.id) === me));
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 30 });
    return {
      dari: first,
      sampai: last,
      zona_waktu: 'WIB',
      total_pemesanan: matched.length,
      ditampilkan: Math.min(limit, matched.length),
      pemesanan: matched.slice(0, limit).map((b) => bookingRow(b, roomName, me)),
      ruang_tersedia_untuk_dipesan: rooms.slice(0, MAX_ROWS).map((r) => ({ id: r.id, nama: r.name, lokasi: r.locationName, kapasitas: r.capacity })),
      ...(matched.some((b) => b.masked) ? { catatan: 'Pemesanan orang lain disamarkan: hanya jam dan divisinya.' } : {}),
      ...(rooms.length ? {} : { catatan_ruang: 'Belum ada ruang yang didaftarkan GA.' }),
      kendaraan: TRACKCAR,
      rute: '/ga',
    };
  },
};

// ------------------------------------------------------------------ Operasional GA

const opsRoute = (tab, id) => `/ga/operations?tab=${tab}&open=${id}`;
const upkeepState = (m) => {
  if (m.status !== 'active') return 'tidak dipakai';
  if (m.overdue) return 'lewat jadwal';
  return m.dueSoon ? 'segera' : 'terjadwal';
};
const contractState = (c) => {
  if (c.status !== 'active') return 'selesai';
  if (c.lapsed) return 'sudah lewat tanggal berakhir';
  return c.ending ? 'segera berakhir' : 'aktif';
};
const billState = (b) => ({ paid: 'lunas', overdue: 'lewat jatuh tempo', unpaid: 'belum lunas' }[b.status] || b.status);
// Everything about a bill except the rupiah amount.
const billRow = (b) => ({
  id: b.id,
  utilitas: b.utilityLabel,
  lokasi: b.locationName,
  periode: b.period,
  jatuh_tempo: b.dueOn,
  tanggal_lunas: b.paidOn,
  status: billState(b),
  segera_jatuh_tempo: b.dueSoon,
  rute: opsRoute('bills', b.id),
});

const operasionalGa = {
  name: 'operasional_ga',
  module: ['ga-operations'],
  label: 'Membaca operasional GA',
  description: 'Operasional GA (People & Culture): perawatan berkala (AC, APAR, genset, dll.) yang lewat jadwal atau jatuh tempo 7 hari ke depan, kontrak dan sewa yang segera berakhir '
    + 'atau sudah lewat, dan tagihan utilitas (listrik, air, gas) yang lewat jatuh tempo atau belum lunas — dengan lokasi, vendor, dan tanggalnya, plus hitungan ringkas. '
    + 'Default hanya yang perlu ditindak; hanya_perlu_tindakan = false untuk seluruh daftar. '
    + 'Hanya jumlah, tanggal, dan status: tidak pernah nominal tagihan, biaya kontrak, atau biaya perawatan (nominal tagihan lewat tagihan_utilitas_ga, untuk yang berhak).',
  inputSchema: {
    type: 'object',
    properties: {
      bagian: { type: 'string', enum: ['semua', 'perawatan', 'kontrak', 'tagihan'], description: 'Default semua' },
      hanya_perlu_tindakan: { type: 'boolean', description: 'Default true: lewat jadwal/jatuh tempo, segera, atau segera berakhir' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal baris per bagian (default 25)' },
    },
    additionalProperties: false,
  },
  permission: OPS_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const part = ['perawatan', 'kontrak', 'tagihan'].includes(input.bagian) ? input.bagian : 'semua';
    const actionOnly = input.hanya_perlu_tindakan !== false;
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 25 });
    const wants = (name) => part === 'semua' || part === name;
    const s = await ops.readFor(user);
    const out = {
      ringkasan: {
        jadwal_perawatan_aktif: s.maintenance,
        perawatan_lewat_jadwal: s.maintenanceOverdue,
        perawatan_segera: s.maintenanceDueSoon,
        kontrak_aktif: s.contracts,
        kontrak_segera_berakhir: s.contractsEnding,
        tagihan_belum_lunas: s.billsUnpaid,
        tagihan_lewat_jatuh_tempo: s.billsOverdue,
      },
      cakupan: actionOnly ? 'hanya yang perlu ditindak' : 'seluruh daftar',
    };
    const section = (rows, shape) => ({ total: rows.length, ditampilkan: Math.min(limit, rows.length), daftar: rows.slice(0, limit).map(shape) });
    if (wants('perawatan')) {
      const rows = (await ops.readFor(user, 'maintenance')).filter((m) => !actionOnly || m.overdue || m.dueSoon);
      out.perawatan = section(rows, (m) => ({
        id: m.id, nama: m.name, kategori: m.categoryLabel, lokasi: m.locationName, vendor: m.vendorName, interval_hari: m.intervalDays,
        terakhir_dikerjakan: m.lastDoneOn, jadwal_berikutnya: m.nextDueOn, keadaan: upkeepState(m), rute: opsRoute('maintenance', m.id),
      }));
    }
    if (wants('kontrak')) {
      const rows = (await ops.readFor(user, 'contracts')).filter((c) => !actionOnly || c.ending || c.lapsed);
      out.kontrak = section(rows, (c) => ({
        id: c.id, jenis: c.kindLabel, vendor: c.vendorName, keterangan: c.description, lokasi: c.locationName, mulai: c.startOn, berakhir: c.endOn,
        putuskan_sebelum: c.decisionOn, keadaan: contractState(c), rute: opsRoute('contracts', c.id),
      }));
    }
    if (wants('tagihan')) {
      const rows = (await ops.readFor(user, 'bills')).filter((b) => !actionOnly || b.status !== 'paid');
      // Overdue first, then the nearest due date.
      rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.dueOn || '9999').localeCompare(String(b.dueOn || '9999')));
      out.tagihan = section(rows, billRow);
      out.tagihan.catatan = 'Pembayaran diajukan lewat Finance; GA mencatat tanggal lunasnya. Nominal tidak termasuk di alat ini.';
    }
    out.rute = '/ga/operations';
    return out;
  },
};

const UTILITY_FILTER = { listrik: 'electricity', air: 'water', gas: 'gas', lainnya: 'other' };
const BILL_STATUS_FILTER = { belum_lunas: 'unpaid', lewat_jatuh_tempo: 'overdue', lunas: 'paid' };

const tagihanUtilitas = {
  name: 'tagihan_utilitas_ga',
  module: ['ga-operations'],
  label: 'Membaca nominal tagihan utilitas',
  description: 'Tagihan utilitas kantor (listrik, air, gas) per lokasi dan bulan DENGAN nominal rupiah dan pemakaiannya (kWh, m³): periode, jatuh tempo, tanggal lunas, status. '
    + 'Hanya untuk Supervisor/Head People & Culture yang mengelola Operasional GA, dan hanya di percakapan pribadi. Saring dengan periode (YYYY-MM), utilitas, atau status. '
    + 'Pakai hanya bila pengguna menanyakan nominalnya; untuk "tagihan mana yang lewat jatuh tempo" pakai operasional_ga. '
    + 'Tanpa nomor pelanggan/meter, tanpa biaya kontrak atau biaya perawatan, dan tidak pernah data pembayaran Finance.',
  inputSchema: {
    type: 'object',
    properties: {
      periode: { type: 'string', description: 'Bulan tagihan (YYYY-MM)' },
      utilitas: { type: 'string', enum: Object.keys(UTILITY_FILTER) },
      status: { type: 'string', enum: Object.keys(BILL_STATUS_FILTER) },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal tagihan (default 25)' },
    },
    additionalProperties: false,
  },
  permission: OPS_MANAGE,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const periode = typeof input.periode === 'string' && /^\d{4}-\d{2}$/.test(input.periode) ? input.periode : null;
    const utility = UTILITY_FILTER[input.utilitas] || null;
    const status = BILL_STATUS_FILTER[input.status] || null;
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 25 });
    const rows = (await ops.readFor(user, 'bills'))
      .filter((b) => (!periode || b.period === periode) && (!utility || b.utility === utility) && (!status || b.status === status));
    const shown = rows.slice(0, limit);
    return {
      total_cocok: rows.length,
      ditampilkan: shown.length,
      total_nominal_ditampilkan: shown.reduce((sum, b) => sum + (Number(b.amount) || 0), 0),
      mata_uang: 'IDR',
      tagihan: shown.map((b) => ({ ...billRow(b), nominal: b.amount, pemakaian: b.usageAmount, satuan: b.unit || null })),
      catatan: 'Pembayaran tagihan diajukan lewat Finance; angka di sini adalah yang dicatat GA.',
      rute: '/ga/operations?tab=bills',
    };
  },
};

module.exports = [layananGaSaya, permintaanGa, pemesananRuang, operasionalGa, tagihanUtilitas];
