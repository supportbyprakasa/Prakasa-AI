import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUsableAccess, safeReturnPath } from '../src/pages/login/loginModel.js';

test('safe return path accepts only local non-login destinations', () => {
  assert.equal(safeReturnPath('/warehouse?tab=inbound#latest'), '/warehouse?tab=inbound#latest');
  assert.equal(safeReturnPath('https://evil.example/steal'), '/');
  assert.equal(safeReturnPath('//evil.example/steal'), '/');
  assert.equal(safeReturnPath('/login?returnTo=%2Fwarehouse'), '/');
  assert.equal(safeReturnPath('/login/reset'), '/');
  assert.equal(safeReturnPath(null), '/');
});

test('Super Admin has usable access without a division assignment', () => {
  assert.equal(hasUsableAccess({
    departmentId: null,
    roles: [{ roleKey: 'system.super_admin', departmentId: null }],
  }), true);
});

test('division member, supervisor, and head require a matching division', () => {
  assert.equal(hasUsableAccess({
    departmentId: 8,
    roles: [{ roleKey: 'warehouse.member', roleLevel: 'member', departmentId: 8 }],
  }), true);
  assert.equal(hasUsableAccess({
    departmentId: 8,
    roles: [{ roleKey: 'warehouse.supervisor', roleLevel: 'supervisor', departmentId: 8 }],
  }), true);
  assert.equal(hasUsableAccess({
    departmentId: 8,
    roles: [{ roleKey: 'warehouse.head', roleLevel: 'head', departmentId: 8 }],
  }), true);
});

test('permissions alone or a role without a matching division are not usable access', () => {
  assert.equal(hasUsableAccess({ permissions: ['document.view'], roles: [] }), false);
  assert.equal(hasUsableAccess({
    departmentId: null,
    roles: [{ roleKey: 'warehouse.member', roleLevel: 'member', departmentId: 8 }],
  }), false);
  assert.equal(hasUsableAccess({
    departmentId: 7,
    roles: [{ roleKey: 'warehouse.member', roleLevel: 'member', departmentId: 8 }],
  }), false);
  assert.equal(hasUsableAccess(null), false);
});

test('a new password: 10+ characters with letters and digits, not the old one, not the email name, typed twice', async () => {
  const { passwordErrors } = await import('../src/pages/login/loginModel.js');
  assert.deepEqual(Object.keys(passwordErrors({ currentPassword: '', newPassword: 'pendek', confirm: '' })).sort(), ['currentPassword', 'newPassword']);
  assert.equal(passwordErrors({ currentPassword: 'x', newPassword: 'hanyahurufsaja', confirm: '' }).newPassword, 'Harus memuat huruf dan angka.');
  assert.equal(passwordErrors({ currentPassword: 'x', newPassword: 'ani2026pagi', confirm: 'ani2026pagi' }, 'ani@prakasagroup.com').newPassword, 'Tidak boleh memuat nama email Anda.');
  assert.equal(passwordErrors({ currentPassword: 'x', newPassword: 'KopiPagi2026', confirm: 'beda' }).confirm, 'Tidak sama dengan kata sandi baru.');
  assert.deepEqual(passwordErrors({ currentPassword: 'x', newPassword: 'KopiPagi2026', confirm: 'KopiPagi2026' }), {});
});
