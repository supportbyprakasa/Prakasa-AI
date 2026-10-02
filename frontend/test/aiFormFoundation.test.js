import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFormRegistry, describeForm, dynamicFieldFillable, fieldClass, fillForm, moneyLike, permissionList, recordOf, syncForm,
} from '../src/components/ai/aiFormModel.js';
import { bindAIForm, defineAIForm, f } from '../src/components/ai/aiFormFields.js';
import { escalationRecordId, findEscalation } from '../src/pages/advanced/escalationsModel.js';
import { targetRecordId } from '../src/pages/advanced/targetsModel.js';

// Wave C2 merge (docs/prakasa-ai-rencana.md §9.12): the foundation the module
// forms rely on — name classes for personal data and infrastructure
// identifiers, field names that come from data, any-of permissions, `ready`,
// and the longer record id. The server keeps the same rules
// (backend/test/aiClientTools.test.js, aiFormsFoundation.test.js).

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

function formWith(fields, values) {
  const registry = createFormRegistry();
  const state = { values: { ...values } };
  registry.register('f', () => ({
    title: 'Uji', permission: 'x.create', initialValues: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'boolean' ? value : ''])), fields,
    getValues: () => state.values, setValues: (patch) => { state.values = { ...state.values, ...patch }; },
  }));
  const entry = registry.get('f');
  syncForm(entry, registry);
  return { entry, registry, state };
}

test('personal data and infrastructure identifiers are never fillable and never read — whatever the page says', () => {
  const names = {
    personal: ['nik', 'noKtp', 'npwp', 'bpjsKesehatan', 'gaji', 'salary', 'tanggalLahir', 'birthDate', 'alamatRumah', 'homeAddress', 'teleponPribadi', 'personalPhone'],
    infra: ['ipAddress', 'imei', 'macAddress', 'serialNumber', 'nomorSeri', 'licenseKey', 'kunciLisensi', 'portalUrl', 'ssid', 'wifiName', 'customerNumber', 'noPelanggan'],
  };
  for (const [kind, list] of Object.entries(names)) for (const name of list) assert.equal(fieldClass(name), kind, name);
  // By word, never by substring.
  for (const name of ['description', 'recipient', 'tipe', 'machine', 'teknik', 'unik', 'equipment', 'principal', 'customerName', 'address', 'phone', 'publicIpDedicated']) assert.equal(fieldClass(name), 'open', name);
  assert.equal(fieldClass('wifiPassword'), 'secret', 'a secret wins: it is not even listed');

  const all = [...names.personal, ...names.infra];
  const fields = [
    { name: 'title', label: 'Judul', type: 'text' },
    // A careless page: fillable, and read-only with a value.
    ...all.map((name) => ({ name, label: name, type: 'text', aiFillable: true })),
    { name: 'serial_number', label: 'Nomor seri', type: 'text', readOnly: true },
    { name: 'publicIpDedicated', label: 'IP publik dedicated', type: 'checkbox' },
    { name: 'devices', label: 'Perangkat', type: 'rows', columns: [{ name: 'model', label: 'Model', type: 'text' }, { name: 'imei', label: 'IMEI', type: 'text' }, { name: 'ipAddress', label: 'IP', type: 'text' }] },
  ];
  const values = { title: '', ...Object.fromEntries(all.map((name) => [name, `RAHASIA-${name}`])), serial_number: 'SN-RAHASIA', publicIpDedicated: false, devices: [{ model: 'A', imei: 'IMEI-RAHASIA', ipAddress: '10.0.0.1' }] };
  const { entry, registry, state } = formWith(fields, values);

  const described = describeForm(entry);
  const byName = Object.fromEntries(described.kolom.map((k) => [k.nama, k]));
  for (const name of [...all, 'serial_number']) {
    assert.equal(byName[name].bisa_diisi, false, name);
    assert.equal('isi' in byName[name], false, `${name}: its value is never read`);
    assert.equal('hanya_baca' in byName[name], false, `${name}: not even as a read-only value`);
  }
  assert.equal(byName.publicIpDedicated.bisa_diisi, true, 'a reviewed yes/no, not an address');
  assert.deepEqual(byName.devices.kolom_baris.map((c) => [c.nama, c.bisa_diisi]), [['model', true], ['imei', false], ['ipAddress', false]]);
  assert.deepEqual(byName.devices.baris, [{ no: 1, isi: { model: 'A' }, diisi_pengguna: true }]);
  assert.doesNotMatch(JSON.stringify(described), /RAHASIA|10\.0\.0\.1/);

  const result = fillForm(entry, [
    { kolom: 'title', isi: 'Laptop baru' }, ...all.map((name) => ({ kolom: name, isi: 'x' })), { kolom: 'serial_number', isi: 'x' }, { kolom: 'publicIpDedicated', isi: 'ya' },
    { kolom: 'devices', baris: [{ model: 'B', imei: '123', ipAddress: '10.0.0.2' }], cara: 'tambah' },
  ], { registry });
  assert.deepEqual(result.diisi, ['title', 'publicIpDedicated', 'devices']);
  for (const name of [...all, 'serial_number', 'devices[1].imei', 'devices[1].ipAddress']) {
    assert.equal(result.ditolak.find((item) => item.nama === name)?.alasan, 'Kolom ini hanya diisi pengguna.', name);
  }
  for (const name of all) assert.equal(state.values[name], `RAHASIA-${name}`, `${name} untouched`);
  assert.deepEqual(state.values.devices.at(-1), { model: 'B' });
});

