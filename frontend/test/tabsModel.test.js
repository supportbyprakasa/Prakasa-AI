import test from 'node:test';
import assert from 'node:assert/strict';
import { nextEdges, scrollEdges, scrollToReveal } from '../src/components/tabsModel.js';

test('scrollEdges: a row that fits has no scrollable edge', () => {
  assert.deepEqual(scrollEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 }), { start: false, end: false });
  assert.deepEqual(scrollEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400.6 }), { start: false, end: false });
});

test('scrollEdges: start, middle and end of an overflowing row', () => {
  assert.deepEqual(scrollEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900 }), { start: false, end: true });
  assert.deepEqual(scrollEdges({ scrollLeft: 200, clientWidth: 300, scrollWidth: 900 }), { start: true, end: true });
  assert.deepEqual(scrollEdges({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 }), { start: true, end: false });
});

test('nextEdges keeps the same object when nothing changed (no re-render loop)', () => {
  const current = { start: true, end: false };
  assert.equal(nextEdges(current, { start: true, end: false }), current);
  const changed = { start: true, end: true };
  assert.equal(nextEdges(current, changed), changed);
  assert.equal(nextEdges(null, changed), changed);
});

test('scrollToReveal brings the last tab into view, clear of the chevron', () => {
  const row = { scrollLeft: 0, clientWidth: 300 };
  assert.equal(scrollToReveal({ left: 700, right: 820 }, row), 560);
  assert.equal(scrollToReveal({ left: 100, right: 200 }, row), 0);
  assert.equal(scrollToReveal({ left: 20, right: 120 }, { scrollLeft: 400, clientWidth: 300 }), 0);
});
