#!/usr/bin/env node
// Laporan rekonsiliasi data lama Langganan software (revisi 3 Oktober 2026).
// READ ONLY: hanya SELECT di dalam transaksi READ ONLY yang selalu di-rollback.
// Tidak ada data yang diubah, tidak ada email atau notifikasi.
//
//   npm run report:subscriptions                    ringkasan + contoh per temuan
//   npm run report:subscriptions -- --entity=1      satu perusahaan saja
//   npm run report:subscriptions -- --json > r.json semua baris sebagai JSON
//   npm run report:subscriptions -- --limit=50      contoh per temuan (bawaan 10)
require('dotenv').config();
const pool = require('../db/pool');
const { runReport } = require('../services/subscriptionReconcile.service');

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
}

(async () => {
  const entityArg = arg('entity');
  const entityId = entityArg && entityArg !== true ? Number(entityArg) : null;
  const limit = Math.max(1, Number(arg('limit')) || 10);
  const conn = await pool.getConnection();
  let report;
  try {
    report = await runReport(conn, { entityId });
  } finally {
    conn.release();
    await pool.end();
  }

  if (arg('json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Laporan rekonsiliasi Langganan software (hanya membaca, tidak mengubah data)');
  console.log(`Database: ${process.env.DB_NAME || '(DB_NAME kosong)'} · ${report.generatedAt}${entityId ? ` · perusahaan ${entityId}` : ''}\n`);
  for (const c of report.checks) {
    console.log(`${c.count ? '!' : '✓'} [${c.rule}] ${c.label}: ${c.count}`);
    if (!c.count) continue;
    console.log(`    Arti: ${c.meaning}`);
    console.log(`    Langkah: ${c.next}`);
    for (const row of c.rows.slice(0, limit)) console.log(`    - ${JSON.stringify(row)}`);
    if (c.rows.length > limit) console.log(`    … dan ${c.rows.length - limit} lagi (pakai --json untuk semuanya)`);
  }
  console.log(`\nTotal temuan: ${report.total}. Tidak ada yang diperbaiki otomatis; setiap temuan diputuskan oleh pengelolanya.`);
})().catch((error) => {
  console.error(`Laporan gagal: ${error.message}`);
  process.exitCode = 1;
});
