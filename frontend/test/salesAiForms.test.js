import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormRegistry, describeForm, fillFormAsync, syncForm, undoFill } from '../src/components/ai/aiFormModel.js';
import { f } from '../src/components/ai/aiFormFields.js';
import {
  customerFormErrors, customerFormValues, customerLabel, customerOptions, leadFormValues, linesForAI, linesFromAI, productOfToken,
  productOptions, productToken, productTokenName,
} from '../src/pages/sales/salesAiModel.js';
import { itemOptions, itemsFromAI } from '../src/pages/marketing/marketingModel.js';

// Wave C2 (docs/prakasa-ai-rencana.md §9.9): what the Sales and Marketing forms
// hand to Prakasa AI's lookups, and how an order line the AI adds becomes the
// form's own line — with no price.

const CUSTOMERS = [
  { id: 11, name: 'Toko Maju', code: 'C-PR-GT-JKT-0001', channel: 'GT', ownerUserId: 4, phone: '0812-0000-0000' },
  { id: 12, name: 'Toko Maju Jaya', code: 'C-PR-GT-BKS-0007', channel: 'MT', ownerUserId: null },
  { id: 13, name: 'Warung Bu Sri', code: null, channel: 'GT' },
];
const PRODUCTS = [
  { id: 1, skuCode: 'FOD-ABN-100', name: 'Abon Sapi 100 g', price: 32000, lastPrice: 30000 },
  { id: 2, skuCode: 'FOD-ABN-250', name: 'Abon Sapi 250 g', price: 70000, lastPrice: null },
  { id: 3, skuCode: 'FOD-KRP-100', name: 'Keripik Tempe 100 g', price: 15000 },
];

test('customer rows → lookup options: the id stays as the value, the AI sees the name and the ID pelanggan only', () => {
  const options = customerOptions(CUSTOMERS);
  assert.deepEqual(options, [
    { value: 11, label: 'Toko Maju', hint: 'C-PR-GT-JKT-0001' },
    { value: 12, label: 'Toko Maju Jaya', hint: 'C-PR-GT-BKS-0007' },
    { value: 13, label: 'Warung Bu Sri', hint: '' },
  ]);
  assert.doesNotMatch(JSON.stringify(options), /0812|ownerUserId|channel/);
  assert.deepEqual(customerOptions(null), []);
  assert.deepEqual(customerOptions([null, { id: 0, name: 'x' }, { id: 5 }]), []);
  assert.equal(customerLabel(CUSTOMERS[0]), 'Toko Maju — C-PR-GT-JKT-0001');
  assert.equal(customerLabel(CUSTOMERS[2]), 'Warung Bu Sri');
  assert.equal(customerLabel(undefined), '');
});

test('product rows → lookup options: name and SKU, never a price', () => {
  const options = productOptions(PRODUCTS);
  assert.deepEqual(options.map((o) => [o.label, o.hint]), [['Abon Sapi 100 g', 'FOD-ABN-100'], ['Abon Sapi 250 g', 'FOD-ABN-250'], ['Keripik Tempe 100 g', 'FOD-KRP-100']]);
  assert.doesNotMatch(JSON.stringify(options), /32000|30000|70000|15000|price/i);
  assert.deepEqual(productOfToken(options[0].value), { skuCode: 'FOD-ABN-100', productName: 'Abon Sapi 100 g' });
  assert.equal(productTokenName(options[1].value), 'Abon Sapi 250 g');
  assert.equal(productToken('X', ''), '');
  assert.equal(productOfToken('bukan token'), null);
  assert.equal(productTokenName(''), '');
});

test('order lines: read with one `product` value per line, and written back as the form\'s own lines without touching price or PPN', () => {
  const lines = [
    { key: 'a', skuCode: 'FOD-ABN-100', productName: 'Abon Sapi 100 g', qty: '4', unitPrice: '30000', taxable: true },
    { key: 'b', skuCode: '', productName: '', qty: '1', unitPrice: '', taxable: false },
  ];
  const read = linesForAI(lines);
  assert.equal(read[0].product, productToken('FOD-ABN-100', 'Abon Sapi 100 g'));
  assert.equal(read[1].product, '');
  assert.deepEqual(linesFromAI(read), lines, 'a round trip changes nothing');
  // A row the AI added: blank line + { product, qty }.
  const added = { key: 'c', skuCode: '', productName: '', qty: '10', unitPrice: '', taxable: false, product: productToken('FOD-KRP-100', 'Keripik Tempe 100 g') };
  assert.deepEqual(linesFromAI([read[0], added]), [
    lines[0],
    { key: 'c', skuCode: 'FOD-KRP-100', productName: 'Keripik Tempe 100 g', qty: '10', unitPrice: '', taxable: false },
  ]);
  assert.deepEqual(linesFromAI(null), []);
});

