import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ROWS, FIELD_TYPES, MAX_CANDIDATES, REASONS, coerceValue, createFormRegistry, describeForm, fillForm, fillFormAsync, filledCount, isDirty, isRowFilled,
  parseDateTime, parseMonth, pickLookup, recordOf, resolveLookups, syncForm, undoFill,
} from '../src/components/ai/aiFormModel.js';
import { bindAIForm, defineAIForm, f } from '../src/components/ai/aiFormFields.js';

// Wave C2a (docs/prakasa-ai-rencana.md §9.11): rows, lookup / person, the new
// value types, edit forms, and the short way to register a form.

const emptyLine = () => ({ itemName: '', qty: '', unit: '' });
const NOW = Date.parse('2026-10-02T03:00:00Z'); // 2 October 2026, 10:00 WIB

// A form as a page holds it: its own state and its own setter.
function makeForm({ fields, values, initialValues = values, validate = null, mode, record } = {}) {
  const state = { values: structuredClone(values), sets: [] };
  const registry = createFormRegistry();
  const config = {
    title: 'Permintaan ATK', permission: 'ga.request.create', initialValues, fields, mode, record,
    getValues: () => state.values,
    setValues: (patch) => { state.sets.push(patch); state.values = { ...state.values, ...patch }; },
    ...(validate ? { validate } : {}),
  };
  registry.register('form', () => config);
  const entry = registry.get('form');
  const render = () => syncForm(entry, registry);
  render();
  const type = (name, value) => { state.values = { ...state.values, [name]: value }; render(); };
  const typeRow = (name, index, patch) => type(name, state.values[name].map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return { state, registry, entry, config, render, type, typeRow };
}
const ATK_FIELDS = (options = {}) => [
  f.select('locationId', 'Lokasi', [{ value: '1', label: 'Kantor pusat' }, { value: '2', label: 'Gudang' }], { required: true }),
  f.rows('items', 'Daftar barang', [
    f.text('itemName', 'Nama barang', { required: true, maxLength: 20 }),
    f.number('qty', 'Jumlah', { required: true, min: 0.01 }),
    f.text('unit', 'Satuan', { required: true }),
  ], { required: true, emptyRow: emptyLine, ...options }),
  f.textarea('note', 'Catatan'),
];
const atkForm = (rows = [emptyLine()], options = {}) => makeForm({ fields: ATK_FIELDS(options), values: { locationId: '', items: rows, note: '' }, initialValues: { locationId: '', note: '' } });
const fillRows = (form, baris, extra = {}) => {
  const result = fillForm(form.entry, [{ kolom: 'items', baris, ...extra }], { registry: form.registry, now: NOW });
  form.render();
  return result;
};
const reasons = (result) => Object.fromEntries(result.ditolak.map((item) => [item.nama, item.alasan]));

test('rows: the AI\'s rows replace rows that are still empty, and are marked row by row', () => {
  const form = atkForm();
  assert.equal(isDirty(form.entry), false, 'one empty line is not an unsaved change');
  const result = fillRows(form, [{ itemName: 'Kertas A4', qty: '2', unit: 'rim' }, { itemName: 'Spidol', qty: '1,5', unit: 'box' }]);
  assert.deepEqual(result.diisi, ['items']);
  assert.deepEqual(result.baris, { items: 2 });
  assert.deepEqual(result.ditolak, []);
  assert.deepEqual(form.state.values.items, [{ itemName: 'Kertas A4', qty: '2', unit: 'rim' }, { itemName: 'Spidol', qty: '1.5', unit: 'box' }]);
  assert.deepEqual(form.state.sets, [{ items: form.state.values.items }], 'through the form\'s own setter, once');
  assert.deepEqual([isRowFilled(form.entry, 'items', 0), isRowFilled(form.entry, 'items', 1)], [true, true]);
  assert.deepEqual(filledCount(form.entry), { fields: 0, rows: 2 });
  assert.equal(isDirty(form.entry), true);
  const seen = describeForm(form.entry).kolom.find((k) => k.nama === 'items');
  assert.deepEqual(seen.kolom_baris.map((k) => [k.nama, k.jenis, k.wajib]), [['itemName', 'text', true], ['qty', 'number', true], ['unit', 'text', true]]);
  assert.deepEqual([seen.maks_baris, seen.boleh_tambah], [DEFAULT_MAX_ROWS, true]);
  assert.deepEqual(seen.baris, [{ no: 1, isi: { itemName: 'Kertas A4', qty: '2', unit: 'rim' }, diisi_ai: true }, { no: 2, isi: { itemName: 'Spidol', qty: '1.5', unit: 'box' }, diisi_ai: true }]);
});

test('rows: a row the user entered is never changed and never removed — by a fill, a replace or an undo', () => {
  const user = { itemName: 'Pulpen biru', qty: '5', unit: 'pcs' };
  const form = atkForm([user, emptyLine()]);
  let result = fillRows(form, [{ itemName: 'Kertas A4', qty: '2', unit: 'rim' }]);
  assert.deepEqual(result.baris, { items: 1 });
  assert.deepEqual(form.state.values.items, [user, { itemName: 'Kertas A4', qty: '2', unit: 'rim' }], 'the user\'s row stays first; the empty line made room');
  assert.deepEqual([isRowFilled(form.entry, 'items', 0), isRowFilled(form.entry, 'items', 1)], [false, true]);

  // Append again: the AI's earlier row stays too.
  fillRows(form, [{ itemName: 'Spidol', qty: '1', unit: 'box' }]);
  assert.deepEqual(form.state.values.items.map((row) => row.itemName), ['Pulpen biru', 'Kertas A4', 'Spidol']);

  // The user corrects one of the AI's rows: it is the user's now.
  form.typeRow('items', 1, { qty: '3' });
  assert.deepEqual([0, 1, 2].map((index) => isRowFilled(form.entry, 'items', index)), [false, false, true]);
  assert.deepEqual(filledCount(form.entry), { fields: 0, rows: 1 });

  // "ganti" replaces only what is still the AI's.
  result = fillRows(form, [{ itemName: 'Lakban', qty: '4', unit: 'pcs' }], { cara: 'ganti' });
  assert.deepEqual(form.state.values.items.map((row) => `${row.itemName}:${row.qty}`), ['Pulpen biru:5', 'Kertas A4:3', 'Lakban:4']);
  const described = describeForm(form.entry).kolom.find((k) => k.nama === 'items').baris;
  assert.deepEqual(described.map((row) => [row.no, row.diisi_ai === true, row.diisi_pengguna === true]), [[1, false, true], [2, false, true], [3, true, false]]);

  // Undo: the AI's row goes, both user rows stay as they are.
  assert.deepEqual(undoFill(form.entry, form.registry), ['items']);
  form.render();
  assert.deepEqual(form.state.values.items, [user, { itemName: 'Kertas A4', qty: '3', unit: 'rim' }]);
  assert.deepEqual(filledCount(form.entry), { fields: 0, rows: 0 });
  // No cell of a user row was ever written by a fill.
  for (const patch of form.state.sets) assert.deepEqual(patch.items[0], user);
});

test('rows: undo on a form the AI filled alone restores the empty line it found', () => {
  const form = atkForm();
  fillRows(form, [{ itemName: 'Kertas A4', qty: '2', unit: 'rim' }]);
  undoFill(form.entry, form.registry);
  form.render();
  assert.deepEqual(form.state.values.items, [emptyLine()]);
  assert.equal(isDirty(form.entry), false);
  // Undo before the form has rendered the fill.
  const pending = atkForm();
  fillForm(pending.entry, [{ kolom: 'items', baris: [{ itemName: 'Kertas', qty: '1', unit: 'rim' }] }], { registry: pending.registry });
  undoFill(pending.entry, pending.registry);
  assert.deepEqual(pending.state.values.items, [emptyLine()]);
});

test('rows: every cell follows the field rules — forbidden names, user-only columns, types, required', () => {
  const fields = [f.rows('items', 'Baris', [
    f.text('itemName', 'Nama barang', { required: true, maxLength: 20 }),
    f.number('qty', 'Jumlah', { required: true, min: 0.5, max: 100, step: 0.5 }),
    f.text('unit', 'Satuan'),
    f.number('unitPrice', 'Harga', { aiFillable: false }),
    f.text('vendorBank', 'Bank'), // by name, whatever the page says
    f.text('apiToken', 'Token'),
    f.text('photo', 'Foto'),
    f.rows('nested', 'x', [f.text('a', 'A')]),
  ], { emptyRow: () => ({ itemName: '', qty: '', unit: '', unitPrice: '', vendorBank: '', apiToken: '', photo: '' }) })];
  const form = makeForm({ fields, values: { items: [] } });
  const described = describeForm(form.entry).kolom[0];
  assert.deepEqual(described.kolom_baris.map((k) => [k.nama, k.bisa_diisi]), [['itemName', true], ['qty', true], ['unit', true], ['unitPrice', false], ['vendorBank', false], ['photo', false]]);
  assert.deepEqual([described.kolom_baris[1].min, described.kolom_baris[1].maks_angka, described.kolom_baris[1].kelipatan], [0.5, 100, 0.5]);

  const result = fillRows(form, [
    { itemName: 'Kertas A4', qty: '2', unit: 'rim', unitPrice: '55000', vendorBank: 'BCA', apiToken: 'abc', photo: 'x.png', nested: 'x', warna: 'putih' },
    { itemName: 'Spidol', qty: 'banyak' }, // required cell refused: the row is not added
    { qty: '3', unit: 'pcs' }, // required column missing
    { itemName: 'Nama barang yang jauh terlalu panjang', qty: '1' },
    { itemName: 'Lakban', qty: '250' },
    { itemName: 'Map', qty: '0.7' },
    { unit: '' },
    'bukan baris',
  ]);
  assert.deepEqual(form.state.values.items, [{ itemName: 'Kertas A4', qty: '2', unit: 'rim', unitPrice: '', vendorBank: '', apiToken: '', photo: '' }]);
  assert.deepEqual(reasons(result), {
    'items[1].unitPrice': REASONS.userOnly,
    'items[1].vendorBank': REASONS.userOnly,
    'items[1].apiToken': REASONS.userOnly,
    'items[1].photo': REASONS.userOnly,
    'items[1].nested': REASONS.unknown,
    'items[1].warna': REASONS.unknown,
    'items[2].qty': REASONS.number,
    'items[3]': 'Kolom "Nama barang" wajib diisi di tiap baris.',
    'items[4].itemName': 'Paling banyak 20 karakter.',
    'items[5].qty': 'Paling besar 100.',
    'items[6].qty': 'Isi harus kelipatan 0.5.',
    'items[7]': 'Kolom "Nama barang" wajib diisi di tiap baris.',
    'items[8]': REASONS.emptyRow,
  });
  // The wrong shape for the field.
  assert.deepEqual(reasons(fillForm(form.entry, [{ kolom: 'items', isi: 'Kertas' }])), { items: REASONS.needRows });
  const plain = atkForm();
  assert.deepEqual(reasons(fillForm(plain.entry, [{ kolom: 'note', baris: [{ a: 'x' }] }])), { note: REASONS.notRows });
});

test('rows are capped: maxRows counts the user\'s rows, and a fixed list takes no new row', () => {
  const user = Array.from({ length: 3 }, (_, i) => ({ itemName: `Milik pengguna ${i}`, qty: '1', unit: 'pcs' }));
  const form = atkForm(user, { maxRows: 5 });
  const result = fillRows(form, Array.from({ length: 4 }, (_, i) => ({ itemName: `AI ${i}`, qty: '1', unit: 'pcs' })));
  assert.equal(form.state.values.items.length, 5);
  assert.deepEqual(form.state.values.items.slice(0, 3), user);
  assert.deepEqual(result.baris, { items: 2 });
  assert.equal(reasons(result).items, 'Paling banyak 5 baris; 2 baris tidak ditambahkan.');
  // No room at all: nothing is set.
  const full = atkForm(user, { maxRows: 3 });
  const none = fillRows(full, [{ itemName: 'AI', qty: '1', unit: 'pcs' }]);
  assert.deepEqual([none.diisi, full.state.sets], [[], []]);

  // allowAdd: false — only rows that are still empty take a value, in place.
  const fixed = atkForm([{ itemName: 'Pengguna', qty: '1', unit: 'pcs', key: 'a' }, { ...emptyLine(), key: 'b' }], { allowAdd: false });
  const filled = fillRows(fixed, [{ itemName: 'AI 1', qty: '2', unit: 'rim' }, { itemName: 'AI 2', qty: '2', unit: 'rim' }]);
  assert.deepEqual(fixed.state.values.items, [{ itemName: 'Pengguna', qty: '1', unit: 'pcs', key: 'a' }, { itemName: 'AI 1', qty: '2', unit: 'rim', key: 'b' }]);
  assert.match(reasons(filled).items, /tidak mengizinkan baris baru\. 1 baris tidak dipakai/);
  assert.equal(describeForm(fixed.entry).kolom.find((k) => k.nama === 'items').boleh_tambah, false);
  undoFill(fixed.entry, fixed.registry);
  assert.deepEqual(fixed.state.values.items, [{ itemName: 'Pengguna', qty: '1', unit: 'pcs', key: 'a' }, { ...emptyLine(), key: 'b' }], 'the slot is emptied, not removed');
});

test('rows kept outside the form\'s values go through getRows / setRows; the form\'s validation still decides', () => {
  const lines = { rows: [emptyLine()], sets: 0 };
  const form = makeForm({
    values: { note: '' },
    fields: [
      f.rows('items', 'Daftar barang', [f.text('itemName', 'Nama barang', { required: true }), f.number('qty', 'Jumlah')], {
        emptyRow: emptyLine, getRows: () => lines.rows, setRows: (rows) => { lines.sets += 1; lines.rows = rows; },
      }),
      f.textarea('note', 'Catatan'),
    ],
    validate: (values) => (values.items.some((row) => row.itemName === 'Rokok') ? { items: 'Barang itu tidak boleh diminta.' } : {}),
  });
  const ok = fillForm(form.entry, [{ kolom: 'items', baris: [{ itemName: 'Kertas', qty: '2' }] }, { kolom: 'note', isi: 'Untuk rapat' }], { registry: form.registry });
  form.render();
  assert.deepEqual(ok.diisi, ['items', 'note']);
  assert.deepEqual(lines.rows, [{ itemName: 'Kertas', qty: '2', unit: '' }]);
  assert.deepEqual(form.state.sets, [{ note: 'Untuk rapat' }], 'rows never pass through setValues here');
  assert.equal(isDirty(form.entry), true);
  const refused = fillForm(form.entry, [{ kolom: 'items', baris: [{ itemName: 'Rokok', qty: '1' }] }], { registry: form.registry });
  assert.deepEqual([refused.diisi, reasons(refused).items, lines.rows.length], [[], 'Barang itu tidak boleh diminta.', 1]);
  undoFill(form.entry, form.registry);
  assert.deepEqual(lines.rows, [emptyLine()]);

  // A line the user left half-typed is the user's to finish: the complaint the
  // form already had does not refuse the AI's rows — it is reported as still needed.
  const half = makeForm({
    values: { items: [{ itemName: 'Pulpen', qty: '', unit: '' }] },
    fields: [f.rows('items', 'Daftar barang', [f.text('itemName', 'Nama barang', { required: true }), f.number('qty', 'Jumlah'), f.text('unit', 'Satuan')], { emptyRow: emptyLine })],
    validate: (values) => (values.items.some((row) => row.itemName && !row.qty) ? { items: 'Setiap barang perlu jumlah.' } : {}),
  });
  const added = fillForm(half.entry, [{ kolom: 'items', baris: [{ itemName: 'Kertas', qty: '2', unit: 'rim' }] }], { registry: half.registry });
  assert.deepEqual([added.diisi, added.ditolak, added.masih_perlu], [['items'], [], [{ nama: 'items', alasan: 'Setiap barang perlu jumlah.' }]]);
  assert.deepEqual(half.state.values.items.map((row) => row.itemName), ['Pulpen', 'Kertas']);
  // …but a row of the AI's that breaks the rule itself is still refused.
  const own = fillForm(atkLike().entry, [{ kolom: 'items', baris: [{ itemName: 'Kertas' }] }]);
  assert.deepEqual([own.diisi, own.ditolak], [[], [{ nama: 'items', alasan: 'Setiap barang perlu jumlah.' }]]);
  function atkLike() {
    return makeForm({
      values: { items: [emptyLine()] },
      fields: [f.rows('items', 'Daftar barang', [f.text('itemName', 'Nama barang', { required: true }), f.number('qty', 'Jumlah')], { emptyRow: emptyLine })],
      validate: (values) => (values.items.some((row) => row.itemName && !row.qty) ? { items: 'Setiap barang perlu jumlah.' } : {}),
    });
  }
});

// ---------------------------------------------------------------- lookup

const CUSTOMERS = [
  { id: 11, name: 'Toko Maju', code: 'C-011', city: 'Bandung' },
  { id: 12, name: 'Toko Maju Jaya', code: 'C-012', city: 'Bekasi' },
  { id: 13, name: 'Warung Bu Sri', code: 'C-013', city: 'Depok' },
];
// The page's own search (the same call its autocomplete makes).
function searcher(list = CUSTOMERS) {
  const calls = [];
  const search = async (text) => {
    calls.push(text);
    const wanted = text.toLowerCase();
    return list.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(wanted) || wanted.split(' ').some((word) => c.name.toLowerCase().includes(word)))
      .map((c) => ({ value: c, label: c.name, hint: `${c.code} · ${c.city}` }));
  };
  return { calls, search };
}
function lookupForm(search, extra = {}) {
  return makeForm({
    values: { customer: null, pic: '', title: '', lines: [] },
    initialValues: { customer: null, pic: '', title: '' },
    fields: [
      f.lookup('customer', 'Pelanggan', search, { required: true, labelOf: (c) => c?.name, emptyValue: null, ...extra }),
      f.text('title', 'Judul'),
      f.rows('lines', 'Baris', [f.lookup('product', 'Produk', search, { required: true }), f.number('qty', 'Jumlah')], { emptyRow: () => ({ product: null, qty: '' }) }),
    ],
  });
}
const fillAsync = async (form, isian, options) => {
  const result = await fillFormAsync(form.entry, isian, { registry: form.registry, ...options });
  form.render();
  return result;
};

