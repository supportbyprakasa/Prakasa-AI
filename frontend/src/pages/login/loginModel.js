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

const isSuperAdminRole = (role) => role?.roleKey === 'system.super_admin';

// Mirrors the server-side role policy: Super Admin is the only global role; every other
// role grants workspace access only when it belongs to the user's own division.
export function hasUsableAccess(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.some(isSuperAdminRole)) return true;
  if (user.departmentId == null) return false;
  return roles.some((role) => role?.departmentId != null
    && Number(role.departmentId) === Number(user.departmentId));
}
