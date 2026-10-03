const readXlsxFile = require('read-excel-file/node').default;
const pool = require('../db/pool');
const salesOwners = require('./salesOwners.service');
const { DEFAULT_DIVISION } = require('./salesStatus');

// Field visits from SimpliDOTS. The team walks its routes with the SimpliDOTS
// app (check-in/out with GPS); its "DailyVisits" export is uploaded here so
// leads and the pipeline stay current. Only cell values are read — macros
// never run, and nothing is ever written back to SimpliDOTS.
//
// Visits noted by hand in this app live alongside imported ones. Re-uploading
// the same export updates rather than duplicates: every imported visit carries
// external_key = employee|date|outlet.

const MAX_ROWS = 20000;
const REQUIRED = ['EmployeeCode', 'EmployeeName', 'Date', 'CustomerCode', 'CustomerName'];
const DAY_MS = 86400000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

class ImportFormatError extends Error {
  constructor(message) {
    super(message);
    this.code = 'SIMPLIDOTS_FORMAT';
    this.status = 422;
  }
}

// ---------------------------------------------------------------- cell readers

const text = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && s !== '-' && s !== '#N/A' ? s : null;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pad = (n) => String(n).padStart(2, '0');

// A Date (read-excel-file stores dates at UTC midnight), an Excel serial,
// 'YYYY-MM-DD' or 'DD/MM/YYYY' → 'YYYY-MM-DD', else null.
function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(EXCEL_EPOCH + Math.round(v) * DAY_MS).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

function clock(v) {
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

function minutes(v) {
  // Excel stores a duration as a time of day on 1899-12-30.
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  const m = String(v ?? '').trim().match(/^(\d{1,3}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const truthy = (v) => v === true || /^(true|ya|yes|1)$/i.test(String(v ?? '').trim());

const coord = (v, limit) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n !== 0 && Math.abs(n) <= limit ? Math.round(n * 1e7) / 1e7 : null;
};

// ---------------------------------------------------------------- parsing

// Some rows of the export come from an older layout without the "Area" column,
// so everything from Area onward sits one cell to the left: the Area cell then
// holds the outlet latitude (a number). Such a row is shifted back into place.
function realignVisitRow(head, row) {
  const area = head.indexOf('Area');
  if (area < 0 || typeof row[area] !== 'number' || Math.abs(row[area]) > 90) return row;
  return [...row.slice(0, area), null, ...row.slice(area)].slice(0, Math.max(head.length, row.length));
}

// Sheet rows → objects keyed by header text. The export has one unnamed column
// right after "Notes" that holds the note text: it becomes "Notes2".
function visitRowsFromSheet(data) {
  const [head = [], ...body] = data;
  const keys = head.map((h, i) => (h === null && head[i - 1] === 'Notes' ? 'Notes2' : h));
  return body
    .filter((r) => r.some((v) => v !== null && v !== ''))
    .map((r) => realignVisitRow(head, r))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]]).filter(([k]) => k !== null)));
}