// The sales order as SalesOrderForm.jsx registers it, with the page's state.
function orderForm({ customers = CUSTOMERS, products = PRODUCTS } = {}) {
  const emptyLine = () => ({ key: `k${Math.random()}`, skuCode: '', productName: '', qty: '1', unitPrice: '', taxable: false });
  const state = { form: { orderNumber: 'SO-1', orderDate: '2026-10-02', notes: '', deliveryFee: '' }, customer: null, lines: [emptyLine()], searches: [] };
  const search = (rows, map) => async (text) => {
    state.searches.push(text);
    const q = text.toLowerCase();
    return map(rows.filter((row) => `${row.name} ${row.code || row.skuCode || ''}`.toLowerCase().includes(q)));
  };
  const config = {
    title: 'Sales order', permission: 'sales.order.manage',
    initialValues: { customer: null, orderDate: '2026-10-02', notes: '' },
    fields: [
      f.lookup('customer', 'Pelanggan', search(customers, customerOptions), { required: true, emptyValue: null }),
      f.userOnly('orderNumber', 'No. SO'),
      f.date('orderDate', 'Tanggal order', { required: true }),
      f.rows('lines', 'Barang', [
        f.lookup('product', 'Produk', search(products, productOptions), { required: true, labelOf: productTokenName }),
        f.number('qty', 'Qty', { required: true, min: 0.01 }),
        f.userOnly('unitPrice', 'Harga', 'number'),
        f.userOnly('taxable', 'PPN', 'checkbox'),
      ], { required: true, emptyRow: emptyLine, getRows: () => linesForAI(state.lines), setRows: (rows) => { state.lines = linesFromAI(rows); } }),
      f.userOnly('deliveryFee', 'Ongkos kirim', 'number'),
      f.textarea('notes', 'Catatan order'),
    ],
    getValues: () => ({ ...state.form, customer: state.customer }),
    setValues: (patch) => {
      const { customer, ...rest } = patch;
      if ('customer' in patch) state.customer = customer;
      state.form = { ...state.form, ...rest };
    },
  };
  const registry = createFormRegistry();
  registry.register('sales-order', () => config);
  const entry = registry.get('sales-order');
  const render = () => syncForm(entry, registry);
  render();
  return { state, entry, registry, render };
}

