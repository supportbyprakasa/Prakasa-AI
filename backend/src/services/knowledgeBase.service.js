const pool = require('../db/pool');

/**
 * Pencarian konteks sederhana berbasis keyword (tanpa embedding vector).
 * Alasan: shared hosting tidak punya vector DB. Cukup keyword match + skor TF sederhana.
 * Kalau di masa depan pindah ke VPS, service ini bisa diganti ke embedding search.
 */
async function findRelevantDocs({ entityId, userDepartmentId, userRoleIds, question, limit = 5 }) {
  const keywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 10);

  if (!keywords.length) return [];

  // Query kb_documents yang visible untuk user
  const [rows] = await pool.query(
    `SELECT id, title, category, extracted_text, visibility, allowed_role_ids AS allowedRoleIds,
            entity_id AS entityId, department_id AS departmentId
       FROM kb_documents
      WHERE entity_id=? AND is_active=1 AND deleted_at IS NULL
        AND (
          visibility='entity'
          OR (visibility='department' AND department_id=?)
          OR (visibility='role')
          OR (visibility='private')
        )
      LIMIT 200`,
    [entityId, userDepartmentId || -1]
  );

  // Filter role visibility
  const roleSet = new Set(userRoleIds || []);
  const accessible = rows.filter((d) => {
    if (d.visibility !== 'role') return true;
    try {
      const allowed = typeof d.allowedRoleIds === 'string'
        ? JSON.parse(d.allowedRoleIds) : (d.allowedRoleIds || []);
      return allowed.some((rid) => roleSet.has(rid));
    } catch { return false; }
  });

  // Skor sederhana: hitung keyword yang muncul di extracted_text + title
  const scored = accessible.map((d) => {
    const hay = `${d.title}\n${d.extracted_text || ''}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const count = (hay.match(new RegExp(`\\b${kw}`, 'g')) || []).length;
      score += count;
      if (d.title.toLowerCase().includes(kw)) score += 3;
    }
    return { ...d, score };
  })
  .filter((d) => d.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

  return scored;
}

module.exports = { findRelevantDocs };
