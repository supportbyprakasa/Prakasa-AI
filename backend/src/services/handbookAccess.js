// The in-app handbook (Panduan) on the server: who may read which chapter and
// section, and a keyword search over what they may read. The text is
// config/handbook.generated.json, written by frontend/scripts/build-handbook-json.mjs
// from the page's own content — never edited by hand.
//
// The audience rules are a port of frontend/src/pages/handbook/handbookModel.js
// (visibleChapters): a user only reads about what they can open.
//   • audience.permissions — any one of them;
//   • audience.levels      — the user's level ('member' | 'supervisor' | 'head');
//   • audience.roles       — a role key ('sales.head') or a division prefix ('sales');
//   • route                — must pass the menu's route rule (routeAccess in the file).
// Super Admin reads everything; Administrator Sistem with no division role
// reads only the general and administration chapters.
// frontend/test/handbookBackendParity.test.js fails when the two filters differ.
const HANDBOOK = require('../config/handbook.generated.json');

const LEVEL_RANK = { member: 1, supervisor: 2, head: 3 };
const LEVELS = ['member', 'supervisor', 'head'];
const LEVEL_LABELS = { member: 'Member', supervisor: 'Supervisor', head: 'Head', admin: 'Administrator Sistem', super_admin: 'Super Admin' };
const GLOBAL_KEYS = ['system.super_admin', 'system.admin'];

const rolesOf = (user) => (Array.isArray(user?.roles) ? user.roles.filter(Boolean) : []);
const keyOf = (role) => String(role?.roleKey || role?.key || '');

const isSuperAdmin = (user) => rolesOf(user).some((role) => keyOf(role) === 'system.super_admin');

function isSystemAdminOnly(user) {
  const roles = rolesOf(user);
  return roles.some((role) => keyOf(role) === 'system.admin')
    && !roles.some((role) => !GLOBAL_KEYS.includes(keyOf(role)));
}

function levelOfRole(role) {
  const level = String(role?.roleLevel || role?.level || '').toLowerCase();
  if (LEVEL_RANK[level]) return level;
  const suffix = keyOf(role).split('.')[1];
  return LEVEL_RANK[suffix] ? suffix : null;
}

function roleLevel(user) {
  if (isSuperAdmin(user)) return 'super_admin';
  const levels = rolesOf(user).filter((role) => !GLOBAL_KEYS.includes(keyOf(role))).map(levelOfRole).filter(Boolean);
  if (levels.length) return levels.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0];
  if (isSystemAdminOnly(user)) return 'admin';
  return 'member';
}

const roleMatches = (wanted, roles) => roles.some((role) => {
  const key = keyOf(role);
  return wanted.some((entry) => key === entry || key.startsWith(`${entry}.`));
});

function audienceAllows(audience, user) {
  if (!audience) return true;
  const granted = new Set(user?.permissions || []);
  const { permissions, levels, roles } = audience;
  if (Array.isArray(permissions) && permissions.length && !permissions.some((code) => granted.has(code))) return false;
  if (Array.isArray(levels) && levels.length && !levels.includes(roleLevel(user))) return false;
  if (Array.isArray(roles) && roles.length && !roleMatches(roles, rolesOf(user))) return false;
  return true;
}

// A route the generator never saw is refused (fail closed).
function routeAllows(route, user, data = HANDBOOK) {
  if (!route) return true;
  const access = data.routeAccess[String(route).split(/[?#]/)[0]];
  if (!access || access.blocked) return false;
  if (access.open) return true;
  const granted = new Set(user?.permissions || []);
  return (access.anyOf || []).some((code) => granted.has(code));
}

function visibleChapters(user, data = HANDBOOK) {
  if (!user) return [];
  const all = isSuperAdmin(user);
  const adminOnly = isSystemAdminOnly(user);
  return (data.chapters || []).flatMap((chapter) => {
    if (!all) {
      if (adminOnly && !['general', 'admin'].includes(chapter.scope || 'general')) return [];
      if (!audienceAllows(chapter.audience, user) || !routeAllows(chapter.route, user, data)) return [];
    }
    const sections = (chapter.sections || []).filter((section) => all
      || (audienceAllows(section.audience, user) && routeAllows(section.route, user, data)));
    return sections.length ? [{ ...chapter, sections }] : [];
  });
}

function levelNote(audience) {
  const levels = audience?.levels;
  if (!Array.isArray(levels) || !levels.length || levels.length === LEVELS.length) return '';
  return `Khusus ${levels.map((level) => LEVEL_LABELS[level] || level).join(' & ')}`;
}

// ------------------------------------------------------------------ search

function blockText(block) {
  if (!block) return '';
  switch (block.type) {
    case 'p': case 'warning': case 'note':
      return block.text || '';
    case 'steps': case 'tips': case 'list':
      return [block.title, ...(block.items || [])].filter(Boolean).join(' ');
    case 'table':
      return [block.title, ...(block.columns || []), ...(block.rows || []).flat()].filter(Boolean).join(' ');
    case 'faq':
      return (block.items || []).flatMap((item) => [item.q, item.a]).join(' ');
    default:
      return '';
  }
}

const normalize = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOPWORDS = new Set(('bagaimana gimana cara caranya apa apakah siapa kapan dimana mana yang untuk dengan dari dan atau di ke pada itu ini saya aku kami kita anda bisa dapat harus perlu mau ingin '
  + 'agar supaya jika bila kalau adalah ada tidak saja juga lalu kemudian tolong mohon jelaskan sebutkan how do does the to a an is are can what where when i my of in on for and or').split(' '));

// A light Indonesian stem: "mengajukan", "pengajuan", "diajukan" → "aju".
function stem(word) {
  let w = word;
  // "menyetujui" → "setujui": meny-/peny- swallow the root's first "s".
  if (/^(meny|peny)[aiueo]/.test(w)) w = `s${w.slice(4)}`;
  else w = w.replace(/^(meng|mem|men|me|peng|pem|pen|per|pe|di|ber|ter|se)(?=[a-z]{3,})/, '');
  w = w.replace(/(kan|nya|an|i)$/, (m) => (w.length - m.length >= 3 ? '' : m));
  return w.length >= 3 ? w : word;
}

function queryWords(query) {
  const words = normalize(query).split(' ').filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return [...new Set(words)].slice(0, 12).map((word) => ({ word, root: stem(word) }));
}

// Sections scored by keyword: a hit in the section title counts most, then the
// chapter title, then the body; a root-only hit counts half.
function search(chapters, query, { limit = 3 } = {}) {
  const words = queryWords(query);
  if (!words.length) return [];
  const hits = [];
  for (const chapter of chapters || []) {
    const chapterTitle = normalize(`${chapter.title} ${chapter.summary || ''}`);
    for (const section of chapter.sections || []) {
      const title = normalize(section.title);
      const body = normalize((section.body || []).map(blockText).join(' '));
      let score = 0;
      let matched = 0;
      for (const { word, root } of words) {
        const at = (hay, full, half) => (hay.includes(word) ? full : (root !== word && hay.includes(root) ? half : 0));
        const s = at(title, 10, 5) + at(chapterTitle, 3, 1.5) + at(body, 2, 1);
        if (s > 0) matched += 1;
        score += s;
      }
      if (!matched) continue;
      // Sections that answer more of the question's words win over one strong word.
      hits.push({ chapter, section, score: score * (matched / words.length) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = {
  HANDBOOK, LEVELS, LEVEL_LABELS, isSuperAdmin, isSystemAdminOnly, roleLevel, audienceAllows, routeAllows,
  visibleChapters, levelNote, blockText, normalize, stem, queryWords, search,
};
