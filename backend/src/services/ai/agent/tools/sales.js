// Prakasa AI reads the Sales module (Wave B): Sales Pipeline, Customers, Leads,
// Data Sales and Data Accurate.
//
// Rules these tools keep (docs/sales-module.md, docs/prakasa-ai-rencana.md §9):
//   - read only, through the SAME handlers and services the pages call, so the
//     entity binding and "a Sales Member sees only their own records"
//     (sales_owner_links / mapped salesperson name) apply exactly as on the page;
//   - the route's permission is checked here too (the handlers rely on the
//     route middleware for it);
//   - rupiah only in the two `money` tools, behind sales.order.view (the page
//     rule "money is only for those who may see orders": Marketing has none);
//   - transaction figures are approved Accurate data once the first batch is
//     approved; before that the old recap, said in `catatan`;
//   - never a customer's phone, e-mail, address or contact person, never a
//     purchase price or margin, never coordinates of an outlet.
const dataCtrl = require('../../../../controllers/salesData.controller');
const customersCtrl = require('../../../../controllers/salesCustomers.controller');
const leadsCtrl = require('../../../../controllers/salesLeads.controller');
const ordersCtrl = require('../../../../controllers/salesOrders.controller');
const salesActions = require('../../../salesActions.service');
const salesTargets = require('../../../salesTargets.service');
const salesFacts = require('../../../salesFacts');
const salesSource = require('../../../salesSource');
const batches = require('../../../salesAccurateBatches.service');
const { ACTIVE_DAYS, LOST_DAYS, LEAD_FOLLOWUP_DAYS } = require('../../../salesStatus');
const { WIB_OFFSET_MS, todayWib } = require('../../../../utils/wibTime');
const { hasPerm, anyPerm, denied, text, int } = require('./_shared');

const CUSTOMER_VIEW = 'sales.customer.view';
const ORDER_VIEW = 'sales.order.view';
const VIEW_ALL = 'sales.data.view_all';
const BATCH_VIEW = Object.freeze(['accurate.batch.view', 'sales.master.manage']);
const MAX_ROWS = 50;
const NOTE_CHARS = 300;

const rows = (v, fallback = 15) => int(v, { min: 1, max: MAX_ROWS, fallback });
const positive = (v) => (Number.isInteger(v) && v > 0 ? v : null);
// DATE columns arrive as UTC-midnight Dates: the calendar day.
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
const short = (v, max = NOTE_CHARS) => (v == null || v === '' ? null : String(v).slice(0, max));
const num = (v) => (v == null ? null : Number(v));
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

// Runs one of the module's own GET handlers for this user and hands back what
// the page would receive ({ data, meta }). Nothing is written to a socket.
async function page(handler, user, { query = {}, params = {} } = {}) {
  let status = 200;
  let body = null;
  let failure = null;
  const res = {
    status(code) { status = code; return res; },
    json(payload) { body = payload; return res; },
  };
  await handler({ user, query, params, body: {} }, res, (e) => { failure = e || new Error('Data tidak bisa dibaca'); });
  if (failure) throw failure;
  if (!body || body.success !== true) {
    throw Object.assign(new Error(body?.error?.message || 'Data tidak bisa dibaca'), { status: status === 200 ? 500 : status, code: body?.error?.code || 'ERROR' });
  }
  return { data: body.data, meta: body.meta || {} };
}

