const pool = require('../db/pool');
const { logWith } = require('./activityLog.service');
const { numbersFromAccurate } = require('./salesSource');
const { CUSTOMER_CHANNELS } = require('./salesNumbers');
const { channelLabel, changePct, wibToday } = require('./marketingInsights.service');

// Marketing → "Kampanye" (migration 119): a campaign tracker owned by the
// entity's Marketing division. Same rules as Operasional GA (gaOps.service.js):
//   - the entity is always the caller's; a campaign of another entity reads
//     as not found;
//   - department_id is the entity's Marketing division (never from the body);
//   - every write and its activity log run on the caller's connection, inside
//     its transaction;
//   - every PATCH carries `version` (409 VERSION_CONFLICT when it moved on);
//   - nothing is deleted: a campaign ends in 'selesai' or 'dibatalkan'.
//
// Performance is computed live, never stored: revenue (DPP share of each
// faktur line, mg_invoice_lines_accurate) and quantity of the target products
// in the campaign's channels during the campaign, against the same number of
// days right before it, and new customers (NOO) in those channels. While a
// campaign runs, "during" is start → today (or the last day Accurate data
// reaches, whichever is earlier), and the baseline is as many days.

const OBJECTIVES = Object.freeze(['awareness', 'penjualan', 'produk_baru', 'reaktivasi', 'lainnya']);
const OBJECTIVE_LABELS = Object.freeze({
  awareness: 'Awareness', penjualan: 'Penjualan', produk_baru: 'Produk baru', reaktivasi: 'Reaktivasi customer', lainnya: 'Lainnya',
});
const STATUSES = Object.freeze(['draft', 'berjalan', 'selesai', 'dibatalkan']);
const STATUS_LABELS = Object.freeze({ draft: 'Draf', berjalan: 'Berjalan', selesai: 'Selesai', dibatalkan: 'Dibatalkan' });
const FINAL = Object.freeze(['selesai', 'dibatalkan']);
// Which status may follow which. A finished or cancelled campaign is closed:
// only its notes (the recorded result) can still change.
const TRANSITIONS = Object.freeze({
  draft: ['draft', 'berjalan', 'dibatalkan'],
  berjalan: ['berjalan', 'selesai', 'dibatalkan'],
  selesai: ['selesai'],
  dibatalkan: ['dibatalkan'],
});
const ALL = 'all';
const MAX_ITEMS = 50;
const MAX_DAYS = 366;
// Past this many days a series is shown per week instead of per day.
const DAILY_MAX_DAYS = 62;

class CampaignError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const notFound = () => new CampaignError('NOT_FOUND', 'Kampanye tidak ditemukan', 404);
const versionConflict = () => new CampaignError(
  'VERSION_CONFLICT', 'Kampanye ini sudah diubah orang lain. Muat ulang, lalu ulangi perubahan Anda.', 409,
);
const invalid = (code, message, field) => new CampaignError(code, message, 400, field ? { field } : undefined);

// ------------------------------------------------------------ value helpers
const DAY_MS = 86400000;
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const iso = (v) => (v ? new Date(v).toISOString() : null);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const isRealDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && isoDate(new Date(`${v}T00:00:00Z`)) === v;
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const cleanNotes = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s || null;
};
const money = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const round2 = (n) => Math.round(n * 100) / 100;

/** 'all' or a de-duplicated list of known channel codes, in the canonical order. */
function normalizeChannels(value) {
  if (value === ALL) return ALL;
  if (!Array.isArray(value) || !value.length) throw invalid('CHANNELS_REQUIRED', 'Pilih minimal satu channel, atau semua channel', 'channels');
  const unknown = value.filter((c) => !CUSTOMER_CHANNELS.includes(c));
  if (unknown.length) throw invalid('CHANNEL_UNKNOWN', `Channel tidak dikenal: ${unknown.join(', ')}`, 'channels');
  const set = new Set(value);
  if (set.size === CUSTOMER_CHANNELS.length) return ALL;
  return CUSTOMER_CHANNELS.filter((c) => set.has(c));
}

