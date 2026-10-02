// What Prakasa AI needs from the Sales forms' own pickers (Wave C2,
// docs/prakasa-ai-rencana.md §9.9). Pure: no React, no API call — the pages run
// the searches they already make (CustomerPicker, ProductPicker) and hand the
// rows to these mappers. Names and codes are Accurate data: passed through as
// they are, never translated, never invented.

// What the customer picker shows for one row: "Nama — ID".
export const customerLabel = (c) => (c ? (c.code ? `${c.name} — ${c.code}` : c.name) : '');

// GET /sales/customers rows → lookup options. `value` (the id the form holds)
// stays in the browser; the AI sees the name and the ID pelanggan only.
export function customerOptions(rows) {
  return (Array.isArray(rows) ? rows : []).filter((c) => c && c.id && c.name)
    .map((c) => ({ value: c.id, label: String(c.name), hint: c.code ? String(c.code) : '' }));
}

// A product in an order line, as one value: the SKU and the name the line holds.
export const productToken = (skuCode, productName) => (String(productName || '').trim() ? JSON.stringify([String(skuCode || ''), String(productName)]) : '');
export function productOfToken(token) {
  try {
    const [skuCode, productName] = JSON.parse(token);
    return typeof productName === 'string' && productName ? { skuCode: String(skuCode || ''), productName } : null;
  } catch {
    return null;
  }
}
export const productTokenName = (token) => productOfToken(token)?.productName || '';

// GET /sales/products rows → lookup options (name, with the SKU as the hint).
// No price: a line's price is the user's.
export function productOptions(rows) {
  return (Array.isArray(rows) ? rows : []).filter((p) => p && p.name)
    .map((p) => ({ value: productToken(p.skuCode, p.name), label: String(p.name), hint: p.skuCode ? String(p.skuCode) : '' }));
}

// The order form's lines as the AI reads them: each with `product`, the line's
// SKU and name as one value. A line the user retypes gets another value, so it
// stops counting as the AI's.
export const linesForAI = (lines) => (Array.isArray(lines) ? lines : []).map((line) => ({ ...line, product: productToken(line.skuCode, line.productName) }));

// …and back into the form's own shape. A row whose `product` differs from what
// the line holds is one the AI just set: it takes that product's SKU and name.
// Price and PPN are never touched here.
export function linesFromAI(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const { product, ...line } = row || {};
    if (product && product !== productToken(line.skuCode, line.productName)) {
      const found = productOfToken(product);
      if (found) return { ...line, skuCode: found.skuCode, productName: found.productName };
    }
    return line;
  });
}

// The customer form's own rules (create, edit, "jadikan pelanggan").
export function customerFormErrors(form, mode = 'create') {
  const errors = {};
  if (!String(form?.name || '').trim()) errors.name = 'Isi nama customer';
  if (mode !== 'edit' && !/^[A-Za-z]{3}$/.test(String(form?.cityCode || ''))) errors.cityCode = 'Isi 3 huruf, mis. JKT, TGR, BKS';
  return errors;
}

export const EMPTY_CUSTOMER = Object.freeze({
  name: '', legalForm: 'PR', channel: 'GT', cityCode: 'JKT', contactPerson: '', phone: '', businessPhone: '',
  email: '', address: '', city: '', notes: '', ownerUserId: '',
});

// The values the customer form opens with.
export function customerFormValues(mode, customer, lead) {
  if (mode === 'edit' && customer) {
    return {
      name: customer.name || '', legalForm: customer.legal_form || 'PR', channel: customer.channel || '',
      cityCode: '', contactPerson: customer.contact_person || '', phone: customer.phone || '',
      businessPhone: customer.business_phone || '', email: customer.email || '', address: customer.address || '',
      city: customer.city || '', notes: customer.notes || '', ownerUserId: customer.owner_user_id ? String(customer.owner_user_id) : '',
    };
  }
  return {
    ...EMPTY_CUSTOMER,
    name: lead?.name || '', address: lead?.address || '',
    ownerUserId: lead?.ownerUserId ? String(lead.ownerUserId) : '',
  };
}

// The values the lead form opens with.
export function leadFormValues(lead) {
  return {
    name: lead?.name || '', address: lead?.address || '', area: lead?.area || '',
    latitude: lead?.latitude ?? '', longitude: lead?.longitude ?? '',
    ownerUserId: lead?.ownerUserId ? String(lead.ownerUserId) : '', notes: '',
  };
}