// The same, but a record the user may not see (or that does not exist) is null.
async function pageOrNull(handler, user, request) {
  try {
    return await page(handler, user, request);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

const scopeText = (user) => (hasPerm(user, VIEW_ALL)
  ? 'semua data Sales'
  : 'hanya data milik Anda (Anda PIC-nya, atau nama sales-nya dipetakan ke akun Anda)');

// Where the transaction figures come from right now, in words.
async function sourceOf(user) {
  const accurate = await salesSource.numbersFromAccurate(user.entityId);
  const reliable = await salesSource.transactionsReliable(user.entityId);
  if (accurate) return { accurate, reliable, sumber: 'Accurate, hanya dibaca, hanya data yang sudah disetujui Supervisor/Head divisi' };
  if (reliable) return { accurate, reliable, sumber: 'transaksi yang dicatat di aplikasi' };
  return {
    accurate,
    reliable,
    sumber: 'data lama (rekap), belum tersambung Accurate',
    catatan: 'Belum tersambung Accurate: data Accurate menunggu persetujuan, jadi angka transaksi masih dari data lama dan belum lengkap. Jangan dipakai sebagai angka pembukuan.',
  };
}
const sourceFields = (src) => ({ sumber: src.sumber, ...(src.catatan ? { catatan: src.catatan } : {}) });

const customerRoute = (id) => (id ? `/sales/customers/${id}` : '/sales/customers');
const leadRoute = (id) => `/sales/leads?lead=${id}`;

// ------------------------------------------------------------ Perlu tindakan

const ACTION_TYPES = Object.freeze({ dormant: 'dormant', belum_terkirim: 'no_do', tagihan_terlambat: 'overdue', lead: 'leads' });
const ORDER_ACTIONS = new Set(['no_do', 'overdue']);

const ACTION_ROW = {
  dormant: (r) => ({
    id_customer: r.id,
    nama: r.title,
    kode: r.reference,
    channel: r.context,
    nama_sales: r.salesPersonName || null,
    order_terakhir: day(r.since),
    hari_tanpa_order: r.days,
    sisa_hari_sebelum_lost: r.days === null ? null : Math.max(0, LOST_DAYS - r.days),
    rute: customerRoute(r.id),
  }),
  no_do: (r) => ({
    nomor_so: r.title,
    customer: r.reference,
    channel: r.context,
    nama_sales: r.salesPersonName || null,
    tanggal: day(r.since),
    hari_berjalan: r.days,
    keterangan: r.note || 'belum ada surat jalan',
    rute: r.source === 'accurate' ? customerRoute(r.customerId) : `/sales/orders/${r.id}`,
  }),
  overdue: (r) => ({
    nomor_faktur: r.title,
    customer: r.reference,
    nama_sales: r.salesPersonName || null,
    jatuh_tempo: day(r.since),
    terlambat_hari: r.days,
    rute: r.source === 'accurate' ? customerRoute(r.customerId) : `/sales/orders/${r.id}`,
  }),
  leads: (r) => ({
    id_lead: r.id,
    nama: r.title,
    kode_outlet: r.reference,
    area: r.context,
    nama_sales: r.salesPersonName || null,
    kunjungan_terakhir: day(r.since),
    hari_sejak_kunjungan: r.days,
    catatan_terakhir: short(r.note),
    rute: leadRoute(r.id),
  }),
};

const perluTindakan = {
  name: 'sales_perlu_tindakan',
  module: ['sales-pipeline', 'sales-customers', 'sales-leads', 'sales-orders'],
  label: 'Membaca daftar Perlu tindakan Sales',
  description: 'Daftar "Perlu tindakan hari ini" Sales, sama dengan di halaman Sales Pipeline: customer dormant '
    + `(${ACTIVE_DAYS}–${LOST_DAYS - 1} hari tanpa order, sebelum jadi Lost), SO yang belum terkirim (30 hari terakhir), faktur lewat jatuh tempo, `
    + `dan lead yang belum dikunjungi ${LEAD_FOLLOWUP_DAYS} hari atau lebih. Memberi jumlah tiap jenis dan daftar satu jenis (isi jenis; bawaan dormant). `
    + 'Tanggal order, SO dan faktur dari data Accurate yang sudah disetujui. Sales Member hanya mendapat data miliknya. Jenis SO dan tagihan hanya untuk yang boleh melihat Data Sales. '
    + 'Pakai untuk "siapa yang perlu saya hubungi" dan "apa yang harus saya kerjakan hari ini". '
    + 'Hanya nama, tanggal dan jumlah hari: tanpa rupiah (pakai piutang_sales), tanpa nomor telepon, alamat, atau kontak customer.',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: Object.keys(ACTION_TYPES), description: 'Daftar yang diminta (bawaan: dormant)' },
      cari: { type: 'string', maxLength: 100, description: 'Nama/kode customer, nomor SO atau faktur, nama sales' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal baris (bawaan 15)' },
    },
    additionalProperties: false,
  },
  permission: CUSTOMER_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    if (!hasPerm(user, CUSTOMER_VIEW)) throw denied();
    const withOrders = hasPerm(user, ORDER_VIEW);
    const type = ACTION_TYPES[input.jenis] || 'dormant';
    if (ORDER_ACTIONS.has(type) && !withOrders) throw denied('Daftar SO dan tagihan hanya untuk yang boleh melihat Data Sales.');
    const src = await sourceOf(user);
    const summary = await salesActions.counts(user);
    const limit = rows(input.jumlah);
    const list = await salesActions.list(user, type, { page: 1, limit, offset: 0, q: text(input.cari, 100) });
    return {
      ...sourceFields(src),
      cakupan: scopeText(user),
      ringkasan: {
        customer_dormant: summary.counts.dormant,
        ...(withOrders ? { so_belum_terkirim: summary.counts.no_do, tagihan_terlambat: summary.counts.overdue } : {}),
        lead_perlu_dikunjungi: summary.counts.leads,
        ...(withOrders ? { mendesak_di_badge_menu: src.reliable ? summary.badge : 0 } : {}),
      },
      aturan: `Aktif < ${ACTIVE_DAYS} hari sejak order terakhir; Dormant ${ACTIVE_DAYS}–${LOST_DAYS - 1} hari; Lost ${LOST_DAYS} hari atau lebih, atau belum pernah order.`,
      jenis: input.jenis && ACTION_TYPES[input.jenis] ? input.jenis : 'dormant',
      total: list.total,
      ditampilkan: list.items.length,
      daftar: list.items.map(ACTION_ROW[type]),
      rute: '/sales/pipeline',
    };
  },
};

// ------------------------------------------------------------------ Pipeline

const STAGES = Object.freeze(['prospek', 'belum_order', 'order_pertama', 'aktif', 'dormant', 'lost']);

