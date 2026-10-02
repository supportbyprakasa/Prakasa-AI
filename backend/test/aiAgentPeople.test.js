// Prakasa AI reads People & Culture: onboarding/offboarding, checklist
// templates, the directory, Layanan GA and Operasional GA (Wave B).
// Pure checks first; then the tools against the real services on the local
// schema, inside one transaction that is always rolled back (no data left, no
// notification sent).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, dbReady, inRolledBackTransaction, makeUser, makeLocation, makeResource, departmentId, at, tag,
} = require('./fixtures/gaDb');
const B = '../src';
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const registry = require(`${B}/services/aiToolRegistry.service`);
const peopleTools = require(`${B}/services/ai/agent/tools/peopleCulture`);
const gaTools = require(`${B}/services/ai/agent/tools/ga`);
const directory = require(`${B}/services/peopleDirectory.service`);
const workflows = require(`${B}/services/hrgaWorkflow.service`);
const requests = require(`${B}/services/gaRequests.service`);
const bookings = require(`${B}/services/gaBookings.service`);
const ops = require(`${B}/services/gaOps.service`);
const rules = require(`${B}/services/gaRules`);
const notif = require(`${B}/services/notification.service`);

test.after(() => pool.end());

const PEOPLE = ['tugas_onboarding_saya', 'daftar_onboarding_offboarding', 'status_onboarding_offboarding', 'template_checklist_karyawan', 'direktori_karyawan'];
const GA = ['layanan_ga_saya', 'permintaan_ga', 'pemesanan_ruang', 'operasional_ga', 'tagihan_utilitas_ga'];
const MINE = [...PEOPLE, ...GA];
const PAGE_KEYS = ['hr-onboarding', 'hr-offboarding', 'hr-workflows', 'hr-checklists', 'people-directory', 'ga-services', 'ga-operations'];
const tool = (name) => agentTools.byName.get(name);
const run = (name, user, input = {}) => tool(name).run(user, input);
const PRIVATE = { visibility: 'private' };
const MONEY = 987654321;
const SKIP = 'no database with the People & Culture and GA migrations';
const ready = async () => (await dbReady())
  && Number((await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('ga_utility_bills', 'hrga_workflow_tasks', 'people_directory')",
  ))[0][0].n) === 3;
const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const permsOf = (key) => STANDARD_ROLES.find((r) => r.key === key).permissions;
const forbidden = (e) => e.status === 403 && e.code === 'FORBIDDEN';

// Every key of a result, at any depth.
function keysOf(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) { found.push(k); keysOf(v, found); }
  }
  return found;
}
const PERSONAL = /pribadi|alamat|address|nik|ktp|npwp|bpjs|lahir|birth|gaji|salary|rekening|bank|sandi|password/i;
const RUPIAH = /harga|nominal|biaya|cost|amount|nilai|rupiah/i;

// Records every statement the tools run on the test connection.
function recordSql(conn) {
  const calls = [];
  const original = conn.query;
  conn.query = (...args) => { calls.push(String(args[0]?.sql || args[0])); return original.apply(conn, args); };
  return { calls, stop: () => { conn.query = original; } };
}
const assertOnlySelect = (calls, what) => {
  assert.ok(calls.length > 0, `${what} read nothing`);
  for (const sql of calls) assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `${what} ran a non-SELECT: ${sql.slice(0, 80)}`);
};

// ------------------------------------------------------------------ contract

test('contract: ten read tools, private, serving the seven People & Culture page keys; rupiah only in the one money tool', () => {
  assert.deepEqual(peopleTools.map((t) => t.name), PEOPLE);
  assert.deepEqual(gaTools.map((t) => t.name), GA);
  const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
  assert.deepEqual(contract.validateTools([...peopleTools, ...gaTools], { moduleKeys }), []);
  const served = new Set(MINE.flatMap((name) => tool(name).module));
  for (const key of PAGE_KEYS) assert.ok(served.has(key), `${key} is served`);
  assert.deepEqual([...served].sort(), [...PAGE_KEYS].sort(), 'and nothing else');
  for (const name of MINE) {
    const t = tool(name);
    assert.equal(t.privateOnly, true, `${name} is private only`);
    assert.equal(Boolean(t.public), false, name);
    assert.ok(['peopleCulture.js', 'ga.js'].includes(t.file), name);
    assert.doesNotMatch(t.impl.toString(), /\b(INSERT|UPDATE|DELETE|REPLACE)\b/, name);
  }
  assert.deepEqual(MINE.filter((name) => tool(name).money), ['tagihan_utilitas_ga']);
  assert.equal(tool('tagihan_utilitas_ga').permission, 'ga.ops.manage');
  // Same permission as the page.
  assert.equal(tool('daftar_onboarding_offboarding').permission, 'hrga.view');
  assert.equal(tool('template_checklist_karyawan').permission, 'hrga.checklist_template.manage');
  assert.equal(tool('direktori_karyawan').permission, 'people.directory.view');
  assert.equal(tool('operasional_ga').permission, 'ga.ops.view');
  for (const name of ['layanan_ga_saya', 'permintaan_ga', 'pemesanan_ruang']) assert.equal(tool(name).permission, 'ga.request.create');
});

test('KantorKu and TrackCar: the tools say where leave, attendance, payroll and vehicles live instead of inventing', () => {
  for (const name of PEOPLE) assert.match(tool(name).description, /KantorKu/, name);
  assert.match(peopleTools.KANTORKU, /Cuti, absensi, dan gaji/);
  assert.match(peopleTools.KANTORKU, /KantorKu/);
  assert.match(peopleTools.KANTORKU, /tidak tersambung/);
  for (const name of ['layanan_ga_saya', 'permintaan_ga', 'pemesanan_ruang']) assert.match(tool(name).description, /TrackCar/, name);
  assert.match(tool('direktori_karyawan').description, /tidak pernah telepon pribadi, alamat rumah, NIK, tanggal lahir/);
});

