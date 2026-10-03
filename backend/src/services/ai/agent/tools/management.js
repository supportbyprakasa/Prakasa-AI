// Management pages (Wave B): Dashboard divisi, Dashboard manajemen, Pusat
// Eskalasi, Target & realisasi and Peta program. Everything is read through
// the pages' own services, so the same rules apply:
//   - division scope: management_dashboard.view sees every division or the
//     whole company; everyone else only their own division (403 otherwise);
//   - a KPI or metric behind its own permission goes through the registry's
//     gate (management/contract.js `permitted` / `restrictedText`, applied
//     inside the services): without the permission it is never computed and
//     the answer only says why it is empty;
//   - rupiah figures only from the two `money` tools; the other tools return
//     counts, rates, days and statuses, and take a rupiah amount out of a text;
//   - purchase prices never (program 3.3): PRICE_PERMISSION is taken off the
//     permissions handed to the services, so "Nilai PO" is restricted for
//     everyone here, price viewers too. The Alur & margin page
//     (managementFlow.service) is not read at all.
// The answers are cached like the pages' (utils/memo.js, namespace 'mgmt:',
// 120 s, single-flight, dropped by the same writes), on top of the shared
// figure and series caches the services already use — an AI question does not
// ask MySQL again for what a dashboard just computed.
const divisionDashboard = require('../../../divisionDashboard.service');
const escalation = require('../../../escalation.service');
const targets = require('../../../targets.service');
const roadmap = require('../../../roadmap.service');
const { memo, scopeKey } = require('../../../../utils/memo');
const { todayWib } = require('../../../../utils/wibTime');
const {
  hasPerm, anyPerm, denied, text, int,
} = require('./_shared');

const CACHE_TTL_MS = 120 * 1000;
const ENTITY_WIDE = 'management_dashboard.view';
const DIVISION_PAGE = Object.freeze(['division_dashboard.view', ENTITY_WIDE]);
const MANAGEMENT_PAGE = Object.freeze([ENTITY_WIDE, 'management_dashboard.division']);
// Purchase prices (P1) are a right on the page, never something the AI carries away.
const PRICE_PERMISSION = 'procurement.price.view';
const MONEY_UNIT = 'rupiah';
const ALL_WORDS = new Set(['semua', 'all', 'seluruh', 'seluruh perusahaan', 'perusahaan', 'semua divisi']);

const MONEY_TEXT = /\b(?:Rp|IDR)\.?\s*-?\d[\d.,]*(?:\s*(?:rb|ribu|jt|juta|m|miliar|t|triliun)\b)?/gi;
const NO_MONEY = '(nilai rupiah tidak ditampilkan)';
const hasMoneyText = (value) => typeof value === 'string' && new RegExp(MONEY_TEXT.source, 'i').test(value);
// A text as the page shows it; without `money`, any rupiah amount is taken out.
const words = (value, money = false) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return (money ? value : value.replace(MONEY_TEXT, NO_MONEY)).trim();
};
const route = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null);
// The id a page gives the record behind an edit form (frontend escalationsModel
// escalationRecordId, targetsModel targetRecordId): what `?ubah=` takes.
const recordWord = (...parts) => (parts.every((part) => part !== undefined && part !== null && part !== '')
  ? parts.join('-').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) : null);
const number = (value) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The user the services see: purchase-price figures stay restricted for everyone.
const reader = (user) => ({ ...user, permissions: (user.permissions || []).filter((code) => code !== PRICE_PERMISSION) });
const cached = (user, name, parts, loader) => memo.get(`mgmt:ai:${name}:${scopeKey(user)}|${parts.join('|')}`, CACHE_TTL_MS, loader);

const BETTER = { higher: 'makin tinggi makin baik', lower: 'makin rendah makin baik' };
const SEVERITY = { high: 'tinggi', medium: 'sedang' };
const FOLLOWUP = { open: 'terbuka', acknowledged: 'ditangani', resolved: 'selesai' };
const FOLLOWUP_INPUT = { terbuka: 'open', ditangani: 'acknowledged', selesai: 'resolved', semua: 'all' };
const TARGET_STATUS = {
  no_target: 'belum ada target',
  billed_monthly: 'ditagih bulanan (belum dinilai selama periode berjalan)',
  no_data: 'belum ada data',
  achieved: 'tercapai',
  on_track: 'sesuai jalur',
  at_risk: 'perlu perhatian',
  off_track: 'tertinggal',
};
const TARGET_STATUS_INPUT = {
  tercapai: 'achieved', sesuai_jalur: 'on_track', perlu_perhatian: 'at_risk', tertinggal: 'off_track', ditagih_bulanan: 'billed_monthly', belum_ada_data: 'no_data',
};
const TARGET_ORDER = ['off_track', 'at_risk', 'no_data', 'billed_monthly', 'on_track', 'achieved', 'no_target'];
const PROGRAM_STATUS = { open: 'belum mulai', in_progress: 'berjalan', done: 'selesai' };
const PROGRAM_STATUS_INPUT = { belum_mulai: 'open', berjalan: 'in_progress', selesai: 'done' };