const pipeline = {
  name: 'pipeline_sales',
  module: ['sales-pipeline'],
  label: 'Membaca Sales Pipeline',
  description: 'Sales Pipeline (funnel) yang dihitung otomatis dari kunjungan dan order: jumlah di tiap tahap — prospek dikunjungi, terdaftar belum order, '
    + 'order pertama (NOO), aktif, dormant, lost. Isi tahap untuk daftar customer atau lead di tahap itu (mis. lost atau dormant yang perlu ditindaklanjuti), '
    + 'urut yang paling mendesak. Tanggal order mengikuti data Accurate yang sudah disetujui. Sales Member hanya mendapat data miliknya. '
    + 'Hanya jumlah, nama dan tanggal: tanpa rupiah, tanpa nomor telepon, alamat, atau kontak customer.',
  inputSchema: {
    type: 'object',
    properties: {
      tahap: { type: 'string', enum: STAGES, description: 'Tahap yang daftarnya diminta; kosong = hanya jumlah per tahap' },
      cari: { type: 'string', maxLength: 100, description: 'Nama, kode, channel atau nama sales di tahap itu' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal baris (bawaan 15)' },
    },
    additionalProperties: false,
  },
  permission: ['sales.pipeline.view', CUSTOMER_VIEW],
  privateOnly: true,
  async run(user, input = {}) {
    if (!anyPerm(user, ['sales.pipeline.view', CUSTOMER_VIEW])) throw denied();
    const stage = STAGES.includes(input.tahap) ? input.tahap : null;
    const src = await sourceOf(user);
    const { data, meta } = await page(dataCtrl.funnel, user, {
      query: { stage: stage || 'dormant', q: stage ? text(input.cari, 100) : '', page: 1, limit: stage ? rows(input.jumlah) : 1 },
    });
    const out = {
      ...sourceFields(src),
      cakupan: scopeText(user),
      tahap: data.stages.map((s) => ({ tahap: s.key, nama: s.label, keterangan: s.hint, jumlah: s.count })),
      rute: stage ? `/sales/pipeline?tahap=${stage}` : '/sales/pipeline',
    };
    if (!stage) return out;
    return {
      ...out,
      tahap_dipilih: stage,
      total: meta.total,
      ditampilkan: data.items.length,
      daftar: data.items.map((r) => (r.kind === 'lead'
        ? {
          id_lead: r.id, nama: r.name, kode_outlet: r.code, area: r.channel, nama_sales: r.salesPersonName || null,
          kunjungan_terakhir: day(r.lastVisitDate), hari_sejak_kunjungan: r.daysSinceVisit, rute: leadRoute(r.id),
        }
        : {
          id_customer: r.id, nama: r.name, kode: r.code, channel: r.channel, nama_sales: r.salesPersonName || null,
          order_pertama: day(r.nooDate), order_terakhir: day(r.lastOrderDate), hari_sejak_order: r.daysSinceOrder, rute: customerRoute(r.id),
        })),
    };
  },
};

// --------------------------------------------------------- Customers & leads

const CUSTOMER_STATUSES = Object.freeze(['aktif', 'dormant', 'lost']);
const LEAD_STATUSES = Object.freeze({ terbuka: 'open', perlu_dikunjungi: 'needs_visit', jadi_customer: 'converted', tidak_berminat: 'dropped', semua: 'all' });

const leadState = (r) => {
  if (r.customerId) return 'sudah jadi customer';
  return r.status === 'dropped' ? 'tidak berminat' : 'terbuka';
};

const customerRow = (r) => ({
  id_customer: r.id,
  kode: r.code,
  nama: r.name,
  channel: r.channel,
  kota: r.city || null,
  segmen: r.segment || null,
  status: r.status,
  order_pertama: day(r.nooDate),
  order_terakhir: day(r.lastOrderDate),
  hari_sejak_order: r.daysSinceOrder,
  pic: r.ownerName || null,
  nama_sales: r.salesPersonName || null,
  rute: customerRoute(r.id),
});

const leadRow = (r) => ({
  id_lead: r.id,
  kode_outlet: r.outletCode,
  nama: r.name,
  area: r.area || null,
  status: leadState(r),
  perlu_dikunjungi: !r.customerId && r.status === 'open' && (r.daysSinceVisit === null || r.daysSinceVisit >= LEAD_FOLLOWUP_DAYS),
  kunjungan_pertama: day(r.firstVisitDate),
  kunjungan_terakhir: day(r.lastVisitDate),
  hari_sejak_kunjungan: r.daysSinceVisit,
  jumlah_kunjungan: num(r.visitCount),
  catatan_terakhir: short(r.lastNote),
  nama_sales: r.salesPersonName || null,
  ...(r.customerId ? { jadi_customer: r.customerName || null, id_customer: r.customerId } : {}),
  rute: leadRoute(r.id),
});

async function customerDetail(user, id) {
  const found = await pageOrNull(customersCtrl.detail, user, { params: { id: String(id) } });
  if (!found) return { ditemukan: false, catatan: 'Customer tidak ditemukan, atau bukan customer milik Anda.' };
  const c = found.data.customer;
  const visits = await page(customersCtrl.visits, user, { params: { id: String(id) }, query: { page: 1, limit: 5 } });
  const orders = found.data.summary.orders;
  return {
    ditemukan: true,
    customer: {
      id_customer: c.id,
      kode: c.customer_code,
      nama: c.name,
      channel: c.channel,
      kota: c.city || null,
      segmen: c.segment || null,
      status: c.status,
      order_pertama: day(c.noo_date),
      order_terakhir: day(c.last_order_date),
      hari_sejak_order: c.daysSinceOrder === null || c.daysSinceOrder === undefined ? null : Number(c.daysSinceOrder),
      pic: c.ownerName || null,
      nama_sales: c.sales_person_name || null,
      jumlah_kunjungan: found.data.summary.visits,
      ...(orders ? { jumlah_dokumen_penjualan: orders.count, satuan_dokumen: orders.unit || 'sales order' } : {}),
      rute: customerRoute(c.id),
    },
    kunjungan_terakhir: visits.data.map((v) => ({
      tanggal: day(v.visitDate), nama_sales: v.salesPersonName || null, ringkasan: short(v.summary), durasi_menit: num(v.durationMinutes),
    })),
  };
}

async function leadDetail(user, id) {
  const found = await pageOrNull(leadsCtrl.leadDetail, user, { params: { id: String(id) } });
  if (!found) return { ditemukan: false, catatan: 'Lead tidak ditemukan, atau bukan lead milik Anda.' };
  const l = found.data.lead;
  return {
    ditemukan: true,
    lead: {
      id_lead: l.id,
      kode_outlet: l.outletCode,
      nama: l.name,
      area: l.area || null,
      status: leadState(l),
      kunjungan_pertama: day(l.firstVisitDate),
      kunjungan_terakhir: day(l.lastVisitDate),
      jumlah_kunjungan: num(l.visitCount),
      nama_sales: l.salesPersonName || null,
      ...(l.customerId ? { jadi_customer: l.customerName || null, id_customer: l.customerId } : {}),
      rute: leadRoute(l.id),
    },
    kunjungan: found.data.visits.slice(0, 10).map((v) => ({
      tanggal: day(v.visitDate), nama_sales: v.salesPersonName || null, ringkasan: short(v.summary),
      durasi_menit: num(v.durationMinutes), terencana: Boolean(v.isPlanned),
    })),
    jumlah_kunjungan_tercatat: found.data.visits.length,
  };
}

const customerLead = {
  name: 'customer_lead_sales',
  module: ['sales-customers', 'sales-leads'],
  label: 'Mencari customer dan lead',
  description: 'Mencari customer dan lead (outlet yang dikunjungi tapi belum jadi customer). Customer: kode, nama, channel, kota, status Aktif/Dormant/Lost, '
    + 'tanggal order terakhir, PIC dan nama sales. Lead: kode outlet, area, status, kunjungan terakhir, jumlah kunjungan, catatan kunjungan terakhir. '
    + 'Saring dengan cari, status_customer, channel, atau status_lead; isi id_customer atau id_lead untuk satu record beserta kunjungan terakhirnya. '
    + 'Sales Member hanya mendapat customer dan lead miliknya. Tanggal order mengikuti data Accurate yang sudah disetujui. '
    + 'Tanpa rupiah (pakai omzet_sales atau piutang_sales), dan tidak pernah nomor telepon, email, alamat, koordinat, atau nama kontak customer.',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: ['customer', 'lead'], description: 'Kosong = keduanya' },
      cari: { type: 'string', maxLength: 100, description: 'Nama, kode customer/outlet, area, atau nama sales' },
      status_customer: { type: 'string', enum: CUSTOMER_STATUSES },
      channel: { type: 'string', maxLength: 40, description: 'Channel customer persis, mis. GT, MT, HRC' },
      status_lead: { type: 'string', enum: Object.keys(LEAD_STATUSES), description: 'Bawaan: terbuka (semua bila ada kata cari)' },
      id_customer: { type: 'integer', minimum: 1, description: 'Rincian satu customer' },
      id_lead: { type: 'integer', minimum: 1, description: 'Rincian satu lead dengan riwayat kunjungannya' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal baris per daftar (bawaan 15)' },
    },
    additionalProperties: false,
  },
  permission: CUSTOMER_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    if (!hasPerm(user, CUSTOMER_VIEW)) throw denied();
    const src = await sourceOf(user);
    const base = { ...sourceFields(src), cakupan: scopeText(user) };
    if (positive(input.id_customer)) return { ...base, ...(await customerDetail(user, input.id_customer)) };
    if (positive(input.id_lead)) return { ...base, ...(await leadDetail(user, input.id_lead)) };

    const q = text(input.cari, 100);
    const limit = rows(input.jumlah);
    const out = { ...base };
    if (input.jenis !== 'lead') {
      const { data, meta } = await page(customersCtrl.list, user, {
        query: {
          q, page: 1, limit,
          ...(CUSTOMER_STATUSES.includes(input.status_customer) ? { status: input.status_customer } : {}),
          ...(text(input.channel, 40) ? { channel: text(input.channel, 40) } : {}),
        },
      });
      out.customer = { total: meta.total, ditampilkan: data.length, daftar: data.map(customerRow), channel_tersedia: meta.channels };
    }
    if (input.jenis !== 'customer') {
      const status = LEAD_STATUSES[input.status_lead] || (q ? 'all' : 'open');
      const { data, meta } = await page(leadsCtrl.listLeads, user, { query: { q, status, page: 1, limit } });
      out.lead = {
        total: meta.total,
        ditampilkan: data.length,
        ringkasan: {
          terbuka: meta.counts.open, perlu_dikunjungi: meta.counts.needs_visit, jadi_customer: meta.counts.converted,
          tidak_berminat: meta.counts.dropped, semua: meta.counts.all,
        },
        aturan: `Perlu dikunjungi = belum jadi customer dan belum dikunjungi lagi ${meta.followupDays} hari atau lebih.`,
        daftar: data.map(leadRow),
      };
    }
    return out;
  },
};

