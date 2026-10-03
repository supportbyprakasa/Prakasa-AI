import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGUAGE_OPTIONS, googleOnly, roleNames, signInMethods } from '../src/pages/account/accountModel.js';
import { isSuperAdminUser, userCreatePayload } from '../src/pages/admin/roleAdminModel.js';
import { LANGUAGES, accountLanguageToApply } from '../src/i18n/language.js';
import { pageTrail, hasRouteAccess } from '../src/components/navigation.js';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the account language is applied only when it is set and differs from this browser', () => {
  assert.equal(accountLanguageToApply('en', 'id'), 'en');
  assert.equal(accountLanguageToApply('id', 'en'), 'id');
  // Equal: nothing to do, so the reload after applying can never repeat.
  assert.equal(accountLanguageToApply('en', 'en'), null);
  assert.equal(accountLanguageToApply('id', 'id'), null);
  // Never chosen on the account, or a value this build does not know.
  for (const none of [null, undefined, '', 'fr', 'EN']) assert.equal(accountLanguageToApply(none, 'en'), null);
});

test('the language choice offers exactly the supported languages, in their own words', () => {
  assert.deepEqual(LANGUAGE_OPTIONS.map((option) => option.value), LANGUAGES);
  assert.ok(LANGUAGE_OPTIONS.every((option) => option.data === true), 'never translated');
});

test('sign-in methods come from what the account has', () => {
  assert.deepEqual(signInMethods({ signIn: { google: true, password: true } }), ['Akun Google kantor', 'Email dan kata sandi']);
  assert.deepEqual(signInMethods({ signIn: { google: true, password: false } }), ['Akun Google kantor']);
  assert.deepEqual(signInMethods({ signIn: { google: false, password: true } }), ['Email dan kata sandi']);
  assert.deepEqual(signInMethods({}), []);
  assert.deepEqual(signInMethods(null), []);
});

test('the "Kata sandi" card: a Google-only account is told it needs no password, everyone else that the Super Admin manages it', () => {
  assert.equal(googleOnly({ signIn: { google: true, password: false } }), true);
  assert.equal(googleOnly({ signIn: { google: true, password: true } }), false);
  assert.equal(googleOnly({ signIn: { google: false, password: true } }), false);
  assert.equal(googleOnly({}), false);
  assert.equal(googleOnly(null), false);
});

test('role names: as written, without blanks or repeats', () => {
  assert.deepEqual(roleNames({ roles: [{ name: 'Sales Member' }, { name: ' Sales Member ' }, { name: '' }, null, { name: 'Head Sales' }] }), ['Sales Member', 'Head Sales']);
  assert.deepEqual(roleNames({}), []);
});

test('Pengguna: reset and password fields are for a Super Admin only', () => {
  assert.equal(isSuperAdminUser({ roles: [{ roleKey: 'system.super_admin' }] }), true);
  assert.equal(isSuperAdminUser({ roles: [{ roleKey: 'sales.head' }, { roleKey: 'system.super_admin' }] }), true);
  assert.equal(isSuperAdminUser({ roles: [{ roleKey: 'system.admin' }] }), false);
  assert.equal(isSuperAdminUser({ roles: [{ name: 'Super Admin' }] }), false, 'the role key decides, not the name');
  assert.equal(isSuperAdminUser({}), false);
  assert.equal(isSuperAdminUser(null), false);

  const users = read('pages/admin/Users.jsx');
  assert.match(users, /const superAdmin = isSuperAdminUser\(currentUser\)/);
  // The reset action, the reset dialog and the password field all hang on it.
  assert.match(users, /\{superAdmin \? \(\s*<IconButton size="sm" icon="key"/);
  assert.match(users, /open=\{superAdmin && Boolean\(resetUser\)\}/);
  assert.match(users, /\{superAdmin \? \(\s*<Input\s+label="Kata sandi sementara \(opsional\)"/);
  assert.equal((users.match(/type="password"/g) || []).length, 2);
  assert.doesNotMatch(users, /mustChangePassword/, 'a password set by the Super Admin is always temporary');
  assert.doesNotMatch(read('pages/admin/UserEditorPanel.jsx'), /password|kata sandi/i);
});

test('creating a user: the password is sent only by a Super Admin who typed one', () => {
  const form = { name: 'Ani', email: 'ani@prakasagroup.com', password: 'Sementara123', entityId: '1', departmentId: '3', roleIds: ['41'], status: 'active' };
  const base = { name: 'Ani', email: 'ani@prakasagroup.com', entityId: 1, departmentId: 3, roleIds: [41], status: 'active' };
  assert.deepEqual(userCreatePayload(form, true), { ...base, password: 'Sementara123' });
  assert.deepEqual(userCreatePayload(form, false), base, 'never from an Administrator Sistem');
  assert.deepEqual(userCreatePayload({ ...form, password: '', departmentId: '' }, true), { ...base, departmentId: null }, 'empty: a Google sign-in account');
});

test('/akun: a route for every signed-in user, linked from the account menu, with its own crumb', () => {
  assert.match(read('App.jsx'), /<Route path="akun" element=\{<Account \/>\} \/>/);
  assert.equal(hasRouteAccess('/akun', []), true);
  assert.deepEqual(pageTrail('/akun', []), [{ label: 'Akun saya', to: '/akun' }]);
  const navbar = read('components/Navbar.jsx');
  assert.ok(navbar.indexOf('to="/akun"') > 0 && navbar.indexOf('to="/akun"') < navbar.indexOf('<span>Keluar</span>'), '"Akun saya" sits above "Keluar"');
});

test('the page keeps to its scope: own account only, no HR data, no native dialogs', () => {
  const page = read('pages/account/Account.jsx');
  // Passwords are managed by the Super Admin: no form, no field, no call.
  assert.doesNotMatch(page, /change-password|type="password"|<form|<Input|api\.post/);
  assert.match(page, /Kata sandi akun Anda dikelola oleh Super Admin\. Untuk mengganti atau memulihkannya, hubungi Super Admin\./);
  assert.match(page, /Anda masuk dengan Google; tidak perlu kata sandi\./);
  for (const card of ['<ProfileCard', '<LanguageCard', '<PasswordCard', '<SessionCard']) assert.ok(page.includes(card), card);
  assert.match(page, /Keluar dari semua perangkat/);
  // The only password change left is the forced one after a Super Admin reset.
  assert.match(read('pages/ChangePasswordRequired.jsx'), /'\/auth\/change-password'/);
  assert.match(read('App.jsx'), /user\.passwordChangeRequired\) return <ChangePasswordRequired \/>/);
  assert.doesNotMatch(page, /window\.confirm|[^.\w]confirm\(|alert\(/);
  assert.doesNotMatch(page.replace(/^\s*\/\/.*$/gm, ''), /\b(gaji|rekening|NIK|KTP|NPWP|BPJS|salary|bank)\b/i);
  // The language switch saves on the account before the reload.
  assert.match(read('components/LanguageSwitch.jsx'), /chooseLanguage\(/);
  assert.match(read('i18n/accountLanguage.js'), /'\/auth\/me\/preferences'/);
});
