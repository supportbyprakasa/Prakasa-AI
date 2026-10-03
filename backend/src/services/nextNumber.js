const { todayWib } = require('../utils/wibTime');

// Document numbers like ONB-202610-0001 (People & Culture wave 2, audit 0.2 /
// critique D1). COUNT(*)+1 handed two concurrent requests the same number; this
// helper serialises them per prefix and entity with a named lock, reads the
// highest sequence with a locking read (so a snapshot taken earlier in the
// transaction cannot hide a number committed since), and the column's UNIQUE
// index stays the backstop: `insertWithNumber` retries once on ER_DUP_ENTRY.
//
// The named lock belongs to the connection, not the transaction. Hold it until
// the transaction has committed or rolled back (`release()` in a finally), so
// the next request can only read the maximum after this number is visible.

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const LOCK_WAIT_SECONDS = 5;

class SequenceError extends Error {
  constructor(message) {
    super(message);
    this.code = 'SEQUENCE_BUSY';
    this.status = 503;
  }
}

function stemOf(prefix, day = todayWib()) {
  return `${prefix}-${String(day).slice(0, 7).replace('-', '')}-`;
}

async function lockSequence(conn, prefix, entityId) {
  const name = `seq:${prefix}:${entityId}`;
  const [[row]] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [name, LOCK_WAIT_SECONDS]);
  if (Number(row?.got) !== 1) throw new SequenceError('Nomor dokumen sedang dibuat oleh permintaan lain. Coba lagi sebentar.');
  return async () => { try { await conn.query('DO RELEASE_LOCK(?)', [name]); } catch { /* connection gone: lock gone */ } };
}

/** The next free number for `prefix` this WIB month (call with the lock held). */
async function peekNumber(conn, { table, column, prefix, day }) {
  if (!IDENT_RE.test(table) || !IDENT_RE.test(column)) throw new Error('nextNumber: nama tabel/kolom tidak valid');
  const stem = stemOf(prefix, day);
  const [[row]] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING(${column}, ?) AS UNSIGNED)) AS n FROM ${table} WHERE ${column} LIKE ? FOR UPDATE`,
    [stem.length + 1, `${stem}%`],
  );
  return `${stem}${String(Number(row?.n || 0) + 1).padStart(4, '0')}`;
}

/**
 * Locks the sequence, then calls `insert(number)`; on a duplicate number it
 * reads the maximum again and retries once. → { number, result, release }.
 * The caller must `await release()` after its commit/rollback.
 */
async function insertWithNumber(conn, { table, column, prefix, entityId, day }, insert) {
  const release = await lockSequence(conn, prefix, entityId);
  try {
    for (let attempt = 0; ; attempt += 1) {
      const number = await peekNumber(conn, { table, column, prefix, day });
      try {
        const result = await insert(number);
        return { number, result, release };
      } catch (e) {
        const duplicateNumber = e?.code === 'ER_DUP_ENTRY' && String(e.message || '').includes(number);
        if (!duplicateNumber || attempt >= 1) throw e;
      }
    }
  } catch (e) {
    await release();
    throw e;
  }
}

module.exports = { SequenceError, stemOf, lockSequence, peekNumber, insertWithNumber };
