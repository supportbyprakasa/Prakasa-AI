// Prakasa AI reads Warehouse/Procurement quantities (program 4.1): the tools run
// against the real services with a mocked pool (no database, no writes).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = '../src';
const pool = require(`${B}/db/pool`);
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);

const supply = require(`${B}/services/ai/agent/supplyTools`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const { forbiddenKeys, assertClean } = require(`${B}/services/ai/agent/outputGuard`);

const MONEY = 987654321;
// One row carrying every column these services read, plus price, payment and address bait.
const ROW = {
  id: 5, number: 'DOC.1', trans_date: new Date('2026-09-24T00:00:00Z'), ship_date: new Date('2026-09-25T00:00:00Z'), status: 'Aktif',
  customer_no: 'C-SBY-01', customer_name: 'Toko Uji', channel: 'GT', percent_shipped: 0, line_count: 1, days_late: 5,
  so_id: 5, line_no: 1, item_no: 'OAT-1', item_name: 'Oatside', qty: 12, unit: 'Ctns', unit_ratio: 6, shipped_qty: 0, remaining_qty: 12,
  remaining_base: 72, warehouse: 'WH A', stock_base: 10, demand_to_here: 72, item_id: 11, category: 'Dairy', qty_all_units: '2 Ctns',
  raw_cover: 3.5, days_cover: 3.5, cover_reason: null, shown_qty: 12, warehouse_id: 3, warehouse_name: 'WH A', unit_name: 'Pack', name: 'WH A',
  is_default: 1, is_scrap: 0, vendor_no: 'V-1', vendor_name: 'PT Pemasok', expected_date: null, due_date_eff: new Date('2026-09-26T00:00:00Z'),
  percent_received: 50, display_state: 'late', received_qty: 6, returned_qty: 0, closed: 0, receipt_id: 9, receipt_number: 'RI.1',
  received_on: new Date('2026-09-27T00:00:00Z'), po_count: 2, open_count: 1, late_count: 1, last_po_date: new Date('2026-09-24T00:00:00Z'),
  fill: 50, on_time: 80, lead_days: 3, n: 1, total: 1, ada: 1, habis: 0, minus: 0, menipis: 1, all: 1, short: 1, late: 1, open: 1, partial: 0,
  received: 0, legacy: 0, due_soon: 1, no_expected_date: 1, doc_type: 'delivery', party: 'Toko Uji', from_wh: null, to_wh: null,
  po_numbers: '["PO.1"]', so_numbers: '["SO.1"]', today: '2026-09-30', in_transit: 0, stuck: 0, so_due: 1, ready: 1, live: 1,
  decided_at: new Date('2026-09-29T10:00:00Z'), applied_at: new Date('2026-09-29T10:00:00Z'), decided_by: 'Uji', pulled_at: new Date('2026-09-29T09:00:00Z'),
  item_count: 3, created_at: new Date('2026-09-29T09:00:00Z'), approved_at: new Date('2026-09-29T10:00:00Z'), direction: 'out',
  // bait
  unit_price: MONEY, dpp_amount: MONEY, total_amount: MONEY, tax_amount: MONEY, line_total: MONEY, spend: MONEY, value: MONEY, price_per_base: MONEY,
  payment_term: 'NET-SENTINEL', term_days: 30, currency: 'SENTINEL', address: 'Jl. SENTINEL 1', phone: '0812SENTINEL', email: 'sentinel@x', npwp: 'SENTINEL',
};

function mockDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    calls.push({ sql: String(sql), args });
    return [[{ ...ROW }]];
  });
  return calls;
}