test('lookup: exactly one confident match is set — the record stays on the page, only its label is read back', async () => {
  const { search, calls } = searcher();
  const form = lookupForm(search);
  const result = await fillAsync(form, [{ kolom: 'customer', isi: 'Warung Bu Sri' }, { kolom: 'title', isi: 'SO baru' }]);
  assert.deepEqual(result.diisi, ['customer', 'title']);
  assert.equal(form.state.values.customer, CUSTOMERS[2], 'the option\'s own value, as the page\'s picker would set it');
  assert.deepEqual(calls, ['Warung Bu Sri']);
  const seen = describeForm(form.entry).kolom[0];
  assert.deepEqual([seen.jenis, seen.isi, seen.diisi_ai], ['lookup', 'Warung Bu Sri', true]);
  assert.doesNotMatch(JSON.stringify(describeForm(form.entry)), /"id":13|C-013/, 'no hidden id leaves the page');
  assert.doesNotMatch(JSON.stringify(result), /13|C-013/);
  // A code typed exactly (the hint the page shows) is a confident match too.
  assert.deepEqual(pickLookup({ type: 'lookup' }, 'B 1234 XY', [{ value: 1, label: 'Avanza putih', hint: 'B 1234 XY' }, { value: 2, label: 'Avanza hitam', hint: 'B 9 Z' }]), { ok: true, value: 1, label: 'Avanza putih' });
  // Undo gives back what was there.
  undoFill(form.entry, form.registry);
  assert.equal(form.state.values.customer, null);
});

