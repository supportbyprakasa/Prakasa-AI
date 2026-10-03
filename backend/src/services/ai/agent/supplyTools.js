// Prakasa AI reads Warehouse and Procurement QUANTITIES (docs/program-4-divisi.md 4.1).
//
// Owner rules these tools enforce (Keputusan yang berlaku):
//   - quantities, dates and states only: never a purchase price, PO value,
//     vendor spend, payment term or margin — for ANY user, price viewers too
//     (P1 is a right on the page, not something the AI may carry away);
//   - stock per gudang only with warehouse.stock.view (Warehouse, MO Sup/Head);
//     stock total and days of cover also with procurement.reorder.view
//     (Procurement Sup/Head, D2 extended 30 Sep 2026); Procurement members never;
//   - no address (D5) and no vendor contact, tax or bank data (none is mirrored);
//   - private conversations only (privateOnly): a shared chat would show the
//     answer to people whose own permissions may not allow it.
// Each tool calls the module's own read service with prices OFF, copies an
// explicit list of fields, and passes the result through the output guard.
const stock = require('../../warehouseStock.service');
const shipping = require('../../warehouseShipping.service');
const warehouseRules = require('../../warehouseRules');
const documents = require('../../warehouseDocuments.service');
const orders = require('../../procurementOrders.service');
const vendors = require('../../procurementVendors.service');
const rules = require('../../procurementRules');
const { WIB_OFFSET_MS } = require('../../../utils/wibTime');
const { assertClean } = require('./outputGuard');

const STOCK_VIEW = 'warehouse.stock.view';
const PROCUREMENT_VIEW = 'procurement.view';
// Stock totals and days of cover, never per gudang (D2 extended 30 Sep 2026).
const STOCK_TOTAL = Object.freeze([STOCK_VIEW, 'procurement.reorder.view']);
const MAX_ROWS = 50;
const MAX_LINES = 100;
const WAREHOUSE_SOURCE = 'Accurate, hanya dibaca, setelah disetujui Supervisor/Head Warehouse';
const PROCUREMENT_SOURCE = 'Accurate, hanya dibaca, setelah disetujui Head Procurement';

const hasPerm = (user, code) => (user.permissions || []).includes(code);
const anyPerm = (user, codes) => [].concat(codes).some((code) => hasPerm(user, code));
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rows = (v, fallback = 20) => (Number.isInteger(v) ? Math.min(MAX_ROWS, Math.max(1, v)) : fallback);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
// DATE columns arrive as UTC-midnight Dates (driver timezone 'Z'): the calendar day.
const day = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
// TIMESTAMP columns: the WIB wall clock.
const wib = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : `${new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')} WIB`;
};
const denied = (message) => Object.assign(new Error(message), { status: 403, code: 'FORBIDDEN' });

// When the data shown was approved, and whether a newer batch waits for a decision.
const dataPer = (state) => ({
  disetujui: state?.asOf ? wib(state.asOf.approvedAt) : null,
  ditarik: state?.asOf ? wib(state.asOf.pulledAt) : null,
  batch_menunggu_keputusan: state?.pending ? state.pending.batchId : null,
});

function define({ name, label, description, inputSchema, permission, run }) {
  return Object.freeze({
    name,
    label,
    description,
    inputSchema: { type: 'object', additionalProperties: false, ...inputSchema },
    permission,
    privateOnly: true,
    // Re-checked here as well as when the tool is granted: run() alone is safe.
    async run(user, input = {}) {
      if (!anyPerm(user, permission)) throw denied('Alat ini tidak tersedia untuk Anda');
      const result = await run(user, input && typeof input === 'object' && !Array.isArray(input) ? input : {});
      return assertClean(result);
    },
  });
}

// ------------------------------------------------------------------ Warehouse

const STOCK_STATUSES = ['ada', 'menipis', 'habis', 'minus'];
const COVER_REASON = {
  history: 'riwayat barang keluar yang disetujui belum 7 hari',
  no_outflow: 'tidak ada barang keluar 30 hari terakhir',
};