// ------------------------------------------------------------- Sales orders

const ORDER_STATUSES = Object.freeze({ belum_terkirim: 'no_do', belum_difaktur: 'no_invoice', belum_lunas: 'unpaid', terlambat_bayar: 'overdue', lunas: 'paid' });

// Billing state in words, the same as the Data Sales page (revision F01): an
// order with no invoice is never "lunas", a partly billed one says so, and a
// missing amount is "belum tersedia". The amounts stay with the money tool.
function billingState(r) {
  const status = r.billingStatus
    || (!r.invoiceNumbers ? 'not_invoiced' : r.outstandingAmount === null || r.outstandingAmount === undefined ? 'unknown' : Number(r.outstandingAmount) > 0 ? 'unpaid' : 'paid');
  if (status === 'not_invoiced') return 'belum difaktur';
  if (status === 'unknown') return 'data pembayaran belum tersedia';
  if (status === 'partly_billed') return `faktur lunas, SO baru ditagih sebagian${r.invoiceCoverage != null ? ` (${Number(r.invoiceCoverage)}%)` : ''}`;
  if (status === 'paid') return 'lunas';
  return r.daysOverdue ? `belum lunas, terlambat ${Number(r.daysOverdue)} hari` : 'belum lunas';
}

const statusOrder = {
  name: 'status_sales_order',
  module: ['sales-orders'],
  label: 'Membaca status sales order',
  description: 'Status sales order dari SO sampai pengiriman dan faktur: nomor SO, tanggal, customer, channel, pengiriman (persen terkirim dari Accurate atau nomor surat jalan), '
    + 'nomor faktur, status tagihan (belum difaktur, belum lunas, terlambat, faktur lunas tetapi SO baru ditagih sebagian, lunas, data pembayaran belum tersedia) dan jatuh tempo. Cari dengan nomor SO atau nama customer, atau saring status '
    + '(belum_terkirim, belum_difaktur, belum_lunas, terlambat_bayar, lunas), periode dan channel. Untuk satu SO, surat jalannya ikut ditampilkan. '
    + 'Data transaksi dari Accurate yang sudah disetujui; Sales Member hanya mendapat SO customer miliknya. '
    + 'Tanpa rupiah (pakai piutang_sales atau omzet_sales), tanpa harga barang, tanpa alamat atau kontak customer.',
  inputSchema: {
    type: 'object',
    properties: {
      nomor: { type: 'string', maxLength: 100, description: 'Nomor SO, atau nama/kode customer' },
      status: { type: 'string', enum: Object.keys(ORDER_STATUSES) },
      id_customer: { type: 'integer', minimum: 1 },
      channel: { type: 'string', maxLength: 40 },
      dari: { type: 'string', description: 'Tanggal SO mulai (YYYY-MM-DD)' },
      sampai: { type: 'string', description: 'Tanggal SO sampai (YYYY-MM-DD)' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal SO (bawaan 10)' },
    },
    additionalProperties: false,
  },
  permission: ORDER_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    if (!hasPerm(user, ORDER_VIEW)) throw denied();
    const src = await sourceOf(user);
    const q = text(input.nomor, 100);
    const { data, meta } = await page(ordersCtrl.listOrders, user, {
      query: {
        q, page: 1, limit: rows(input.jumlah, 10),
        ...(ORDER_STATUSES[input.status] ? { status: ORDER_STATUSES[input.status] } : {}),
        ...(positive(input.id_customer) ? { customerId: input.id_customer } : {}),
        ...(text(input.channel, 40) ? { channel: text(input.channel, 40) } : {}),
        ...(text(input.dari, 10) ? { from: text(input.dari, 10) } : {}),
        ...(text(input.sampai, 10) ? { to: text(input.sampai, 10) } : {}),
      },
    });
    const orders = data.map((r) => ({
      nomor_so: r.orderNumber,
      tanggal: day(r.transactionDate),
      customer: r.customerName,
      kode_customer: r.customerCode || null,
      channel: r.channel,
      nama_sales: r.salesPersonName || null,
      pengiriman: r.doNumbers || 'belum ada surat jalan',
      nomor_faktur: r.invoiceNumbers || null,
      status_tagihan: billingState(r),
      jatuh_tempo: day(r.dueDate),
      terlambat_hari: r.daysOverdue === null || r.daysOverdue === undefined ? null : Number(r.daysOverdue),
      ...(r.source === 'accurate' ? { status_accurate: r.status || null } : {}),
      rute: r.source === 'accurate' ? customerRoute(r.customerId) : `/sales/orders/${r.id}`,
    }));
    // One SO asked by number: its surat jalan from the approved Accurate data too.
    if (src.accurate && q && orders.length > 0 && orders.length <= 3) {
      for (const order of orders) {
        const docs = await page(ordersCtrl.listDocuments, user, { query: { type: 'do', q: order.nomor_so, page: 1, limit: 10 } });
        order.surat_jalan = docs.data.map((d) => ({ nomor: d.number, tanggal: day(d.date), status: d.status || null }));
      }
    }
    return {
      ...sourceFields(src),
      cakupan: scopeText(user),
      total: meta.total,
      ditampilkan: orders.length,
      sales_order: orders,
      rute: '/sales/orders',
    };
  },
};