test('lookup: several matches or none are NOT set; the candidates (at most 5 labels) go back so the AI can ask', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, name: `Toko Sumber ${i}`, code: `S-${i}`, city: 'Bogor' }));
  const { search } = searcher([...CUSTOMERS, ...many]);
  const form = lookupForm(search);
  let result = await fillAsync(form, [{ kolom: 'customer', isi: 'Toko Sumber' }]);
  assert.deepEqual(result.diisi, []);
  assert.equal(form.state.values.customer, null);
  assert.equal(result.ditolak[0].alasan, REASONS.lookupMany);
  assert.equal(result.ditolak[0].kandidat.length, MAX_CANDIDATES);
  assert.equal(result.ditolak[0].kandidat[0], 'Toko Sumber 0 — S-0 · Bogor');
  assert.equal(JSON.stringify(result).includes('"id"'), false);

  // "Toko Maju" is exactly one label, although "Toko Maju Jaya" contains it.
  result = await fillAsync(form, [{ kolom: 'customer', isi: 'toko maju' }]);
  assert.deepEqual(result.diisi, ['customer']);
  assert.equal(form.state.values.customer.id, 11);

  // Nothing found; a loose result that does not hold the words; a text too short; a search that fails or hangs.
  const fresh = () => lookupForm(search);
  assert.deepEqual((await fillAsync(fresh(), [{ kolom: 'customer', isi: 'Apotek Sehat' }])).ditolak, [{ nama: 'customer', alasan: REASONS.lookupNone }]);
  const loose = await fillAsync(fresh(), [{ kolom: 'customer', isi: 'Toko Makmur' }]);
  assert.deepEqual([loose.diisi, loose.ditolak[0].alasan, loose.ditolak[0].kandidat.length], [[], REASONS.lookupLoose, 5]);
  assert.deepEqual((await fillAsync(fresh(), [{ kolom: 'customer', isi: 'T' }])).ditolak, [{ nama: 'customer', alasan: REASONS.lookupShort }]);
  const broken = lookupForm(async () => { throw new Error('500'); });
  assert.deepEqual((await fillAsync(broken, [{ kolom: 'customer', isi: 'Toko Maju' }])).ditolak, [{ nama: 'customer', alasan: REASONS.lookupFailed }]);
  const hanging = lookupForm(() => new Promise(() => {}));
  assert.deepEqual((await fillAsync(hanging, [{ kolom: 'customer', isi: 'Toko Maju' }], { searchMs: 5 })).ditolak, [{ nama: 'customer', alasan: REASONS.lookupFailed }]);
  // A lookup without the page's search cannot be filled at all, and a plain fill never guesses one.
  const none = lookupForm(undefined);
  assert.equal(describeForm(none.entry).kolom[0].bisa_diisi, false);
  assert.deepEqual(reasons(fillForm(fresh().entry, [{ kolom: 'customer', isi: 'Warung Bu Sri' }])), { customer: REASONS.lookupFailed });
});

