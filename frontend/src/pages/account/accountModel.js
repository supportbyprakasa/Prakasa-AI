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

// The signature tools the user may open from Akun saya (revision F17): the
// pages exist but have no menu entry, and the old document centre that linked
// them is retired. Only the tools the user's permissions allow.
export function signatureTools(permissions) {
  const has = (code) => Array.isArray(permissions) && permissions.includes(code);
  return [
    has('signature.view') ? { to: '/signatures', icon: 'signature', label: 'Permintaan tanda tangan', hint: 'Dokumen yang menunggu tanda tangan Anda dan riwayatnya.' } : null,
    has('signature.manage_asset') ? { to: '/signatures/asset', icon: 'draw', label: 'Tanda tangan saya', hint: 'Unggah atau ganti gambar tanda tangan Anda.' } : null,
    has('letterhead.view') ? { to: '/signatures/letterhead', icon: 'approval', label: 'Cap surat', hint: 'Cap atau kop surat resmi divisi Anda.' } : null,
  ].filter(Boolean);
}
