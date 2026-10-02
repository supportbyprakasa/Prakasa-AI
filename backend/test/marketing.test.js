const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, dbReady, inRolledBackTransaction, makeUser, departmentId } = require('./fixtures/gaDb');
const insights = require('../src/services/marketingInsights.service');
const campaigns = require('../src/services/marketingCampaigns.service');
const provider = require('../src/management/providers/marketing');
const { validateProvider, STORED_KEYS } = require('../src/management/contract');
const registry = require('../src/management/registry');
const reminders = require('../src/jobs/marketingReminders');
const { schemas } = require('../src/routes/marketing.routes');

// Marketing (migration 119): "Produk & channel" insights (aggregates over the
// approved Accurate mirror) and the campaign tracker, reported to management.

test.after(() => pool.end());

const SKIP = 'no database with migration 119';
const ready = async () => (await dbReady())
  && (await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'mkt_campaigns'"))[0][0].n > 0;
const TODAY = '2026-10-01';
const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

const base = { name: 'Promo Oatside', channels: ['FoodService', 'MT'], objective: 'penjualan', startOn: '2026-09-01', endOn: '2026-09-30' };

// ------------------------------------------------------------ route schemas
test('route bodies are strict: no entity, division or version smuggled into a create', () => {
  const { campaignCreate, campaignUpdate } = schemas;
  assert.equal(campaignCreate.safeParse(base).success, true);
  assert.equal(campaignCreate.safeParse({ ...base, entityId: 2 }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, departmentId: 10 }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, version: 1 }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, channels: 'all', items: ['DAI-OAT-1L-004-02'], budget: 5000000, status: 'berjalan' }).success, true);
  assert.equal(campaignCreate.safeParse({ ...base, channels: ['Instagram'] }).success, false, 'only known channel codes');
  assert.equal(campaignCreate.safeParse({ ...base, channels: [] }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, objective: 'viral' }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, budget: -1 }).success, false);
  assert.equal(campaignCreate.safeParse({ ...base, endOn: '2026-08-31' }).success, false, 'end before start');
  assert.equal(campaignCreate.safeParse({ ...base, status: 'selesai' }).success, false, 'a new campaign is draft or running');
  assert.equal(campaignUpdate.safeParse({ name: 'X' }).success, false, 'an edit needs the version');
  assert.equal(campaignUpdate.safeParse({ version: 2, status: 'selesai', notes: 'Hasil: naik' }).success, true);
  assert.equal(campaignUpdate.safeParse({ version: 2, startOn: '2026-09-10', endOn: '2026-09-01' }).success, false);
  assert.equal(campaignUpdate.safeParse({ version: 2, createdBy: 1 }).success, false);
});

// ------------------------------------------------------------ campaign rules (pure)
test('campaign rules: dates, length, budget, status transitions', () => {
  const ok = { ...base, status: 'draft', budget: null };
  assert.doesNotThrow(() => campaigns.checkRules(ok, null, TODAY));
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => campaigns.checkRules({ ...ok, endOn: '2026-08-31' }, null, TODAY)), 'DATES_INVALID');
  assert.equal(code(() => campaigns.checkRules({ ...ok, startOn: '2026-02-30' }, null, TODAY)), 'DATE_INVALID');
  assert.equal(code(() => campaigns.checkRules({ ...ok, startOn: '2025-01-01', endOn: '2026-09-30' }, null, TODAY)), 'DATES_TOO_LONG');
  assert.equal(code(() => campaigns.checkRules({ ...ok, name: '  ' }, null, TODAY)), 'NAME_REQUIRED');
  assert.equal(code(() => campaigns.checkRules({ ...ok, budget: -5 }, null, TODAY)), 'BUDGET_INVALID');
  assert.equal(code(() => campaigns.checkRules({ ...ok, status: 'selesai' }, null, TODAY)), 'STATUS_INVALID', 'no new campaign starts finished');
  // Transitions: draft → running → done; done and cancelled are final.
  assert.doesNotThrow(() => campaigns.checkRules({ ...ok, status: 'berjalan' }, { status: 'draft' }, TODAY));
  assert.doesNotThrow(() => campaigns.checkRules({ ...ok, status: 'selesai' }, { status: 'berjalan' }, TODAY));
  assert.equal(code(() => campaigns.checkRules({ ...ok, status: 'selesai' }, { status: 'draft' }, TODAY)), 'STATUS_TRANSITION');
  assert.equal(code(() => campaigns.checkRules({ ...ok, status: 'berjalan' }, { status: 'dibatalkan' }, TODAY)), 'STATUS_TRANSITION');
  assert.equal(code(() => campaigns.checkRules({ ...ok, status: 'draft' }, { status: 'selesai' }, TODAY)), 'STATUS_TRANSITION');
  assert.equal(
    code(() => campaigns.checkRules({ ...ok, startOn: '2026-10-05', endOn: '2026-10-20', status: 'selesai' }, { status: 'berjalan' }, TODAY)),
    'NOT_STARTED', 'a campaign that has not started cannot be finished',
  );
});