function parseChannels(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = raw; }
  }
  if (value === ALL) return ALL;
  return Array.isArray(value) ? value.filter((c) => typeof c === 'string') : ALL;
}

const channelsText = (channels) => (channels === ALL ? 'Semua channel' : channels.map(channelLabel).join(', '));

// ------------------------------------------------------------ rules (pure)
/**
 * The rules a campaign must keep after any write. `merged` is the whole
 * campaign as it will be saved; `current` its saved state (null on create).
 */
function checkRules(merged, current = null, today = wibToday()) {
  if (!clean(merged.name)) throw invalid('NAME_REQUIRED', 'Isi nama kampanye', 'name');
  if (!OBJECTIVES.includes(merged.objective)) throw invalid('OBJECTIVE_INVALID', 'Pilih tujuan kampanye', 'objective');
  if (!isRealDate(merged.startOn)) throw invalid('DATE_INVALID', 'Tanggal mulai tidak valid', 'startOn');
  if (!isRealDate(merged.endOn)) throw invalid('DATE_INVALID', 'Tanggal selesai tidak valid', 'endOn');
  if (merged.endOn < merged.startOn) throw invalid('DATES_INVALID', 'Tanggal selesai tidak boleh sebelum tanggal mulai', 'endOn');
  if (daysBetween(merged.startOn, merged.endOn) + 1 > MAX_DAYS) {
    throw invalid('DATES_TOO_LONG', `Kampanye paling lama ${MAX_DAYS} hari. Pecah menjadi beberapa kampanye.`, 'endOn');
  }
  if (merged.budget !== null && merged.budget !== undefined && !(Number(merged.budget) >= 0)) {
    throw invalid('BUDGET_INVALID', 'Anggaran tidak boleh negatif', 'budget');
  }
  if (!STATUSES.includes(merged.status)) throw invalid('STATUS_INVALID', 'Status kampanye tidak dikenal', 'status');
  if (!current && !['draft', 'berjalan'].includes(merged.status)) {
    throw invalid('STATUS_INVALID', 'Kampanye baru berstatus Draf atau Berjalan', 'status');
  }
  if (current && !TRANSITIONS[current.status].includes(merged.status)) {
    throw invalid('STATUS_TRANSITION', `Status ${STATUS_LABELS[current.status]} tidak bisa diubah menjadi ${STATUS_LABELS[merged.status]}`, 'status');
  }
  if (merged.status === 'selesai' && (!current || current.status !== 'selesai') && merged.startOn > today) {
    throw invalid('NOT_STARTED', 'Kampanye belum dimulai, jadi belum bisa diselesaikan', 'status');
  }
}

// ------------------------------------------------------------ performance (pure)
/**
 * The two windows a campaign is measured on. State:
 *   not_started  start is after today
 *   no_data      no approved Accurate data reaches the campaign yet
 *   ok           { start, end, days, partial, baselineStart, baselineEnd }
 */
function campaignWindow({ startOn, endOn, today = wibToday(), dataThrough = null }) {
  if (startOn > today) return { state: 'not_started' };
  let end = endOn < today ? endOn : today;
  if (!dataThrough || dataThrough < startOn) return { state: 'no_data', dataThrough: dataThrough || null };
  if (dataThrough < end) end = dataThrough;
  const days = daysBetween(startOn, end) + 1;
  return {
    state: 'ok',
    start: startOn,
    end,
    days,
    partial: end < endOn,
    baselineStart: addDays(startOn, -days),
    baselineEnd: addDays(startOn, -1),
  };
}

/** Uplift in % against the baseline; null when the baseline is zero (nothing to compare). */
const upliftPct = (current, baseline) => changePct(current, baseline);

/**
 * Day rows (d, revenue, qty) → the baseline and campaign totals and a series
 * from the baseline's first day to the campaign's last: per day, or per 7-day
 * block when the two windows together are longer than DAILY_MAX_DAYS. Blocks
 * never straddle the campaign's start.
 */
