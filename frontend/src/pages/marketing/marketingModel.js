import { compactMoney } from '../../components/charts/chartModel.js';
import { formatDate, formatMoney, formatNumber, formatQty } from '../../components/format.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';

// Marketing (migration 119): the page model for "Produk & channel" and
// "Kampanye". Pure functions only. Labels mirror
// backend/src/services/marketingInsights.service.js and marketingCampaigns.service.js.

// ------------------------------------------------------------ shared labels
export const CHANNELS = ['GT', 'MT', 'FoodService', 'Shopee', 'TokoPedia', 'GRAB', 'GOJEK', 'Export'];
export const CHANNEL_LABELS = {
  GT: 'General Trade', MT: 'Modern Trade', FoodService: 'Food Service', Shopee: 'Shopee', TokoPedia: 'Tokopedia',
  GRAB: 'GrabMart', GOJEK: 'GoMart', Export: 'Ekspor', none: 'Tanpa channel',
};
export const channelLabel = (code) => CHANNEL_LABELS[code] || code || '';
// For the language switch: a channel or an area is record data (never
// translated), but what stands in for a missing one is interface text.
export const NO_CHANNEL = 'none';
export const NO_AREA_LABEL = 'Tanpa area';

export const OBJECTIVE_LABELS = {
  awareness: 'Awareness', penjualan: 'Penjualan', produk_baru: 'Produk baru', reaktivasi: 'Reaktivasi pelanggan', lainnya: 'Lainnya',
};
export const OBJECTIVE_OPTIONS = Object.entries(OBJECTIVE_LABELS).map(([value, label]) => ({ value, label }));
export const STATUS_LABELS = { draft: 'Draf', berjalan: 'Berjalan', selesai: 'Selesai', dibatalkan: 'Dibatalkan' };
// Which status may follow which (mirrors the service's TRANSITIONS).
export const NEXT_STATUSES = {
  draft: ['draft', 'berjalan', 'dibatalkan'],
  berjalan: ['berjalan', 'selesai', 'dibatalkan'],
  selesai: ['selesai'],
  dibatalkan: ['dibatalkan'],
};
export const MAX_ITEMS = 50;

/** "2026-09" → "Sep 2026". */
export function formatMonth(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** This month back to 24 months ago, newest first, as Select options. */
export function monthOptions(currentMonth, count = 24) {
  const [y, m] = String(currentMonth).split('-').map(Number);
  if (!y || !m) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const value = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    out.push({ value, label: formatMonth(value) });
  }
  return out;
}

/** "+12,5%" / "-3%" / null. */
export function pctText(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Math.round(Number(value) * 10) / 10;
  return `${n > 0 ? '+' : ''}${formatQty(n)}%`;
}

/** (current − previous) ÷ previous in %, null without a base. */
export function changePct(current, previous) {
  const prev = Number(previous) || 0;
  if (prev <= 0 || current === null || current === undefined) return null;
  return Math.round((((Number(current) || 0) - prev) / prev) * 1000) / 10;
}

// ------------------------------------------------------------ Produk & channel
/** The headline cards. A card with no figure says why; the web card only when GA works. */
export function kpiCards(data, web) {
  if (!data) return [];
  const k = data.kpis || {};
  const prev = data.prevMonthLabel || formatMonth(data.prevMonth);
  const versus = (fig, unit) => {
    if (!fig || fig.previous === null || fig.previous === undefined) return null;
    const pct = changePct(fig.value, fig.previous);
    const prevText = unit === 'rupiah' ? compactMoney(fig.previous) : formatNumber(fig.previous);
    return `${prev}: ${prevText}${pct !== null ? ` (${pctText(pct)})` : ''}`;
  };
  const waiting = 'Menunggu batch Accurate pertama yang disetujui';
  const notYet = data.dataThrough ? `Data Accurate baru sampai ${formatDate(data.dataThrough)}` : 'Belum ada data Accurate';
  const fig = (key, label, unit, opts = {}) => {
    const f = k[key];
    if (!data.accurate && opts.accurate) return { key, label, unit, value: null, note: waiting };
    if (!f || f.value === null || f.value === undefined) return { key, label, unit, value: null, note: opts.accurate ? notYet : null };
    return { key, label, unit, value: f.value, note: versus(f, unit) };
  };
  const cards = [
    fig('revenue', 'Omzet (DPP)', 'rupiah', { accurate: true }),
    fig('productsSold', 'Produk aktif terjual', 'item', { accurate: true }),
    fig('newCustomers', 'Pelanggan baru (NOO)', 'item', { accurate: true }),
    fig('newLeads', 'Leads baru', 'item'),
  ];
  if (web?.available) {
    const pct = changePct(web.sessions, web.previous);
    cards.push({
      key: 'webSessions',
      label: 'Sesi web',
      unit: 'item',
      value: web.sessions,
      note: [web.property?.name, pct !== null ? `${pctText(pct)} dari periode sebelumnya` : null].filter(Boolean).join(' · '),
      // The same note for <Mixed>: the Analytics property's name is record data.
      noteParts: [web.property?.name ? { text: web.property.name, data: true } : null, pct !== null ? `${pctText(pct)} dari periode sebelumnya` : null],
    });
  }
  return cards;
}

