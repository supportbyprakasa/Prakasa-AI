// The contract every Prakasa AI agent tool keeps (docs/prakasa-ai-rencana.md §9).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const agentTools = require('../src/services/ai/agent/agentTools');
const contract = require('../src/services/ai/agent/toolContract');
const { assertToolOutput } = require('../src/services/ai/agent/outputGuard');
const registry = require('../src/services/aiToolRegistry.service');

const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
const good = (over = {}) => ({
  name: 'daftar_uji',
  module: 'tasks',
  label: 'Membaca data uji',
  description: 'Daftar uji untuk pengguna ini, sesuai hak aksesnya. Tidak pernah harga atau data pribadi.',
  inputSchema: { type: 'object', properties: { cari: { type: 'string' } }, additionalProperties: false },
  permission: 'task.view',
  async run() { return {}; },
  ...over,
});
const errorsOf = (over) => contract.validateTool(good(over), { moduleKeys }).join(' | ');

test('every tool file is discovered, helpers starting with "_" are skipped, and all tools pass the contract', () => {
  const files = agentTools.toolFiles();
  assert.ok(files.includes('core.js') && files.includes('handbook.js') && files.includes('warehouse.js') && files.includes('procurement.js'));
  assert.ok(files.every((file) => !file.startsWith('_')));
  assert.ok(fs.existsSync(path.join(agentTools.TOOLS_DIR, '_shared.js')), 'the helper exists and is not a tool file');
  assert.deepEqual(contract.validateTools(agentTools.TOOLS, { moduleKeys }), []);
  const names = agentTools.TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'unique names');
  for (const name of ['profil_saya', 'notifikasi_saya', 'panduan_aplikasi', 'stok_barang', 'jadwal_kirim', 'gudang_hari_ini', 'status_po', 'procurement_hari_ini', 'rapor_pemasok']) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of agentTools.TOOLS) {
    assert.ok(tool.name.length <= contract.MAX_NAME, tool.name);
    assert.ok(files.includes(tool.file), tool.name);
    assert.ok(Object.isFrozen(tool), tool.name);
  }
});

test('the contract refuses each kind of broken tool', () => {
  assert.equal(errorsOf({}), '');
  assert.match(errorsOf({ name: 'DaftarUji' }), /snake_case/);
  assert.match(errorsOf({ name: `daftar_${'x'.repeat(40)}` }), /lebih dari 40/);
  for (const name of ['simpan_tugas', 'hapus_tugas', 'setujui_pengajuan', 'kirim_email', 'ubah_status', 'buat_tugas', 'tugas_buatkan', 'tugas_kirim']) {
    assert.match(errorsOf({ name }), /kata kerja tulis/, name);
  }
  assert.equal(errorsOf({ name: 'jadwal_kirim' }), '', 'the one reviewed noun exception');
  assert.match(errorsOf({ module: undefined }), /module wajib/);
  assert.match(errorsOf({ module: 'tidak-ada' }), /tidak ada di aiToolRegistry/);
  assert.equal(errorsOf({ module: ['tasks', 'general'] }), '');
  assert.match(errorsOf({ label: '' }), /label wajib/);
  assert.match(errorsOf({ description: 'Daftar uji untuk pengguna ini, sesuai hak aksesnya, lengkap.' }), /TIDAK dikembalikan/);
  assert.match(errorsOf({ inputSchema: { type: 'object', properties: {} } }), /additionalProperties/);
  assert.match(errorsOf({ inputSchema: { type: 'object', properties: {}, additionalProperties: true } }), /additionalProperties/);
  assert.match(errorsOf({ inputSchema: { type: 'array' } }), /harus "object"/);
  assert.match(errorsOf({ inputSchema: { type: 'object', properties: { x: {} }, additionalProperties: false } }), /butuh type/);
  assert.match(errorsOf({ inputSchema: { type: 'object', properties: {}, required: ['x'], additionalProperties: false } }), /required/);
  assert.match(errorsOf({ permission: null }), /public: true/);
  assert.equal(errorsOf({ permission: null, public: true }), '');
  assert.match(errorsOf({ public: true }), /tidak boleh/);
  assert.equal(errorsOf({ permission: ['task.view', 'task.update'] }), '');
  assert.match(errorsOf({ permission: ['Task View'] }), /kode izin/);
  assert.match(errorsOf({ money: true }), /privateOnly/);
  assert.match(errorsOf({ money: true, privateOnly: true, permission: null, public: true }), /mewajibkan permission/);
  assert.equal(errorsOf({ money: true, privateOnly: true, permission: 'finance.view' }), '');
  assert.match(errorsOf({ run: null }), /run\(user, input\) wajib/);
  assert.match(contract.validateTools([good(), good()], { moduleKeys }).join(' '), /dipakai dua kali/);
});