function summarizeDays(rows, win) {
  // Rows come per day and unit: revenue adds up across units, quantities only
  // within one unit (revision F08 — 1 Box + 5 PCS is never "6").
  const byDay = new Map();
  const units = new Map();
  for (const r of rows) {
    const day = isoDate(r.d);
    const entry = byDay.get(day) || { revenue: 0 };
    entry.revenue += num(r.revenue);
    byDay.set(day, entry);
    const name = String(r.unit || '').trim() || null;
    const key = name ? name.toLowerCase() : '';
    const u = units.get(key) || { unit: name, qty: 0, baselineQty: 0 };
    if (day >= win.start && day <= win.end) u.qty += num(r.qty);
    if (day >= win.baselineStart && day <= win.baselineEnd) u.baselineQty += num(r.qty);
    units.set(key, u);
  }
  const totals = { revenue: 0, baselineRevenue: 0 };
  for (const [day, v] of byDay) {
    if (day >= win.start && day <= win.end) totals.revenue += v.revenue;
    if (day >= win.baselineStart && day <= win.baselineEnd) totals.baselineRevenue += v.revenue;
  }
  const qtyByUnit = [...units.values()]
    .filter((u) => u.qty || u.baselineQty)
    .map((u) => ({ unit: u.unit, qty: round2(u.qty), baselineQty: round2(u.baselineQty), upliftPct: upliftPct(u.qty, u.baselineQty) }));
  // One total and one uplift only when every line, now and before, is in the
  // same known unit; otherwise null with the reason.
  const single = qtyByUnit.length === 1 && qtyByUnit[0].unit ? qtyByUnit[0] : null;
  const qtyNote = single || !qtyByUnit.length ? null : qtyByUnit.some((u) => !u.unit) ? 'unit_unknown' : 'mixed_units';
  const step = win.days * 2 > DAILY_MAX_DAYS ? 7 : 1;
  const series = [];
  const blocks = (from, to, phase) => {
    for (let d = from; d <= to; d = addDays(d, step)) {
      const last = addDays(d, step - 1) < to ? addDays(d, step - 1) : to;
      let revenue = 0;
      for (let x = d; x <= last; x = addDays(x, 1)) revenue += byDay.get(x)?.revenue || 0;
      const [, mm, dd] = d.split('-');
      series.push({ key: d, label: `${dd}/${mm}`, phase, revenue: round2(revenue) });
    }
  };
  blocks(win.baselineStart, win.baselineEnd, 'baseline');
  blocks(win.start, win.end, 'campaign');
  return {
    revenue: round2(totals.revenue),
    baselineRevenue: round2(totals.baselineRevenue),
    qty: single ? single.qty : (qtyByUnit.length ? null : 0),
    baselineQty: single ? single.baselineQty : (qtyByUnit.length ? null : 0),
    qtyUnit: single ? single.unit : null,
    qtyByUnit,
    qtyNote,
    series,
    seriesStep: step === 7 ? 'week' : 'day',
  };
}

// Aggregates only: per day for the products and channels of one campaign.
const PERFORMANCE_SQL = Object.freeze({
  dataThrough: `SELECT MAX(a.trans_date) AS d FROM accurate_records a
                 WHERE a.entity_id = ? AND a.record_type = 'sales_invoice' AND a.missing = 0`,
  days: (channelSql, itemSql) => `SELECT l.trans_date AS d, l.unit, SUM(l.revenue) AS revenue, SUM(l.qty) AS qty
                                     FROM mg_invoice_lines_accurate l
                                    WHERE l.entity_id = ? AND NOT l.is_dp AND l.trans_date BETWEEN ? AND ?${channelSql}${itemSql}
                                    GROUP BY l.trans_date, l.unit`,
  noo: (channelSql) => `SELECT SUM(c.noo_date >= ?) AS noo, SUM(c.noo_date < ?) AS baseline_noo
                          FROM sales_customers_accurate c
                         WHERE c.entity_id = ? AND c.deleted_at IS NULL AND c.noo_date BETWEEN ? AND ?${channelSql}`,
});

