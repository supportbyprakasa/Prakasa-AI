import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyErrorState } from '../src/pages/public/verifyModel.js';

// F22: only the server's own 404/400 says a code is unknown or invalid; a
// timeout, network error, 5xx or rate limit never marks a document as fake.
test('404 and 400 are the server\'s answers about the code', () => {
  assert.equal(verifyErrorState({ response: { status: 404, data: { error: { message: 'Kode verifikasi tidak ditemukan' } } } }).kind, 'not_found');
  const invalid = verifyErrorState({ response: { status: 400 } });
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.retry, false);
});

test('timeout, network failure, 5xx and 429 read "Belum dapat memverifikasi" with a retry', () => {
  for (const error of [{ code: 'ECONNABORTED' }, { message: 'Network Error' }, { response: { status: 500 } }, { response: { status: 503 } }, { response: { status: 429 } }]) {
    const state = verifyErrorState(error);
    assert.equal(state.title, 'Belum dapat memverifikasi', JSON.stringify(error));
    assert.equal(state.retry, true);
    assert.notEqual(state.tone, 'error');
    assert.doesNotMatch(state.title + state.description, /tidak ditemukan|tidak valid/);
  }
});
