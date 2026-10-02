// "Every module has AI data help" (docs/prakasa-ai-rencana.md §9): each page
// tool of aiToolRegistry is in exactly one of three places —
//   covered  an agent tool names the page in its `module` (derived, not listed here);
//   EXEMPT   the page needs no agent data tool, with the reason;
//   PENDING  no agent tool yet: a key leaves by adding a tool file under tools/
//            whose tools name it in `module`, then deleting it from PENDING.
// test/aiAgentCoverage.test.js fails when a page tool is in none of them, in
// two of them, or when a key here is not a page tool. While a key is PENDING
// the page shows only the generic starters (aiToolRegistry startersFor).
//
// This file holds data only at load time (aiToolRegistry requires it); the
// tool list is read lazily inside coverage().

// Kalender left this list on 2 Oktober 2026 (§9.14): acara_kalender_saya reads the user's own
// agenda as the user, exactly as the page does. Mail, chat and files stay unread.
const GOOGLE = 'Halaman Google Workspace: isi dan pencariannya ditangani Google sendiri (Gemini/Workspace); Prakasa AI tidak membaca email, chat, atau file pribadi.';
const ADMIN = 'Halaman konfigurasi admin: Prakasa AI hanya menjelaskan dari Panduan (panduan_aplikasi); tidak ada data operasional untuk dibaca dan tidak ada perubahan konfigurasi lewat AI.';

const EXEMPT = Object.freeze({
  'ai-command': 'Prakasa AI itu sendiri: percakapan pribadi tidak dibaca alat lain.',
  'my-drive': GOOGLE,
  'google-mail': GOOGLE,
  'google-chat': GOOGLE,
  'google-docs': GOOGLE,
  'google-sheets': GOOGLE,
  'google-slides': GOOGLE,
  'google-groups': GOOGLE,
  'google-analytics': GOOGLE,
  'sales-print': 'Tampilan cetak dokumen sales (tanpa panel AI); datanya dilayani modul Data Sales.',
  'signature-asset': 'Gambar tanda tangan pribadi: tidak pernah dibaca AI.',
  letterhead: 'Aset kop dan cap surat: berkas gambar, bukan data untuk dibaca AI.',
  'management-flow': 'Keputusan owner (program 3.3): halaman memuat perkiraan harga beli, margin, dan nilai stok yang tidak pernah dibaca Prakasa AI.',
  'notification-policy': ADMIN,
  users: 'Data akun pengguna (data pribadi dan akses): tidak dibaca AI. Cara pakainya dijawab dari Panduan.',
  'workspace-sync': ADMIN,
  entities: ADMIN,
  departments: ADMIN,
  roles: ADMIN,
  permissions: ADMIN,
  'folder-rules': ADMIN,
  'document-types': ADMIN,
  'signature-rules': ADMIN,
  'approval-matrix': ADMIN,
  'signature-precheck': ADMIN,
  'integration-logs': 'Log teknis integrasi (bisa memuat payload sistem luar): tidak dibaca AI.',
  'activity-logs': 'Jejak audit: tidak dibaca AI, supaya log tidak bisa dirangkum keluar dari halaman audit.',
  'ai-usage': ADMIN,
  'ai-provider-settings': 'Pengaturan penyedia AI dan kredensial: tidak pernah dibaca AI.',
  'accurate-integration': 'Koneksi dan kredensial Accurate: tidak pernah dibaca AI.',
});

// Empty since Wave B (2 Oktober 2026): every page is served by a tool or exempt.
// A new page without a tool yet goes here (with a plan), never silently.
const PENDING = Object.freeze([]);

const PENDING_SET = new Set(PENDING);
const isPending = (key) => PENDING_SET.has(key);

// { covered: { key: [tool names] }, exempt, pending, missing, problems }
// `pending` is only passed by tests (to show what a key left on the list does).
function coverage({ pageTools = null, agentTools = null, pending = PENDING } = {}) {
  /* eslint-disable global-require */
  const pages = pageTools || require('../../aiToolRegistry.service').TOOLS;
  const tools = agentTools || require('./agentTools').TOOLS;
  /* eslint-enable global-require */
  const keys = pages.map((entry) => entry.key);
  const known = new Set(keys);
  const pendingSet = new Set(pending);
  const covered = {};
  for (const tool of tools) {
    for (const key of [].concat(tool.module || [])) {
      if (key === 'general') continue;
      (covered[key] = covered[key] || []).push(tool.name);
    }
  }
  const problems = [];
  for (const key of Object.keys(EXEMPT)) {
    if (!known.has(key)) problems.push(`EXEMPT "${key}" bukan kunci halaman di aiToolRegistry`);
    if (!String(EXEMPT[key] || '').trim()) problems.push(`EXEMPT "${key}" tanpa alasan`);
    if (covered[key]) problems.push(`"${key}" ada di EXEMPT tetapi dilayani alat ${covered[key].join(', ')}`);
    if (pendingSet.has(key)) problems.push(`"${key}" ada di EXEMPT dan PENDING`);
  }
  if (pendingSet.size !== pending.length) problems.push('PENDING memuat kunci ganda');
  for (const key of pending) {
    if (!known.has(key)) problems.push(`PENDING "${key}" bukan kunci halaman di aiToolRegistry`);
    if (covered[key]) problems.push(`"${key}" sudah dilayani alat ${covered[key].join(', ')}: hapus dari PENDING`);
  }
  const missing = keys.filter((key) => !covered[key] && !(key in EXEMPT) && !pendingSet.has(key));
  return { covered, exempt: EXEMPT, pending: [...pending], missing, problems };
}

module.exports = { EXEMPT, PENDING, isPending, coverage };