const sumAt = (channels, field, i) => {
  let total = null;
  for (const c of channels) {
    const v = c[field]?.[i];
    if (v !== null && v !== undefined) total = (total || 0) + Number(v);
  }
  return total;
};

/** One value per month across every channel (null where no channel is known). */
export function totalSeries(channels = [], field = 'revenue', length = 12) {
  return Array.from({ length }, (_, i) => sumAt(channels, field, i));
}

const hasValue = (values = []) => values.some((v) => v !== null && v !== undefined && Number(v) > 0);

/** Channels racing month by month (MotionChart series): only channels that sold. */
export function motionSeries(channels = []) {
  return channels
    .filter((c) => hasValue(c.revenue))
    .map((c) => ({ key: c.key, label: c.label, unit: 'rupiah', better: 'higher', values: c.revenue, targets: c.revenue.map(() => null) }));
}

/** BarList items: each channel's revenue in the month, with its share of the total. */
export function channelShareItems(channels = [], index) {
  const rows = channels
    .map((c) => ({ key: c.key, label: c.label, value: Number(c.revenue?.[index]) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.value,
    display: compactMoney(r.value),
    note: total ? `${formatQty(Math.round((r.value / total) * 1000) / 10)}% dari omzet` : null,
  }));
}

/** Rows of the channel table for the month at `index`. */
export function channelRows(channels = [], index) {
  return channels
    .filter((c) => hasValue(c.revenue) || hasValue(c.noo) || hasValue(c.qty))
    .map((c) => {
      const revenue = c.revenue?.[index] ?? null;
      const prev = index > 0 ? c.revenue?.[index - 1] ?? null : null;
      return {
        id: c.key,
        channel: c.label,
        revenue,
        changePct: changePct(revenue, prev),
        qty: c.qty?.[index] ?? null,
        noo: c.noo?.[index] ?? null,
        revenue12: c.totalRevenue,
      };
    });
}

/** NOO per channel per month: rows = channels, one column per month (the last `count`). */
export function nooTable(channels = [], months = [], count = 6) {
  const from = Math.max(0, months.length - count);
  const shown = months.slice(from);
  const rows = channels
    .filter((c) => hasValue(c.noo))
    .map((c) => {
      const row = { id: c.key, channel: c.label, total: (c.noo || []).reduce((a, v) => a + (Number(v) || 0), 0) };
      shown.forEach((m, i) => { row[m.key] = c.noo?.[from + i] ?? null; });
      return row;
    });
  return { months: shown, rows };
}

const qtyText = (qty = []) => (qty.length ? qty.map((q) => formatQty(q.qty, q.unit)).join(' + ') : '—');

/** Top products as DataGrid rows. */
export function productRows(products = []) {
  return products.map((p, i) => ({
    id: p.itemCode,
    rank: i + 1,
    itemName: p.itemName,
    itemCode: p.itemCode,
    revenue: p.revenue,
    prevRevenue: p.prevRevenue,
    changePct: p.changePct,
    qtyText: qtyText(p.qty),
    channelsText: (p.channels || []).map((c) => c.label).join(', '),
    // The same list for <Mixed separator=", ">: names are data, "Tanpa channel" is not.
    channelParts: (p.channels || []).map((c) => (c.key === NO_CHANNEL ? c.label : { text: c.label, data: true })),
  }));
}