const DIVISION_INPUT = { type: 'string', maxLength: 120, description: 'Nama divisi, atau "semua" untuk seluruh perusahaan (hanya manajemen). Kosong = divisi pengguna (manajemen: seluruh perusahaan)' };

/**
 * A division named in the question → what the services take. The list comes
 * from the dashboard service: every division for management, only the user's
 * own otherwise — naming another division is refused, never silently widened.
 * → { all: true } | { division } | { unknown, available } | {} (not named)
 */
async function divisionNamed(user, raw) {
  const wanted = text(raw, 120);
  if (!wanted) return {};
  const entityWide = hasPerm(user, ENTITY_WIDE);
  if (ALL_WORDS.has(wanted.toLowerCase())) {
    if (!entityWide) throw denied('Seluruh perusahaan hanya untuk manajemen; Anda hanya bisa melihat divisi Anda sendiri.');
    return { all: true };
  }
  const list = await cached(user, 'divisi', [], () => divisionDashboard.listDivisions(user));
  const found = list.find((d) => same(d.name, wanted) || same(d.code, wanted))
    || list.find((d) => d.name.toLowerCase().includes(wanted.toLowerCase()));
  if (found) return { division: found };
  if (!entityWide) throw denied('Anda hanya bisa melihat divisi Anda sendiri.');
  return { unknown: wanted, available: list.map((d) => d.name) };
}

const unknownDivision = (named) => ({ divisi_tidak_dikenal: named.unknown, divisi_tersedia: named.available });

/**
 * The slice of the company this caller reads on Pusat Eskalasi, Target &
 * realisasi and Peta program (the controller's resolveScope): the whole
 * company — or one named division — for management_dashboard.view; otherwise
 * the caller's own division, and nothing at all without one.
 */
async function managementScope(user, rawDivision) {
  if (!anyPerm(user, MANAGEMENT_PAGE)) throw denied();
  const named = await divisionNamed(user, rawDivision);
  if (named.unknown) return { unknown: named };
  if (hasPerm(user, ENTITY_WIDE)) return { departmentId: named.division ? named.division.id : null };
  const own = Number(user.departmentId) || null;
  if (!own) throw denied('Akun Anda belum terhubung ke divisi mana pun.');
  if (named.division && named.division.id !== own) throw denied('Anda hanya bisa melihat divisi Anda sendiri.');
  return { departmentId: own };
}

const scopeText = (scope) => (scope.entityWide ? 'seluruh perusahaan' : `divisi ${scope.departmentName || 'Anda'}`);

// ------------------------------------------------------------ dashboard divisi

async function dashboardFor(user, rawDivision) {
  if (!anyPerm(user, DIVISION_PAGE)) throw denied();
  const named = await divisionNamed(user, rawDivision);
  if (named.unknown) return { unknown: named };
  const requested = named.all ? 'all' : (named.division ? named.division.id : null);
  const as = reader(user);
  // build() checks which division this caller may look at (403 for another one).
  const page = await cached(as, 'dashboard', [requested ?? '-'], () => divisionDashboard.build(as, { division: requested }));
  return { page };
}

// `modul` input: keeps the figures of one module (provider key or part of its label).
const MODULE_INPUT = { type: 'string', maxLength: 60, description: 'Hanya angka satu modul, mis. Sales, Warehouse, IT, Approval' };
function moduleFilter(raw) {
  const wanted = text(raw, 60).toLowerCase();
  if (!wanted) return () => true;
  return (item) => String(item.provider).toLowerCase() === wanted || String(item.providerLabel).toLowerCase().includes(wanted);
}

const isMoneyKpi = (kpi) => kpi.unit === MONEY_UNIT || hasMoneyText(kpi.sub);

function findMetric(metrics, raw) {
  const wanted = text(raw, 80).toLowerCase();
  if (!wanted) return null;
  return metrics.find((m) => m.key.toLowerCase() === wanted)
    || metrics.find((m) => String(m.label).toLowerCase() === wanted)
    || metrics.find((m) => String(m.label).toLowerCase().includes(wanted) || m.key.toLowerCase().includes(wanted))
    || null;
}

