import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBaseUrl, resolvePublicVerificationBaseUrl } from '../src/api/endpointModel.js';

test('production uses VITE_API_URL for the API and its origin for /verify', () => {
  const env = { dev: false, apiUrl: 'https://api.example.co.id/api/v1/' };
  assert.equal(resolveApiBaseUrl(env), 'https://api.example.co.id/api/v1');
  assert.equal(resolvePublicVerificationBaseUrl(env), 'https://api.example.co.id');
});

test('production without VITE_API_URL keeps the same-origin legacy paths', () => {
  assert.equal(resolveApiBaseUrl({ dev: false }), '/api/v1');
  assert.equal(resolveApiBaseUrl({ dev: false, apiUrl: '  ' }), '/api/v1');
  assert.equal(resolvePublicVerificationBaseUrl({ dev: false }), '/api/public');
  assert.equal(resolvePublicVerificationBaseUrl({ dev: false, apiUrl: '/api/v1' }), '/api/public');
});

test('development keeps its previous behaviour', () => {
  assert.equal(resolveApiBaseUrl({ dev: true, apiUrl: 'http://localhost:3000/api/v1' }), 'http://localhost:3000/api/v1');
  assert.equal(resolveApiBaseUrl({ dev: true }), '/api/v1');
  assert.equal(resolvePublicVerificationBaseUrl({ dev: true, apiUrl: 'http://localhost:3000/api/v1' }), 'http://localhost:3000');
  assert.equal(resolvePublicVerificationBaseUrl({ dev: true }), 'http://localhost:3000');
});