const ALL = [...new Set([...STANDARD_ROLES.flatMap((r) => r.permissions), 'procurement.reorder.view', 'procurement.price.view', 'warehouse.stock.view', 'procurement.view'])];
const INPUTS = {
  stok_barang: [{}, { cari: 'oat', status: 'menipis', jumlah: 5 }, { gudang: 'wh a' }],
  jadwal_kirim: [{}, { status: 'kurang', dari: '2026-09-01', sampai: '2026-10-31' }, { nomor_so: 'DOC.1' }],
  gudang_hari_ini: [{}],
  status_po: [{}, { status: 'terlambat', cari: 'oat', kode_pemasok: 'V-1' }, { nomor_po: 'DOC.1' }],
  procurement_hari_ini: [{}],
  rapor_pemasok: [{}, { saring: 'terlambat' }, { kode_pemasok: 'V-1' }],
};

test('no supply tool ever reads a price view, writes, or returns a price, payment or address — even for a price viewer', async (t) => {
  const calls = mockDb(t);
  const user = { sub: 1, entityId: 7, permissions: ALL };
  for (const tool of supply.TOOLS) {
    for (const input of INPUTS[tool.name]) {
      calls.length = 0;
      const out = await tool.run(user, input);
      const json = JSON.stringify(out);
      assert.ok(!json.includes(String(MONEY)), `${tool.name} ${JSON.stringify(input)} leaked a price`);
      assert.ok(!/SENTINEL|sentinel@/.test(json), `${tool.name} ${JSON.stringify(input)} leaked bait`);
      assert.deepEqual(forbiddenKeys(out), [], tool.name);
      assert.ok(calls.length > 0, tool.name);
      for (const { sql, args } of calls) {
        assert.doesNotMatch(sql, /pc_po_price/i, `${tool.name} touched a price view`);
        assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `${tool.name} ran a non-SELECT`);
        if (sql.includes('?')) assert.ok(args.includes(7), `${tool.name} unbound company: ${sql.slice(0, 80)}`);
      }
    }
  }
});

test('per-gudang stock only with warehouse.stock.view; Procurement Sup/Head get totals only; members nothing', async (t) => {
  mockDb(t);
  const stok = supply.TOOLS.find((x) => x.name === 'stok_barang');
  const wh = await stok.run({ entityId: 7, permissions: ['warehouse.stock.view'] }, {});
  assert.ok(Array.isArray(wh.barang[0].per_gudang));
  const pc = await stok.run({ entityId: 7, permissions: ['procurement.view', 'procurement.reorder.view'] }, {});
  assert.equal('per_gudang' in pc.barang[0], false);
  assert.equal(pc.barang[0].hari_cukup, 3.5);
  await assert.rejects(() => stok.run({ entityId: 7, permissions: ['procurement.view', 'procurement.reorder.view'] }, { gudang: 'WH A' }), (e) => e.status === 403);
  await assert.rejects(() => stok.run({ entityId: 7, permissions: ['procurement.view'] }, {}), (e) => e.status === 403);
});

test('the output guard fails closed on price, payment and address keys at any depth', () => {
  assert.deepEqual(forbiddenKeys({ a: [{ b: { unitPrice: 1 } }], harga_beli: 2, alamat: 'x', ok: 1 }), ['$.a[0].b.unitPrice', '$.harga_beli', '$.alamat']);
  assert.throws(() => assertClean({ po: [{ paymentTerm: 'Net 30' }] }), (e) => e.code === 'AI_OUTPUT_BLOCKED');
  assert.doesNotThrow(() => assertClean({ stok: 1, hari_cukup: 2, persen_diterima: 3, disetujui: 'x', customer: 'y', status_accurate: 'z' }));
});

test('role matrix: stock follows D2 (extended), Procurement members never see stock', () => {
  const extra = {};
  const expected = {
    warehouse: ['stok_barang', 'jadwal_kirim', 'gudang_hari_ini'],
    'procurement.member': ['status_po', 'procurement_hari_ini', 'rapor_pemasok'],
    procurement: ['stok_barang', 'status_po', 'procurement_hari_ini', 'rapor_pemasok'],
    'management_office.member': [],
    management_office: ['stok_barang', 'jadwal_kirim', 'gudang_hari_ini', 'status_po', 'procurement_hari_ini', 'rapor_pemasok'],
  };
  for (const role of STANDARD_ROLES) {
    const perms = [...role.permissions, ...(extra[role.key] || [])];
    const names = supply.TOOLS.filter((x) => [].concat(x.permission).some((p) => perms.includes(p))).map((x) => x.name);
    const want = expected[role.key] ?? expected[role.departmentCode] ?? [];
    assert.deepEqual(names, want, role.key);
  }
});

