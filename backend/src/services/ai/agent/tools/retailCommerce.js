// Retail Commerce (marketplace) for Prakasa AI: the same reads as the page
// /retail-commerce (services/retailCommerce.service.js), with the page's own
// permission (retail.insight.view). Everything comes from the approved
// Accurate mirror; nothing here calls Accurate or writes anywhere.
//
//   - rupiah (revenue on DPP, unpaid invoices) only from the `money` tools;
//   - the shipment tool carries counts, dates and states only (no SO value);
//   - never a purchase price, a margin, an address or a contact;
//   - private conversations only: this is division data.
const retail = require('../../../retailCommerce.service');
const { text, int } = require('./_shared');

const VIEW = 'retail.insight.view';
const ROUTE = '/retail-commerce';
const SOURCE = 'Accurate, hanya dibaca, setelah disetujui Supervisor/Head Sales atau Retail Commerce';
const BILLED_MONTHLY = 'Marketplace ditagih SATU faktur rekap per marketplace per bulan (bertanggal akhir bulan). '
  + 'Selama bulan berjalan angka revenue bulan ini bisa 0: itu belum ditagih, bukan penjualan turun. Pakai bulan_terakhir_berfaktur.';
const NOT_READY = Object.freeze({
  no_department: 'Perusahaan ini belum punya divisi Retail Commerce.',
  app_mode: 'Transaksi dicatat di aplikasi, bukan Accurate: halaman Retail Commerce belum punya angka.',
  not_approved: 'Data Accurate menunggu persetujuan: belum ada batch Sales/Retail Commerce yang disetujui, jadi belum ada angka.',
});
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const notReady = (out) => ({ tersedia: false, catatan: NOT_READY[out.reason] || 'Data belum tersedia.', rute: ROUTE });
const schema = (properties = {}) => ({ type: 'object', properties, additionalProperties: false });

const ringkasan = {
  name: 'ringkasan_marketplace',
  module: 'retail-commerce',
  label: 'Membaca ringkasan marketplace',
  description: 'Ringkasan Retail Commerce per marketplace (Shopee, Tokopedia, …) dari data Accurate yang sudah disetujui: revenue DPP (sebelum PPN, sudah dikurangi retur, tanpa faktur uang muka) '
    + 'bulan ini, bulan lalu dan total jendela, jumlah SO dan faktur, retur, tagihan yang belum dibayar marketplace, dan SO yang belum terkirim. '
    + 'PENTING: marketplace ditagih satu faktur rekap per bulan, jadi revenue bulan berjalan sering masih 0 — sebutkan itu dan pakai bulan terakhir yang sudah berfaktur. '
    + 'Pakai untuk "bagaimana penjualan marketplace", "marketplace mana yang terbesar". Tidak pernah harga beli, margin, nama pembeli akhir, alamat, atau kontak.',
  inputSchema: schema({
    bulan: { type: 'integer', minimum: 3, maximum: 24, description: 'Panjang jendela dalam bulan (default 12)' },
  }),
  permission: VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const out = await retail.overview(user, { months: input.bulan });
    if (!out.connected) return notReady(out);
    const k = out.kpis;
    const last = out.months.length - 1;
    return {
      tersedia: true,
      sumber: SOURCE,
      rute: ROUTE,
      jendela: { dari_bulan: out.months[0].key, sampai_bulan: out.months[last].key },
      bulan_ini: {
        bulan: out.months[last].key,
        revenue_dpp: k.revenueThisMonth,
        revenue_dpp_bulan_lalu: k.revenueLastMonth,
        selisih_revenue_dpp: k.revenueChange,
        jumlah_faktur: k.invoicesThisMonth,
        jumlah_so: k.ordersThisMonth,
        jumlah_so_bulan_lalu: k.ordersLastMonth,
        rata_rata_dpp_per_faktur: k.aovThisMonth,
        retur_dpp: k.returnsThisMonth,
        persen_retur: k.returnRateThisMonth,
        faktur_uang_muka_tidak_dihitung: k.dpInvoicesThisMonth,
      },
      bulan_terakhir_berfaktur: out.latestMonth ? out.latestMonth.key : null,
      revenue_dpp_jendela: out.windowRevenue,
      tagihan_belum_dibayar: {
        jumlah_faktur: k.receivable.invoices,
        sisa_tagihan_rupiah: k.receivable.amount,
        faktur_lewat_jatuh_tempo: k.receivable.overdueInvoices,
        sisa_tagihan_lewat_jatuh_tempo_rupiah: k.receivable.overdue,
      },
      pengiriman: { so_belum_terkirim: k.shipments.open, so_terlambat: k.shipments.late, so_tertua: k.shipments.oldest },
      per_marketplace: out.platforms.map((p) => ({
        marketplace: p.label,
        revenue_dpp_jendela: p.revenue,
        porsi_persen: p.share,
        revenue_dpp_bulan_ini: p.revenueThisMonth,
        revenue_dpp_bulan_lalu: p.revenueLastMonth,
        jumlah_so: p.orders,
        jumlah_faktur: p.invoices,
        rata_rata_dpp_per_faktur: p.aov,
        retur_dpp: p.returns,
        persen_retur: p.returnRate,
        faktur_belum_dibayar: p.receivable.invoices,
        sisa_tagihan_rupiah: p.receivable.amount,
        sisa_tagihan_lewat_jatuh_tempo_rupiah: p.receivable.overdue,
        jatuh_tempo_tertua: p.receivable.oldestDue,
        so_belum_terkirim: p.shipments.open,
        so_terlambat: p.shipments.late,
      })),
      revenue_dpp_per_bulan: out.months.map((m, i) => ({
        bulan: m.key, revenue_dpp: out.totals.revenue[i], jumlah_faktur: out.totals.invoices[i], jumlah_so: out.totals.orders[i],
      })),
      catatan: `${BILLED_MONTHLY} Revenue = DPP faktur dikurangi retur; faktur uang muka tidak dihitung. Tagihan belum dibayar = sisa faktur termasuk PPN.`,
    };
  },
};

