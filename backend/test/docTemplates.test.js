const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const { Document, Header, Packer, Paragraph, TextRun } = require('docx');
const { pool, dbReady, inRolledBackTransaction, makeUser, makeLocation, departmentId } = require('./fixtures/gaDb');
const kit = require('../src/services/docxKit');
const docs = require('../src/services/docTemplates.service');
const bast = require('../src/services/bast.service');
const drive = require('../src/services/googleDrive.service');
const googleDocs = require('../src/services/googleDocs.service');
const { schemas } = require('../src/routes/docTemplates.routes');
const { BUILTIN_TEMPLATES } = require('../src/config/docTemplates');

// Template dokumen, kop & footer per divisi, BAST (migration 115). Google is
// never called: Drive and Docs are replaced by fakes that record the calls.

test.after(() => pool.end());

function png(w, h) {
  const table = [];
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (b) => { let x = 0xffffffff; for (const v of b) x = table[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))]);
}
const KOP = { layout: 'logo_left', companyName: 'PT Prakasa Foods Nusantara', headerLines: 'Jl. Contoh 1\nTelp 021', footerText: 'Rahasia perusahaan', showPageNumber: true, accentColor: '#1A73E8', logo: png(300, 120), scopeLabel: 'People & Culture' };

test('placeholders: {{key}} and {{ key }}, lower case, unique, in order', () => {
  assert.deepEqual(kit.placeholdersIn('Halo {{Nama}}, {{ jumlah }} dan {{nama}} {{x-y}} {{9a}}'), ['nama', 'jumlah']);
  assert.deepEqual(kit.imageSize(png(10, 4)), { width: 10, height: 4, type: 'png' });
});