/** Rising / falling products as BarList items (bar = size of the change). */
export function moverItems(list = []) {
  return list.map((p) => ({
    key: p.itemCode,
    label: p.itemName,
    value: Math.abs(Number(p.change) || 0),
    display: `${p.change > 0 ? '+' : '-'}${compactMoney(Math.abs(p.change))}`,
    note: p.changePct !== null && p.changePct !== undefined ? `${pctText(p.changePct)} dari bulan lalu` : 'Baru terjual bulan ini',
    tone: p.change > 0 ? 'success' : 'error',
  }));
}

/** Leads per area with the share that became customers. */
export function leadRows(areas = []) {
  return areas.map((a) => ({
    id: a.area,
    ...a,
    conversion: a.total ? Math.round((a.converted / a.total) * 1000) / 10 : null,
  }));
}

// ------------------------------------------------------------ Kampanye: list
/** One state per campaign row: its colour and filter chip. */
export function campaignState(row) {
  if (row.status === 'berjalan' && row.endedOpen) return 'campaign_ended_open';
  if (row.status === 'berjalan' && row.upcoming) return 'campaign_scheduled';
  return `campaign_${row.status}`;
}
export const STATE_LABELS = {
  campaign_ended_open: 'Lewat tanggal selesai',
  campaign_scheduled: 'Terjadwal',
  campaign_berjalan: 'Berjalan',
  campaign_draft: 'Draf',
  campaign_selesai: 'Selesai',
  campaign_dibatalkan: 'Dibatalkan',
};
// The shared status keys (components/statusTone.js) each state is shown with.
export const STATE_BADGE = {
  campaign_ended_open: 'need_follow_up',
  campaign_scheduled: 'scheduled',
  campaign_berjalan: 'in_progress',
  campaign_draft: 'draft',
  campaign_selesai: 'completed',
  campaign_dibatalkan: 'cancelled',
};
const STATE_ORDER = Object.keys(STATE_LABELS);

/** Filter chips: the states present, in a fixed order, with their counts. */
export function stateChips(rows = []) {
  const counts = new Map();
  for (const r of rows) counts.set(campaignState(r), (counts.get(campaignState(r)) || 0) + 1);
  return STATE_ORDER.filter((s) => counts.has(s)).map((s) => ({ key: s, label: STATE_LABELS[s], count: counts.get(s) }));
}

export function periodText(row) {
  if (!row?.startOn) return '';
  return row.startOn === row.endOn ? formatDate(row.startOn) : `${formatDate(row.startOn)} – ${formatDate(row.endOn)}`;
}

export function channelsText(channels) {
  if (channels === 'all') return 'Semua channel';
  return (channels || []).map(channelLabel).join(', ');
}

/** The page's attention banner text, or ''. */
export function attentionText(summary) {
  const n = Number(summary?.endedOpen || 0);
  return n ? `${formatNumber(n)} kampanye sudah lewat tanggal selesai tetapi masih Berjalan. Tandai Selesai dan catat hasilnya.` : '';
}

/** Facts of a campaign for the side sheet. */
export function detailItems(row) {
  return [
    { label: 'Tujuan', translateContext: 'campaign', value: OBJECTIVE_LABELS[row.objective] || row.objective, translate: true },
    { label: 'Periode', value: `${periodText(row)} (${formatNumber(row.days)} hari)`, translate: true },
    { label: 'Channel', value: channelsText(row.channels), translate: row.channels === 'all' },
    { label: 'Produk target', value: row.items?.length ? row.items.map((i) => i.itemName).join(', ') : 'Semua produk', translate: !row.items?.length },
    { label: 'Anggaran', value: row.budget !== null && row.budget !== undefined ? formatMoney(row.budget) : null },
    { label: 'Catatan / hasil', value: row.notes },
    { label: 'Dibuat oleh', value: row.createdByName },
  ];
}

// ------------------------------------------------------------ Kampanye: performance
const PERF_MESSAGES = {
  draft: 'Kinerja dihitung setelah kampanye berjalan.',
  cancelled: 'Kampanye dibatalkan, kinerjanya tidak dihitung.',
  not_started: 'Kampanye belum dimulai.',
  not_reliable: 'Angka penjualan menunggu batch Accurate pertama yang disetujui divisi Sales.',
};

