import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REASONS, clearFilled, coerceValue, createFormRegistry, describeForm, dismissNotice, fieldClass, fillForm, filledNames, isDirty,
  matchOption, parseDate, parseNumber, parseTime, parseYesNo, syncForm, undoFill, wibToday,
} from '../src/components/ai/aiFormModel.js';

// Wave C1 (docs/prakasa-ai-rencana.md §9.8): Prakasa AI fills a form the page
// registered; the user saves it.

const PRIORITIES = [{ value: 'low', label: 'Rendah' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Tinggi' }, { value: 'urgent', label: 'Mendesak' }];
const EMPTY = { title: '', description: '', priority: 'normal', dueDate: '', urgent: false, amount: '', payeeBank: '', password: '', internal: '' };

// A form as a page holds it: its own state and its own setter.
function makeForm({ validate = null, initialValues = EMPTY, fields = null } = {}) {
  const state = { values: { ...initialValues }, sets: [] };
  const registry = createFormRegistry();
  const config = {
    title: 'Tiket IT',
    permission: 'it_ticket.create',
    initialValues,
    fields: fields || [
      { name: 'title', label: 'Judul', type: 'text', required: true, maxLength: 20 },
      { name: 'description', label: 'Deskripsi', type: 'textarea', required: true },
      { name: 'priority', label: 'Prioritas', type: 'select', options: PRIORITIES },
      { name: 'dueDate', label: 'Jatuh tempo', type: 'date' },
      { name: 'urgent', label: 'Mendesak', type: 'checkbox' },
      { name: 'amount', label: 'Subtotal', type: 'number' },
      { name: 'payeeBank', label: 'Bank', type: 'text' },
      { name: 'password', label: 'Kata sandi', type: 'text' },
      { name: 'internal', label: 'Catatan internal', type: 'text', aiFillable: false },
      { name: 'broken', label: 'x', type: 'file' },
    ],
    getValues: () => state.values,
    setValues: (patch) => { state.sets.push(patch); state.values = { ...state.values, ...patch }; },
    ...(validate ? { validate } : {}),
  };
  const unregister = registry.register('it-ticket', () => config);
  const entry = registry.get('it-ticket');
  // The page renders after it registers (the hook syncs after every render).
  const render = () => syncForm(entry, registry);
  render();
  const type = (name, value) => { state.values = { ...state.values, [name]: value }; render(); };
  return { state, registry, entry, config, unregister, render, type };
}
const fill = (form, pairs, options) => {
  const result = fillForm(form.entry, Object.entries(pairs).map(([kolom, isi]) => ({ kolom, isi })), { registry: form.registry, ...options });
  form.render();
  return result;
};
const reasons = (result) => Object.fromEntries(result.ditolak.map((item) => [item.nama, item.alasan]));

test('the registry holds a form only while its page registers it', () => {
  const form = makeForm();
  assert.deepEqual(form.registry.list().map((entry) => entry.id), ['it-ticket']);
  let notified = 0;
  const off = form.registry.subscribe(() => { notified += 1; });
  form.unregister();
  assert.equal(form.registry.get('it-ticket'), null);
  assert.equal(notified, 1);
  off();
  assert.throws(() => form.registry.register('bad id!', () => ({})), /id formulir/);
  // A second registration with the same id replaces the first; the first's unregister then does nothing.
  const registry = createFormRegistry();
  const first = registry.register('a', () => ({ fields: [], getValues: () => ({}) }));
  registry.register('a', () => ({ title: 'kedua', fields: [], getValues: () => ({}) }));
  first();
  assert.equal(registry.get('a').getConfig().title, 'kedua');
});

test('a fill sets only registered, AI-fillable fields — through the form\'s own setter', () => {
  const form = makeForm();
  const result = fill(form, {
    title: 'Wifi mati', priority: 'Tinggi', dueDate: '2026-10-05', urgent: 'ya', amount: 'Rp 250.000',
    payeeBank: 'BCA', password: 'rahasia', internal: 'x', tidakAda: 'y', broken: 'z', kataSandiBaru: 'q',
  });
  assert.deepEqual(result.diisi, ['title', 'priority', 'dueDate', 'urgent', 'amount']);
  assert.deepEqual(reasons(result), {
    payeeBank: REASONS.userOnly, // where money goes
    password: REASONS.userOnly, // a secret
    internal: REASONS.userOnly, // the page said aiFillable: false
    tidakAda: REASONS.unknown, // not registered
    broken: REASONS.unknown, // a file field cannot be registered at all
    kataSandiBaru: REASONS.userOnly,
  });
  assert.deepEqual(form.state.sets, [{ title: 'Wifi mati', priority: 'high', dueDate: '2026-10-05', urgent: true, amount: '250000' }]);
  assert.equal(form.state.values.payeeBank, '');
  assert.equal(form.state.values.password, '');
  assert.deepEqual(filledNames(form.entry), ['title', 'priority', 'dueDate', 'urgent', 'amount']);
  assert.deepEqual(result.masih_perlu, [{ nama: 'description', alasan: REASONS.required }]);
  assert.equal(isDirty(form.entry), true, 'what the AI filled is an unsaved change');
});

test('whatever the page says, a secret, a bank account, a decision or an upload is never fillable', () => {
  const form = makeForm({
    initialValues: {},
    fields: [
      { name: 'newPassword', label: 'Kata sandi baru', type: 'text', aiFillable: true },
      { name: 'payeeAccountNumber', label: 'Nomor rekening', type: 'text', aiFillable: true },
      { name: 'payeeAccountName', label: 'Atas nama', type: 'text', aiFillable: true },
      { name: 'approvalDecision', label: 'Keputusan', type: 'select', options: [{ value: 'approve', label: 'Setujui' }], aiFillable: true },
      { name: 'attachment', label: 'Lampiran', type: 'text', aiFillable: true },
      { name: 'payeeName', label: 'Nama penerima', type: 'text' },
    ],
  });
  const result = fill(form, { newPassword: 'x', payeeAccountNumber: '123', payeeAccountName: 'Budi', approvalDecision: 'Setujui', attachment: 'a.pdf', payeeName: 'PT PLN (Persero)' });
  assert.deepEqual(result.diisi, ['payeeName']);
  assert.equal(result.ditolak.length, 5);
  assert.ok(result.ditolak.every((item) => item.alasan === REASONS.userOnly));
  for (const [name, kind] of [['newPassword', 'secret'], ['payeeAccountNumber', 'userOnly'], ['approvalDecision', 'userOnly'], ['attachment', 'userOnly'], ['payeeName', 'open']]) {
    assert.equal(fieldClass(name), kind, name);
  }
});

test('a value the user typed is never overwritten; an empty, untouched or AI-filled field may be', () => {
  const form = makeForm();
  form.type('title', 'Printer macet'); // the user
  form.type('priority', 'urgent'); // the user changed a default
  let result = fill(form, { title: 'Wifi mati', priority: 'Rendah', description: 'Sejak pagi' });
  assert.deepEqual(result.diisi, ['description']);
  assert.deepEqual(reasons(result), { title: REASONS.userValue, priority: REASONS.userValue });
  assert.equal(form.state.values.title, 'Printer macet');
  assert.equal(form.state.values.priority, 'urgent');

  // The AI may correct its own value…
  result = fill(form, { description: 'Sejak pagi, semua perangkat' });
  assert.deepEqual(result.diisi, ['description']);
  // …but not once the user has edited it.
  form.type('description', 'Sejak pagi, hanya laptop saya');
  assert.deepEqual(filledNames(form.entry), [], 'editing the field removes its mark');
  result = fill(form, { description: 'lain' });
  assert.deepEqual(reasons(result), { description: REASONS.userValue });
  assert.equal(form.state.values.description, 'Sejak pagi, hanya laptop saya');

  // A field the user cleared is empty again: fillable.
  form.type('title', '');
  assert.deepEqual(fill(form, { title: 'Wifi mati' }).diisi, ['title']);
  // A default nobody touched (dueDate '') and an untouched default select are fillable.
  const fresh = makeForm();
  assert.deepEqual(fill(fresh, { priority: 'Mendesak' }).diisi, ['priority']);
  assert.equal(fresh.state.values.priority, 'urgent');
});

test('"Urungkan isian AI" restores what was there, and leaves what the user typed since', () => {
  const form = makeForm();
  form.type('amount', '');
  fill(form, { title: 'Wifi mati', priority: 'Tinggi', description: 'Sejak pagi' });
  fill(form, { title: 'Wifi kantor mati' }); // a second fill of the same field
  form.type('description', 'Saya ubah sendiri'); // the user edits one of them
  assert.deepEqual(filledNames(form.entry), ['title', 'priority']);
  const restored = undoFill(form.entry, form.registry);
  form.render();
  assert.deepEqual(restored.sort(), ['priority', 'title']);
  assert.equal(form.state.values.title, '', 'back to what it was before the FIRST fill');
  assert.equal(form.state.values.priority, 'normal');
  assert.equal(form.state.values.description, 'Saya ubah sendiri', 'the user\'s edit stays');
  assert.deepEqual(filledNames(form.entry), []);
});

test('the marks go when the user edits a field or saves; the notice can be dismissed and comes back on a new fill', () => {
  const form = makeForm();
  fill(form, { title: 'Wifi mati', description: 'Sejak pagi' });
  assert.equal(form.entry.filled.size, 2);
  form.type('title', 'Wifi mati total');
  assert.deepEqual(filledNames(form.entry), ['description']);
  dismissNotice(form.entry, form.registry);
  assert.equal(form.entry.noticeDismissed, true);
  fill(form, { dueDate: 'besok' });
  assert.equal(form.entry.noticeDismissed, false);
  clearFilled(form.entry, form.registry); // the user saved
  assert.equal(form.entry.filled.size, 0);
  assert.equal(form.state.values.description, 'Sejak pagi', 'saving keeps the values');
});

test('a mark survives the render that has not applied the value yet', () => {
  // React applies the form's state update a moment after the fill: a render in between still shows the old value.
  const state = { values: { title: '' } };
  const registry = createFormRegistry();
  let pending = null;
  registry.register('f', () => ({
    permission: 'task.create', initialValues: { title: '' }, fields: [{ name: 'title', label: 'Judul', type: 'text' }],
    getValues: () => state.values, setValues: (patch) => { pending = patch; },
  }));
  const entry = registry.get('f');
  syncForm(entry, registry);
  fillForm(entry, [{ kolom: 'title', isi: 'Wifi' }], { registry });
  syncForm(entry, registry); // old value still on screen
  assert.deepEqual(filledNames(entry), ['title']);
  state.values = { ...state.values, ...pending };
  syncForm(entry, registry);
  assert.deepEqual(filledNames(entry), ['title']);
  state.values = { title: 'Wifi!' }; // now the user edits
  syncForm(entry, registry);
  assert.deepEqual(filledNames(entry), []);
});

test('the form\'s own validation decides: a refused field is not applied, and its message is the reason', () => {
  const validate = (values) => {
    const errors = {};
    if (values.title && /wifi/i.test(values.title)) errors.title = 'Judul tidak boleh menyebut wifi.';
    if (!values.description) errors.description = 'Ceritakan masalahnya.';
    if (values.dueDate && values.dueDate < '2026-10-02') errors.dueDate = 'Tanggal sudah lewat.';
    errors.unknownField = 'diabaikan';
    return errors;
  };
  const form = makeForm({ validate });
  const result = fill(form, { title: 'Wifi mati', dueDate: '2026-09-01', priority: 'Tinggi' });
  assert.deepEqual(result.diisi, ['priority']);
  assert.deepEqual(reasons(result), { title: 'Judul tidak boleh menyebut wifi.', dueDate: 'Tanggal sudah lewat.' });
  assert.equal(form.state.values.title, '');
  assert.equal(form.state.values.dueDate, '');
  // Required fields nobody filled are reported, with the form's own words when it has them.
  assert.deepEqual(result.masih_perlu, [{ nama: 'description', alasan: 'Ceritakan masalahnya.' }, { nama: 'title', alasan: REASONS.required }]);
});

test('values are read as the field holds them: numbers, WIB dates, times, options by label, yes/no', () => {
  const now = Date.parse('2026-10-02T18:30:00Z'); // 3 October 01:30 in WIB
  assert.equal(wibToday(now), '2026-10-03');
  assert.equal(parseDate('hari ini', now), '2026-10-03');
  assert.equal(parseDate('besok', now), '2026-10-04');
  assert.equal(parseDate('lusa', now), '2026-10-05');
  assert.equal(parseDate('kemarin', now), '2026-10-02');
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('5/10/2026'), '2026-10-05', 'day first, the Indonesian way');
  assert.equal(parseDate('05-10-2026'), '2026-10-05');
  assert.equal(parseDate('5 Oktober 2026'), '2026-10-05');
  assert.equal(parseDate('5 Okt 2026'), '2026-10-05');
  assert.equal(parseDate('5 October 2026'), '2026-10-05');
  assert.equal(parseDate('2026-10-02T18:30:00Z'), '2026-10-03', 'a moment is the WIB day it falls on');
  for (const bad of ['31/02/2026', '2026-13-01', 'minggu depan', '', '10/2026', '2026-02-30']) assert.equal(parseDate(bad, now), null, bad);

  assert.equal(parseTime('9'), '09:00');
  assert.equal(parseTime('9.30'), '09:30');
  assert.equal(parseTime('14:05 WIB'), '14:05');
  for (const bad of ['25:00', '9:75', 'pagi', '']) assert.equal(parseTime(bad), null, bad);

  assert.equal(parseNumber('250000'), '250000');
  assert.equal(parseNumber('250.000'), '250000');
  assert.equal(parseNumber('Rp 1.250.000'), '1250000');
  assert.equal(parseNumber('1.250.000,50'), '1250000.5');
  assert.equal(parseNumber('1,5'), '1.5');
  assert.equal(parseNumber('1.5'), '1.5');
  assert.equal(parseNumber('75'), '75');
  for (const bad of ['dua ratus', '', '12abc', '1,2,3']) assert.equal(parseNumber(bad), null, bad);

  assert.equal(matchOption(PRIORITIES, 'Tinggi').value, 'high');
  assert.equal(matchOption(PRIORITIES, 'tinggi ').value, 'high');
  assert.equal(matchOption(PRIORITIES, 'high').value, 'high', 'the stored value works too');
  assert.equal(matchOption(PRIORITIES, 'mendes').value, 'urgent', 'one label starts with it');
  assert.equal(matchOption(PRIORITIES, 'Sangat tinggi'), null);
  assert.equal(matchOption([{ value: 1, label: 'Gudang A' }, { value: 2, label: 'Gudang B' }], 'gudang'), null, 'ambiguous: no guess');
  assert.equal(matchOption([{ value: 1, label: 'Gudang A', disabled: true }], 'Gudang A'), null);

  assert.equal(parseYesNo('ya'), true);
  assert.equal(parseYesNo('Tidak'), false);
  assert.equal(parseYesNo(true), true);
  assert.equal(parseYesNo('mungkin'), null);

  const field = (over) => ({ name: 'x', type: 'text', ...over });
  assert.deepEqual(coerceValue(field({ type: 'select', options: [{ value: 7, label: 'Kantor pusat' }] }), 'kantor pusat'), { ok: true, value: '7' });
  assert.deepEqual(coerceValue(field({ type: 'radio', options: PRIORITIES }), 'Rendah'), { ok: true, value: 'low' });
  assert.deepEqual(coerceValue(field({ type: 'select', options: PRIORITIES }), 'Kritis'), { ok: false, alasan: REASONS.option });
  assert.deepEqual(coerceValue(field({ type: 'number' }), 'banyak'), { ok: false, alasan: REASONS.number });
  assert.deepEqual(coerceValue(field({ type: 'date' }), 'nanti'), { ok: false, alasan: REASONS.date });
  assert.deepEqual(coerceValue(field({ type: 'time' }), 'siang'), { ok: false, alasan: REASONS.time });
  assert.deepEqual(coerceValue(field({ type: 'checkbox' }), 'mungkin'), { ok: false, alasan: REASONS.yesNo });
  assert.deepEqual(coerceValue(field({ maxLength: 5 }), 'terlalu panjang'), { ok: false, alasan: 'Paling banyak 5 karakter.' });
  assert.deepEqual(coerceValue(field({ required: true }), '  '), { ok: false, alasan: REASONS.required });
  assert.deepEqual(coerceValue(field({}), '  '), { ok: true, value: '' });
  assert.deepEqual(coerceValue(field({ type: 'textarea' }), ' baris 1\r\nbaris 2 '), { ok: true, value: 'baris 1\nbaris 2' });
  assert.deepEqual(coerceValue(field({}), ' dua   spasi '), { ok: true, value: 'dua spasi' });
});

test('what the AI reads of a form: labels, options and current values — never a secret, never a user-only value', () => {
  const form = makeForm();
  form.type('payeeBank', 'BCA 123');
  form.type('password', 'rahasia');
  form.type('internal', 'catatan pengguna');
  form.type('title', 'Diketik pengguna');
  fill(form, { priority: 'Tinggi' });
  const seen = describeForm(form.entry);
  assert.equal(seen.id, 'it-ticket');
  assert.equal(seen.judul, 'Tiket IT');
  assert.equal(seen.izin, 'it_ticket.create');
  assert.equal(seen.belum_disimpan, true);
  const byName = Object.fromEntries(seen.kolom.map((k) => [k.nama, k]));
  assert.equal('password' in byName, false, 'a secret field is not listed');
  assert.equal('broken' in byName, false);
  assert.deepEqual(byName.payeeBank, { nama: 'payeeBank', label: 'Bank', jenis: 'text', wajib: false, bisa_diisi: false });
  assert.deepEqual(byName.internal, { nama: 'internal', label: 'Catatan internal', jenis: 'text', wajib: false, bisa_diisi: false });
  assert.deepEqual(byName.title, { nama: 'title', label: 'Judul', jenis: 'text', wajib: true, bisa_diisi: true, maks: 20, isi: 'Diketik pengguna', diisi_pengguna: true });
  assert.deepEqual(byName.priority, { nama: 'priority', label: 'Prioritas', jenis: 'select', wajib: false, bisa_diisi: true, pilihan: ['Rendah', 'Normal', 'Tinggi', 'Mendesak'], isi: 'Tinggi', diisi_ai: true });
  assert.equal(byName.urgent.isi, false);
  assert.doesNotMatch(JSON.stringify(seen), /BCA 123|rahasia|catatan pengguna/);
});

test('without initialValues, the values the form shows right after it opens are the baseline', () => {
  // A dialog resets its fields in an effect AFTER it registers: the first sync takes them.
  const state = { values: { title: 'sisa isian lama', priority: 'urgent' } };
  const registry = createFormRegistry();
  registry.register('f', () => ({
    permission: 'task.create',
    fields: [{ name: 'title', label: 'Judul', type: 'text' }, { name: 'priority', label: 'Prioritas', type: 'select', options: PRIORITIES }],
    getValues: () => state.values, setValues: (patch) => { state.values = { ...state.values, ...patch }; },
  }));
  const entry = registry.get('f');
  state.values = { title: '', priority: 'normal' }; // the page's reset
  syncForm(entry, registry);
  assert.equal(isDirty(entry), false);
  state.values = { ...state.values, title: 'Diketik pengguna' };
  syncForm(entry, registry);
  assert.equal(isDirty(entry), true);
  assert.deepEqual(fillForm(entry, [{ kolom: 'title', isi: 'AI' }, { kolom: 'priority', isi: 'Tinggi' }], { registry }).diisi, ['priority']);
});
