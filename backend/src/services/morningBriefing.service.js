// "Ringkasan pagi" (Prakasa AI Wave D1): what the signed-in person should look
// at today, built straight from the data — no model, no quota.
//
// Every figure is read through the SAME service call the Wave B read tool for
// that question uses (services/ai/agent/tools/*.js), with the caller's own
// permissions and division scope, so the card on the home page, the tool
// `pekerjaan_saya_hari_ini` and the module pages cannot disagree:
//   tugas        task.service listTasksForUser({ mine })        = tugas_saya
//   persetujuan  approvalRead.service pendingForUser            = persetujuan_menunggu_saya
//   beranda      workSummary.controller build (the home cards)  = pekerjaan_saya_hari_ini
//   sales        salesActions.service counts / list             = sales_perlu_tindakan
//   gudang       warehouseDocuments.service today               = gudang_hari_ini
//   procurement  procurementOrders.service today                = procurement_hari_ini
//   piutang      financeReceivables.service status + summary    = ringkasan_piutang (count only)
//   ga           gaOps.service readFor                          = operasional_ga
//   it           the ringkasan_it tool itself                   = ringkasan_it
//   eskalasi     escalation.service list                        = eskalasi_terbuka
//   target       targets.service list                           = target_realisasi
//   accurate     salesAccurateBatches.service listBatches       = batch_data_accurate
//
// It only reads. It never carries rupiah (an amount inside a title is taken
// out), never sends a notification or an email, and never decides anything.
//
// Cheap on shared hosting: at most three sections run at once (mapLimit), each
// within a hard time budget — a section that is too slow is left out and named
// in `tertunda`, so the home page never waits for it — and the answer is kept
// per user for five minutes (utils/memo.js, single-flight), dropped by the
// writes that change it (routes/index.js `writes`, an approved Accurate batch).
const { memo, scopeKey } = require('../utils/memo');
const { mapLimit } = require('../utils/mapLimit');
const { todayWib } = require('../utils/wibTime');
const logger = require('../utils/logger');

const NAMESPACE = 'brief:';
const CACHE_TTL_MS = 5 * 60 * 1000;
// An answer with a skipped section is asked again soon.
const PARTIAL_TTL_MS = 30 * 1000;
const CONCURRENCY = 3;
const DEFAULT_BUDGET_MS = 4000;
const MAX_EXAMPLES = 3;
const DAY_HOURS = 24;

const MONEY_TEXT = /\b(?:Rp|IDR)\.?\s*-?\d[\d.,]*(?:\s*(?:rb|ribu|jt|juta|m|miliar|t|triliun)\b)?/gi;
const has = (user, code) => (user?.permissions || []).includes(code);
const any = (user, codes) => codes.some((code) => has(user, code));
const n = (value) => Math.max(0, Number(value) || 0);
const safeRoute = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null);
// A record's own text, as stored, without any rupiah amount.
const plain = (value) => (typeof value === 'string' && value.trim()
  ? value.replace(MONEY_TEXT, '').replace(/\s{2,}/g, ' ').trim().slice(0, 160) : null);
const hoursSince = (value, now) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 3600000)) : null;
};

