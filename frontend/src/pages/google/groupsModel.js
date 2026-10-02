import { numberLocale } from '../../i18n/language.js';
// Pure helpers for the Google Groups page (tested in test/googleGroupsModel.test.js).

export const GROUP_TABS = [
  { key: 'mine', label: 'Grup saya' },
  { key: 'all', label: 'Semua grup' },
];

const ROLE_LABELS = { OWNER: 'Pemilik', MANAGER: 'Pengelola', MEMBER: 'Anggota' };
const ROLE_ORDER = { OWNER: 0, MANAGER: 1, MEMBER: 2 };
const TYPE_LABELS = { USER: 'Pengguna', GROUP: 'Grup', CUSTOMER: 'Seluruh domain', EXTERNAL: 'Eksternal' };

export const roleLabel = (role) => ROLE_LABELS[role] || 'Anggota';

// A group role is not a workflow status, so it is not in statusTone.js:
// owners stand out, everyone else stays neutral.
export const roleBadgeTone = (role) => (role === 'OWNER' ? 'info' : 'default');

export const memberTypeLabel = (type) => TYPE_LABELS[type] || 'Lainnya';

export const memberDisplayName = (member) => member?.name || member?.email || '—';

export function sortMembers(members = []) {
  return [...members].sort((a, b) => {
    const byRole = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
    if (byRole) return byRole;
    return memberDisplayName(a).localeCompare(memberDisplayName(b), 'id', { sensitivity: 'base' });
  });
}

export function memberCountLabel(count) {
  const n = Number(count) || 0;
  return `${n.toLocaleString(numberLocale())} anggota`;
}

// The Gmail page reads ?compose=to:<address> to open a prefilled draft.
export function composeHref(email) {
  return `/mail?compose=${encodeURIComponent(`to:${email}`)}`;
}

// Mark which directory groups the signed-in user is already a member of.
export function withMembership(allGroups = [], myGroups = []) {
  const mine = new Set(myGroups.map((group) => String(group.email).toLowerCase()));
  return allGroups.map((group) => ({ ...group, isMember: mine.has(String(group.email).toLowerCase()) }));
}
