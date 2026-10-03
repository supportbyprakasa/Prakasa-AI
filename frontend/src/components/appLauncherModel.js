// Google Workspace apps shown in the navbar launcher, and the favourites logic.
// Icons are served locally from /public/apps (official Google product icons).
// `to` = the in-app page that replaces the Google site (used when the user has
// `toPermission`); apps Google forbids embedding keep only their external url.

export const APPS = [
  { id: 'account', label: 'Akun', url: 'https://myaccount.google.com/', avatar: true },
  { id: 'admin', label: 'Admin', url: 'https://admin.google.com/', icon: '/apps/admin.png', permission: 'user.manage' },
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com/mail/', icon: '/apps/gmail.png', to: '/mail', toPermission: 'google.mail.use' },
  { id: 'drive', label: 'Drive', url: 'https://drive.google.com/', icon: '/apps/drive.png', to: '/my-drive', toPermission: 'mydrive.view' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app', icon: '/apps/gemini.png' },
  { id: 'docs', label: 'Docs', url: 'https://docs.google.com/document/', icon: '/apps/docs.png', to: '/docs', toPermission: 'google.docs.use' },
  { id: 'sheets', label: 'Sheets', url: 'https://docs.google.com/spreadsheets/', icon: '/apps/sheets.png', to: '/sheets', toPermission: 'google.docs.use' },
  { id: 'slides', label: 'Slides', url: 'https://docs.google.com/presentation/', icon: '/apps/slides.png', to: '/slides', toPermission: 'google.docs.use' },
  { id: 'calendar', label: 'Calendar', url: 'https://calendar.google.com/calendar/', icon: '/apps/calendar.png', to: '/calendar', toPermission: 'meeting.view' },
  { id: 'chat', label: 'Chat', url: 'https://chat.google.com/', icon: '/apps/chat.png', to: '/chat', toPermission: 'google.chat.use' },
  { id: 'meet', label: 'Meet', url: 'https://meet.google.com/', icon: '/apps/meet.png' },
  { id: 'forms', label: 'Forms', url: 'https://docs.google.com/forms/', icon: '/apps/forms.png' },
  { id: 'keep', label: 'Keep', url: 'https://keep.google.com/', icon: '/apps/keep.png' },
  { id: 'contacts', label: 'Kontak', url: 'https://contacts.google.com/', icon: '/apps/contacts.png' },
  { id: 'sites', label: 'Sites', url: 'https://sites.google.com/', icon: '/apps/sites.png' },
  { id: 'groups', label: 'Groups', url: 'https://groups.google.com/', icon: '/apps/groups.png', to: '/groups', toPermission: 'google.groups.view' },
  { id: 'analytics', label: 'Analytics', url: 'https://analytics.google.com/', icon: '/apps/analytics.svg', to: '/analytics', toPermission: 'analytics.view', permission: 'analytics.view' },
];

export const DEFAULT_FAVORITES = ['gmail', 'chat', 'calendar', 'drive', 'docs', 'sheets', 'slides', 'groups', 'analytics'];

export function availableApps(permissions = []) {
  const granted = new Set(permissions);
  return APPS.filter((app) => !app.permission || granted.has(app.permission));
}

// In-app page when the user may open it inside Prakasa Workspace, else null.
export function internalRoute(app, permissions = []) {
  return app.to && (!app.toPermission || permissions.includes(app.toPermission)) ? app.to : null;
}

// Opens the app on the signed-in user's own Google account (multi-account browsers).
export function appUrl(app, email) {
  if (!email) return app.url;
  const url = new URL(app.url);
  url.searchParams.set('authuser', email);
  return url.toString();
}

// Split into favourites (in the user's order) and the rest (catalogue order).
// Unknown or no-longer-available ids are dropped silently.
export function splitApps(apps, favoriteIds) {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const ids = Array.isArray(favoriteIds) ? favoriteIds : DEFAULT_FAVORITES;
  const favorites = ids.map((id) => byId.get(id)).filter(Boolean);
  const favSet = new Set(favorites.map((app) => app.id));
  return { favorites, others: apps.filter((app) => !favSet.has(app.id)) };
}

export function toggleFavorite(favoriteIds, id) {
  const ids = Array.isArray(favoriteIds) ? favoriteIds : DEFAULT_FAVORITES;
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