test('a tool without permission is explicitly public; a money tool is private and gated', () => {
  for (const tool of agentTools.TOOLS) {
    // A page tool reads no module data: no permission of its own, and never public (see the page-tool test below).
    if (!tool.client && (tool.permission === null || tool.permission === undefined)) assert.equal(tool.public, true, tool.name);
    if (tool.money) {
      assert.equal(tool.privateOnly, true, tool.name);
      assert.ok([].concat(tool.permission || []).length > 0, tool.name);
    }
    assert.match(tool.description, contract.NOT_RETURNED, `${tool.name} must say what it never returns`);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }
  // daftar_formulir lists the forms the user may fill (filtered by their permissions): no module data.
  assert.deepEqual(agentTools.TOOLS.filter((t) => t.public).map((t) => t.name).sort(), ['daftar_formulir', 'panduan_aplikasi', 'profil_saya']);
});

test('tools only read: no write verb in a name, no write SQL in run(), and only core/_shared touch the database', () => {
  for (const tool of agentTools.TOOLS) {
    const word = contract.writeWordIn(tool.name);
    assert.ok(!word || contract.READ_NAME_EXCEPTIONS[tool.name], tool.name);
    if (tool.client) { assert.equal(tool.impl, null, `${tool.name} has no server code`); continue; }
    assert.doesNotMatch(tool.impl.toString(), /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b/, `${tool.name} must not write`);
  }
  for (const file of fs.readdirSync(agentTools.TOOLS_DIR)) {
    const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, file), 'utf8');
    assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|REPLACE INTO)\b/i, file);
    assert.doesNotMatch(code, /sendMail|nodemailer|gmail\.users\.messages\.send|\.send\(/, `${file} must not send anything`);
    // Module tools go through their module's read service (which carries the
    // division scope); only the user's own profile/notifications/roles are read directly.
    if (!['core.js', '_shared.js'].includes(file)) assert.doesNotMatch(code, /db\/pool/, `${file} must not query the database itself`);
    assert.doesNotMatch(code, /accurate(Api|Client|Write)|simplidots/i, `${file} must not call Accurate or SimpliDOTS`);
  }
});

test('a tool re-checks its permission inside run(), whatever the caller did', async () => {
  for (const tool of agentTools.TOOLS.filter((t) => t.permission)) {
    await assert.rejects(tool.run({ sub: 1, entityId: 1, permissions: [] }, {}), (e) => e.status === 403 && e.code === 'FORBIDDEN', tool.name);
  }
});

test('the central size cap cuts every list and marks the result', () => {
  const big = Array.from({ length: contract.MAX_LIST_ITEMS + 25 }, (_, i) => ({ n: i }));
  const capped = contract.capResult({ total: big.length, baris: big, dalam: { lagi: big, kecil: [1, 2] } });
  assert.equal(capped.baris.length, contract.MAX_LIST_ITEMS);
  assert.equal(capped.terpotong, true);
  assert.equal(capped.dalam.lagi.length, contract.MAX_LIST_ITEMS);
  assert.equal(capped.dalam.terpotong, true);
  assert.deepEqual(capped.dalam.kecil, [1, 2]);
  assert.equal(capped.total, big.length);

  const small = { baris: [{ n: 1 }], waktu: new Date('2026-10-02T00:00:00Z') };
  const same = contract.capResult(small);
  assert.deepEqual(same, small);
  assert.equal('terpotong' in same, false);
  assert.ok(same.waktu instanceof Date);

  const top = contract.capResult(big);
  assert.equal(top.daftar.length, contract.MAX_LIST_ITEMS);
  assert.equal(top.terpotong, true);

  const longText = contract.capResult({ catatan: 'x'.repeat(contract.MAX_TEXT_CHARS + 10) });
  assert.equal(longText.catatan.length, contract.MAX_TEXT_CHARS + 1);
  assert.equal(longText.terpotong, true);
});