test('permission refusal: without the permission every tool refuses (403) and is not offered', async () => {
  for (const name of MINE) {
    await assert.rejects(run(name, { sub: 1, entityId: 1, permissions: [] }), forbidden, name);
    await assert.rejects(run(name, { sub: 1, entityId: 1, permissions: ['task.view', 'finance.view'] }), forbidden, name);
  }
  assert.deepEqual(agentTools.toolsFor({ permissions: [] }, PRIVATE).map((t) => t.name).filter((n) => MINE.includes(n)), []);
  // Bill amounts: seeing Operasional GA is not enough.
  await assert.rejects(run('tagihan_utilitas_ga', { sub: 1, entityId: 1, permissions: ['ga.ops.view', 'ga.request.process'] }), forbidden);
});

test('role matrix: what each standard role is offered in a private conversation', () => {
  const everyone = ['tugas_onboarding_saya', 'status_onboarding_offboarding', 'direktori_karyawan', 'layanan_ga_saya', 'permintaan_ga', 'pemesanan_ruang'];
  const expected = {
    'people_culture.member': [...everyone, 'daftar_onboarding_offboarding', 'operasional_ga'],
    'people_culture.supervisor': [...everyone, 'daftar_onboarding_offboarding', 'operasional_ga', 'tagihan_utilitas_ga'],
    'people_culture.head': MINE,
  };
  for (const role of STANDARD_ROLES) {
    const names = agentTools.toolsFor({ permissions: role.permissions }, PRIVATE).map((t) => t.name).filter((n) => MINE.includes(n));
    assert.deepEqual([...names].sort(), [...(expected[role.key] || everyone)].sort(), role.key);
  }
});

test('shared conversations and web research: none of these tools, money tool included', () => {
  const user = { permissions: permsOf('people_culture.head') };
  for (const session of [null, { visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }]) {
    const names = agentTools.toolsFor(user, session).map((t) => t.name);
    assert.deepEqual(names.filter((n) => MINE.includes(n)), [], JSON.stringify(session));
  }
  for (const name of MINE) assert.ok(agentTools.PRIVATE_ONLY_TOOLS.includes(name), name);
});

// ------------------------------------------------------------------ mocked services

const dirRow = (i) => ({
  key: `p${i}`, personId: i, userId: null, name: `Orang ${i}`, position: 'Staf', departmentId: 3, departmentName: i % 2 ? 'Sales' : 'Finance',
  managerName: 'Atasan', workEmail: `orang${i}@prakasafoods.com`, workPhone: `ext. ${i}`, locationName: 'PFN Office',
  // What People & Culture alone sees on the page, plus bait: never copied.
  notes: 'SENTINEL-notes', excludedReason: 'SENTINEL-excluded', resignedOn: '2026-01-01', kind: 'employee',
  personalPhone: '0812SENTINEL', homeAddress: 'Jl. SENTINEL', nik: '3174SENTINEL', birthDate: '1990-01-01',
});

test('directory: work contact only, always read as a plain viewer and bound to the entity; lists are capped', async (t) => {
  const seen = [];
  t.mock.method(directory, 'list', async (entityId, query, options) => {
    seen.push({ entityId, query, options });
    const rows = Array.from({ length: 300 }, (_, i) => dirRow(i + 1));
    return { rows: rows.slice(0, query.limit), meta: { page: 1, limit: query.limit, total: 300 } };
  });
  t.mock.method(directory, 'detail', async (entityId, key, options) => {
    seen.push({ entityId, key, options });
    return key === 'p1' ? { ...dirRow(1), directReports: [{ key: 'p2', name: 'Orang 2', position: 'Staf', departmentName: 'Sales', hasAccount: true }] } : null;
  });
  // Even a People & Culture Head (people.directory.manage) gets the viewer's cut.
  const user = { sub: 5, entityId: 7, departmentId: 3, permissions: permsOf('people_culture.head') };

  const all = await run('direktori_karyawan', user, { jumlah: 50 });
  assert.equal(all.orang.length, 50);
  assert.equal(all.total_cocok, 300);
  assert.deepEqual(Object.keys(all.orang[0]).sort(), ['atasan', 'divisi', 'email_kerja', 'jabatan', 'kunci', 'lokasi_kerja', 'nama', 'rute', 'telepon_kerja']);
  assert.equal(all.orang[0].rute, '/people/directory/p1');
  assert.match(all.catatan_kantorku, /KantorKu/);

  const byDefault = await run('direktori_karyawan', user, {});
  assert.equal(byDefault.orang.length, 25, 'default 25');
  const tooMany = await run('direktori_karyawan', user, { jumlah: 5000 });
  assert.ok(tooMany.orang.length <= 50, 'an oversized request is clamped');

  const sales = await run('direktori_karyawan', user, { divisi: 'sales', jumlah: 10 });
  assert.equal(sales.total_cocok, 150);
  assert.equal(sales.orang.length, 10);
  assert.ok(sales.orang.every((p) => p.divisi === 'Sales'));
  const none = await run('direktori_karyawan', user, { divisi: 'tidak ada' });
  assert.equal(none.orang.length, 0);
  assert.match(none.catatan, /Periksa nama divisinya/);

  const one = await run('direktori_karyawan', user, { kunci: 'p1' });
  assert.equal(one.ditemukan, true);
  assert.deepEqual(one.bawahan_langsung, [{ kunci: 'p2', nama: 'Orang 2', jabatan: 'Staf', divisi: 'Sales', rute: '/people/directory/p2' }]);
  assert.equal((await run('direktori_karyawan', user, { kunci: 'p999' })).ditemukan, false);

  for (const call of seen) {
    assert.equal(call.entityId, 7, 'the caller\'s entity');
    assert.deepEqual(call.options, { canManage: false });
  }
  for (const out of [all, sales, one]) {
    const json = JSON.stringify(out);
    assert.doesNotMatch(json, /SENTINEL|1990-01-01|2026-01-01/);
    assert.deepEqual(keysOf(out).filter((k) => PERSONAL.test(k)), []);
  }
});