function dashboardHeader(page) {
  const running = page.months[page.months.length - 1];
  return {
    divisi: page.division.name,
    cakupan: page.division.id == null ? 'seluruh perusahaan' : `divisi ${page.division.name}`,
    bulan_berjalan: running.key,
    data_per: page.generatedAt,
  };
}

const dashboardRoute = (page) => (page.division.id == null ? '/division-dashboard?division=all' : `/division-dashboard?division=${page.division.id}`);

const dashboardDivisi = {
  name: 'dashboard_divisi',
  module: ['division-dashboard', 'management'],
  label: 'Membaca dashboard divisi',
  description: 'Dashboard divisi tanpa angka uang: angka kunci (jumlah, persentase, hari) tiap modul divisi beserta keterangan dan tanda perlu perhatian, '
    + 'metrik bulan ini dan bulan lalu dengan target bulanannya, ringkasan eskalasi terbuka, dan — bila `metrik` diisi — tren 12 bulan metrik itu. '
    + 'Supervisor/Head hanya divisinya sendiri; manajemen boleh menyebut divisi mana pun atau "semua". Angka bersumber Accurate hanya dari data yang sudah disetujui divisinya. '
    + 'Bulan terakhir adalah bulan berjalan (belum lengkap). Tanpa nilai rupiah (pakai angka_rupiah_divisi); tidak pernah harga beli, nilai PO, margin, atau nilai stok.',
  inputSchema: {
    type: 'object',
    properties: {
      divisi: DIVISION_INPUT,
      modul: MODULE_INPUT,
      metrik: { type: 'string', maxLength: 80, description: 'Kunci atau nama metrik untuk tren 12 bulan (lihat daftar `metrik` di hasil tanpa input ini)' },
    },
    additionalProperties: false,
  },
  permission: DIVISION_PAGE,
  privateOnly: true,
  async run(user, input = {}) {
    const { page, unknown } = await dashboardFor(user, input.divisi);
    if (unknown) return unknownDivision(unknown);
    const last = page.months.length - 1;
    const inModule = moduleFilter(input.modul);
    const plainKpis = page.kpis.filter((k) => k.unit !== MONEY_UNIT && inModule(k));
    const plainMetrics = page.metrics.filter((m) => m.unit !== MONEY_UNIT && inModule(m));
    const moneyCount = page.kpis.filter((k) => k.unit === MONEY_UNIT).length + page.metrics.filter((m) => m.unit === MONEY_UNIT).length;
    const out = {
      ...dashboardHeader(page),
      rute: dashboardRoute(page),
      angka_kunci: plainKpis.map((k) => ({
        modul: k.providerLabel,
        kunci: k.key,
        nama: k.label,
        angka: k.restricted ? null : number(k.value),
        satuan: k.unit,
        keterangan: words(k.sub),
        perlu_perhatian: Boolean(k.alert),
        ...(k.restricted ? { dibatasi: true } : {}),
        ...(k.error ? { catatan: 'Angka ini gagal dihitung; coba lagi.' } : {}),
      })),
      metrik: plainMetrics.map((m) => ({
        modul: m.providerLabel,
        kunci: m.key,
        nama: m.label,
        satuan: m.unit,
        arah: BETTER[m.better] || null,
        bulan_ini: number(m.values[last]),
        bulan_lalu: number(m.values[last - 1]),
        target_bulan_ini: number(m.targets[last]),
        ...(m.averaged ? { rata_rata_antar_divisi: true } : {}),
        ...(m.billedMonthly ? { ditagih_bulanan: true } : {}),
      })),
      eskalasi_terbuka: {
        total: page.escalations.total,
        per_sumber: page.escalations.bySource.map((s) => ({ sumber: s.key, nama: s.label, jumlah: s.count })),
        teratas: page.escalations.top.map((i) => ({
          sumber: i.sourceLabel,
          judul: words(i.title),
          referensi: i.reference || null,
          keterangan: words(i.context),
          hari_terlambat: i.daysLate,
          tingkat: SEVERITY[i.severity] || i.severity,
          rute: route(i.link),
        })),
      },
    };
    if (page.divisions.length) out.divisi_tersedia = page.divisions.map((d) => d.name);
    const notes = [];
    if (moneyCount) {
      out.jumlah_angka_uang_tidak_ditampilkan = moneyCount;
      notes.push('Angka rupiah tidak ada di alat ini; pakai angka_rupiah_divisi di percakapan pribadi.');
    }
    if (plainMetrics.some((m) => m.billedMonthly)) notes.push('Metrik "ditagih bulanan" kosong di bulan berjalan: fakturnya baru terbit di akhir bulan.');
    if (text(input.metrik, 80)) {
      const metric = findMetric(plainMetrics, input.metrik);
      if (metric) {
        out.tren = {
          kunci: metric.key,
          nama: metric.label,
          satuan: metric.unit,
          arah: BETTER[metric.better] || null,
          kumulatif: Boolean(metric.cumulative),
          bulan: page.months.map((p, i) => ({
            bulan: p.key, angka: number(metric.values[i]), target: number(metric.targets[i]), ...(p.partial ? { berjalan: true } : {}),
          })),
        };
      } else if (findMetric(page.metrics, input.metrik)) {
        notes.push('Metrik itu bernilai rupiah: trennya ada di angka_rupiah_divisi.');
      } else {
        notes.push(`Metrik "${text(input.metrik, 80)}" tidak ada di dashboard ini; pilih dari daftar metrik.`);
      }
    }
    if (notes.length) out.catatan = notes.join(' ');
    return out;
  },
};