test('fields named by data (a template\'s placeholders): only open text and date names are the AI\'s; the rest is listed as user-only or left out', () => {
  assert.equal(moneyLike('nilai_kontrak'), true);
  assert.equal(moneyLike('usageAmount'), false, 'kWh / m³: a reviewed exception');
  assert.equal(dynamicFieldFillable('nama_pihak'), true);
  for (const name of ['nik', 'alamat_rumah', 'no_hp', 'telepon', 'nomor_rekening', 'nilai_kontrak', 'serial_number', 'kata_sandi', 'nama pihak', '9lives', '', 'a.b']) assert.equal(dynamicFieldFillable(name), false, name);
  assert.equal(dynamicFieldFillable('perihal', 'select'), false);

  const fields = f.dynamic([
    { name: 'nama_pihak', label: 'Nama pihak' },
    { name: 'perihal', label: 'Perihal', type: 'textarea' },
    { name: 'tanggal_mulai', label: 'Tanggal mulai', type: 'date' },
    { name: 'nik', label: 'NIK' },
    { name: 'alamat_rumah', label: 'Alamat rumah', type: 'textarea' },
    { name: 'no_hp', label: 'No hp' },
    { name: 'nilai_kontrak', label: 'Nilai kontrak' },
    { name: 'jenis', label: 'Jenis', type: 'select' },
    { name: 'nama pihak kedua', label: 'tidak bisa didaftarkan' },
    null,
  ]);
  assert.deepEqual(fields.map((field) => [field.name, field.type, field.aiFillable !== false]), [
    ['nama_pihak', 'text', true], ['perihal', 'textarea', true], ['tanggal_mulai', 'date', true],
    ['nik', 'text', false], ['alamat_rumah', 'textarea', false], ['no_hp', 'text', false], ['nilai_kontrak', 'text', false], ['jenis', 'text', false],
  ]);
  assert.deepEqual(f.dynamic(undefined), []);

  const { entry, registry, state } = formWith([{ name: 'docTitle', label: 'Judul dokumen', type: 'text' }, ...fields], {
    docTitle: '', nama_pihak: '', perihal: '', tanggal_mulai: '', nik: '3174000000000001', alamat_rumah: 'Jl. Contoh 1', no_hp: '', nilai_kontrak: '', jenis: '',
  });
  const described = describeForm(entry);
  assert.deepEqual(described.kolom.filter((k) => k.bisa_diisi).map((k) => k.nama), ['docTitle', 'nama_pihak', 'perihal', 'tanggal_mulai']);
  assert.doesNotMatch(JSON.stringify(described), /3174000000000001|Jl\. Contoh/);
  const result = fillForm(entry, [{ kolom: 'nama_pihak', isi: 'PT Contoh' }, { kolom: 'tanggal_mulai', isi: '5 Oktober 2026' }, { kolom: 'nik', isi: '1' }, { kolom: 'no_hp', isi: '0812' }, { kolom: 'nilai_kontrak', isi: '1' }], { registry });
  assert.deepEqual(result.diisi, ['nama_pihak', 'tanggal_mulai']);
  assert.deepEqual(result.ditolak.map((item) => item.nama), ['nik', 'no_hp', 'nilai_kontrak']);
  assert.deepEqual([state.values.nama_pihak, state.values.tanggal_mulai, state.values.nik], ['PT Contoh', '2026-10-05', '3174000000000001']);

  // "Buat dokumen dari template" registers that way, with the title in its own state.
  const page = read('pages/documents/DocTemplateDialogs.jsx');
  assert.match(page, /id: 'doc-generate'/);
  assert.match(page, /\.\.\.f\.dynamic\(placeholders\.map\(/);
  assert.match(page, /permission: 'document\.create'/);
  assert.match(page, /setters: \{ docTitle: setTitle \}/);
  assert.match(read('pages/documents/DocTemplates.jsx'), /useOpenFromUrl\('buat'/);
});

test('defineAIForm: a permission may be a list (any of) or depend on the context; `ready` holds the registration until the lookups are there', () => {
  const base = { id: 'x-form', title: 'X', fields: [f.text('name', 'Nama')] };
  assert.deepEqual([...defineAIForm({ ...base, permission: ['x.manage', 'y.manage'] }).permission], ['x.manage', 'y.manage']);
  for (const permission of [[], ['x.manage', 'bukan izin'], ['a.b', 'c.d', 'e.f', 'g.h', 'i.j'], '', undefined, 'simpan']) {
    assert.throws(() => defineAIForm({ ...base, permission }), /permission wajib/, JSON.stringify(permission));
  }
  assert.deepEqual(permissionList(['x.manage', 'y.manage']), ['x.manage', 'y.manage']);
  assert.deepEqual(permissionList('x.manage'), ['x.manage']);
  assert.deepEqual(permissionList(['x.manage', 'nope']), []);

  const byKind = defineAIForm({ ...base, id: ({ kind }) => `x-${kind}`, permission: ({ kind } = {}) => (kind === 'vendor' ? ['it.infra.manage', 'software_vendor.manage'] : 'it.infra.manage') });
  assert.deepEqual(bindAIForm(byKind, { values: {}, context: { kind: 'vendor' } }).permission, ['it.infra.manage', 'software_vendor.manage']);
  assert.equal(bindAIForm(byKind, { values: {}, context: { kind: 'isp' } }).permission, 'it.infra.manage');

  const plain = defineAIForm({ ...base, permission: 'x.manage' });
  assert.equal(bindAIForm(plain, { values: {}, enabled: true }).enabled, true);
  assert.equal(bindAIForm(plain, { values: {}, enabled: true, ready: false }).enabled, false, 'lookups still loading: not registered');
  assert.equal(bindAIForm(plain, { values: {}, enabled: true, ready: true }).enabled, true);
  assert.equal(bindAIForm(plain, { values: {}, enabled: false, ready: true }).enabled, false);

  // The pages named in §9.12 declare the same any-of rule as their catalog entry.
  assert.match(read('pages/advanced/Escalations.jsx'), /permission: \['management_dashboard\.view', 'management_dashboard\.division'\]/);
  assert.match(read('pages/ga/GaOpsDialogs.jsx'), /id: 'ga-ops-maintenance-log'[^\n]*permission: \['ga\.ops\.manage', 'ga\.request\.process'\]/);
  assert.match(read('pages/it/InfraDialogs.jsx'), /kind === 'vendor' \? \['it\.infra\.manage', 'software_vendor\.manage'\] : 'it\.infra\.manage'/);
  assert.match(read('pages/it/BastDialog.jsx'), /permission: \['it\.infra\.manage', 'ga\.ops\.manage'\]/);
  // Dialogs whose selects load after they open register through `ready`.
  for (const file of ['pages/it/InfraDialogs.jsx', 'pages/it/DeviceDialogs.jsx', 'pages/hrga/WorkflowFormDialog.jsx', 'pages/hrga/TaskDialogs.jsx', 'pages/people/PersonFormDialog.jsx', 'pages/projects/DivisionDialog.jsx']) {
    assert.match(read(file), /\n {4}ready: /, file);
  }
});

test('the record an edit form changes: ids up to 100 characters (a recurring Google Calendar event), the same on the pages that build them', () => {
  const id = `${'a1b2c3d4e5'.repeat(5)}_20261005T030000Z`;
  assert.deepEqual(recordOf({ mode: 'edit', record: { type: 'calendar_event', id } }), { type: 'calendar_event', id });
  assert.deepEqual(recordOf({ mode: 'edit', record: { type: 'calendar_event', id: 'x'.repeat(100) } })?.id.length, 100);
  assert.equal(recordOf({ mode: 'edit', record: { type: 'calendar_event', id: 'x'.repeat(101) } }), null, 'too long: refused, never cut');
  assert.equal(recordOf({ mode: 'edit', record: { type: 'calendar_event', id: '../x' } }), null);
  // The id words of the escalation and target forms keep their whole source key.
  const long = { source: 'it_infra_contract_expiring_soon', sourceId: 20261005123 };
  assert.equal(escalationRecordId(long), 'it_infra_contract_expiring_soon-20261005123');
  assert.equal(findEscalation([long], 'it_infra_contract_expiring_soon-20261005123'), long);
  assert.equal(targetRecordId(12, 'retail_commerce_marketplace_revenue_before_tax'), '12-retail_commerce_marketplace_revenue_before_tax');
  // An escalation outside the filter on screen still opens: the page looks that one row up in the whole queue.
  const page = read('pages/advanced/Escalations.jsx');
  assert.match(page, /useOpenFromUrl\('ubah', async \(recordId\) => \{/);
  assert.match(page, /escalationQuery\(\{ status: 'all' \}\)/);
});

test('"Tambah dependensi": the other task\'s ID is fillable as a whole number — and never the task itself', () => {
  const page = read('components/tasks/TaskDependencies.jsx');
  assert.match(page, /f\.number\('otherId', 'ID task lain', \{ required: true, min: 1, step: 1/);
  assert.match(page, /setters: \{ mode: setMode, otherId: setOtherId \}/);
  const registry = createFormRegistry();
  const state = { values: { mode: 'blocked_by', otherId: '' } };
  registry.register('task-dependency', () => ({
    title: 'Tambah dependensi', permission: 'task.dependency.manage', initialValues: { mode: 'blocked_by', otherId: '' },
    fields: [f.number('otherId', 'ID task lain', { required: true, min: 1, step: 1 })],
    getValues: () => state.values, setValues: (patch) => { state.values = { ...state.values, ...patch }; },
    validate: (next) => (String(next.otherId || '') !== '' && Number(next.otherId) === 41 ? { otherId: 'Task tidak dapat bergantung ke dirinya sendiri.' } : {}),
  }));
  const entry = registry.get('task-dependency');
  syncForm(entry, registry);
  const tryFill = (isi) => fillForm(entry, [{ kolom: 'otherId', isi }], { registry });
  assert.equal(tryFill('abc').ditolak[0].alasan, 'Isi harus berupa angka.');
  assert.equal(tryFill('0').ditolak[0].alasan, 'Paling kecil 1.');
  assert.equal(tryFill('1,5').ditolak[0].alasan, 'Isi harus bilangan bulat.');
  assert.equal(tryFill('41').ditolak[0].alasan, 'Task tidak dapat bergantung ke dirinya sendiri.');
  assert.deepEqual(tryFill('58').diisi, ['otherId']);
  assert.equal(state.values.otherId, '58');
});
