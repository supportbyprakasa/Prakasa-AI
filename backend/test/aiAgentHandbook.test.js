// panduan_aplikasi: "bagaimana cara …" answered from the in-app handbook, cut
// to the asking user's role exactly like the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pool = require('../src/db/pool');
const handbook = require('../src/services/handbookAccess');
const agentTools = require('../src/services/ai/agent/agentTools');
const agentRun = require('../src/services/ai/agent/agentRun');
const { STANDARD_ROLES, SYSTEM_ADMIN_PERMISSIONS } = require('../src/config/standardOrganization');

const tool = agentTools.byName.get('panduan_aplikasi');
const role = (key) => STANDARD_ROLES.find((entry) => entry.key === key);
const reader = (key) => ({ permissions: role(key).permissions, roles: [{ roleKey: key, roleLevel: role(key).level, name: role(key).name }] });

// The tool reads the user's roles from the database; here they come from the standard organisation.
function asRole(t, key) {
  const r = key === 'system.admin'
    ? { key, level: null, name: 'Administrator Sistem', permissions: SYSTEM_ADMIN_PERMISSIONS }
    : role(key);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push(String(sql));
    assert.match(String(sql).trim(), /^SELECT/i);
    assert.deepEqual(args, [77], 'only the asking user\'s own roles are read');
    return [[{ id: 1, name: r.name, role_key: r.key, role_level: r.level, department_id: 3 }]];
  });
  return { user: { sub: 77, entityId: 1, permissions: r.permissions }, calls };
}

const anchors = (out) => out.bagian.map((b) => b.baca_di_panduan.replace('/panduan#', ''));

