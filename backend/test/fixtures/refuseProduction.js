// Required by every test that talks to a real database: refuses to run when
// the environment (or backend/.env) says production, so a test run on the
// server can never write to — or roll back on — the live database.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

if (process.env.NODE_ENV === 'production') {
  throw new Error('Tes database ditolak: NODE_ENV=production. Jalankan tes hanya di mesin lokal (database tests refuse to run in production).');
}
