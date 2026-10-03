const { google } = require('googleapis');
const { serviceAuth } = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');

// Google Analytics 4 reports, read as the service account itself: an admin
// adds GOOGLE_SERVICE_ACCOUNT_EMAIL as a Viewer on each GA property, and
// enables the Analytics Admin + Data APIs in the service account's Cloud
// project. The client never sends metric/dimension names — every report
// below is fixed here, and only a property id + date range come from outside.
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const PROPERTY_RE = /^properties\/\d{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRESET_DAYS = { '7d': 7, '28d': 28, '90d': 90 };
const MAX_CUSTOM_DAYS = 366;
const GA4_EPOCH = '2015-08-14';
const DAY_MS = 24 * 60 * 60 * 1000;

const cache = new Map();

function cacheGet(key, now = Date.now()) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value, now = Date.now()) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, value });
}

function clearCache() { cache.clear(); }

function setupStatus() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  return {
    serviceAccountConfigured: Boolean(email && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    serviceAccountEmail: email || null,
  };
}

const isValidPropertyId = (value) => PROPERTY_RE.test(String(value || ''));

// ---- Date ranges ----------------------------------------------------------

const iso = (date) => date.toISOString().slice(0, 10);
const parseDay = (value) => new Date(`${value}T00:00:00Z`);
const addDays = (value, days) => iso(new Date(parseDay(value).getTime() + days * DAY_MS));
const daysBetween = (start, end) => Math.round((parseDay(end) - parseDay(start)) / DAY_MS) + 1;

// "Today" in Asia/Jakarta (UTC+7), where the company and its GA properties live.
function jakartaToday(now = Date.now()) {
  return iso(new Date(now + 7 * 60 * 60 * 1000));
}

function isRealDate(value) {
  return DATE_RE.test(String(value || '')) && iso(parseDay(value)) === value;
}

// Returns { key, start, end, previousStart, previousEnd, days } or { error }.
// Presets end yesterday (like GA's own "Last N days"); custom ranges are
// bounded so nobody can ask Google for a decade of daily rows.
function resolveRange({ range, start, end } = {}, now = Date.now()) {
  const today = jakartaToday(now);
  let from;
  let to;
  if (PRESET_DAYS[range]) {
    to = addDays(today, -1);
    from = addDays(to, -(PRESET_DAYS[range] - 1));
  } else if (range === 'custom') {
    if (!isRealDate(start) || !isRealDate(end)) return { error: 'Tanggal harus berformat YYYY-MM-DD' };
    if (start > end) return { error: 'Tanggal mulai harus sebelum tanggal akhir' };
    if (end > today) return { error: 'Tanggal akhir tidak boleh di masa depan' };
    if (start < GA4_EPOCH) return { error: 'Tanggal mulai terlalu lama' };
    if (daysBetween(start, end) > MAX_CUSTOM_DAYS) return { error: `Rentang maksimal ${MAX_CUSTOM_DAYS} hari` };
    from = start;
    to = end;
  } else {
    return { error: 'Rentang tanggal tidak dikenal' };
  }
  const days = daysBetween(from, to);
  return {
    key: PRESET_DAYS[range] ? range : 'custom',
    start: from,
    end: to,
    previousStart: addDays(from, -days),
    previousEnd: addDays(from, -1),
    days,
  };
}

// ---- Report definitions (the whitelist) -----------------------------------

const KPI_METRICS = ['activeUsers', 'sessions', 'screenPageViews', 'userEngagementDuration', 'engagementRate', 'bounceRate'];

function reportRequests(range) {
  const current = { startDate: range.start, endDate: range.end };
  const previous = { startDate: range.previousStart, endDate: range.previousEnd };
  const metrics = (names) => names.map((name) => ({ name }));
  const dims = (names) => names.map((name) => ({ name }));
  const byMetricDesc = (name) => [{ metric: { metricName: name }, desc: true }];
  return {
    kpis: { dateRanges: [current, previous], metrics: metrics(KPI_METRICS) },
    series: {
      dateRanges: [current],
      dimensions: dims(['date']),
      metrics: metrics(['activeUsers', 'sessions']),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    },
    topPages: {
      dateRanges: [current],
      dimensions: dims(['pagePath', 'pageTitle']),
      metrics: metrics(['screenPageViews', 'activeUsers', 'userEngagementDuration']),
      orderBys: byMetricDesc('screenPageViews'),
      limit: 25,
    },
    channels: {
      dateRanges: [current],
      dimensions: dims(['sessionDefaultChannelGroup']),
      metrics: metrics(['sessions']),
      orderBys: byMetricDesc('sessions'),
      limit: 10,
    },
    devices: {
      dateRanges: [current],
      dimensions: dims(['deviceCategory']),
      metrics: metrics(['activeUsers']),
      orderBys: byMetricDesc('activeUsers'),
      limit: 10,
    },
    countries: {
      dateRanges: [current],
      dimensions: dims(['country']),
      metrics: metrics(['activeUsers']),
      orderBys: byMetricDesc('activeUsers'),
      limit: 10,
    },
  };
}