test('the cap and the output guard run on every tool call, not only in the tools that remember', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pw-ai-tools-'));
  const body = (extra) => `module.exports = [{ name: 'daftar_uji', module: 'tasks', label: 'Membaca uji',
    description: 'Daftar uji untuk pengguna ini sesuai hak aksesnya. Tidak pernah harga.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, permission: 'task.view', ${extra} }];`;
  try {
    fs.writeFileSync(path.join(dir, 'uji.js'), body('async run() { return { baris: Array.from({ length: 150 }, (_, i) => i) }; }'));
    fs.writeFileSync(path.join(dir, '_abaikan.js'), 'throw new Error("helper files are never loaded as tools");');
    const [tool] = agentTools.loadTools(dir);
    const out = await tool.run({ permissions: ['task.view'] }, {});
    assert.equal(out.baris.length, contract.MAX_LIST_ITEMS);
    assert.equal(out.terpotong, true);

    fs.writeFileSync(path.join(dir, 'uang.js'), body('async run() { return { total_nilai: 5 }; }').replace('daftar_uji', 'uang_uji'));
    const money = agentTools.loadTools(dir).find((t) => t.name === 'uang_uji');
    await assert.rejects(money.run({ permissions: ['task.view'] }, {}), (e) => e.code === 'AI_OUTPUT_BLOCKED');

    fs.writeFileSync(path.join(dir, 'rusak.js'), body('async run() { return {}; }').replace('daftar_uji', 'hapus_uji'));
    assert.throws(() => agentTools.loadTools(dir), /melanggar kontrak[\s\S]*kata kerja tulis/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('personal data keys never leave a tool; rupiah keys only from a money tool', () => {
  for (const key of ['nik', 'npwp', 'no_ktp', 'bpjs_kesehatan', 'gaji_pokok', 'rekening', 'nama_bank', 'kata_sandi', 'token']) {
    assert.throws(() => assertToolOutput({ orang: [{ [key]: 'x' }] }, { money: true }), (e) => e.code === 'AI_OUTPUT_BLOCKED', key);
  }
  for (const key of ['harga', 'total_nilai', 'dpp', 'omzet_bulan_ini', 'nominal', 'margin_persen', 'piutang']) {
    assert.throws(() => assertToolOutput({ [key]: 1 }), (e) => e.code === 'AI_OUTPUT_BLOCKED', key);
    assert.doesNotThrow(() => assertToolOutput({ [key]: 1 }, { money: true }), key);
  }
  assert.doesNotThrow(() => assertToolOutput({ nama: 'x', teknik: 1, bankir: 2, jumlah: 3, status: 'ok', unik: 1 }));
});

test('page tools (client: true): three of them, no run(), private, no button — and the contract refuses anything else', async () => {
  const page = agentTools.TOOLS.filter((t) => t.client);
  assert.deepEqual(page.map((t) => [t.name, t.clientOp, [...t.surfaces]]), [
    ['buka_halaman', 'navigate', ['panel', 'full']],
    ['baca_formulir', 'readForms', ['panel']],
    ['isi_form', 'fillForm', ['panel']],
  ]);
  assert.deepEqual(agentTools.CLIENT_TOOLS, ['buka_halaman', 'baca_formulir', 'isi_form']);
  // Everything a browser can be asked to do. Nothing saves, submits, approves, deletes or sends.
  assert.deepEqual(contract.CLIENT_OPS, ['navigate', 'readForms', 'fillForm']);
  for (const tool of page) {
    assert.equal(tool.privateOnly, true, tool.name);
    assert.equal(tool.permission, null, tool.name);
    assert.notEqual(tool.public, true, tool.name);
    assert.notEqual(tool.money, true, tool.name);
    assert.equal(tool.impl, null);
    assert.equal(contract.writeWordIn(tool.name), null, tool.name);
    assert.doesNotMatch(tool.name, /simpan|hapus|setujui|kirim|ubah|buat|tekan|klik|submit/);
    assert.equal(tool.run, undefined, 'a page tool never runs on the server');
    assert.match(tool.description, /Tidak pernah/);
  }

  const client = (over = {}) => {
    const base = good({ name: 'baca_uji', client: true, clientOp: 'readForms', surfaces: ['panel'], permission: null, privateOnly: true, ...over });
    if (!('run' in over)) delete base.run;
    return contract.validateTool(base, { moduleKeys }).join(' | ');
  };
  assert.equal(client(), '');
  assert.match(client({ clientOp: 'pressButton' }), /clientOp harus salah satu/);
  assert.match(client({ clientOp: 'submit' }), /clientOp harus salah satu/);
  assert.match(client({ run: async () => ({}) }), /tidak punya run/);
  assert.match(client({ privateOnly: false }), /privateOnly: true/);
  assert.match(client({ permission: 'task.view' }), /tidak memakai izin data/);
  assert.match(client({ public: true }), /tidak memakai izin data/);
  assert.match(client({ money: true }), /tidak boleh money/);
  assert.match(client({ surfaces: [] }), /surfaces wajib/);
  assert.match(client({ surfaces: ['web'] }), /surfaces wajib/);
  for (const name of ['simpan_form', 'kirim_form', 'setujui_form', 'hapus_form', 'ubah_form', 'buat_tiket']) {
    assert.match(client({ name }), /kata kerja tulis/, name);
  }
  // A data tool cannot borrow the page-tool fields.
  assert.match(errorsOf({ clientOp: 'navigate' }), /hanya untuk alat halaman/);
});
