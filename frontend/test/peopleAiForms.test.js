import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceLabel, deviceChoices, emptyTemplateItem, personChoices, searchChoices, templateAiErrors, userChoices, workflowAiPatch, workflowAiValues,
  workflowFormErrors, workflowFormValues,
} from '../src/pages/hrga/hrgaModel.js';
import { managerChoices } from '../src/pages/people/directoryModel.js';
import { bindAIForm, defineAIForm, f } from '../src/components/ai/aiFormFields.js';
import { createFormRegistry, describeForm, fillFormAsync, undoFill } from '../src/components/ai/aiFormModel.js';

// Wave C2 — People & Culture forms for Prakasa AI (docs/prakasa-ai-rencana.md
// §9.9): the pickers as the AI searches them, and the onboarding form's needs
// as flat fields. The lists are the ones the page's Selects already show.

const PEOPLE = [
  { key: 'u1', name: 'Budi Santoso', position: 'Staff Gudang', departmentName: 'Warehouse', status: 'active', workPhone: '+62 811 1234 5678', workEmail: 'budi@example.invalid' },
  { key: 'u2', name: 'Budi Hartono', position: 'Sales', departmentName: 'Sales', status: 'active' },
  { key: 'p3', name: 'Sari Dewi', position: null, departmentName: 'Finance', status: 'resigned' },
  { key: 'u4', name: 'Rina Wijaya', position: 'Head', departmentName: 'People & Culture', status: 'active' },
];

test('people as Prakasa AI searches them: name as the label, position and division as the hint — nothing else', () => {
  const all = personChoices(PEOPLE);
  assert.deepEqual(all[0], { value: 'u1', label: 'Budi Santoso', hint: 'Staff Gudang · Warehouse' });
  assert.deepEqual(all[2], { value: 'p3', label: 'Sari Dewi', hint: 'Finance' });
  for (const choice of all) {
    assert.deepEqual(Object.keys(choice), ['value', 'label', 'hint']);
    assert.doesNotMatch(JSON.stringify(choice), /811|@|resign/);
  }
  // The same filters as the Select: active people only; not the person themself.
  assert.deepEqual(personChoices(PEOPLE, { activeOnly: true }).map((c) => c.value), ['u1', 'u2', 'u4']);
  assert.deepEqual(personChoices(PEOPLE, { exclude: 'u1' }).map((c) => c.value), ['u2', 'p3', 'u4']);
  assert.deepEqual(managerChoices(PEOPLE, 'u4').map((c) => c.value), ['u1', 'u2', 'p3']);
  assert.deepEqual(managerChoices(PEOPLE, 'u4')[0], { value: 'u1', label: 'Budi Santoso', hint: 'Staff Gudang · Warehouse' });
  assert.deepEqual(userChoices([{ id: 7, name: 'Rina Wijaya', departmentName: 'People & Culture', email: 'x@example.invalid' }]), [{ value: '7', label: 'Rina Wijaya', hint: 'People & Culture' }]);
  assert.deepEqual(userChoices([{ id: 8, name: 'Tono' }]), [{ value: '8', label: 'Tono', hint: '' }]);
  assert.deepEqual(deviceChoices([{ id: 3, name: 'ThinkPad T14', serialNumber: 'SN-A1', locationName: 'Kantor Pusat' }]), [{ value: '3', label: 'ThinkPad T14', hint: 'SN-A1 · Kantor Pusat' }]);
});

test('searchChoices filters the loaded list by every word; no word, no result', () => {
  const all = personChoices(PEOPLE);
  assert.deepEqual(searchChoices(all, 'budi').map((c) => c.value), ['u1', 'u2']);
  assert.deepEqual(searchChoices(all, 'Budi gudang').map((c) => c.value), ['u1']);
  assert.deepEqual(searchChoices(all, 'RINA  wijaya').map((c) => c.value), ['u4']);
  assert.deepEqual(searchChoices(all, 'tidak ada'), []);
  assert.deepEqual(searchChoices(all, '  '), []);
  assert.deepEqual(searchChoices(null, 'budi'), []);
  assert.equal(searchChoices(Array.from({ length: 40 }, (_, i) => ({ value: String(i), label: `Budi ${i}`, hint: '' })), 'budi').length, 20);
  assert.equal(choiceLabel(all, 'u4'), 'Rina Wijaya');
  assert.equal(choiceLabel(all, ''), '');
  assert.equal(choiceLabel(all, 'zz'), '');
});

test('the onboarding needs are flat fields for the AI and go back into the needs object', () => {
  const values = workflowFormValues(null, 'onboarding');
  const flat = workflowAiValues(values);
  assert.deepEqual([flat.needGoogle, flat.needApp, flat.needIdCard, flat.needDesk, flat.needDevice, flat.needPhone, flat.needLicenses], [true, true, true, true, 'laptop', 'none', []]);
  assert.equal(flat.employeeFullName, '');
  const next = workflowAiPatch(values, { employeeFullName: 'Andi', needDevice: 'pc', needGoogle: false, needLicenses: ['4', '9'], workflowType: 'offboarding', needs: { hack: true } });
  assert.equal(next.employeeFullName, 'Andi');
  assert.equal(next.workflowType, 'onboarding', 'the type of a form is never the AI\'s');
  assert.deepEqual(next.needs, { ...values.needs, device: 'pc', google: false, licenses: ['4', '9'] });
  assert.equal('needDevice' in next, false, 'no stray key in the form values');
  assert.equal(values.needs.device, 'laptop', 'the original is not changed');
});