test('lookup: what the user chose is not searched and not replaced; lookups inside rows follow the same rule', async () => {
  const { search, calls } = searcher();
  const form = lookupForm(search);
  form.type('customer', CUSTOMERS[0]); // the user picked one
  const result = await fillAsync(form, [
    { kolom: 'customer', isi: 'Warung Bu Sri' },
    { kolom: 'lines', baris: [{ product: 'Warung Bu Sri', qty: '2' }, { product: 'Toko', qty: '1' }, { product: 'C-012', qty: '3' }] },
  ]);
  assert.equal(form.state.values.customer, CUSTOMERS[0]);
  assert.equal(reasons(result).customer, REASONS.userValue);
  assert.deepEqual(calls, ['Warung Bu Sri', 'Toko', 'C-012'], 'no search for a field the user already filled');
  assert.deepEqual(form.state.values.lines, [{ product: CUSTOMERS[2], qty: '2' }, { product: CUSTOMERS[1], qty: '3' }]);
  const second = result.ditolak.find((item) => item.nama === 'lines[2].product');
  assert.equal(second.alasan, REASONS.lookupMany);
  assert.deepEqual(second.kandidat, ['Toko Maju — C-011 · Bandung', 'Toko Maju Jaya — C-012 · Bekasi']);
  assert.deepEqual(describeForm(form.entry).kolom.find((k) => k.nama === 'lines').baris.map((row) => row.isi), [{ product: '(sudah dipilih)', qty: '2' }, { product: '(sudah dipilih)', qty: '3' }]);

  // Searches are capped per call.
  const found = await resolveLookups(form.entry, [{ kolom: 'lines', baris: Array.from({ length: 14 }, () => ({ product: 'Warung Bu Sri' })) }]);
  assert.deepEqual([...found.values()].filter((item) => item.alasan === REASONS.lookupTooMany).length, 2);
});