test('channels: "all", or known codes in canonical order; every code = all', () => {
  assert.equal(campaigns.normalizeChannels('all'), 'all');
  assert.deepEqual(campaigns.normalizeChannels(['MT', 'GT', 'MT']), ['GT', 'MT']);
  assert.equal(campaigns.normalizeChannels(['GT', 'MT', 'FoodService', 'Shopee', 'TokoPedia', 'GRAB', 'GOJEK', 'Export']), 'all');
  assert.throws(() => campaigns.normalizeChannels([]), (e) => e.code === 'CHANNELS_REQUIRED');
  assert.throws(() => campaigns.normalizeChannels(['TikTok']), (e) => e.code === 'CHANNEL_UNKNOWN');
  assert.equal(campaigns.parseChannels('"all"'), 'all');
  assert.deepEqual(campaigns.parseChannels('["GT"]'), ['GT']);
  assert.equal(campaigns.channelsText(['FoodService', 'MT']), 'Food Service, Modern Trade');
});

// ------------------------------------------------------------ uplift math (pure)
test('uplift: the campaign against the same number of days right before it', () => {
  // A finished 10-day campaign, data through after it.
  const done = campaigns.campaignWindow({ startOn: '2026-09-11', endOn: '2026-09-20', today: TODAY, dataThrough: '2026-09-30' });
  assert.deepEqual(done, { state: 'ok', start: '2026-09-11', end: '2026-09-20', days: 10, partial: false, baselineStart: '2026-09-01', baselineEnd: '2026-09-10' });
  // Running: measured to today, baseline as long.
  const running = campaigns.campaignWindow({ startOn: '2026-09-25', endOn: '2026-10-10', today: '2026-09-28', dataThrough: '2026-09-30' });
  assert.equal(running.days, 4);
  assert.equal(running.partial, true);
  assert.equal(running.baselineStart, '2026-09-21');
  // Accurate data only reaches the 27th: measured to the 27th.
  const lagging = campaigns.campaignWindow({ startOn: '2026-09-25', endOn: '2026-10-10', today: TODAY, dataThrough: '2026-09-27' });
  assert.equal(lagging.end, '2026-09-27');
  assert.equal(lagging.days, 3);
  assert.equal(campaigns.campaignWindow({ startOn: '2026-10-05', endOn: '2026-10-10', today: TODAY, dataThrough: '2026-09-30' }).state, 'not_started');
  assert.equal(campaigns.campaignWindow({ startOn: '2026-10-01', endOn: '2026-10-10', today: TODAY, dataThrough: '2026-09-30' }).state, 'no_data');

  assert.equal(campaigns.upliftPct(150, 100), 50);
  assert.equal(campaigns.upliftPct(80, 100), -20);
  assert.equal(campaigns.upliftPct(100, 300), -66.7);
  assert.equal(campaigns.upliftPct(500, 0), null, 'no baseline → no uplift, never Infinity');

  const sum = campaigns.summarizeDays([
    { d: '2026-09-02', revenue: '100.00', qty: '2' },
    { d: '2026-09-10', revenue: '50.00', qty: '1' },
    { d: '2026-09-12', revenue: '300.00', qty: '5' },
    { d: '2026-09-25', revenue: '999.00', qty: '9' }, // outside both windows
  ], done);
  assert.equal(sum.revenue, 300);
  assert.equal(sum.baselineRevenue, 150);
  assert.equal(sum.qty, 5);
  assert.equal(sum.series.length, 20, 'per day for short campaigns');
  assert.deepEqual(sum.series.filter((p) => p.phase === 'campaign').map((p) => p.revenue).slice(0, 2), [0, 300]);
  assert.equal(sum.series[0].label, '01/09');
  const long = campaigns.campaignWindow({ startOn: '2026-06-01', endOn: '2026-08-31', today: TODAY, dataThrough: '2026-09-30' });
  const weekly = campaigns.summarizeDays([], long);
  assert.equal(weekly.seriesStep, 'week');
  assert.ok(weekly.series.every((p, i, all) => i === 0 || p.phase === all[i - 1].phase || p.key === long.start), 'blocks never straddle the start');
});

