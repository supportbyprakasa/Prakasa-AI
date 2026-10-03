// The ONLY way this codebase may talk to Accurate Online — and it can only read.
//
// Owner's rule (2026-09-29): nothing is ever executed on Accurate data except
// the integration, and the integration only reads. Accurate is the books;
// this app mirrors it. So every request goes through assertReadOnlyRequest():
//
//   allowed  GET https://account.accurate.id/api/db-list.do          (which databases)
//            GET https://account.accurate.id/api/open-db.do          (open a read session)
//            GET https://<host>.accurate.id/accurate/api/<resource>/<read action>.do
//              only the resources and read actions listed in READ_ENDPOINTS
//              (list/detail, plus named read endpoints such as item/list-stock
//              or glaccount/get-balance)
//            POST https://account.accurate.id/oauth/token            (sign-in only, no data)
//   built    https://account.accurate.id/oauth/authorize — a URL the Super
//            Admin's BROWSER opens to grant access; the server never requests
//            it, and it can only ask for read (*_view) scopes.
//   refused  anything else: every POST/PUT/PATCH/DELETE to data, save.do,
//            bulk-save.do, delete.do, any other action, any other resource,
//            any host outside accurate.id, and redirects that leave those rules.
//
// Do not add a write path here. If a feature seems to need one, it belongs in
// Accurate itself — stop and ask the owner.

const ACCOUNT_HOST = 'account.accurate.id';
const TOKEN_URL = `https://${ACCOUNT_HOST}/oauth/token`;
const AUTHORIZE_URL = `https://${ACCOUNT_HOST}/oauth/authorize`;
const DB_LIST_URL = `https://${ACCOUNT_HOST}/api/db-list.do`;
const OPEN_DB_URL = `https://${ACCOUNT_HOST}/api/open-db.do`;

// What the app may read, per division (docs/accurate-divisi-rencana.md; the
// owner's developer-docs report of 29 Sep 2026). Every entry is a READ action
// whose Accurate scope is a *_view scope. Anything not listed — other
// resources, other actions — is refused, even as a GET.
const LIST_DETAIL = Object.freeze(['list', 'detail']);
const READ_ENDPOINTS = Object.freeze({
  // Sales & Retail Commerce
  customer: LIST_DETAIL,
  'customer-category': LIST_DETAIL,
  'customer-claim': LIST_DETAIL,
  'sales-quotation': LIST_DETAIL,
  'sales-order': LIST_DETAIL,
  'delivery-order': LIST_DETAIL,
  'sales-invoice': LIST_DETAIL,
  'sales-receipt': LIST_DETAIL,
  'sales-return': LIST_DETAIL,
  'exchange-invoice': LIST_DETAIL,
  'sellingprice-adjustment': LIST_DETAIL,
  'price-category': LIST_DETAIL,
  'payment-term': LIST_DETAIL,
  shipment: LIST_DETAIL,
  // Closed or short-closed SOs/POs, so "not shipped" and "PO late" skip them.
  'roll-over': LIST_DETAIL,
  // The list only: the detail holds NIK, NPWP, address and bank data.
  employee: Object.freeze(['list']),
  // Items, stock and Warehouse
  // item/vendor-price (purchase prices) stays closed until Procurement needs it.
  item: Object.freeze(['list', 'detail', 'list-stock', 'get-stock', 'get-selling-price', 'stock-mutation-history']),
  'item-category': LIST_DETAIL,
  'item-brand': LIST_DETAIL,
  unit: LIST_DETAIL,
  warehouse: LIST_DETAIL,
  'item-transfer': LIST_DETAIL,
  'item-adjustment': LIST_DETAIL,
  'stock-opname-order': LIST_DETAIL,
  'stock-opname-result': LIST_DETAIL,
  'receive-item': LIST_DETAIL,
  report: Object.freeze(['stock-mutation-summary']),
  // Procurement
  // The list only: a vendor's detail holds NIK, NPWP, wp*, bank and contacts.
  vendor: Object.freeze(['list']),
  'vendor-category': Object.freeze(['list']),
  'vendor-price': LIST_DETAIL,
  'vendor-claim': LIST_DETAIL,
  'purchase-requisition': LIST_DETAIL,
  'purchase-order': LIST_DETAIL,
  'purchase-invoice': LIST_DETAIL,
  'purchase-return': LIST_DETAIL,
  'purchase-payment': LIST_DETAIL,
  // Finance
  glaccount: Object.freeze(['list', 'detail', 'get-balance', 'get-bs-account-amount', 'get-pl-account-amount']),
  'journal-voucher': LIST_DETAIL,
  'other-deposit': LIST_DETAIL,
  'other-payment': LIST_DETAIL,
  'bank-transfer': LIST_DETAIL,
  expense: LIST_DETAIL,
  'fixed-asset': LIST_DETAIL,
  'account-budget-target': LIST_DETAIL,
  'data-classification': Object.freeze(['list']),
  currency: Object.freeze(['list', 'detail', 'exchange-rate', 'fiscal-rate']),
  tax: LIST_DETAIL,
  // Organization
  branch: LIST_DETAIL,
  department: LIST_DETAIL,
  project: LIST_DETAIL,
});
const READ_RESOURCES = Object.freeze(Object.keys(READ_ENDPOINTS));

