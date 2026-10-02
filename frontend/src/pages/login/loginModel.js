// Pure helpers for the login flow; kept free of React so they can be unit tested.

const RETURN_PATH_BASE = 'https://prakasa.invalid';

// Accept only same-origin application paths. Anything external, protocol-relative,
// malformed, or pointing back into the login flow falls back to the home dashboard.
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/';

  let url;
  try {
    url = new URL(value, RETURN_PATH_BASE);
  } catch {
    return '/';
  }
  if (url.origin !== RETURN_PATH_BASE) return '/';
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}

// Roles tied to no division: Super Admin, and Administrator Sistem (configures
// the system, reads no division data).
const GLOBAL_ROLE_KEYS = ['system.super_admin', 'system.admin'];
const isGlobalRole = (role) => GLOBAL_ROLE_KEYS.includes(role?.roleKey);

// Mirrors the server-side role policy: the global roles work without a
// division; every other role grants workspace access only when it belongs to
// the user's own division.
export function hasUsableAccess(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.some(isGlobalRole)) return true;
  if (user.departmentId == null) return false;
  return roles.some((role) => role?.departmentId != null
    && Number(role.departmentId) === Number(user.departmentId));
}

/** Checks for a new password (mirrors POST /auth/change-password). */
export function passwordErrors({ currentPassword, newPassword, confirm }, email = '') {
  const errors = {};
  if (!currentPassword) errors.currentPassword = 'Isi kata sandi saat ini.';
  const pw = String(newPassword || '');
  if (pw.length < 10) errors.newPassword = 'Minimal 10 karakter.';
  else if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) errors.newPassword = 'Harus memuat huruf dan angka.';
  else if (pw === currentPassword) errors.newPassword = 'Harus berbeda dari kata sandi saat ini.';
  else if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) errors.newPassword = 'Tidak boleh memuat nama email Anda.';
  if (!errors.newPassword && confirm !== pw) errors.confirm = 'Tidak sama dengan kata sandi baru.';
  return errors;
}