const produk = {
  name: 'produk_terlaris_marketplace',
  module: 'retail-commerce',
  label: 'Membaca produk terlaris marketplace',
  description: 'Produk terlaris Retail Commerce dalam satu bulan (default: bulan terakhir yang sudah berfaktur), urut revenue DPP — bagian DPP tiap baris faktur, sebelum PPN, tanpa faktur uang muka — '
    + 'dengan jumlah terjual per satuan, perubahan dari bulan sebelumnya, dan marketplace tempat produk itu terjual. Data Accurate yang sudah disetujui; marketplace ditagih per bulan. '
    + 'Tidak pernah harga beli, margin, harga satuan, atau nama pembeli.',
  inputSchema: schema({
    bulan: { type: 'string', description: 'Bulan YYYY-MM (tidak boleh di masa depan). Kosong = bulan terakhir yang berfaktur' },
    jumlah: { type: 'integer', minimum: 1, maximum: retail.TOP_PRODUCTS, description: `Maksimal produk (default 10, paling banyak ${retail.TOP_PRODUCTS})` },
  }),
  permission: VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const month = text(input.bulan, 7);
    if (month && !MONTH.test(month)) return { tersedia: false, catatan: 'Bulan berbentuk YYYY-MM, misalnya 2026-09.' };
    const out = await retail.topProducts(user, { month: month || undefined });
    if (!out.connected) return notReady(out);
    const limit = int(input.jumlah, { max: retail.TOP_PRODUCTS, fallback: 10 });
    return {
      tersedia: true,
      sumber: SOURCE,
      rute: ROUTE,
      bulan: out.month.key,
      bulan_pembanding: out.prevMonth.key,
      revenue_dpp_bulan: out.monthRevenue,
      jumlah_produk_terjual: out.products,
      produk: out.rows.slice(0, limit).map((p) => ({
        peringkat: p.rank,
        kode_barang: p.code,
        nama_barang: p.name,
        revenue_dpp: p.revenue,
        revenue_dpp_bulan_pembanding: p.prevRevenue,
        perubahan_persen: p.changePct,
        baru_terjual: p.isNew,
        porsi_persen: p.share,
        terjual: (p.qtyByUnit || []).map((q) => `${q.qty} ${q.unit || ''}`.trim()),
        marketplace: p.platforms.map((x) => x.label),
      })),
      catatan: `${out.fallback
        ? `Bulan berjalan belum punya faktur (marketplace ditagih per bulan), jadi yang ditampilkan bulan ${out.month.key}.`
        : BILLED_MONTHLY} Nilai produk = DPP baris faktur sebelum retur (porsi dari total baris faktur), jadi bisa lebih besar dari omzet bersih retur; retur tidak dialokasikan ke produk.`,
    };
  },
};