test('sales order: exactly one confident match is set; an ambiguous or unknown name is refused with candidates', async () => {
  const form = orderForm();
  // "Toko Maju" is the full name of one customer: set, although another name contains it.
  let result = await fillFormAsync(form.entry, [{ kolom: 'customer', isi: 'Toko Maju' }], { registry: form.registry });
  assert.deepEqual(result.diisi, ['customer']);
  assert.equal(form.state.customer, 11);
  form.render();
  assert.equal(describeForm(form.entry).kolom.find((k) => k.nama === 'customer').isi, 'Toko Maju', 'the AI reads the name back, never the id');
  undoFill(form.entry, form.registry);
  assert.equal(form.state.customer, null);
  form.render();

  // "Toko": two customers hold the word — nothing is set, both go back.
  result = await fillFormAsync(form.entry, [{ kolom: 'customer', isi: 'Toko' }], { registry: form.registry });
  assert.deepEqual(result.diisi, []);
  assert.equal(form.state.customer, null);
  assert.deepEqual(result.ditolak, [{ nama: 'customer', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Toko Maju — C-PR-GT-JKT-0001', 'Toko Maju Jaya — C-PR-GT-BKS-0007'] }]);

  // The ID pelanggan picks one.
  result = await fillFormAsync(form.entry, [{ kolom: 'customer', isi: 'C-PR-GT-BKS-0007' }], { registry: form.registry });
  assert.equal(form.state.customer, 12);

  // A name the search does not know: nothing is invented.
  const other = orderForm();
  result = await fillFormAsync(other.entry, [{ kolom: 'customer', isi: 'Toko Tidak Ada' }], { registry: other.registry });
  assert.equal(other.state.customer, null);
  assert.deepEqual(result.ditolak, [{ nama: 'customer', alasan: 'Tidak ditemukan. Tanyakan nama yang benar ke pengguna.' }]);
});

test('sales order lines: the AI adds product + qty; price and PPN stay empty for the user; a price it sends is refused; the user\'s line is kept', async () => {
  const form = orderForm();
  form.state.lines = [{ key: 'u', skuCode: 'X-1', productName: 'Barang ketikan pengguna', qty: '3', unitPrice: '5000', taxable: true }];
  form.render();
  const result = await fillFormAsync(form.entry, [{
    kolom: 'lines',
    baris: [
      { product: 'Keripik Tempe', qty: '10', unitPrice: '15000', taxable: 'ya' },
      { product: 'FOD-ABN-250', qty: '2' },
      { product: 'Abon Sapi', qty: '1' },
      { product: 'Sambal entah', qty: '1' },
    ],
  }], { registry: form.registry });
  assert.deepEqual(result.diisi, ['lines']);
  assert.deepEqual(result.baris, { lines: 2 });
  assert.deepEqual(form.state.lines.map((l) => [l.skuCode, l.productName, l.qty, l.unitPrice, l.taxable]), [
    ['X-1', 'Barang ketikan pengguna', '3', '5000', true],
    ['FOD-KRP-100', 'Keripik Tempe 100 g', '10', '', false],
    ['FOD-ABN-250', 'Abon Sapi 250 g', '2', '', false],
  ]);
  const refused = Object.fromEntries(result.ditolak.map((x) => [x.nama, x]));
  assert.equal(refused['lines[1].unitPrice'].alasan, 'Kolom ini hanya diisi pengguna.');
  assert.equal(refused['lines[1].taxable'].alasan, 'Kolom ini hanya diisi pengguna.');
  assert.deepEqual(refused['lines[3].product'].kandidat, ['Abon Sapi 100 g — FOD-ABN-100', 'Abon Sapi 250 g — FOD-ABN-250']);
  assert.equal(refused['lines[4].product'].alasan, 'Tidak ditemukan. Tanyakan nama yang benar ke pengguna.');
  assert.doesNotMatch(JSON.stringify(result), /15000|32000|70000|30000/, 'no price goes back to the model');

  form.render();
  const read = describeForm(form.entry).kolom.find((k) => k.nama === 'lines');
  assert.deepEqual(read.baris.map((row) => [row.isi.product, row.isi.qty, Boolean(row.diisi_ai), Boolean(row.diisi_pengguna)]), [
    ['Barang ketikan pengguna', '3', false, true], ['Keripik Tempe 100 g', '10', true, false], ['Abon Sapi 250 g', '2', true, false],
  ]);
  assert.doesNotMatch(JSON.stringify(read), /5000/, 'a price is not read to the model');

  // The user types a price into an AI line: it is theirs now. Undo removes only what is still the AI's.
  form.state.lines = form.state.lines.map((l) => (l.skuCode === 'FOD-ABN-250' ? { ...l, unitPrice: '70000' } : l));
  form.render();
  undoFill(form.entry, form.registry);
  assert.deepEqual(form.state.lines.map((l) => l.productName), ['Barang ketikan pengguna', 'Abon Sapi 250 g']);
});

test('the customer form\'s own rules and opening values', () => {
  assert.deepEqual(customerFormErrors({ name: ' ', cityCode: 'JK' }, 'create'), { name: 'Isi nama customer', cityCode: 'Isi 3 huruf, mis. JKT, TGR, BKS' });
  assert.deepEqual(customerFormErrors({ name: 'Toko', cityCode: 'bks' }, 'convert'), {});
  assert.deepEqual(customerFormErrors({ name: 'Toko', cityCode: '' }, 'edit'), {}, 'an existing customer keeps its ID: no kode kota');
  const edit = customerFormValues('edit', { name: 'Toko Maju', legal_form: 'PT', channel: 'MT', phone: '0812', owner_user_id: 4, city: 'Bekasi' }, null);
  assert.deepEqual([edit.name, edit.legalForm, edit.channel, edit.phone, edit.ownerUserId, edit.city, edit.cityCode], ['Toko Maju', 'PT', 'MT', '0812', '4', 'Bekasi', '']);
  const convert = customerFormValues('convert', null, { name: 'Warung Baru', address: 'Jl. Mawar 1', ownerUserId: 9 });
  assert.deepEqual([convert.name, convert.address, convert.ownerUserId, convert.cityCode, convert.legalForm], ['Warung Baru', 'Jl. Mawar 1', '9', 'JKT', 'PR']);
  assert.deepEqual(leadFormValues({ name: 'Warung', area: 'Depok', latitude: -6.2, ownerUserId: 3 }), { name: 'Warung', address: '', area: 'Depok', latitude: -6.2, longitude: '', ownerUserId: '3', notes: '' });
  assert.equal(leadFormValues(null).name, '');
});

test('campaign target products: Accurate items by name or code; each product once, with the name the search gave', () => {
  const found = [{ itemNo: 'FOD-ABN-100', itemName: 'Abon Sapi 100 g' }, { itemNo: 'FOD-ABN-250', itemName: 'Abon Sapi 250 g' }, { itemNo: 'X-9' }, null, {}];
  assert.deepEqual(itemOptions(found), [
    { value: 'FOD-ABN-100', label: 'Abon Sapi 100 g', hint: 'FOD-ABN-100' },
    { value: 'FOD-ABN-250', label: 'Abon Sapi 250 g', hint: 'FOD-ABN-250' },
    { value: 'X-9', label: 'X-9', hint: 'X-9' },
  ]);
  const names = new Map(found.filter(Boolean).filter((i) => i.itemNo).map((i) => [i.itemNo, i.itemName]));
  assert.deepEqual(itemsFromAI([
    { itemNo: 'FOD-KRP-100', itemName: 'Keripik pilihan pengguna' }, { itemNo: 'FOD-ABN-100' }, { itemNo: 'FOD-ABN-100' }, { itemNo: 'Z-1' }, {}, null,
  ], (itemNo) => names.get(itemNo)), [
    { itemNo: 'FOD-KRP-100', itemName: 'Keripik pilihan pengguna' }, { itemNo: 'FOD-ABN-100', itemName: 'Abon Sapi 100 g' }, { itemNo: 'Z-1', itemName: 'Z-1' },
  ]);
  assert.deepEqual(itemsFromAI(undefined), []);
});