// -------------------------------------------------------------------- Omzet

const monthBefore = (month) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const sum = (list, key) => Math.round(list.reduce((n, x) => n + Number(x[key] || 0), 0) * 100) / 100;
const pct = (actual, target) => (target > 0 ? Math.round((actual / target) * 1000) / 10 : null);

const omzet = {
  name: 'omzet_sales',
  module: ['sales-pipeline', 'sales-orders'],
  label: 'Membaca omzet dan target Sales',
  description: 'Omzet Sales dalam rupiah, selalu DPP (sebelum PPN; dari faktur Accurate yang sudah disetujui, dikurangi retur): omzet satu bulan (bawaan bulan ini) '
    + 'dibanding bulan sebelumnya, per channel untuk kedua bulan, target omzet dan customer baru (NOO) per akun sales beserta persen tercapai, tren 12 bulan, '
    + 'produk terlaris bulan ini, dan omzet per sales (hanya untuk yang melihat semua data). Sales Member hanya mendapat angka dan target miliknya sendiri. '
    + 'Pakai untuk "omzet bulan ini vs target" dan "channel mana yang turun". '
    + 'Tidak pernah harga beli, HPP, atau margin; tanpa PPN; tanpa data kontak customer.',
  inputSchema: {
    type: 'object',
    properties: {
      bulan: { type: 'string', description: 'Bulan YYYY-MM (bawaan: bulan ini)' },
    },
    additionalProperties: false,
  },
  permission: ORDER_VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    if (!hasPerm(user, ORDER_VIEW) || !hasPerm(user, CUSTOMER_VIEW)) throw denied();
    const asked = /^\d{4}-\d{2}$/.test(String(input.bulan || '')) ? input.bulan : undefined;
    const range = salesTargets.monthRange(asked);
    if (!range) throw Object.assign(new Error('Bulan harus YYYY-MM'), { status: 400, code: 'VALIDATION_ERROR' });
    const before = salesTargets.monthRange(monthBefore(range.month));
    const src = await sourceOf(user);
    const viewAll = hasPerm(user, VIEW_ALL);
    const current = range.month === todayWib().slice(0, 7);

    const now = await salesFacts.revenueByChannel(user, { from: range.start, to: range.end });
    const prev = await salesFacts.revenueByChannel(user, { from: before.start, to: before.end });
    const prevBy = new Map(prev.channels.map((c) => [c.channel, c]));
    const names = [...new Set([...now.channels, ...prev.channels].map((c) => c.channel))];
    const nowBy = new Map(now.channels.map((c) => [c.channel, c]));
    const total = sum(now.channels, 'revenue');
    const totalBefore = sum(prev.channels, 'revenue');

    const targets = await salesTargets.listTargets(user, range.month);
    const withTarget = targets.rows.filter((r) => r.revenueTarget !== null);
    const targetTotal = sum(withTarget, 'revenueTarget');
    const { data: overview } = await page(dataCtrl.overview, user);
    const sales = overview.sales || { months: [], topProducts: null };

    return {
      ...sourceFields(src),
      cakupan: scopeText(user),
      keterangan_angka: `Omzet = DPP (sebelum PPN). Jumlah dokumen dalam ${now.unit}.${current ? ' Bulan ini masih berjalan, bulan sebelumnya satu bulan penuh.' : ''}`,
      bulan: range.month,
      omzet_dpp: total,
      jumlah_dokumen: now.channels.reduce((n, c) => n + c.orders, 0),
      bulan_sebelumnya: { bulan: before.month, omzet_dpp: totalBefore, jumlah_dokumen: prev.channels.reduce((n, c) => n + c.orders, 0) },
      selisih_omzet_dpp: Math.round((total - totalBefore) * 100) / 100,
      per_channel: names.map((name) => {
        const a = nowBy.get(name)?.revenue || 0;
        const b = prevBy.get(name)?.revenue || 0;
        return {
          channel: name, omzet_dpp: a, jumlah_dokumen: nowBy.get(name)?.orders || 0,
          omzet_dpp_bulan_sebelumnya: b, selisih_omzet_dpp: Math.round((a - b) * 100) / 100,
        };
      }),
      target: {
        bulan: targets.month,
        ...(withTarget.length
          ? { total_target_omzet_dpp: targetTotal, ...(viewAll ? { persen_tercapai: pct(total, targetTotal) } : {}) }
          : { catatan: 'Target omzet bulan ini belum diisi Supervisor.' }),
        per_akun: targets.rows.slice(0, MAX_ROWS).map((r) => ({
          nama: r.name,
          divisi: r.departmentName,
          target_omzet_dpp: r.revenueTarget,
          omzet_dpp: r.revenueActual,
          persen_omzet: r.revenuePct,
          jumlah_dokumen: r.orders,
          target_customer_baru: r.nooTarget,
          customer_baru: r.nooActual,
          persen_customer_baru: r.nooPct,
          ...(r.linked ? {} : { catatan: 'Akun belum ditautkan ke nama sales atau customer, jadi realisasinya belum terhitung.' }),
        })),
      },
      tren_12_bulan: sales.months.map((m) => ({ bulan: m.month, omzet_dpp: m.revenue, jumlah_dokumen: m.orders, customer_baru: m.newCustomers })),
      ...(sales.topProducts ? {
        produk_terlaris_bulan_ini: sales.topProducts.map((p) => ({
          kode: p.code, nama: p.name, omzet_dpp: p.revenue,
          terjual: p.qtyByUnit.map((u) => `${u.qty} ${u.unit}`.trim()).join(', '),
        })),
      } : {}),
      ...(overview.bySalesperson ? {
        per_sales: overview.bySalesperson.slice(0, 25).map((p) => ({
          nama_sales: p.name || '(tanpa nama sales)', omzet_dpp_bulan_ini: p.monthRevenue, dokumen_bulan_ini: p.monthOrders,
          omzet_dpp_tahun_ini: p.yearRevenue, jumlah_customer: p.customers,
        })),
      } : {}),
      rute: '/sales/pipeline',
    };
  },
};

