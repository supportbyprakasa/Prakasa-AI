// Langganan software: what older data breaks the rules the 3 Oct 2026 revision
// enforces (F25 payments, F26 invoices, F27 seats). READ ONLY: every check is a
// SELECT, run inside a READ ONLY transaction that is rolled back. Nothing is
// fixed here — each finding names what a person should check and decide.
// Used by src/scripts/reportSubscriptionReconcile.js.

const EPS = 0.005; // DECIMAL(15,2): a difference under half a cent is equal.

// Every row carries entity_id and subscription_id, so the report can be read
// per company. Only ids and amounts leave the database: no names or emails.
const CHECKS = Object.freeze([
  {
    key: 'seat_multiple_active',
    rule: 'F27',
    label: 'Seat dengan lebih dari satu penetapan aktif',
    meaning: 'Satu seat tercatat aktif untuk beberapa orang sekaligus (biasanya lisensi idle yang dialihkan sebelum revisi).',
    next: 'Pastikan di portal vendor siapa pemegang sebenarnya, lalu catat pencabutan untuk yang lain.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, l.id AS license_id, l.status, l.assigned_to,
                 COUNT(a.id) AS active_assignments
            FROM subscription_licenses l
            JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
            JOIN software_assignments a ON a.license_id = l.id AND a.status = 'active'
           GROUP BY s.entity_id, s.id, l.id, l.status, l.assigned_to
          HAVING COUNT(a.id) > 1`,
  },
  {
    key: 'seat_held_without_assignment',
    rule: 'F27',
    label: 'Seat dipakai/idle tanpa penetapan aktif',
    meaning: 'Seat berstatus dipakai atau idle, tetapi tidak ada catatan penetapan aktif.',
    next: 'Periksa pemegangnya di portal vendor; catat ulang penetapan atau catat pencabutan.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, l.id AS license_id, l.status, l.assigned_to
            FROM subscription_licenses l
            JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
           WHERE l.status IN ('assigned', 'idle')
             AND NOT EXISTS (SELECT 1 FROM software_assignments a WHERE a.license_id = l.id AND a.status = 'active')`,
  },
  {
    key: 'seat_holder_differs',
    rule: 'F27',
    label: 'Pemegang seat berbeda dengan penetapan aktifnya',
    meaning: 'Kolom pemegang seat tidak sama dengan orang di penetapan aktif.',
    next: 'Tentukan pemegang yang benar di portal vendor, lalu samakan catatannya.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, l.id AS license_id, l.status, l.assigned_to, a.user_id AS assignment_user_id
            FROM subscription_licenses l
            JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
            JOIN software_assignments a ON a.license_id = l.id AND a.status = 'active'
           WHERE l.status IN ('assigned', 'idle') AND (l.assigned_to IS NULL OR a.user_id <> l.assigned_to)`,
  },
  {
    key: 'seat_free_with_assignment',
    rule: 'F27',
    label: 'Seat tersedia yang masih punya penetapan aktif',
    meaning: 'Seat terlihat kosong, tetapi masih ada penetapan aktif untuk seseorang.',
    next: 'Konfirmasi akses di portal vendor; tutup penetapan lama atau catat ulang pemegangnya.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, l.id AS license_id, a.user_id AS assignment_user_id
            FROM subscription_licenses l
            JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
            JOIN software_assignments a ON a.license_id = l.id AND a.status = 'active'
           WHERE l.status = 'available'`,
  },
  {
    key: 'invoice_uploaded_without_file',
    rule: 'F26',
    label: 'Invoice "diunggah/terverifikasi" tanpa file',
    meaning: 'Invoice berstatus uploaded atau verified, tetapi tidak punya dokumen PDF.',
    next: 'Unggah PDF-nya lewat "Unggah PDF invoice"; untuk yang verified, periksa ulang dasar verifikasinya.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, i.id AS invoice_id, i.status, i.total_amount, i.currency
            FROM subscription_invoices i
            JOIN software_subscriptions s ON s.id = i.subscription_id AND s.deleted_at IS NULL
           WHERE i.status IN ('uploaded', 'verified') AND i.document_id IS NULL`,
  },
  {
    key: 'invoice_total_mismatch',
    rule: 'F26',
    label: 'Invoice dengan total ≠ subtotal + pajak',
    meaning: 'Nominal invoice tidak konsisten.',
    next: 'Cocokkan dengan PDF invoice dan perbaiki pencatatannya.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, i.id AS invoice_id, i.amount, i.tax_amount, i.total_amount, i.currency
            FROM subscription_invoices i
            JOIN software_subscriptions s ON s.id = i.subscription_id AND s.deleted_at IS NULL
           WHERE ABS(i.amount + COALESCE(i.tax_amount, 0) - i.total_amount) > ${EPS}`,
  },
  {
    key: 'invoice_paid_not_covered',
    rule: 'F25',
    label: 'Invoice "lunas" yang pembayarannya belum menutup total',
    meaning: 'Invoice ditandai paid, padahal jumlah pembayaran tercatat (mata uang sama) kurang dari totalnya — termasuk pembayaran nol atau sebagian sebelum revisi.',
    next: 'Cek bukti bayar di Finance/Accurate; catat kekurangannya bila memang sudah dibayar, atau minta koreksi status.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, i.id AS invoice_id, i.total_amount, i.currency,
                 COALESCE((SELECT SUM(p.amount) FROM subscription_payments p
                            WHERE p.invoice_id = i.id AND p.status = 'processed' AND p.currency = i.currency), 0) AS paid_amount
            FROM subscription_invoices i
            JOIN software_subscriptions s ON s.id = i.subscription_id AND s.deleted_at IS NULL
           WHERE i.status = 'paid'
          HAVING paid_amount + ${EPS} < i.total_amount`,
  },
  {
    key: 'invoice_overpaid',
    rule: 'F25',
    label: 'Invoice dengan pembayaran melebihi total',
    meaning: 'Jumlah pembayaran tercatat (mata uang sama) lebih besar dari total invoice.',
    next: 'Periksa pembayaran ganda; kelebihan yang benar terjadi dicatat sebagai pembayaran tanpa invoice.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, i.id AS invoice_id, i.status, i.total_amount, i.currency,
                 COALESCE((SELECT SUM(p.amount) FROM subscription_payments p
                            WHERE p.invoice_id = i.id AND p.status = 'processed' AND p.currency = i.currency), 0) AS paid_amount
            FROM subscription_invoices i
            JOIN software_subscriptions s ON s.id = i.subscription_id AND s.deleted_at IS NULL
          HAVING paid_amount > i.total_amount + ${EPS}`,
  },
  {
    key: 'payment_not_positive',
    rule: 'F25',
    label: 'Pembayaran dengan jumlah nol atau negatif',
    meaning: 'Catatan pembayaran yang tidak mewakili uang yang dibayar.',
    next: 'Periksa apakah catatan ini salah input; status invoice terkait mungkin ikut keliru.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, p.id AS payment_id, p.invoice_id, p.amount, p.currency
            FROM subscription_payments p
            JOIN software_subscriptions s ON s.id = p.subscription_id AND s.deleted_at IS NULL
           WHERE p.amount <= 0`,
  },
  {
    key: 'payment_currency_mismatch',
    rule: 'F25',
    label: 'Pembayaran dengan mata uang berbeda dari invoicenya',
    meaning: 'Pembayaran (biasanya IDR bawaan) tercatat pada invoice dengan mata uang lain; tidak dihitung sebagai pelunasan.',
    next: 'Cek bukti bayar; catat ulang dalam mata uang invoice bila perlu.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, p.id AS payment_id, p.invoice_id, p.amount, p.currency AS payment_currency, i.currency AS invoice_currency
            FROM subscription_payments p
            JOIN subscription_invoices i ON i.id = p.invoice_id
            JOIN software_subscriptions s ON s.id = p.subscription_id AND s.deleted_at IS NULL
           WHERE p.currency <> i.currency`,
  },
  {
    key: 'payment_wrong_subscription',
    rule: 'F25',
    label: 'Pembayaran yang menunjuk invoice langganan lain',
    meaning: 'Invoice yang dirujuk pembayaran bukan milik langganan pembayaran itu.',
    next: 'Tentukan invoice yang benar dan catat ulang pembayarannya.',
    sql: `SELECT s.entity_id, s.id AS subscription_id, p.id AS payment_id, p.invoice_id, i.subscription_id AS invoice_subscription_id
            FROM subscription_payments p
            JOIN subscription_invoices i ON i.id = p.invoice_id
            JOIN software_subscriptions s ON s.id = p.subscription_id AND s.deleted_at IS NULL
           WHERE i.subscription_id <> p.subscription_id`,
  },
]);

const plain = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));

/**
 * Runs every check on its own connection inside a READ ONLY transaction that
 * is always rolled back. `entityId` narrows to one company.
 */
async function runReport(conn, { entityId = null } = {}) {
  const results = [];
  await conn.query('SET SESSION TRANSACTION READ ONLY');
  await conn.query('START TRANSACTION READ ONLY');
  try {
    for (const check of CHECKS) {
      const [rows] = await conn.query(check.sql);
      const scoped = rows.map(plain).filter((r) => entityId === null || Number(r.entity_id) === Number(entityId));
      results.push({ key: check.key, rule: check.rule, label: check.label, meaning: check.meaning, next: check.next, count: scoped.length, rows: scoped });
    }
  } finally {
    await conn.query('ROLLBACK');
  }
  return { generatedAt: new Date().toISOString(), entityId, total: results.reduce((n, r) => n + r.count, 0), checks: results };
}

module.exports = { CHECKS, runReport };