const stokBarang = define({
  name: 'stok_barang',
  label: 'Membaca stok barang',
  description: 'Stok barang dari Accurate (hanya data yang sudah disetujui Supervisor/Head Warehouse). '
    + 'Memberi stok total dalam satuan dasar, stok per satuan, hari-cukup (stok dibagi rata-rata barang keluar per hari 30 hari terakhir; '
    + 'kosong bila riwayat kurang dari 7 hari atau tidak ada barang keluar) dan status: ada, menipis (hari-cukup kurang dari 7), habis, minus. '
    + 'Cari dengan kode/nama/kategori barang atau saring status. Stok per gudang hanya untuk tim Warehouse dan Management Office. '
    + 'Hanya jumlah: tidak pernah harga atau nilai.',
  inputSchema: {
    properties: {
      cari: { type: 'string', maxLength: 100, description: 'Kode, nama, atau kategori barang' },
      status: { type: 'string', enum: STOCK_STATUSES },
      gudang: { type: 'string', maxLength: 120, description: 'Nama gudang persis (hanya Warehouse dan Management Office)' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal barang (default 20)' },
    },
  },
  permission: STOCK_TOTAL,
  async run(user, input) {
    const perGudang = hasPerm(user, STOCK_VIEW);
    const gudang = text(input.gudang, 120);
    let warehouseId = null;
    if (gudang) {
      if (!perGudang) throw denied('Stok per gudang hanya untuk tim Warehouse dan Management Office.');
      const list = await stock.warehouses(user.entityId);
      const found = list.find((w) => String(w.name).toLowerCase() === gudang.toLowerCase());
      if (!found) return { gudang_tidak_dikenal: gudang, gudang_tersedia: list.map((w) => w.name) };
      warehouseId = found.id;
    }
    const state = await stock.status(user.entityId);
    const result = await stock.listStock(user.entityId, {
      q: text(input.cari, 100), status: STOCK_STATUSES.includes(input.status) ? input.status : null, warehouseId, page: 1, limit: rows(input.jumlah),
    });
    const units = await stock.baseUnits(user.entityId, result.items.map((i) => i.itemId));
    const unitMissing = result.items.some((i) => !units.get(i.itemId));
    return {
      sumber: WAREHOUSE_SOURCE,
      data_per: dataPer(state),
      ...(unitMissing ? { catatan_satuan: 'Satuan dasar belum tersedia dari Accurate untuk sebagian barang; angka stok dalam satuan dasar barang — pakai stok_per_satuan bila ada, jangan menebak nama satuan.' } : {}),
      ...(state.ready ? {} : { catatan: 'Belum ada data stok dari Accurate yang disetujui; semua barang tampil 0.' }),
      ...(perGudang ? { gudang: gudang || 'semua gudang' } : { cakupan: 'stok total semua gudang (stok per gudang tidak termasuk hak akses Anda)' }),
      ringkasan: {
        total_barang: result.counts.total, ada: result.counts.ada, menipis: result.counts.menipis, habis: result.counts.habis, minus: result.counts.minus,
      },
      total_cocok: result.total,
      ditampilkan: result.items.length,
      barang: result.items.map((i) => {
        const here = warehouseId ? i.warehouses.find((w) => w.warehouseId === warehouseId) : null;
        return {
          kode: i.itemNo,
          nama: i.name,
          kategori: i.category,
          stok: i.qty,
          satuan_dasar: units.get(i.itemId) || null,
          stok_per_satuan: i.qtyAllUnits,
          hari_cukup: i.daysCover,
          ...(i.daysCover === null && i.coverReason ? { hari_cukup_kosong_karena: COVER_REASON[i.coverReason] || null } : {}),
          status: i.status,
          ...(warehouseId ? { stok_di_gudang_ini: here ? here.qty : 0 } : {}),
          ...(perGudang ? { per_gudang: i.warehouses.map((w) => ({ gudang: w.warehouse, stok: w.qty })) } : {}),
        };
      }),
    };
  },
});

const soHeader = (o) => ({
  nomor_so: o.number,
  tanggal_so: day(o.date),
  janji_kirim: day(o.promisedDate),
  sumber_janji: o.promiseSource === 'so' ? 'Tgl kirim di SO' : warehouseRules.standardPromiseText(o.promiseShifted),
  tgl_kirim_accurate: day(o.shipDate),
  terlambat_hari: o.daysLate ?? 0,
  customer: o.customerName,
  kode_customer: o.customerNo,
  channel: o.channel,
  persen_terkirim: o.percentShipped,
});

const jadwalKirim = define({
  name: 'jadwal_kirim',
  label: 'Membaca jadwal kirim',
  description: 'Jadwal kirim: SO yang belum terkirim penuh (Accurate, data yang disetujui), urut janji kirim (Tgl kirim di SO bila diisi setelah tanggal SO, selain itu standar 2×24 jam; hari Minggu digeser ke Senin). Stok dibagi menurut janji kirim, '
    + 'jadi tiap SO dan baris tertulis cukup atau kurang. Isi nomor_so untuk rincian baris (dipesan, terkirim, sisa, dalam satuan baris). '
    + 'Hanya jumlah dan tanggal: tanpa harga dan tanpa alamat.',
  inputSchema: {
    properties: {
      nomor_so: { type: 'string', maxLength: 40, description: 'Nomor SO untuk rincian barisnya' },
      status: { type: 'string', enum: ['kurang', 'terlambat'], description: 'kurang = stok tidak cukup; terlambat = lewat janji kirim' },
      cari: { type: 'string', maxLength: 100, description: 'Nomor SO, nama atau kode customer' },
      dari: { type: 'string', description: 'Janji kirim mulai (YYYY-MM-DD)' },
      sampai: { type: 'string', description: 'Janji kirim sampai (YYYY-MM-DD)' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
    },
  },
  permission: STOCK_VIEW,
  async run(user, input) {
    const state = await stock.status(user.entityId);
    const nomor = text(input.nomor_so, 40);
    if (nomor) {
      const id = await shipping.findOpenSoId(user.entityId, nomor);
      const so = id ? await shipping.order(user.entityId, id) : null;
      // An SO with no line left to ship is not on the Jadwal kirim page either.
      if (!so || !so.lines.length) {
        return { sumber: WAREHOUSE_SOURCE, data_per: dataPer(state), ditemukan: false, catatan: 'SO ini tidak ada di jadwal kirim: sudah terkirim penuh, ditutup di Accurate, atau belum masuk data yang disetujui.' };
      }
      return {
        sumber: WAREHOUSE_SOURCE,
        data_per: dataPer(state),
        ditemukan: true,
        so: {
          ...soHeader(so),
          status_accurate: so.status,
          baris_stok_kurang: so.shortLines,
          jumlah_baris: so.lines.length,
          baris: so.lines.slice(0, MAX_LINES).map((l) => ({
            baris: l.lineNo, kode_barang: l.itemNo, nama_barang: l.itemName, satuan: l.unit,
            dipesan: l.qty, terkirim: l.shippedQty, sisa: l.remainingQty, stok: l.enough ? 'cukup' : 'kurang', gudang: l.warehouse,
          })),
        },
      };
    }
    const result = await shipping.schedule(user.entityId, {
      q: text(input.cari, 100),
      status: { kurang: 'short', terlambat: 'late' }[input.status] || null,
      from: isDate(input.dari) ? input.dari : null,
      to: isDate(input.sampai) ? input.sampai : null,
    });
    const limit = rows(input.jumlah);
    return {
      sumber: WAREHOUSE_SOURCE,
      data_per: dataPer(state),
      ringkasan: { so_belum_terkirim_penuh: result.counts.all, stok_kurang: result.counts.short, terlambat: result.counts.late },
      total_cocok: result.items.length,
      ditampilkan: Math.min(limit, result.items.length),
      so: result.items.slice(0, limit).map((o) => ({
        ...soHeader(o), baris_terbuka: o.openLines, baris_stok_kurang: o.shortLines, stok: o.stock === 'short' ? 'kurang' : 'cukup',
      })),
    };
  },
});

const PO_STATE_LABEL = Object.freeze({
  open: 'terbuka', partial: 'diterima sebagian', late: 'terlambat', received: 'diterima penuh', closed: 'ditutup', legacy: 'PO lama belum ditutup',
});

const gudangHariIni = define({
  name: 'gudang_hari_ini',
  label: 'Membaca ringkasan gudang hari ini',
  description: 'Ringkasan gudang hari ini dari data Accurate yang disetujui: jumlah surat jalan dan penerimaan hari ini, pindah gudang yang belum diterima, '
    + 'barang stok minus, SO yang jadwal kirimnya sampai hari ini, dan PO yang akan datang 7 hari ke depan (nomor, pemasok, tanggal, persen diterima). Tanpa harga.',
  inputSchema: { properties: {} },
  permission: STOCK_VIEW,
  async run(user) {
    const state = await stock.status(user.entityId);
    const poState = await orders.status(user.entityId);
    const d = await documents.today(user.entityId);
    return {
      sumber: WAREHOUSE_SOURCE,
      data_per: dataPer(state),
      data_po_per: dataPer(poState),
      tanggal: d.date,
      surat_jalan_hari_ini: d.totals.deliveries,
      penerimaan_hari_ini: d.totals.receipts,
      perlu_perhatian: {
        pindah_gudang_dalam_perjalanan: d.attention.inTransit,
        pindah_gudang_belum_diterima_3_hari: d.attention.stuckTransfers,
        barang_stok_minus: d.attention.stockMinus,
        so_jadwal_kirim_sampai_hari_ini: d.attention.soDue,
      },
      po_akan_datang_7_hari: d.incomingPos.map((p) => ({
        nomor_po: p.number, pemasok: p.vendorName, tanggal_datang: day(p.dueDate), perkiraan: p.estimated, persen_diterima: p.percentReceived, jumlah_baris: p.lineCount,
      })),
      surat_jalan: d.deliveries.slice(0, 20).map((x) => ({ nomor: x.number, customer: x.party, nomor_so: x.soNumbers, jumlah_baris: x.lineCount })),
      penerimaan: d.receipts.slice(0, 20).map((x) => ({ nomor: x.number, pemasok: x.party, nomor_po: x.poNumbers, jumlah_baris: x.lineCount })),
    };
  },
});

// ---------------------------------------------------------------- Procurement

const STATE_IN = Object.freeze({
  terbuka: 'open', sebagian: 'partial', terlambat: 'late', diterima: 'received', ditutup: 'closed', lama: 'legacy',
});

const poHeader = (p) => ({
  nomor_po: p.number,
  tanggal_po: day(p.date),
  pemasok: p.vendorName,
  kode_pemasok: p.vendorNo,
  status: PO_STATE_LABEL[p.state] || p.state,
  tanggal_datang: day(p.dueDate),
  perkiraan: p.estimated,
  terlambat_hari: p.daysLate,
  persen_diterima: p.percentReceived,
  jumlah_baris: p.lineCount,
});

const statusPo = define({
  name: 'status_po',
  label: 'Membaca status PO',
  description: 'Purchase order dari Accurate (data yang disetujui Head Procurement): status (terbuka, diterima sebagian, terlambat, diterima penuh, ditutup, '
    + 'PO lama belum ditutup), tanggal datang (Tgl kirim Accurate; tanpa itu 14 hari dari tanggal PO, ditandai perkiraan), terlambat berapa hari, persen diterima. '
    + 'Isi nomor_po untuk rincian baris (dipesan, diterima, sisa, diretur, dalam satuan baris) dan penerimaannya. '
    + 'Tidak pernah harga, nilai PO, atau termin pembayaran.',
  inputSchema: {
    properties: {
      nomor_po: { type: 'string', maxLength: 40, description: 'Nomor PO untuk rinciannya' },
      status: { type: 'string', enum: Object.keys(STATE_IN) },
      cari: { type: 'string', maxLength: 100, description: 'Nomor PO, nama pemasok, atau kode/nama barang' },
      kode_pemasok: { type: 'string', maxLength: 80 },
      dari: { type: 'string', description: 'Tanggal PO mulai (YYYY-MM-DD)' },
      sampai: { type: 'string', description: 'Tanggal PO sampai (YYYY-MM-DD)' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
    },
  },
  permission: PROCUREMENT_VIEW,
  async run(user, input) {
    const state = await orders.status(user.entityId);
    const nomor = text(input.nomor_po, 40);
    if (nomor) {
      const id = await orders.findOrderId(user.entityId, nomor);
      const po = id ? await orders.getOrder(user.entityId, id, { prices: false }) : null;
      if (!po) return { sumber: PROCUREMENT_SOURCE, data_per: dataPer(state), ditemukan: false, catatan: 'PO tidak ditemukan di data Procurement yang disetujui.' };
      return {
        sumber: PROCUREMENT_SOURCE,
        data_per: dataPer(state),
        ditemukan: true,
        po: {
          ...poHeader(po),
          jumlah_baris: po.lines.length,
          baris: po.lines.slice(0, MAX_LINES).map((l) => ({
            baris: l.lineNo, kode_barang: l.itemNo, nama_barang: l.itemName, satuan: l.unit, isi_per_satuan: l.unitRatio,
            dipesan: l.qty, diterima: l.receivedQty, sisa: l.remainingQty, diretur: l.returnedQty, ditutup: l.closed, gudang: l.warehouse,
          })),
          penerimaan: po.receipts.map((r) => ({ nomor: r.number, tanggal: day(r.date), jumlah_baris: r.lineCount, gudang: r.warehouse })),
        },
      };
    }
    const result = await orders.listOrders(user.entityId, {
      state: STATE_IN[input.status] || null,
      q: text(input.cari, 100),
      vendor: text(input.kode_pemasok, 80) || null,
      from: isDate(input.dari) ? input.dari : null,
      to: isDate(input.sampai) ? input.sampai : null,
      page: 1,
      limit: rows(input.jumlah),
    }, { prices: false });
    const c = result.counts;
    return {
      sumber: PROCUREMENT_SOURCE,
      data_per: dataPer(state),
      ringkasan: {
        semua: c.all, terbuka: c.open, diterima_sebagian: c.partial, terlambat: c.late, diterima_penuh: c.received, ditutup: c.closed, po_lama_belum_ditutup: c.legacy,
      },
      total_cocok: result.total,
      ditampilkan: result.items.length,
      po: result.items.map(poHeader),
    };
  },
});

const procurementHariIni = define({
  name: 'procurement_hari_ini',
  label: 'Membaca ringkasan Procurement hari ini',
  description: 'Hari ini di Procurement (data yang disetujui): jumlah PO terlambat, jatuh tempo 7 hari, tanpa Tgl kirim, dan PO lama belum ditutup; '
    + 'PO yang dijadwalkan datang hari ini dan besok; barang yang datang hari ini. Tanpa harga.',
  inputSchema: { properties: {} },
  permission: PROCUREMENT_VIEW,
  async run(user) {
    const state = await orders.status(user.entityId);
    const d = await orders.today(user.entityId);
    return {
      sumber: PROCUREMENT_SOURCE,
      data_per: dataPer(state),
      tanggal: d.date,
      ...(state.receiptsLive ? {} : { catatan: 'Penerimaan gudang belum masuk data yang disetujui; persen diterima berasal dari PO Accurate.' }),
      perlu_perhatian: {
        po_terlambat: d.attention.late, jatuh_tempo_7_hari: d.attention.dueSoon, tanpa_tgl_kirim: d.attention.noExpectedDate, po_lama_belum_ditutup: d.attention.legacy,
      },
      datang_hari_ini_dan_besok: d.expected.map(poHeader),
      barang_datang_hari_ini: d.arrivals.map((r) => ({ nomor: r.number, pemasok: r.vendorName, nomor_po: r.poNumbers, jumlah_baris: r.lineCount })),
    };
  },
});

const VENDOR_FILTER_IN = Object.freeze({ aktif: 'active', terlambat: 'late', tanpa_po: 'no_po', nonaktif: 'inactive' });
const raporNote = () => `fill rate = rata-rata diterima dibagi dipesan per baris, PO yang jatuh tempo 90 hari terakhir; `
  + `tepat waktu = bagian PO diterima penuh 90 hari terakhir yang penerimaan terakhirnya paling lambat tanggal datang; `
  + `rata-rata hari datang = tanggal PO sampai penerimaan terakhir. PO sebelum ${rules.lateFrom()} tidak dihitung. `
  + 'Tepat waktu dan hari datang kosong sampai penerimaan gudang disetujui.';

const vendorOut = (v) => ({
  kode_pemasok: v.vendorNo,
  nama: v.name,
  kategori: v.category,
  status: v.status,
  jumlah_po: v.poCount,
  po_terbuka: v.openCount,
  po_terlambat: v.lateCount,
  po_terakhir: day(v.lastPoDate),
  fill_rate_persen: v.fillRate,
  tepat_waktu_persen: v.onTimeRate,
  rata_rata_hari_datang: v.leadTimeDays,
  po_diterima_90_hari: v.receivedPos,
});

const raporPemasok = define({
  name: 'rapor_pemasok',
  label: 'Membaca rapor pemasok',
  description: 'Rapor pemasok dari PO dan penerimaan yang disetujui: jumlah PO, PO terbuka dan terlambat, fill rate, persen tepat waktu, rata-rata hari datang. '
    + 'Isi kode_pemasok untuk rincian dan 20 PO terakhirnya. Tidak pernah belanja, harga, atau kontak pemasok.',
  inputSchema: {
    properties: {
      kode_pemasok: { type: 'string', maxLength: 80, description: 'Kode pemasok untuk rinciannya' },
      cari: { type: 'string', maxLength: 100, description: 'Nama atau kode pemasok' },
      saring: { type: 'string', enum: Object.keys(VENDOR_FILTER_IN) },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
    },
  },
  permission: PROCUREMENT_VIEW,
  async run(user, input) {
    const state = await orders.status(user.entityId);
    const kode = text(input.kode_pemasok, 80);
    if (kode) {
      const id = await vendors.findVendorId(user.entityId, kode);
      const v = id ? await vendors.getVendor(user.entityId, id, { prices: false }) : null;
      if (!v) return { sumber: PROCUREMENT_SOURCE, data_per: dataPer(state), ditemukan: false };
      return {
        sumber: PROCUREMENT_SOURCE,
        data_per: dataPer(state),
        cara_hitung: raporNote(),
        ditemukan: true,
        pemasok: {
          ...vendorOut(v),
          po_terakhir_20: v.orders.map((o) => ({
            nomor_po: o.number, tanggal_po: day(o.date), status: PO_STATE_LABEL[o.state] || o.state, tanggal_datang: day(o.dueDate),
            perkiraan: o.estimated, persen_diterima: o.percentReceived, jumlah_baris: o.lineCount,
          })),
        },
      };
    }
    const result = await vendors.listVendors(user.entityId, {
      q: text(input.cari, 100), filter: VENDOR_FILTER_IN[input.saring] || null, page: 1, limit: rows(input.jumlah),
    }, { prices: false });
    return {
      sumber: PROCUREMENT_SOURCE,
      data_per: dataPer(state),
      cara_hitung: raporNote(),
      total_cocok: result.total,
      ditampilkan: result.items.length,
      pemasok: result.items.map(vendorOut),
    };
  },
});

const TOOLS = Object.freeze([stokBarang, jadwalKirim, gudangHariIni, statusPo, procurementHariIni, raporPemasok]);

module.exports = { TOOLS, STOCK_TOTAL, STOCK_VIEW, PROCUREMENT_VIEW };
