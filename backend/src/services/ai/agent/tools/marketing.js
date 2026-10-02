// Marketing for Prakasa AI: "Produk & channel" (/marketing/insights) and the
// campaign tracker (/marketing/campaigns), through the module's own services
// and with the pages' permission (marketing.insight.view).
//
//   - aggregates only, as on the page: never an invoice, a customer name or a
//     salesperson (Marketing has no sales.order.view);
//   - rupiah (revenue on DPP, campaign budget and result) only from the
//     `money` tools; leads, new customers and the campaign list are counts,
//     dates and states;
//   - never a purchase price or a margin; no web-analytics data (Google's own);
//   - private conversations only: this is division data.
const insights = require('../../../marketingInsights.service');
const campaigns = require('../../../marketingCampaigns.service');
const { text, int } = require('./_shared');

const VIEW = 'marketing.insight.view';
const INSIGHT_ROUTE = '/marketing/insights';
const CAMPAIGN_ROUTE = '/marketing/campaigns';
const SOURCE = 'Accurate, hanya dibaca, setelah disetujui Supervisor/Head Sales atau Retail Commerce';
const NOT_APPROVED = 'Data Accurate menunggu persetujuan: belum ada batch Sales/Retail Commerce yang disetujui, jadi angka penjualan belum ada.';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERFORMANCE_STATE = Object.freeze({
  draft: 'Kampanye masih draf: hasil belum diukur.',
  cancelled: 'Kampanye dibatalkan: hasil tidak diukur.',
  not_started: 'Kampanye belum dimulai.',
  no_data: 'Data Accurate yang disetujui belum mencapai masa kampanye ini.',
  not_reliable: NOT_APPROVED,
});

const schema = (properties = {}, required = undefined) => ({ type: 'object', properties, ...(required ? { required } : {}), additionalProperties: false });
const monthInput = { type: 'string', description: 'Bulan YYYY-MM (tidak boleh di masa depan). Kosong = bulan terakhir yang dicapai data Accurate' };

// The page's own read; a bad month comes back as a plain note, not an error.
async function readInsights(user, input) {
  const month = text(input.bulan, 7);
  if (month && !MONTH.test(month)) return { error: 'Bulan berbentuk YYYY-MM, misalnya 2026-09.' };
  try {
    return { data: await insights.insights(user.entityId, { month: month || insights.LATEST }) };
  } catch (e) {
    if (e instanceof insights.MarketingError) return { error: e.message };
    throw e;
  }
}

const at = (series, index) => (index >= 0 && series[index] !== undefined ? series[index] : null);

const channelProduct = {
  name: 'penjualan_channel_dan_produk',
  module: 'marketing-insights',
  label: 'Membaca penjualan per channel dan produk',
  description: 'Halaman Marketing "Produk & channel" untuk satu bulan, dari data Accurate yang sudah disetujui: revenue DPP (sebelum PPN, dikurangi retur, tanpa faktur uang muka) per channel bulan itu dan bulan sebelumnya, '
    + 'produk terlaris (revenue DPP, jumlah terjual, channel), serta produk yang paling naik dan paling turun. Pakai untuk "channel mana yang paling besar", "produk apa yang naik/turun". '
    + 'Hanya agregat: tidak pernah nomor faktur, nama customer, nama salesman, harga beli, atau margin.',
  inputSchema: schema({
    bulan: monthInput,
    jumlah: { type: 'integer', minimum: 1, maximum: 20, description: 'Maksimal produk terlaris (default 10)' },
  }),
  permission: VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const { data, error } = await readInsights(user, input);
    if (error) return { tersedia: false, catatan: error };
    if (!data.accurate) return { tersedia: false, bulan: data.month, rute: INSIGHT_ROUTE, catatan: NOT_APPROVED };
    const limit = int(input.jumlah, { max: 20, fallback: 10 });
    const cur = data.months.length - 1;
    const product = (p) => ({
      kode_barang: p.itemCode,
      nama_barang: p.itemName,
      revenue_dpp: p.revenue,
      revenue_dpp_bulan_lalu: p.prevRevenue,
      selisih_revenue_dpp: p.change,
      perubahan_persen: p.changePct,
      terjual: (p.qty || []).map((q) => `${q.qty} ${q.unit || ''}`.trim()),
      channel: (p.channels || []).map((c) => c.label),
    });
    return {
      tersedia: true,
      sumber: SOURCE,
      rute: `${INSIGHT_ROUTE}?month=${data.month}`,
      bulan: data.month,
      bulan_pembanding: data.prevMonth,
      data_accurate_sampai: data.dataThrough,
      revenue_dpp_bulan: data.kpis.revenue.value,
      revenue_dpp_bulan_lalu: data.kpis.revenue.previous,
      jumlah_produk_terjual: data.kpis.productsSold.value,
      jumlah_produk_terjual_bulan_lalu: data.kpis.productsSold.previous,
      per_channel: data.channels.map((c) => ({
        channel: c.label,
        revenue_dpp_bulan: at(c.revenue, cur),
        revenue_dpp_bulan_lalu: at(c.revenue, cur - 1),
        revenue_dpp_12_bulan: c.totalRevenue,
        jumlah_terjual_bulan: at(c.qty, cur),
      })),
      produk_terlaris: data.topProducts.slice(0, limit).map(product),
      produk_paling_naik: data.movers.rising.map(product),
      produk_paling_turun: data.movers.falling.map(product),
      catatan: `Revenue = DPP (sebelum PPN). Angka channel sudah dikurangi retur; angka produk adalah bagian DPP tiap baris faktur, sebelum retur. Faktur uang muka tidak dihitung.${
        data.qtyMixedUnits ? ' Jumlah terjual per channel mencampur satuan (ada barang tanpa rasio satuan di Accurate).' : ''
      } Channel marketplace ditagih satu faktur rekap per bulan, jadi bulan berjalan bisa masih 0.`,
    };
  },
};

