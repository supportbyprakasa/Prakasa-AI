const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertReadOnlyRequest, accurateGet, READ_RESOURCES, READ_ENDPOINTS,
  buildAuthorizeUrl, accurateTokenRequest, onlyViewScopes, DB_LIST_URL,
} = require('../src/services/accurate/accurateReadOnly');

// Owner's rule: nothing is executed on Accurate data except the integration,
// and the integration only reads. These tests keep it that way.

const HOST = 'https://public.accurate.id/accurate/api';
const blocked = (req) => assert.throws(() => assertReadOnlyRequest(req), (e) => e.code === 'ACCURATE_WRITE_BLOCKED', JSON.stringify(req));

test('every listed read endpoint is allowed, and every one of them is a read', () => {
  for (const [resource, actions] of Object.entries(READ_ENDPOINTS)) {
    for (const action of actions) {
      assert.equal(assertReadOnlyRequest({ url: `${HOST}/${resource}/${action}.do` }).kind, 'read', `${resource}/${action}`);
      assert.match(action, /^(list|detail|get-[a-z-]+|list-stock|stock-mutation-[a-z]+|exchange-rate|fiscal-rate)$/, `${resource}/${action} looks like a read`);
    }
  }
  assert.ok(READ_RESOURCES.includes('purchase-order') && READ_RESOURCES.includes('glaccount') && READ_RESOURCES.includes('warehouse'));
  assert.equal(assertReadOnlyRequest({ url: 'https://account.accurate.id/api/db-list.do' }).kind, 'session');
  assert.equal(assertReadOnlyRequest({ url: 'https://account.accurate.id/api/open-db.do?id=1' }).kind, 'session');
  assert.equal(assertReadOnlyRequest({ method: 'POST', url: 'https://account.accurate.id/oauth/token' }).kind, 'auth');
});

test('every write, delete or other action is refused, whatever the method', () => {
  for (const action of ['save', 'bulk-save', 'delete', 'bulk-delete', 'approve', 'close', 'import']) {
    blocked({ method: 'GET', url: `${HOST}/sales-invoice/${action}.do` });
    blocked({ method: 'POST', url: `${HOST}/sales-invoice/${action}.do` });
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    blocked({ method, url: `${HOST}/sales-order/list.do` });
    blocked({ method, url: 'https://account.accurate.id/api/open-db.do' });
  }
});

test('unlisted modules and actions, other hosts and plain HTTP are refused', () => {
  // Not opened without an owner decision: pay/commission, salesman GPS
  // check-ins, access rights, manufacturing.
  for (const resource of ['payroll', 'salesman-commission', 'sales-checkin', 'access-privilege', 'bill-of-material', 'work-order']) {
    blocked({ url: `${HOST}/${resource}/list.do` });
  }
  // Personal data (employee detail) and purchase prices through the item scope.
  blocked({ url: `${HOST}/employee/detail.do?id=1` });
  blocked({ url: `${HOST}/vendor/detail.do?id=1` });
  blocked({ url: `${HOST}/vendor-category/detail.do?id=1` });
  blocked({ url: `${HOST}/item/vendor-price.do` });
  blocked({ url: `${HOST}/item/search-by-no-upc.do` });
  blocked({ url: `${HOST}/report/work-order-detail.do` });
  blocked({ url: `${HOST}/glaccount/save.do` });
  blocked({ url: 'https://evil.example.com/accurate/api/item/list.do' });
  blocked({ url: 'https://accurate.id.evil.example.com/accurate/api/item/list.do' });
  blocked({ url: 'http://public.accurate.id/accurate/api/item/list.do' });
  blocked({ url: 'not a url' });
});