test('the template editor\'s rules as one message per field', () => {
  assert.deepEqual(templateAiErrors({ name: 'Onboarding Sales', rows: [{ ...emptyTemplateItem(), title: 'Siapkan meja' }], workflowType: 'onboarding' }), {});
  assert.deepEqual(templateAiErrors({ name: '', rows: [], workflowType: 'onboarding' }), { name: 'Nama template wajib diisi.', items: 'Tambahkan minimal satu item.' });
  assert.deepEqual(templateAiErrors({ name: 'x', rows: [emptyTemplateItem()], workflowType: 'onboarding' }), { items: 'Judul wajib diisi.' });
  assert.deepEqual(templateAiErrors({ name: 'x', rows: [{ ...emptyTemplateItem(), title: 't', offsetDays: '45' }], workflowType: 'onboarding' }), { items: 'Antara -30 dan 30.' });
});

// The offboarding form as WorkflowFormDialog registers it, on a plain object instead of React state.
function offboardingForm() {
  const state = { values: workflowFormValues(null, 'offboarding') };
  const people = personChoices(PEOPLE);
  const active = personChoices(PEOPLE, { activeOnly: true });
  const definition = defineAIForm({
    id: 'hr-offboarding', title: 'Offboarding', permission: 'hrga.request', submitLabel: 'Simpan draf',
    fields: [
      f.person('personKey', 'Karyawan', (text) => searchChoices(active, text), { required: true, labelOf: (value) => choiceLabel(people, value) }),
      f.date('lastWorkingDate', 'Hari terakhir', { required: true }),
      f.userOnly('reasonCode', 'Alasan', 'select'),
      f.userOnly('notes', 'Catatan', 'textarea'),
    ],
  });
  const registry = createFormRegistry();
  registry.register('hr-offboarding', () => bindAIForm(definition, {
    values: workflowAiValues(state.values),
    apply: (patch) => { state.values = workflowAiPatch(state.values, patch); },
    validate: workflowFormErrors,
    initialValues: workflowAiValues(workflowFormValues(null, 'offboarding')),
  }));
  return { state, registry, entry: registry.get('hr-offboarding') };
}

test('offboarding in the form model: one exact person is set; an ambiguous name is not, and its candidates carry no number', async () => {
  const { state, registry, entry } = offboardingForm();
  const many = await fillFormAsync(entry, [{ kolom: 'personKey', isi: 'Budi' }, { kolom: 'lastWorkingDate', isi: '30/10/2026' }], { registry });
  assert.deepEqual(many.diisi, ['lastWorkingDate']);
  assert.deepEqual(many.ditolak, [{ nama: 'personKey', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Budi Santoso — Staff Gudang · Warehouse', 'Budi Hartono — Sales · Sales'] }]);
  assert.equal(state.values.personKey, '');
  assert.equal(state.values.lastWorkingDate, '2026-10-30');
  // A resigned person is not offered for an offboarding (the Select does not offer them either).
  assert.equal((await fillFormAsync(entry, [{ kolom: 'personKey', isi: 'Sari Dewi' }], { registry })).ditolak[0].alasan, 'Tidak ditemukan. Tanyakan nama yang benar ke pengguna.');

  const one = await fillFormAsync(entry, [{ kolom: 'personKey', isi: 'Budi Santoso' }, { kolom: 'reasonCode', isi: 'Resign' }, { kolom: 'notes', isi: 'alasan pribadi' }], { registry });
  assert.deepEqual(one.diisi, ['personKey']);
  assert.equal(state.values.personKey, 'u1');
  assert.deepEqual(one.ditolak.map((item) => [item.nama, item.alasan]), [['reasonCode', 'Kolom ini hanya diisi pengguna.'], ['notes', 'Kolom ini hanya diisi pengguna.']]);
  assert.equal(state.values.reasonCode, '');
  assert.equal(state.values.notes, '');
  // The reason is still the user's to choose: the form says so.
  assert.deepEqual(one.masih_perlu, [{ nama: 'reasonCode', alasan: 'Pilih alasan.' }]);

  // Read back: the person by name; the reason and the note have no value in what the AI reads.
  state.values = { ...state.values, reasonCode: 'resign', notes: 'catatan P&C' };
  const read = describeForm(entry);
  const byName = Object.fromEntries(read.kolom.map((k) => [k.nama, k]));
  assert.equal(byName.personKey.isi, 'Budi Santoso');
  assert.equal('isi' in byName.reasonCode, false);
  assert.equal('isi' in byName.notes, false);
  assert.doesNotMatch(JSON.stringify(read), /catatan P&C|resign/);

  // "Urungkan isian AI" takes back what the AI set and leaves the user's values alone.
  undoFill(entry, registry);
  assert.equal(state.values.personKey, '');
  assert.equal(state.values.lastWorkingDate, '');
  assert.equal(state.values.reasonCode, 'resign');
  assert.equal(state.values.notes, 'catatan P&C');
});

test('a value the user chose is not replaced', async () => {
  const { state, registry, entry } = offboardingForm();
  state.values = { ...state.values, personKey: 'u4', lastWorkingDate: '2026-11-15' };
  const result = await fillFormAsync(entry, [{ kolom: 'personKey', isi: 'Budi Santoso' }, { kolom: 'lastWorkingDate', isi: '2026-10-30' }], { registry });
  assert.deepEqual(result.diisi, []);
  assert.deepEqual(result.ditolak.map((item) => item.alasan), ['Sudah diisi pengguna.', 'Sudah diisi pengguna.']);
  assert.equal(state.values.personKey, 'u4');
  assert.equal(state.values.lastWorkingDate, '2026-11-15');
});
