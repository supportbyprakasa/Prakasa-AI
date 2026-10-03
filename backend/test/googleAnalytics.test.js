const test = require('node:test');
const assert = require('node:assert/strict');
const analytics = require('../src/services/googleAnalytics.service');
const ctrl = require('../src/controllers/googleAnalytics.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const user = { sub: 1, entityId: 1, email: 'admin@prakasafoods.com', permissions: ['analytics.view'] };
const rethrow = (error) => { throw error; };
const NOW = Date.parse('2026-09-28T03:00:00Z'); // 10:00 in Jakarta

function withEnv(t, values) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

// ---- setup state ----------------------------------------------------------

test('status: no service account configured → setup state, Google not called', async (t) => {
  withEnv(t, { GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined });
  t.mock.method(analytics, 'listProperties', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.status({ user, query: {} }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.ready, false);
  assert.equal(res.body.data.reason, 'NOT_CONFIGURED');
  assert.equal(res.body.data.serviceAccountConfigured, false);
});

test('status: disabled Analytics API → 200 setup state with the service account email', async (t) => {
  withEnv(t, { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@proj.iam.gserviceaccount.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'k' });
  t.mock.method(analytics, 'listProperties', async () => {
    throw Object.assign(new Error('Google Analytics Admin API has not been used in project 123 before or it is disabled.'), { code: 403 });
  });
  const res = responseDouble();
  await ctrl.status({ user, query: {} }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reason, 'API_DISABLED');
  assert.equal(res.body.data.serviceAccountEmail, 'sa@proj.iam.gserviceaccount.com');
  assert.equal(res.body.data.serviceAccountConfigured, true);
  assert.equal(Object.keys(res.body.data).includes('privateKey'), false);
});

test('status: permission denied → NO_ACCESS; no properties → NO_PROPERTIES; properties → ready', async (t) => {
  withEnv(t, { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@x', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'k' });
  const mock = t.mock.method(analytics, 'listProperties', async () => { throw Object.assign(new Error('User does not have sufficient permissions'), { code: 403 }); });
  let res = responseDouble();
  await ctrl.status({ user, query: {} }, res, rethrow);
  assert.equal(res.body.data.reason, 'NO_ACCESS');

  mock.mock.mockImplementation(async () => []);
  res = responseDouble();
  await ctrl.status({ user, query: {} }, res, rethrow);
  assert.equal(res.body.data.reason, 'NO_PROPERTIES');

  mock.mock.mockImplementation(async () => [{ id: 'properties/1', name: 'Web', account: 'Prakasa' }]);
  res = responseDouble();
  await ctrl.status({ user, query: {} }, res, rethrow);
  assert.equal(res.body.data.ready, true);
  assert.equal(res.body.data.properties.length, 1);
});

// ---- validation -----------------------------------------------------------

test('property ids must be properties/<digits>', () => {
  assert.equal(analytics.isValidPropertyId('properties/123456'), true);
  for (const bad of ['123', 'properties/abc', 'properties/1/../2', 'accounts/1', '', null]) {
    assert.equal(analytics.isValidPropertyId(bad), false, String(bad));
  }
});

test('preset ranges end yesterday (Jakarta) and compare with the same-length previous period', () => {
  const r = analytics.resolveRange({ range: '7d' }, NOW);
  assert.deepEqual(r, { key: '7d', start: '2026-09-21', end: '2026-09-27', previousStart: '2026-09-14', previousEnd: '2026-09-20', days: 7 });
  assert.equal(analytics.resolveRange({ range: '28d' }, NOW).days, 28);
  assert.equal(analytics.resolveRange({ range: '90d' }, NOW).start, '2026-06-30');
});

test('custom ranges are validated', () => {
  const ok = analytics.resolveRange({ range: 'custom', start: '2026-09-01', end: '2026-09-10' }, NOW);
  assert.equal(ok.days, 10);
  assert.equal(ok.previousStart, '2026-08-22');
  assert.equal(ok.previousEnd, '2026-08-31');
  const bad = [
    { range: 'custom', start: '2026-02-30', end: '2026-03-01' }, // not a real date
    { range: 'custom', start: '2026-09-10', end: '2026-09-01' }, // reversed
    { range: 'custom', start: '2026-09-01', end: '2026-10-01' }, // future
    { range: 'custom', start: '2024-01-01', end: '2026-01-01' }, // too long
    { range: 'custom', start: "2026-09-01' OR 1", end: '2026-09-02' },
    { range: '365d' },
    {},
  ];
  for (const input of bad) assert.ok(analytics.resolveRange(input, NOW).error, JSON.stringify(input));
});

test('report: invalid property or range is rejected before any Google call', async (t) => {
  t.mock.method(analytics, 'listProperties', async () => { throw new Error('must not be called'); });
  let res = responseDouble();
  await ctrl.report({ user, query: { property: '../x', range: '7d' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
  res = responseDouble();
  await ctrl.report({ user, query: { property: 'properties/1', range: 'forever' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
});

test('report: a property the service account cannot list is refused', async (t) => {
  t.mock.method(analytics, 'listProperties', async () => [{ id: 'properties/1' }]);
  t.mock.method(analytics, 'runReport', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.report({ user, query: { property: 'properties/2', range: '7d' } }, res, rethrow);
  assert.equal(res.statusCode, 404);
});

test('report: disabled Data API maps to a clear 503 (never a 401)', async (t) => {
  t.mock.method(analytics, 'listProperties', async () => [{ id: 'properties/1' }]);
  t.mock.method(analytics, 'runReport', async () => {
    throw Object.assign(new Error('Google Analytics Data API has not been used in project 1 before or it is disabled'), { code: 403 });
  });
  const res = responseDouble();
  await ctrl.report({ user, query: { property: 'properties/1', range: '28d' } }, res, rethrow);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_API_DISABLED');
});

// ---- whitelist + shaping --------------------------------------------------

test('report requests use only server-defined metrics and dimensions', () => {
  const range = analytics.resolveRange({ range: '7d' }, NOW);
  const requests = analytics.reportRequests(range);
  assert.deepEqual(Object.keys(requests), ['kpis', 'series', 'topPages', 'channels', 'devices', 'countries']);
  assert.equal(requests.kpis.dateRanges.length, 2);
  assert.equal(requests.channels.dimensions[0].name, 'sessionDefaultChannelGroup');
});

const mv = (...values) => values.map((value) => ({ value: String(value) }));
const dv = (...values) => values.map((value) => ({ value }));

test('shapeReport: KPIs with previous period, zero-filled daily series, tables and lists', () => {
  const range = analytics.resolveRange({ range: '7d' }, NOW);
  const kpiHeaders = ['activeUsers', 'sessions', 'screenPageViews', 'userEngagementDuration', 'engagementRate', 'bounceRate'].map((name) => ({ name }));
  const raw = {
    kpis: {
      dimensionHeaders: [{ name: 'dateRange' }],
      metricHeaders: kpiHeaders,
      rows: [
        { dimensionValues: dv('date_range_1'), metricValues: mv(50, 80, 200, 5000, 0.5, 0.5) },
        { dimensionValues: dv('date_range_0'), metricValues: mv(100, 150, 400, 12000, 0.6, 0.4) },
      ],
    },
    series: {
      dimensionHeaders: [{ name: 'date' }],
      metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }],
      rows: [
        { dimensionValues: dv('20260921'), metricValues: mv(10, 12) },
        { dimensionValues: dv('20260923'), metricValues: mv(20, 25) },
      ],
    },
    topPages: {
      dimensionHeaders: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metricHeaders: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
      rows: [{ dimensionValues: dv('/', 'Beranda'), metricValues: mv(300, 90, 1800) }],
    },
    channels: {
      dimensionHeaders: [{ name: 'sessionDefaultChannelGroup' }],
      metricHeaders: [{ name: 'sessions' }],
      rows: [{ dimensionValues: dv('Direct'), metricValues: mv(70) }, { dimensionValues: dv(''), metricValues: mv(3) }],
    },
    devices: { rows: [] },
    countries: {
      dimensionHeaders: [{ name: 'country' }],
      metricHeaders: [{ name: 'activeUsers' }],
      rows: [{ dimensionValues: dv('Indonesia'), metricValues: mv('95') }],
    },
  };
  const shaped = analytics.shapeReport(raw, range);

  const kpi = Object.fromEntries(shaped.kpis.map((item) => [item.key, item]));
  assert.deepEqual(kpi.activeUsers, { key: 'activeUsers', value: 100, previous: 50 });
  assert.equal(kpi.avgEngagementTime.value, 120);
  assert.equal(kpi.avgEngagementTime.previous, 100);
  assert.equal(kpi.bounceRate.value, 0.4);

  assert.equal(shaped.series.length, 7);
  assert.deepEqual(shaped.series[0], { date: '2026-09-21', activeUsers: 10, sessions: 12 });
  assert.deepEqual(shaped.series[1], { date: '2026-09-22', activeUsers: 0, sessions: 0 });
  assert.equal(shaped.series[2].sessions, 25);

  assert.deepEqual(shaped.topPages[0], { path: '/', title: 'Beranda', views: 300, users: 90, avgEngagementTime: 20 });
  assert.deepEqual(shaped.channels, [{ label: 'Direct', value: 70 }, { label: '(not set)', value: 3 }]);
  assert.deepEqual(shaped.devices, []);
  assert.deepEqual(shaped.countries, [{ label: 'Indonesia', value: 95 }]);
});

test('reports are cached in memory for 5 minutes per key', () => {
  analytics.clearCache();
  const t0 = 1_000_000;
  analytics.cacheSet('k', { a: 1 }, t0);
  assert.deepEqual(analytics.cacheGet('k', t0 + analytics.CACHE_TTL_MS - 1), { a: 1 });
  assert.equal(analytics.cacheGet('k', t0 + analytics.CACHE_TTL_MS + 1), null);
  analytics.clearCache();
});

test('runReport serves a cached report without calling Google again', async (t) => {
  analytics.clearCache();
  const range = analytics.resolveRange({ range: '7d' }, NOW);
  analytics.cacheSet(`report|properties/9|${range.start}|${range.end}`, { property: 'properties/9', kpis: [] });
  const result = await analytics.runReport('properties/9', range);
  assert.equal(result.cached, true);
  assert.equal(result.property, 'properties/9');
  await assert.rejects(() => analytics.runReport('9', range));
  analytics.clearCache();
});
