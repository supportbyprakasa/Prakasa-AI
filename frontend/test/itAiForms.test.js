import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { bindAIForm, defineAIForm } from '../src/components/ai/aiFormFields.js';
import { createFormRegistry, describeForm, fillForm, pickLookup } from '../src/components/ai/aiFormModel.js';
import { AI_EDIT_TITLES, AI_RECORD_TYPES, FORM_FIELDS, aiRegisterFields, formErrors, formFields, formValues } from '../src/pages/it/infraModel.js';
import { personName, personResults } from '../src/pages/it/itModel.js';

// Wave C2 — the IT forms Prakasa AI may fill (docs/prakasa-ai-rencana.md §9.9):
// the policy of the infrastructure registers, and the people lookup.

const catalog = createRequire(import.meta.url)('../../backend/src/services/ai/agent/formCatalog.js');
const source = readFileSync(new URL('../src/pages/it/InfraDialogs.jsx', import.meta.url), 'utf8');
// The policy as the page writes it (InfraDialogs.jsx AI_POLICY).
const POLICY = new Function(`return (${source.match(/const AI_POLICY = (\{[\s\S]*?\n\});/)[1]});`)();
const KINDS = ['network', 'isp', 'cctv', 'backup', 'phone', 'vendor'];
const SENSITIVE = ['ipAddress', 'serialNumber', 'customerNumber', 'portalUrl', 'number', 'phone', 'monthlyCost', 'status'];

test('register forms: every field is decided, and the page and the server catalog hold the same policy', () => {
  assert.deepEqual(Object.keys(POLICY).sort(), [...KINDS].sort());
  for (const kind of KINDS) {
    const names = FORM_FIELDS[kind].map((field) => field.name).sort();
    assert.deepEqual([...POLICY[kind].ai, ...POLICY[kind].userOnly].sort(), names, `${kind}: every field of the form is either the AI's or the user's`);
    for (const name of SENSITIVE) assert.ok(!POLICY[kind].ai.includes(name), `${kind}.${name} is never the AI's`);
    const create = catalog.byId.get(`it-infra-${kind}`);
    const edit = catalog.byId.get(`it-infra-${kind}-edit`);
    assert.deepEqual([...create.fields.ai], POLICY[kind].ai, `${kind}: catalog ai (create)`);
    assert.deepEqual([...edit.fields.ai], POLICY[kind].ai, `${kind}: catalog ai (edit)`);
    assert.deepEqual([...edit.fields.userOnly].sort(), [...POLICY[kind].userOnly].sort(), `${kind}: catalog userOnly (edit)`);
    // The create form has no edit-only field (status of a backup or a phone line).
    const shownOnCreate = formFields(kind, false).map((field) => field.name);
    assert.deepEqual([...create.fields.userOnly].sort(), POLICY[kind].userOnly.filter((name) => shownOnCreate.includes(name)).sort(), `${kind}: catalog userOnly (create)`);
    assert.equal(edit.record, AI_RECORD_TYPES[kind]);
    assert.equal(edit.title, AI_EDIT_TITLES[kind]);
  }
});

test('register forms: the AI specs keep the form\'s labels, options and limits; an undecided field is not registered', () => {
  const locations = [{ value: '1', label: 'Kantor pusat' }, { value: '2', label: 'Gudang Cikupa' }];
  const refs = { isp: [{ value: '5', label: 'Biznet · Kantor pusat' }] };
  const specs = aiRegisterFields('network', true, POLICY.network, { locations, refs });
  const by = Object.fromEntries(specs.map((spec) => [spec.name, spec]));
  assert.deepEqual(specs.map((spec) => spec.name), FORM_FIELDS.network.map((field) => field.name));
  assert.deepEqual([by.deviceType.type, by.deviceType.required, by.deviceType.options.length], ['select', true, 8]);
  assert.deepEqual([by.brandModel.label, by.brandModel.maxLength, by.brandModel.required], ['Merek / model', 150, true]);
  assert.deepEqual([by.installedYear.type, by.installedYear.min, by.installedYear.max], ['number', 1990, 2100]);
  assert.deepEqual(by.locationId.options, locations);
  assert.deepEqual(by.ispLinkId.options, refs.isp);
  assert.equal(by.firmwareUpdatedOn.type, 'date');
  for (const name of ['ipAddress', 'serialNumber', 'status']) assert.equal(by[name].aiFillable, false, name);
  assert.equal(aiRegisterFields('isp', false, POLICY.isp).find((spec) => spec.name === 'isBackup').type, 'checkbox');
  // Create forms have no edit-only field.
  assert.equal(aiRegisterFields('backup', false, POLICY.backup).some((spec) => spec.name === 'status'), false);
  assert.equal(aiRegisterFields('backup', true, POLICY.backup).find((spec) => spec.name === 'status').aiFillable, false);
  // Default deny: a field the policy forgot is not registered, so it cannot be filled or read.
  const partial = aiRegisterFields('network', true, { ai: ['brandModel'], userOnly: [] });
  assert.deepEqual(partial.map((spec) => spec.name), ['brandModel']);
  assert.deepEqual(aiRegisterFields('network', true, undefined), []);
});