// ------------------------------------------------------------ insights shaping (pure)
test('insights: months, channel series with unknown months, products, movers', () => {
  assert.equal(insights.resolveMonth(undefined, TODAY), '2026-10');
  assert.throws(() => insights.resolveMonth('2026-11', TODAY), (e) => e.code === 'VALIDATION_ERROR');
  assert.throws(() => insights.resolveMonth('2026-13', TODAY), (e) => e.code === 'VALIDATION_ERROR');
  const months = insights.windowMonths('2026-09');
  assert.equal(months.length, 12);
  assert.deepEqual([months[0].key, months[11].key, months[11].label], ['2025-10', '2026-09', 'Sep 2026']);

  const series = insights.channelSeries(months, {
    revenueRows: [
      { month: '2026-08', channel: 'GT', revenue: '100' }, { month: '2026-09', channel: 'GT', revenue: '50' },
      { month: '2026-09', channel: null, revenue: '70' },
    ],
    lineRows: [{ month: '2026-09', channel: 'GT', qty: '3', has_ratio: 0 }],
    nooRows: [{ month: '2026-09', channel: 'GT', customers: 2 }],
    firstMonth: '2026-08',
    lastMonth: '2026-09',
  });
  assert.deepEqual(series.map((s) => s.key), ['GT', 'none']);
  assert.equal(series[0].label, 'General Trade');
  assert.equal(series[1].label, 'Tanpa channel');
  assert.equal(series[0].revenue[0], null, 'before the first data month: unknown, not 0');
  assert.deepEqual(series[0].revenue.slice(-2), [100, 50]);
  assert.equal(series[0].qty[11], 3);
  assert.equal(series[0].noo[11], 2);

  const rows = [
    { month: '2026-09', channel: 'GT', item_code: 'A', item_name: 'Produk A', unit: 'PCS', qty: '10', revenue: '300', has_ratio: 0 },
    { month: '2026-09', channel: 'MT', item_code: 'A', item_name: 'Produk A', unit: 'Box', qty: '1', revenue: '100', has_ratio: 0 },
    { month: '2026-08', channel: 'GT', item_code: 'A', item_name: 'Produk A', unit: 'PCS', qty: '5', revenue: '200', has_ratio: 0 },
    { month: '2026-08', channel: 'GT', item_code: 'B', item_name: 'Produk B', unit: 'PCS', qty: '5', revenue: '500', has_ratio: 0 },
    { month: '2026-09', channel: 'GT', item_code: 'C', item_name: 'Produk C', unit: 'PCS', qty: '1', revenue: '50', has_ratio: 0 },
  ];
  const products = insights.productTotals(rows, '2026-09', '2026-08');
  const a = products.find((p) => p.itemCode === 'A');
  assert.equal(a.revenue, 400);
  assert.equal(a.changePct, 100);
  assert.deepEqual(a.qty, [{ unit: 'PCS', qty: 10 }, { unit: 'Box', qty: 1 }], 'units are never added together');
  assert.deepEqual(a.channels.map((c) => c.key), ['GT', 'MT'], 'channels by revenue');
  assert.deepEqual(insights.topProducts(products).map((p) => p.itemCode), ['A', 'C'], 'only products sold this month');
  const m = insights.movers(products);
  assert.deepEqual(m.rising.map((p) => p.itemCode), ['A', 'C']);
  assert.deepEqual(m.falling.map((p) => p.itemCode), ['B']);
  assert.equal(products.find((p) => p.itemCode === 'C').changePct, null, 'new this month: no % change');
});

