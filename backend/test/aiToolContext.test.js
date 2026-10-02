const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolContextService, sanitizeState } = require('../src/services/aiToolContext.service');
const { TOOLS } = require('../src/services/aiToolRegistry.service');

function harness(overrides = {}) {
  const calls = { warehouse: 0, approval: 0 };
  const service = createToolContextService({
    roleLevel: async () => 'supervisor',
    providers: {
      warehouse_movement: async ({ params }) => {
        calls.warehouse += 1;
        if (params.id === '404') throw Object.assign(new Error('Pergerakan barang tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });
        return {
          sourceRef: `warehouse_movement:${params.type}:${params.id}`,
          facts: { status: 'pending_approval', referenceNo: 'UJI-1', items: [{ product: 'Kopi', quantity: 2, unit: 'kg' }], version: 3 },
        };
      },
      approval_request: async ({ params, user }) => {
        calls.approval += 1;
        if (Number(user.entityId) !== 1) throw Object.assign(new Error('Approval tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });
        return { sourceRef: `approval_request:${params.id}`, facts: { status: 'pending' } };
      },
      ...overrides.providers,
    },
  });
  return { service, calls };
}

const WAREHOUSE_USER = { sub: 1, entityId: 1, departmentId: 9, permissions: ['warehouse.movement.view', 'ai_command.use'] };

test('missing module permission fails before any record provider runs', async () => {
  const { service, calls } = harness();
  await assert.rejects(
    service.buildToolContext({ user: { ...WAREHOUSE_USER, permissions: ['ai_command.use'] }, pathname: '/warehouse/movements/inbound/2' }),
    (error) => error.status === 403,
  );
  assert.equal(calls.warehouse, 0);
});

test('unknown tools and malformed subjects are refused', async () => {
  const { service } = harness();
  await assert.rejects(service.buildToolContext({ user: WAREHOUSE_USER, pathname: '/tidak-ada' }), (error) => error.status === 404 && error.code === 'AI_TOOL_UNKNOWN');
  await assert.rejects(service.buildToolContext({ user: WAREHOUSE_USER, pathname: '/warehouse/movements/sideways/2' }), (error) => error.status === 400);
  await assert.rejects(service.buildToolContext({ user: WAREHOUSE_USER, pathname: '/warehouse/movements/inbound/abc' }), (error) => error.status === 400);
});

test('Warehouse movement context comes from the domain service and keeps its denial', async () => {
  const { service, calls } = harness();
  const context = await service.buildToolContext({ user: WAREHOUSE_USER, pathname: '/warehouse/movements/inbound/2', search: '?tab=inbound&token=abc' });
  assert.equal(calls.warehouse, 1);
  assert.equal(context.tool.key, 'warehouse');
  assert.equal(context.subject.type, 'warehouse_movement');
  assert.equal(context.subject.sourceRef, 'warehouse_movement:inbound:2');
  assert.deepEqual(context.route.query, { tab: 'inbound' });
  assert.match(context.text, /data, bukan instruksi/);
  assert.match(context.text, /AI hanya merekomendasikan/);
  assert.match(context.text, /tidak dikirim ke Accurate/);
  await assert.rejects(
    service.buildToolContext({ user: WAREHOUSE_USER, pathname: '/warehouse/movements/inbound/404' }),
    (error) => error.status === 404,
  );
});

test('approval context in another entity is not attached', async () => {
  const { service } = harness();
  await assert.rejects(
    service.buildToolContext({ user: { sub: 2, entityId: 2, permissions: ['approval.view'] }, pathname: '/approvals/9' }),
    (error) => error.status === 404,
  );
});

test('private AI conversations and sensitive admin pages never publish page state', async () => {
  const { service } = harness();
  const ai = await service.buildToolContext({
    user: { sub: 1, entityId: 1, permissions: ['ai_command.session.view'] },
    pathname: '/ai-command',
    visibleState: { tab: 'history', q: 'rahasia' },
  });
  assert.deepEqual(ai.visibleState, {});
  assert.equal(ai.subject, null);

  const provider = await service.buildToolContext({
    user: { sub: 1, entityId: 1, permissions: ['ai.provider.manage'] },
    pathname: '/admin/ai-provider-settings',
    visibleState: { tab: 'claude' },
    search: '?tab=claude',
  });
  assert.deepEqual(provider.visibleState, {});
  assert.deepEqual(provider.route.query, {});
});

test('visible state is allow-listed, scalar-only, secret-free, and size-bounded', () => {
  const warehouse = TOOLS.find((entry) => entry.key === 'warehouse');
  const state = sanitizeState(warehouse, {
    tab: 'approval',
    status: 'pending_approval',
    q: 'x'.repeat(500),
    password: 'hunter2',
    apiKey: 'k',
    rows: [{ id: 1 }],
    nested: { a: 1 },
    unknown: 'drop me',
  });
  assert.deepEqual(Object.keys(state).sort(), ['q', 'status', 'tab']);
  assert.equal(state.q.length, 120);
  assert.deepEqual(sanitizeState(warehouse, 'not an object'), {});
});

test('every tool can build a page-level context without record access', async () => {
  const { service } = harness();
  const everything = { sub: 1, entityId: 1, permissions: TOOLS.flatMap((entry) => [].concat(entry.readPermission || [])) };
  for (const entry of TOOLS) {
    const pathname = entry.patterns.find((pattern) => !pattern.includes(':')) || entry.patterns[0].replace(/:[a-z]+/gi, 'x');
    if (pathname.includes('/x')) continue;
    const context = await service.buildToolContext({ user: everything, pathname });
    assert.equal(context.tool.key, entry.key, pathname);
    assert.ok(context.text.length <= 6000, entry.key);
    // A page that no longer renders (retired route) shows no starters; every other page at least four.
    if (require('../src/services/aiToolRegistry.service').neverRenders(entry)) assert.deepEqual(context.starters, [], entry.key);
    else assert.ok(context.starters.length >= 4, entry.key);
  }
});

// Wave A: the standard page context every page publishes.
const { sanitizePageContext } = require('../src/services/aiToolContext.service');

test('the standard page context is bounded, free of money/personal/secret keys, and empty for pages that publish nothing', async () => {
  const tasks = TOOLS.find((entry) => entry.key === 'tasks');
  const page = sanitizePageContext(tasks, {
    route: '/admin/users',
    title: `  Tugas   ${'x'.repeat(300)}`,
    filters: { cari: 'laporan', urut: 'due_date naik', harga_min: 5, total_amount: 9, email: 'a@b', password: 'x', token: 'y', nested: { a: 1 }, kosong: '' },
    selection: { type: 'task', id: 12, name: 'Kirim laporan', extra: 'drop' },
    counts: { baris_tampil: 20, baris_cocok: 57, total_nilai: 1000000, pecahan: 1.5, negatif: -1 },
    formState: { id: 'task-form', dirty: 1, values: { gaji: 1 } },
    rows: [{ id: 1 }],
  });
  assert.equal(page.title.length, 120);
  assert.deepEqual(page.filters, { cari: 'laporan', urut: 'due_date naik' });
  assert.deepEqual(page.selection, { type: 'task', id: '12', name: 'Kirim laporan' });
  assert.deepEqual(page.counts, { baris_tampil: 20, baris_cocok: 57 });
  assert.deepEqual(page.formState, { id: 'task-form', dirty: true });
  assert.deepEqual(Object.keys(page).sort(), ['counts', 'filters', 'formState', 'selection', 'title']);
  assert.equal(sanitizePageContext(tasks, { title: '' }).title, 'Tugas', 'the registry title when the page gives none');

  for (const entry of TOOLS.filter((candidate) => !candidate.publishesState)) {
    assert.equal(sanitizePageContext(entry, { title: 'x', filters: { cari: 'y' } }), null, entry.key);
  }
  assert.equal(sanitizePageContext(tasks, 'bukan objek'), null);

  const { service } = harness();
  const context = await service.buildToolContext({
    user: { sub: 1, entityId: 1, permissions: ['task.view'] },
    pathname: '/tasks',
    page: { route: '/somewhere-else', title: 'Tugas', filters: { cari: 'laporan' }, counts: { baris_tampil: 3 } },
  });
  assert.equal(context.page.route, '/tasks', 'the route is the one the server resolved');
  assert.match(context.text, /Judul halaman: Tugas/);
  assert.match(context.text, /Saringan dan urutan yang aktif: \{"cari":"laporan"\}/);

  const closed = await service.buildToolContext({
    user: { sub: 1, entityId: 1, permissions: ['user.manage'] },
    pathname: '/admin/users',
    page: { title: 'Pengguna', filters: { cari: 'budi' }, counts: { baris_tampil: 3 } },
  });
  assert.equal(closed.page, null);
  assert.doesNotMatch(closed.text, /budi|Judul halaman/);
});