const NETWORK_ROW = {
  id: 12, version: 3, deviceType: 'router', brandModel: 'Asus AX6000', serialNumber: 'SN-ZX81-0042', locationId: 1, ipAddress: '192.168.10.254',
  installedYear: 2022, ispLinkId: null, firmwareUpdatedOn: null, status: 'active', notes: '',
};
function openEdit(kind, row, policy = POLICY[kind]) {
  const registry = createFormRegistry();
  let values = formValues(kind, row);
  const definition = defineAIForm({
    id: `it-infra-${kind}-edit`, title: AI_EDIT_TITLES[kind], permission: 'it.infra.manage', submitLabel: 'Simpan perubahan', mode: 'edit',
    fields: ({ locations }) => aiRegisterFields(kind, true, policy, { locations }),
  });
  const config = () => bindAIForm(definition, {
    values,
    setValues: (update) => { values = update(values); },
    initialValues: formValues(kind, row),
    record: { type: AI_RECORD_TYPES[kind], id: row.id },
    context: { locations: [{ value: '1', label: 'Kantor pusat' }] },
    validate: (next) => formErrors(kind, next, true),
  });
  registry.register(`it-infra-${kind}-edit`, config);
  return { registry, entry: registry.get(`it-infra-${kind}-edit`), read: () => values };
}