// ------------------------------------------------------------------ Piutang

const piutang = {
  name: 'piutang_sales',
  module: ['sales-orders', 'sales-customers'],
  label: 'Membaca piutang dan tagihan terlambat',
  description: 'Piutang penjualan dalam rupiah dari faktur Accurate yang sudah disetujui: ringkasan umur piutang (belum jatuh tempo, 1–30, 31–60, 61–90, lebih dari 90 hari) '
    + 'dan daftar faktur yang lewat jatuh tempo (nomor, tanggal, jatuh tempo, hari terlambat, sisa tagihan termasuk PPN). Isi id_customer untuk satu customer '
    + '(dengan ringkasan: sisa piutang, yang terlambat, faktur dan pembayaran terakhir), atau cari dengan nama customer/nomor faktur. '
    + 'Uang muka tidak dihitung piutang. Sales Member hanya mendapat faktur miliknya. '
    + 'Tidak pernah rekening, data pajak, alamat atau kontak customer; tanpa harga beli dan margin.',
  inputSchema: {
    type: 'object',
    properties: {
      id_customer: { type: 'integer', minimum: 1, description: 'Piutang satu customer (id dari customer_lead_sales)' },
      cari: { type: 'string', maxLength: 100, description: 'Nama/kode customer atau nomor faktur' },
      semua_belum_lunas: { type: 'boolean', description: 'true = semua faktur belum lunas; bawaan hanya yang lewat jatuh tempo' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal faktur (bawaan 15)' },
    },
    additionalProperties: false,
  },
  permission: ORDER_VIEW,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    if (!hasPerm(user, ORDER_VIEW)) throw denied();
    const src = await sourceOf(user);
    const customerId = positive(input.id_customer);
    const q = text(input.cari, 100);
    const limit = rows(input.jumlah);
    const onlyLate = input.semua_belum_lunas !== true;
    const out = { ...sourceFields(src), cakupan: scopeText(user), daftar_berisi: onlyLate ? 'faktur lewat jatuh tempo' : 'semua faktur belum lunas' };

    if (!src.accurate) {
      // Before Accurate is connected (or in app mode): the orders of the app.
      const { data, meta } = await page(ordersCtrl.listOrders, user, {
        query: { q, page: 1, limit, status: onlyLate ? 'overdue' : 'unpaid', ...(customerId ? { customerId } : {}) },
      });
      return {
        ...out,
        umur_piutang: null,
        total_faktur: meta.total,
        total_sisa_piutang: meta.outstanding,
        ditampilkan: data.length,
        faktur: data.map((r) => ({
          nomor_faktur: r.invoiceNumbers || null, nomor_so: r.orderNumber, tanggal: day(r.transactionDate), jatuh_tempo: day(r.dueDate),
          terlambat_hari: r.daysOverdue === null ? null : Number(r.daysOverdue), customer: r.customerName, id_customer: r.customerId,
          channel: r.channel, nama_sales: r.salesPersonName || null, total_tagihan_rp: r.totalAmount, sisa_tagihan_rp: r.outstandingAmount,
          rute: `/sales/orders/${r.id}`,
        })),
      };
    }

    if (customerId) {
      const found = await pageOrNull(customersCtrl.detail, user, { params: { id: String(customerId) } });
      if (!found) return { ...out, ditemukan: false, catatan_customer: 'Customer tidak ditemukan, atau bukan customer milik Anda.' };
      const profile = found.data.summary.orders?.profile;
      out.customer = {
        id_customer: found.data.customer.id,
        nama: found.data.customer.name,
        kode: found.data.customer.customer_code,
        ...(profile ? {
          sisa_piutang: profile.owed,
          piutang_terlambat: profile.overdue,
          faktur_terakhir: day(profile.lastInvoiceDate),
          terima_bayar_terakhir: day(profile.lastReceiptDate),
          rata_tempo_hari: profile.termDays,
          omzet_dpp_12_bulan: profile.revenue12m,
        } : {}),
        rute: customerRoute(customerId),
      };
    }
    // The aging table covers one customer or everything the user sees; a text
    // search has no aging of its own.
    if (customerId || !q) {
      const { data: aging } = await page(ordersCtrl.receivablesAging, user, { query: customerId ? { customerId } : {} });
      out.umur_piutang = aging ? {
        kelompok: aging.buckets.map((b) => ({ umur: b.label, jumlah_faktur: aging.totals[b.key].invoices, sisa_piutang: aging.totals[b.key].outstanding })),
        total_faktur: aging.grand.invoices,
        total_sisa_piutang: aging.grand.outstanding,
        per_tempo: aging.terms.slice(0, 20).map((t) => ({ tempo_hari: t.termDays, jumlah_faktur: t.total.invoices, sisa_piutang: t.total.outstanding })),
      } : null;
    } else {
      out.catatan_umur_piutang = 'Ringkasan umur piutang hanya untuk satu customer (isi id_customer) atau seluruh data; daftar di bawah mengikuti kata cari.';
    }
    const { data, meta } = await page(ordersCtrl.listDocuments, user, {
      query: { type: 'invoice', status: onlyLate ? 'overdue' : 'open', q, page: 1, limit, ...(customerId ? { customerId } : {}) },
    });
    const today = todayWib();
    return {
      ...out,
      total_faktur_di_daftar: meta.total,
      total_sisa_piutang_di_daftar: meta.outstanding,
      ditampilkan: data.length,
      faktur: data.map((r) => {
        const due = day(r.dueDate);
        return {
          nomor_faktur: r.number,
          nomor_so: r.orderNumbers || null,
          tanggal: day(r.date),
          jatuh_tempo: due,
          terlambat_hari: due && due < today ? daysBetween(due, today) : 0,
          customer: r.customerName,
          id_customer: r.customerId,
          channel: r.channel,
          nama_sales: r.salesPersonName || null,
          total_tagihan_rp: r.totalAmount,
          sisa_tagihan_rp: r.outstandingAmount,
          rute: customerRoute(r.customerId),
        };
      }),
      rute: '/sales/orders?tab=invoice&status=overdue',
    };
  },
};

