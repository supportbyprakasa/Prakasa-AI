import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNavSections, hasRouteAccess, legacyRedirect } from '../src/components/navigation.js';

const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const perms = (key) => STANDARD_ROLES.find((entry) => entry.key === key).permissions;

// The former single-page divisions (owner, 3 Oct 2026): every old
// /warehouse?tab=… and /procurement?tab=… address still lands on the right
// page, with the rest of its query intact.

test('every old Warehouse tab lands on its page, keeping the other parameters', () => {
  assert.equal(legacyRedirect('/warehouse', '?tab=stock&status=minus&warehouseId=3'), '/warehouse/stock?status=minus&warehouseId=3');
  assert.equal(legacyRedirect('/warehouse', '?tab=recon&direction=inbound&group=PO%201%2F2'), '/warehouse/stock?tab=recon&direction=inbound&group=PO+1%2F2');
  assert.equal(legacyRedirect('/warehouse', '?tab=documents&type=transfer&status=in_transit'), '/warehouse/stock?tab=documents&type=transfer&status=in_transit');
  assert.equal(legacyRedirect('/warehouse', '?tab=inbound'), '/warehouse/movements?tab=inbound');
  assert.equal(legacyRedirect('/warehouse', '?tab=approval'), '/warehouse/movements?tab=approval');
  assert.equal(legacyRedirect('/warehouse', '?tab=history&q=SJ1'), '/warehouse/movements?tab=history&q=SJ1');
  assert.equal(legacyRedirect('/warehouse', '?tab=shipping&status=late'), '/warehouse/shipping?status=late');
  assert.equal(legacyRedirect('/warehouse', '?tab=checklist&baru=1'), '/warehouse/operations?tab=checklist&baru=1');
  assert.equal(legacyRedirect('/warehouse', '?tab=incidents'), '/warehouse/operations?tab=incidents');
  assert.equal(legacyRedirect('/warehouse', '?tab=accurate'), '/data-accurate');
  assert.equal(legacyRedirect('/warehouse', '?tab=today'), '/warehouse');
});

test('every old Procurement tab lands on its page; unknown tabs and other pages are left alone', () => {
  assert.equal(legacyRedirect('/procurement', '?tab=orders&state=late&po=7'), '/procurement/orders?state=late&po=7');
  assert.equal(legacyRedirect('/procurement', '?tab=reorder&urgency=critical&vendor=V1&noPo=1'), '/procurement/reorder?urgency=critical&vendor=V1&noPo=1');
  assert.equal(legacyRedirect('/procurement', '?tab=vendors'), '/procurement/vendors');
  assert.equal(legacyRedirect('/procurement', '?tab=prices'), '/procurement/vendors?tab=prices');
  assert.equal(legacyRedirect('/procurement', '?tab=accurate'), '/data-accurate');
  assert.equal(legacyRedirect('/procurement', '?tab=nope'), null);
  assert.equal(legacyRedirect('/procurement', ''), null);
  assert.equal(legacyRedirect('/warehouse/stock', '?tab=recon'), null);
  assert.equal(legacyRedirect('/sales/orders', '?tab=accurate'), null);
});

test('the old address of a movement-only reader still opens: /warehouse admits them and sends them on', () => {
  for (const key of ['procurement.member', 'retail_commerce.member']) {
    assert.equal(hasRouteAccess('/warehouse', perms(key)), true, key);
    assert.equal(hasRouteAccess('/warehouse/movements', perms(key)), true, key);
    assert.equal(hasRouteAccess('/warehouse/stock', perms(key)), false, key);
    // …but the menu does not list the day view for them.
    const items = buildNavSections(perms(key)).flatMap((section) => section.items).map((item) => item.to);
    assert.equal(items.includes('/warehouse'), false, key);
    assert.equal(items.includes('/warehouse/movements'), true, key);
  }
  assert.equal(hasRouteAccess('/warehouse', perms('management_office.supervisor')), true);
});

test('Data Accurate: one entry for everyone who decides batches or proposes to Accurate, as a plain item for a proposer alone', () => {
  const paths = (key) => buildNavSections(perms(key)).flatMap((section) => section.items).map((item) => item.to);
  for (const key of ['sales.supervisor', 'warehouse.head', 'management_office.head', 'sales.member', 'procurement.member']) {
    assert.ok(paths(key).includes('/data-accurate'), key);
  }
  assert.equal(paths('finance.member').includes('/data-accurate'), false);
  assert.equal(paths('warehouse.member').includes('/data-accurate'), false);
});