test('no supply tool or notification in a shared conversation; the profile stays', () => {
  const user = { permissions: ALL.concat('notification.view') };
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, null]) {
    const names = agentTools.toolsFor(user, session).map((t) => t.name);
    assert.deepEqual(names.filter((n) => agentTools.PRIVATE_ONLY_TOOLS.includes(n)), [], JSON.stringify(session));
    for (const supplyTool of supply.TOOLS) assert.equal(names.includes(supplyTool.name), false, `${supplyTool.name} ${JSON.stringify(session)}`);
    assert.ok(names.includes('profil_saya'));
  }
  // PRIVATE_ONLY_TOOLS is derived, never listed by hand: exactly the tools declared privateOnly,
  // and every supply tool and the notifications are among them.
  assert.deepEqual([...agentTools.PRIVATE_ONLY_TOOLS].sort(), agentTools.TOOLS.filter((t) => t.privateOnly).map((t) => t.name).sort());
  for (const name of [...supply.TOOLS.map((t) => t.name), 'notifikasi_saya']) assert.ok(agentTools.PRIVATE_ONLY_TOOLS.includes(name), name);
  assert.ok(agentTools.toolsFor(user, { visibility: 'private' }).some((t) => t.name === 'stok_barang'));
});

test('notifications are the user\'s own: in a shared chat or next to web research only the public tools are left', () => {
  const user = { permissions: ALL.concat('notification.view') };
  const names = (session) => agentTools.toolsFor(user, session).map((t) => t.name);
  // The public tools (the profile, and the handbook text) are not data of a division: they stay.
  // (daftar_formulir is public but private-only and offered by surface, like the page tools it serves.)
  const publicTools = agentTools.TOOLS.filter((t) => t.public && !t.privateOnly).map((t) => t.name);
  assert.ok(publicTools.includes('profil_saya') && publicTools.includes('panduan_aplikasi'));
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }, null]) {
    const left = names(session);
    assert.equal(left.includes('notifikasi_saya'), false, JSON.stringify(session));
    assert.ok(left.every((n) => !agentTools.byName.get(n).privateOnly), `a privateOnly tool in ${JSON.stringify(session)}`);
    for (const name of publicTools) assert.ok(left.includes(name), `${name} ${JSON.stringify(session)}`);
  }
  assert.ok(names({ visibility: 'private' }).includes('notifikasi_saya'));
  assert.equal(Boolean(agentTools.byName.get('profil_saya').privateOnly), false, 'the profile stays usable in shared chats');
  // Whatever a tool reads, one that needs a permission is private: only the public tools reach a shared chat.
  const everything = { permissions: [...new Set(agentTools.TOOLS.flatMap((t) => [].concat(t.permission || [])))] };
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }]) {
    assert.deepEqual(agentTools.toolsFor(everything, session).map((t) => t.name).sort(), [...publicTools].sort(), JSON.stringify(session));
  }
});

test('a conversation where the AI read stock or PO data cannot be shared', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const session = { id: 9, entity_id: 1, owner_user_id: 15, visibility: 'private', status: 'active', department_id: 5 };
  let hit = true;
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM ai_message_steps/.test(sql)) return [[hit ? { hit: 1 } : undefined].filter(Boolean)];
    if (/FROM activity_logs/.test(sql)) return [[]];
    if (/FROM ai_sessions/.test(sql)) return [[session]];
    return [{ affectedRows: 1 }];
  });
  const user = { sub: 15, entityId: 1, permissions: ['ai_command.use'] };
  await assert.rejects(() => aiCommand.updateSession({ session, user, patch: { visibility: 'department' } }), (e) => e.status === 409 && e.code === 'SESSION_HAS_PRIVATE_DATA');
  hit = false;
  await aiCommand.updateSession({ session, user, patch: { visibility: 'department' } }).catch((e) => assert.notEqual(e.code, 'SESSION_HAS_PRIVATE_DATA'));
  // Back to private is always allowed (no lookup needed).
  hit = true;
  await aiCommand.updateSession({ session: { ...session, visibility: 'department' }, user, patch: { visibility: 'private' } }).catch((e) => assert.notEqual(e.code, 'SESSION_HAS_PRIVATE_DATA'));
});