// ------------------------------------------------------------ aggregate only
const FORBIDDEN = /\b(customer_name|invoice_number|customer_code|sales_person_name|doc_id|number|contact_person|phone|email|address)\b\s*(,|AS|FROM)/i;

test('insights SQL is aggregate-only: every query groups or sums, none selects a document, customer or salesperson', async (t) => {
  const texts = [...Object.values(insights.SQL), campaigns.PERFORMANCE_SQL.dataThrough,
    campaigns.PERFORMANCE_SQL.days(' AND l.channel IN (?)', ' AND l.item_code IN (?)'), campaigns.PERFORMANCE_SQL.noo('')];
  for (const sql of texts) {
    const select = sql.slice(0, sql.search(/\bFROM\b/));
    assert.match(sql, /\b(SUM|COUNT|MAX)\(/, `aggregates: ${sql.slice(0, 60)}`);
    assert.doesNotMatch(select, FORBIDDEN, `no detail column: ${select}`);
  }

  // The whole page, run against a recording database: every statement is one of the above.
  const seen = [];
  const fake = {
    query: async (sql) => {
      seen.push(sql);
      if (/MAX\(a\.trans_date\)/.test(sql)) return [[{ d: '2026-09-30' }]];
      if (/current_count/.test(sql)) return [[{ current_count: 3, previous_count: 1 }]];
      if (/sales_revenue_accurate/.test(sql)) return [[{ month: '2026-09', channel: 'GT', revenue: '1000' }]];
      if (/mg_invoice_lines_accurate/.test(sql)) return [[{ month: '2026-09', channel: 'GT', item_code: 'A', item_name: 'A', unit: 'PCS', qty: '2', has_ratio: 0, revenue: '900' }]];
      return [[]];
    },
  };
  t.mock.method(pool, 'query', async () => [[{ n: 1 }]]); // an approved Sales batch exists
  const page = await insights.insights(1, { month: 'latest' }, fake, { today: TODAY });
  assert.equal(page.month, '2026-09', 'latest = the month Accurate data reaches');
  assert.equal(page.kpis.revenue.value, 1000);
  assert.equal(page.topProducts[0].revenue, 900);
  assert.ok(seen.length >= 5);
  for (const sql of seen) assert.ok(texts.includes(sql), `unexpected statement: ${sql.slice(0, 80)}`);
  assert.doesNotMatch(JSON.stringify(page), /invoice|customer_name/i);
});

test('before the first approved Sales batch the Accurate figures stay empty; leads still show', async (t) => {
  const fake = { query: async (sql) => (/current_count/.test(sql) ? [[{ current_count: 4, previous_count: 2 }]] : [[{ area: 'Tangerang', total: 4, open_count: 4, visited: 4, converted: 0, dropped: 0, new_in_month: 4 }]]) };
  t.mock.method(pool, 'query', async () => [[{ n: 0 }]]);
  const page = await insights.insights(1, {}, fake, { today: TODAY });
  assert.equal(page.accurate, false);
  assert.equal(page.kpis.revenue, null);
  assert.deepEqual(page.channels, []);
  assert.equal(page.kpis.newLeads.value, 4);
  assert.equal(page.leads.byArea[0].area, 'Tangerang');
});

// ------------------------------------------------------------ management provider
test('provider: valid, keys fit their columns, unique in the registry', () => {
  const p = validateProvider(provider);
  assert.equal(p.key, 'marketing');
  assert.deepEqual(p.navPaths, ['/marketing/insights', '/marketing/campaigns']);
  for (const e of p.escalations) assert.ok(e.key.length <= STORED_KEYS.escalations.max);
  for (const m of p.metrics) assert.ok(m.key.length <= STORED_KEYS.metrics.max);
  registry.reset();
  assert.ok(registry.providers().some((x) => x.key === 'marketing'));
  // Escalations never carry rupiah, and nothing here is rupiah without the permission.
  for (const item of [...p.metrics, ...p.kpis]) {
    if (item.unit === 'rupiah') assert.ok([].concat(item.permission || []).includes('marketing.insight.view'));
  }
});

test('provider: every query binds the entity first, then the division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ total: 0 }]]; });
  await provider.escalations[0].list(1, { departmentId: 10 });
  await provider.kpis[0].value(1, { departmentId: 10 });
  await provider.metrics.find((m) => m.key === 'mkt_campaigns_done').actuals(1, { start: '2026-09-01', end: '2026-09-30' }, { departmentId: 10 });
  for (const c of calls) {
    assert.match(c.sql, /c\.entity_id = \? AND c\.department_id = \?/);
    assert.deepEqual(c.args.slice(0, 2), [1, 10]);
  }
  calls.length = 0;
  await provider.escalations[0].list(1, { departmentId: null });
  assert.doesNotMatch(calls[0].sql, /department_id = \?/, 'company-wide view: no division filter');
});