async function dataThroughOf(db, entityId) {
  const [[row]] = await db.query(PERFORMANCE_SQL.dataThrough, [entityId]);
  return isoDate(row?.d);
}

/**
 * Live performance of one campaign ({ startOn, endOn, channels, items }).
 * `dataThrough` may be passed in when measuring many campaigns at once.
 */
async function performance(db, entityId, campaign, { today = wibToday(), dataThrough, reliable } = {}) {
  const isReliable = reliable ?? await numbersFromAccurate(entityId);
  if (!isReliable) return { state: 'not_reliable' };
  const through = dataThrough === undefined ? await dataThroughOf(db, entityId) : dataThrough;
  const win = campaignWindow({ startOn: campaign.startOn, endOn: campaign.endOn, today, dataThrough: through });
  if (win.state !== 'ok') return { ...win, dataThrough: through };

  const channels = campaign.channels === ALL ? null : campaign.channels;
  const items = (campaign.items || []).map((i) => i.itemNo);
  const lineChannel = channels ? { sql: ' AND l.channel IN (?)', args: [channels] } : { sql: '', args: [] };
  const lineItems = items.length ? { sql: ' AND l.item_code IN (?)', args: [items] } : { sql: '', args: [] };
  const [dayRows] = await db.query(
    PERFORMANCE_SQL.days(lineChannel.sql, lineItems.sql),
    [entityId, win.baselineStart, win.end, ...lineChannel.args, ...lineItems.args],
  );
  const nooChannel = channels ? { sql: ' AND c.channel IN (?)', args: [channels] } : { sql: '', args: [] };
  const [[nooRow]] = await db.query(
    PERFORMANCE_SQL.noo(nooChannel.sql),
    [win.start, win.start, entityId, win.baselineStart, win.end, ...nooChannel.args],
  );
  const sum = summarizeDays(dayRows, win);
  const noo = num(nooRow?.noo);
  const baselineNoo = num(nooRow?.baseline_noo);
  return {
    state: 'ok',
    dataThrough: through,
    window: { start: win.start, end: win.end, days: win.days, partial: win.partial },
    baseline: { start: win.baselineStart, end: win.baselineEnd },
    revenue: sum.revenue,
    baselineRevenue: sum.baselineRevenue,
    upliftPct: upliftPct(sum.revenue, sum.baselineRevenue),
    qty: sum.qty,
    baselineQty: sum.baselineQty,
    qtyUnit: sum.qtyUnit,
    qtyByUnit: sum.qtyByUnit,
    qtyNote: sum.qtyNote,
    // An uplift of quantities only on one comparable unit; never across units.
    qtyUpliftPct: sum.qtyUnit ? upliftPct(sum.qty, sum.baselineQty) : null,
    noo,
    baselineNoo,
    series: sum.series,
    seriesStep: sum.seriesStep,
  };
}

// ------------------------------------------------------------ reads
const SELECT = `SELECT c.*, cu.name AS created_by_name, uu.name AS updated_by_name,
                       (SELECT COUNT(*) FROM mkt_campaign_items i WHERE i.entity_id = c.entity_id AND i.campaign_id = c.id) AS item_count
                  FROM mkt_campaigns c
                  LEFT JOIN users cu ON cu.id = c.created_by
                  LEFT JOIN users uu ON uu.id = c.updated_by
                 WHERE c.entity_id = ?`;

