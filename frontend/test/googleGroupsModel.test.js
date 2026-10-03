import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_TABS, composeHref, memberCountLabel, memberDisplayName, memberTypeLabel,
  roleBadgeTone, roleLabel, sortMembers, withMembership,
} from '../src/pages/google/groupsModel.js';

test('tabs: Grup saya first, then Semua grup', () => {
  assert.deepEqual(GROUP_TABS.map((tab) => tab.label), ['Grup saya', 'Semua grup']);
});

test('compose link prefills the Gmail page with the group address', () => {
  const href = composeHref('sales@prakasafoods.com');
  assert.ok(href.startsWith('/mail?compose='));
  assert.equal(new URLSearchParams(href.split('?')[1]).get('compose'), 'to:sales@prakasafoods.com');
});

test('roles and member types have Indonesian labels; only owners stand out', () => {
  assert.equal(roleLabel('OWNER'), 'Pemilik');
  assert.equal(roleLabel('MANAGER'), 'Pengelola');
  assert.equal(roleLabel('MEMBER'), 'Anggota');
  assert.equal(roleLabel(undefined), 'Anggota');
  assert.equal(roleBadgeTone('OWNER'), 'info');
  assert.equal(roleBadgeTone('MEMBER'), 'default');
  assert.equal(memberTypeLabel('GROUP'), 'Grup');
  assert.equal(memberTypeLabel('???'), 'Lainnya');
});

test('members sort owners → managers → members, then by name/email', () => {
  const sorted = sortMembers([
    { email: 'z@x.com', role: 'MEMBER' },
    { email: 'b@x.com', role: 'MEMBER', name: 'Andi' },
    { email: 'm@x.com', role: 'MANAGER' },
    { email: 'o@x.com', role: 'OWNER' },
  ]);
  assert.deepEqual(sorted.map((m) => m.email), ['o@x.com', 'm@x.com', 'b@x.com', 'z@x.com']);
  assert.equal(memberDisplayName({ email: 'x@y.com', name: null }), 'x@y.com');
});

test('member counts and membership flags', () => {
  assert.equal(memberCountLabel(1234), '1.234 anggota');
  assert.equal(memberCountLabel(undefined), '0 anggota');
  const flagged = withMembership([{ email: 'A@x.com' }, { email: 'b@x.com' }], [{ email: 'a@x.com' }]);
  assert.deepEqual(flagged.map((g) => g.isMember), [true, false]);
});
