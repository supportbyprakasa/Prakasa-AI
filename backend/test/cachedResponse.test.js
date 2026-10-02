const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { memo } = require('../src/utils/memo');
const { cachedResponse, invalidateOnWrite } = require('../src/middleware/cachedResponse');

// Cached endpoints (middleware/cachedResponse.js) must never hand one scope's
// answer to another: company, division, permissions — and the user for a
// personal page. The shared cache is switched on for this file only.

const users = {
  headSales: { sub: 1, entityId: 1, departmentId: 2, permissions: ['management_dashboard.division', 'division_dashboard.view'] },
  headSales2: { sub: 2, entityId: 1, departmentId: 2, permissions: ['division_dashboard.view', 'management_dashboard.division'] },
  headWarehouse: { sub: 3, entityId: 1, departmentId: 4, permissions: ['management_dashboard.division', 'division_dashboard.view'] },
  management: { sub: 4, entityId: 1, departmentId: 2, permissions: ['management_dashboard.view'] },
  otherCompany: { sub: 5, entityId: 2, departmentId: 2, permissions: ['management_dashboard.division', 'division_dashboard.view'] },
  priceViewer: { sub: 6, entityId: 1, departmentId: 2, permissions: ['management_dashboard.division', 'division_dashboard.view', 'procurement.price.view'] },
};

let calls = 0;
let failNext = 0;
let gate = null;
let server;
let base;

test.before(async () => {
  memo.setEnabled(true);
  const app = express();
  app.use((req, res, next) => { req.user = users[req.headers['x-user']]; next(); });
  // The handler answers with the scope it computed for: a leak shows as a wrong scope.
  const handler = async (req, res) => {
    calls += 1;
    if (gate) await gate;
    if (failNext > 0) { failNext -= 1; return res.status(500).json({ success: false }); }
    return res.json({ success: true, data: { for: req.user.sub, entityId: req.user.entityId, departmentId: req.user.departmentId, permissions: [...req.user.permissions].sort(), q: req.query.q || null } });
  };
  app.get('/mgmt/summary', cachedResponse('mgmt:', 60000), handler);
  app.get('/sales/overview', cachedResponse('sales:', 60000, { perUser: true }), handler);
  app.put('/mgmt/targets', invalidateOnWrite('mgmt:'), (req, res) => res.json({ success: true }));
  app.put('/mgmt/refused', invalidateOnWrite('mgmt:'), (req, res) => res.status(403).json({ success: false }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  memo.clear();
  memo.setEnabled(null);
  server.close();
});

test.beforeEach(() => { memo.clear(); calls = 0; failNext = 0; gate = null; });

async function get(path, user) {
  const r = await fetch(base + path, { headers: { 'x-user': user } });
  return { status: r.status, cache: r.headers.get('x-cache'), body: await r.json() };
}

test('same company, division and permissions share one answer', async () => {
  const a = await get('/mgmt/summary', 'headSales');
  const b = await get('/mgmt/summary', 'headSales2');
  assert.equal(a.cache, 'miss');
  assert.equal(b.cache, 'hit');
  assert.equal(calls, 1);
  assert.deepEqual(b.body, a.body);
});

test('another division, company or permission set never gets a cached answer', async () => {
  const first = await get('/mgmt/summary', 'headSales');
  for (const who of ['headWarehouse', 'management', 'otherCompany', 'priceViewer']) {
    const r = await get('/mgmt/summary', who);
    assert.equal(r.cache, 'miss', who);
    assert.equal(r.body.data.for, users[who].sub, `${who} got its own answer`);
    assert.notDeepEqual(r.body, first.body, who);
  }
  assert.equal(calls, 5);
  // And each of them is cached separately.
  assert.equal((await get('/mgmt/summary', 'management')).body.data.for, users.management.sub);
  assert.equal((await get('/mgmt/summary', 'priceViewer')).body.data.for, users.priceViewer.sub);
  assert.equal(calls, 5);
});

test('a personal page is cached per user, even with identical permissions', async () => {
  await get('/sales/overview', 'headSales');
  const other = await get('/sales/overview', 'headSales2');
  assert.equal(other.cache, 'miss');
  assert.equal(other.body.data.for, users.headSales2.sub);
  assert.equal((await get('/sales/overview', 'headSales')).cache, 'hit');
  assert.equal(calls, 2);
});

test('the query string is part of the key', async () => {
  await get('/mgmt/summary?q=a', 'headSales');
  const b = await get('/mgmt/summary?q=b', 'headSales');
  assert.equal(b.cache, 'miss');
  assert.equal(b.body.data.q, 'b');
});

test('concurrent callers of one scope wait for one computation', async () => {
  let open;
  gate = new Promise((r) => { open = r; });
  const all = Promise.all([get('/mgmt/summary', 'headSales'), get('/mgmt/summary', 'headSales2'), get('/mgmt/summary', 'management')]);
  await new Promise((r) => setTimeout(r, 30));
  open();
  const [a, b, c] = await all;
  assert.equal(calls, 2, 'one computation for the shared scope, one for management');
  assert.deepEqual([a.cache, b.cache, c.cache].sort(), ['miss', 'miss', 'shared']);
  assert.equal(c.body.data.for, users.management.sub);
});

test('an error is not cached, and a waiter whose leader failed computes itself', async () => {
  failNext = 1;
  assert.equal((await get('/mgmt/summary', 'headSales')).status, 500);
  assert.equal((await get('/mgmt/summary', 'headSales')).status, 200, 'not served from cache');

  memo.clear(); calls = 0; failNext = 1;
  let open;
  gate = new Promise((r) => { open = r; });
  const both = Promise.all([get('/mgmt/summary', 'headSales'), get('/mgmt/summary', 'headSales2')]);
  await new Promise((r) => setTimeout(r, 30));
  open();
  const statuses = (await both).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 500]);
  assert.equal(calls, 2);
});