test('the supply tools never touch the price service and describe themselves as price-free', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = fs.readFileSync(path.join(__dirname, '../src/services/ai/agent/supplyTools.js'), 'utf8');
  assert.doesNotMatch(code, /procurementPrices|pc_po_price|prices:\s*true|unitPrice|pricePerBase|spend12m|lastPrices|paymentTerm|orderValues|vendorSpend|orderPrices/);
  for (const m of code.match(/prices:\s*\w+/g) || []) assert.equal(m.replace(/\s/g, ''), 'prices:false');
  for (const tool of supply.TOOLS) {
    assert.match(tool.name, /^[a-z_]+$/);
    assert.equal(tool.privateOnly, true);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.match(tool.description, /harga/i, `${tool.name} says it has no prices`);
  }
});

test('a step shows what it is about (SO/PO number, search), web steps unchanged', () => {
  const { toolStatus } = require(`${B}/services/ai/claudeTeamPersonal`);
  const po = toolStatus({ id: 'x', name: 'mcp__prakasa__status_po', input: { nomor_po: 'PO.1' } }, { status_po: 'Membaca status PO' });
  assert.equal(po.tool, 'status_po');
  assert.equal(po.label, 'Membaca status PO');
  assert.equal(po.target, 'PO.1');
  assert.equal(toolStatus({ id: 'y', name: 'WebSearch', input: { query: 'harga kopi' } }).target, 'harga kopi');
});

test('the lock also reads the server\'s own audit of tool calls, in case a step event was lost', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM ai_message_steps/.test(sql)) return [[]];
    if (/FROM activity_logs/.test(sql)) return [[{ hit: 1 }]];
    return [[]];
  });
  assert.equal(await aiCommand.sessionHasPrivateData(9), true);
  const audit = calls.find((c) => /FROM activity_logs/.test(c.sql));
  assert.deepEqual(audit.args, [9, agentTools.PRIVATE_ONLY_TOOLS]);
  assert.match(audit.sql, /subject_type = 'ai_session' AND subject_id = \? AND action = 'ai_tool\.call'/);
});

test('an answer holding stock or PO data is never exported to the Shared Drive or the document list', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const storage = require(`${B}/services/aiDocumentStorage.service`);
  const ctrl = require(`${B}/controllers/aiCommand.controller`);
  const session = { id: 9, entity_id: 1, owner_user_id: 15, visibility: 'private', status: 'active', department_id: 5, deleted_at: null };
  const writes = [];
  t.mock.method(aiCommand, 'getSessionById', async () => session);
  t.mock.method(storage, 'generateFromMessage', async () => { writes.push('drive'); return { id: 1 }; });
  t.mock.method(pool, 'query', async (sql) => {
    if (/INSERT INTO (documents|drive_files_metadata)/.test(sql)) writes.push(sql);
    if (/FROM ai_message_steps/.test(sql)) return [[{ hit: 1 }]];
    return [[]];
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const req = { params: { id: '9' }, body: { messageId: 3, format: 'xlsx' }, user: { sub: 15, entityId: 1, permissions: ['ai_command.use'] } };
  await ctrl.generateArtifact(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error?.code || res.body.code, 'SESSION_HAS_PRIVATE_DATA');
  assert.deepEqual(writes, [], 'no Drive upload, no document row');
});

test('a chat cannot be shared while an answer is still being written; a stuck one does not block', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  t.mock.method(pool, 'query', async () => [[]]);
  const user = { sub: 15, entityId: 1, permissions: ['ai_command.use'] };
  const session = { id: 9, entity_id: 1, owner_user_id: 15, visibility: 'private', status: 'active', department_id: 5, generation_status: 'generating', generation_started_at: new Date() };
  await assert.rejects(() => aiCommand.updateSession({ session, user, patch: { visibility: 'department' } }), (e) => e.status === 409 && e.code === 'SESSION_GENERATING');
  const stale = { ...session, generation_started_at: new Date(Date.now() - 60 * 60 * 1000) };
  await aiCommand.updateSession({ session: stale, user, patch: { visibility: 'department' } }).catch((e) => assert.notEqual(e.code, 'SESSION_GENERATING'));
});

