import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSymbol, formatRelative, greetingFor, groupCards, normalizeSummary } from '../src/pages/dashboardModel.js';

test('greeting follows the hour of day', () => {
  assert.equal(greetingFor(8), 'Selamat pagi');
  assert.equal(greetingFor(12), 'Selamat siang');
  assert.equal(greetingFor(17), 'Selamat sore');
  assert.equal(greetingFor(21), 'Selamat malam');
});

test('cards are split into action / mine / team and unknown groups are ignored', () => {
  const grouped = groupCards([
    { key: 'a', group: 'action' }, { key: 'b', group: 'mine' }, { key: 'c', group: 'team' }, { key: 'd', group: 'other' },
  ]);
  assert.deepEqual(grouped.action.map((c) => c.key), ['a']);
  assert.deepEqual(grouped.mine.map((c) => c.key), ['b']);
  assert.deepEqual(grouped.team.map((c) => c.key), ['c']);
});

test('relative time reads naturally for the past and as a deadline for the future', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  assert.equal(formatRelative('2026-09-28T11:59:40Z', now), 'baru saja');
  assert.equal(formatRelative('2026-09-28T11:30:00Z', now), '30 menit lalu');
  assert.equal(formatRelative('2026-09-28T09:00:00Z', now), '3 jam lalu');
  assert.equal(formatRelative('2026-09-27T09:00:00Z', now), 'kemarin');
  assert.equal(formatRelative('2026-09-24T12:00:00Z', now), '4 hari lalu');
  assert.equal(formatRelative('2026-09-30T12:00:00Z', now), '2 hari lagi');
  assert.equal(formatRelative(null, now), '');
});

test('an unexpected work-summary answer becomes an empty summary instead of a crash', () => {
  assert.deepEqual(normalizeSummary([]), { cards: [], notifications: { unread: 0, recent: [] } });
  assert.deepEqual(normalizeSummary(null), { cards: [], notifications: { unread: 0, recent: [] } });
  const s = normalizeSummary({ cards: [{ key: 'it_mine', group: 'mine', count: '3' }, null], notifications: { unread: 2, recent: [{ id: 1 }] } });
  assert.equal(s.cards.length, 1);
  assert.deepEqual(s.cards[0].items, []);
  assert.equal(s.cards[0].count, 3);
  assert.equal(s.notifications.unread, 2);
  assert.deepEqual(groupCards(undefined).action, []);
});

test('summary cards show a Material Symbol per module, the bell otherwise', () => {
  assert.equal(cardSymbol('it_waiting'), 'support');
  assert.equal(cardSymbol('finance_queue'), 'account_balance');
  assert.equal(cardSymbol('unknown'), 'notifications');
});

test('older than a month reads as a date', () => {
  assert.equal(formatRelative('2026-07-01T12:00:00', new Date('2026-09-28T12:00:00')), '1 Jul 2026');
});