function parseVisits(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new ImportFormatError('File kunjungan kosong.');
  const missing = REQUIRED.filter((k) => !rows.some((r) => r && k in r));
  if (missing.length) {
    throw new ImportFormatError(`Kolom ${missing.map((m) => `"${m}"`).join(', ')} tidak ditemukan. Unggah export "DailyVisits" dari SimpliDOTS.`);
  }
  const visits = new Map();
  let skipped = 0;
  for (const r of rows) {
    const employee = text(r.EmployeeCode);
    const date = toDate(r.Date);
    const outlet = text(r.CustomerCode);
    const name = text(r.CustomerName);
    if (!employee || !date || !outlet || !name) { skipped += 1; continue; }
    const checkIn = clock(r.CheckInTime);
    const checkOut = clock(r.CheckOutTime);
    const noteText = (v) => (typeof v === 'string' ? text(v) : null);
    const note = noteText(r.Notes) || noteText(r.Notes2);
    const images = String(r.ImageUrls || '').split(/[\s,;]+/).filter((u) => /^https:\/\//.test(u)).slice(0, 10);
    visits.set(`${employee}|${date}|${outlet}`, {
      externalKey: `${employee}|${date}|${outlet}`.slice(0, 160),
      salesPersonName: text(r.EmployeeName)?.slice(0, 120) || null,
      visitDate: date,
      outletCode: outlet.slice(0, 60),
      outletName: name.slice(0, 190),
      address: text(r.CustomerAddress)?.slice(0, 500) || null,
      area: typeof r.Area === 'string' ? text(r.Area)?.slice(0, 120) || null : null,
      latitude: coord(r.CustomerLatitude ?? r.CheckInLatitude, 90),
      longitude: coord(r.CustomerLongitude ?? r.CheckInLongitude, 180),
      checkInAt: checkIn ? `${date} ${checkIn}:00` : null,
      checkOutAt: checkOut ? `${date} ${checkOut}:00` : null,
      // The older layout also has Duration and Checklist the other way round.
      durationMinutes: minutes(r.Duration) ?? minutes(r.Checklist),
      // Pseq is the planned route position; 0 means the stop was not planned.
      isPlanned: num(r.Pseq) > 0,
      isVisited: Boolean(checkIn),
      geoMismatch: truthy(r.Mismatch),
      distanceM: r.DistanceInMeter === null || r.DistanceInMeter === undefined || r.DistanceInMeter === '' ? null : Math.round(num(r.DistanceInMeter)),
      totalSales: Math.round(num(r.TotalSales) * 100) / 100,
      note: note?.slice(0, 500) || null,
      images,
    });
  }
  const warnings = skipped ? [`${skipped} baris tanpa kode sales, tanggal, atau outlet dilewati.`] : [];
  return { visits: [...visits.values()], warnings };
}

// ---------------------------------------------------------------- database

async function inTx(fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

const chunks = (list, size = 300) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// A lead becomes a customer only when exactly one customer of the entity
// carries the same name (case and spacing ignored) — never a fuzzy match.
async function linkLeadsToCustomers(db, entityId) {
  const [r] = await db.query(
    `UPDATE sales_leads l
       JOIN (SELECT LOWER(TRIM(name)) AS k, MIN(id) AS id, COUNT(*) AS n
               FROM sales_customers WHERE entity_id = ? AND deleted_at IS NULL GROUP BY LOWER(TRIM(name))) c
         ON c.k = LOWER(TRIM(l.name)) AND c.n = 1
        SET l.customer_id = c.id
      WHERE l.entity_id = ? AND l.customer_id IS NULL AND l.deleted_at IS NULL`,
    [entityId, entityId],
  );
  await db.query(
    `UPDATE sales_visit_reports v JOIN sales_leads l ON l.id = v.lead_id
        SET v.customer_id = l.customer_id
      WHERE v.entity_id = ? AND l.customer_id IS NOT NULL
        AND (v.customer_id IS NULL OR v.customer_id <> l.customer_id)`,
    [entityId],
  );
  return r.affectedRows || 0;
}

async function applyImport(db, entityId, parsed, { triggeredBy = null } = {}) {
  const [[division]] = await db.query(
    `SELECT id FROM departments WHERE entity_id = ? AND code = '${DEFAULT_DIVISION}' AND deleted_at IS NULL LIMIT 1`,
    [entityId],
  );
  const departmentId = division?.id || null;

  // Leads first: one per outlet code, keeping the latest visit's details.
  const outlets = new Map();
  for (const v of parsed.visits) {
    const seen = outlets.get(v.outletCode);
    if (!seen || v.visitDate >= seen.visitDate) outlets.set(v.outletCode, v);
  }
  for (const part of chunks([...outlets.values()])) {
    await db.query(
      `INSERT INTO sales_leads
         (entity_id, department_id, outlet_code, name, address, area, latitude, longitude, sales_person_name, source, created_by)
       VALUES ? AS v
       ON DUPLICATE KEY UPDATE
         name = v.name, address = COALESCE(v.address, sales_leads.address), area = COALESCE(v.area, sales_leads.area),
         latitude = COALESCE(v.latitude, sales_leads.latitude), longitude = COALESCE(v.longitude, sales_leads.longitude),
         sales_person_name = COALESCE(v.sales_person_name, sales_leads.sales_person_name),
         department_id = COALESCE(sales_leads.department_id, v.department_id)`,
      [part.map((v) => [entityId, departmentId, v.outletCode, v.outletName, v.address, v.area, v.latitude, v.longitude,
        v.salesPersonName, 'simplidots', triggeredBy])],
    );
  }
  const [leadRows] = await db.query(
    'SELECT id, outlet_code FROM sales_leads WHERE entity_id = ? AND outlet_code IN (?)',
    [entityId, [...outlets.keys()]],
  );
  const leadOf = new Map(leadRows.map((r) => [r.outlet_code, r.id]));

  const [[before]] = await db.query(
    'SELECT COUNT(*) AS n FROM sales_visit_reports WHERE entity_id = ? AND external_key IN (?)',
    [entityId, parsed.visits.map((v) => v.externalKey)],
  );
  for (const part of chunks(parsed.visits)) {
    await db.query(
      `INSERT INTO sales_visit_reports
         (entity_id, department_id, lead_id, visit_date, location, latitude, longitude, summary, photos, created_by,
          outlet_code, outlet_name, area, sales_person_name, check_in_at, check_out_at, duration_minutes,
          is_planned, is_visited, geo_mismatch, distance_m, total_sales, source, external_key)
       VALUES ? AS v
       ON DUPLICATE KEY UPDATE
         lead_id = v.lead_id, visit_date = v.visit_date, location = v.location, latitude = v.latitude,
         longitude = v.longitude, summary = v.summary, photos = v.photos, outlet_name = v.outlet_name, area = v.area,
         sales_person_name = v.sales_person_name, check_in_at = v.check_in_at, check_out_at = v.check_out_at,
         duration_minutes = v.duration_minutes, is_planned = v.is_planned, is_visited = v.is_visited,
         geo_mismatch = v.geo_mismatch, distance_m = v.distance_m, total_sales = v.total_sales`,
      [part.map((v) => [
        entityId, departmentId, leadOf.get(v.outletCode), v.visitDate, v.address, v.latitude, v.longitude, v.note,
        v.images.length ? JSON.stringify(v.images) : null, triggeredBy,
        v.outletCode, v.outletName, v.area, v.salesPersonName, v.checkInAt, v.checkOutAt, v.durationMinutes,
        v.isPlanned ? 1 : 0, v.isVisited ? 1 : 0, v.geoMismatch ? 1 : 0, v.distanceM, v.totalSales, 'simplidots', v.externalKey,
      ])],
    );
  }

  // Lead summaries follow all their visits, not just this file's.
  await db.query(
    `UPDATE sales_leads l
       JOIN (SELECT lead_id, MIN(visit_date) AS first_at, MAX(visit_date) AS last_at,
                    SUM(is_visited = 1 OR is_visited IS NULL) AS n
               FROM sales_visit_reports WHERE entity_id = ? AND lead_id IS NOT NULL GROUP BY lead_id) v ON v.lead_id = l.id
        SET l.first_visit_date = v.first_at, l.last_visit_date = v.last_at, l.visit_count = v.n,
            l.last_note = (SELECT LEFT(x.summary, 500) FROM sales_visit_reports x
                            WHERE x.lead_id = l.id AND x.summary IS NOT NULL
                            ORDER BY x.visit_date DESC, x.id DESC LIMIT 1)
      WHERE l.entity_id = ?`,
    [entityId, entityId],
  );
  const leadsLinked = await linkLeadsToCustomers(db, entityId);
  await salesOwners.refreshLinks(db, entityId);

  const existing = Number(before?.n || 0);
  return {
    visits: parsed.visits.length,
    newVisits: parsed.visits.length - existing,
    updatedVisits: existing,
    outlets: outlets.size,
    leadsLinked,
  };
}

async function importVisitFile({ entityId, buffer, fileName = null, triggeredBy = null }) {
  let workbook;
  try {
    workbook = await readXlsxFile(buffer);
  } catch {
    throw new ImportFormatError('File tidak bisa dibaca. Unggah export SimpliDOTS berformat .xlsx atau .xlsm.');
  }
  const sheet = workbook.find((s) => s.data[0]?.includes('EmployeeCode') && s.data[0]?.includes('CustomerCode'));
  if (!sheet) throw new ImportFormatError('Sheet kunjungan (kolom EmployeeCode & CustomerCode) tidak ditemukan di file ini.');
  const rows = visitRowsFromSheet(sheet.data);
  if (rows.length > MAX_ROWS) throw new ImportFormatError(`File kunjungan maksimal ${MAX_ROWS} baris.`);
  const parsed = parseVisits(rows);
  if (!parsed.visits.length) throw new ImportFormatError('Tidak ada baris kunjungan yang valid di file ini.');

  const [run] = await pool.query(
    `INSERT INTO sales_sync_runs (entity_id, source, status, file_name, triggered_by)
     VALUES (?, 'visit_file', 'running', ?, ?)`,
    [entityId, fileName ? String(fileName).slice(0, 255) : null, triggeredBy],
  );
  try {
    const stats = await inTx((db) => applyImport(db, entityId, parsed, { triggeredBy }));
    stats.warnings = parsed.warnings;
    await pool.query(
      "UPDATE sales_sync_runs SET status = 'success', stats = ?, finished_at = NOW() WHERE id = ?",
      [JSON.stringify(stats), run.insertId],
    );
    return { runId: run.insertId, status: 'success', stats, warnings: parsed.warnings };
  } catch (e) {
    await pool.query(
      "UPDATE sales_sync_runs SET status = 'failed', error_message = ?, finished_at = NOW() WHERE id = ?",
      [String(e.message).slice(0, 1000), run.insertId],
    ).catch(() => {});
    throw e;
  }
}

module.exports = {
  parseVisits, visitRowsFromSheet, realignVisitRow, applyImport, importVisitFile, ImportFormatError,
};