/** Why there is no performance yet, or null when there is. */
export function perfMessage(perf) {
  if (!perf) return null;
  if (perf.state === 'ok') return null;
  if (perf.state === 'no_data') {
    return perf.dataThrough
      ? `Data Accurate baru sampai ${formatDate(perf.dataThrough)}, sebelum kampanye dimulai.`
      : 'Belum ada data Accurate untuk periode kampanye.';
  }
  return PERF_MESSAGES[perf.state] || 'Kinerja belum bisa dihitung.';
}

/** The figures of a measured campaign: value, unit, and the comparison line. */
export function perfFigures(perf) {
  if (!perf || perf.state !== 'ok') return [];
  const before = `${formatNumber(perf.window.days)} hari sebelumnya`;
  return [
    { key: 'revenue', label: 'Omzet produk target', unit: 'rupiah', value: perf.revenue, note: `${before}: ${compactMoney(perf.baselineRevenue)}` },
    { key: 'uplift', label: 'Kenaikan omzet', unit: '%', value: perf.upliftPct, note: perf.upliftPct === null ? 'Tidak ada omzet di periode pembanding' : 'Dibanding periode yang sama panjang sebelumnya' },
    { key: 'qty', label: 'Jumlah terjual', unit: 'item', value: perf.qty, note: `${before}: ${formatQty(perf.baselineQty)}${perf.qtyUpliftPct !== null ? ` (${pctText(perf.qtyUpliftPct)})` : ''}` },
    { key: 'noo', label: 'Pelanggan baru di channel ini', unit: 'item', value: perf.noo, note: `${before}: ${formatNumber(perf.baselineNoo)}` },
  ];
}

/** The window line under the figures. */
export function perfWindowText(perf) {
  if (!perf || perf.state !== 'ok') return '';
  const span = `${formatDate(perf.window.start)} – ${formatDate(perf.window.end)}`;
  const base = `${formatDate(perf.baseline.start)} – ${formatDate(perf.baseline.end)}`;
  return `Diukur ${span}${perf.window.partial ? ' (sejauh ini)' : ''}, dibanding ${base}. Omzet = porsi DPP faktur, sebelum retur.`;
}

/** TrendChart input for the performance series (per day or per week). */
export function perfTrend(perf) {
  if (!perf || perf.state !== 'ok' || !perf.series?.length) return null;
  return {
    points: perf.series.map((p) => ({ key: p.key, label: `${p.label}${p.phase === 'baseline' ? ' (sebelum)' : ''}` })),
    values: perf.series.map((p) => p.revenue),
    step: perf.seriesStep === 'week' ? 'per minggu' : 'per hari',
  };
}

// ------------------------------------------------------------ Kampanye: form
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export function formValues(row, today) {
  if (!row) {
    return {
      name: '', objective: '', startOn: today, endOn: '', budget: '', status: 'draft', notes: '', allChannels: false, channels: [], items: [],
    };
  }
  return {
    name: row.name || '',
    objective: row.objective || '',
    startOn: row.startOn || '',
    endOn: row.endOn || '',
    budget: row.budget !== null && row.budget !== undefined ? String(row.budget) : '',
    status: row.status,
    notes: row.notes || '',
    allChannels: row.channels === 'all',
    channels: row.channels === 'all' ? [] : [...(row.channels || [])],
    items: (row.items || []).map((i) => ({ itemNo: i.itemNo, itemName: i.itemName })),
  };
}

/** Status options the form offers: a new campaign starts as draft or running. */
export function statusOptions(row) {
  const allowed = row ? NEXT_STATUSES[row.status] || [row.status] : ['draft', 'berjalan'];
  return allowed.map((value) => ({ value, label: STATUS_LABELS[value] }));
}

export const isClosed = (row) => Boolean(row && ['selesai', 'dibatalkan'].includes(row.status));

