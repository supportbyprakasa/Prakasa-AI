import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityLabel, priorityTone, statusLabel, statusTone } from '../src/components/statusTone.js';

test('every status family maps to one of the five guideline tones', () => {
  assert.equal(statusTone('draft'), 'default');
  assert.equal(statusTone('in_progress'), 'info');
  assert.equal(statusTone('pending_approval'), 'warning');
  assert.equal(statusTone('approved'), 'success');
  assert.equal(statusTone('rejected'), 'error');
  assert.equal(statusTone('SOMETHING_NEW'), 'default');
  assert.equal(statusTone(null), 'default');
});

test('status labels are Indonesian text, never raw codes', () => {
  assert.equal(statusLabel('pending_approval'), 'Menunggu persetujuan');
  assert.equal(statusLabel('revision_requested'), 'Perlu revisi');
  assert.equal(statusLabel('custom_state'), 'Custom state');
  assert.equal(statusLabel(''), '—');
});

test('the same status or priority always gets the same tone, whatever the module', () => {
  assert.equal(statusTone('closed'), 'default');
  assert.equal(statusTone('in_progress'), 'info');
  assert.equal(statusTone('available'), 'success');
  assert.equal(statusTone('need_follow_up'), 'warning');
  assert.equal(priorityTone('normal'), 'default');
  assert.equal(priorityTone('high'), 'warning');
  assert.equal(priorityTone('urgent'), 'error');
  assert.equal(priorityLabel('urgent'), 'Mendesak');
});