const pengiriman = {
  name: 'pengiriman_marketplace_tertunda',
  module: 'retail-commerce',
  label: 'Membaca pengiriman marketplace yang tertunda',
  description: 'SO Retail Commerce yang belum terkirim penuh (Accurate, data yang disetujui), paling lama dulu: nomor SO, tanggal, marketplace, persen terkirim, janji kirim, hari terbuka, hari terlambat. '
    + 'SO rekap bulanan marketplace tidak pernah dihitung terlambat. Pakai untuk "pesanan marketplace mana yang belum dikirim / terlambat". '
    + 'Hanya jumlah, tanggal dan status: tanpa rupiah, tanpa alamat, tanpa kontak.',
  inputSchema: schema({
    hanya_terlambat: { type: 'boolean', description: 'true = hanya SO yang lewat janji kirim' },
    jumlah: { type: 'integer', minimum: 1, maximum: retail.SHIPMENTS_LIMIT, description: 'Maksimal SO (default 20)' },
  }),
  permission: VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const out = await retail.pendingShipments(user);
    if (!out.connected) return notReady(out);
    const limit = int(input.jumlah, { max: retail.SHIPMENTS_LIMIT, fallback: 20 });
    const rows = input.hanya_terlambat === true ? out.rows.filter((r) => r.late) : out.rows;
    return {
      tersedia: true,
      sumber: SOURCE,
      rute: ROUTE,
      total_so_belum_terkirim: out.total,
      terlambat_di_daftar: out.rows.filter((r) => r.late).length,
      standar_kirim_hari: out.shipSlaDays,
      so: rows.slice(0, limit).map((r) => ({
        nomor_so: r.number,
        tanggal_so: r.date,
        marketplace: r.platform,
        customer: r.customerName,
        status_accurate: r.status,
        persen_terkirim: r.percentShipped,
        janji_kirim: r.promisedDate,
        hari_terbuka: r.daysOpen,
        terlambat: r.late,
        terlambat_hari: r.late ? r.daysLate : 0,
        so_rekap_bulanan: r.recap,
        ...(r.judged ? {} : { keterangan: 'Ada batch Accurate SO ini yang menunggu persetujuan: keterlambatan belum bisa dinilai.' }),
      })),
      ...(out.total > out.rows.length ? { catatan: `Halaman hanya memuat ${out.limit} SO tertua dari ${out.total}.` } : {}),
    };
  },
};

const tagihan = {
  name: 'tagihan_marketplace_belum_lunas',
  module: 'retail-commerce',
  label: 'Membaca tagihan marketplace yang belum lunas',
  description: 'Faktur Retail Commerce yang belum dibayar penuh oleh marketplace (Accurate, data yang disetujui), jatuh tempo paling lama dulu: nomor faktur, tanggal, jatuh tempo, marketplace, '
    + 'total faktur (termasuk PPN), yang sudah dibayar, sisa tagihan dan hari lewat jatuh tempo. Faktur uang muka tidak dihitung. '
    + 'Tidak pernah jurnal, data pajak, rekening, atau kontak marketplace.',
  inputSchema: schema({
    hanya_lewat_jatuh_tempo: { type: 'boolean', description: 'true = hanya faktur yang sudah lewat jatuh tempo' },
    jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal faktur (default 20)' },
  }),
  permission: VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const out = await retail.receivables(user);
    if (!out.connected) return notReady(out);
    const limit = int(input.jumlah, { max: 50, fallback: 20 });
    const rows = input.hanya_lewat_jatuh_tempo === true ? out.rows.filter((r) => r.daysOverdue > 0) : out.rows;
    const sum = (list, key) => Math.round(list.reduce((a, r) => a + (Number(r[key]) || 0), 0) * 100) / 100;
    return {
      tersedia: true,
      sumber: SOURCE,
      rute: ROUTE,
      total_faktur_belum_lunas: out.total,
      sisa_tagihan_rupiah_di_daftar: sum(out.rows, 'outstanding'),
      faktur_lewat_jatuh_tempo_di_daftar: out.rows.filter((r) => r.daysOverdue > 0).length,
      faktur: rows.slice(0, limit).map((r) => ({
        nomor_faktur: r.number,
        tanggal_faktur: r.date,
        jatuh_tempo: r.dueDate,
        marketplace: r.platform,
        total_faktur_rupiah: r.total,
        sudah_dibayar_rupiah: r.paid,
        sisa_tagihan_rupiah: r.outstanding,
        lewat_jatuh_tempo_hari: r.daysOverdue,
      })),
      catatan: `Sisa tagihan termasuk PPN, seperti di Accurate. Faktur uang muka tidak dihitung.${out.total > out.rows.length ? ` Halaman hanya memuat ${out.limit} faktur dari ${out.total}.` : ''}`,
    };
  },
};

module.exports = [ringkasan, produk, pengiriman, tagihan];