// The *_view scope each readable resource needs (from the developer docs).
// Most follow "<resource with _>_view"; the exceptions are named here.
const SCOPE_EXCEPTIONS = Object.freeze({
  expense: 'expense_accrual_view',
  report: 'stock_mutation_history_view',
});
function scopeFor(resource) {
  return SCOPE_EXCEPTIONS[resource] || `${resource.replace(/-/g, '_')}_view`;
}
// Every scope the app asks Accurate for: exactly what READ_ENDPOINTS reads.
const VIEW_SCOPES = Object.freeze([...new Set([
  ...READ_RESOURCES.map(scopeFor),
  'stock_mutation_history_view', // item/stock-mutation-history
])].sort());

// Reads whose Accurate scope is a WRITE scope. Asking for that scope would let
// the app write, so these stay closed for good — whatever they would show.
//   item/get-nearest-cost (HPP) needs purchase_invoice_save.
const FORBIDDEN_ENDPOINTS = Object.freeze({
  'item/get-nearest-cost': 'HPP (item/get-nearest-cost) di Accurate membutuhkan izin TULIS faktur pembelian; aplikasi tidak memintanya.',
});

class AccurateWriteBlocked extends Error {
  constructor(message) {
    super(message);
    this.code = 'ACCURATE_WRITE_BLOCKED';
    this.status = 500;
  }
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    throw new AccurateWriteBlocked(`URL Accurate tidak valid: ${url}`);
  }
}

// Throws unless the request is one of the allowed reads (or the OAuth sign-in).
function assertReadOnlyRequest({ method = 'GET', url }) {
  const verb = String(method).toUpperCase();
  const u = parse(url);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !(host === 'accurate.id' || host.endsWith('.accurate.id'))) {
    throw new AccurateWriteBlocked(`Hanya host *.accurate.id lewat HTTPS yang diizinkan: ${u.origin}`);
  }
  const path = u.pathname.replace(/\/+$/, '');

  // Sign-in exchanges a code for a token; it touches no Accurate data.
  if (verb === 'POST' && host === ACCOUNT_HOST && path === '/oauth/token') return { kind: 'auth' };

  if (verb !== 'GET') {
    throw new AccurateWriteBlocked(`Integrasi Accurate hanya boleh membaca (GET). Ditolak: ${verb} ${path}`);
  }
  if (host === ACCOUNT_HOST && (path === '/api/db-list.do' || path === '/api/open-db.do')) return { kind: 'session' };

  const m = /^\/accurate\/api\/([a-z0-9-]+)\/([a-z0-9-]+)\.do$/.exec(path);
  if (!m) throw new AccurateWriteBlocked(`Endpoint Accurate tidak dikenal: ${path}`);
  const [, resource, action] = m;
  // Own keys only: a name such as "constructor" must not resolve through the
  // object's prototype.
  const forbidden = `${resource}/${action}`;
  if (Object.hasOwn(FORBIDDEN_ENDPOINTS, forbidden)) throw new AccurateWriteBlocked(FORBIDDEN_ENDPOINTS[forbidden]);
  const actions = Object.hasOwn(READ_ENDPOINTS, resource) ? READ_ENDPOINTS[resource] : null;
  if (!Array.isArray(actions)) {
    throw new AccurateWriteBlocked(`Modul Accurate "${resource}" tidak termasuk data yang dibaca aplikasi.`);
  }
  if (!actions.includes(action)) {
    throw new AccurateWriteBlocked(`Aksi Accurate "${resource}/${action}" tidak diizinkan; aplikasi hanya membaca.`);
  }
  return { kind: 'read', resource, action };
}

