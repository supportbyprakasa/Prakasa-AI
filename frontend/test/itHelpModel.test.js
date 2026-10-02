import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HELP, HELP_CATEGORIES, helpPayload, helpSentMessage, validateHelp } from '../src/components/support/itHelpModel.js';
import { CATEGORY_LABELS } from '../src/pages/it/itTicketModel.js';

test('Bantuan IT offers exactly the ticket categories the backend accepts', () => {
  assert.deepEqual(HELP_CATEGORIES.map((c) => c.value).sort(), Object.keys(CATEGORY_LABELS).sort());
});

test('Bantuan IT validates on the fields and sends the page it came from', () => {
  assert.deepEqual(Object.keys(validateHelp(EMPTY_HELP)).sort(), ['category', 'description', 'title']);
  const values = { category: 'network', title: ' Internet putus ', description: ' Sejak pagi ', priority: 'high', deviceId: '' };
  assert.deepEqual(validateHelp(values), {});
  assert.deepEqual(helpPayload(values, '/warehouse'), {
    category: 'network', title: 'Internet putus', description: 'Sejak pagi', priority: 'high', deviceId: null, sourcePage: '/warehouse',
  });
  assert.equal(helpPayload({ ...values, deviceId: '7' }, 'https://x').deviceId, 7);
  assert.equal(helpPayload(values, 'https://x').sourcePage, null);
});

test('the confirmation says where the copy went', () => {
  assert.match(helpSentMessage({ id: 12, emailed: true, supportEmail: 'support@prakasagroup.com' }), /#12.*support@prakasagroup\.com/);
  assert.match(helpSentMessage({ id: 12, emailed: false }), /#12 terkirim/);
});