test('person: an employee from the page\'s directory search — work contact only', async () => {
  const people = [
    { value: 'p-7', label: 'Budi Santoso', hint: 'IT · Staff · 0812-3456-7890 · NIK 3201012345678901' },
    { value: 'p-8', label: 'Budi Hartono', hint: 'Sales · Supervisor' },
    { value: 'p-9', label: 'Citra Lestari', hint: 'Finance · citra@prakasa.example' },
  ];
  const form = makeForm({
    values: { assignee: '' },
    fields: [f.person('assignee', 'Penanggung jawab', async (text) => people.filter((p) => p.label.toLowerCase().includes(text.toLowerCase().split(' ')[0])))],
  });
  const ambiguous = await fillAsync(form, [{ kolom: 'assignee', isi: 'Budi' }]);
  assert.deepEqual(ambiguous.diisi, []);
  assert.deepEqual(ambiguous.ditolak[0].kandidat, ['Budi Santoso — IT · Staff · · NIK', 'Budi Hartono — Sales · Supervisor']);
  assert.doesNotMatch(JSON.stringify(ambiguous), /0812|3201012345678901/, 'a phone or ID number never leaves the page');
  const one = await fillAsync(form, [{ kolom: 'assignee', isi: 'Citra Lestari' }]);
  assert.deepEqual(one.diisi, ['assignee']);
  assert.equal(form.state.values.assignee, 'p-9');
  assert.equal(describeForm(form.entry).kolom[0].jenis, 'person');
});