test('the kop replaces a template\'s own header/footer on every page; images and page numbers travel', async () => {
  // A template that already has its own header and a different first page.
  const tpl = await Packer.toBuffer(new Document({ sections: [{ properties: { titlePage: true }, headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun('Header lama')] })] }) }, children: [new Paragraph({ children: [new TextRun('Isi {{nama_') , new TextRun('penerima}}')] })] }] }));
  const merged = await kit.mergeKop(tpl, await kit.buildKopDocx(KOP));
  const zip = await JSZip.loadAsync(merged);
  const xml = await zip.file('word/document.xml').async('string');
  const sect = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g).pop();
  assert.match(sect, /^<w:sectPr[^>]*><w:headerReference w:type="default" r:id="rIdKopHeader"\/><w:footerReference w:type="default" r:id="rIdKopFooter"\/>/);
  assert.doesNotMatch(sect, /titlePg/, 'no different first page: the kop is on page 1 too');
  assert.equal((sect.match(/headerReference/g) || []).length, 1);
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.equal((rels.match(/relationships\/header"/g) || []).length, 1, 'the old header relationship is gone');
  const types = await zip.file('[Content_Types].xml').async('string');
  assert.equal((types.match(/Extension="png"/gi) || []).length, 1, 'one content type per extension');
  assert.match(await zip.file('word/kopHeader.xml').async('string'), /<w:drawing/);
  assert.match(await zip.file('word/kopFooter.xml').async('string'), /NUMPAGES/);
  assert.ok(Object.keys(zip.files).some((f) => /^word\/media\/kopHeader_/.test(f)));
  assert.deepEqual(await docs.placeholdersOfDocx(merged), ['nama_penerima'], 'a placeholder split over runs is still found');
});

test('every built-in BAST template carries the IT/GA staff, the employee and the acknowledger', async () => {
  for (const b of BUILTIN_TEMPLATES) {
    const keys = await docs.placeholdersOfDocx(await kit.buildTemplateDocx({ title: b.name, blocks: b.blocks }));
    for (const k of ['nomor_dokumen', 'tanggal', 'perusahaan', 'petugas_nama', 'petugas_tim', 'karyawan_nama', 'mengetahui_nama', 'kondisi']) assert.ok(keys.includes(k), `${b.key} lacks ${k}`);
    assert.ok(keys.includes(b.subjectType === 'it_phone_line' ? 'nomor_hp' : 'nomor_seri'), b.key);
  }
});

test('who manages: own division with template.manage; the whole company needs Management Office or cross-division', () => {
  const head = { departmentId: 5, permissions: ['template.manage'] };
  assert.equal(docs.canManageScope(head, 5), true);
  assert.equal(docs.canManageScope(head, 6), false);
  assert.equal(docs.canManageScope(head, null), false);
  assert.equal(docs.canManageScope({ ...head, permissions: ['template.manage', 'management_dashboard.view'] }, null), true);
  assert.equal(docs.canManageScope({ departmentId: 5, permissions: ['template.view'] }, 5), false);
  assert.equal(docs.driveFileIdOf('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123/edit'), '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123');
  assert.equal(docs.driveFileIdOf('bukan tautan'), null);
  assert.equal(docs.longDate('2026-10-01'), '1 Oktober 2026');
});

test('route bodies are strict', () => {
  assert.equal(schemas.generateBody.safeParse({ values: { nama: 'A' }, entityId: 2 }).success, false);
  assert.equal(schemas.generateBody.safeParse({ values: { 'Bad Key': 'A' } }).success, false);
  assert.equal(schemas.kopBody.safeParse({ layout: 'logo_left', companyName: 'PT', showPageNumber: true, accentColor: 'blue' }).success, false);
  assert.equal(schemas.createBody.safeParse({ name: 'Surat tugas', source: 'blank', prefix: 'ST' }).success, true);
});

// Fakes for Drive and Docs that record what the app asked Google to do.
function fakeGoogle(t, { templateDocx, kopDocx } = {}) {
  const calls = [];
  let n = 0;
  t.mock.method(drive, 'ensureFolder', async ({ name }) => { calls.push(['ensureFolder', name]); return { id: `folder-${name}` }; });
  t.mock.method(drive, 'importDocx', async ({ name, buffer, parentId }) => { n += 1; calls.push(['importDocx', name, parentId, buffer]); return { id: `doc-${n}xxxxxxxxxxxxxxxxxxxxx`, webViewLink: `https://docs.google.com/document/d/doc-${n}/edit` }; });
  t.mock.method(drive, 'replaceDocContent', async ({ fileId }) => { calls.push(['replaceDocContent', fileId]); return { id: fileId }; });
  t.mock.method(drive, 'exportDocx', async (fileId) => { calls.push(['exportDocx', fileId]); return /kop/.test(fileId) ? kopDocx : templateDocx; });
  t.mock.method(googleDocs, 'replacePlaceholders', async (fileId, values) => { calls.push(['replacePlaceholders', fileId, values]); return 1; });
  return calls;
}

const SKIP = 'no database with migration 115';
const ready = async () => (await dbReady()) && (await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'generated_documents'"))[0][0].n > 0;

async function asUser(conn, id, permissions) {
  const [[u]] = await conn.query('SELECT id, entity_id, department_id FROM users WHERE id = ?', [id]);
  return { sub: Number(u.id), entityId: Number(u.entity_id), departmentId: Number(u.department_id), permissions };
}

test('db: a device BAST — kop of the division, People & Culture folder, IT staff and the GA PIC who acknowledges, linked to the assignment', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  process.env.GOOGLE_SHARED_DRIVE_ID = process.env.GOOGLE_SHARED_DRIVE_ID || 'shared-drive-test';
  await inRolledBackTransaction(t, async (conn) => {
    const builtin = BUILTIN_TEMPLATES.find((b) => b.key === 'bast_device_handover');
    const templateDocx = await kit.buildTemplateDocx({ title: builtin.name, blocks: builtin.blocks });
    const calls = fakeGoogle(t, { templateDocx, kopDocx: await kit.buildKopDocx(KOP) });
    const pc = await departmentId(conn, 'people_culture');
    const itStaff = await makeUser(conn, { name: 'Staf IT', division: 'people_culture', roles: ['people_culture.head'] });
    const gaPic = await makeUser(conn, { name: 'PIC GA', division: 'people_culture', roles: ['people_culture.member'] });
    const holder = await makeUser(conn, { name: 'Karyawan Sales', division: 'sales', roles: ['sales.member'] });
    const loc = await makeLocation(conn);
    const head = await asUser(conn, itStaff.id, ['template.manage', 'template.view', 'document.create', 'device.handover.manage']);

    // The built-in templates are made once (no Google template exists yet in this transaction).
    await conn.query("UPDATE document_templates SET template_key = CONCAT(template_key, '-old') WHERE entity_id = 1 AND template_key LIKE 'bast_%'");
    const prepared = await docs.prepareBuiltins(head);
    assert.equal(prepared.made.length, 4);
    assert.ok(calls.some((c) => c[0] === 'ensureFolder' && c[1] === 'Template dokumen'));

    // The kop of People & Culture.
    await conn.query("DELETE FROM doc_kops WHERE entity_id = 1 AND department_id = ?", [pc]);
    const kop = await docs.saveKop(head, pc, { layout: 'logo_left', companyName: 'PT Prakasa Foods Nusantara', headerLines: 'Jl. Contoh 1', footerText: 'Internal', showPageNumber: true, accentColor: '#1A73E8', logoBase64: png(200, 80).toString('base64') });
    assert.equal(kop.hasLogo, true);
    await conn.query("UPDATE doc_kops SET drive_file_id = 'kop-file-xxxxxxxxxxxxxxxxxxxx' WHERE id = ?", [kop.id]);
    await assert.rejects(docs.saveKop({ ...head, departmentId: 999 }, pc, { layout: 'centered', companyName: 'X', showPageNumber: false, accentColor: '#000000' }), (e) => e.code === 'FORBIDDEN');

    // PIC setting: GA's PIC acknowledges a BAST made by IT.
    await conn.query("INSERT INTO settings (entity_id, `key`, value) VALUES (1, 'people_culture.pic', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify({ itUserId: itStaff.id, gaUserId: gaPic.id })]);
    const [dev] = await conn.query("INSERT INTO devices (entity_id, department_id, asset_code, device_type, brand, model, serial_number, ram_gb, storage_gb, status, location_id) VALUES (1, ?, 'LAP/UJI/01', 'laptop', 'Lenovo', 'ThinkPad E14', 'SN-UJI-1', 16, 512, 'assigned', ?)", [pc, loc]);
    const [asg] = await conn.query("INSERT INTO device_assignments (entity_id, department_id, device_id, assigned_to, assigned_by, assigned_at, status) VALUES (1, ?, ?, ?, ?, UTC_TIMESTAMP(), 'active')", [pc, dev.insertId, holder.id, itStaff.id]);

    calls.length = 0;
    const doc = await bast.makeDeviceBast(head, asg.insertId, { kind: 'handover', team: 'it', accessories: 'Charger, tas', condition: 'Baik', notes: '' });
    assert.match(doc.number, /^BAST-\d{6}-\d{4}$/);
    assert.equal(doc.departmentId, pc);
    assert.equal(doc.withKop, true);
    assert.deepEqual(calls.filter((c) => c[0] === 'exportDocx').map((c) => c[1]).sort().slice(-1), ['kop-file-xxxxxxxxxxxxxxxxxxxx'], 'the kop is exported to be joined');
    const imported = calls.find((c) => c[0] === 'importDocx');
    const [[rule]] = await conn.query("SELECT drive_folder_id FROM folder_mapping_rules WHERE entity_id = 1 AND department_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY (document_type = 'bast') DESC, priority LIMIT 1", [pc]);
    assert.equal(imported[2], rule ? rule.drive_folder_id : 'folder-Dokumen People & Culture', 'into People & Culture\'s Shared Drive folder');
    const filled = calls.find((c) => c[0] === 'replacePlaceholders')[2];
    assert.equal(filled.nomor_dokumen, doc.number);
    assert.equal(filled.petugas_tim, 'IT');
    assert.equal(filled.mengetahui_nama, '[UJI] PIC GA');
    assert.equal(filled.karyawan_nama, '[UJI] Karyawan Sales');
    assert.equal(filled.merek_model, 'Lenovo ThinkPad E14');
    assert.equal(filled.spesifikasi, 'RAM 16 GB, Penyimpanan 512 GB');
    assert.equal(filled.catatan, '-');
    const [[link]] = await conn.query('SELECT handover_document_id FROM device_assignments WHERE id = ?', [asg.insertId]);
    assert.ok(link.handover_document_id);
    const listed = await docs.listGenerated(conn, head, { subjectType: 'device_assignment', subjectIds: [asg.insertId] });
    assert.equal(listed[0].number, doc.number);

    // Another division never sees People & Culture's documents.
    const other = { sub: holder.id, entityId: 1, departmentId: holder.user.departmentId, permissions: ['document.view'] };
    assert.equal((await docs.listGenerated(conn, other, { subjectType: 'device_assignment', subjectIds: [asg.insertId] })).length, 0);
  });
});