const opsRows = {
  maintenance: (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: `AC ${i}`, categoryLabel: 'AC', locationName: 'PFN Office', vendorName: 'PT Dingin', intervalDays: 90, lastDoneOn: '2026-06-01',
    nextDueOn: '2026-09-01', overdue: true, dueSoon: false, status: 'active', notes: 'SENTINEL', lastCost: MONEY,
  })),
  contracts: (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, kindLabel: 'Kebersihan', vendorName: 'PT Bersih', description: 'Kebersihan kantor', locationName: 'PFN Office', startOn: '2025-11-01', endOn: '2026-10-31',
    decisionOn: '2026-09-01', ending: true, lapsed: false, status: 'active', monthlyCost: MONEY, notes: 'SENTINEL',
  })),
  bills: (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, utility: 'electricity', utilityLabel: 'Listrik', unit: 'kWh', customerNumber: `5123-SENTINEL-${i}`, period: '2026-08', amount: MONEY, usageAmount: 1200,
    dueOn: '2026-09-20', paidOn: null, overdue: true, dueSoon: false, status: 'overdue', locationName: 'PFN Office', notes: 'SENTINEL',
  })),
};

test('Operasional GA: counts, dates and states only — rupiah only from the money tool, for ga.ops.manage, and both are capped', async (t) => {
  const asked = [];
  t.mock.method(ops, 'readFor', async (user, key = null) => {
    asked.push({ entityId: user.entityId, key });
    if (key === null) return { maintenance: 300, maintenanceOverdue: 300, maintenanceDueSoon: 0, contracts: 300, contractsEnding: 300, billsUnpaid: 300, billsOverdue: 300 };
    return opsRows[key](300);
  });
  const member = { sub: 5, entityId: 7, permissions: permsOf('people_culture.member') };
  const supervisor = { sub: 6, entityId: 7, permissions: permsOf('people_culture.supervisor') };

  for (const user of [member, supervisor]) {
    const out = await run('operasional_ga', user, { jumlah: 50 });
    const json = JSON.stringify(out);
    assert.ok(!json.includes(String(MONEY)), 'no rupiah, even for those who may see it');
    assert.doesNotMatch(json, /SENTINEL/, 'no notes and no meter number');
    assert.deepEqual(keysOf(out).filter((k) => RUPIAH.test(k)), []);
    assert.equal(out.ringkasan.tagihan_lewat_jatuh_tempo, 300);
    for (const part of ['perawatan', 'kontrak', 'tagihan']) {
      assert.equal(out[part].total, 300);
      assert.equal(out[part].daftar.length, 50, `${part} is capped`);
    }
    assert.equal(out.perawatan.daftar[0].keadaan, 'lewat jadwal');
    assert.equal(out.kontrak.daftar[0].keadaan, 'segera berakhir');
    assert.equal(out.tagihan.daftar[0].status, 'lewat jatuh tempo');
    assert.equal(out.tagihan.daftar[0].rute, '/ga/operations?tab=bills&open=1');
  }
  assert.equal((await run('operasional_ga', member, {})).perawatan.daftar.length, 25, 'default 25 per section');
  const onlyBills = await run('operasional_ga', member, { bagian: 'tagihan' });
  assert.equal('perawatan' in onlyBills || 'kontrak' in onlyBills, false);

  await assert.rejects(run('tagihan_utilitas_ga', member, {}), forbidden, 'a Member never gets amounts');
  const money = await run('tagihan_utilitas_ga', supervisor, { jumlah: 50 });
  assert.equal(money.tagihan.length, 50);
  assert.equal(money.tagihan[0].nominal, MONEY);
  assert.equal(money.total_nominal_ditampilkan, MONEY * 50);
  assert.equal(money.tagihan[0].pemakaian, 1200);
  assert.doesNotMatch(JSON.stringify(money), /SENTINEL/, 'never the customer/meter number');
  assert.equal((await run('tagihan_utilitas_ga', supervisor, { periode: '2026-07' })).total_cocok, 0);
  assert.equal((await run('tagihan_utilitas_ga', supervisor, { status: 'lunas' })).total_cocok, 0);
  assert.ok(asked.every((a) => a.entityId === 7));

  // The money tool is not offered in a shared conversation or next to web research.
  for (const session of [{ visibility: 'department' }, { visibility: 'private', web_research: 1 }]) {
    assert.equal(agentTools.toolsFor(supervisor, session).some((x) => x.name === 'tagihan_utilitas_ga'), false);
  }
  assert.ok(agentTools.toolsFor(supervisor, PRIVATE).some((x) => x.name === 'tagihan_utilitas_ga'));
  assert.equal(agentTools.toolsFor(member, PRIVATE).some((x) => x.name === 'tagihan_utilitas_ga'), false);
});