const angkaRupiahDivisi = {
  name: 'angka_rupiah_divisi',
  module: ['division-dashboard', 'management'],
  label: 'Membaca angka rupiah dashboard divisi',
  description: 'Angka rupiah dashboard divisi: angka kunci bernilai rupiah (omzet bulan ini sebelum PPN, faktur lewat jatuh tempo, piutang/utang, pembayaran) '
    + 'dan tren 12 bulan metrik rupiah (omzet, penagihan, pembayaran) dengan target bulanannya. Supervisor/Head hanya divisinya sendiri; manajemen boleh divisi mana pun atau "semua". '
    + 'Setiap angka mengikuti izin angkanya sendiri: tanpa izin itu angkanya kosong dan hanya alasannya yang disebut. Omzet dihitung dari nilai sebelum PPN (DPP), dari data Accurate yang sudah disetujui. '
    + 'Hanya percakapan pribadi. Tidak pernah harga beli, nilai PO, belanja pemasok, margin, atau nilai stok — untuk siapa pun.',
  inputSchema: {
    type: 'object',
    properties: {
      divisi: DIVISION_INPUT,
      modul: MODULE_INPUT,
      metrik: { type: 'string', maxLength: 80, description: 'Kunci atau nama satu metrik rupiah; kosong = semua metrik rupiah' },
    },
    additionalProperties: false,
  },
  permission: DIVISION_PAGE,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    const { page, unknown } = await dashboardFor(user, input.divisi);
    if (unknown) return unknownDivision(unknown);
    const inModule = moduleFilter(input.modul);
    const moneyMetrics = page.metrics.filter((m) => m.unit === MONEY_UNIT && inModule(m));
    const wanted = text(input.metrik, 80);
    const one = wanted ? findMetric(moneyMetrics, wanted) : null;
    const notes = [];
    if (wanted && !one) notes.push(`Metrik rupiah "${wanted}" tidak ada di dashboard ini; semua metrik rupiah ditampilkan.`);
    const kpis = page.kpis.filter((k) => isMoneyKpi(k) && inModule(k));
    if (kpis.some((k) => k.restricted)) notes.push('Angka bertanda dibatasi tidak dihitung: akun Anda tidak punya izin angkanya (harga beli tidak pernah dibaca Prakasa AI).');
    if (moneyMetrics.some((m) => m.billedMonthly)) notes.push('Metrik "ditagih bulanan" kosong di bulan berjalan: fakturnya baru terbit di akhir bulan.');
    return {
      ...dashboardHeader(page),
      rute: dashboardRoute(page),
      angka_kunci: kpis.map((k) => ({
        modul: k.providerLabel,
        kunci: k.key,
        nama: k.label,
        ...(k.unit === MONEY_UNIT ? { nilai_rupiah: k.restricted ? null : number(k.value) } : { angka: k.restricted ? null : number(k.value), satuan: k.unit }),
        keterangan: words(k.sub, true),
        perlu_perhatian: Boolean(k.alert),
        ...(k.restricted ? { dibatasi: true } : {}),
        ...(k.error ? { catatan: 'Angka ini gagal dihitung; coba lagi.' } : {}),
      })),
      metrik: (one ? [one] : moneyMetrics).map((m) => ({
        modul: m.providerLabel,
        kunci: m.key,
        nama: m.label,
        arah: BETTER[m.better] || null,
        kumulatif: Boolean(m.cumulative),
        ...(m.billedMonthly ? { ditagih_bulanan: true } : {}),
        bulan: page.months.map((p, i) => ({
          bulan: p.key, nilai_rupiah: number(m.values[i]), target_rupiah: number(m.targets[i]), ...(p.partial ? { berjalan: true } : {}),
        })),
      })),
      ...(notes.length ? { catatan: notes.join(' ') } : {}),
    };
  },
};

