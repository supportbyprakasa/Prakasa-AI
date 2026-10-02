import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_TYPES, isSearchType, searchTypeLabel, searchTypeIcon, resultMetaItems, resultSubtitle, resultEntity, typeSummary,
} from '../src/components/search/searchResultModel.js';

test('every search type has an Indonesian label and an icon; codes never show', () => {
  assert.equal(SEARCH_TYPES.length, 13);
  assert.ok(SEARCH_TYPES.every((t) => t.label && t.icon && t.label !== t.value));
  assert.equal(isSearchType('sales_order'), true);
  assert.equal(isSearchType('bogus'), false);
  assert.equal(searchTypeLabel('signature_request'), 'Tanda tangan');
  assert.equal(searchTypeLabel('new_module'), 'New module');
  assert.equal(searchTypeIcon('new_module'), 'article');
  assert.equal(typeSummary(['document', 'task', 'decision_log']), 'Dokumen, Task, Log keputusan');
});

test('meta values are read through the label maps and format.js', () => {
  assert.deepEqual(resultMetaItems({ priority: 'high', dueDate: '2026-10-02', city: 'Bandung' }).map((m) => `${m.label}: ${m.value}`),
    ['Prioritas: Tinggi', 'Tenggat: 2 Okt 2026', 'Kota: Bandung']);
  assert.deepEqual(resultMetaItems({ deviceType: 'access_point', currency: 'IDR', workflowType: 'onboarding', visibility: 'department', category: 'standard_operating_procedure' })
    .map((m) => m.value), ['Access point', 'Rupiah', 'Onboarding', 'Standard operating procedure', 'Divisi']);
  assert.deepEqual(resultMetaItems({ priority: null, city: '' }), []);
  assert.deepEqual(resultMetaItems(null), []);
});

test('subtitles that carry codes are translated', () => {
  assert.equal(resultSubtitle({ type: 'approval_request', subtitle: 'finance_workflow' }), 'Pengajuan dana');
  assert.equal(resultSubtitle({ type: 'signature_request', subtitle: 'Signature #12' }), 'Tanda tangan #12');
  assert.equal(resultSubtitle({ type: 'hrga_workflow', subtitle: 'onboarding · HR-2026-004' }), 'Onboarding · HR-2026-004');
  assert.equal(resultSubtitle({ type: 'customer', subtitle: 'CUST-001' }), 'CUST-001');
  assert.equal(resultSubtitle({ type: 'document', subtitle: 'sop', meta: { category: 'sop' } }), null, 'already shown as Kategori');
  assert.equal(resultSubtitle({ type: 'document', subtitle: 'standard_operating_procedure', meta: {} }), 'Standard operating procedure');
  assert.equal(resultSubtitle({ type: 'task', subtitle: null }), null);
});

test('the entity is shown only for another entity than the user\'s', () => {
  assert.equal(resultEntity(1, 1), null);
  assert.equal(resultEntity('1', 1), null);
  assert.equal(resultEntity(3, 1), 'Entitas #3');
  assert.equal(resultEntity(null, 1), null);
  assert.equal(resultEntity(3, undefined), 'Entitas #3');
});