test('gaOps.readFor: ga.ops.view and the caller\'s own entity, whatever the caller passes', async () => {
  const db = { calls: [], async query(sql, args) { this.calls.push({ sql: String(sql), args }); return [[]]; } };
  await assert.rejects(ops.readFor({ sub: 1, entityId: 7, permissions: ['ga.request.create'] }, 'bills', db), forbidden);
  assert.equal(db.calls.length, 0, 'refused before any read');
  const user = { sub: 1, entityId: 7, permissions: ['ga.ops.view'] };
  assert.deepEqual(await ops.readFor(user, 'bills', db), []);
  await ops.readFor(user, null, db);
  await assert.rejects(ops.readFor(user, 'tidak_ada', db), (e) => e.code === 'NOT_FOUND');
  for (const { sql, args } of db.calls) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.ok(args.length > 0 && args.every((a) => a === 7), 'bound to the entity');
  }
});

test('onboarding list and templates: explicit fields, capped, no reason or notes', async (t) => {
  t.mock.method(workflows, 'list', async (user, query) => ({
    rows: Array.from({ length: Math.min(300, query.limit) }, (_, i) => ({
      id: i + 1, workflowType: i % 2 ? 'offboarding' : 'onboarding', workflowNumber: `ONB-202610-${String(i).padStart(4, '0')}`, status: 'in_progress',
      employeeName: `Karyawan ${i}`, position: 'Staf', departmentName: 'Sales', baseDate: '2026-10-12', totalTasks: 8, doneTasks: 3, lateTasks: 1,
      requesterName: 'PC', picName: 'PIC', reasonCode: 'resign', notes: 'SENTINEL', employeePhone: '0812SENTINEL',
    })),
    meta: { page: 1, limit: query.limit, total: 300, counts: { all: 300, draft: 1, pending_approval: 2, revision_requested: 0, running: 290, completed: 5, closed: 2 } },
  }));
  t.mock.method(workflows, 'listTemplates', async () => ({
    rows: [{ id: 1, workflowType: 'onboarding', departmentName: 'Sales', name: 'Sales onboarding', isActive: true, updatedAt: null, updatedByName: 'Head', items: [{ category: 'custom', title: 'Kenalan tim', ownerGroup: 'manager', offsetDays: 1 }] }],
    builtIn: require(`${B}/services/hrgaChecklist`).BUILT_IN,
  }));
  const head = { sub: 5, entityId: 7, permissions: permsOf('people_culture.head') };
  const list = await run('daftar_onboarding_offboarding', head, { jumlah: 9999 });
  assert.equal(list.alur.length, 50, 'clamped');
  assert.equal(list.total_cocok, 300);
  assert.equal(list.ringkasan.berjalan, 290);
  assert.equal(list.alur[0].tanggal_masuk, '2026-10-12');
  assert.equal(list.alur[1].hari_terakhir_kerja, '2026-10-12');
  assert.equal(list.alur[0].rute, '/hrga/workflows/1');
  assert.doesNotMatch(JSON.stringify(list), /SENTINEL|resign/);
  assert.deepEqual(keysOf(list).filter((k) => PERSONAL.test(k)), []);
  assert.match(list.catatan_kantorku, /KantorKu/);

  const templates = await run('template_checklist_karyawan', head, { jenis: 'onboarding' });
  assert.equal(templates.template_buatan.length, 1);
  assert.deepEqual(templates.template_buatan[0].butir, [{ judul: 'Kenalan tim', kelompok: 'Atasan', kategori: 'custom', hari_dari_tanggal_acuan: 1 }]);
  assert.deepEqual(templates.template_bawaan.map((x) => x.jenis), ['Onboarding']);
  assert.equal((await run('template_checklist_karyawan', head, { divisi: 'finance' })).template_buatan.length, 0);
  // The page is the Head's: a Supervisor has hrga.view but not the template tool.
  await assert.rejects(run('template_checklist_karyawan', { sub: 6, entityId: 7, permissions: permsOf('people_culture.supervisor') }), forbidden);
});

// ------------------------------------------------------------------ database (rolled back)

async function makeWorkflow(conn, { type = 'onboarding', status = 'in_progress', departmentCode, requestedBy, managerPersonId = null, name }) {
  const number = `${type === 'onboarding' ? 'ONB' : 'OFF'}-UJI-${tag()}`.slice(0, 80);
  const [wf] = await conn.query(
    `INSERT INTO hrga_workflows (entity_id, department_id, workflow_type, workflow_number, employee_full_name, employee_email, employee_phone,
                                 employee_position, manager_person_id, join_date, last_working_date, effective_date, reason, reason_code, status,
                                 kantorku_employee_id, kantorku_reference_url, requested_by, notes)
     VALUES (1, ?, ?, ?, ?, 'pribadi-SENTINEL@gmail.com', '0812SENTINEL', 'Admin Gudang', ?, ?, ?, ?, 'SENTINEL alasan', ?, ?, 'KK-SENTINEL', 'https://kantorku.invalid/SENTINEL', ?, 'SENTINEL catatan')`,
    [await departmentId(conn, departmentCode), type, number, name, managerPersonId,
      type === 'onboarding' ? wibToday() : null, type === 'offboarding' ? wibToday() : null, wibToday(), type === 'offboarding' ? 'resign' : null, status, requestedBy],
  );
  return { id: wf.insertId, number };
}

async function makeTask(conn, workflowId, { title, userId, dueInDays, status = 'pending', ownerGroup = 'manager', category = 'custom' }) {
  const [task] = await conn.query(
    `INSERT INTO hrga_workflow_tasks (hrga_workflow_id, category, owner_group, title, responsible_user_id, status, due_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), 'SENTINEL tugas')`,
    [workflowId, category, ownerGroup, title, userId, status, wibToday(), dueInDays],
  );
  return task.insertId;
}