/** Field → Indonesian message, checked before sending. */
export function formErrors(values, row = null) {
  const errors = {};
  const closed = isClosed(row);
  if (!closed) {
    if (!String(values.name || '').trim()) errors.name = 'Isi nama kampanye';
    if (!values.objective) errors.objective = 'Pilih tujuan kampanye';
    if (!isDay(values.startOn)) errors.startOn = 'Isi tanggal mulai';
    if (!isDay(values.endOn)) errors.endOn = 'Isi tanggal selesai';
    else if (isDay(values.startOn) && values.endOn < values.startOn) errors.endOn = 'Tanggal selesai tidak boleh sebelum tanggal mulai';
    if (!values.allChannels && !(values.channels || []).length) errors.channels = 'Pilih minimal satu channel, atau semua channel';
    if (String(values.budget ?? '').trim() !== '') {
      const n = Number(values.budget);
      if (!Number.isFinite(n) || n < 0) errors.budget = 'Anggaran berupa angka 0 atau lebih';
    }
    if ((values.items || []).length > MAX_ITEMS) errors.items = `Paling banyak ${MAX_ITEMS} produk`;
  }
  if (String(values.notes || '').length > 1000) errors.notes = 'Catatan paling panjang 1.000 karakter';
  return errors;
}

const channelsOf = (values) => (values.allChannels ? 'all' : CHANNELS.filter((c) => (values.channels || []).includes(c)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The request body: everything on create; on edit only what changed, plus the version. */
export function formBody(values, row = null) {
  const full = {
    name: String(values.name || '').trim(),
    objective: values.objective,
    startOn: values.startOn,
    endOn: values.endOn,
    budget: String(values.budget ?? '').trim() === '' ? null : Number(values.budget),
    status: values.status,
    notes: String(values.notes || '').trim() || null,
    channels: channelsOf(values),
    items: (values.items || []).map((i) => i.itemNo),
  };
  if (!row) return full;
  const current = {
    name: row.name,
    objective: row.objective,
    startOn: row.startOn,
    endOn: row.endOn,
    budget: row.budget ?? null,
    status: row.status,
    notes: row.notes || null,
    channels: row.channels === 'all' ? 'all' : CHANNELS.filter((c) => (row.channels || []).includes(c)),
    items: (row.items || []).map((i) => i.itemNo),
  };
  const body = { version: row.version };
  const fields = isClosed(row) ? ['notes'] : Object.keys(full);
  for (const field of fields) {
    const a = field === 'items' ? [...full.items].sort() : full[field];
    const b = field === 'items' ? [...current.items].sort() : current[field];
    if (!same(a, b)) body[field] = full[field];
  }
  return body;
}

/** Toggle one channel chip; picking every channel is "all". */
export function toggleChannel(values, code) {
  if (code === 'all') return { ...values, allChannels: !values.allChannels, channels: [] };
  const set = new Set(values.allChannels ? [] : values.channels);
  if (set.has(code)) set.delete(code); else set.add(code);
  const channels = CHANNELS.filter((c) => set.has(c));
  if (channels.length === CHANNELS.length) return { ...values, allChannels: true, channels: [] };
  return { ...values, allChannels: false, channels };
}

/** Add a product to the target list once. */
export function addItem(items = [], item) {
  if (!item?.itemNo || items.some((i) => i.itemNo === item.itemNo) || items.length >= MAX_ITEMS) return items;
  return [...items, { itemNo: item.itemNo, itemName: item.itemName || item.itemNo }];
}

// ------------------------------------------------------------ Prakasa AI (Wave C2, docs/prakasa-ai-rencana.md §9.9)
/** GET /marketing/items rows → lookup options. Names and codes are Accurate's: passed through as they are. */
export function itemOptions(rows) {
  return (Array.isArray(rows) ? rows : []).filter((i) => i && i.itemNo)
    .map((i) => ({ value: i.itemNo, label: String(i.itemName || i.itemNo), hint: String(i.itemNo) }));
}

/** Target rows as the AI left them ({ itemNo }) → the form's own rows ({ itemNo, itemName }), each product once. */
export function itemsFromAI(rows, nameOf = () => '') {
  const seen = new Set();
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.itemNo || seen.has(row.itemNo)) continue;
    seen.add(row.itemNo);
    items.push({ itemNo: row.itemNo, itemName: row.itemName || nameOf(row.itemNo) || row.itemNo });
  }
  return items;
}
