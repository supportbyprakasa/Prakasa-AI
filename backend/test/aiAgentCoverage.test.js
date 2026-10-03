// "Every module has AI data help": each page tool of aiToolRegistry is served
// by an agent tool, exempt with a reason, or on the PENDING list (empty since
// Wave B) — and every starter question shown to a role can be answered by a
// tool that role holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../src/services/aiToolRegistry.service');
const agentTools = require('../src/services/ai/agent/agentTools');
const { coverage, EXEMPT, PENDING, isPending } = require('../src/services/ai/agent/moduleCoverage');
const { STANDARD_ROLES } = require('../src/config/standardOrganization');

test('every page tool is covered, exempt with a reason, or pending — never none and never two', (t) => {
  const result = coverage();
  assert.deepEqual(result.missing, [], 'page tools with no agent tool, no exemption and not on PENDING');
  assert.deepEqual(result.problems, []);
  const keys = registry.TOOLS.map((entry) => entry.key);
  assert.equal(Object.keys(result.covered).length + Object.keys(EXEMPT).length + PENDING.length, keys.length);
  for (const reason of Object.values(EXEMPT)) assert.ok(reason.length > 20, reason);
  t.diagnostic(`Dilayani alat (${Object.keys(result.covered).length}): ${Object.entries(result.covered).map(([k, v]) => `${k} ← ${v.join(', ')}`).join('; ')}`);
  t.diagnostic(`Dikecualikan (${Object.keys(EXEMPT).length}): ${Object.keys(EXEMPT).join(', ')}`);
  t.diagnostic(`PENDING (${PENDING.length}): ${PENDING.join(', ')}`);
  if (PENDING.length) console.log(`[aiAgentCoverage] PENDING (${PENDING.length}): ${PENDING.join(', ')}`);
});

test('Wave B left nothing pending: all 39 pages of the work list are served by a tool, and Alur & margin stays exempt', () => {
  const { covered } = coverage();
  assert.deepEqual([...PENDING], []);
  const WAVE_B = ['dashboard', 'search', 'tasks', 'approvals', 'approval-delegations', 'signatures', 'documents', 'division-storage', 'templates',
    'doc-templates', 'projects', 'sales-pipeline', 'sales-customers', 'sales-leads', 'sales-orders', 'accurate-batches', 'retail-commerce',
    'marketing-insights', 'marketing-campaigns', 'finance', 'finance-receivables', 'finance-payables', 'hr-onboarding', 'hr-offboarding',
    'hr-workflows', 'hr-checklists', 'people-directory', 'ga-services', 'ga-operations', 'it-tickets', 'it-dashboard', 'devices', 'subscriptions',
    'it-infrastructure', 'division-dashboard', 'escalations', 'roadmap', 'targets', 'management'];
  assert.equal(WAVE_B.length, 39);
  for (const key of WAVE_B) assert.ok((covered[key] || []).length > 0, `${key} has no agent tool`);
  assert.ok('management-flow' in EXEMPT && !covered['management-flow'], 'Alur & margin is never read by a tool');
});

test('a new page tool with no coverage decision fails; one served by a tool must leave PENDING', () => {
  const pages = [...registry.TOOLS, { key: 'modul-baru' }];
  assert.deepEqual(coverage({ pageTools: pages }).missing, ['modul-baru']);
  assert.deepEqual(coverage({ pageTools: pages, pending: ['modul-baru'] }).missing, []);
  assert.match(coverage({ pending: ['tasks'] }).problems.join(' '), /"tasks" sudah dilayani alat tugas_saya, detail_tugas, ringkasan_papan: hapus dari PENDING/);
  assert.match(coverage({ pending: ['tidak-ada'] }).problems.join(' '), /PENDING "tidak-ada" bukan kunci halaman/);
  const exemptServed = [...agentTools.TOOLS, { name: 'email_saya', module: ['google-mail'] }];
  assert.match(coverage({ agentTools: exemptServed }).problems.join(' '), /"google-mail" ada di EXEMPT tetapi dilayani/);
});

