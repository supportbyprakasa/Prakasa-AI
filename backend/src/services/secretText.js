// Secret guard for free text (docs/rancangan-people-culture-g2.md §4.1, keputusan 3):
// every register, GA and HRGA free-text field refuses text that looks like a
// written-down password ("password: …", "sandi = …", "PIN: 1234"). Not a
// security boundary on its own — a guard against the habit of noting
// credentials in a notes column. Passwords belong in a password manager.

const { fail } = require('../utils/response');

const SECRET_TEXT_RE = /\b(pass(word|wd)?|kata\s*sandi|sandi|pwd|pin|puk)\s*[:=]/i;
const SECRET_TEXT_CODE = 'SECRET_TEXT';
const SECRET_TEXT_MESSAGE = 'Jangan menulis kata sandi di aplikasi';

/** True when the text looks like a written-down password, PIN or PUK. */
function looksSecret(value) {
  if (value === null || value === undefined) return false;
  return SECRET_TEXT_RE.test(String(value));
}

/** The first of `fields` (keys of `body`) whose value looks secret, or null. */
function secretField(body, fields) {
  if (!body || typeof body !== 'object') return null;
  for (const field of fields) {
    if (looksSecret(body[field])) return field;
  }
  return null;
}

/**
 * zod refinement for one free-text field: `z.string().refine(...noSecret)`.
 * Kept as a plain object so routes do not need to import zod from here.
 */
const noSecret = [(value) => !looksSecret(value), { message: SECRET_TEXT_MESSAGE }];

/** Express middleware: 400 SECRET_TEXT when one of `fields` in the body looks secret. */
function guardSecretText(fields) {
  const list = [].concat(fields);
  return (req, res, next) => {
    const field = secretField(req.body, list);
    if (!field) return next();
    return fail(res, SECRET_TEXT_CODE, SECRET_TEXT_MESSAGE, 400, { field });
  };
}

// The path of the first string anywhere in `value` (objects and arrays
// included) that looks secret, or null.
function secretPath(value, path = '') {
  if (typeof value === 'string') return looksSecret(value) ? (path || '(isi)') : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = secretPath(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const hit = secretPath(inner, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

/** Express middleware: 400 SECRET_TEXT when ANY free-text value of the body looks secret. */
function guardSecretBody() {
  return (req, res, next) => {
    const field = secretPath(req.body);
    if (!field) return next();
    return fail(res, SECRET_TEXT_CODE, SECRET_TEXT_MESSAGE, 400, { field });
  };
}

module.exports = {
  SECRET_TEXT_RE, SECRET_TEXT_CODE, SECRET_TEXT_MESSAGE, looksSecret, secretField, secretPath, noSecret,
  guardSecretText, guardSecretBody,
};
