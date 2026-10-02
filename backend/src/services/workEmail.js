// Work email of the directory (People & Culture wave 1, rule 9).
//
// A work email must be on one of the company's Google Workspace domains, the
// same list sign-in uses: GOOGLE_ALLOWED_DOMAIN (comma-separated, e.g.
// "prakasagroup.com,prakasafoods.com"). The domain is the text after the LAST
// '@' and must equal a listed domain exactly — "x@evil-prakasafoods.com" or
// "x@prakasafoods.com.evil.id" never pass. Without the setting nothing is
// accepted (unlike sign-in, which allows every domain when it is empty), and a
// personal mailbox is refused even if someone lists its domain.

const PERSONAL_DOMAINS = Object.freeze([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'hotmail.com',
  'outlook.com', 'live.com', 'icloud.com', 'ymail.com',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function workEmailDomains(env = process.env) {
  return String(env.GOOGLE_ALLOWED_DOMAIN || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

const domainOf = (email) => {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1);
};

/**
 * { ok: true, email } for an acceptable work email (trimmed, lowercased), else
 * { ok: false, code, message } with an Indonesian message for the form.
 */
function checkWorkEmail(value, env = process.env) {
  const email = normalizeEmail(value);
  if (!email || !EMAIL_RE.test(email) || email.length > 190) {
    return { ok: false, code: 'WORK_EMAIL_INVALID', message: 'Format email kerja tidak valid' };
  }
  const domain = domainOf(email);
  if (PERSONAL_DOMAINS.includes(domain)) {
    return { ok: false, code: 'WORK_EMAIL_PERSONAL', message: 'Email pribadi tidak boleh dipakai sebagai email kerja' };
  }
  const domains = workEmailDomains(env);
  if (!domains.length) {
    return { ok: false, code: 'WORK_EMAIL_DOMAINS_UNSET', message: 'Domain email kerja belum diatur (GOOGLE_ALLOWED_DOMAIN). Hubungi admin sistem.' };
  }
  if (!domains.includes(domain)) {
    return { ok: false, code: 'WORK_EMAIL_DOMAIN', message: `Email kerja harus memakai domain perusahaan: ${domains.join(', ')}` };
  }
  return { ok: true, email };
}

module.exports = { PERSONAL_DOMAINS, workEmailDomains, checkWorkEmail, normalizeEmail, domainOf };