// ---- Shaping --------------------------------------------------------------

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function rowsOf(report) {
  const metricNames = (report?.metricHeaders || []).map((header) => header.name);
  const dimNames = (report?.dimensionHeaders || []).map((header) => header.name);
  return (report?.rows || []).map((row) => {
    const out = { dims: {}, metrics: {} };
    dimNames.forEach((name, i) => { out.dims[name] = row.dimensionValues?.[i]?.value ?? ''; });
    metricNames.forEach((name, i) => { out.metrics[name] = num(row.metricValues?.[i]?.value); });
    return out;
  });
}

function kpiTotals(metrics = {}) {
  const users = metrics.activeUsers || 0;
  return {
    activeUsers: metrics.activeUsers || 0,
    sessions: metrics.sessions || 0,
    screenPageViews: metrics.screenPageViews || 0,
    // GA's "average engagement time per active user", in seconds.
    avgEngagementTime: users ? (metrics.userEngagementDuration || 0) / users : 0,
    engagementRate: metrics.engagementRate || 0,
    bounceRate: metrics.bounceRate || 0,
  };
}

// With two date ranges GA adds a "dateRange" dimension: date_range_0 = current.
function shapeKpis(report) {
  const rows = rowsOf(report);
  const pick = (name) => rows.find((row) => row.dims.dateRange === name)?.metrics;
  const current = kpiTotals(pick('date_range_0') || (rows.length === 1 ? rows[0].metrics : {}));
  const previous = kpiTotals(pick('date_range_1') || {});
  return ['activeUsers', 'sessions', 'screenPageViews', 'avgEngagementTime', 'engagementRate', 'bounceRate']
    .map((key) => ({ key, value: current[key], previous: previous[key] }));
}

// One point per day of the range, zero-filled — GA omits days with no data.
function shapeSeries(report, range) {
  const byDate = new Map(rowsOf(report).map((row) => {
    const d = row.dims.date || '';
    return [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, row.metrics];
  }));
  const points = [];
  for (let i = 0; i < range.days; i += 1) {
    const date = addDays(range.start, i);
    const metrics = byDate.get(date) || {};
    points.push({ date, activeUsers: metrics.activeUsers || 0, sessions: metrics.sessions || 0 });
  }
  return points;
}

function shapeTopPages(report) {
  return rowsOf(report).map((row) => ({
    path: row.dims.pagePath,
    title: row.dims.pageTitle,
    views: row.metrics.screenPageViews,
    users: row.metrics.activeUsers,
    avgEngagementTime: row.metrics.activeUsers ? row.metrics.userEngagementDuration / row.metrics.activeUsers : 0,
  }));
}

const shapeBreakdown = (report, dim, metric) => rowsOf(report)
  .map((row) => ({ label: row.dims[dim] || '(not set)', value: row.metrics[metric] }));

function shapeReport(raw, range) {
  return {
    kpis: shapeKpis(raw.kpis),
    series: shapeSeries(raw.series, range),
    topPages: shapeTopPages(raw.topPages),
    channels: shapeBreakdown(raw.channels, 'sessionDefaultChannelGroup', 'sessions'),
    devices: shapeBreakdown(raw.devices, 'deviceCategory', 'activeUsers'),
    countries: shapeBreakdown(raw.countries, 'country', 'activeUsers'),
  };
}

// ---- Google calls ---------------------------------------------------------

async function listProperties(ctx = {}) {
  const cached = cacheGet('properties');
  if (cached) return cached;
  const properties = await integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_analytics',
    operation: 'listProperties',
    requestMeta: {},
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const admin = google.analyticsadmin({ version: 'v1beta', auth: serviceAuth(SCOPES) });
    const out = [];
    let pageToken;
    do {
      const response = await admin.accountSummaries.list({ pageSize: 200, pageToken });
      for (const account of response.data.accountSummaries || []) {
        for (const property of account.propertySummaries || []) {
          if (!isValidPropertyId(property.property)) continue;
          out.push({
            id: property.property,
            name: property.displayName || property.property,
            account: account.displayName || '',
          });
        }
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken && out.length < 500);
    return out;
  });
  cacheSet('properties', properties);
  return properties;
}

async function runReport(propertyId, range, ctx = {}) {
  if (!isValidPropertyId(propertyId)) throw Object.assign(new Error('Invalid property'), { code: 'VALIDATION_ERROR' });
  const key = `report|${propertyId}|${range.start}|${range.end}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const report = await integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_analytics',
    operation: 'runReport',
    requestMeta: { property: propertyId, start: range.start, end: range.end },
    responseMeta: (result) => ({ days: result?.series?.length || 0, pages: result?.topPages?.length || 0 }),
  }, async () => {
    const data = google.analyticsdata({ version: 'v1beta', auth: serviceAuth(SCOPES) });
    const requests = reportRequests(range);
    const names = Object.keys(requests);
    const responses = await Promise.all(names.map((name) => data.properties.runReport({
      property: propertyId,
      requestBody: requests[name],
    })));
    const raw = Object.fromEntries(names.map((name, i) => [name, responses[i].data]));
    return {
      property: propertyId,
      range,
      ...shapeReport(raw, range),
      generatedAt: new Date().toISOString(),
    };
  });
  cacheSet(key, report);
  return { ...report, cached: false };
}

module.exports = {
  setupStatus,
  isValidPropertyId,
  resolveRange,
  reportRequests,
  shapeReport,
  listProperties,
  runReport,
  clearCache,
  cacheGet,
  cacheSet,
  CACHE_TTL_MS,
};