const leadsCustomers = {
  name: 'lead_dan_customer_baru',
  module: 'marketing-insights',
  label: 'Membaca lead dan customer baru',
  description: 'Jumlah customer baru (NOO, dari faktur Accurate yang disetujui) per channel dan jumlah lead Sales per area untuk satu bulan: lead baru bulan itu dan bulan sebelumnya, '
    + 'per area total lead, yang masih terbuka, sudah dikunjungi, jadi customer, dan gugur. Pakai untuk "berapa customer baru bulan ini", "area mana yang paling banyak lead". '
    + 'Hanya jumlah: tanpa rupiah, tanpa nama lead atau customer, tanpa nama salesman, tanpa alamat dan kontak.',
  inputSchema: schema({
    bulan: monthInput,
    jumlah: { type: 'integer', minimum: 1, maximum: 30, description: 'Maksimal area (default 15)' },
  }),
  permission: VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const { data, error } = await readInsights(user, input);
    if (error) return { tersedia: false, catatan: error };
    const limit = int(input.jumlah, { max: 30, fallback: 15 });
    const cur = data.months.length - 1;
    return {
      tersedia: true,
      rute: `${INSIGHT_ROUTE}?month=${data.month}`,
      bulan: data.month,
      bulan_pembanding: data.prevMonth,
      lead_baru: data.leads.newThisMonth,
      lead_baru_bulan_lalu: data.leads.newPrevMonth,
      customer_baru: data.accurate ? data.kpis.newCustomers.value : null,
      customer_baru_bulan_lalu: data.accurate ? data.kpis.newCustomers.previous : null,
      customer_baru_per_channel: data.channels
        .map((c) => ({ channel: c.label, customer_baru: at(c.noo, cur) || 0, customer_baru_bulan_lalu: at(c.noo, cur - 1) || 0 }))
        .filter((c) => c.customer_baru || c.customer_baru_bulan_lalu),
      lead_per_area: data.leads.byArea.slice(0, limit).map((a) => ({
        area: a.area,
        total_lead: a.total,
        lead_baru_bulan_ini: a.newInMonth,
        masih_terbuka: a.open,
        sudah_dikunjungi: a.visited,
        jadi_customer: a.converted,
        gugur: a.dropped,
      })),
      catatan: data.accurate
        ? 'Customer baru = customer yang faktur pertamanya di bulan itu (Accurate, data yang disetujui). Lead dari catatan Sales di aplikasi, seluruh waktu per area.'
        : `${NOT_APPROVED} Customer baru belum bisa dihitung; lead tetap dari catatan Sales di aplikasi.`,
    };
  },
};

const campaignRow = (c) => ({
  id: c.id,
  nama: c.name,
  status: c.statusLabel,
  tujuan: c.objectiveLabel,
  channel: c.channelsLabel,
  mulai: c.startOn,
  selesai: c.endOn,
  lama_hari: c.days,
  lewat_tanggal_selesai: c.endedOpen,
  belum_mulai: c.upcoming,
  jumlah_produk_sasaran: c.itemCount,
  rute: `${CAMPAIGN_ROUTE}?open=${c.id}`,
});

const STATUS_INPUT = Object.freeze({ draf: 'draft', berjalan: 'berjalan', selesai: 'selesai', dibatalkan: 'dibatalkan' });

