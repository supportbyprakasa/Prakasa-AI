// Pure helpers for Akun saya (/akun); free of React so they can be unit tested.

export const LANGUAGE_OPTIONS = [
  // Each language is written in its own language and never translated.
  { value: 'id', label: 'Indonesia', data: true },
  { value: 'en', label: 'English', data: true },
];

// How this account can sign in, as interface labels. `signIn` comes from
// GET /auth/me: which methods exist, never the secrets behind them.
export function signInMethods(user) {
  const methods = [];
  if (user?.signIn?.google) methods.push('Akun Google kantor');
  if (user?.signIn?.password) methods.push('Email dan kata sandi');
  return methods;
}

// An account that signs in with Google and has no application password.
// Passwords are managed by the Super Admin, so this only picks the sentence
// the "Kata sandi" card shows.
export const googleOnly = (user) => Boolean(user?.signIn?.google) && !user?.signIn?.password;

// Role names as the administrator wrote them (record data).
export function roleNames(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return [...new Set(roles.map((role) => String(role?.name || '').trim()).filter(Boolean))];
}