// ------------------------------------------------------------ Data Accurate

const BATCH_STATUSES = Object.freeze({ menunggu: 'pending', disetujui: 'applied', ditolak: 'rejected', ditarik: 'withdrawn' });
const BATCH_STATUS_TEXT = Object.freeze({ pending: 'menunggu keputusan', applied: 'disetujui', rejected: 'ditolak', withdrawn: 'ditarik kembali' });

function batchWarnings(summary) {
  const checks = summary?.checks || {};
  const notes = [];
  if (checks.complete === false) notes.push('bacaan Accurate tidak lengkap (tidak ada yang dinolkan)');
  if (checks.stock_sum?.mismatched) notes.push(`${checks.stock_sum.mismatched} barang: stok per gudang tidak cocok dengan total`);
  const unread = Object.values(checks.unread_documents || {}).reduce((n, v) => n + Number(v || 0), 0);
  if (unread) notes.push(`${unread} dokumen belum terbaca, ikut tarikan berikutnya`);
  return notes;
}

// What a batch holds, per document type: how many are new, changed, or gone.
const CHANGED = 'update';
function batchContents(summary) {
  return Object.entries(summary?.counts || {}).map(([type, c]) => ({
    jenis: batches.RECORD_TYPES[type]?.label || type, baru: c.create || 0, berubah: c[CHANGED] || 0, tidak_ada_lagi: c.missing || 0,
  }));
}

