const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
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

module.exports = { verifyGoogleIdToken };