test('an answer that read stock or PO data is discarded if the chat became shared meanwhile', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = fs.readFileSync(path.join(__dirname, '../src/services/aiCommand.service.js'), 'utf8');
  const lock = code.indexOf('SELECT generation_status, generation_token, status, deleted_at, visibility');
  const check = code.indexOf("current.visibility !== 'private' && stepLog.steps.some((st) => agentTools.PRIVATE_ONLY_TOOLS.includes(st.tool))");
  const insert = code.indexOf('INSERT INTO ai_messages', lock);
  assert.ok(lock > 0 && check > lock && insert > check, 'checked under the row lock, before the answer is saved');
});

test('no supply tool when web research is on, even in a private chat', () => {
  const user = { permissions: ALL };
  const names = agentTools.toolsFor(user, { visibility: 'private', web_research: 1 }).map((t) => t.name);
  assert.deepEqual(names.filter((n) => agentTools.PRIVATE_ONLY_TOOLS.includes(n)), []);
  assert.ok(agentTools.toolsFor(user, { visibility: 'private', web_research: 0 }).some((t) => t.name === 'stok_barang'));
});

test('the agent token carries supply tools only for a private chat', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-agent-token-secret';
  const agentRun = require(`${B}/services/ai/agent/agentRun`);
  const { verifyAgentToken } = require(`${B}/services/ai/agent/agentToken`);
  const user = { sub: 15, entityId: 1, permissions: ALL };
  const shared = await agentRun.prepare({ user, session: { id: 9, visibility: 'department' } });
  const own = await agentRun.prepare({ user, session: { id: 9, visibility: 'private' } });
  try {
    assert.deepEqual(verifyAgentToken(shared.token).tools.filter((n) => agentTools.PRIVATE_ONLY_TOOLS.includes(n)), []);
    // In the private chat: exactly the private tools this user's permissions allow — all supply tools among them.
    // (Page tools are offered by surface, and this answer names none — test/aiClientTools.test.js.)
    const allowed = agentTools.TOOLS.filter((t) => t.privateOnly && !t.client && !t.surfaces && agentTools.allowedBy(user, t.permission)).map((t) => t.name).sort();
    assert.deepEqual(verifyAgentToken(own.token).tools.filter((n) => agentTools.PRIVATE_ONLY_TOOLS.includes(n)).sort(), allowed);
    for (const supplyTool of supply.TOOLS) assert.ok(allowed.includes(supplyTool.name), supplyTool.name);
  } finally {
    await shared.cleanup();
    await own.cleanup();
  }
});

