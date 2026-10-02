const pool = require('../db/pool');

// The Warehouse division of a company (departments.code 'warehouse'), or null
// when the company has none — then the row is visible company-wide only.
async function warehouseDepartmentId(entityId) {
  const [[row]] = await pool.query(
    "SELECT id FROM departments WHERE entity_id = ? AND code = 'warehouse' AND deleted_at IS NULL ORDER BY id LIMIT 1",
    [entityId],
  );
  return row ? Number(row.id) : null;
}

module.exports = { warehouseDepartmentId };
