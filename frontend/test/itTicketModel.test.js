import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedNextStatuses } from '../src/pages/it/itTicketModel.js';

test('IT transition options match the backend lifecycle exactly', () => {
  assert.deepEqual(allowedNextStatuses('open', 'it'), ['in_progress', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('in_progress', 'it'), ['waiting_on_user', 'resolved', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('waiting_on_user', 'it'), ['in_progress', 'resolved', 'cancelled']);
  assert.deepEqual(allowedNextStatuses('resolved', 'it'), ['closed', 'in_progress']);
  assert.deepEqual(allowedNextStatuses('closed', 'it'), []);
  assert.deepEqual(allowedNextStatuses('cancelled', 'it'), []);
});

test('a requester only ever sees the option to cancel their own open ticket', () => {
  assert.deepEqual(allowedNextStatuses('open', 'requester'), ['cancelled']);
  assert.deepEqual(allowedNextStatuses('in_progress', 'requester'), []);
  assert.deepEqual(allowedNextStatuses('resolved', 'requester'), []);
});

import { STATUS_LABELS, ticketActions, transitionLabel } from '../src/pages/it/itTicketModel.js';

test('IT staff get one forward step as the primary action; cancelling goes to the menu', () => {
  assert.deepEqual(ticketActions('open'), { primary: 'in_progress', secondary: [], canCancel: true });
  assert.deepEqual(ticketActions('in_progress'), { primary: 'resolved', secondary: ['waiting_on_user'], canCancel: true });
  assert.deepEqual(ticketActions('waiting_on_user'), { primary: 'resolved', secondary: ['in_progress'], canCancel: true });
  assert.deepEqual(ticketActions('resolved'), { primary: 'closed', secondary: ['in_progress'], canCancel: false });
  assert.deepEqual(ticketActions('closed'), { primary: null, secondary: [], canCancel: false });
});

test('transition buttons read as verb + object in Indonesian', () => {
  assert.equal(transitionLabel('open', 'in_progress'), 'Mulai kerjakan');
  assert.equal(transitionLabel('resolved', 'in_progress'), 'Kerjakan lagi');
  assert.equal(transitionLabel('in_progress', 'resolved'), 'Tandai selesai');
  assert.equal(transitionLabel('resolved', 'closed'), 'Tutup tiket');
  assert.equal(transitionLabel('open', 'cancelled'), 'Batalkan tiket');
  for (const label of Object.values(STATUS_LABELS)) assert.equal(label, label.charAt(0) + label.slice(1).toLowerCase(), `sentence case: ${label}`);
});