test('db: onboarding/offboarding — my tasks are mine only; a workflow is read by People & Culture and the people involved, nobody else', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const pcMember = await makeUser(conn, { name: 'PC Member', division: 'people_culture', roles: ['people_culture.member'] });
    const whHead = await makeUser(conn, { name: 'Head Gudang', division: 'warehouse', roles: ['warehouse.head'] });
    const outsider = await makeUser(conn, { name: 'Staf Sales', division: 'sales', roles: ['sales.member'] });
    const name = `Calon Uji ${tag()}`;
    const wf = await makeWorkflow(conn, { departmentCode: 'warehouse', requestedBy: pcMember.id, managerPersonId: whHead.personId, name });
    const off = await makeWorkflow(conn, { type: 'offboarding', departmentCode: 'sales', requestedBy: pcMember.id, name: `Keluar Uji ${tag()}` });
    const late = await makeTask(conn, wf.id, { title: 'Orientasi tim', userId: whHead.id, dueInDays: -2 });
    await makeTask(conn, wf.id, { title: 'Kirim info hari pertama', userId: pcMember.id, dueInDays: 3, ownerGroup: 'pc' });
    await makeTask(conn, wf.id, { title: 'Sudah selesai', userId: whHead.id, dueInDays: -5, status: 'completed' });
    await makeTask(conn, off.id, { title: 'Exit interview', userId: pcMember.id, dueInDays: 1, ownerGroup: 'pc', category: 'exit_interview' });

    const spy = recordSql(conn);
    const outputs = [];
    try {
      // The manager in another division: no hrga.view, still his own tasks.
      assert.equal(whHead.user.permissions.includes('hrga.view'), false);
      const mine = await run('tugas_onboarding_saya', whHead.user);
      outputs.push(mine);
      assert.equal(mine.total_tugas_terbuka, 1, 'open tasks only, of running workflows');
      assert.deepEqual(mine.tugas.map((x) => [x.id_tugas, x.judul, x.terlambat, x.karyawan, x.rute]), [[late, 'Orientasi tim', true, name, `/hrga/workflows/${wf.id}`]]);
      assert.equal(mine.tugas[0].tenggat, ops.addDays(wibToday(), -2));
      assert.equal(mine.terlambat, 1);

      const pcTasks = await run('tugas_onboarding_saya', pcMember.user);
      outputs.push(pcTasks);
      assert.deepEqual(pcTasks.tugas.map((x) => x.judul).sort(), ['Exit interview', 'Kirim info hari pertama']);
      assert.deepEqual(pcTasks.tugas.map((x) => x.judul), ['Exit interview', 'Kirim info hari pertama'], 'soonest due first');
      assert.deepEqual((await run('tugas_onboarding_saya', pcMember.user, { jenis: 'offboarding' })).tugas.map((x) => x.judul), ['Exit interview']);

      const nobody = await run('tugas_onboarding_saya', outsider.user);
      assert.equal(nobody.total_tugas_terbuka, 0);
      assert.deepEqual(nobody.tugas, []);
      assert.match(nobody.catatan_kantorku, /KantorKu/);

      // The list is People & Culture's page.
      await assert.rejects(run('daftar_onboarding_offboarding', outsider.user), forbidden);
      await assert.rejects(run('daftar_onboarding_offboarding', whHead.user), forbidden);
      const list = await run('daftar_onboarding_offboarding', pcMember.user, { cari: name });
      outputs.push(list);
      assert.deepEqual(list.alur.map((a) => [a.id, a.nomor, a.tugas_total, a.tugas_selesai, a.tugas_terlambat]), [[wf.id, wf.number, 3, 1, 1]]);

      // One workflow: full for People & Culture, limited for the manager, "not found" for the rest.
      const full = await run('status_onboarding_offboarding', pcMember.user, { nomor: wf.number });
      outputs.push(full);
      assert.equal(full.ditemukan, true);
      assert.match(full.akses, /^penuh/);
      assert.equal(full.alur.karyawan, name);
      assert.deepEqual(full.checklist, { total: 3, selesai: 1, terbuka: 2, terlambat: 1 });
      assert.deepEqual(full.tugas.map((x) => x.judul).sort(), ['Kirim info hari pertama', 'Orientasi tim']);
      assert.equal(full.tugas.find((x) => x.judul === 'Orientasi tim').penanggung_jawab, '[UJI] Head Gudang');
      assert.equal((await run('status_onboarding_offboarding', pcMember.user, { id: wf.id, semua_tugas: true })).tugas.length, 3);

      const limited = await run('status_onboarding_offboarding', whHead.user, { id: wf.id });
      outputs.push(limited);
      assert.equal(limited.ditemukan, true);
      assert.match(limited.akses, /^terbatas/);
      assert.equal(limited.tugas.find((x) => x.judul === 'Orientasi tim').tugas_saya, true);
      assert.equal((await run('status_onboarding_offboarding', whHead.user, { nomor: wf.number })).ditemukan, true, 'by number, through his own tasks');
      // Not his: the offboarding of another division.
      assert.equal((await run('status_onboarding_offboarding', whHead.user, { id: off.id })).ditemukan, false);
      assert.equal((await run('status_onboarding_offboarding', whHead.user, { nomor: off.number })).ditemukan, false);

      for (const input of [{ id: wf.id }, { nomor: wf.number }, { id: off.id }, {}]) {
        const out = await run('status_onboarding_offboarding', outsider.user, input);
        assert.equal(out.ditemukan, false, JSON.stringify(input));
        assert.equal('alur' in out || 'tugas' in out, false);
      }
      // Another entity never reads it.
      assert.equal((await run('status_onboarding_offboarding', { ...pcMember.user, entityId: 999999 }, { id: wf.id })).ditemukan, false);
      assert.equal((await run('tugas_onboarding_saya', { ...whHead.user, entityId: 999999 })).total_tugas_terbuka, 0);
    } finally { spy.stop(); }

    assertOnlySelect(spy.calls, 'onboarding tools');
    for (const out of outputs) {
      assert.doesNotMatch(JSON.stringify(out), /SENTINEL|kantorku\.invalid|"resign"/, 'no personal contact, reason, notes or KantorKu reference');
      assert.deepEqual(keysOf(out).filter((k) => PERSONAL.test(k)), []);
    }
  });
});