// ------------------------------------------------------------ pusat eskalasi

const eskalasiTerbuka = {
  name: 'eskalasi_terbuka',
  module: ['escalations', 'management'],
  label: 'Membaca Pusat Eskalasi',
  description: 'Pusat Eskalasi: hal yang lewat tenggat di semua modul (approval, issue proyek, PO terlambat, SO telat kirim, faktur lewat jatuh tempo, tiket IT, onboarding, dan lain-lain) '
    + 'dengan hari terlambat, tingkat, divisi, penanggung jawab, dan tindak lanjutnya, terurut dari yang paling lama. Bisa disaring per sumber, modul, divisi, atau status tindak lanjut. '
    + 'Head hanya divisinya sendiri; manajemen seluruh perusahaan atau satu divisi. Dihitung langsung dari data saat ini (data Accurate: hanya yang sudah disetujui). '
    + 'Tiap baris membawa sumber, id_sumber, dan rute_tindak_lanjut (rute formulir tindak lanjutnya). '
    + 'Tanpa nilai rupiah (jumlah tagihan di keterangan dihilangkan); tidak pernah harga beli atau margin.',
  inputSchema: {
    type: 'object',
    properties: {
      divisi: DIVISION_INPUT,
      sumber: { type: 'string', maxLength: 40, description: 'Kunci satu sumber eskalasi (lihat `per_sumber` di hasil), mis. approval_aged' },
      modul: { type: 'string', maxLength: 60, description: 'Nama atau kunci modul, mis. Warehouse, Sales, IT' },
      status: { type: 'string', enum: Object.keys(FOLLOWUP_INPUT), description: 'Status tindak lanjut (default terbuka)' },
      jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal eskalasi (default 20)' },
    },
    additionalProperties: false,
  },
  permission: MANAGEMENT_PAGE,
  privateOnly: true,
  async run(user, input = {}) {
    const scope = await managementScope(user, input.divisi);
    if (scope.unknown) return unknownDivision(scope.unknown);
    const catalogue = escalation.sources();
    const source = text(input.sumber, 40);
    if (source && !catalogue.some((s) => s.key === source)) {
      return { sumber_tidak_dikenal: source, sumber_tersedia: catalogue.map((s) => ({ sumber: s.key, nama: s.label, modul: s.providerLabel })) };
    }
    const status = FOLLOWUP_INPUT[input.status] || 'open';
    const data = await cached(user, 'eskalasi', [scope.departmentId ?? 'all', status, source || '-'],
      () => escalation.list(user.entityId, { departmentId: scope.departmentId, status, source: source || null }));
    const labels = new Map(data.sources.map((s) => [s.key, s]));
    const moduleWanted = text(input.modul, 60).toLowerCase();
    const inModule = (key) => {
      if (!moduleWanted) return true;
      const s = labels.get(key);
      return Boolean(s) && (s.provider.toLowerCase() === moduleWanted || s.providerLabel.toLowerCase().includes(moduleWanted));
    };
    const items = data.items.filter((i) => inModule(i.source));
    const limit = int(input.jumlah, { min: 1, max: 50, fallback: 20 });
    return {
      cakupan: scopeText(data.scope),
      rute: '/escalations',
      ringkasan_semua_sumber: {
        semua: data.totals.all, terbuka: data.totals.open, ditangani: data.totals.acknowledged, selesai: data.totals.resolved,
      },
      per_sumber: data.sources.filter((s) => data.totals.bySource[s.key] > 0 && inModule(s.key))
        .map((s) => ({ sumber: s.key, nama: s.label, modul: s.providerLabel, jumlah_semua_status: data.totals.bySource[s.key] }))
        .sort((a, b) => b.jumlah_semua_status - a.jumlah_semua_status),
      status: input.status && FOLLOWUP_INPUT[input.status] ? input.status : 'terbuka',
      total_cocok: items.length,
      ditampilkan: Math.min(limit, items.length),
      eskalasi: items.slice(0, limit).map((i) => ({
        sumber: i.source,
        id_sumber: i.sourceId ?? null,
        nama_sumber: labels.get(i.source)?.label || i.source,
        modul: labels.get(i.source)?.providerLabel || null,
        judul: words(i.title),
        referensi: i.reference || null,
        keterangan: words(i.context),
        divisi: i.departmentName,
        penanggung_jawab: i.ownerName,
        hari_terlambat: i.daysLate,
        tingkat: SEVERITY[i.severity] || i.severity,
        sejak: i.since,
        tindak_lanjut: i.followup ? {
          status: FOLLOWUP[i.followup.status] || i.followup.status,
          ditangani_oleh: i.followup.ownerName,
          catatan: words(i.followup.note),
          diperbarui: i.followup.updatedAt,
        } : null,
        rute: route(i.link),
        // Opens the follow-up form of this escalation (the user writes or reviews the note, then saves).
        ...(recordWord(i.source, i.sourceId) ? { rute_tindak_lanjut: `/escalations?ubah=${recordWord(i.source, i.sourceId)}` } : {}),
      })),
    };
  },
};