test('a redirect is checked again, so it can never lead to a write', async () => {
  const calls = [];
  const fake = (responses) => async (url, init) => {
    calls.push({ url, method: init.method });
    const r = responses.shift();
    return { status: r.status, headers: { get: () => r.location } };
  };
  // A legitimate host move (Accurate answers 308) is followed.
  const ok = await accurateGet(`${HOST}/item/list.do`, {
    fetchImpl: fake([{ status: 308, location: 'https://zeus.accurate.id/accurate/api/item/list.do' }, { status: 200 }]),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'GET']);

  // A redirect towards save.do is stopped before it is requested.
  calls.length = 0;
  await assert.rejects(() => accurateGet(`${HOST}/item/list.do`, {
    fetchImpl: fake([{ status: 308, location: `${HOST}/item/save.do` }]),
  }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
  assert.equal(calls.length, 1, 'save.do was never called');
});

test('sign-in helpers stay read-only: view scopes, token POST only, db-list is a GET', async () => {
  const url = new URL(buildAuthorizeUrl({ clientId: 'id', redirectUri: 'https://app.test/cb', scope: 'item_view customer_view', state: 's1' }));
  assert.equal(url.origin + url.pathname, 'https://account.accurate.id/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'item_view customer_view');
  for (const scope of ['item_view item_save', 'sales_invoice_delete', '', 'item_view approve']) {
    assert.throws(() => buildAuthorizeUrl({ clientId: 'id', redirectUri: 'https://app.test/cb', scope, state: 's' }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED', scope);
    assert.equal(onlyViewScopes(scope), false, scope);
  }
  assert.equal(assertReadOnlyRequest({ url: DB_LIST_URL }).kind, 'session');

  const calls = [];
  const fetchImpl = async (u, init) => { calls.push({ u, method: init.method }); return { status: 200 }; };
  await accurateTokenRequest({ grant_type: 'authorization_code', code: 'c' }, { clientId: 'a', clientSecret: 'b', fetchImpl });
  assert.deepEqual(calls, [{ u: 'https://account.accurate.id/oauth/token', method: 'POST' }]);
  await assert.rejects(() => accurateTokenRequest({ grant_type: 'password' }, { fetchImpl }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
});

test('nothing else in the backend talks to Accurate directly', () => {
  const root = path.join(__dirname, '../src');
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') && !p.endsWith(path.join('accurate', 'accurateReadOnly.js'))
        && /accurate\.id/i.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'Call Accurate only through services/accurate/accurateReadOnly.js');
});

test('HPP (item/get-nearest-cost) is closed for good: its Accurate scope is a write scope', () => {
  assert.throws(() => assertReadOnlyRequest({ url: `${HOST}/item/get-nearest-cost.do?no=A&transDate=01/09/2026` }),
    (e) => e.code === 'ACCURATE_WRITE_BLOCKED' && /izin TULIS/.test(e.message));
});

test('the app asks Accurate for exactly the view scopes of what it reads — never more, never a write', () => {
  const { VIEW_SCOPES, scopeFor } = require('../src/services/accurate/accurateReadOnly');
  assert.ok(VIEW_SCOPES.length > 0 && VIEW_SCOPES.every((sc) => /^[a-z0-9_]+_view$/.test(sc)));
  assert.equal(onlyViewScopes(VIEW_SCOPES.join(' ')), true);
  for (const resource of READ_RESOURCES) assert.ok(VIEW_SCOPES.includes(scopeFor(resource)), resource);
  assert.equal(scopeFor('expense'), 'expense_accrual_view');
  assert.equal(scopeFor('purchase-order'), 'purchase_order_view');
  assert.ok(VIEW_SCOPES.includes('stock_mutation_history_view'));
  for (const sc of ['salesman_commission_view', 'access_privilege_view', 'purchase_invoice_save']) assert.ok(!VIEW_SCOPES.includes(sc), sc);
});

// The owner approved this exact list (29 Sep 2026, one reconnect). Widening it
// — a new resource, action or scope — must be a reviewed change to this test.
const APPROVED_SCOPES = [
  'account_budget_target_view', 'bank_transfer_view', 'branch_view', 'currency_view', 'customer_category_view', 'customer_claim_view',
  'customer_view', 'data_classification_view', 'delivery_order_view', 'department_view', 'employee_view', 'exchange_invoice_view',
  'expense_accrual_view', 'fixed_asset_view', 'glaccount_view', 'item_adjustment_view', 'item_brand_view', 'item_category_view',
  'item_transfer_view', 'item_view', 'journal_voucher_view', 'other_deposit_view', 'other_payment_view', 'payment_term_view',
  'price_category_view', 'project_view', 'purchase_invoice_view', 'purchase_order_view', 'purchase_payment_view',
  'purchase_requisition_view', 'purchase_return_view', 'receive_item_view', 'roll_over_view', 'sales_invoice_view', 'sales_order_view',
  'sales_quotation_view', 'sales_receipt_view', 'sales_return_view', 'sellingprice_adjustment_view', 'shipment_view',
  'stock_mutation_history_view', 'stock_opname_order_view', 'stock_opname_result_view', 'tax_view', 'unit_view', 'vendor_category_view',
  'vendor_claim_view', 'vendor_price_view', 'vendor_view', 'warehouse_view',
];
const LD = 'list,detail';
const APPROVED_ENDPOINTS = {
  customer: LD, 'customer-category': LD, 'customer-claim': LD, 'sales-quotation': LD, 'sales-order': LD, 'delivery-order': LD,
  'sales-invoice': LD, 'sales-receipt': LD, 'sales-return': LD, 'exchange-invoice': LD, 'sellingprice-adjustment': LD,
  'price-category': LD, 'payment-term': LD, shipment: LD, 'roll-over': LD, employee: 'list',
  item: 'list,detail,list-stock,get-stock,get-selling-price,stock-mutation-history',
  'item-category': LD, 'item-brand': LD, unit: LD, warehouse: LD, 'item-transfer': LD, 'item-adjustment': LD,
  'stock-opname-order': LD, 'stock-opname-result': LD, 'receive-item': LD, report: 'stock-mutation-summary',
  vendor: 'list', 'vendor-category': 'list', 'vendor-price': LD, 'vendor-claim': LD, 'purchase-requisition': LD, 'purchase-order': LD,
  'purchase-invoice': LD, 'purchase-return': LD, 'purchase-payment': LD,
  glaccount: 'list,detail,get-balance,get-bs-account-amount,get-pl-account-amount',
  'journal-voucher': LD, 'other-deposit': LD, 'other-payment': LD, 'bank-transfer': LD, expense: LD, 'fixed-asset': LD,
  'account-budget-target': LD, 'data-classification': 'list', currency: 'list,detail,exchange-rate,fiscal-rate', tax: LD,
  branch: LD, department: LD, project: LD,
};

test('the scopes and endpoints are pinned to the owner-approved list, exactly', () => {
  const { VIEW_SCOPES } = require('../src/services/accurate/accurateReadOnly');
  assert.equal(APPROVED_SCOPES.length, 50);
  assert.deepEqual([...VIEW_SCOPES], APPROVED_SCOPES);
  assert.deepEqual(Object.fromEntries(Object.entries(READ_ENDPOINTS).map(([k, v]) => [k, v.join(',')])), APPROVED_ENDPOINTS);
});

test('any method other than GET is refused on data and sessions — whatever its spelling', () => {
  for (const method of ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND', 'MERGE', 'post', 'Put', 'patch', 'X-WRITE']) {
    for (const url of [`${HOST}/sales-order/list.do`, 'https://account.accurate.id/api/open-db.do', 'https://account.accurate.id/api/db-list.do']) {
      blocked({ method, url });
    }
  }
  // The only non-GET is the sign-in POST, and only to the token endpoint.
  blocked({ method: 'POST', url: 'https://account.accurate.id/oauth/authorize' });
  blocked({ method: 'POST', url: 'https://zeus.accurate.id/oauth/token' });
});

test('resource names never resolve through the object prototype', () => {
  for (const name of ['constructor', 'hasownproperty', 'tostring', 'valueof']) {
    blocked({ url: `${HOST}/${name}/list.do` });
    blocked({ url: `${HOST}/${name}/includes.do` });
  }
  blocked({ url: `${HOST}/item/constructor.do` });
});

test('fetch never follows a redirect by itself: every read and the token POST pass redirect "manual"', async () => {
  const seen = [];
  const fetchImpl = async (u, init) => { seen.push([init.method, init.redirect]); return { status: 200, ok: true, headers: { get: () => null } }; };
  await accurateGet(`${HOST}/item/list.do`, { fetchImpl });
  await accurateGet(DB_LIST_URL, { fetchImpl });
  await accurateTokenRequest({ grant_type: 'refresh_token', refresh_token: 'r' }, { clientId: 'a', clientSecret: 'b', fetchImpl });
  assert.deepEqual(seen, [['GET', 'manual'], ['GET', 'manual'], ['POST', 'manual']]);
});