test('no audit record, no stock data: a failed audit write refuses a private tool', async (t) => {
  const ctrl = require(`${B}/controllers/aiAgent.controller`);
  t.mock.method(pool, 'query', async (sql) => {
    if (/INSERT INTO activity_logs/.test(sql)) throw new Error('db down');
    return [[{ ...ROW }]];
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const req = {
    params: { name: 'stok_barang' }, body: { input: {} },
    agent: { jti: 'j-audit', exp: Math.floor(Date.now() / 1000) + 60, sid: 9, tools: ['stok_barang'] },
    agentUser: { sub: 15, entityId: 1, permissions: ALL }, agentSession: { id: 9, visibility: 'private' },
  };
  await ctrl.callTool(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /OAT-1|Oatside/, 'no stock data in the reply');
});

test('the shipping tool speaks of the promise, like the page', async (t) => {
  const tool = supply.TOOLS.find((x) => x.name === 'jadwal_kirim');
  t.mock.method(pool, 'query', async () => [[{ ...ROW, promised_date: new Date('2026-09-26T00:00:00Z'), promised_in_so: 0, days_late: 4 }]]);
  const out = await tool.run({ sub: 1, entityId: 1, permissions: ALL }, { nomor_so: 'DOC.1' });
  assert.equal(out.so.janji_kirim, '2026-09-26');
  assert.equal(out.so.sumber_janji, 'standar 2×24 jam dari tanggal SO');
  assert.equal(out.so.terlambat_hari, 4);
  assert.equal('tanggal_kirim' in out.so, false);
  assert.match(tool.description, /janji kirim/);
  assert.match(tool.description, /hari Minggu digeser ke Senin/);
  // A Friday SO: the standard promise fell on Sunday and moved to Monday.
  pool.query.mock.mockImplementation(async () => [[{ ...ROW, trans_date: new Date('2026-09-25T00:00:00Z'), ship_date: null, promised_date: new Date('2026-09-28T00:00:00Z'), promised_in_so: 0, promise_shifted: 1, days_late: 2 }]]);
  const friday = await tool.run({ sub: 1, entityId: 1, permissions: ALL }, { nomor_so: 'DOC.1' });
  assert.equal(friday.so.janji_kirim, '2026-09-28');
  assert.equal(friday.so.sumber_janji, 'standar 2×24 jam dari tanggal SO, digeser ke Senin');
});

test('an SO with nothing left to ship is "not found", like the page; missing units are said, not guessed', async (t) => {
  const tool = supply.TOOLS.find((x) => x.name === 'jadwal_kirim');
  t.mock.method(pool, 'query', async (sql) => {
    if (/wh_so_open_lines_accurate/.test(sql)) return [[]];
    return [[{ ...ROW }]];
  });
  const out = await tool.run({ sub: 1, entityId: 1, permissions: ALL }, { nomor_so: 'DOC.1' });
  assert.equal(out.ditemukan, false);
  const stok = supply.TOOLS.find((x) => x.name === 'stok_barang');
  pool.query.mock.mockImplementation(async (sql) => (/item_units_accurate/.test(sql) ? [[]] : [[{ ...ROW }]]));
  const listed = await stok.run({ sub: 1, entityId: 1, permissions: ALL }, {});
  assert.match(listed.catatan_satuan, /jangan menebak nama satuan/);
});

// Review follow-up (program 4.1): web research, notifications, mid-answer changes, documents.
function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('web research cannot be switched on in a chat holding private data, nor while an answer is written', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const ctrl = require(`${B}/controllers/aiCommand.controller`);
  let session = { id: 9, entity_id: 1, owner_user_id: 15, visibility: 'private', status: 'active', department_id: 5, deleted_at: null, web_research: 0, generation_status: 'idle' };
  t.mock.method(aiCommand, 'getSessionById', async () => session);
  let steps = [{ hit: 1 }]; // an earlier answer read stok_barang
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM ai_message_steps/.test(sql)) { assert.ok(args[1].includes('stok_barang')); return [steps]; }
    if (/UPDATE ai_sessions/.test(sql)) writes.push(args[0]);
    return [[]];
  });
  const user = { sub: 15, entityId: 1, permissions: ['ai_command.use'] };
  const patch = async (body) => {
    const res = fakeRes();
    await ctrl.updateSession({ params: { id: '9' }, body, user }, res, (e) => { throw e; });
    return res;
  };

  let res = await patch({ webResearch: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SESSION_HAS_PRIVATE_DATA');
  assert.match(res.body.error.message, /riset web tidak bisa dinyalakan/);
  assert.deepEqual(writes, [], 'nothing saved');

  steps = [];
  session = { ...session, generation_status: 'generating', generation_started_at: new Date() };
  res = await patch({ webResearch: true });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SESSION_GENERATING');
  assert.deepEqual(writes, []);

  // Idle, nothing private: switched on. Switching off is always allowed.
  session = { ...session, generation_status: 'idle', generation_started_at: null };
  assert.equal((await patch({ webResearch: true })).statusCode, 200);
  steps = [{ hit: 1 }];
  session = { ...session, web_research: 1 };
  assert.equal((await patch({ webResearch: false })).statusCode, 200);
  assert.deepEqual(writes, [1, 0]);
});