// ------------------------------------------------------------ target & realisasi

async function targetCells(user, input, { money }) {
  const scope = await managementScope(user, input.divisi);
  if (scope.unknown) return unknownDivision(scope.unknown);
  const period = text(input.periode, 10) || null;
  const as = reader(user);
  // targets.list leaves out every metric the caller's permissions do not allow.
  const data = await cached(as, 'target', [scope.departmentId ?? 'all', period || '-'],
    () => targets.list(user.entityId, { departmentId: scope.departmentId, period, permissions: as.permissions }));
  const metrics = new Map(data.metrics.map((m) => [m.key, m]));
  const divisions = new Map(data.divisions.map((d) => [d.id, d.name]));
  const wantedMetric = text(input.metrik, 80) ? findMetric(data.metrics, input.metrik) : null;
  const wantedStatus = TARGET_STATUS_INPUT[input.status] || null;
  const everyCell = input.hanya_bertarget === false;
  const cells = data.cells.filter((c) => {
    const metric = metrics.get(c.metricKey);
    if (!metric) return false;
    if (money && metric.unit !== MONEY_UNIT) return false;
    if (wantedMetric && metric.key !== wantedMetric.key) return false;
    if (wantedStatus) return c.status === wantedStatus;
    return everyCell || c.target != null;
  }).sort((a, b) => TARGET_ORDER.indexOf(a.status) - TARGET_ORDER.indexOf(b.status)
    || (a.pacePct ?? a.achievementPct ?? 0) - (b.pacePct ?? b.achievementPct ?? 0));
  const limit = int(input.jumlah, { min: 1, max: 100, fallback: 25 });
  const mayEdit = (user.permissions || []).includes('management_dashboard.view');
  const counts = {};
  for (const c of cells) counts[c.status] = (counts[c.status] || 0) + 1;
  const notes = [];
  if (text(input.metrik, 80) && !wantedMetric) notes.push(`Metrik "${text(input.metrik, 80)}" tidak dikenal; semua metrik ditampilkan.`);
  if (!money && cells.some((c) => metrics.get(c.metricKey).unit === MONEY_UNIT)) {
    notes.push('Metrik rupiah hanya menampilkan persen dan status di sini; angka target dan realisasinya ada di target_realisasi_rupiah.');
  }
  if (!data.period.ended) notes.push('Periode masih berjalan: metrik kumulatif dinilai dari laju (bagian target yang seharusnya tercapai sampai hari ini).');
  if (!cells.length && !wantedStatus && !everyCell) notes.push('Belum ada target yang diisi untuk periode ini.');
  return {
    cakupan: scopeText(data.scope),
    rute: '/targets',
    periode: {
      kunci: data.period.key, label: data.period.label, mulai: data.period.start, selesai: data.period.end,
      persen_berjalan: data.period.elapsedPct, sudah_berakhir: data.period.ended,
    },
    ringkasan_status: Object.fromEntries(TARGET_ORDER.filter((s) => counts[s]).map((s) => [TARGET_STATUS[s], counts[s]])),
    total_cocok: cells.length,
    ditampilkan: Math.min(limit, cells.length),
    baris: cells.slice(0, limit).map((c) => {
      const metric = metrics.get(c.metricKey);
      const isMoney = metric.unit === MONEY_UNIT;
      return {
        divisi: divisions.get(c.departmentId) || null,
        id_divisi: c.departmentId ?? null,
        metrik: metric.key,
        nama: metric.label,
        modul: metric.providerLabel,
        satuan: metric.unit,
        arah: BETTER[metric.better] || null,
        ...(isMoney
          ? (money ? { target_rupiah: number(c.target), realisasi_rupiah: number(c.actual) } : { angka_uang: 'tidak ditampilkan' })
          : { target: number(c.target), realisasi: number(c.actual) }),
        pencapaian_persen: c.achievementPct,
        laju_persen: c.pacePct,
        status: TARGET_STATUS[c.status] || c.status,
        catatan_target: words(c.note, money),
        diperbarui: c.updatedAt,
        // Opens the target's form (only whoever sets targets: the entity-wide view). The number stays the user's.
        ...(mayEdit && recordWord(c.departmentId, metric.key) ? { rute_ubah: `/targets?period=${data.period.key}&ubah=${recordWord(c.departmentId, metric.key)}` } : {}),
      };
    }),
    ...(data.restricted.length ? { metrik_dibatasi: data.restricted.map((m) => ({ nama: m.label, modul: m.providerLabel, alasan: m.reason })) } : {}),
    ...(notes.length ? { catatan: notes.join(' ') } : {}),
  };
}