// ------------------------------------------------------------ database
test('db: create, version conflict, close; escalation for Marketing only; reminder; activity log', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const mk = await makeUser(conn, { name: 'Marketing', division: 'marketing', roles: ['marketing.supervisor'] });
    const mkDept = await departmentId(conn, 'marketing');
    const salesDept = await departmentId(conn, 'sales');
    const today = wibToday();
    const [[item]] = await conn.query('SELECT item_code FROM sales_items_accurate WHERE entity_id = 1 LIMIT 1');

    await assert.rejects(
      campaigns.createCampaign(conn, { entityId: 1, userId: mk.id, body: { ...base, items: ['TIDAK-ADA-XYZ'] } }),
      (e) => e.code === 'ITEM_UNKNOWN',
    );
    const id = await campaigns.createCampaign(conn, {
      entityId: 1, userId: mk.id,
      body: { name: '[UJI] Kampanye', channels: ['MT', 'FoodService'], objective: 'penjualan', startOn: campaigns.addDays(today, -20), endOn: campaigns.addDays(today, -3), budget: 7500000, status: 'berjalan', items: item ? [item.item_code] : [] },
    });
    const c = await campaigns.getCampaign(conn, 1, id);
    assert.equal(c.departmentId, mkDept, 'owned by the Marketing division, never from the body');
    assert.deepEqual(c.channels, ['MT', 'FoodService']);
    assert.equal(c.endedOpen, true);
    assert.equal(await campaigns.getCampaign(conn, 2, id), null, 'another entity never sees it');

    // Escalation: Marketing's division only; locate resolves the episode.
    const esc = provider.escalations[0];
    const mine = (await esc.list(1, { departmentId: mkDept })).find((x) => Math.floor(x.sourceId / provider.EPISODE_FACTOR) === id);
    assert.ok(mine);
    assert.ok(mine.daysLate >= 3);
    assert.equal(mine.link, `/marketing/campaigns?open=${id}`);
    assert.doesNotMatch(JSON.stringify(mine), /7500000/, 'no money in management');
    assert.equal((await esc.list(1, { departmentId: salesDept })).some((x) => Math.floor(x.sourceId / provider.EPISODE_FACTOR) === id), false);
    assert.deepEqual(await esc.locate(mine.sourceId), { entityId: 1, departmentId: mkDept });
    const kpi = await provider.kpis[0].value(1, { departmentId: mkDept });
    assert.ok(kpi.value >= 1);
    assert.equal(kpi.alert, true);

    // Reminder: the Supervisor (and the creator) once per campaign and end date.
    const sent = [];
    const notify = async (n) => { sent.push(n); return sent.length; };
    await reminders.runOnce({ today, db: conn, notify });
    const forThis = sent.filter((n) => n.subjectId === id);
    assert.ok(forThis.some((n) => n.userId === mk.id));
    assert.ok(forThis.every((n) => n.event === 'marketing.campaign_ended' && n.dedupeKey.startsWith(`mkt_campaign_ended:${id}:`)));

    // Version conflict, then close with a result.
    await assert.rejects(
      campaigns.updateCampaign(conn, { entityId: 1, userId: mk.id, id, body: { version: c.version + 1, status: 'selesai' } }),
      (e) => e.code === 'VERSION_CONFLICT' && e.status === 409,
    );
    await assert.rejects(
      campaigns.updateCampaign(conn, { entityId: 1, userId: mk.id, id, body: { version: c.version, endOn: campaigns.addDays(today, -30) } }),
      (e) => e.code === 'DATES_INVALID',
    );
    const closed = await campaigns.updateCampaign(conn, { entityId: 1, userId: mk.id, id, body: { version: c.version, status: 'selesai', notes: 'Hasil: omzet naik' } });
    assert.deepEqual(closed.changed.sort(), ['notes', 'status']);
    assert.equal((await esc.list(1, { departmentId: mkDept })).some((x) => Math.floor(x.sourceId / provider.EPISODE_FACTOR) === id), false, 'closing resolves it');
    await assert.rejects(
      campaigns.updateCampaign(conn, { entityId: 1, userId: mk.id, id, body: { version: closed.version, budget: 1 } }),
      (e) => e.code === 'CAMPAIGN_CLOSED',
    );
    await campaigns.updateCampaign(conn, { entityId: 1, userId: mk.id, id, body: { version: closed.version, notes: 'Hasil final' } });
    const done = await provider.metrics.find((m) => m.key === 'mkt_campaigns_done').actuals(1, { start: campaigns.addDays(today, -10), end: today }, { departmentId: mkDept });
    assert.ok(done.get(mkDept) >= 1);

    const [logs] = await conn.query("SELECT action FROM activity_logs WHERE subject_type = 'mkt_campaign' AND subject_id = ? ORDER BY id", [id]);
    assert.deepEqual(logs.map((l) => l.action), ['mkt_campaign.create', 'mkt_campaign.status_selesai', 'mkt_campaign.update']);
  });
});

