const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.entityId) { where.push('p.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.sampleRequestId) { where.push('p.sample_request_id = ?'); args.push(req.query.sampleRequestId); }

    const [rows] = await pool.query(
      `SELECT p.id, p.entity_id AS entityId, p.department_id AS departmentId,
              p.sample_task_id AS sampleTaskId, p.sample_request_id AS sampleRequestId,
              s.product_name AS productName, c.name AS customerName,
              p.recipient_name AS recipientName, p.recipient_phone AS recipientPhone,
              p.delivered_at AS deliveredAt, p.address,
              p.photo_web_view_link AS photoWebViewLink, p.notes,
              p.delivered_by AS deliveredBy, u.name AS deliveredByName,
              p.created_at AS createdAt
         FROM warehouse_delivery_proofs p
         LEFT JOIN sales_sample_requests s ON s.id = p.sample_request_id
         LEFT JOIN sales_customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = p.delivered_by
        WHERE ${where.join(' AND ')}
        ORDER BY p.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

/**
 * Upload delivery proof (multipart) — foto opsional.
 * Setelah sukses:
 *  - tandai warehouse_sample_tasks sebagai 'delivered'
 *  - buat sales_followups untuk PIC sales (auto reminder)
 *  - notifikasi ke sales PIC
 */
async function upload(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, sampleTaskId, recipientName, recipientPhone,
      deliveredAt, address, notes,
    } = req.body;

    // Validasi sample task
    const [wt] = await pool.query(
      `SELECT * FROM warehouse_sample_tasks WHERE id=?`, [sampleTaskId]
    );
    if (!wt[0]) return fail(res, 'NOT_FOUND', 'Sample task tidak ditemukan', 404);

    let photoUploaded = null;
    if (req.file) {
      photoUploaded = await drive.uploadFile({
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
    }

    await conn.beginTransaction();
    const [proof] = await conn.query(
      `INSERT INTO warehouse_delivery_proofs
       (entity_id, department_id, sample_task_id, sample_request_id,
        recipient_name, recipient_phone, delivered_at, address,
        photo_drive_file_id, photo_web_view_link, notes, delivered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, sampleTaskId, wt[0].sample_request_id,
       recipientName || null, recipientPhone || null,
       deliveredAt || new Date(), address || null,
       photoUploaded?.id || null, photoUploaded?.webViewLink || null,
       notes || null, req.user.sub]
    );

    // update warehouse task
    await conn.query(
      `UPDATE warehouse_sample_tasks SET status='delivered', delivered_at=NOW() WHERE id=?`,
      [sampleTaskId]
    );
    await conn.query(
      `UPDATE sales_sample_requests SET status='delivered' WHERE id=?`,
      [wt[0].sample_request_id]
    );

    // Buat sales_followups otomatis
    const [sr] = await conn.query(
      `SELECT * FROM sales_sample_requests WHERE id=?`, [wt[0].sample_request_id]
    );
    const sample = sr[0];
    let followUpId = null;
    if (sample) {
      const [fu] = await conn.query(
        `INSERT INTO sales_followups
         (entity_id, department_id, customer_id, pipeline_id, assigned_to,
          due_date, title, description, source, created_by)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 2 DAY), ?, ?, 'delivery_proof', ?)`,
        [entityId, departmentId || null, sample.customer_id, sample.pipeline_id,
         sample.requested_by, `Follow up setelah sample: ${sample.product_name}`,
         `Sample ${sample.product_name} sudah diantar. Follow up customer untuk konversi.`,
         req.user.sub]
      );
      followUpId = fu.insertId;
    }

    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'delivery_proof.upload', subjectType: 'warehouse_delivery_proof',
      subjectId: proof.insertId, metadata: { sampleTaskId, followUpId },
    });

    // Notifikasi ke sales PIC
    if (sample?.requested_by) {
      await notif.create({
        userId: sample.requested_by, entityId,
        title: 'Sample sudah diantar',
        body: `${sample.product_name} telah diantar. Follow up customer untuk konversi.`,
        event: 'delivery_proof.uploaded',
        subjectType: 'warehouse_delivery_proof', subjectId: proof.insertId,
        actionUrl: `/sales/followups`,
      });
    }

    return ok(res, {
      id: proof.insertId,
      photoWebViewLink: photoUploaded?.webViewLink || null,
      followUpId,
    }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

module.exports = { list, upload };