test('what exists today is covered: handbook, notifications, account, warehouse, procurement', () => {
  const { covered } = coverage();
  assert.deepEqual(covered.handbook, ['panduan_aplikasi']);
  assert.deepEqual(covered.notifications, ['notifikasi_saya']);
  assert.deepEqual(covered.account, ['profil_saya']);
  assert.deepEqual([...covered.warehouse].sort(), ['gudang_hari_ini', 'jadwal_kirim', 'pergerakan_gudang', 'stok_barang']);
  assert.deepEqual([...covered.procurement].sort(), ['procurement_hari_ini', 'rapor_pemasok', 'status_po', 'stok_barang']);
});

const starterText = (s) => (typeof s === 'string' ? s : s.text);
const PRIVATE = { visibility: 'private' };
// A page some roles open for a part no agent tool reads. Each entry is a decision, with its reason.
// Empty since Wave C2: pergerakan_gudang reads the movement documents, so a role that opens Warehouse
// for them alone (Procurement Member, Retail Commerce) holds a tool that serves the page.
const NO_TOOL_FOR_ROLE = {
  // Data Accurate for a proposer only (accurate.write.request without the batch
  // view, owner 3 Oct 2026): the page is their own requests, which they type
  // themselves; no agent tool reads a batch for them.
  'accurate-batches': (role) => !role.permissions.some((code) => ['accurate.batch.view', 'sales.master.manage'].includes(code)),
};

test('a pending page shows only generic starters (the rule still holds, with nothing pending today)', () => {
  for (const entry of registry.TOOLS) {
    for (const level of ['member', 'supervisor', 'head']) {
      assert.ok(registry.startersFor(entry, level, { permissions: [] }).length >= 4, `${entry.key} ${level}`);
      assert.equal(isPending(entry.key), false, entry.key);
    }
  }
  assert.ok(registry.startersFor(registry.TOOLS_BY_KEY.get('handbook'), 'member').includes('Bagaimana cara mengajukan pembayaran?'));
});

test('every covered page has 2–4 starters per role level (at most one action starter added in Wave C2), each naming the tool that answers it', () => {
  const { covered } = coverage();
  const byKey = registry.TOOLS_BY_KEY;
  // Wave A pages keep their plain starters: the handbook/profile are public tools, and the
  // Warehouse/Procurement panels also answer from what the page publishes.
  const PLAIN_ALLOWED = new Set(['handbook', 'account', 'warehouse', 'procurement']);
  for (const key of Object.keys(covered)) {
    const entry = byKey.get(key);
    for (const level of ['member', 'supervisor', 'head']) {
      const starters = entry.starters[level] || [];
      assert.ok(starters.length >= 1 && starters.length <= 4, `${key} ${level}: ${starters.length} starters`);
      assert.ok(starters.filter((s) => s.tool === 'isi_form').length <= 2, `${key} ${level}: at most two action starters`);
      assert.equal(new Set(starters.map(starterText)).size, starters.length, `${key} ${level}: duplicate starter`);
      for (const s of starters) {
        assert.ok(starterText(s).length <= 90, `${key}: "${starterText(s)}" is too long for a chip`);
        if (typeof s === 'string' || !s.tool) { assert.ok(PLAIN_ALLOWED.has(key), `${key}: "${starterText(s)}" must name its tool`); continue; }
        assert.ok(agentTools.byName.get(s.tool), `${key}: "${s.text}" names an unknown tool ${s.tool}`);
      }
      if (!PLAIN_ALLOWED.has(key)) {
        assert.ok(starters.some((s) => covered[key].includes(s.tool)), `${key} ${level}: no starter is answered by a tool serving this page`);
      }
    }
    // Head/Supervisor pages aside, a page shows at least two of its own questions.
    assert.ok(['member', 'supervisor', 'head'].some((level) => (entry.starters[level] || []).length >= 2), key);
  }
  // Retired questions no tool can answer.
  const all = registry.TOOLS.flatMap((entry) => Object.values(entry.starters).flat().map(starterText));
  for (const gone of ['Pecah pekerjaan ini menjadi task', 'Tren penyelesaian task divisi', 'Approval mana yang sering terlambat?', 'Bantu saya menyusun draft dokumen',
    'Dokumen mana yang perlu direview?', 'Standar dokumen apa yang perlu diperbarui?', 'Buatkan draft dokumen baru di penyimpanan divisi', 'Order mana yang belum ada surat jalannya?']) {
    assert.equal(all.includes(gone), false, gone);
  }
  assert.ok(all.includes('Order mana yang belum terkirim penuh?'));
});