test('a chat that already holds private data answers without web research, and says so', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const aiProvider = require(`${B}/services/ai/provider`);
  const agentRun = require(`${B}/services/ai/agent/agentRun`);
  // Switched on before the lock existed (or while an answer was being written).
  const session = {
    id: 9, entity_id: 1, department_id: 5, owner_user_id: 15, visibility: 'private', status: 'active', deleted_at: null,
    generation_status: 'idle', ai_module: 'ai_command_center', provider: 'claude_team', web_research: 1,
  };
  let token = null;
  t.mock.method(pool, 'getConnection', async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      if (/SELECT \* FROM ai_sessions/.test(sql)) return [[{ ...session }]];
      if (/SET generation_status='generating'/.test(sql)) { token = args[0]; return [{ affectedRows: 1 }]; }
      if (/SELECT generation_status, generation_token/.test(sql)) {
        return [[{ generation_status: 'generating', generation_token: token, status: 'active', deleted_at: null, visibility: 'private' }]];
      }
      if (/INSERT INTO ai_messages/.test(sql)) return [{ insertId: 500 }];
      return [{ affectedRows: 1 }];
    },
  }));
  let privateStep = true;
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM ai_message_steps/.test(sql)) return [privateStep ? [{ hit: 1 }] : []];
    if (/FROM ai_messages m/.test(sql)) return [[{ id: 7, role: 'assistant', content: 'Stok Oatside di WH A: 72 Ctns', author_name: null }]];
    return [[]];
  });
  t.mock.method(agentRun, 'decide', async () => ({ ok: false, reason: 'disabled' }));
  const runs = [];
  t.mock.method(aiProvider, 'runModule', async (module, prompt, ctx) => {
    runs.push({ prompt, ctx });
    return { content: 'Jawaban', provider: 'claude_team', model: 'sonnet' };
  });
  const user = { sub: 15, entityId: 1, departmentId: 5, permissions: ['ai_command.use'] };
  const statuses = [];
  const send = () => aiCommand.sendMessage({ sessionId: 9, userMessage: 'Cari harga oat di pasar', user, onStatus: (s) => statuses.push(s) });

  const out = await send();
  assert.equal(out.assistantMessage.content, 'Jawaban', 'the question is still answered');
  assert.match(runs[0].prompt, /Stok Oatside/, 'the history holds the earlier stock answer');
  assert.equal(runs[0].ctx.webResearch, null, 'so the model gets no web search and no URL opening');
  assert.ok(statuses.some((s) => s.type === 'notice' && /Riset web tidak dipakai/.test(s.message)));

  // The same chat without private data keeps web research (nothing else changed).
  privateStep = false;
  statuses.length = 0;
  await send();
  assert.deepEqual(runs[1].ctx.webResearch, { allowFetch: true });
  assert.equal(statuses.some((s) => s.type === 'notice'), false);
});