function budgetMs() {
  const raw = Number(process.env.BRIEFING_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 200 ? raw : DEFAULT_BUDGET_MS;
}

// One row of the briefing. `group`:
//   action     waits for this person today (in the headline, unless `counted` is false)
//   attention  a module figure their role watches
//   upcoming   not due yet
// `examples`: at most three record titles ({ title, route? }); record data, never translated
// (`translate: true` marks an application label, such as a metric name).
function row({ key, label, count, severity = 'warning', route, examples = [], group = 'attention', phrase = null, ageHours = null, counted = null }) {
  const total = n(count);
  if (!total) return null;
  return {
    key,
    label,
    count: total,
    severity,
    group,
    // Part of the headline's "N hal perlu Anda tindak" (an action row not already inside another one).
    counted: counted == null ? group === 'action' : Boolean(counted),
    route: safeRoute(route),
    examples: examples.filter((e) => e && e.title).slice(0, MAX_EXAMPLES)
      .map((e) => ({ title: e.title, ...(safeRoute(e.route) ? { route: e.route } : {}), ...(e.translate ? { translate: true } : {}) })),
    ...(ageHours != null ? { ageHours } : {}),
    ...(phrase ? { phrase } : {}),
  };
}

// ------------------------------------------------------------------ sections
// Each returns rows (nulls are dropped). Services are required when first used:
// some of them reach the AI provider, which loads the agent tools, which load
// this file (tools/home.js).

async function tasksSection(user) {
  const tasks = require('./task.service');
  const read = (state) => tasks.listTasksForUser({ user, filters: { mine: true, state, limit: MAX_EXAMPLES } });
  const overdue = await read('overdue');
  const counts = overdue.counts || {};
  const example = (t) => ({ title: plain(t.title), route: `/tasks/${Number(t.id)}` });
  const today = todayWib();
  const dueSoon = n(counts.dueSoon) ? await read('due_soon') : { rows: [] };
  const day = (value) => (value instanceof Date ? new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 10) : String(value || '').slice(0, 10));
  return [
    row({
      key: 'tasks_overdue', group: 'action', severity: 'danger', label: 'Tugas lewat tenggat', count: counts.overdue, route: '/tasks',
      examples: (overdue.rows || []).map(example), phrase: `${n(counts.overdue)} tugas lewat tenggat`,
    }),
    row({
      key: 'tasks_due_today', group: 'action', severity: 'warning', label: 'Tugas jatuh tempo hari ini', count: counts.dueToday, route: '/tasks',
      examples: (dueSoon.rows || []).filter((t) => day(t.dueDate) === today).map(example), phrase: `${n(counts.dueToday)} tugas jatuh tempo hari ini`,
    }),
    row({
      key: 'tasks_due_week', group: 'upcoming', severity: 'info', label: 'Tugas jatuh tempo dalam 7 hari', count: counts.dueSoon, route: '/tasks',
      examples: (dueSoon.rows || []).map(example),
    }),
  ];
}

async function approvalsSection(user, { now }) {
  const approvalRead = require('./approvalRead.service');
  const waiting = await approvalRead.pendingForUser(user, { limit: MAX_EXAMPLES });
  const oldest = waiting.items[0];
  const age = oldest ? hoursSince(oldest.createdAt, now) : null;
  return [row({
    key: 'approvals_waiting', group: 'action', severity: age != null && age >= DAY_HOURS ? 'danger' : 'warning',
    label: 'Pengajuan menunggu keputusan Anda', count: waiting.total, route: oldest?.page || '/notifications',
    examples: waiting.items.map((a) => ({ title: plain(a.title), route: a.page })),
    ageHours: age, phrase: `${n(waiting.total)} persetujuan menunggu`,
  })];
}

// The home cards (controllers/workSummary.controller.js build): what waits for
// this person ('action') and the queues their team processes ('team'). Their
// own running requests ('mine') need nothing from them today.
const CARD_PHRASE = {
  signatures: (c) => `${c} dokumen menunggu tanda tangan`,
  it_waiting: (c) => `${c} tiket IT menunggu balasan Anda`,
  warehouse_mine: (c) => `${c} gerakan gudang perlu dilengkapi`,
  finance_revise: (c) => `${c} pengajuan pembayaran perlu dilengkapi`,
  hrga_tasks: (c) => `${c} tugas onboarding/offboarding`,
  ga_assigned: (c) => `${c} permintaan GA untuk Anda`,
};
async function cardsSection(user, { approvalsCounted }) {
  const workSummary = require('../controllers/workSummary.controller');
  const page = await workSummary.build(user);
  return (page.cards || []).filter((card) => card.group === 'action' || card.group === 'team').map((card) => {
    // A "menunggu persetujuan Anda" card is already inside the approvals row.
    if (approvalsCounted && /_approval$/.test(card.key)) return null;
    const action = card.group === 'action';
    const phrase = CARD_PHRASE[card.key];
    return row({
      key: card.key, group: action ? 'action' : 'attention', severity: action ? 'warning' : 'info', label: card.title, count: card.count, route: card.to,
      examples: (card.items || []).map((item) => ({ title: plain(item.title), route: item.to })),
      phrase: action ? (phrase ? phrase(n(card.count)) : `${n(card.count)} hal lain`) : null,
    });
  });
}

