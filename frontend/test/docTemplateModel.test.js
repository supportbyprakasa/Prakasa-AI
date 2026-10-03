import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bastBody, bastErrors, defaultAcknowledger, generateBody, generateFields, kopBody, kopErrors, kopStatus, templateBody, templateErrors,
} from '../src/pages/documents/docTemplateModel.js';

// Template dokumen, kop & footer, BAST (migration 115): the page model.

const TEMPLATE = { placeholders: [{ key: 'nomor_dokumen', label: 'Nomor dokumen' }, { key: 'nama_penerima', label: 'Nama penerima' }, { key: 'catatan_tambahan', label: 'Catatan tambahan' }, { key: 'tanggal', label: 'Tanggal' }] };

test('the form asks only for the template\'s own fields; empty ones become "-"', () => {
  assert.deepEqual(generateFields(TEMPLATE).map((f) => [f.key, f.long]), [['nama_penerima', false], ['catatan_tambahan', true]]);
  assert.deepEqual(generateBody(TEMPLATE, { nama_penerima: ' Budi ' }, ''), { values: { nama_penerima: 'Budi', catatan_tambahan: '-' } });
  assert.equal(generateBody(TEMPLATE, {}, 'Surat tugas Budi').title, 'Surat tugas Budi');
});

test('a new template: name, a Google Docs link when copying, a short prefix', () => {
  assert.deepEqual(Object.keys(templateErrors({ name: '', source: 'copy', sourceUrl: 'abc', prefix: 'TOO-LONG-PREFIX' })).sort(), ['name', 'prefix', 'sourceUrl']);
  assert.deepEqual(templateErrors({ name: 'Memo', source: 'copy', sourceUrl: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit', prefix: 'MEMO' }), {});
  assert.deepEqual(templateBody({ name: ' Memo ', source: 'blank', scope: 'company', prefix: 'memo' }), { name: 'Memo', source: 'blank', departmentId: null, prefix: 'MEMO' });
  assert.equal(templateBody({ name: 'Memo', source: 'blank', scope: '7' }).departmentId, 7);
});

test('kop: required name, a #RRGGBB colour, letterhead image only when the division has one; logo kept unless changed', () => {
  assert.deepEqual(Object.keys(kopErrors({ companyName: '', accentColor: 'blue', layout: 'letterhead_image' })).sort(), ['accentColor', 'companyName', 'layout']);
  assert.deepEqual(kopErrors({ companyName: 'PT', accentColor: '#1A73E8', layout: 'letterhead_image' }, { hasLetterheadImage: true }), {});
  const v = { layout: 'logo_left', companyName: ' PT A ', headerLines: '', footerText: 'x', showPageNumber: true, accentColor: '#000000' };
  assert.equal('logoBase64' in kopBody(v, undefined, 2), false);
  assert.equal(kopBody(v, null).logoBase64, null);
  assert.equal(kopBody(v, undefined, 2).version, 2);
  assert.equal(kopStatus({ departmentId: 3, kop: null }), 'Memakai kop perusahaan');
});

test('BAST: the other team\'s PIC acknowledges by default; never yourself', () => {
  const pic = { itUserId: 5, gaUserId: 9 };
  assert.equal(defaultAcknowledger('it', pic, 1), '9');
  assert.equal(defaultAcknowledger('ga', pic, 1), '5');
  assert.equal(defaultAcknowledger('it', pic, 9), '');
  const body = bastBody('device', 'return', { team: 'ga', acknowledgerUserId: '5', conditionCode: 'fair', condition: '' });
  assert.deepEqual(body, { kind: 'return', team: 'ga', acknowledgerUserId: 5, accessories: null, condition: 'Cukup', notes: null, conditionCode: 'fair' });
  assert.equal('holderName' in body, false);
  assert.equal(bastErrors('phone', { team: 'it', holderName: ' ' }).holderName, 'Nama karyawan wajib diisi.');
});