test('db: directory — a viewer finds colleagues by name, title or division with work contact only; excluded and resigned people stay hidden', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const mark = `Zx${tag().replace(/[^0-9]/g, '')}`;
    const boss = await makeUser(conn, { name: `${mark} Atasan`, division: 'sales', roles: ['sales.head'] });
    const staff = await makeUser(conn, { name: `${mark} Staf`, division: 'sales', roles: ['sales.member'], managerPersonId: boss.personId });
    const hidden = await makeUser(conn, { name: `${mark} Dikecualikan`, division: 'sales', roles: ['sales.member'], excluded: true });
    const gone = await makeUser(conn, { name: `${mark} Resign`, division: 'sales', roles: ['sales.member'] });
    await conn.query("UPDATE people_directory SET position = ?, work_phone = 'ext. 123', notes = 'SENTINEL catatan PC' WHERE id = ?", [`Admin Pajak ${mark}`, staff.personId]);
    await conn.query("UPDATE people_directory SET status = 'resigned', resigned_on = '2026-01-31', resigned_on_source = 'entered' WHERE id = ?", [gone.personId]);
    const asker = await makeUser(conn, { name: 'Penanya', division: 'warehouse', roles: ['warehouse.member'] });
    const pcHead = await makeUser(conn, { name: 'PC Head', division: 'people_culture', roles: ['people_culture.head'] });

    const spy = recordSql(conn);
    try {
      for (const user of [asker.user, pcHead.user]) {
        const byName = await run('direktori_karyawan', user, { cari: mark });
        assert.deepEqual(byName.orang.map((p) => p.nama).sort(), [`[UJI] ${mark} Atasan`, `[UJI] ${mark} Staf`], 'never the excluded or resigned, even for People & Culture');
        const person = byName.orang.find((p) => p.nama.endsWith('Staf'));
        assert.equal(person.kunci, `p${staff.personId}`);
        assert.equal(person.jabatan, `Admin Pajak ${mark}`);
        assert.equal(person.divisi, 'Sales');
        assert.equal(person.atasan, `[UJI] ${mark} Atasan`);
        assert.equal(person.telepon_kerja, 'ext. 123');
        assert.match(person.email_kerja, /@uji\.invalid$/);
        assert.doesNotMatch(JSON.stringify(byName), /SENTINEL|2026-01-31/);
        assert.deepEqual(keysOf(byName).filter((k) => PERSONAL.test(k)), []);

        // "Siapa yang menangani pajak?" — by a word in the title.
        const byTitle = await run('direktori_karyawan', user, { cari: `Pajak ${mark}` });
        assert.deepEqual(byTitle.orang.map((p) => p.kunci), [`p${staff.personId}`]);
        // "Siapa saja di divisi Sales?"
        const inSales = await run('direktori_karyawan', user, { divisi: 'sales', cari: mark });
        assert.equal(inSales.total_cocok, 2);
        assert.equal((await run('direktori_karyawan', user, { divisi: 'finance', cari: mark })).total_cocok, 0);

        const one = await run('direktori_karyawan', user, { kunci: `p${boss.personId}` });
        assert.equal(one.ditemukan, true);
        assert.deepEqual(one.bawahan_langsung.map((r) => r.kunci), [`p${staff.personId}`]);
        assert.equal((await run('direktori_karyawan', user, { kunci: `p${hidden.personId}` })).ditemukan, false);
        assert.equal((await run('direktori_karyawan', user, { kunci: `p${gone.personId}` })).ditemukan, false);
      }
      // Another entity sees none of them.
      assert.equal((await run('direktori_karyawan', { ...asker.user, entityId: 999999 }, { cari: mark })).total_cocok, 0);
    } finally { spy.stop(); }
    assertOnlySelect(spy.calls, 'directory tool');
  });
});

