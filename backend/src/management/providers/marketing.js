const pool = require('../../db/pool');
const {
  MAX_ITEMS_PER_SOURCE, int, round1, scope, escalationItem,
} = require('../helpers');
const campaigns = require('../../services/marketingCampaigns.service');
const { numbersFromAccurate } = require('../../services/salesSource');

// Marketing (migration 119): the campaign tracker. Campaigns belong to the
// entity's Marketing division (mkt_campaigns.department_id, set by the
// service), so a Marketing Head sees them and other Heads do not; every
// query is scoped on that column.
//
// The "Produk & channel" insights are Sales' own numbers seen by Marketing:
// they already reach management through the Sales provider, so they are not
// reported twice here. Escalation texts carry no rupiah (they are seen by
// every Head); uplift is a percentage.

const TODAY_WIB = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';

// Episodes (id × 100000 + days since 2000-01-01 of the end date): when a
// campaign is extended and later runs past its new end, that is a new open
// escalation, not the old one already marked done.
const EPISODE_FACTOR = 100000;
const episodeId = (id, day) => Number(id) * EPISODE_FACTOR + Number(day);
const rowOfEpisode = (id) => Math.floor(Number(id) / EPISODE_FACTOR);

async function endedOpen(entityId, { departmentId }) {
  const s = scope(departmentId, 'c.department_id');
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.objective, c.department_id, d.name AS department_name, u.name AS owner_name,
            DATE_FORMAT(c.end_on, '%Y-%m-%d') AS end_on, c.end_on AS since,
            DATEDIFF(c.end_on, '2000-01-01') AS end_day,
            DATEDIFF(${TODAY_WIB}, c.end_on) AS days_late
       FROM mkt_campaigns c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.entity_id = ?${s.sql}
        AND c.status = 'berjalan' AND c.end_on < ${TODAY_WIB}
      ORDER BY c.end_on ASC, c.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args],
  );
  return rows.map((r) => escalationItem({
    sourceId: episodeId(r.id, r.end_day),
    title: r.name,
    reference: campaigns.OBJECTIVE_LABELS[r.objective] || null,
    referenceLabel: true,
    context: `Berakhir ${r.end_on}, masih berstatus Berjalan — tutup kampanye dan catat hasilnya`,
    departmentId: r.department_id,
    departmentName: r.department_name,
    ownerName: r.owner_name,
    daysLate: r.days_late,
    since: r.since,
    link: `/marketing/campaigns?open=${r.id}`,
  }));
}

async function locateCampaign(id) {
  const [[row]] = await pool.query('SELECT entity_id, department_id FROM mkt_campaigns WHERE id = ? LIMIT 1', [id]);
  return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
}

// Campaigns that ended in the period (not draft or cancelled), per division.
async function endedInPeriod(entityId, period, departmentId) {
  const s = scope(departmentId, 'c.department_id');
  const [rows] = await pool.query(
    `SELECT c.id, c.department_id, c.status, c.channels, DATE_FORMAT(c.start_on, '%Y-%m-%d') AS start_on,
            DATE_FORMAT(c.end_on, '%Y-%m-%d') AS end_on
       FROM mkt_campaigns c
      WHERE c.entity_id = ?${s.sql}
        AND c.status IN ('berjalan', 'selesai')
        AND c.end_on BETWEEN ? AND ? AND c.end_on < ${TODAY_WIB}
      ORDER BY c.id ASC
      LIMIT 500`,
    [entityId, ...s.args, period.start, period.end],
  );
  return rows;
}

module.exports = {
  key: 'marketing',
  label: 'Marketing',
  navPaths: ['/marketing/insights', '/marketing/campaigns'],

  escalations: [
    {
      key: 'mkt_campaign_ended_open',
      label: 'Kampanye lewat tanggal selesai',
      list: endedOpen,
      locate: (id) => locateCampaign(rowOfEpisode(id)),
    },
  ],

  metrics: [
    {
      key: 'mkt_campaigns_done',
      label: 'Kampanye selesai',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'c.department_id');
        const [rows] = await pool.query(
          `SELECT c.department_id, COUNT(*) AS done
             FROM mkt_campaigns c
            WHERE c.entity_id = ?${s.sql}
              AND c.status = 'selesai' AND c.end_on BETWEEN ? AND ?
            GROUP BY c.department_id`,
          [entityId, ...s.args, period.start, period.end],
        );
        const out = new Map();
        for (const r of rows) if (r.department_id != null) out.set(Number(r.department_id), int(r.done));
        return out;
      },
    },
    {
      // Average uplift of the campaigns that ended in the period: revenue of
      // their target products in their channels against the same number of
      // days right before (marketingCampaigns.service.performance).
      key: 'mkt_campaign_uplift',
      label: 'Rata-rata kenaikan omzet kampanye',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const rows = await endedInPeriod(entityId, period, departmentId);
        if (!rows.length || !(await numbersFromAccurate(entityId))) return new Map();
        const dataThrough = await campaigns.dataThroughOf(pool, entityId);
        const [items] = await pool.query(
          'SELECT campaign_id, item_no FROM mkt_campaign_items WHERE entity_id = ? AND campaign_id IN (?)',
          [entityId, rows.map((r) => r.id)],
        );
        const sums = new Map();
        for (const r of rows) {
          const campaign = {
            startOn: r.start_on,
            endOn: r.end_on,
            channels: campaigns.parseChannels(r.channels),
            items: items.filter((i) => Number(i.campaign_id) === Number(r.id)).map((i) => ({ itemNo: i.item_no })),
          };
          const perf = await campaigns.performance(pool, entityId, campaign, { dataThrough, reliable: true });
          if (perf.state !== 'ok' || perf.upliftPct === null || r.department_id == null) continue;
          const key = Number(r.department_id);
          const acc = sums.get(key) || { total: 0, n: 0 };
          acc.total += perf.upliftPct;
          acc.n += 1;
          sums.set(key, acc);
        }
        // An average over nothing is unknown, not 0%.
        return new Map([...sums].map(([key, acc]) => [key, round1(acc.total / acc.n)]));
      },
    },
  ],

  kpis: [
    {
      key: 'mkt_active_campaigns',
      label: 'Kampanye berjalan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'c.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total, SUM(c.status = 'berjalan') AS running,
                  SUM(c.status = 'berjalan' AND c.end_on < ${TODAY_WIB}) AS ended_open,
                  SUM(c.status = 'draft') AS draft
             FROM mkt_campaigns c
            WHERE c.entity_id = ?${s.sql}`,
          [entityId, ...s.args],
        );
        if (!int(row?.total)) return { value: null, sub: 'Belum ada kampanye', alert: false };
        const late = int(row?.ended_open);
        const sub = late ? `${late} lewat tanggal selesai` : `${int(row?.draft)} draf`;
        return { value: int(row?.running), sub, alert: late > 0 };
      },
    },
  ],
};

module.exports.EPISODE_FACTOR = EPISODE_FACTOR;