const TARGET_INPUTS = {
  periode: { type: 'string', maxLength: 10, description: 'YYYY-MM (bulan) atau YYYY-Qn (kuartal); kosong = kuartal berjalan' },
  divisi: DIVISION_INPUT,
  metrik: { type: 'string', maxLength: 80, description: 'Kunci atau nama satu metrik' },
  status: { type: 'string', enum: Object.keys(TARGET_STATUS_INPUT), description: 'Hanya baris dengan status ini' },
  jumlah: { type: 'integer', minimum: 1, maximum: 100, description: 'Maksimal baris (default 25)' },
};

const targetRealisasi = {
  name: 'target_realisasi',
  module: ['targets'],
  label: 'Membaca target dan realisasi',
  description: 'Target & realisasi per divisi untuk satu bulan atau kuartal: target tersimpan, realisasi yang dihitung langsung dari data modul, persen pencapaian, '
    + 'persen laju (metrik kumulatif di periode berjalan), dan status: tercapai, sesuai jalur, perlu perhatian, tertinggal, belum ada data, atau ditagih bulanan '
    + '(angka yang difakturkan sekali sebulan belum dinilai selama periodenya berjalan). Default hanya baris yang punya target, yang tertinggal lebih dulu. '
    + 'Head hanya divisinya; manajemen semua divisi. Tiap baris membawa id_divisi dan kunci metrik; untuk yang boleh mengatur target juga rute_ubah (rute formulir targetnya). '
    + 'Metrik rupiah hanya persen dan status. Tanpa nilai rupiah (pakai target_realisasi_rupiah); tidak pernah nilai PO, harga beli, atau margin.',
  inputSchema: {
    type: 'object',
    properties: {
      ...TARGET_INPUTS,
      hanya_bertarget: { type: 'boolean', description: 'false = sertakan juga metrik yang belum diberi target (default true)' },
    },
    additionalProperties: false,
  },
  permission: MANAGEMENT_PAGE,
  privateOnly: true,
  async run(user, input = {}) {
    return targetCells(user, input, { money: false });
  },
};

const targetRealisasiRupiah = {
  name: 'target_realisasi_rupiah',
  module: ['targets'],
  label: 'Membaca target dan realisasi rupiah',
  description: 'Target & realisasi metrik bernilai rupiah (omzet sebelum PPN, penagihan, pembayaran) per divisi untuk satu bulan atau kuartal: target, realisasi, '
    + 'persen pencapaian, persen laju, dan status (termasuk "ditagih bulanan" untuk omzet yang difakturkan sekali sebulan). Head hanya divisinya; manajemen semua divisi. '
    + 'Metrik yang butuh izin sendiri hanya untuk pemegang izinnya. Hanya percakapan pribadi. Tidak pernah nilai PO, harga beli, belanja pemasok, atau margin — untuk siapa pun.',
  inputSchema: {
    type: 'object',
    properties: {
      ...TARGET_INPUTS,
      hanya_bertarget: { type: 'boolean', description: 'false = sertakan juga metrik rupiah yang belum diberi target (default true)' },
    },
    additionalProperties: false,
  },
  permission: MANAGEMENT_PAGE,
  privateOnly: true,
  money: true,
  async run(user, input = {}) {
    return targetCells(user, input, { money: true });
  },
};

// ------------------------------------------------------------ peta program