test('db: Layanan GA — my requests are mine; others only for the GA team; the room agenda masks other people; vehicles are in TrackCar', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  const sent = t.mock.method(notif, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const room = await makeResource(conn, { kind: 'room', locationId: loc });
    const a = await makeUser(conn, { name: 'Staf Sales', division: 'sales', roles: ['sales.member'] });
    const b = await makeUser(conn, { name: 'Staf Gudang', division: 'warehouse', roles: ['warehouse.member'] });
    const gaStaff = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.member'] });

    const atk = await requests.create(a.user, { requestType: 'atk', locationId: loc, note: 'Untuk minggu ini', items: [{ itemName: 'Kertas A4', qty: 2, unit: 'rim' }] });
    const repair = await requests.create(b.user, { requestType: 'facility_repair', locationId: loc, area: 'AC ruang rapat', description: 'Bocor', urgent: true });
    await requests.assign(gaStaff.user, repair.id, { userId: gaStaff.id });
    const booking = await bookings.createBooking(a.user, { resourceId: room, startsAt: at(1, '09:00'), endsAt: at(1, '10:00'), purpose: 'Rapat SENTINEL klien' });
    const tomorrow = at(1, '09:00').slice(0, 10);

    const spy = recordSql(conn);
    try {
      const mine = await run('layanan_ga_saya', a.user);
      assert.deepEqual(mine.permintaan_saya.daftar.map((r) => [r.nomor, r.status, r.rute]), [[atk.requestNumber, 'Baru', `/ga/requests/${atk.id}`]]);
      assert.equal(mine.permintaan_saya.berjalan, 1);
      assert.deepEqual(mine.pemesanan_ruang_saya.daftar.map((x) => x.nomor), [booking.bookingNumber]);
      assert.equal(mine.menunggu_persetujuan_saya.jumlah, 0);
      assert.equal('ditugaskan_ke_saya' in mine, false, 'only the GA team has an assigned queue');
      assert.match(mine.kendaraan, /TrackCar/);
      assert.ok(mine.permintaan_saya.daftar[0].target_selesai.endsWith('+07:00'));

      const other = await run('layanan_ga_saya', b.user);
      assert.deepEqual(other.permintaan_saya.daftar.map((r) => r.nomor), [repair.requestNumber]);
      assert.equal(other.permintaan_saya.daftar[0].petugas, '[UJI] GA');
      assert.equal(other.pemesanan_ruang_saya.akan_datang, 0);

      const ga = await run('layanan_ga_saya', gaStaff.user);
      assert.deepEqual(ga.ditugaskan_ke_saya.daftar.map((r) => r.nomor), [repair.requestNumber]);
      assert.equal(ga.permintaan_saya.berjalan, 0);

      // Lists: "saya" is bound to the asker; "semua" is the GA team's.
      assert.deepEqual((await run('permintaan_ga', a.user, {})).permintaan.map((r) => r.id), [atk.id]);
      for (const cakupan of ['semua', 'ditugaskan_ke_saya']) {
        const refused = await run('permintaan_ga', a.user, { cakupan });
        assert.equal('permintaan' in refused, false, cakupan);
        assert.match(refused.catatan, /Hanya tim GA/);
      }
      const everything = await run('permintaan_ga', gaStaff.user, { cakupan: 'semua', cari: '[UJI] Staf' });
      assert.ok([atk.id, repair.id].every((id) => everything.permintaan.some((r) => r.id === id)));
      assert.deepEqual((await run('permintaan_ga', gaStaff.user, { cakupan: 'ditugaskan_ke_saya' })).permintaan.map((r) => r.id), [repair.id]);
      assert.deepEqual((await run('permintaan_ga', gaStaff.user, { cakupan: 'semua', jenis: 'atk', cari: atk.requestNumber })).permintaan.map((r) => r.id), [atk.id]);

      // One request: the requester and GA, never a colleague.
      const detail = await run('permintaan_ga', a.user, { nomor: atk.requestNumber });
      assert.equal(detail.ditemukan, true);
      assert.deepEqual(detail.permintaan.barang, [{ nama: 'Kertas A4', jumlah: 2, satuan: 'rim' }]);
      assert.equal((await run('permintaan_ga', gaStaff.user, { id: atk.id })).ditemukan, true);
      assert.equal((await run('permintaan_ga', b.user, { id: atk.id })).ditemukan, false);
      assert.equal((await run('permintaan_ga', b.user, { nomor: atk.requestNumber })).ditemukan, false);
      assert.equal((await run('permintaan_ga', { ...a.user, entityId: 999999 }, { id: atk.id })).ditemukan, false);

      // The agenda: full for the owner and GA, slot + division for everyone else.
      const range = { dari: tomorrow, sampai: tomorrow, ruang: '[UJI] room' };
      const own = await run('pemesanan_ruang', a.user, range);
      assert.equal(own.pemesanan.length, 1);
      assert.equal(own.pemesanan[0].keperluan, 'Rapat SENTINEL klien');
      assert.equal(own.pemesanan[0].milik_saya, true);
      const masked = await run('pemesanan_ruang', b.user, range);
      assert.deepEqual(Object.keys(masked.pemesanan[0]).sort(), ['disamarkan', 'divisi', 'mulai', 'ruang', 'selesai']);
      assert.equal(masked.pemesanan[0].divisi, 'Sales');
      assert.match(masked.pemesanan[0].ruang, /^\[UJI\] room/);
      assert.doesNotMatch(JSON.stringify(masked), /SENTINEL|Staf Sales/, 'never who or why');
      assert.equal((await run('pemesanan_ruang', b.user, { ...range, hanya_saya: true })).pemesanan.length, 0);
      assert.equal((await run('pemesanan_ruang', gaStaff.user, range)).pemesanan[0].pemesan, '[UJI] Staf Sales');
      assert.match(masked.kendaraan, /TrackCar/);
      assert.ok(masked.ruang_tersedia_untuk_dipesan.some((r) => r.id === room));
      assert.match((await run('pemesanan_ruang', a.user, { dari: '2026-01-01', sampai: '2026-03-31' })).catatan, /paling panjang 31 hari/);
      assert.equal((await run('pemesanan_ruang', a.user, { ...range, dari: ops.addDays(tomorrow, 2), sampai: ops.addDays(tomorrow, 3) })).pemesanan.length, 0);
      const week = await run('pemesanan_ruang', a.user, { periode: 'minggu_ini' });
      assert.equal(new Date(`${week.dari}T00:00:00Z`).getUTCDay(), 1, 'the week starts on Monday');
      assert.equal(week.sampai, ops.addDays(week.dari, 6));
      const today = await run('pemesanan_ruang', a.user, {});
      assert.equal(today.dari, rules.wibDay());
      assert.equal(today.sampai, rules.wibDay());

      for (const out of [mine, other, ga, everything, detail, own, masked]) {
        assert.deepEqual(keysOf(out).filter((k) => RUPIAH.test(k) || PERSONAL.test(k)), []);
      }
    } finally { spy.stop(); }
    assertOnlySelect(spy.calls, 'GA tools');
  });
  // Nothing real was sent: every notification of the setup went to the mock.
  assert.ok(sent.mock.callCount() >= 1);
});