async function salesSection(user) {
  const salesActions = require('./salesActions.service');
  const salesSource = require('./salesSource');
  const withOrders = has(user, 'sales.order.view');
  // Alarms on orders and invoices wait for the first approved Accurate batch.
  const reliable = withOrders ? await salesSource.transactionsReliable(user.entityId) : false;
  const summary = await salesActions.counts(user);
  const titles = async (type, count) => {
    if (!n(count)) return [];
    const list = await salesActions.list(user, type, { page: 1, limit: MAX_EXAMPLES, offset: 0, q: '' });
    return list.items.map((r) => ({ title: plain(r.title) }));
  };
  const c = summary.counts || {};
  const page = has(user, 'sales.pipeline.view') ? '/sales/pipeline' : '/sales/customers';
  return [
    reliable ? row({
      key: 'sales_overdue_invoices', severity: 'danger', label: 'Faktur lewat jatuh tempo', count: c.overdue, route: page,
      examples: await titles('overdue', c.overdue),
    }) : null,
    reliable ? row({
      key: 'sales_not_shipped', severity: 'warning', label: 'Sales order belum terkirim', count: c.no_do, route: page,
      examples: await titles('no_do', c.no_do),
    }) : null,
    row({
      key: 'sales_dormant', severity: 'warning', label: 'Customer dormant perlu dihubungi', count: c.dormant, route: page,
      examples: await titles('dormant', c.dormant),
    }),
    row({
      key: 'sales_leads', severity: 'info', label: 'Lead perlu dikunjungi', count: c.leads, route: page,
      examples: await titles('leads', c.leads),
    }),
  ];
}

async function warehouseSection(user) {
  const documents = require('./warehouseDocuments.service');
  const d = await documents.today(user.entityId);
  const a = d.attention || {};
  return [
    row({ key: 'warehouse_so_due', severity: 'warning', label: 'SO dengan jadwal kirim sampai hari ini', count: a.soDue, route: '/warehouse' }),
    row({ key: 'warehouse_stock_minus', severity: 'danger', label: 'Barang dengan stok minus', count: a.stockMinus, route: '/warehouse' }),
    row({ key: 'warehouse_transfers_stuck', severity: 'warning', label: 'Pindah gudang belum diterima lebih dari 3 hari', count: a.stuckTransfers, route: '/warehouse' }),
  ];
}

async function procurementSection(user) {
  const orders = require('./procurementOrders.service');
  const d = await orders.today(user.entityId);
  const a = d.attention || {};
  return [
    row({ key: 'procurement_po_late', severity: 'danger', label: 'PO terlambat datang', count: a.late, route: '/procurement' }),
    row({
      key: 'procurement_po_week', severity: 'info', group: 'upcoming', label: 'PO dijadwalkan datang 7 hari ke depan', count: a.dueSoon, route: '/procurement',
      examples: (d.expected || []).map((p) => ({ title: plain(p.number) })),
    }),
  ];
}

async function receivablesSection(user) {
  const receivables = require('./financeReceivables.service');
  const state = await receivables.status(user.entityId);
  if (!state.ready) return [];
  const s = await receivables.summary(user.entityId);
  return [row({
    key: 'finance_receivables_overdue', severity: 'danger', label: 'Faktur piutang lewat jatuh tempo', count: s.overdue?.invoices, route: '/finance/receivables',
  })];
}

async function gaSection(user) {
  const ops = require('./gaOps.service');
  const s = await ops.readFor(user);
  return [
    row({ key: 'ga_bills_overdue', severity: 'danger', label: 'Tagihan utilitas lewat jatuh tempo', count: s.billsOverdue, route: '/ga/operations' }),
    row({ key: 'ga_maintenance_overdue', severity: 'warning', label: 'Perawatan berkala lewat jadwal', count: s.maintenanceOverdue, route: '/ga/operations' }),
    row({ key: 'ga_contracts_ending', severity: 'warning', label: 'Kontrak dan sewa segera berakhir', count: s.contractsEnding, route: '/ga/operations' }),
  ];
}

async function itSection(user) {
  // The tool itself: it reads the IT dashboard exactly as the page does.
  const tool = require('./ai/agent/agentTools').byName.get('ringkasan_it');
  const out = await tool.run(user, {});
  const renewals = out?.langganan_software?.perpanjangan_dalam_30_hari || [];
  return [
    row({
      key: 'it_renewals', severity: 'warning', label: 'Langganan software diperpanjang dalam 30 hari', count: renewals.length, route: '/it/dashboard',
      examples: renewals.map((r) => ({ title: plain(r.produk), route: r.rute })),
    }),
    row({ key: 'it_devices_problem', severity: 'info', label: 'Perangkat bermasalah', count: out?.perangkat?.bermasalah, route: '/it/dashboard' }),
  ];
}

// The slice Pusat eskalasi and Target & realisasi show this caller (tools/management.js
// managementScope): the whole company for management_dashboard.view, else the own division.
function managementScope(user) {
  if (has(user, 'management_dashboard.view')) return { departmentId: null };
  const own = Number(user.departmentId) || null;
  return own ? { departmentId: own } : null;
}
// Purchase-price figures are never carried away (tools/management.js `reader`).
const withoutPrices = (user) => (user.permissions || []).filter((code) => code !== 'procurement.price.view');

