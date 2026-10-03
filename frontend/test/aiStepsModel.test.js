import test from 'node:test';
import assert from 'node:assert/strict';
import { runningStep, stepText, stepsSummary, upsertStep } from '../src/components/ai/aiStepsModel.js';

test('a step starts once and is finished by its result', () => {
  let steps = [];
  steps = upsertStep(steps, { type: 'step', id: 'a', tool: 'notifikasi_saya', label: 'Membaca notifikasi Anda', status: 'running' });
  steps = upsertStep(steps, { type: 'step', id: 'b', tool: 'WebSearch', label: 'Mencari di web', target: 'harga kopi', status: 'running' });
  steps = upsertStep(steps, { type: 'step', id: 'a', status: 'ok' });
  steps = upsertStep(steps, { type: 'notice', message: 'x' });
  assert.deepEqual(steps.map((s) => [s.id, s.status]), [['a', 'ok'], ['b', 'running']]);
  assert.equal(runningStep(steps).id, 'b');
  assert.equal(stepText(steps[1]), 'Mencari di web: “harga kopi”');
});

test('the collapsed line shows the step running now, or what was done', () => {
  const running = [{ id: 'a', label: 'Membaca profil Anda', status: 'ok' }, { id: 'b', label: 'Membaca notifikasi Anda', status: 'running' }];
  assert.equal(stepsSummary(running, { live: true }), 'Membaca notifikasi Anda…');
  assert.equal(stepsSummary([{ id: 'a', label: 'Membaca profil Anda', status: 'ok' }]), 'Membaca profil Anda');
  assert.equal(stepsSummary([{ id: 'a', label: 'A', status: 'ok' }, { id: 'b', label: 'B', status: 'error' }]), '2 langkah · 1 gagal');
  assert.equal(stepsSummary([]), '');
});