test('a successful write drops the namespace; a refused one does not', async () => {
  await get('/mgmt/summary', 'headSales');
  await fetch(base + '/mgmt/refused', { method: 'PUT', headers: { 'x-user': 'management' } });
  assert.equal((await get('/mgmt/summary', 'headSales')).cache, 'hit');
  await fetch(base + '/mgmt/targets', { method: 'PUT', headers: { 'x-user': 'management' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await get('/mgmt/summary', 'headSales')).cache, 'miss');
});

test('every cached route checks the permission first and caches after it', () => {
  const routers = {
    '../src/routes/managementDashboard.routes': ['/division', '/summary', '/escalations', '/targets'],
    '../src/routes/sales.routes': ['/overview', '/funnel', '/actions/count'],
    '../src/routes/retailCommerce.routes': ['/overview', '/top-products', '/pending-shipments', '/receivables'],
    '../src/routes/marketing.routes': ['/insights'],
    '../src/routes/finance.reports.routes': ['/receivables', '/payables'],
    '../src/routes/warehouse.routes': ['/stock', '/recon'],
  };
  for (const [file, paths] of Object.entries(routers)) {
    const router = require(file);
    for (const path of paths) {
      const layer = router.stack.find((l) => l.route?.path === path && l.route.methods.get);
      assert.ok(layer, `${file} ${path}`);
      const names = layer.route.stack.map((s) => s.name);
      const cacheAt = names.indexOf('cachedResponseMiddleware');
      assert.ok(cacheAt > 0, `${file} ${path}: cached`);
      const permissionAt = names.findIndex((n) => /permission/i.test(n));
      assert.ok(permissionAt >= 0 && permissionAt < cacheAt, `${file} ${path}: permission before cache (${names.join(', ')})`);
    }
    // requireAuth runs for the whole router, before any route.
    assert.equal(router.stack[0].name, 'requireAuth', file);
  }
});