test('a stock tool granted to this answer is refused once the chat is shared or web research is switched on mid-answer', async (t) => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-agent-token-secret';
  const ctrl = require(`${B}/controllers/aiAgent.controller`);
  const { signAgentToken } = require(`${B}/services/ai/agent/agentToken`);
  const token = signAgentToken({ userId: 15, entityId: 1, sessionId: 9, tools: ['stok_barang'] });
  const base = { id: 9, entity_id: 1, department_id: 5, owner_user_id: 15, visibility: 'private', web_research: 0, status: 'active', deleted_at: null };
  let session = base;
  const reads = [];
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ id: 15, entity_id: 1, department_id: 5, email: 'uji@x', status: 'active' }]];
    if (/FROM permissions p/.test(sql)) return [ALL.map((code) => ({ code }))];
    if (/FROM ai_sessions/.test(sql)) return [[{ ...session }]];
    reads.push(String(sql));
    return [[{ ...ROW }]];
  });
  // Each call goes through requireAgent, which reads the chat again.
  const call = async () => {
    const req = { headers: { authorization: `Bearer ${token}` }, params: { name: 'stok_barang' }, body: { input: {} } };
    const res = fakeRes();
    let passed = false;
    await ctrl.requireAgent(req, res, () => { passed = true; });
    if (passed) await ctrl.callTool(req, res, (e) => { throw e; });
    return res;
  };

  assert.equal((await call()).statusCode, 200, 'granted while the chat is private without web research');
  assert.ok(reads.some((sql) => /wh_stock_total_accurate/.test(sql)));
  for (const change of [{ visibility: 'department' }, { visibility: 'private', web_research: 1 }]) {
    session = { ...base, ...change };
    reads.length = 0;
    const res = await call();
    assert.equal(res.statusCode, 403, JSON.stringify(change));
    assert.deepEqual(reads.filter((sql) => /wh_stock_total_accurate|activity_logs/.test(sql)), [], 'no stock read, nothing logged as read');
  }
});

test('no audit record, no notifications: the notification tool fails closed like the stock tools', async (t) => {
  const ctrl = require(`${B}/controllers/aiAgent.controller`);
  t.mock.method(pool, 'query', async (sql) => {
    if (/INSERT INTO activity_logs/.test(sql)) throw new Error('db down');
    if (/FROM notifications/.test(sql)) {
      return [[{ title: 'Batch penjualan menunggu', body: 'DPP faktur Rp 1.234.567', event: 'sales.batch', is_read: 0, created_at: new Date(), n: 1 }]];
    }
    return [[]];
  });
  const res = fakeRes();
  const req = {
    params: { name: 'notifikasi_saya' }, body: { input: {} },
    agent: { jti: 'j-notif-audit', exp: Math.floor(Date.now() / 1000) + 60, sid: 9, tools: ['notifikasi_saya'] },
    agentUser: { sub: 15, entityId: 1, permissions: ['notification.view'] }, agentSession: { id: 9, visibility: 'private' },
  };
  await ctrl.callTool(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /DPP faktur|Batch penjualan/, 'no notification in the reply');
});

test('a document proposal from a chat holding private data is not created', async (t) => {
  const aiCommand = require(`${B}/services/aiCommand.service`);
  const aiAction = require(`${B}/services/aiActionProposal.service`);
  const ctrl = require(`${B}/controllers/aiCommand.controller`);
  const session = { id: 9, entity_id: 1, owner_user_id: 15, visibility: 'private', status: 'active', department_id: 5, deleted_at: null };
  t.mock.method(aiAction, 'getProposalById', async () => ({ id: 4, action_type: 'create_document', session_id: 9, status: 'proposed' }));
  t.mock.method(aiCommand, 'getSessionById', async () => session);
  const confirm = t.mock.method(aiAction, 'confirmProposal', async () => ({ id: 4, status: 'executed' }));
  t.mock.method(pool, 'query', async (sql) => (/FROM ai_message_steps/.test(sql) ? [[{ hit: 1 }]] : [[]]));
  const res = fakeRes();
  await ctrl.confirmAction({ params: { id: '4' }, body: {}, user: { sub: 15, entityId: 1, permissions: ['ai_command.use'] } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SESSION_HAS_PRIVATE_DATA');
  assert.equal(confirm.mock.callCount(), 0, 'confirmProposal never called');
});
