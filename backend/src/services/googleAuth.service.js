const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
// 'postmessage' is the redirect_uri Google expects for a JS-popup-triggered
// auth-code exchange (useGoogleLogin's flow: 'auth-code') — there is no real
// redirect, so this exact string is what Google's docs call for here.
const codeClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

// Used by the custom-styled login button (useGoogleLogin flow: 'auth-code'),
// so the visible button isn't constrained to Google's rendered-widget sizes.
// Google rejecting a token or code (expired, wrong audience, forged, reused)
// is a failed sign-in, not a server error: 401, without Google's wording.
// Network trouble reaching Google stays a server error (5xx).
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET']);
function invalidGoogleToken(cause) {
  if (NETWORK_CODES.has(cause?.code)) return cause;
  const err = new Error('Token Google tidak valid atau sudah kedaluwarsa');
  err.status = 401;
  err.code = 'GOOGLE_TOKEN_INVALID';
  err.cause = cause;
  return err;
}

async function exchangeAuthCode(code) {
  let tokens;
  try {
    ({ tokens } = await codeClient.getToken(code));
  } catch (error) {
    throw invalidGoogleToken(error);
  }
  if (!tokens.id_token) {
    const err = new Error('Google tidak mengembalikan id_token');
    err.status = 400;
    err.code = 'GOOGLE_CODE_EXCHANGE_FAILED';
    throw err;
  }
  return verifyGoogleIdToken(tokens.id_token);
}

async function verifyGoogleIdToken(idToken) {
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch (error) {
    throw invalidGoogleToken(error);
  }
  const p = ticket.getPayload();
  // Only an address Google has verified may sign in (an unverified email
  // could belong to someone else).
  if (!p || p.email_verified !== true) {
    const err = new Error('Email Google belum terverifikasi');
    err.status = 403;
    err.code = 'GOOGLE_EMAIL_NOT_VERIFIED';
    throw err;
  }
  const allowed = (process.env.GOOGLE_ALLOWED_DOMAIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(p.hd)) {
    const err = new Error('Domain email tidak diizinkan');
    err.status = 403;
    err.code = 'DOMAIN_NOT_ALLOWED';
    throw err;
  }
  return {
    sub: p.sub,
    email: p.email,
    name: p.name,
    picture: p.picture,
  };
}

module.exports = { verifyGoogleIdToken, exchangeAuthCode, client, codeClient };