function shape(r, items, today = wibToday()) {
  const channels = parseChannels(r.channels);
  const startOn = isoDate(r.start_on);
  const endOn = isoDate(r.end_on);
  return {
    id: Number(r.id),
    departmentId: Number(r.department_id),
    name: r.name,
    channels,
    channelsLabel: channelsText(channels),
    objective: r.objective,
    objectiveLabel: OBJECTIVE_LABELS[r.objective] || r.objective,
    startOn,
    endOn,
    days: daysBetween(startOn, endOn) + 1,
    budget: money(r.budget),
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] || r.status,
    // Running past its end date: close it and record the result (escalation).
    endedOpen: r.status === 'berjalan' && endOn < today,
    upcoming: r.status !== 'dibatalkan' && startOn > today,
    notes: r.notes || null,
    itemCount: Number(r.item_count || 0),
    items: items || undefined,
    version: Number(r.version),
    createdByName: r.created_by_name || null,
    updatedByName: r.updated_by_name || null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    statusChangedAt: iso(r.status_changed_at),
  };
}

async function itemsOf(db, entityId, campaignIds) {
  if (!campaignIds.length) return new Map();
  const [rows] = await db.query(
    `SELECT campaign_id, item_no, item_name FROM mkt_campaign_items
      WHERE entity_id = ? AND campaign_id IN (?) ORDER BY id ASC`,
    [entityId, campaignIds],
  );
  const out = new Map();
  for (const r of rows) {
    const list = out.get(Number(r.campaign_id)) || [];
    list.push({ itemNo: r.item_no, itemName: r.item_name || r.item_no });
    out.set(Number(r.campaign_id), list);
  }
  return out;
}

const ORDER = "ORDER BY FIELD(c.status, 'berjalan', 'draft', 'selesai', 'dibatalkan'), c.start_on DESC, c.id DESC";

/** Every campaign of the entity, with its target products (campaigns are few). */
async function listCampaigns(db, entityId, { today = wibToday() } = {}) {
  const [rows] = await db.query(`${SELECT} ${ORDER} LIMIT 1000`, [entityId]);
  const items = await itemsOf(db, entityId, rows.map((r) => Number(r.id)));
  return rows.map((r) => shape(r, items.get(Number(r.id)) || [], today));
}

async function getCampaign(db, entityId, id, { today = wibToday() } = {}) {
  const [[row]] = await db.query(`${SELECT} AND c.id = ? LIMIT 1`, [entityId, id]);
  if (!row) return null;
  const items = await itemsOf(db, entityId, [Number(row.id)]);
  return shape(row, items.get(Number(row.id)) || [], today);
}

/** One campaign with its live performance. */
async function getCampaignWithPerformance(db, entityId, id, { today = wibToday() } = {}) {
  const campaign = await getCampaign(db, entityId, id, { today });
  if (!campaign) throw notFound();
  if (campaign.status === 'draft' || campaign.status === 'dibatalkan') {
    return { ...campaign, performance: { state: campaign.status === 'draft' ? 'draft' : 'cancelled' } };
  }
  return { ...campaign, performance: await performance(db, entityId, campaign, { today }) };
}

/** Counts for the page header. */
async function summary(db, entityId, { today = wibToday() } = {}) {
  const [[row]] = await db.query(
    `SELECT SUM(c.status = 'berjalan') AS running, SUM(c.status = 'draft') AS draft,
            SUM(c.status = 'berjalan' AND c.end_on < ?) AS ended_open, SUM(c.status = 'selesai') AS done, COUNT(*) AS total
       FROM mkt_campaigns c WHERE c.entity_id = ?`,
    [today, entityId],
  );
  return {
    total: num(row?.total), running: num(row?.running), draft: num(row?.draft), endedOpen: num(row?.ended_open), done: num(row?.done),
  };
}

// Read-only, on the pool: what GET /marketing/campaigns and /campaigns/:id
// answer, for callers without a connection of their own (Prakasa AI's tools).
async function readCampaigns(entityId) {
  return { rows: await listCampaigns(pool, entityId), summary: await summary(pool, entityId) };
}
const readCampaignWithPerformance = (entityId, id) => getCampaignWithPerformance(pool, entityId, id);

// ------------------------------------------------------------ writes
async function marketingDepartmentId(db, entityId) {
  const [[row]] = await db.query(
    "SELECT id FROM departments WHERE entity_id = ? AND code = 'marketing' AND deleted_at IS NULL LIMIT 1",
    [entityId],
  );
  if (!row) throw new CampaignError('NO_MARKETING_DIVISION', 'Divisi Marketing perusahaan ini belum ada', 409);
  return Number(row.id);
}

