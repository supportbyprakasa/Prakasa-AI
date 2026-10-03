import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY, formatBadgeCount, formatDate, formatDateTime, formatMoney, formatNumber, formatQty, formatTime, toDate,
} from '../src/components/format.js';
import { createOverlayStack, menuPosition, nextMenuIndex, snackbarFor, snackbarYields } from '../src/components/overlayModel.js';
import { confirmInitialFocus } from '../src/components/confirmDialogModel.js';
import { priorityTone, statusLabel, statusTone } from '../src/components/statusTone.js';

// Design work package C: overlays and display (docs/ui-guideline.md §4.10–4.16).

test('dates read "30 Sep 2026" and a date-only value never shifts a day', () => {
  assert.equal(formatDate('2026-09-30'), '30 Sep 2026');
  assert.equal(formatDate('2026-05-01'), '1 Mei 2026');
  assert.equal(formatDate('2026-08-17'), '17 Agu 2026');
  assert.equal(formatDate('2026-12-31'), '31 Des 2026');
  assert.equal(toDate('2026-09-30').getDate(), 30);
  assert.equal(formatDateTime(new Date(2026, 8, 30, 14, 5)), '30 Sep 2026, 14.05');
  assert.equal(formatTime(new Date(2026, 8, 30, 7, 0)), '07.00');
});

test('money is "Rp 1.234.567", rounded to the rupiah, negatives in front', () => {
  assert.equal(formatMoney(1234567), 'Rp 1.234.567');
  assert.equal(formatMoney('1234567.6'), 'Rp 1.234.568');
  assert.equal(formatMoney(-5000), '-Rp 5.000');
  assert.equal(formatMoney(0), 'Rp 0');
  assert.equal(formatMoney(-0.2), 'Rp 0');
});

test('quantities use Indonesian grouping with up to two decimals and an optional unit', () => {
  assert.equal(formatQty(1234), '1.234');
  assert.equal(formatQty(12.5), '12,5');
  assert.equal(formatQty(6, 'Ctns'), '6 Ctns');
  assert.equal(formatNumber(1738.4), '1.738');
});

test('a missing or unreadable value shows an em dash', () => {
  for (const value of [null, undefined, '', 'bukan tanggal']) assert.equal(formatDate(value), EMPTY);
  for (const value of [null, undefined, '', 'abc', true]) assert.equal(formatMoney(value), EMPTY);
  assert.equal(formatQty(null), EMPTY);
  assert.equal(formatDateTime(''), EMPTY);
});

test('count badge text: nothing for zero, "99+" above the maximum', () => {
  assert.equal(formatBadgeCount(0), '');
  assert.equal(formatBadgeCount(null), '');
  assert.equal(formatBadgeCount(7), '7');
  assert.equal(formatBadgeCount(120), '99+');
  assert.equal(formatBadgeCount(12, 9), '9+');
});

test('only the top-most overlay is on top; closing it hands over to the one below', () => {
  const stack = createOverlayStack();
  stack.push('form');
  stack.push('confirm');
  assert.equal(stack.isTop('confirm'), true);
  assert.equal(stack.isTop('form'), false);
  stack.remove('confirm');
  assert.equal(stack.isTop('form'), true);
  stack.remove('unknown');
  assert.equal(stack.size, 1);
  stack.remove('form');
  assert.equal(stack.isTop('form'), false);
});