// ---------------------------------------------------------------- edit

test('edit form: a loaded value may be changed (and undone); what the user changed in this session is never overwritten', () => {
  const loaded = { title: 'Wifi lambat', description: 'Sejak Senin', priority: 'normal', dueDate: '2026-10-09', code: 'IT-0041' };
  const form = makeForm({
    mode: 'edit', record: { type: 'it_ticket', id: 41 },
    values: loaded, initialValues: loaded,
    fields: [
      f.text('title', 'Judul', { required: true }), f.textarea('description', 'Deskripsi'),
      f.select('priority', 'Prioritas', [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'Tinggi' }]),
      f.date('dueDate', 'Jatuh tempo'), f.readOnly('code', 'Nomor'),
    ],
  });
  assert.equal(isDirty(form.entry), false);
  form.type('description', 'Sejak Senin, lantai 2 saja'); // the user edits in this session
  const result = fillForm(form.entry, [
    { kolom: 'title', isi: 'Wifi lantai 2 lambat' }, { kolom: 'description', isi: 'ditimpa?' }, { kolom: 'priority', isi: 'Tinggi' }, { kolom: 'code', isi: 'IT-9999' },
  ], { registry: form.registry });
  form.render();
  assert.deepEqual(result.diisi, ['title', 'priority']);
  assert.deepEqual(reasons(result), { description: REASONS.userValue, code: REASONS.readOnly });
  assert.equal(form.state.values.description, 'Sejak Senin, lantai 2 saja');
  assert.equal(form.state.values.code, 'IT-0041');
  const described = describeForm(form.entry);
  assert.deepEqual([described.mode, described.rekaman], ['ubah', { jenis: 'it_ticket', id: '41' }]);
  const byName = Object.fromEntries(described.kolom.map((k) => [k.nama, k]));
  assert.deepEqual([byName.title.diisi_ai, byName.description.diisi_pengguna, byName.dueDate.diisi_pengguna, byName.dueDate.isi], [true, true, undefined, '2026-10-09']);
  assert.deepEqual([byName.code.bisa_diisi, byName.code.hanya_baca, byName.code.isi], [false, true, 'IT-0041']);

  // The AI may correct its own value; then the user takes the field over.
  assert.deepEqual(fillForm(form.entry, [{ kolom: 'title', isi: 'Wifi lantai 2 putus' }], { registry: form.registry }).diisi, ['title']);
  form.render();
  form.type('title', 'Wifi lantai 2 putus-putus');
  assert.deepEqual(reasons(fillForm(form.entry, [{ kolom: 'title', isi: 'lagi' }])), { title: REASONS.userValue });

  // Undo: the loaded value comes back where the AI's value still stands; the user's edits stay.
  assert.deepEqual(undoFill(form.entry, form.registry), ['priority']);
  assert.deepEqual([form.state.values.priority, form.state.values.title, form.state.values.description], ['normal', 'Wifi lantai 2 putus-putus', 'Sejak Senin, lantai 2 saja']);

  assert.deepEqual(recordOf({ mode: 'edit', record: { type: 'it_ticket', id: 41 } }), { type: 'it_ticket', id: '41' });
  for (const record of [null, {}, { type: 'it_ticket' }, { type: 'It Ticket', id: 1 }, { type: 'task', id: '../1' }, { type: 'task', id: {} }]) assert.equal(recordOf({ mode: 'edit', record }), null);
  assert.equal(recordOf({ record: { type: 'task', id: 1 } }), null, 'a create form names no record');
});

