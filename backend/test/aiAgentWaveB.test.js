// Wave B merge checks (docs/prakasa-ai-rencana.md §9.7): the agent tools load
// from every entry point (no half-built module from a require cycle), Google is
// asked by the two Project Tracker tools only and can never make a tool throw,
// and the agent rules carry the module rules the tools rely on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const SRC = path.join(__dirname, '../src');
const agentTools = require('../src/services/ai/agent/agentTools');
const agentRun = require('../src/services/ai/agent/agentRun');
const tracker = require('../src/services/tracker.service');
const trackerReports = require('../src/services/trackerReports.service');
const work = require('../src/services/ai/agent/tools/work');

const tool = (name) => agentTools.byName.get(name);

// Each entry point is loaded FIRST in a fresh process: whichever module starts
// the require chain, agentTools must come out complete and agentRun must reach it.
const ENTRY_POINTS = [
  'services/ai/provider',
  'services/ai/agent/agentTools',
  'services/aiCommand.service',
  'services/ai/agent/agentRun',
  'controllers/aiAgent.controller',
  'services/aiToolRegistry.service',
  'controllers/aiCommand.controller',
];

test('agentTools.toolsFor works whichever module is loaded first', { timeout: 120000 }, () => {
  for (const entry of ENTRY_POINTS) {
    const script = `
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';
      require(${JSON.stringify(path.join(SRC, entry))});
      const tools = require(${JSON.stringify(path.join(SRC, 'services/ai/agent/agentTools'))});
      const run = require(${JSON.stringify(path.join(SRC, 'services/ai/agent/agentRun'))});
      const registry = require(${JSON.stringify(path.join(SRC, 'services/aiToolRegistry.service'))});
      const user = { sub: 1, entityId: 1, permissions: ['notification.view', 'sales.order.view'] };
      const direct = tools.toolsFor(user, { visibility: 'private' }).map((t) => t.name);
      run.prepare({ user, session: { id: 1, visibility: 'private' } }).then(async (agent) => {
        await agent.cleanup();
        const starters = registry.startersFor(registry.TOOLS_BY_KEY.get('sales-orders'), 'member', user);
        process.stdout.write(JSON.stringify({ total: tools.TOOLS.length, direct, viaRun: agent.tools.map((t) => t.name), starters }));
        process.exit(0);
      }).catch((error) => { process.stderr.write(String(error && error.stack)); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000, env: { ...process.env, NODE_ENV: 'test' } });
    assert.equal(child.status, 0, `${entry}: ${child.stderr || child.error}`);
    const out = JSON.parse(child.stdout);
    assert.equal(out.total, agentTools.TOOLS.length, entry);
    assert.ok(out.direct.includes('profil_saya') && out.direct.includes('omzet_sales') && out.direct.includes('pekerjaan_saya_hari_ini'), entry);
    assert.deepEqual(out.viaRun, out.direct, `${entry}: agentRun sees the same tools`);
    assert.ok(out.starters.includes('Order mana yang belum terkirim penuh?'), `${entry}: the registry reaches the tools for its starters`);
  }
});

test('Project Tracker: a Google failure of any kind is "tidak tersedia", never a throw and never a wait', async (t) => {
  const user = { sub: 15, entityId: 1, departmentId: 5, permissions: ['google.chat.use'] };
  const failures = {
    rejects: async () => { throw Object.assign(new Error('invalid_grant'), { code: 401 }); },
    throws: () => { throw new Error('Google client not configured'); },
    'answers nothing': async () => undefined,
    'answers a wrong shape': async () => ({ projects: 'bukan daftar' }),
  };
  const listProjects = t.mock.method(tracker, 'listProjects', async () => ({ projects: [] }));
  for (const [label, impl] of Object.entries(failures)) {
    listProjects.mock.mockImplementation(impl);
    for (const name of ['proyek_saya', 'issue_saya']) {
      const out = await tool(name).run(user, {});
      assert.equal(out.tersedia, false, `${name} when Google ${label}`);
      assert.match(out.catatan, /Project Tracker belum bisa dibaca/);
      assert.deepEqual(Object.keys(out).sort(), ['catatan', 'tersedia'], 'nothing else is returned, nothing guessed');
    }
  }
  // Google that never answers: the wait ends by itself.
  const started = Date.now();
  assert.deepEqual(await work.orUnavailable(() => new Promise(() => {}), 30), { ok: false });
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(await work.orUnavailable(async () => 7, 30), { ok: true, value: 7 });

  // The membership check passes, then the report or one project's issues fail: still no throw.
  const project = { id: 3, key: 'UJI', name: 'Proyek Uji', spaceId: 'spaces-UJI', counts: { open: 1, inProgress: 0, done: 0, overdue: 0 }, activeSprint: null };
  listProjects.mock.mockImplementation(async () => ({ projects: [project] }));
  t.mock.method(trackerReports, 'getReports', async () => { throw new Error('Google 503'); });
  t.mock.method(tracker, 'listIssues', async () => { throw new Error('Google 503'); });
  assert.equal((await tool('proyek_saya').run(user, { proyek_id: 3 })).tersedia, false);
  const issues = await tool('issue_saya').run(user, {});
  assert.deepEqual([issues.tersedia, issues.proyek_dibaca, issues.issue.length], [true, 0, 0]);
  assert.match(issues.catatan, /1 proyek tidak bisa dibaca/);
  // Not a member (the page answers 403/404): "tidak ditemukan", like the page.
  trackerReports.getReports.mock.mockImplementation(async () => { throw Object.assign(new Error('bukan anggota'), { status: 403 }); });
  assert.deepEqual([(await tool('proyek_saya').run(user, { proyek_id: 3 })).ditemukan, (await tool('proyek_saya').run(user, { proyek_id: 99 })).ditemukan], [false, false]);
});

test('no tool other than the two Project Tracker tools and the own-calendar tool can reach Google', () => {
  const GOOGLE = /googleapis|google-auth-library|google[A-Z]\w*\.service|googleUserClient|gmail\.service|trackerChat/;
  // Services a tool file requires that themselves load a Google client, each reviewed:
  // what the tool calls in it reads the database only.
  const REVIEWED = {
    'financeRequests.service': 'Drive is used by addAttachment (upload) only; the tools call list, get and awaitingMyDecision',
    'gaRequests.service': 'Drive is used by addAttachment (upload) only; the tools call the list and detail reads',
    'itTickets.controller': 'Drive is used by the attachment upload handler only; the tool calls the ticket list and detail reads',
    'marketingInsights.service': 'Google Analytics is used by webSessions only; the tools call insights (Accurate data in the database)',
    'board.service': 'Google Chat is used when a board is created only; tools/work.js calls listBoards and getBoardDetail',
    'tracker.service': 'tools/work.js only: the read-only space membership lookup, exactly as the Project Tracker page',
    'trackerReports.service': 'tools/work.js only: reports of a project the user is a member of',
    'googleCalendarUser.service': 'tools/calendar.js only: listEvents on the primary calendar AS the signed-in user (user.email), the read the Kalender page does; no insert, patch or delete',
    'googleCalendarApp.controller': 'tools/calendar.js only: the pure helpers normalizeEvent and isValidEventId; no handler is called',
  };
  const TRACKER_ONLY_IN = 'work.js';
  // The one Google service a tool file may require directly, and the only file that may.
  const DIRECT_GOOGLE = { 'calendar.js': ['../../../googleCalendarUser.service', '../../../../controllers/googleCalendarApp.controller'] };
  const seen = new Set();
  for (const file of fs.readdirSync(agentTools.TOOLS_DIR)) {
    const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, file), 'utf8');
    const requires = [...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    for (const request of requires) {
      if (!(DIRECT_GOOGLE[file] || []).includes(request)) assert.doesNotMatch(request, /google|gmail|drive|trackerChat/i, `${file} requires a Google service directly`);
      if (/tracker/i.test(request)) assert.equal(file, TRACKER_ONLY_IN, `${file} must not read the Project Tracker`);
      if (!request.startsWith('.')) continue;
      const target = path.resolve(agentTools.TOOLS_DIR, request);
      const source = [`${target}.js`, path.join(target, 'index.js')].find((candidate) => fs.existsSync(candidate));
      if (!source || source.startsWith(agentTools.TOOLS_DIR)) continue;
      const name = path.basename(source, '.js');
      if (!GOOGLE.test(fs.readFileSync(source, 'utf8')) && !/tracker/i.test(name)) continue;
      seen.add(name);
      assert.ok(REVIEWED[name], `${file} requires ${name}, which loads a Google client: review what the tool calls and add it to REVIEWED`);
    }
    assert.doesNotMatch(code, /addAttachment|uploadFile|\.upload\(|sendMessage|postMessage|createSpace|createBoard|webSessions|runReport|listProperties/, `${file} must not call the Google-backed function of a service`);
    assert.doesNotMatch(code, /insertEvent|patchEvent|deleteEvent|createEvent|updateEvent|respondEvent|listCalendars|calendarClient/, `${file} must not write to, or list, a Google Calendar`);
  }
  assert.deepEqual([...seen].sort(), Object.keys(REVIEWED).sort(), 'REVIEWED lists a service no tool uses any more');
  for (const sealed of agentTools.TOOLS) {
    if (['proyek_saya', 'issue_saya', 'acara_kalender_saya'].includes(sealed.name) || sealed.client) continue; // a page tool has no server code
    assert.doesNotMatch(sealed.impl.toString(), /\btracker\.|\btrackerReports\.|\bcalendar\.|require\([^)]*google/i, `${sealed.name} must not call Google`);
  }
});

test('the agent rules carry the module rules: read-only decisions, DPP, no purchase price, KantorKu, honest data state, routes', () => {
  const rules = agentRun.AGENT_RULES;
  const numbered = rules.split('\n').filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(numbered.map((line) => Number(line.split('.')[0])), numbered.map((_, i) => i + 1), 'rules are numbered without a gap');
  assert.ok(numbered.length >= 18);
  for (const expected of [
    /Persetujuan dan tanda tangan hanya bisa kamu baca/,
    /tidak pernah menyetujui, menolak, meminta revisi, atau menandatangani/,
    /selalu DPP: tulis "sebelum PPN"/,
    /Harga beli, HPP, nilai PO, belanja pemasok, nilai stok, dan margin tidak pernah tersedia/,
    /Cuti, absensi, lembur, gaji, dan data pribadi karyawan ada di KantorKu/,
    /menunggu persetujuan, belum disetujui, belum terhubung ke Accurate/,
    /"Buka: <nama menu atau halaman>"/,
    /Jangan pernah menyatakan sudah menyimpan, mengirim, membuat, menyetujui, atau mengubah/,
    /itu berarti PENGGUNA tidak punya akses ke data itu/,
    /Jangan menulis kata "alat" atau "tool"/,
    /jangan menambah catatan, dan jangan menyebut angka apa pun/,
  ]) assert.match(rules, expected);
  assert.ok(rules.length < 6000, 'the rules stay short: they are sent with every agent answer');
});

test('decisions kept: cost tools are stricter than their page, management money follows the page, retired routes stay covered', () => {
  const perms = (name) => [].concat(tool(name).permission);
  // (b) software cost and utility bill amounts: the managing Supervisor/Head, not every viewer of the page.
  assert.deepEqual(perms('biaya_langganan_software'), ['subscription.manage', 'subscription.invoice.manage', 'subscription.payment.manage']);
  assert.deepEqual(perms('tagihan_utilitas_ga'), ['ga.ops.manage']);
  assert.equal(perms('biaya_langganan_software').includes('subscription.view') || perms('tagihan_utilitas_ga').includes('ga.ops.view'), false);
  // (c) management money tools: the page's own gate.
  const registry = require('../src/services/aiToolRegistry.service');
  assert.deepEqual(perms('angka_rupiah_divisi'), [].concat(registry.TOOLS_BY_KEY.get('division-dashboard').readPermission));
  assert.deepEqual(perms('target_realisasi_rupiah'), [].concat(registry.TOOLS_BY_KEY.get('targets').readPermission));
  for (const name of ['biaya_langganan_software', 'tagihan_utilitas_ga', 'angka_rupiah_divisi', 'target_realisasi_rupiah']) {
    assert.deepEqual([tool(name).money, tool(name).privateOnly], [true, true], name);
  }
  // (d) the retired routes still have a tool.
  const { coverage } = require('../src/services/ai/agent/moduleCoverage');
  const { covered } = coverage();
  for (const key of ['approvals', 'approval-delegations', 'documents', 'templates']) assert.ok(covered[key]?.length, key);
  // (a) the Project Tracker keeps its two read tools.
  assert.deepEqual(covered.projects, ['proyek_saya', 'issue_saya']);
});