/** Target products, checked against the entity's Accurate item list. */
async function resolveItems(db, entityId, itemNos) {
  const list = [...new Set((itemNos || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (list.length > MAX_ITEMS) throw invalid('ITEMS_TOO_MANY', `Paling banyak ${MAX_ITEMS} produk per kampanye`, 'items');
  if (!list.length) return [];
  const [rows] = await db.query(
    `SELECT i.item_code, MIN(i.name) AS name FROM sales_items_accurate i
      WHERE i.entity_id = ? AND i.item_code IN (?) GROUP BY i.item_code`,
    [entityId, list],
  );
  const names = new Map(rows.map((r) => [String(r.item_code), r.name]));
  const missing = list.filter((no) => !names.has(no));
  if (missing.length) throw invalid('ITEM_UNKNOWN', `Produk tidak ditemukan di Accurate: ${missing.join(', ')}`, 'items');
  return list.map((itemNo) => ({ itemNo, itemName: names.get(itemNo) || itemNo }));
}

async function writeItems(conn, entityId, campaignId, items) {
  await conn.query('DELETE FROM mkt_campaign_items WHERE entity_id = ? AND campaign_id = ?', [entityId, campaignId]);
  if (!items.length) return;
  await conn.query(
    'INSERT INTO mkt_campaign_items (entity_id, campaign_id, item_no, item_name) VALUES ?',
    [items.map((i) => [entityId, campaignId, i.itemNo, i.itemName])],
  );
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CampaignError) throw e;
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') throw new CampaignError('CHECK_FAILED', 'Isian kampanye tidak memenuhi aturan', 400);
    if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW') {
      throw new CampaignError('REFERENCE_INVALID', 'Data terkait tidak ditemukan di perusahaan ini', 400);
    }
    throw e;
  }
}

const FIELDS = Object.freeze({
  name: 'name', channels: 'channels', objective: 'objective', startOn: 'start_on', endOn: 'end_on',
  budget: 'budget', status: 'status', notes: 'notes',
});

function stored(field, value) {
  if (value === undefined) return undefined;
  switch (field) {
    case 'name': return clean(value);
    case 'notes': return cleanNotes(value);
    case 'budget': return money(value);
    case 'channels': return normalizeChannels(value);
    case 'startOn': case 'endOn': return isoDate(value);
    default: return value;
  }
}
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const columnValue = (field, value) => (field === 'channels' ? JSON.stringify(value) : value);