const batchAccurate = {
  name: 'batch_data_accurate',
  module: ['accurate-batches'],
  label: 'Membaca batch Data Accurate',
  description: 'Batch tarikan data Accurate yang menunggu keputusan Supervisor/Head divisi (bawaan), atau yang sudah disetujui, ditolak atau ditarik kembali: '
    + 'nomor batch, divisi, jumlah data, isi per jenis dokumen (baru, berubah, tidak ada lagi), kapan diajukan, sudah menunggu berapa jam, peringatan dari tarikan, '
    + 'dan apakah Anda termasuk yang memutuskan. Hanya batch divisi Anda sendiri (Management Office melihat semua). Keputusan tetap diambil manusia di halaman Data Accurate. '
    + 'Hanya jumlah dan waktu: tanpa rupiah dan tanpa isi tiap dokumen di dalam batch.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: Object.keys(BATCH_STATUSES), description: 'Bawaan: menunggu' },
      jumlah: { type: 'integer', minimum: 1, maximum: 25, description: 'Maksimal batch (bawaan 10)' },
    },
    additionalProperties: false,
  },
  permission: BATCH_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    if (!anyPerm(user, BATCH_VIEW)) throw denied();
    const status = BATCH_STATUSES[input.status] || 'pending';
    const limit = int(input.jumlah, { min: 1, max: 25, fallback: 10 });
    const result = await batches.listBatches(user, { status, page: 1, limit, offset: 0 });
    const list = [];
    for (const b of result.items) {
      const waitingHours = b.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 3600000)) : null;
      const pending = b.status === 'pending';
      const deciders = pending && b.approvalRequestId
        ? await batches.deciderIds(user.entityId, { approvalRequestId: b.approvalRequestId, departmentId: b.departmentId })
        : [];
      const warnings = batchWarnings(b.summary);
      list.push({
        id_batch: b.id,
        divisi: b.departmentName,
        status: BATCH_STATUS_TEXT[b.status] || b.status,
        jumlah_data: b.itemCount,
        isi: batchContents(b.summary),
        ...(warnings.length ? { peringatan: warnings } : {}),
        diajukan: wib(b.createdAt),
        diajukan_oleh: b.requestedByName || null,
        ...(pending
          ? { menunggu_jam: waitingHours, lebih_dari_1_hari: waitingHours !== null && waitingHours >= 24, anda_bisa_memutuskan: deciders.includes(Number(user.sub)) }
          : { diputuskan: wib(b.decidedAt), diputuskan_oleh: b.decidedByName || null, catatan_keputusan: short(b.decisionNote) }),
        rute: `/data-accurate/${b.id}`,
      });
    }
    return {
      sumber: 'Accurate, hanya dibaca; data baru dipakai setelah batch disetujui',
      status: input.status && BATCH_STATUSES[input.status] ? input.status : 'menunggu',
      total: result.total,
      ditampilkan: list.length,
      batch: list,
      ...(status === 'pending' && !list.length ? { catatan: 'Tidak ada batch Data Accurate yang menunggu keputusan untuk divisi Anda.' } : {}),
      rute: '/data-accurate',
    };
  },
};

module.exports = [perluTindakan, pipeline, customerLead, statusOrder, omzet, piutang, batchAccurate];