test('db: Operasional GA — People & Culture reads what is due; amounts only for the Supervisor/Head; other divisions nothing', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const member = await makeUser(conn, { name: 'GA Member', division: 'people_culture', roles: ['people_culture.member'] });
    const supervisor = await makeUser(conn, { name: 'GA Supervisor', division: 'people_culture', roles: ['people_culture.supervisor'] });
    const sales = await makeUser(conn, { name: 'Sales Head', division: 'sales', roles: ['sales.head'] });
    const today = wibToday();
    const mark = `Uji${tag().replace(/[^0-9]/g, '')}`;
    const upkeep = await ops.createRow(conn, { entityId: 1, userId: supervisor.id, key: 'maintenance', body: { locationId: loc, category: 'ac', name: `AC ${mark}`, intervalDays: 90, nextDueOn: ops.addDays(today, -5) } });
    const later = await ops.createRow(conn, { entityId: 1, userId: supervisor.id, key: 'maintenance', body: { locationId: loc, category: 'apar', name: `APAR ${mark}`, intervalDays: 180, nextDueOn: ops.addDays(today, 60) } });
    const deal = await ops.createRow(conn, { entityId: 1, userId: supervisor.id, key: 'contracts', body: { kind: 'cleaning', vendorName: `PT Bersih ${mark}`, endOn: ops.addDays(today, 30), noticeDays: 60, monthlyCost: MONEY } });
    const bill = await ops.createRow(conn, { entityId: 1, userId: supervisor.id, key: 'bills', body: { locationId: loc, utility: 'electricity', customerNumber: `SENTINEL-${mark}`, period: '2026-08', amount: MONEY, usageAmount: 1234, dueOn: ops.addDays(today, -3) } });

    const spy = recordSql(conn);
    try {
      for (const user of [member.user, supervisor.user]) {
        const due = await run('operasional_ga', user, { jumlah: 50 });
        const row = due.perawatan.daftar.find((m) => m.id === upkeep);
        assert.deepEqual([row.nama, row.kategori, row.keadaan, row.jadwal_berikutnya], [`AC ${mark}`, 'AC', 'lewat jadwal', ops.addDays(today, -5)]);
        assert.equal(due.perawatan.daftar.some((m) => m.id === later), false, 'not due yet');
        const contract = due.kontrak.daftar.find((c) => c.id === deal);
        assert.deepEqual([contract.vendor, contract.keadaan, contract.berakhir], [`PT Bersih ${mark}`, 'segera berakhir', ops.addDays(today, 30)]);
        const overdue = due.tagihan.daftar.find((x) => x.id === bill);
        assert.deepEqual([overdue.utilitas, overdue.periode, overdue.status, overdue.jatuh_tempo], ['Listrik', '2026-08', 'lewat jatuh tempo', ops.addDays(today, -3)]);
        assert.ok(due.ringkasan.perawatan_lewat_jadwal >= 1 && due.ringkasan.kontrak_segera_berakhir >= 1 && due.ringkasan.tagihan_lewat_jatuh_tempo >= 1);
        const json = JSON.stringify(due);
        assert.ok(!json.includes(String(MONEY)), 'no amount');
        assert.doesNotMatch(json, /SENTINEL/);
        assert.deepEqual(keysOf(due).filter((k) => RUPIAH.test(k)), []);

        const whole = await run('operasional_ga', user, { bagian: 'perawatan', hanya_perlu_tindakan: false, jumlah: 50 });
        assert.equal(whole.perawatan.daftar.find((m) => m.id === later).keadaan, 'terjadwal');
        assert.ok(!JSON.stringify(whole).includes(String(MONEY)));
      }

      await assert.rejects(run('operasional_ga', sales.user), forbidden);
      await assert.rejects(run('tagihan_utilitas_ga', sales.user), forbidden);
      await assert.rejects(run('tagihan_utilitas_ga', member.user), forbidden);
      const money = await run('tagihan_utilitas_ga', supervisor.user, { periode: '2026-08', status: 'lewat_jatuh_tempo', jumlah: 50 });
      const billRow = money.tagihan.find((x) => x.id === bill);
      assert.deepEqual([billRow.nominal, billRow.pemakaian, billRow.satuan], [MONEY, 1234, 'kWh']);
      assert.doesNotMatch(JSON.stringify(money), /SENTINEL/, 'never the customer/meter number');
      // Another entity reads none of it.
      const elsewhere = await run('operasional_ga', { ...member.user, entityId: 999999 }, { hanya_perlu_tindakan: false });
      assert.deepEqual([elsewhere.perawatan.total, elsewhere.kontrak.total, elsewhere.tagihan.total], [0, 0, 0]);
      assert.equal((await run('tagihan_utilitas_ga', { ...supervisor.user, entityId: 999999 })).total_cocok, 0);
    } finally { spy.stop(); }
    assertOnlySelect(spy.calls, 'Operasional GA tools');
  });
});
