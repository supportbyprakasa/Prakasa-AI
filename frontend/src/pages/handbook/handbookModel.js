// Panduan (handbook): which chapters and sections a signed-in user may read,
// search over them, and the outline. Pure functions — no React, no fetch — so
// the page, the unit tests and scripts/build-handbook-docs.mjs share them.
//
// The rule (owner, 1 Oct 2026: "handbooknya ada batasan untuk isinya,
// disesuaikan role nya aja"): a user only reads about what they can open.
//   • audience.permissions — any one of them (the same codes the menu uses);
//   • audience.levels      — the user's level ('member' | 'supervisor' | 'head');
//   • audience.roles       — a role key ('sales.head') or a division prefix ('sales');
//   • route                — the page the text is about; it must also pass
//                            hasRouteAccess, so the handbook never describes a
//                            page the menu would refuse.
// Super Admin reads everything. Administrator Sistem (system.admin, no
// division role) reads only the general and administration chapters.
import { hasRouteAccess } from '../../components/navigation.js';

export const LEVELS = ['member', 'supervisor', 'head'];
const LEVEL_RANK = { member: 1, supervisor: 2, head: 3 };
const GLOBAL_KEYS = ['system.super_admin', 'system.admin'];

export const LEVEL_LABELS = {
  member: 'Member',
  supervisor: 'Supervisor',
  head: 'Head',
  admin: 'Administrator Sistem',
  super_admin: 'Super Admin',
};

const rolesOf = (user) => (Array.isArray(user?.roles) ? user.roles.filter(Boolean) : []);
const keyOf = (role) => String(role?.roleKey || role?.key || '');

export function isSuperAdmin(user) {
  return rolesOf(user).some((role) => keyOf(role) === 'system.super_admin');
}

// Administrator Sistem with no division role: configuration only.
export function isSystemAdminOnly(user) {
  const roles = rolesOf(user);
  return roles.some((role) => keyOf(role) === 'system.admin')
    && !roles.some((role) => !GLOBAL_KEYS.includes(keyOf(role)));
}

// The level of one role: its roleLevel, else the suffix of a standard key.
function levelOfRole(role) {
  const level = String(role?.roleLevel || role?.level || '').toLowerCase();
  if (LEVEL_RANK[level]) return level;
  const suffix = keyOf(role).split('.')[1];
  return LEVEL_RANK[suffix] ? suffix : null;
}

// 'super_admin' | 'head' | 'supervisor' | 'member' | 'admin'. The most senior
// division role wins (head > supervisor > member); a user with only the
// Administrator Sistem role is 'admin'; no recognisable role reads as member.
export function roleLevel(user) {
  if (isSuperAdmin(user)) return 'super_admin';
  const levels = rolesOf(user).filter((role) => !GLOBAL_KEYS.includes(keyOf(role))).map(levelOfRole).filter(Boolean);
  if (levels.length) return levels.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0];
  if (isSystemAdminOnly(user)) return 'admin';
  return 'member';
}

// "Sales Head", or "Sales Head, Marketing Member"; the level when no names.
export function roleLabel(user) {
  const names = rolesOf(user).map((role) => role.name).filter(Boolean);
  if (names.length) return [...new Set(names)].join(', ');
  return LEVEL_LABELS[roleLevel(user)] || 'Karyawan';
}

const roleMatches = (wanted, roles) => roles.some((role) => {
  const key = keyOf(role);
  return wanted.some((entry) => key === entry || key.startsWith(`${entry}.`));
});

// One audience object against one user (super admin handled by the caller).
export function audienceAllows(audience, user) {
  if (!audience) return true;
  const granted = new Set(user?.permissions || []);
  const { permissions, levels, roles } = audience;
  if (Array.isArray(permissions) && permissions.length && !permissions.some((code) => granted.has(code))) return false;
  if (Array.isArray(levels) && levels.length && !levels.includes(roleLevel(user))) return false;
  if (Array.isArray(roles) && roles.length && !roleMatches(roles, rolesOf(user))) return false;
  return true;
}