test('baca_formulir on an edit form never shows an IP address, a serial number or a status — only that the user fills them', () => {
  const { entry } = openEdit('network', NETWORK_ROW);
  const described = describeForm(entry);
  assert.equal(described.mode, 'ubah');
  assert.deepEqual(described.rekaman, { jenis: 'it_network_device', id: '12' });
  const by = Object.fromEntries(described.kolom.map((item) => [item.nama, item]));
  assert.equal(by.brandModel.isi, 'Asus AX6000');
  assert.equal(by.locationId.isi, 'Kantor pusat');
  for (const name of ['ipAddress', 'serialNumber', 'status']) {
    assert.equal(by[name].bisa_diisi, false, name);
    assert.equal('isi' in by[name], false, `${name} is listed without its value`);
  }
  assert.doesNotMatch(JSON.stringify(described), /192\.168|SN-ZX81|"active"|Aktif"\s*,\s*"isi"/);
});

test('isi_form on an edit form: descriptive fields are set, sensitive ones refused, a value the user changed is kept', () => {
  const { entry, registry, read } = openEdit('network', NETWORK_ROW);
  const result = fillForm(entry, [
    { kolom: 'brandModel', isi: 'Mikrotik RB4011' },
    { kolom: 'installedYear', isi: '2024' },
    { kolom: 'ipAddress', isi: '10.0.0.1' },
    { kolom: 'serialNumber', isi: 'SN-BARU' },
    { kolom: 'status', isi: 'Rusak' },
    { kolom: 'notes', isi: 'password: rahasia123' },
  ], { registry });
  assert.deepEqual(result.diisi, ['brandModel', 'installedYear']);
  const refused = Object.fromEntries(result.ditolak.map((item) => [item.nama, item.alasan]));
  for (const name of ['ipAddress', 'serialNumber', 'status']) assert.equal(refused[name], 'Kolom ini hanya diisi pengguna.', name);
  assert.equal(refused.notes, 'Jangan menulis kata sandi di aplikasi', 'the form\'s own rule: no password in a note');
  assert.deepEqual([read().brandModel, read().installedYear, read().ipAddress, read().serialNumber, read().status, read().notes], ['Mikrotik RB4011', '2024', '192.168.10.254', 'SN-ZX81-0042', 'active', '']);
});

test('isi_form: a field the user typed in this session is not overwritten', () => {
  const registry = createFormRegistry();
  let values = { ...formValues('vendor', { id: 3, name: 'PT Lama', vendorKind: 'isp', contactPerson: 'Rina', phone: '0812-0000-1111', email: '', portalUrl: 'https://portal.example.invalid', notes: '' }) };
  const initial = { ...values };
  values = { ...values, contactPerson: 'Rina Wijaya' }; // typed by the user
  registry.register('it-infra-vendor-edit', () => bindAIForm(defineAIForm({
    id: 'it-infra-vendor-edit', title: 'Ubah vendor', permission: 'it.infra.manage', mode: 'edit',
    fields: () => aiRegisterFields('vendor', true, POLICY.vendor),
  }), { values, setValues: (update) => { values = update(values); }, initialValues: initial, record: { type: 'it_vendor', id: 3 } }));
  const entry = registry.get('it-infra-vendor-edit');
  const described = describeForm(entry);
  assert.doesNotMatch(JSON.stringify(described), /0812|portal\.example/, 'the PIC phone and the portal address are not read');
  const result = fillForm(entry, [{ kolom: 'contactPerson', isi: 'Budi' }, { kolom: 'name', isi: 'PT Baru' }, { kolom: 'portalUrl', isi: 'https://x.example.invalid' }], { registry });
  assert.deepEqual(result.diisi, ['name']);
  assert.deepEqual(result.ditolak.map((item) => [item.nama, item.alasan]), [['contactPerson', 'Sudah diisi pengguna.'], ['portalUrl', 'Kolom ini hanya diisi pengguna.']]);
  assert.deepEqual([values.name, values.contactPerson, values.portalUrl], ['PT Baru', 'Rina Wijaya', 'https://portal.example.invalid']);
});

const PEOPLE = [
  { key: 'u15', name: 'Budi Santoso', position: 'Staff Gudang', departmentName: 'Warehouse', email: 'budi@example.invalid', phone: '081234567890', userId: 15 },
  { key: 'p7', name: 'Budi Hartono', position: 'Sales', departmentName: 'Sales', personId: 7 },
  { key: 'p9', name: 'Siti Aminah', position: 'Supervisor', departmentName: 'People & Culture', personId: 9 },
  { key: '', name: 'Tanpa kunci' },
];

test('person lookup: the picker\'s own list, by name; only the name, position and division leave the page', () => {
  const found = personResults(PEOPLE, 'budi');
  assert.deepEqual(found, [
    { value: 'u15', label: 'Budi Santoso', hint: 'Staff Gudang · Warehouse' },
    { value: 'p7', label: 'Budi Hartono', hint: 'Sales · Sales' },
  ]);
  assert.doesNotMatch(JSON.stringify(found), /example\.invalid|0812/);
  assert.deepEqual(personResults(PEOPLE, 'siti aminah').map((item) => item.value), ['p9']);
  assert.deepEqual(personResults(PEOPLE, 'supervisor people').map((item) => item.value), ['p9'], 'position and division help to tell people apart');
  assert.deepEqual(personResults(PEOPLE, ''), []);
  assert.deepEqual(personResults(PEOPLE, 'tanpa'), [], 'an entry without a key cannot be chosen');
  assert.deepEqual(personResults(null, 'budi'), []);
  assert.equal(personResults(Array.from({ length: 60 }, (_, i) => ({ key: `p${i}`, name: `Andi ${i}` })), 'andi').length, 20);
  assert.equal(personName(PEOPLE, 'p9'), 'Siti Aminah');
  assert.equal(personName(PEOPLE, 'p404'), '');
});

test('person lookup: one exact match is set; an ambiguous name is not, and the candidates go back', () => {
  const field = { name: 'entryKey', type: 'person' };
  const exact = pickLookup(field, 'Siti Aminah', personResults(PEOPLE, 'Siti Aminah'));
  assert.deepEqual(exact, { ok: true, value: 'p9', label: 'Siti Aminah' });
  const many = pickLookup(field, 'Budi', personResults(PEOPLE, 'Budi'));
  assert.equal(many.ok, false);
  assert.deepEqual(many.kandidat, ['Budi Santoso — Staff Gudang · Warehouse', 'Budi Hartono — Sales · Sales']);
  assert.equal(pickLookup(field, 'Joko', personResults(PEOPLE, 'Joko')).ok, false);
});