/** POST — a new campaign. Returns its id. */
async function createCampaign(conn, { entityId, userId, body, today = wibToday() }) {
  return guarded(async () => {
    const values = { status: 'draft', budget: null, notes: null };
    for (const field of Object.keys(FIELDS)) {
      if (body[field] !== undefined) values[field] = stored(field, body[field]);
    }
    if (body.channels === undefined) throw invalid('CHANNELS_REQUIRED', 'Pilih minimal satu channel, atau semua channel', 'channels');
    checkRules(values, null, today);
    const items = await resolveItems(conn, entityId, body.items);
    const departmentId = await marketingDepartmentId(conn, entityId);
    const [ins] = await conn.query(
      `INSERT INTO mkt_campaigns (entity_id, department_id, name, channels, objective, start_on, end_on, budget, status, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId, values.name, JSON.stringify(values.channels), values.objective, values.startOn, values.endOn,
        values.budget, values.status, values.notes, userId, userId],
    );
    const id = Number(ins.insertId);
    await writeItems(conn, entityId, id, items);
    await logWith(conn, {
      entityId, userId, action: 'mkt_campaign.create', subjectType: 'mkt_campaign', subjectId: id,
      metadata: { after: { ...values, items: items.map((i) => i.itemNo) } },
    });
    return id;
  });
}

/** PATCH — changes some fields (and/or the target products) at the version the caller saw. */
async function updateCampaign(conn, { entityId, userId, id, body, today = wibToday() }) {
  return guarded(async () => {
    const [[row]] = await conn.query('SELECT * FROM mkt_campaigns WHERE id = ? AND entity_id = ? FOR UPDATE', [id, entityId]);
    if (!row) throw notFound();
    if (Number(row.version) !== Number(body.version)) throw versionConflict();
    const current = {
      name: row.name, channels: parseChannels(row.channels), objective: row.objective, startOn: isoDate(row.start_on),
      endOn: isoDate(row.end_on), budget: money(row.budget), status: row.status, notes: row.notes || null,
    };
    const before = {};
    const after = {};
    for (const field of Object.keys(FIELDS)) {
      if (body[field] === undefined) continue;
      const value = stored(field, body[field]);
      if (!sameValue(value, current[field])) { before[field] = current[field]; after[field] = value; }
    }
    const [oldItemRows] = await conn.query(
      'SELECT item_no FROM mkt_campaign_items WHERE entity_id = ? AND campaign_id = ? ORDER BY id', [entityId, id],
    );
    const oldItems = oldItemRows.map((r) => r.item_no);
    let items = null;
    if (body.items !== undefined) {
      const wanted = [...new Set(body.items.map((v) => String(v || '').trim()).filter(Boolean))];
      if (!sameValue([...wanted].sort(), [...oldItems].sort())) items = await resolveItems(conn, entityId, wanted);
    }
    if (!Object.keys(after).length && !items) return { id: Number(id), changed: [], version: Number(row.version) };

    // A closed campaign keeps its facts; only the recorded result (notes) moves.
    if (FINAL.includes(current.status)) {
      const blocked = [...Object.keys(after).filter((f) => f !== 'notes'), ...(items ? ['items'] : [])];
      if (blocked.length) {
        throw new CampaignError('CAMPAIGN_CLOSED', `Kampanye sudah ${STATUS_LABELS[current.status].toLowerCase()}; hanya catatan yang bisa diubah`, 409, { field: blocked[0] });
      }
    }
    checkRules({ ...current, ...after }, current, today);

    const sets = Object.keys(after).map((field) => `${FIELDS[field]} = ?`);
    const args = Object.keys(after).map((field) => columnValue(field, after[field]));
    if (after.status !== undefined) sets.push('status_changed_at = CURRENT_TIMESTAMP');
    sets.push('updated_by = ?', 'version = version + 1');
    args.push(userId, id, entityId, row.version);
    const [upd] = await conn.query(
      `UPDATE mkt_campaigns SET ${sets.join(', ')} WHERE id = ? AND entity_id = ? AND version = ?`,
      args,
    );
    if (!upd.affectedRows) throw versionConflict();
    if (items) {
      await writeItems(conn, entityId, id, items);
      before.items = oldItems;
      after.items = items.map((i) => i.itemNo);
    }
    const changed = Object.keys(after);
    await logWith(conn, {
      entityId, userId,
      action: after.status !== undefined ? `mkt_campaign.status_${after.status}` : 'mkt_campaign.update',
      subjectType: 'mkt_campaign', subjectId: Number(id),
      metadata: { fields: changed, before, after },
    });
    return { id: Number(id), changed, version: Number(row.version) + 1 };
  });
}

module.exports = {
  OBJECTIVES, OBJECTIVE_LABELS, STATUSES, STATUS_LABELS, TRANSITIONS, FINAL, ALL, MAX_ITEMS, MAX_DAYS, DAILY_MAX_DAYS,
  CampaignError, PERFORMANCE_SQL,
  normalizeChannels, parseChannels, channelsText, checkRules, campaignWindow, upliftPct, summarizeDays,
  performance, dataThroughOf, listCampaigns, getCampaign, getCampaignWithPerformance, summary,
  readCampaigns, readCampaignWithPerformance,
  createCampaign, updateCampaign, marketingDepartmentId, resolveItems, addDays, daysBetween,
};
