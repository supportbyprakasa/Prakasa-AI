const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('./activityLog.service');

const DEFAULT_MAX_ROWS = 1000;

// Thrown by an insertRow callback to reject one row with a field-level message.
class ImportRowError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

function batchError(code, message) {
  return Object.assign(new Error(message), { code, status: 400 });
}

function rowErrorsFromSchema(rowNumber, error) {
  const { fieldErrors, formErrors } = error.flatten();
  return [
    ...formErrors.map((message) => ({ rowNumber, field: null, message })),
    ...Object.entries(fieldErrors).flatMap(([field, messages]) => (
      messages.length ? [{ rowNumber, field, message: messages[0] }] : []
    )),
  ];
}

/**
 * All-or-nothing import: validate every row against `schema`, then insert them in one
 * transaction. Any rejected row rolls back the whole batch and every row error is returned.
 */
async function runBulkImport({ rows, schema, insertRow, maxRows = DEFAULT_MAX_ROWS }) {
  if (!Array.isArray(rows) || !rows.length) throw batchError('IMPORT_EMPTY', 'Tidak ada baris untuk diimport');
  if (rows.length > maxRows) throw batchError('IMPORT_TOO_LARGE', `Maksimal ${maxRows} baris per import`);

  const parsed = [];
  const rowErrors = [];
  for (const row of rows) {
    const rowNumber = Number(row?.rowNumber) || parsed.length + rowErrors.length + 2;
    const result = schema.safeParse(row?.values ?? {});
    if (result.success) parsed.push({ rowNumber, data: result.data });
    else rowErrors.push(...rowErrorsFromSchema(rowNumber, result.error));
  }
  if (rowErrors.length) return { ok: false, rowErrors };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    for (const { rowNumber, data } of parsed) {
      try {
        ids.push(await insertRow(connection, data, rowNumber));
      } catch (error) {
        if (error instanceof ImportRowError) {
          rowErrors.push({ rowNumber, field: error.field, message: error.message });
        } else if (error.code === 'ER_DUP_ENTRY') {
          rowErrors.push({ rowNumber, field: null, message: 'Data sudah ada (duplikat)' });
        } else {
          throw error;
        }
      }
    }
    if (rowErrors.length) {
      await connection.rollback();
      return { ok: false, rowErrors };
    }
    await connection.commit();
    return { ok: true, created: ids.length, ids };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Express handler for `POST /<resource>/import` with body `{ rows: [{ rowNumber, values }] }`. */
function importHandler({ schema, insertRow, action, subjectType, maxRows }) {
  return async (req, res, next) => {
    try {
      const result = await runBulkImport({
        rows: req.body?.rows,
        schema,
        maxRows,
        insertRow: (connection, data, rowNumber) => insertRow(connection, data, { req, rowNumber }),
      });
      if (!result.ok) {
        return fail(
          res,
          'IMPORT_ROWS_INVALID',
          `${new Set(result.rowErrors.map((e) => e.rowNumber)).size} baris ditolak. Tidak ada data yang disimpan.`,
          422,
          { rowErrors: result.rowErrors },
        );
      }
      await log({
        entityId: req.user.entityId ?? null,
        userId: req.user.sub,
        action,
        subjectType,
        subjectId: null,
        metadata: { created: result.created, ids: result.ids },
      });
      return ok(res, { created: result.created }, undefined, 201);
    } catch (error) {
      if (error.code === 'IMPORT_EMPTY' || error.code === 'IMPORT_TOO_LARGE') {
        return fail(res, error.code, error.message, 400);
      }
      return next(error);
    }
  };
}

module.exports = { ImportRowError, importHandler, runBulkImport };