const campaignList = {
  name: 'daftar_kampanye',
  module: 'marketing-campaigns',
  label: 'Membaca daftar kampanye',
  description: 'Kampanye Marketing perusahaan: nama, status (Draf, Berjalan, Selesai, Dibatalkan), tujuan, channel, tanggal mulai dan selesai, jumlah produk sasaran, dan tanda kampanye yang masih Berjalan padahal sudah lewat tanggal selesainya '
    + '(perlu ditutup dan dicatat hasilnya). Pakai untuk "kampanye apa yang sedang berjalan", "kampanye mana yang sudah lewat tanggal". Untuk hasil satu kampanye pakai hasil_kampanye. '
    + 'Tanpa rupiah: tidak pernah anggaran atau revenue di alat ini.',
  inputSchema: schema({
    status: { type: 'string', enum: Object.keys(STATUS_INPUT), description: 'Saring menurut status' },
    hanya_lewat_tanggal: { type: 'boolean', description: 'true = hanya kampanye Berjalan yang sudah lewat tanggal selesai' },
    cari: { type: 'string', maxLength: 100, description: 'Bagian dari nama kampanye' },
    jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal kampanye (default 20)' },
  }),
  permission: VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const { rows, summary } = await campaigns.readCampaigns(user.entityId);
    const status = STATUS_INPUT[input.status] || null;
    const q = text(input.cari, 100).toLowerCase();
    const limit = int(input.jumlah, { max: 50, fallback: 20 });
    const match = rows.filter((c) => (!status || c.status === status)
      && (input.hanya_lewat_tanggal !== true || c.endedOpen)
      && (!q || String(c.name || '').toLowerCase().includes(q)));
    return {
      rute: CAMPAIGN_ROUTE,
      ringkasan: {
        total: summary.total, berjalan: summary.running, draf: summary.draft, selesai: summary.done, berjalan_lewat_tanggal_selesai: summary.endedOpen,
      },
      cocok: match.length,
      kampanye: match.slice(0, limit).map(campaignRow),
    };
  },
};

const campaignResult = {
  name: 'hasil_kampanye',
  module: 'marketing-campaigns',
  label: 'Membaca hasil kampanye',
  description: 'Satu kampanye Marketing dengan hasilnya (isi id dari daftar_kampanye): anggaran, produk sasaran, catatan, dan performa yang dihitung dari data Accurate yang disetujui — revenue DPP dan jumlah terjual produk sasaran '
    + 'di channel kampanye selama masa kampanye dibanding jumlah hari yang sama tepat sebelumnya, kenaikan dalam persen, dan customer baru. '
    + 'Hanya agregat: tidak pernah nomor faktur, nama customer, harga beli, atau margin.',
  inputSchema: schema({ id: { type: 'integer', minimum: 1, description: 'Id kampanye' } }, ['id']),
  permission: VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    if (!Number.isInteger(input.id) || input.id < 1) return { ditemukan: false, catatan: 'Isi id kampanye (lihat daftar_kampanye).' };
    let c;
    try {
      c = await campaigns.readCampaignWithPerformance(user.entityId, input.id);
    } catch (e) {
      if (e instanceof campaigns.CampaignError && e.status === 404) return { ditemukan: false, catatan: 'Kampanye tidak ditemukan.' };
      throw e;
    }
    const p = c.performance || {};
    return {
      ditemukan: true,
      kampanye: {
        ...campaignRow(c),
        anggaran_rupiah: c.budget,
        produk_sasaran: (c.items || []).slice(0, 50).map((i) => ({ kode_barang: i.itemNo, nama_barang: i.itemName })),
        catatan_kampanye: c.notes,
        dicatat_oleh: c.createdByName,
        terakhir_diperbarui: c.updatedAt,
      },
      hasil: p.state === 'ok'
        ? {
          terukur: true,
          sumber: SOURCE,
          data_accurate_sampai: p.dataThrough,
          masa_diukur: { dari: p.window.start, sampai: p.window.end, hari: p.window.days, belum_selesai: p.window.partial },
          masa_pembanding: { dari: p.baseline.start, sampai: p.baseline.end },
          revenue_dpp: p.revenue,
          revenue_dpp_pembanding: p.baselineRevenue,
          kenaikan_revenue_persen: p.upliftPct,
          jumlah_terjual: p.qty,
          jumlah_terjual_pembanding: p.baselineQty,
          kenaikan_jumlah_persen: p.qtyUpliftPct,
          customer_baru: p.noo,
          customer_baru_pembanding: p.baselineNoo,
          catatan: 'Pembanding = jumlah hari yang sama tepat sebelum kampanye. Kenaikan kosong bila pembandingnya nol. Revenue = bagian DPP tiap baris faktur, sebelum PPN, tanpa faktur uang muka.',
        }
        : { terukur: false, catatan: PERFORMANCE_STATE[p.state] || 'Hasil belum bisa diukur.' },
    };
  },
};

module.exports = [channelProduct, leadsCustomers, campaignList, campaignResult];
