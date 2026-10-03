const test = require('node:test');
const assert = require('node:assert/strict');
const { approvalActionUrl, PAGES } = require('../src/services/approvalLink');
const lifecycle = require('../src/services/approvalSubjectLifecycle.service');

test('an approval notification opens the page of the thing being decided', () => {
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'ga_request', subjectId: 4 }), '/ga/requests/4');
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'ga_vehicle_booking', subjectId: 5 }), '/ga/bookings/5');
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'hrga_onboarding', subjectId: 6 }), '/hrga/workflows/6');
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'warehouse_outbound', subjectId: 7 }), '/warehouse/movements/outbound/7');
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'sales_accurate_batch', subjectId: 10 }), '/data-accurate/10');
  // Unknown subjects keep the generic link.
  assert.equal(approvalActionUrl({ id: 9, subjectType: 'something_else', subjectId: 1 }), '/approvals/9');
});

test('every subject type with an approval lifecycle has a page link', () => {
  for (const type of Object.keys(PAGES)) assert.ok(lifecycle.isManagedSubject(type), `${type} is managed`);
});
