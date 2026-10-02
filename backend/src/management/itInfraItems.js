const pool = require('../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, scope, escalationItem, byDepartment } = require('./helpers');
const { BACKUP_DUE_ON, BACKUP_OVERDUE, BACKUP_FAILING } = require('../services/itRegisters.service');
const {
  ISP_DECISION_DAYS, CCTV_OFFLINE_DAYS, GWS_REVIEW_DAYS, CHECK_DAYS, BACKUP_FREQUENCY_LABELS, CCTV_STATUS_LABELS,
} = require('../config/itInfra');

// IT infrastructure registers in management (docs/rancangan-people-culture-g2.md
// §4.5) — spread into the `it` provider (providers/it.js), which claims
// '/it/infrastructure'. Every register row carries the People & Culture
// division (department_id, set by the service), so each query is scoped by
// that column in SQL; an empty register raises no alarm. Never an IP address,
// a serial number or a cost: the management views are seen by every Head.
//
// Episodes (id × 100000 + days since 2000-01-01): a renewed ISP contract, a
// backup that fails again after a good check, or a CCTV that goes offline
// again is a new open escalation, not the old one marked done.

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const EPISODE_FACTOR = 100000;
const episodeId = (id, day) => Number(id) * EPISODE_FACTOR + Number(day);
const rowOfEpisode = (id) => Math.floor(Number(id) / EPISODE_FACTOR);
const infraLink = (tab, id) => `/it/infrastructure?tab=${tab}&open=${id}`;

const located = (row) => (row
  ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
  : null);

async function locateIn(table, id) {
  const [[row]] = await pool.query(`SELECT entity_id, department_id FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  return located(row);
}

// ---------------------------------------------------------------- ISP
// Time to renew or switch: the escalation opens ISP_DECISION_DAYS before the end.
const ISP_DECISION_DAY = `(l.contract_end - INTERVAL ${ISP_DECISION_DAYS} DAY)`;
const ISP_ENDING = `l.status = 'active' AND l.contract_end IS NOT NULL AND ${TODAY} > ${ISP_DECISION_DAY}`;

// ---------------------------------------------------------------- backup
// Anchored on the failing check (last_checked_on) when the last result failed,
// otherwise on the day the next check was due.
const BACKUP_ANCHOR = `(CASE WHEN ${BACKUP_FAILING('b')} THEN b.last_checked_on ELSE ${BACKUP_DUE_ON('b')} END)`;
const BACKUP_LATE = `(${BACKUP_FAILING('b')} OR ${BACKUP_OVERDUE('b')})`;

// ---------------------------------------------------------------- CCTV
const CCTV_SINCE = 'DATE(c.status_changed_at + INTERVAL 7 HOUR)';
const CCTV_LATE = `c.status IN ('offline', 'partial') AND ${CCTV_SINCE} < ${TODAY} - INTERVAL ${CCTV_OFFLINE_DAYS} DAY`;

// ---------------------------------------------------------------- Google Workspace
// The latest review of the entity (a newer review closes the old one).
const GWS_LATEST = `NOT EXISTS (SELECT 1 FROM it_gws_reviews g2
   WHERE g2.entity_id = g.entity_id
     AND (g2.reviewed_on > g.reviewed_on OR (g2.reviewed_on = g.reviewed_on AND g2.id > g.id)))`;
const GWS_OVERDUE = `g.reviewed_on < ${TODAY} - INTERVAL ${GWS_REVIEW_DAYS} DAY`;

const escalations = [
  {
    key: 'it_isp_contract_ending',
    label: 'Kontrak ISP segera berakhir',
    async list(entityId, { departmentId }) {
      const s = scope(departmentId, 'l.department_id');
      const [rows] = await pool.query(
        `SELECT l.id, l.provider_name, l.is_backup, l.department_id, dep.name AS department_name, loc.name AS location_name,
                DATE_FORMAT(l.contract_end, '%Y-%m-%d') AS contract_end,
                ${ISP_DECISION_DAY} AS since,
                DATEDIFF(l.contract_end, '2000-01-01') AS end_day,
                DATEDIFF(${TODAY}, ${ISP_DECISION_DAY}) AS days_late
           FROM it_isp_links l
           LEFT JOIN departments dep ON dep.id = l.department_id
           LEFT JOIN org_locations loc ON loc.entity_id = l.entity_id AND loc.id = l.location_id
          WHERE l.entity_id = ?${s.sql}
            AND ${ISP_ENDING}
          ORDER BY l.contract_end ASC, l.id ASC
          LIMIT ${MAX_ITEMS_PER_SOURCE}`,
        [entityId, ...s.args],
      );
      return rows.map((row) => escalationItem({
        sourceId: episodeId(row.id, row.end_day),
        title: `${row.provider_name}${row.is_backup ? ' (cadangan)' : ''}`,
        reference: row.location_name || null,
        context: `Kontrak berakhir ${row.contract_end} — putuskan perpanjang atau ganti provider`,
        departmentId: row.department_id,
        departmentName: row.department_name,
        daysLate: row.days_late,
        since: row.since,
        link: infraLink('isp', row.id),
      }));
    },
    locate: (id) => locateIn('it_isp_links', rowOfEpisode(id)),
  },
  {
    key: 'it_backup_unverified',
    label: 'Backup gagal atau tidak diperiksa',
    async list(entityId, { departmentId }) {
      const s = scope(departmentId, 'b.department_id');
      const [rows] = await pool.query(
        `SELECT b.id, b.data_scope, b.frequency, b.last_result, b.department_id, dep.name AS department_name,
                ${BACKUP_FAILING('b')} AS failing,
                ${BACKUP_ANCHOR} AS since,
                DATEDIFF(${BACKUP_ANCHOR}, '2000-01-01') AS since_day,
                DATEDIFF(${TODAY}, ${BACKUP_ANCHOR}) AS days_late
           FROM it_backup_jobs b
           LEFT JOIN departments dep ON dep.id = b.department_id
          WHERE b.entity_id = ?${s.sql}
            AND ${BACKUP_LATE}
          ORDER BY days_late DESC, b.id ASC
          LIMIT ${MAX_ITEMS_PER_SOURCE}`,
        [entityId, ...s.args],
      );
      return rows.map((row) => escalationItem({
        sourceId: episodeId(row.id, row.since_day),
        title: row.data_scope,
        reference: BACKUP_FREQUENCY_LABELS[row.frequency] || null,
        context: Number(row.failing) === 1
          ? 'Pemeriksaan terakhir gagal — perbaiki lalu catat pemeriksaan baru'
          : `Belum diperiksa sesuai jadwal (${BACKUP_FREQUENCY_LABELS[row.frequency] || row.frequency}, maks. ${CHECK_DAYS[row.frequency] || CHECK_DAYS.other} hari)`,
        departmentId: row.department_id,
        departmentName: row.department_name,
        daysLate: row.days_late,
        since: row.since,
        link: infraLink('backup', row.id),
      }));
    },
    locate: (id) => locateIn('it_backup_jobs', rowOfEpisode(id)),
  },
  {
    key: 'it_cctv_offline',
    label: 'CCTV offline',
    async list(entityId, { departmentId }) {
      const s = scope(departmentId, 'c.department_id');
      const [rows] = await pool.query(
        `SELECT c.id, c.status, c.camera_count, c.cameras_offline, c.department_id, dep.name AS department_name,
                loc.name AS location_name,
                c.status_changed_at AS since,
                DATEDIFF(${CCTV_SINCE}, '2000-01-01') AS since_day,
                DATEDIFF(${TODAY}, ${CCTV_SINCE}) - ${CCTV_OFFLINE_DAYS} AS days_late
           FROM it_cctv_systems c
           LEFT JOIN departments dep ON dep.id = c.department_id
           LEFT JOIN org_locations loc ON loc.entity_id = c.entity_id AND loc.id = c.location_id
          WHERE c.entity_id = ?${s.sql}
            AND ${CCTV_LATE}
          ORDER BY days_late DESC, c.id ASC
          LIMIT ${MAX_ITEMS_PER_SOURCE}`,
        [entityId, ...s.args],
      );
      return rows.map((row) => escalationItem({
        sourceId: episodeId(row.id, row.since_day),
        title: `CCTV ${row.location_name || ''}`.trim(),
        reference: CCTV_STATUS_LABELS[row.status] || row.status,
        context: `${int(row.cameras_offline)} dari ${int(row.camera_count)} kamera offline lebih dari ${CCTV_OFFLINE_DAYS} hari`,
        departmentId: row.department_id,
        departmentName: row.department_name,
        daysLate: row.days_late,
        since: row.since,
        link: infraLink('cctv', row.id),
      }));
    },
    locate: (id) => locateIn('it_cctv_systems', rowOfEpisode(id)),
  },
  {
    key: 'it_gws_review_overdue',
    label: 'Review keamanan Google Workspace terlambat',
    async list(entityId, { departmentId }) {
      const s = scope(departmentId, 'g.department_id');
      const [rows] = await pool.query(
        `SELECT g.id, DATE_FORMAT(g.reviewed_on, '%Y-%m-%d') AS reviewed_on, g.department_id, dep.name AS department_name,
                g.reviewed_on + INTERVAL ${GWS_REVIEW_DAYS} DAY AS since,
                DATEDIFF(${TODAY}, g.reviewed_on) - ${GWS_REVIEW_DAYS} AS days_late
           FROM it_gws_reviews g
           LEFT JOIN departments dep ON dep.id = g.department_id
          WHERE g.entity_id = ?${s.sql}
            AND ${GWS_LATEST}
            AND ${GWS_OVERDUE}
          LIMIT ${MAX_ITEMS_PER_SOURCE}`,
        [entityId, ...s.args],
      );
      return rows.map((row) => escalationItem({
        sourceId: row.id,
        title: 'Review keamanan Google Workspace',
        reference: `Terakhir ${row.reviewed_on}`,
        context: `Review berkala tiap ${GWS_REVIEW_DAYS} hari — catat review baru`,
        departmentId: row.department_id,
        departmentName: row.department_name,
        daysLate: row.days_late,
        since: row.since,
        link: '/it/infrastructure?tab=gws',
      }));
    },
    locate: (id) => locateIn('it_gws_reviews', id),
  },
];

const metrics = [
  {
    key: 'it_backup_checks',
    label: 'Pemeriksaan backup dicatat',
    unit: 'item',
    better: 'higher',
    cumulative: true,
    emptyIsZero: true,
    async actuals(entityId, period, { departmentId }) {
      const s = scope(departmentId, 'b.department_id');
      const [rows] = await pool.query(
        `SELECT b.department_id, COUNT(*) AS checks
           FROM it_backup_checks k
           JOIN it_backup_jobs b ON b.entity_id = k.entity_id AND b.id = k.backup_job_id
          WHERE k.entity_id = ?${s.sql}
            AND k.checked_on BETWEEN ? AND ?
          GROUP BY b.department_id`,
        [entityId, ...s.args, period.start, period.end],
      );
      return byDepartment(rows, (r) => int(r.checks));
    },
  },
];

const kpis = [
  {
    key: 'it_cctv_cameras',
    label: 'Kamera CCTV',
    unit: 'item',
    async value(entityId, { departmentId }) {
      const s = scope(departmentId, 'c.department_id');
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN c.status <> 'retired' THEN c.camera_count ELSE 0 END) AS cameras,
                SUM(c.status IN ('offline', 'partial')) AS not_online
           FROM it_cctv_systems c
          WHERE c.entity_id = ?${s.sql}`,
        [entityId, ...s.args],
      );
      if (!int(row?.total)) return { value: 0, sub: 'Belum ada CCTV tercatat', alert: false };
      const notOnline = int(row?.not_online);
      return { value: int(row?.cameras), sub: notOnline ? `${notOnline} sistem offline/sebagian` : 'Semua sistem online', alert: notOnline > 0 };
    },
  },
  {
    key: 'it_bandwidth_mbps',
    label: 'Bandwidth internet utama (Mbps)',
    unit: 'Mbps',
    async value(entityId, { departmentId }) {
      const s = scope(departmentId, 'l.department_id');
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN l.status = 'active' AND l.is_backup = 0 THEN COALESCE(l.bandwidth_mbps, 0) ELSE 0 END) AS mbps,
                COUNT(DISTINCT CASE WHEN l.status = 'active' AND l.is_backup = 0 AND NOT EXISTS (
                  SELECT 1 FROM it_isp_links bk WHERE bk.entity_id = l.entity_id AND bk.location_id = l.location_id
                     AND bk.status = 'active' AND bk.is_backup = 1) THEN l.location_id END) AS without_backup
           FROM it_isp_links l
          WHERE l.entity_id = ?${s.sql}`,
        [entityId, ...s.args],
      );
      if (!int(row?.total)) return { value: 0, sub: 'Belum ada ISP tercatat', alert: false };
      const without = int(row?.without_backup);
      return { value: int(row?.mbps), sub: without ? `${without} lokasi tanpa ISP cadangan` : 'Semua lokasi punya ISP cadangan', alert: false };
    },
  },
  {
    key: 'it_backup_health',
    label: 'Backup sehat',
    unit: 'item',
    async value(entityId, { departmentId }) {
      const s = scope(departmentId, 'b.department_id');
      const [[row]] = await pool.query(
        `SELECT SUM(b.status = 'active') AS active,
                SUM(b.status = 'active' AND b.last_result = 'ok' AND NOT ${BACKUP_OVERDUE('b')}) AS healthy,
                SUM(${BACKUP_LATE}) AS late
           FROM it_backup_jobs b
          WHERE b.entity_id = ?${s.sql}`,
        [entityId, ...s.args],
      );
      const active = int(row?.active);
      if (!active) return { value: 0, sub: 'Belum ada backup aktif tercatat', alert: false };
      const late = int(row?.late);
      return { value: int(row?.healthy), sub: `dari ${active}${late ? ` · ${late} gagal/terlambat diperiksa` : ''}`, alert: late > 0 };
    },
  },
  {
    key: 'it_gws_risk_flags',
    label: 'Risiko keamanan Google Workspace',
    unit: 'item',
    async value(entityId, { departmentId }) {
      const s = scope(departmentId, 'g.department_id');
      const [[row]] = await pool.query(
        `SELECT DATE_FORMAT(g.reviewed_on, '%Y-%m-%d') AS reviewed_on,
                (g.mfa_enforced = 0) + (g.external_sharing_restricted = 0) + (g.shared_accounts_used = 1)
                  + (g.ex_users_active > 0) + (${GWS_OVERDUE}) AS flags
           FROM it_gws_reviews g
          WHERE g.entity_id = ?${s.sql}
          ORDER BY g.reviewed_on DESC, g.id DESC
          LIMIT 1`,
        [entityId, ...s.args],
      );
      if (!row) return { value: null, sub: 'Belum ada review', alert: false };
      const flags = int(row.flags);
      return { value: flags, sub: `Review terakhir ${row.reviewed_on}`, alert: flags > 0 };
    },
  },
  {
    key: 'it_phone_lines_active',
    label: 'Nomor perusahaan aktif',
    unit: 'item',
    async value(entityId, { departmentId }) {
      const s = scope(departmentId, 'p.department_id');
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total, SUM(p.status = 'active') AS active, SUM(p.status = 'spare') AS spare
           FROM it_phone_lines p
          WHERE p.entity_id = ?${s.sql}`,
        [entityId, ...s.args],
      );
      if (!int(row?.total)) return { value: 0, sub: 'Belum ada nomor tercatat', alert: false };
      return { value: int(row?.active), sub: `${int(row?.spare)} cadangan`, alert: false };
    },
  },
];

module.exports = {
  escalations, metrics, kpis, EPISODE_FACTOR,
  ISP_DECISION_DAYS, CHECK_DAYS, CCTV_OFFLINE_DAYS, GWS_REVIEW_DAYS,
  EPISODE_SOURCES: Object.freeze(['it_isp_contract_ending', 'it_backup_unverified', 'it_cctv_offline']),
};