async function escalationSection(user) {
  const scope = managementScope(user);
  if (!scope) return [];
  const escalation = require('./escalation.service');
  const data = await escalation.list(user.entityId, { departmentId: scope.departmentId, status: 'open', source: null });
  return [row({
    key: 'escalations_open', severity: data.items.some((i) => i.severity === 'high') ? 'danger' : 'warning',
    label: scope.departmentId == null ? 'Eskalasi terbuka di perusahaan' : 'Eskalasi terbuka di divisi Anda',
    count: data.totals.open, route: '/escalations',
    examples: data.items.map((i) => ({ title: plain(i.title), route: i.link })),
  })];
}

async function targetsSection(user) {
  const scope = managementScope(user);
  if (!scope) return [];
  const targets = require('./targets.service');
  const data = await targets.list(user.entityId, { departmentId: scope.departmentId, period: null, permissions: withoutPrices(user) });
  const metrics = new Map(data.metrics.map((m) => [m.key, m]));
  const behind = data.cells.filter((c) => metrics.has(c.metricKey) && c.target != null && c.status === 'off_track');
  return [row({
    key: 'targets_off_track', severity: 'warning', label: 'Target yang tertinggal', count: behind.length, route: '/targets',
    // A metric name is an application label, not record data.
    examples: behind.map((c) => ({ title: metrics.get(c.metricKey).label, translate: true })),
  })];
}

async function accurateSection(user, { now, approvalsCounted }) {
  const batches = require('./salesAccurateBatches.service');
  const result = await batches.listBatches(user, { status: 'pending', page: 1, limit: 10, offset: 0 });
  const mine = [];
  for (const b of result.items) {
    if (!b.approvalRequestId) continue;
    const deciders = await batches.deciderIds(user.entityId, { approvalRequestId: b.approvalRequestId, departmentId: b.departmentId });
    if (deciders.includes(Number(user.sub))) mine.push(b);
  }
  mine.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const age = mine.length ? hoursSince(mine[0].createdAt, now) : null;
  // A decision of this person: listed with the actions. Each batch is also an
  // approval request, so it is not counted twice once the approvals row holds it.
  return [row({
    key: 'accurate_batches_waiting', group: 'action', counted: !approvalsCounted, phrase: `${mine.length} batch Data Accurate menunggu keputusan`, severity: age != null && age >= DAY_HOURS ? 'danger' : 'warning',
    label: 'Batch Data Accurate menunggu keputusan Anda', count: mine.length, route: mine.length === 1 ? `/data-accurate/${mine[0].id}` : '/data-accurate',
    examples: mine.map((b) => ({ title: `#${b.id} · ${b.departmentName}`, route: `/data-accurate/${b.id}` })),
    ageHours: age,
  })];
}

// name (shown as "tertunda"), who gets it, how it is read. Order = fan-out order.
const SECTIONS = Object.freeze([
  { name: 'Tugas', allowed: (u) => has(u, 'task.view'), run: tasksSection },
  { name: 'Persetujuan', key: 'approvals', allowed: (u) => has(u, 'approval.view') && has(u, 'approval.decide'), run: approvalsSection },
  { name: 'Beranda', key: 'cards', allowed: () => true, run: cardsSection },
  { name: 'Sales', allowed: (u) => has(u, 'sales.customer.view'), run: salesSection },
  { name: 'Warehouse', allowed: (u) => has(u, 'warehouse.stock.view'), run: warehouseSection },
  { name: 'Procurement', allowed: (u) => has(u, 'procurement.view'), run: procurementSection },
  { name: 'Piutang', allowed: (u) => has(u, 'finance.receivable.view'), run: receivablesSection },
  { name: 'Operasional GA', allowed: (u) => has(u, 'ga.ops.view'), run: gaSection },
  { name: 'IT', allowed: (u) => has(u, 'it.dashboard.view'), run: itSection },
  { name: 'Eskalasi', allowed: (u) => any(u, ['management_dashboard.view', 'management_dashboard.division']), run: escalationSection },
  { name: 'Target', allowed: (u) => any(u, ['management_dashboard.view', 'management_dashboard.division']), run: targetsSection },
  { name: 'Data Accurate', allowed: (u) => any(u, ['accurate.batch.view', 'sales.master.manage']), run: accurateSection },
]);

// ------------------------------------------------------------------ ordering + headline