// GET an allowed endpoint. Redirects (Accurate may move a database to another
// host with 308) are followed by hand, and every hop is checked again, so a
// redirect can never turn a read into anything else.
async function accurateGet(url, { headers = {}, params = {}, fetchImpl = globalThis.fetch, maxRedirects = 3 } = {}) {
  let target = parse(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
  }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertReadOnlyRequest({ method: 'GET', url: target.toString() });
    const res = await fetchImpl(target.toString(), { method: 'GET', headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = res.headers.get('location');
      if (!next) throw new AccurateWriteBlocked('Redirect Accurate tanpa tujuan.');
      target = new URL(next, target);
      continue;
    }
    return res;
  }
  throw new AccurateWriteBlocked('Terlalu banyak redirect dari Accurate.');
}

// A scope list is acceptable only when every scope is a view scope. Anything
// else (…_save, …_delete, unknown words) means the grant could write.
function onlyViewScopes(scope) {
  const scopes = String(scope || '').split(/[\s,]+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((one) => /^[a-z0-9_]+_view$/.test(one));
}

// The authorize page the Super Admin's browser is sent to. Built here so no
// other file spells an Accurate URL; refuses to ask for anything but *_view.
function buildAuthorizeUrl({ clientId, redirectUri, scope, state }) {
  if (!clientId || !redirectUri || !state) throw new AccurateWriteBlocked('Parameter otorisasi Accurate tidak lengkap.');
  if (!onlyViewScopes(scope)) throw new AccurateWriteBlocked('Scope Accurate hanya boleh *_view (baca saja).');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', String(scope).split(/[\s,]+/).filter(Boolean).join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

// POST oauth/token — the only POST this app ever sends to Accurate. It signs
// in (authorization_code or refresh_token); it cannot touch data. Redirects are
// not followed: a token endpoint that redirects is treated as a failure.
async function accurateTokenRequest(form, { clientId, clientSecret, fetchImpl = globalThis.fetch } = {}) {
  const grant = form?.grant_type;
  if (grant !== 'authorization_code' && grant !== 'refresh_token') {
    throw new AccurateWriteBlocked(`grant_type Accurate tidak diizinkan: ${grant}`);
  }
  assertReadOnlyRequest({ method: 'POST', url: TOKEN_URL });
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    redirect: 'manual',
  });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    throw new AccurateWriteBlocked('Endpoint token Accurate mengalihkan permintaan; dibatalkan.');
  }
  return res;
}

module.exports = {
  READ_RESOURCES, READ_ENDPOINTS, FORBIDDEN_ENDPOINTS, VIEW_SCOPES, scopeFor, AccurateWriteBlocked, assertReadOnlyRequest, accurateGet,
  onlyViewScopes, buildAuthorizeUrl, accurateTokenRequest, DB_LIST_URL, OPEN_DB_URL,
};