test('handbook.generated.json matches the handbook source (run: cd frontend && node scripts/build-handbook-json.mjs)', async () => {
  const source = path.join(__dirname, '../../frontend/src/pages/handbook/handbookContent.js');
  const content = (await import(pathToFileURL(source).href)).default;
  const hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  assert.equal(handbook.HANDBOOK.sourceHash, hash, 'handbook.generated.json is stale: cd frontend && node scripts/build-handbook-json.mjs');
  assert.equal(handbook.HANDBOOK.chapters.length, content.length);
  const routes = content.flatMap((c) => [c.route, ...c.sections.map((s) => s.route)]).filter(Boolean).map((r) => r.split(/[?#]/)[0]);
  for (const route of routes) assert.ok(handbook.HANDBOOK.routeAccess[route], `routeAccess lacks ${route}`);
});

test('"Bagaimana cara mengajukan pembayaran?" returns the payment request section with steps and the menu to open', async (t) => {
  const { user } = asRole(t, 'sales.member');
  const out = await tool.run(user, { pertanyaan: 'Bagaimana cara mengajukan pembayaran?' });
  assert.equal(out.ditemukan, true);
  const first = out.bagian[0];
  assert.match(first.judul_bagian, /pembayaran/i);
  assert.ok(first.judul_bab && first.bab);
  assert.ok(first.isi.some((block) => block.jenis === 'langkah' && block.butir.length > 1), 'numbered steps');
  assert.equal(first.rute, '/finance/payment-requests');
  assert.equal(first.buka, 'Buka menu "Pengajuan pembayaran"');
  assert.match(first.baca_di_panduan, /^\/panduan#/);
  assert.ok(out.bagian.length <= 3);
  assert.ok(JSON.stringify(out).length < 20000, 'bounded');
});

test('the tool never returns a section the user cannot see on the page', async (t) => {
  for (const key of ['sales.member', 'warehouse.member', 'finance.supervisor', 'people_culture.head', 'system.admin']) {
    const { user } = asRole(t, key);
    const visible = new Set(handbook.visibleChapters({ permissions: user.permissions, roles: [{ roleKey: key, roleLevel: role(key)?.level }] })
      .flatMap((chapter) => chapter.sections.map((section) => `${chapter.id}-${section.id}`)));
    for (const pertanyaan of ['mengatur peran dan izin pengguna', 'menyetujui pergerakan barang', 'piutang jatuh tempo', 'matriks approval', 'target realisasi divisi', 'stok menipis']) {
      const out = await tool.run(user, { pertanyaan, jumlah: 5 });
      if (out.ditemukan) for (const anchor of anchors(out)) assert.ok(visible.has(anchor), `${key} got ${anchor} for "${pertanyaan}"`);
      else for (const entry of out.bab_tersedia) assert.ok([...visible].some((a) => a.startsWith(`${entry.bab}-`)), `${key} listed ${entry.bab}`);
    }
    t.mock.restoreAll();
  }
});

test('a member does not read Supervisor/Head sections or administration chapters; an administrator does', async (t) => {
  const member = asRole(t, 'sales.member');
  const forMember = await tool.run(member.user, { pertanyaan: 'membuat pengguna baru dan memberi peran', jumlah: 5 });
  const memberChapters = forMember.ditemukan ? forMember.bagian.map((b) => b.bab) : [];
  assert.equal(memberChapters.some((id) => id.startsWith('admin-')), false);
  const refused = await tool.run(member.user, { pertanyaan: 'pengguna', bab: 'admin-pengguna' });
  assert.equal(refused.ditemukan, false);
  assert.equal(refused.bab_tersedia.some((entry) => entry.bab.startsWith('admin-')), false);
  t.mock.restoreAll();

  const admin = asRole(t, 'system.admin');
  const forAdmin = await tool.run(admin.user, { pertanyaan: 'pengguna', bab: 'admin-pengguna' });
  assert.equal(forAdmin.ditemukan, true);
  assert.ok(forAdmin.bagian.every((b) => b.bab === 'admin-pengguna'));
  const noDivision = await tool.run(admin.user, { pertanyaan: 'stok', bab: 'warehouse' });
  assert.equal(noDivision.ditemukan, false, 'Administrator Sistem reads only general and administration chapters');
});

test('the role filter follows the page rules: levels, division roles, route access, super admin', () => {
  const ids = (user) => handbook.visibleChapters(user).map((chapter) => chapter.id);
  const member = ids(reader('sales.member'));
  assert.ok(member.includes('mulai') && member.includes('sales'));
  assert.equal(member.includes('warehouse'), false);
  assert.equal(member.some((id) => id.startsWith('admin-')), false);
  const all = ids({ permissions: [], roles: [{ roleKey: 'system.super_admin' }] });
  assert.equal(all.length, handbook.HANDBOOK.chapters.length);
  assert.deepEqual(ids(null), []);
  assert.equal(handbook.routeAllows('/rute-yang-tidak-dikenal', reader('sales.head')), false, 'unknown route fails closed');
  assert.equal(handbook.roleLevel(reader('sales.head')), 'head');
  assert.equal(handbook.stem('mengajukan'), handbook.stem('pengajuan'));
  assert.equal(handbook.stem('menyetujui'), 'setuju');
});

test('no question words, no match and bad input are answered plainly, without throwing', async (t) => {
  const { user } = asRole(t, 'sales.member');
  const none = await tool.run(user, { pertanyaan: 'zzqxv kkjw' });
  assert.equal(none.ditemukan, false);
  assert.ok(none.bab_tersedia.length > 3);
  const empty = await tool.run(user, {});
  assert.equal(empty.ditemukan, false);
  assert.equal((await tool.run(user, 'bukan objek')).ditemukan, false);
});

test('panduan_aplikasi is public, usable in shared chats, and offered to every user', () => {
  assert.equal(tool.public, true);
  assert.equal(Boolean(tool.privateOnly), false);
  assert.ok(agentTools.toolsFor({ permissions: [] }, { visibility: 'department', web_research: 1 }).some((x) => x.name === 'panduan_aplikasi'));
  assert.deepEqual(tool.inputSchema.required, ['pertanyaan']);
});

test('the answer language follows the account language, Indonesian by default', async (t) => {
  assert.match(agentRun.languageRule('id'), /Jawab dalam bahasa Indonesia/);
  assert.match(agentRun.languageRule('en'), /Answer in English/);
  assert.match(agentRun.languageRule('en'), /exactly as stored/);
  assert.equal(agentRun.languageRule('fr'), agentRun.languageRule('id'));
  assert.equal(agentRun.languageRule(null), agentRun.languageRule('id'));

  let row = { language: 'en' };
  t.mock.method(pool, 'query', async (sql, args) => {
    assert.match(sql, /SELECT language FROM users WHERE id = \?/);
    assert.deepEqual(args, [15]);
    return [[row]];
  });
  assert.equal(await agentRun.userLanguage(15), 'en');
  row = { language: null };
  assert.equal(await agentRun.userLanguage(15), 'id');
  row = undefined;
  assert.equal(await agentRun.userLanguage(15), 'id');
  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => { throw new Error('Unknown column language'); });
  assert.equal(await agentRun.userLanguage(15), 'id', 'a missing column never fails an answer');
});

test('the system prompt carries the language rule and the handbook rule when the agent runs', () => {
  const code = require('node:fs').readFileSync(path.join(__dirname, '../src/services/ai/provider.js'), 'utf8');
  assert.match(code, /ctx\.language \? languageRule\(ctx\.language\) : null/);
  const service = require('node:fs').readFileSync(path.join(__dirname, '../src/services/aiCommand.service.js'), 'utf8');
  assert.match(service, /const language = await agentRun\.userLanguage\(user\.sub\);/);
  assert.match(agentRun.AGENT_RULES, /Panduan aplikasi/);
  assert.match(agentRun.AGENT_RULES, /gaji, rekening bank, NIK, NPWP, BPJS/);
});