test('db: live performance matches the mirror summed directly', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const through = await campaigns.dataThroughOf(conn, 1);
    if (!through) return t.skip('no approved Accurate invoices');
    const end = through;
    const start = campaigns.addDays(end, -13);
    const [[top]] = await conn.query(
      `SELECT item_code FROM mg_invoice_lines_accurate WHERE entity_id = 1 AND NOT is_dp AND trans_date BETWEEN ? AND ?
        GROUP BY item_code ORDER BY SUM(revenue) DESC LIMIT 1`,
      [start, end],
    );
    if (!top) return t.skip('no faktur lines in the last two weeks of data');
    const campaign = { startOn: start, endOn: end, channels: 'all', items: [{ itemNo: top.item_code }] };
    const perf = await campaigns.performance(conn, 1, campaign, { today: campaigns.addDays(end, 1), reliable: true });
    assert.equal(perf.state, 'ok');
    const [[direct]] = await conn.query(
      `SELECT SUM(CASE WHEN trans_date >= ? THEN revenue ELSE 0 END) AS cur, SUM(CASE WHEN trans_date < ? THEN revenue ELSE 0 END) AS base
         FROM mg_invoice_lines_accurate WHERE entity_id = 1 AND NOT is_dp AND item_code = ? AND trans_date BETWEEN ? AND ?`,
      [start, start, top.item_code, campaigns.addDays(start, -14), end],
    );
    assert.equal(perf.revenue, Math.round(Number(direct.cur) * 100) / 100);
    assert.equal(perf.baselineRevenue, Math.round(Number(direct.base || 0) * 100) / 100);
    assert.equal(perf.upliftPct, campaigns.upliftPct(perf.revenue, perf.baselineRevenue));
    assert.equal(perf.window.days, 14);
  });
});