const routeAllows = (route, user) => !route || hasRouteAccess(String(route).split(/[?#]/)[0], user?.permissions || []);

// The chapters (and inside them the sections) this user may read. A chapter
// left without sections is dropped. Content objects are not mutated.
export function visibleChapters(user, content) {
  if (!user) return [];
  const all = isSuperAdmin(user);
  const adminOnly = isSystemAdminOnly(user);
  return (content || []).flatMap((chapter) => {
    if (!all) {
      if (adminOnly && !['general', 'admin'].includes(chapter.scope || 'general')) return [];
      if (!audienceAllows(chapter.audience, user) || !routeAllows(chapter.route, user)) return [];
    }
    const sections = (chapter.sections || []).filter((section) => all
      || (audienceAllows(section.audience, user) && routeAllows(section.route, user)));
    return sections.length ? [{ ...chapter, sections }] : [];
  });
}

// ------------------------------------------------------------------ text

// Every readable string of a block, for search and plain-text export.
export function blockText(block) {
  if (!block) return '';
  switch (block.type) {
    case 'p':
    case 'warning':
    case 'note':
      return block.text || '';
    case 'steps':
    case 'tips':
    case 'list':
      return [block.title, ...(block.items || [])].filter(Boolean).join(' ');
    case 'table':
      return [block.title, ...(block.columns || []), ...(block.rows || []).flat()].filter(Boolean).join(' ');
    case 'faq':
      return (block.items || []).flatMap((item) => [item.q, item.a]).join(' ');
    default:
      return '';
  }
}

export const sectionText = (section) => [section.title, ...(section.body || []).map(blockText)].join(' ');

// Lower case, no accents, single spaces.
export function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const anchorFor = (chapterId, sectionId) => (sectionId ? `${chapterId}-${sectionId}` : chapterId);

// A short piece of text around the first match.
function snippet(text, word, size = 140) {
  const flat = String(text).replace(/\s+/g, ' ');
  const at = normalize(flat).indexOf(word);
  if (at < 0) return flat.slice(0, size);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + size)}${start + size < flat.length ? '…' : ''}`;
}

// Sections whose text holds every word of the query, best first: a match in
// the section title counts most, then the chapter title, then the body.
export function search(chapters, query) {
  const words = normalize(query).split(' ').filter((word) => word.length > 1);
  if (!words.length) return [];
  const hits = [];
  for (const chapter of chapters || []) {
    const chapterTitle = normalize(`${chapter.title} ${chapter.summary || ''}`);
    for (const section of chapter.sections || []) {
      const title = normalize(section.title);
      const body = normalize(sectionText(section));
      const haystack = `${chapterTitle} ${body}`;
      if (!words.every((word) => haystack.includes(word))) continue;
      const score = words.reduce((sum, word) => sum
        + (title.includes(word) ? 10 : 0) + (chapterTitle.includes(word) ? 3 : 0) + (body.includes(word) ? 1 : 0), 0);
      const bodyOnly = (section.body || []).map(blockText).join(' ');
      hits.push({
        chapterId: chapter.id,
        sectionId: section.id,
        anchor: anchorFor(chapter.id, section.id),
        chapterTitle: chapter.title,
        title: section.title,
        icon: chapter.icon,
        snippet: snippet(bodyOnly, words.find((word) => normalize(bodyOnly).includes(word)) || words[0]),
        score,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

// The left-hand outline: chapters with their section anchors, plus the part
// they belong to so the page can group them.
export function buildOutline(chapters) {
  return (chapters || []).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    icon: chapter.icon,
    part: chapter.part || null,
    anchor: anchorFor(chapter.id),
    sections: (chapter.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      anchor: anchorFor(chapter.id, section.id),
      restricted: Boolean(section.audience?.levels?.length),
    })),
  }));
}

// The outline split into its parts, in content order.
export function outlineParts(outline) {
  const parts = [];
  for (const entry of outline || []) {
    const last = parts[parts.length - 1];
    if (last && last.title === entry.part) last.chapters.push(entry);
    else parts.push({ title: entry.part, chapters: [entry] });
  }
  return parts;
}

// "Khusus Supervisor & Head" for a section limited by level, else ''.
export function levelNote(audience) {
  const levels = audience?.levels;
  if (!Array.isArray(levels) || !levels.length || levels.length === LEVELS.length) return '';
  return `Khusus ${levels.map((level) => LEVEL_LABELS[level] || level).join(' & ')}`;
}

// Every route the content links to (chapters and sections), for the tests.
export function contentRoutes(content) {
  return (content || []).flatMap((chapter) => [
    ...(chapter.route ? [{ where: chapter.id, route: chapter.route }] : []),
    ...(chapter.sections || []).filter((section) => section.route)
      .map((section) => ({ where: anchorFor(chapter.id, section.id), route: section.route })),
  ]);
}