test('every starter shown to a standard role is answerable: the role holds the tool, in a private conversation', (t) => {
  const { covered } = coverage();
  let shownCount = 0;
  const thin = [];
  for (const role of STANDARD_ROLES) {
    const user = { permissions: [...role.permissions] };
    // Starters are shown in the side panel: page tools (isi_form) are held there.
    const mine = new Set(agentTools.toolsFor(user, PRIVATE, { surface: 'panel' }).map((x) => x.name));
    for (const entry of registry.TOOLS) {
      if (!registry.canRead(user, entry) || !covered[entry.key]) continue;
      const where = `${role.key} on ${entry.key}`;
      const serving = covered[entry.key].filter((name) => mine.has(name));
      if (NO_TOOL_FOR_ROLE[entry.key]?.(role)) {
        assert.deepEqual(serving, [], `${where}: the exception is no longer needed`);
      } else {
        assert.ok(serving.length > 0, `${where}: the role opens the page but holds no tool that serves it`);
      }
      const declared = entry.starters[role.level] || [];
      const shown = registry.startersFor(entry, role.level, user);
      const own = declared.filter((s) => shown.includes(starterText(s)));
      for (const s of own) {
        if (typeof s === 'string') continue;
        shownCount += 1;
        if (s.tool) assert.ok(mine.has(s.tool), `${where}: "${s.text}" is shown but the role does not hold ${s.tool}`);
        if (s.permission) assert.ok([].concat(s.permission).some((code) => role.permissions.includes(code)), `${where}: "${s.text}" needs ${s.permission}`);
      }
      // And nothing is hidden that the role could have asked.
      for (const s of declared) {
        if (typeof s === 'string' || own.includes(s)) continue;
        const holdsTool = !s.tool || mine.has(s.tool);
        const holdsPermission = !s.permission || [].concat(s.permission).some((code) => role.permissions.includes(code));
        assert.equal(holdsTool && holdsPermission, false, `${where}: "${s.text}" is hidden although the role can ask it`);
      }
      if (!NO_TOOL_FOR_ROLE[entry.key]?.(role) && own.length < 2) thin.push(`${where} (${own.length})`);
    }
  }
  assert.ok(shownCount > 500, `only ${shownCount} starters checked`);
  assert.deepEqual(thin, [], 'a role sees fewer than two own starters on a page it opens');
  t.diagnostic(`${shownCount} starter × peran diperiksa untuk ${STANDARD_ROLES.length} peran standar`);
});

test('a starter is hidden from a user without its tool, and in the DTO the panel receives', () => {
  const entry = registry.TOOLS_BY_KEY.get('sales-orders');
  const member = { permissions: ['sales.order.view'] };
  assert.ok(registry.startersFor(entry, 'member', member).includes('Order mana yang belum terkirim penuh?'));
  assert.equal(registry.startersFor(entry, 'member', { permissions: [] }).includes('Order mana yang belum terkirim penuh?'), false);
  assert.equal(registry.startersFor(entry, 'member').includes('Order mana yang belum terkirim penuh?'), false, 'no user, no data starter');
  // "menunggu keputusan saya" needs the deciding permission as well as the tool.
  const approvals = registry.TOOLS_BY_KEY.get('approvals');
  const asked = 'Pengajuan apa saja yang menunggu keputusan saya?';
  assert.equal(registry.startersFor(approvals, 'supervisor', { permissions: ['approval.view'] }).includes(asked), false);
  assert.ok(registry.startersFor(approvals, 'supervisor', { permissions: ['approval.view', 'approval.decide'] }).includes(asked));
  const dto = registry.toolDto(entry, member, 'member');
  assert.ok(dto.starters.every((s) => typeof s === 'string'));
});