test('a menu opens below its anchor, above it when there is no room, and stays on screen', () => {
  const viewport = { width: 390, height: 844 };
  const menu = { width: 200, height: 200 };
  const below = menuPosition({ top: 100, bottom: 148, left: 300, right: 348 }, menu, viewport, 'end');
  assert.deepEqual(below, { top: 148, left: 148, placement: 'bottom-end' });
  const above = menuPosition({ top: 780, bottom: 828, left: 20, right: 68 }, menu, viewport, 'start');
  assert.deepEqual(above, { top: 580, left: 20, placement: 'top-start' });
  const clamped = menuPosition({ top: 100, bottom: 148, left: 360, right: 408 }, menu, viewport, 'start');
  assert.equal(clamped.left, 390 - 8 - 200);
  const leftEdge = menuPosition({ top: 100, bottom: 148, left: 0, right: 48 }, menu, viewport, 'end');
  assert.equal(leftEdge.left, 8);
  // placement="top" (the AI composer chips) opens above, below only when there is no room above.
  const preferTop = menuPosition({ top: 500, bottom: 548, left: 20, right: 68 }, menu, viewport, 'start', 'top');
  assert.deepEqual(preferTop, { top: 300, left: 20, placement: 'top-start' });
  const noRoomAbove = menuPosition({ top: 100, bottom: 148, left: 20, right: 68 }, menu, viewport, 'start', 'top');
  assert.equal(noRoomAbove.placement, 'bottom-start');
});

test('arrow keys wrap around the menu items; Home and End jump', () => {
  assert.equal(nextMenuIndex('ArrowDown', -1, 4), 0);
  assert.equal(nextMenuIndex('ArrowDown', 3, 4), 0);
  assert.equal(nextMenuIndex('ArrowUp', 0, 4), 3);
  assert.equal(nextMenuIndex('ArrowUp', -1, 4), 3);
  assert.equal(nextMenuIndex('Home', 2, 4), 0);
  assert.equal(nextMenuIndex('End', 0, 4), 3);
  assert.equal(nextMenuIndex('a', 2, 4), 2);
  assert.equal(nextMenuIndex('ArrowDown', -1, 0), -1);
});

test('snackbar: errors stay until closed and are announced as alerts; the rest leave after 4 s', () => {
  assert.deepEqual(snackbarFor('Gagal', 'error'), { message: 'Gagal', tone: 'error', role: 'alert', duration: null, action: null });
  assert.equal(snackbarFor('Tersimpan', 'success').duration, 4000);
  assert.equal(snackbarFor('Tersimpan', 'success').role, 'status');
  assert.equal(snackbarFor('x', 'nonsense').tone, 'info');
  assert.equal(snackbarFor('x', 'info', { sticky: true }).duration, null);
  assert.equal(snackbarFor('x', 'info', { action: { label: 'Urungkan' } }).action.label, 'Urungkan');
  assert.equal(snackbarFor('x', 'info', { action: {} }).action, null);
});

test('a destructive confirmation opens on Batal', () => {
  assert.equal(confirmInitialFocus('danger'), 'cancel');
  assert.equal(confirmInitialFocus('primary'), 'confirm');
});

test('statuses that used to render grey now have their tone and an Indonesian label', () => {
  assert.equal(statusTone('investigating'), 'info');
  assert.equal(statusTone('verified'), 'success');
  assert.equal(statusTone('needs_review'), 'warning');
  assert.equal(statusLabel('needs_review'), 'Perlu dicek');
  assert.equal(statusTone('geo_mismatch'), 'warning');
  assert.equal(statusTone('converted'), 'success');
  assert.equal(statusLabel('dropped'), 'Tidak berminat');
  assert.equal(statusTone('blocks'), 'warning');
  // Categories (visibility, flow types) are neutral, never a status colour.
  for (const category of ['private', 'department', 'sequential', 'parallel', 'onboarding', 'reimbursement']) {
    assert.equal(statusTone(category), 'default', category);
  }
  // Severity follows the priority map: high is a warning, not an error.
  assert.equal(priorityTone('high'), 'warning');
});

test('snackbar queue: a new message cuts a timed one short but waits behind a sticky error', () => {
  assert.equal(snackbarYields(snackbarFor('Tersimpan', 'success')), true);
  assert.equal(snackbarYields(snackbarFor('Gagal', 'error')), false);
  assert.equal(snackbarYields(snackbarFor('x', 'info', { sticky: true })), false);
  assert.equal(snackbarYields(null), false);
});