// ---------------------------------------------------------------- value types

test('datetime, month, multiselect and number limits are read as the field holds them', () => {
  const at = (raw) => parseDateTime(raw, NOW);
  assert.equal(at('2026-10-05 14:00'), '2026-10-05T14:00');
  assert.equal(at('2026-10-05T09:30'), '2026-10-05T09:30');
  assert.equal(at('besok 9.30'), '2026-10-03T09:30');
  assert.equal(at('5 Oktober 2026 jam 14'), '2026-10-05T14:00');
  assert.equal(at('05/10/2026, pukul 08:15 WIB'), '2026-10-05T08:15');
  assert.equal(at('2026-10-05T07:00:00Z'), '2026-10-05T14:00', 'a moment with a zone is read in WIB');
  assert.equal(at('2026-10-05T23:30:00+07:00'), '2026-10-05T23:30');
  for (const bad of ['2026-10-05', 'besok', 'jam 9', '2026-13-01 10:00', '2026-10-05 25:00', '']) assert.equal(at(bad), null, bad);

  const month = (raw) => parseMonth(raw, NOW);
  assert.deepEqual(['2026-10', '10/2026', 'Oktober 2026', 'okt 2026', 'bulan ini', 'bulan depan', 'bulan lalu', '2026-10-17'].map(month), ['2026-10', '2026-10', '2026-10', '2026-10', '2026-10', '2026-11', '2026-09', '2026-10']);
  assert.equal(parseMonth('bulan depan', Date.parse('2026-12-15T05:00:00Z')), '2027-01');
  for (const bad of ['2026-13', 'kapan-kapan', '13/2026']) assert.equal(month(bad), null, bad);

  const DAYS = [{ value: 'mon', label: 'Senin' }, { value: 'tue', label: 'Selasa' }, { value: 'wed', label: 'Rabu' }];
  const multi = f.multiselect('days', 'Hari', DAYS);
  assert.deepEqual(coerceValue(multi, 'Senin; Rabu'), { ok: true, value: ['mon', 'wed'] });
  assert.deepEqual(coerceValue(multi, 'senin, selasa, senin'), { ok: true, value: ['mon', 'tue'] });
  assert.deepEqual(coerceValue(multi, '["Rabu"]'), { ok: true, value: ['wed'] });
  assert.deepEqual(coerceValue(multi, 'Senin; Minggu'), { ok: false, alasan: 'Pilihan "Minggu" tidak ada di kolom ini.' });
  assert.deepEqual(coerceValue(multi, ''), { ok: true, value: [] });
  assert.deepEqual(coerceValue({ ...multi, required: true }, ''), { ok: false, alasan: REASONS.required });
  assert.deepEqual(coerceValue(f.datetime('at', 'Waktu'), 'besok 09:00', { now: NOW }), { ok: true, value: '2026-10-03T09:00' });
  assert.deepEqual(coerceValue(f.datetime('at', 'Waktu'), 'besok'), { ok: false, alasan: REASONS.dateTime });
  assert.deepEqual(coerceValue(f.month('period', 'Periode'), 'November 2026'), { ok: true, value: '2026-11' });
  assert.deepEqual(coerceValue(f.month('period', 'Periode'), 'x'), { ok: false, alasan: REASONS.month });

  const percent = f.number('progress', 'Progres', { min: 0, max: 100, step: 1 });
  assert.deepEqual(coerceValue(percent, '50'), { ok: true, value: '50' });
  assert.deepEqual(coerceValue(percent, '-1'), { ok: false, alasan: 'Paling kecil 0.' });
  assert.deepEqual(coerceValue(percent, '101'), { ok: false, alasan: 'Paling besar 100.' });
  assert.deepEqual(coerceValue(percent, '12,5'), { ok: false, alasan: 'Isi harus bilangan bulat.' });
  assert.deepEqual(coerceValue(f.rupiah('amount', 'Subtotal'), 'Rp 250.000'), { ok: true, value: '250000' });
  assert.deepEqual(coerceValue(f.rupiah('amount', 'Subtotal'), '-5'), { ok: false, alasan: 'Paling kecil 0.' });

  // In a form: a multiselect holds a list; an empty list is "not filled"; the AI reads labels.
  const form = makeForm({ values: { days: [], amount: '', period: '' }, fields: [multi, f.rupiah('amount', 'Subtotal', { hint: 'Rupiah.' }), f.month('period', 'Periode')] });
  assert.deepEqual(fillForm(form.entry, [{ kolom: 'days', isi: 'Selasa; Rabu' }, { kolom: 'amount', isi: '1.250.000' }, { kolom: 'period', isi: 'bulan depan' }], { now: NOW, registry: form.registry }).diisi, ['days', 'amount', 'period']);
  form.render();
  assert.deepEqual(form.state.values, { days: ['tue', 'wed'], amount: '1250000', period: '2026-11' });
  const described = Object.fromEntries(describeForm(form.entry).kolom.map((k) => [k.nama, k]));
  assert.deepEqual([described.days.isi, described.days.pilihan, described.amount.mata_uang, described.amount.min], ['Selasa; Rabu', ['Senin', 'Selasa', 'Rabu'], 'rupiah', 0]);
  form.type('days', ['mon']);
  assert.deepEqual(reasons(fillForm(form.entry, [{ kolom: 'days', isi: 'Rabu' }])), { days: REASONS.userValue });
  assert.ok(['datetime', 'month', 'multiselect', 'lookup', 'person', 'rows'].every((type) => FIELD_TYPES.includes(type)));
});

