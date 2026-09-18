const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function upsert(req, res, next) {
  try {
    const { entityId, subjectType, subjectId, classification, tags, notes } = req.body;

    const [r] = await pool.query(
      `INSERT INTO data_classifications
       (entity_id, subject_type, subject_id, classification, tags, classified_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         classification=VALUES(classification),
         tags=VALUES(tags),
         classified_by=VALUES(classified_by),
         classified_at=NOW(),
         notes=VALUES(notes)`,
      [entityId, subjectType, subjectId, classification,
       tags ? JSON.stringify(tags) : null, req.user.sub, notes || null]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'classification.upsert', subjectType, subjectId: Number(subjectId),
      metadata: { classification, tags },
    });

    return ok(res, { id: r.insertId || null });
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try {
    const { subjectType, subjectId } = req.params;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, subject_type AS subjectType,
              subject_id AS subjectId, classification, tags,
              classified_by AS classifiedBy, classified_at AS classifiedAt, notes
         FROM data_classifications
        WHERE subject_type=? AND subject_id=? LIMIT 1`,
      [subjectType, subjectId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Belum ada klasifikasi', 404);
    return ok(res, rows[0]);
  } catch (e) { next(e); }
}

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id=?'); args.push(req.query.entityId); }
    if (req.query.classification) { where.push('classification=?'); args.push(req.query.classification); }
    if (req.query.subjectType) { where.push('subject_type=?'); args.push(req.query.subjectType); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, subject_type AS subjectType,
              subject_id AS subjectId, classification, tags,
              classified_by AS classifiedBy, classified_at AS classifiedAt
         FROM data_classifications WHERE ${where.join(' AND ')}
        ORDER BY classified_at DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { upsert, get, list };