const petaProgram = {
  name: 'peta_program',
  module: ['roadmap'],
  label: 'Membaca peta program',
  description: 'Peta program: setiap proyek Project Tracker per divisi dengan tanggal mulai dan tenggat, status (belum mulai, berjalan, selesai), persen progres, '
    + 'jumlah issue terbuka, dikerjakan, selesai, dan terlambat, serta sprint-nya. Bisa disaring per divisi, status, nama, atau hanya yang punya issue terlambat. '
    + 'Tanggal proyek diturunkan dari sprint atau tanggal rencana issue; bila hanya dari aktivitas, ditandai sebagai perkiraan. Head hanya divisinya; manajemen semua divisi. '
    + 'Hanya judul dan angka: tanpa isi issue, komentar, atau percakapan Chat; tanpa nilai rupiah.',
  inputSchema: {
    type: 'object',
    properties: {
      divisi: DIVISION_INPUT,
      cari: { type: 'string', maxLength: 100, description: 'Nama atau kode proyek' },
      status: { type: 'string', enum: Object.keys(PROGRAM_STATUS_INPUT) },
      hanya_terlambat: { type: 'boolean', description: 'true = hanya proyek yang punya issue terlambat' },
      dengan_sprint: { type: 'boolean', description: 'true = sertakan sprint tiap proyek (default false)' },
      jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal proyek (default 20)' },
    },
    additionalProperties: false,
  },
  permission: MANAGEMENT_PAGE,
  privateOnly: true,
  async run(user, input = {}) {
    const scope = await managementScope(user, input.divisi);
    if (scope.unknown) return unknownDivision(scope.unknown);
    const data = await cached(user, 'program', [scope.departmentId ?? 'all'], () => roadmap.get(user.entityId, { departmentId: scope.departmentId }));
    const projects = data.items.filter((i) => i.kind === 'project');
    const sprints = data.items.filter((i) => i.kind === 'sprint');
    const q = text(input.cari, 100).toLowerCase();
    const status = PROGRAM_STATUS_INPUT[input.status] || null;
    const today = todayWib();
    const matched = projects.filter((p) => (!q || String(p.title).toLowerCase().includes(q) || String(p.projectKey || '').toLowerCase().includes(q))
      && (!status || p.status === status)
      && (input.hanya_terlambat !== true || p.overdue > 0))
      .sort((a, b) => b.overdue - a.overdue || String(a.dueDate).localeCompare(String(b.dueDate)));
    const limit = int(input.jumlah, { min: 1, max: 50, fallback: 20 });
    const count = (wanted) => projects.filter((p) => p.status === wanted).length;
    return {
      cakupan: scopeText(data.scope),
      rute: '/roadmap',
      hari_ini: today,
      ringkasan: {
        total_program: projects.length,
        belum_mulai: count('open'),
        berjalan: count('in_progress'),
        selesai: count('done'),
        punya_issue_terlambat: projects.filter((p) => p.overdue > 0).length,
        lewat_tenggat_belum_selesai: projects.filter((p) => p.status !== 'done' && p.dueDate && p.dueDate < today).length,
      },
      total_cocok: matched.length,
      ditampilkan: Math.min(limit, matched.length),
      program: matched.slice(0, limit).map((p) => ({
        nama: p.title,
        kode: p.projectKey,
        divisi: p.departmentName,
        mulai: p.startDate,
        tenggat: p.dueDate,
        status: PROGRAM_STATUS[p.status] || p.status,
        progres_persen: p.progressPercent,
        issue_terbuka: p.open,
        issue_dikerjakan: p.inProgress,
        issue_selesai: p.done,
        issue_terlambat: p.overdue,
        ...(p.isFallbackStart || p.isFallbackDue ? { tanggal_perkiraan: true } : {}),
        rute: p.spaceId ? `/projects/${p.spaceId}` : '/projects',
        ...(input.dengan_sprint === true ? {
          sprint: sprints.filter((s) => s.parentId === p.id).slice(0, 12).map((s) => ({
            nama: s.title,
            mulai: s.startDate,
            tenggat: s.dueDate,
            status: PROGRAM_STATUS[s.status] || s.status,
            progres_persen: s.progressPercent,
            issue_terbuka: s.open,
            issue_selesai: s.done,
            issue_terlambat: s.overdue,
          })),
        } : {}),
      })),
      ...(matched.some((p) => p.isFallbackStart || p.isFallbackDue)
        ? { catatan: 'Proyek bertanda tanggal_perkiraan belum punya sprint atau tanggal rencana: tanggalnya diambil dari aktivitas issue, bukan komitmen.' } : {}),
    };
  },
};

module.exports = [dashboardDivisi, angkaRupiahDivisi, eskalasiTerbuka, targetRealisasi, targetRealisasiRupiah, petaProgram];