// ---------------------------------------------------------------- helpers

test('defineAIForm + bindAIForm: a form registers from its own state in a few lines', () => {
  const DEF = defineAIForm({
    id: 'ga-resource', title: 'Sumber daya GA', permission: 'ga.resource.manage', submitLabel: 'Simpan',
    fields: ({ locations }) => [f.text('name', 'Nama', { required: true }), f.select('locationId', 'Lokasi', locations), f.userOnly('plateNumber', 'Nomor polisi')],
  });
  assert.equal(Object.isFrozen(DEF), true);
  let values = { name: '', locationId: '', plateNumber: '' };
  let errors = { name: 'Tulis nama.', locationId: 'Pilih lokasi.' };
  const touched = [];
  const config = bindAIForm(DEF, {
    enabled: true, values, initialValues: values, context: { locations: [{ value: '1', label: 'Kantor pusat' }] },
    setValues: (update) => { values = update(values); }, setErrors: (update) => { errors = update(errors); }, onFill: (patch) => touched.push(Object.keys(patch)),
  });
  assert.deepEqual([config.id, config.title, config.permission, config.submitLabel, config.mode, config.enabled], ['ga-resource', 'Sumber daya GA', 'ga.resource.manage', 'Simpan', 'create', true]);
  assert.deepEqual(config.fields.map((field) => [field.name, field.type, field.aiFillable]), [['name', 'text', undefined], ['locationId', 'select', undefined], ['plateNumber', 'text', false]]);
  config.setValues({ name: 'Ruang rapat' });
  assert.deepEqual([values.name, errors.name, errors.locationId, touched], ['Ruang rapat', undefined, 'Pilih lokasi.', [['name']]]);
  assert.equal(Object.keys(config).some((key) => /submit$|save|send/i.test(key) && key !== 'submitLabel'), false, 'a registration holds no way to save');

  // One state per field, and a form with its own apply().
  const single = { title: '', due: '' };
  const perField = bindAIForm(defineAIForm({ id: 'a', title: 'A', permission: 'a.b', fields: [f.text('title', 'Judul'), f.date('due', 'Tanggal')] }), {
    values: single, setters: { title: (value) => { single.title = value; }, due: (value) => { single.due = value; } },
  });
  perField.setValues({ title: 'x', due: '2026-10-05' });
  assert.deepEqual(single, { title: 'x', due: '2026-10-05' });
  const applied = [];
  bindAIForm(DEF, { values, apply: (patch) => applied.push(patch), context: { locations: [] } }).setValues({ name: 'y' });
  assert.deepEqual(applied, [{ name: 'y' }]);

  // An edit form registers only once its record is known.
  const EDIT = defineAIForm({ id: 'ga-resource-edit', title: 'Ubah sumber daya', permission: 'ga.resource.manage', mode: 'edit', fields: [f.text('name', 'Nama')] });
  assert.equal(bindAIForm(EDIT, { enabled: true, values }).enabled, false);
  const bound = bindAIForm(EDIT, { enabled: true, values, record: { type: 'ga_resource', id: 5 } });
  assert.deepEqual([bound.enabled, bound.mode, bound.record], [true, 'edit', { type: 'ga_resource', id: 5 }]);

  assert.throws(() => defineAIForm({ id: 'x', title: 'X', fields: [] }), /permission wajib/);
  assert.throws(() => defineAIForm({ id: 'bad id', title: 'X', permission: 'a.b' }), /id/);
  assert.throws(() => defineAIForm({ id: 'x', title: 'X', permission: 'a.b', mode: 'delete' }), /mode/);
});