// Deterministic: what is late and what waits for a decision first, then the
// rest of the person's own work, then module figures, then what is not due yet.
const GROUP_ORDER = { action: 0, attention: 1, upcoming: 2 };
const SEVERITY_ORDER = { danger: 0, warning: 1, info: 2 };
const KEY_ORDER = ['tasks_overdue', 'approvals_waiting', 'accurate_batches_waiting', 'tasks_due_today', 'signatures'];
const keyRank = (key) => { const i = KEY_ORDER.indexOf(key); return i < 0 ? KEY_ORDER.length : i; };
function prioritise(items) {
  return [...items].sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || keyRank(a.key) - keyRank(b.key)
    || b.count - a.count
    || a.key.localeCompare(b.key));
}

// "3 hal perlu Anda tindak hari ini: 2 persetujuan menunggu, 1 tugas lewat tenggat".
function headlineOf(items) {
  const action = items.filter((i) => i.counted);
  const total = action.reduce((sum, i) => sum + i.count, 0);
  const parts = action.filter((i) => i.phrase).slice(0, 4).map((i) => ({ key: i.key, count: i.count, text: i.phrase }));
  const watch = items.filter((i) => i.group === 'attention').length;
  let lead;
  if (total > 0) lead = `${total} hal perlu Anda tindak hari ini`;
  else if (watch > 0) lead = `Tidak ada yang menunggu tindakan Anda. ${watch} hal perlu diperhatikan`;
  else lead = 'Semua beres. Tidak ada yang perlu Anda tindak hari ini';
  return { total, lead, parts, text: parts.length ? `${lead}: ${parts.map((p) => p.text).join(', ')}` : lead };
}

// ------------------------------------------------------------------ build

const TIMED_OUT = Symbol('timed out');

/**
 * The briefing of one user, computed now (no cache). `sections` and `now` are
 * for tests. Never throws for one failing or slow section: it is named in
 * `tertunda` (too slow) or `gagal` (failed) and the rest is returned.
 */
async function compute(user, { sections = SECTIONS, now = Date.now(), budget = budgetMs() } = {}) {
  const started = Date.now();
  const deadline = started + budget;
  const allowed = sections.filter((s) => { try { return s.allowed(user); } catch { return false; } });
  const pending = [];
  const failed = [];
  const shared = { now, approvalsCounted: false };
  const runOne = async (section) => {
    const left = deadline - Date.now();
    if (left <= 0) { pending.push(section.name); return []; }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), left); timer.unref?.(); });
    try {
      const work = Promise.resolve().then(() => section.run(user, shared));
      // A section that loses the race keeps running; its late failure is not an unhandled rejection.
      work.catch(() => {});
      const result = await Promise.race([work, timeout]);
      if (result === TIMED_OUT) { pending.push(section.name); return []; }
      if (section.key === 'approvals') shared.approvalsCounted = true;
      return (result || []).filter(Boolean);
    } catch (error) {
      failed.push(section.name);
      logger.error({ err: error.message, section: section.name }, 'morning briefing section failed');
      return [];
    } finally {
      clearTimeout(timer);
    }
  };
  // The approvals row decides whether the "menunggu persetujuan Anda" home
  // cards are shown: it is read before the cards, the rest three at a time.
  const first = allowed.filter((s) => s.key === 'approvals');
  const rest = allowed.filter((s) => s.key !== 'approvals');
  const lists = [...await mapLimit(first, 1, runOne), ...await mapLimit(rest, CONCURRENCY, runOne)];
  const items = prioritise(lists.flat());
  const headline = headlineOf(items);
  return {
    generatedAt: new Date(now).toISOString(),
    date: todayWib(now),
    scope: 'hanya pekerjaan dan modul yang boleh Anda buka',
    headline,
    allClear: items.length === 0 && !pending.length && !failed.length,
    items: items.map(({ phrase, ...item }) => item),
    tertunda: pending,
    gagal: failed,
    tookMs: Date.now() - started,
  };
}

const cacheKey = (user) => `${NAMESPACE}${scopeKey(user, { perUser: true })}`;

/** The briefing of the signed-in user: cached five minutes, one computation for concurrent callers. */
async function build(user, meta = null) {
  return memo.get(cacheKey(user), (value) => (value.tertunda.length || value.gagal.length ? PARTIAL_TTL_MS : CACHE_TTL_MS), () => compute(user), meta);
}

/** Drops every cached briefing (a write changed what someone has to do). */
const invalidate = () => memo.invalidate(NAMESPACE);

module.exports = {
  NAMESPACE, CACHE_TTL_MS, PARTIAL_TTL_MS, SECTIONS, MAX_EXAMPLES, build, compute, invalidate, prioritise, headlineOf, cacheKey,
};
