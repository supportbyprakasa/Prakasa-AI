import { safeInAppPath } from './safeHref.js';

// The side menu, grouped by the kind of work (docs/ui-guideline.md §2.2):
// a few everyday entries on top, then expandable groups. Every item carries the
// permission its page needs, so a role only ever sees what it can open; a group
// left with one item for a role shows as a plain entry.
//
// Order is priority of use: the everyday entries, then oversight (only Heads
// and management have it), daily tools, communication, documents, the
// division modules, reports, and administration last. On top of that each
// role gets its own division's work right under the everyday entries — see
// ROLE_FOCUS below.
const NAV = [
  {
    items: [
      { to: '/', label: 'Dashboard', symbol: 'dashboard', end: true },
      { to: '/notifications', label: 'Notifikasi', symbol: 'notifications', showUnreadBadge: true, permission: 'notification.view' },
      { to: '/ai-command', label: 'Prakasa AI', symbol: 'auto_awesome', permission: 'ai_command.session.view' },
    ],
  },
  {
    title: 'Manajemen',
    items: [
      // Each division's own dashboard (migration 116): Supervisor/Head; management picks any division.
      { to: '/division-dashboard', label: 'Dashboard divisi', symbol: 'insights', permission: ['division_dashboard.view', 'management_dashboard.view'] },
      { to: '/management', label: 'Dashboard manajemen', symbol: 'monitoring', permission: ['management_dashboard.view', 'management_dashboard.division'] },
      { to: '/escalations', label: 'Pusat eskalasi', symbol: 'e911_emergency', permission: ['management_dashboard.view', 'management_dashboard.division'] },
      { to: '/targets', label: 'Target & realisasi', symbol: 'track_changes', permission: ['management_dashboard.view', 'management_dashboard.division'] },
      { to: '/roadmap', label: 'Peta program', symbol: 'view_timeline', permission: ['management_dashboard.view', 'management_dashboard.division'] },
      // Program 3.3: management only (division Heads with management_dashboard.division do not get it).
      { to: '/management/flow', label: 'Alur & margin', symbol: 'account_tree', permission: 'management_dashboard.view' },
    ],
  },
  {
    title: 'Kerja harian',
    items: [
      { to: '/projects', label: 'Project Tracker', symbol: 'view_kanban', permission: 'google.chat.use' },
      { to: '/calendar', label: 'Kalender', symbol: 'calendar_month', permission: 'meeting.view' },
      { to: '/it/tickets', label: 'Tiket IT', symbol: 'support', permission: 'it_ticket.view' },
      // People & Culture 2.2: every role requests GA services and books rooms/vehicles.
      { to: '/ga', label: 'Layanan GA', symbol: 'room_service', permission: 'ga.request.create' },
      // People & Culture 1.1: every role reads the entity's directory (work contacts).
      { to: '/people/directory', label: 'Direktori', symbol: 'badge', permission: 'people.directory.view' },
      // Every division raises payment requests and reimbursements to Finance.
      { to: '/finance/payment-requests', label: 'Pengajuan pembayaran', symbol: 'request_quote', permission: ['finance.request', 'finance.view'] },
    ],
  },
  {
    title: 'Komunikasi',
    items: [
      { to: '/mail', label: 'Gmail', symbol: 'mail', permission: 'google.mail.use' },
      { to: '/chat', label: 'Google Chat', symbol: 'chat', permission: 'google.chat.use' },
      { to: '/groups', label: 'Groups', symbol: 'group', permission: 'google.groups.view' },
    ],
  },
  {
    title: 'Dokumen',
    items: [
      { to: '/division-storage', label: 'Penyimpanan divisi', symbol: 'folder_open', permission: 'document.view' },
      { to: '/my-drive', label: 'My Drive', symbol: 'hard_drive', permission: 'mydrive.view' },
      // Templates with the division kop; documents land in the division's Shared Drive (migration 115).
      { to: '/doc-templates', label: 'Template dokumen', symbol: 'contract', permission: 'template.view' },
      { to: '/docs', label: 'Docs', symbol: 'description', permission: 'google.docs.use' },
      { to: '/sheets', label: 'Sheets', symbol: 'table_chart', permission: 'google.docs.use' },
      { to: '/slides', label: 'Slides', symbol: 'slideshow', permission: 'google.docs.use' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/sales/pipeline', label: 'Pipeline sales', symbol: 'view_kanban', permission: 'sales.pipeline.view', badge: 'salesActions' },
      { to: '/sales/customers', label: 'Pelanggan', symbol: 'storefront', permission: 'sales.customer.view' },
      { to: '/sales/leads', label: 'Leads', symbol: 'location_on', permission: 'sales.customer.view' },
      { to: '/sales/orders', label: 'Data Sales', symbol: 'receipt_long', permission: 'sales.order.view' },
    ],
  },
  {
    // Finance (owner, 1 Oct 2026): receivables from Accurate, payables from the
    // Finance pull (read-only, approved per batch) — migration 117.
    title: 'Finance',
    items: [
      { to: '/finance/receivables', label: 'Piutang', symbol: 'account_balance_wallet', permission: 'finance.receivable.view' },
      { to: '/finance/payables', label: 'Utang', symbol: 'receipt_long', permission: 'finance.payable.view' },
    ],
  },
  {
    // Marketing (owner, 1 Oct 2026; migration 119).
    title: 'Marketing',
    items: [
      { to: '/marketing/insights', label: 'Produk & channel', symbol: 'insights', permission: 'marketing.insight.view' },
      { to: '/marketing/campaigns', label: 'Kampanye', symbol: 'campaign', permission: 'marketing.insight.view' },
    ],
  },
  // One titled group per division, like Sales/Finance/Marketing (owner, 3 Oct 2026),
  // even when the division has a single page with tabs inside.
  {
    title: 'Warehouse',
    items: [
      // Movements, or stock from Accurate only (Management Office oversight).
      { to: '/warehouse', label: 'Warehouse', symbol: 'warehouse', permission: ['warehouse.movement.view', 'warehouse.stock.view'] },
    ],
  },
  {
    title: 'Procurement',
    items: [
      { to: '/procurement', label: 'Procurement', symbol: 'assignment_turned_in', permission: 'procurement.view' },
    ],
  },
  {
    title: 'Retail Commerce',
    items: [
      // Marketplace performance (migration 120).
      { to: '/retail-commerce', label: 'Retail Commerce', symbol: 'storefront', permission: 'retail.insight.view' },
    ],
  },
  {
    title: 'People & Culture',
    items: [
      { to: '/hrga/onboarding', label: 'Onboarding', symbol: 'person_add', permission: 'hrga.view' },
      { to: '/hrga/offboarding', label: 'Offboarding', symbol: 'person_remove', permission: 'hrga.view' },
      // Office operations run by GA (owner, 1 Oct 2026; migration 114).
      { to: '/ga/operations', label: 'Operasional GA', symbol: 'home_repair_service', permission: 'ga.ops.view' },
      { to: '/hrga/checklist-templates', label: 'Template checklist', symbol: 'checklist', permission: 'hrga.checklist_template.manage' },
    ],
  },
  {
    title: 'IT',
    items: [
      { to: '/it/dashboard', label: 'Dashboard IT', symbol: 'space_dashboard', permission: 'it.dashboard.view' },
      { to: '/it/devices', label: 'Perangkat', symbol: 'devices', permission: 'device.view' },
      { to: '/it/infrastructure', label: 'Infrastruktur IT', symbol: 'lan', permission: 'it.infra.view' },
      { to: '/it/subscriptions', label: 'Langganan software', symbol: 'apps', permission: 'subscription.view' },
    ],
  },
  {
    title: 'Laporan',
    items: [
      { to: '/analytics', label: 'Google Analytics', symbol: 'bar_chart', permission: 'analytics.view' },
      { to: '/activity-logs', label: 'Log aktivitas', symbol: 'history', permission: 'activity_log.view' },
    ],
  },
  {
    title: 'Pengguna & akses',
    items: [
      { to: '/admin/users', label: 'Pengguna', symbol: 'group', permission: 'user.manage' },
      { to: '/admin/workspace-sync', label: 'Sinkronisasi Workspace', symbol: 'cloud_download', permission: 'user.manage' },
      { to: '/admin/roles', label: 'Peran', symbol: 'shield', permission: 'role.manage' },
      { to: '/admin/permissions', label: 'Izin akses', symbol: 'key', permission: 'permission.manage' },
      { to: '/admin/departments', label: 'Divisi', symbol: 'layers', permission: 'department.manage' },
      { to: '/admin/entities', label: 'Entitas', symbol: 'domain', permission: 'entity.manage' },
    ],
  },
  {
    title: 'Aturan & dokumen',
    items: [
      { to: '/admin/approval-matrix', label: 'Matriks approval', symbol: 'grid_view', permission: 'approval_matrix.view' },
      { to: '/admin/signature-rules', label: 'Aturan tanda tangan', symbol: 'draw', permission: 'signature_rule.view' },
      { to: '/admin/signature-precheck', label: 'Cek awal tanda tangan', symbol: 'verified_user', permission: 'signature_precheck.view' },
      { to: '/admin/document-types', label: 'Jenis dokumen', symbol: 'dashboard_customize', permission: 'document_type.manage' },
      { to: '/admin/folder-rules', label: 'Aturan folder', symbol: 'rule_folder', permission: 'folder_rule.manage' },
    ],
  },
  {
    title: 'Sistem & integrasi',
    items: [
      { to: '/admin/accurate', label: 'Integrasi Accurate', symbol: 'power', permission: 'integration.accurate.manage' },
      { to: '/admin/ai-provider-settings', label: 'Pengaturan penyedia AI', symbol: 'tune', permission: 'ai.provider.manage' },
      { to: '/admin/ai-usage', label: 'Pemakaian AI', symbol: 'data_usage', permission: 'ai_command.usage.view' },
      { to: '/admin/integration-logs', label: 'Log integrasi', symbol: 'receipt', permission: 'integration_log.view' },
      // Which notifications show in the app and which also email (config/notificationPolicy.js).
      { to: '/admin/notification-policy', label: 'Notifikasi & email', symbol: 'notifications_active', permission: 'notification.manage_rule' },
    ],
  },
  {
    // Panduan: the handbook, cut to the user's role (pages/handbook).
    title: 'Bantuan',
    items: [
      { to: '/panduan', label: 'Panduan', symbol: 'menu_book' },
    ],
  },
];

// A string needs that permission; an array needs any one of them.
export function hasNavPermission(permissions, required) {
  if (!required) return true;
  const granted = new Set(permissions || []);
  return Array.isArray(required) ? required.some((code) => granted.has(code)) : granted.has(required);
}

// What each division works in most, in the order they reach for it (role key
// prefix → [section title, ...paths]). These entries move up, right under the
// everyday entries; everything else keeps the order above. Management Office's work is the
// oversight toolkit; People & Culture runs onboarding/offboarding, GA and IT.
const ROLE_FOCUS = {
  sales: [['Sales', '/division-dashboard', '/sales/pipeline', '/sales/customers', '/sales/leads', '/sales/orders']],
  warehouse: [['Warehouse', '/division-dashboard', '/warehouse']],
  procurement: [['Procurement', '/division-dashboard', '/procurement']],
  people_culture: [
    ['People & Culture', '/division-dashboard', '/hrga/onboarding', '/hrga/offboarding', '/ga', '/ga/operations', '/hrga/checklist-templates'],
    ['IT', '/it/tickets', '/it/dashboard', '/it/devices', '/it/infrastructure', '/it/subscriptions'],
  ],
  management_office: [
    ['Manajemen', '/management', '/division-dashboard', '/escalations', '/targets', '/roadmap', '/management/flow'],
    ['Laporan', '/analytics', '/activity-logs'],
  ],
  retail_commerce: [['Retail Commerce', '/division-dashboard', '/retail-commerce'], ['Sales', '/sales/customers', '/sales/leads', '/sales/orders', '/sales/pipeline'], ['Warehouse', '/warehouse']],
  marketing: [['Marketing', '/division-dashboard', '/marketing/insights', '/marketing/campaigns'], ['Sales', '/sales/customers', '/sales/leads']],
  // Finance: receivables, payables and payment requests (live modules).
  finance: [['Finance', '/division-dashboard', '/finance/receivables', '/finance/payables', '/finance/payment-requests']],
  // Administrator Sistem (role key system.admin, matched whole): no division,
  // its work is the administration groups.
  'system.admin': [
    ['Pengguna & akses', '/admin/users', '/admin/workspace-sync', '/admin/roles', '/admin/permissions', '/admin/departments', '/admin/entities'],
    ['Aturan & dokumen', '/admin/approval-matrix', '/admin/signature-rules', '/admin/document-types', '/admin/folder-rules'],
    // Accurate and AI provider settings are Super Admin only (migration 123).
    ['Sistem & integrasi', '/admin/integration-logs', '/admin/notification-policy'],
  ],
};
const LEVEL_RANK = { head: 0, supervisor: 1, member: 2 };

// The user's divisions, most senior role first (a Head's division leads).
export function focusDivisions(roles) {
  return [...(roles || [])]
    .map((role, index) => {
      const key = String(role?.roleKey || '');
      const [prefix, level] = key.split('.');
      return { division: ROLE_FOCUS[key] ? key : prefix, rank: LEVEL_RANK[level] ?? 3, index };
    })
    .filter((entry) => ROLE_FOCUS[entry.division])
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.division)
    .filter((division, index, list) => list.indexOf(division) === index);
}

// roles: the signed-in user's roles ({ roleKey }); without them the menu keeps
// the plain priority order (the home page and route checks need no roles).
export function buildNavSections(permissions, roles = []) {
  const sections = NAV
    .map((section) => ({ ...section, items: section.items.filter((item) => hasNavPermission(permissions, item.permission)) }))
    .filter((section) => section.items.length > 0);
  const visible = new Map(sections.flatMap((section) => section.items).map((item) => [item.to, item]));
  const taken = new Set();
  const focus = [];
  for (const division of focusDivisions(roles)) {
    for (const [title, ...paths] of ROLE_FOCUS[division]) {
      const items = paths.filter((path) => visible.has(path) && !taken.has(path)).map((path) => visible.get(path));
      if (!items.length) continue;
      items.forEach((item) => taken.add(item.to));
      const same = focus.find((section) => section.title === title);
      if (same) same.items.push(...items);
      else focus.push({ title, focus: true, items });
    }
  }
  if (!focus.length) return sections;
  const rest = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !taken.has(item.to)) }))
    .filter((section) => section.items.length > 0);
  // The untitled everyday entries stay first.
  return rest[0] && !rest[0].title ? [rest[0], ...focus, ...rest.slice(1)] : [...focus, ...rest];
}

// Detail/action routes that don't have their own NAV entry inherit their parent
// feature's permission here, by the same longest-prefix match below. Kept as
// plain tuples (not { to, permission } object literals) so tooling that scans
// navigation.js for real sidebar entries doesn't mistake these for one.
const EXTRA_ROUTE_PERMISSIONS = [
  // Global search opens from the top bar's search box, not from the menu.
  ['/search', 'search.global'],
  // Onboarding/offboarding detail: open to every signed-in user — a manager in
  // another division opens their checklist task here without hrga.view; the
  // server decides who may read it (404 otherwise, limited view for non-P&C).
  ['/hrga/workflows', null],
  // The movement form and detail need the movement permission, not stock view.
  ['/warehouse/movements', 'warehouse.movement.view'],
  // Signatures/Tanda Tangan Saya/Cap Surat are reached only as document-assist
  // tools from inside a document's preview modal, never as their own menu
  // card — but they still need a permission to gate direct navigation.
  ['/signatures', 'signature.view'],
  ['/signatures/asset', 'signature.manage_asset'],
  ['/signatures/letterhead', 'letterhead.view'],
  // Task Board has no menu card of its own anymore — it's reached through its
  // board's Google Chat Space instead — but the route itself still works.
  ['/tasks', 'task.view'],
  // Accurate batches of the user's own division; opened from each division's
  // module (e.g. Data Sales → Data Accurate) and from approval notifications.
  ['/data-accurate', ['accurate.batch.view', 'sales.master.manage']],
].map(([to, permission]) => ({ to, permission }));

// Retired from the app entirely: no menu card, and no direct access either —
// even a stale notification link (e.g. an old approval-decision notification)
// gets redirected home instead of opening the page. Their underlying data
// still exists and is still used elsewhere (signature requests reference
// approval_requests, the AI can still create `documents` rows), only this
// dedicated page is gone.
export const BLOCKED_ROUTES = [
  '/approvals', '/admin/approval-delegations',
  '/documents', '/templates',
  // Operations is not a division (owner, 1 Oct 2026): GA runs it in Layanan GA.
  '/coming-soon/operations',
];

// A feature that's hidden from the menu must also refuse to render if a role
// reaches its URL directly (bookmark, shared link, typed by hand) — otherwise
// "not in the menu" quietly becomes "reachable anyway", which defeats the point.
export function hasRouteAccess(pathname, permissions) {
  if (BLOCKED_ROUTES.some((to) => pathname === to || pathname.startsWith(`${to}/`))) return false;
  const candidates = [...NAV.flatMap((section) => section.items), ...EXTRA_ROUTE_PERMISSIONS];
  const match = candidates
    .filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return !match || hasNavPermission(permissions, match.permission);
}

// A link shown only when the user may open its page, by the same rule: any
// other page sends the user home (the Management Office has no Data Sales,
// sales.order.view). Null → show the text without a link. In-app paths only.
export function allowedLink(to, permissions) {
  const link = safeInAppPath(to);
  if (!link) return null;
  return hasRouteAccess(link.split(/[?#]/)[0], permissions) ? link : null;
}

// The home page's blocks (Dashboard.jsx maps over this array as-is): AI banner
// first, then every named division, then the cross-cutting groups, admin last.
// A block lists its modules by path, so it does not depend on how the side
// menu groups them.
export const divisions = [
  { slug: 'ai', title: 'Prakasa AI', symbol: 'auto_awesome', paths: ['/ai-command'],
    summary: 'Tanya, ringkas, dan susun draft bersama Prakasa AI.' },
  { slug: 'sales', title: 'Sales & Pelanggan', symbol: 'handshake', paths: ['/sales/pipeline', '/sales/customers', '/sales/leads', '/sales/orders'],
    summary: 'Pipeline, pelanggan dan leads, kunjungan lapangan, dan Data Sales.' },
  { slug: 'warehouse', title: 'Warehouse', symbol: 'warehouse', paths: ['/warehouse'],
    summary: 'Barang masuk dan keluar, approval Supervisor, serta operasional gudang.' },
  { slug: 'finance', title: 'Finance', symbol: 'account_balance_wallet', paths: ['/finance/receivables', '/finance/payables'],
    summary: 'Piutang dan utang dari Accurate: umur, jatuh tempo, penagihan, dan pembayaran.' },
  { slug: 'people', title: 'People & Culture', symbol: 'person_add', paths: ['/hrga/onboarding', '/hrga/offboarding', '/ga/operations', '/hrga/checklist-templates', '/it/dashboard', '/it/devices', '/it/subscriptions', '/it/infrastructure'],
    summary: 'Onboarding, offboarding, GA (operasional kantor), dan IT perusahaan.' },
  { slug: 'procurement', title: 'Procurement', symbol: 'assignment_turned_in', paths: ['/procurement'],
    summary: 'PO, barang datang, dan pemasok dari Accurate.' },
  { slug: 'retail-commerce', title: 'Retail Commerce', symbol: 'shopping_bag', paths: ['/retail-commerce'],
    summary: 'Kinerja marketplace: omzet, pesanan, retur, piutang, dan SO belum dikirim.' },
  { slug: 'marketing', title: 'Marketing', symbol: 'campaign', paths: ['/marketing/insights', '/marketing/campaigns'],
    summary: 'Kinerja produk & channel, kampanye dan hasilnya, serta leads per area.' },
  { slug: 'google', title: 'Google Workspace', symbol: 'mail', paths: ['/mail', '/chat', '/projects', '/calendar', '/docs', '/sheets', '/slides', '/groups'],
    summary: 'Gmail, Google Chat, Calendar, Docs, Sheets, Slides, dan Groups — langsung di dalam Prakasa Workspace.' },
  { slug: 'kerja', title: 'Kerja Harian', symbol: 'description', paths: ['/division-storage', '/my-drive', '/doc-templates', '/it/tickets', '/people/directory', '/ga', '/finance/payment-requests'],
    summary: 'Penyimpanan divisi, My Drive, dan tiket IT.' },
  { slug: 'insight', title: 'Insight & Manajemen', symbol: 'show_chart', paths: ['/management', '/division-dashboard', '/escalations', '/roadmap', '/targets', '/management/flow', '/analytics', '/activity-logs'],
    summary: 'Dashboard eksekutif, Google Analytics, dan jejak audit.' },
  { slug: 'admin', title: 'Administrasi', symbol: 'settings', paths: ['/admin/users', '/admin/workspace-sync', '/admin/entities', '/admin/departments', '/admin/roles', '/admin/permissions', '/admin/folder-rules', '/admin/document-types', '/admin/signature-rules', '/admin/integration-logs', '/admin/approval-matrix', '/admin/signature-precheck', '/admin/ai-usage', '/admin/ai-provider-settings', '/admin/accurate', '/admin/notification-policy'],
    summary: 'Pengguna, akses, aturan approval, dan konfigurasi sistem.' },
];

export const moduleDescriptions = {
  '/panduan': 'Cara memakai Prakasa Workspace, sesuai peran Anda.',
  '/sales/pipeline': 'Tahap pelanggan otomatis — prospek, NOO, aktif, dormant, lost.',
  '/sales/customers': 'Direktori pelanggan, lengkap dengan status Aktif / Dormant / Lost.',
  '/sales/leads': 'Outlet dari kunjungan SimpliDOTS & lapangan yang belum jadi pelanggan.',
  '/sales/orders': 'Sales order, surat jalan, invoice & pembayaran — dicatat di Accurate, dipantau di sini.',
  '/warehouse': 'Barang masuk & keluar dengan approval Supervisor, dicocokkan dengan dokumen Accurate, plus operasional gudang.',
  '/procurement': 'PO, pemasok, dan barang datang dari Accurate, setelah disetujui Head Procurement.',
  '/calendar': 'Agenda Google Calendar Anda: lihat, buat event, dan Google Meet.',
  '/division-storage': 'Folder Shared Drive divisi Anda — buat dan edit Dokumen, Spreadsheet, Slide langsung dari sini.',
  '/doc-templates': 'Template Google Docs dengan kop & footer per divisi — BAST, surat, memo — langsung ke Shared Drive divisi.',
  '/my-drive': 'My Drive pribadi Anda di Google — dan folder Shared Drive divisi Anda, dalam satu tempat.',
  '/it/tickets': 'Ajukan kebutuhan IT dan pantau statusnya.',
  '/ga': 'ATK, perbaikan fasilitas, dan ruang rapat — operasional kantor yang dikelola GA, bagian People & Culture.',
  '/people/directory': 'Kontak kerja, jabatan, atasan, dan struktur organisasi perusahaan.',
  '/mail': 'Kotak masuk Gmail Anda, langsung di Prakasa Workspace.',
  '/chat': 'Space dan pesan Google Chat Anda — termasuk Space per Task Board.',
  '/projects': 'Project tracker ala Jira untuk setiap Space Google Chat: board, backlog, sprint, dan laporan.',
  '/docs': 'Google Docs Anda: buat, cari, dan edit dokumen.',
  '/sheets': 'Google Sheets Anda: buat, cari, dan edit spreadsheet.',
  '/slides': 'Google Slides Anda: buat, cari, dan edit presentasi.',
  '/groups': 'Google Groups perusahaan dan anggotanya.',
  '/analytics': 'Laporan Google Analytics: pengunjung, halaman, dan sumber trafik.',
  '/hrga/onboarding': 'Karyawan baru — approval atasan, lalu checklist IT, GA, atasan, dan People & Culture.',
  '/hrga/offboarding': 'Karyawan keluar — pengembalian perangkat, lisensi, nomor, dan akses.',
  '/hrga/checklist-templates': 'Template checklist onboarding/offboarding.',
  '/ga/operations': 'Perawatan berkala (AC, APAR, genset), kontrak kebersihan/keamanan/sewa, dan tagihan listrik & air.',
  '/it/dashboard': 'Ringkasan aset, lisensi, tiket.',
  '/it/devices': 'Aset perangkat, assignment, kondisi.',
  '/it/subscriptions': 'Software vendor, lisensi, invoice, pembayaran.',
  '/it/infrastructure': 'Jaringan, ISP, CCTV, backup, Google Workspace, dan nomor perusahaan.',
  '/management': 'Dashboard eksekutif lintas divisi.',
  '/finance/receivables': 'Umur piutang, jatuh tempo, pelanggan terlambat, dan penagihan per bulan — dari Accurate.',
  '/finance/payables': 'Utang ke pemasok dari faktur & pembayaran pembelian Accurate: umur, jatuh tempo, dan pembayaran.',
  '/finance/payment-requests': 'Pengajuan pembayaran ke vendor dan reimbursement karyawan, dengan approval dan cek dokumen.',
  '/marketing/insights': 'Omzet per channel, produk terlaris dan yang naik/turun, pelanggan baru, dan leads per area.',
  '/marketing/campaigns': 'Kampanye per channel dan produk, dengan uplift penjualan dibanding periode sebelumnya.',
  '/retail-commerce': 'Kinerja marketplace Shopee & Tokopedia: omzet, pesanan, produk terlaris, retur, piutang, dan SO belum dikirim.',
  '/division-dashboard': 'Dashboard tiap divisi: angka utama, grafik capaian 12 bulan, tren dengan target, dan yang lewat tenggat.',
  '/escalations': 'Semua pekerjaan lintas modul yang lewat tenggat, dalam satu antrean tindak lanjut.',
  '/roadmap': 'Linimasa project semua divisi dalam satu peta — jadwal, tumpang tindih, dan yang lewat tenggat.',
  '/targets': 'Target per divisi per periode, berdampingan dengan realisasi nyata dari Project Tracker dan approval.',
  '/management/flow': 'Pesanan sampai lunas, PO sampai barang datang, perkiraan margin, dan barang lambat laku — dari data Accurate yang disetujui.',
  '/activity-logs': 'Jejak audit aktivitas pengguna dan sistem.',
  '/admin/accurate': 'Sambungkan Accurate Online — hanya baca, aplikasi tidak pernah menulis ke Accurate.',
};

export function visibleSections(division, sections) {
  const visible = sections.flatMap((section) => section.items);
  const items = division.paths
    .map((path) => visible.find((item) => item.to === path))
    .filter(Boolean)
    .map((item) => ({ ...item, description: moduleDescriptions[item.to] }));
  return items.length ? [{ title: division.title, items }] : [];
}

// Last crumb below a module: a form to create or edit, or a record's detail.
function subPageLabel(pathname) {
  if (/\/new$/.test(pathname)) return 'Baru';
  if (/\/edit$/.test(pathname)) return 'Ubah';
  return 'Detail';
}

// Pages with no menu entry of their own, reached from inside another page.
// They still get a named crumb (and their division) instead of a bare
// "Halaman". Kept as tuples for the same reason as EXTRA_ROUTE_PERMISSIONS.
// [path, label, section for the division crumb, has a page of its own]
const EXTRA_PAGES = [
  ['/hrga/workflows', 'Alur karyawan', 'People & Culture', false],
  ['/signatures', 'Permintaan tanda tangan', null, true],
  ['/signatures/asset', 'Tanda tangan saya', null, true],
  ['/signatures/letterhead', 'Cap surat', null, true],
  ['/tasks', 'Papan tugas', null, true],
  ['/data-accurate', 'Data Accurate', null, true],
  ['/notifications', 'Notifikasi', null, true],
  // Opened from the account menu in the top bar; every signed-in user.
  ['/akun', 'Akun saya', null, true],
  ['/search', 'Pencarian', null, true],
  ['/__design', 'Galeri komponen', null, true],
].map(([to, label, section, linkable]) => ({ to, label, section, linkable }));

const matchesPath = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

// Crumbs after "Beranda" (PageTrail adds it). A crumb with `to: null` is text.
export function pageTrail(pathname, sections) {
  if (pathname === '/') return [];
  if (pathname === '/ai-command') return [{ label: 'Prakasa AI', to: '/ai-command' }];
  const items = sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title, linkable: true })));
  // Menu entries first, so a menu page wins over an EXTRA_PAGES entry of the same path.
  const current = [...items, ...EXTRA_PAGES].filter((item) => matchesPath(pathname, item.to))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!current) return [{ label: 'Halaman', to: pathname }];
  const division = divisions.find((entry) => entry.paths.includes(current.to))
    || (current.section && divisions.find((entry) => entry.title === current.section));
  const divisionItems = division ? visibleSections(division, sections)[0]?.items || [] : [];
  // Every division's modules already sit on the home page; a division with more
  // than one module gets a crumb back to '/' instead of a dedicated hub page.
  const showDivision = division && division.slug !== 'ai' && divisionItems.length > 1;
  return [
    ...(showDivision ? [{ label: division.title, to: '/' }] : []),
    { label: current.label, to: current.linkable ? current.to : null },
    ...(pathname !== current.to ? [{ label: subPageLabel(pathname), to: pathname }] : []),
  ];
}

// The side menu's shape (docs/ui-guideline.md §2.2): the untitled first section
// and every one-module section render as plain items; a section with several
// modules becomes an expandable group.
export function navGroups(sections) {
  return sections.flatMap((section) => (section.title && section.items.length > 1
    ? [{ type: 'group', key: section.title, title: section.title, items: section.items, focus: Boolean(section.focus) }]
    : section.items.map((item) => ({ type: 'item', key: item.to, item }))));
}

// The one menu entry the current page belongs to: the longest matching path, so
// /management/flow marks "Alur & Margin" and not also "Management Dashboard".
export function activeNavItem(pathname, sections) {
  return sections.flatMap((section) => section.items)
    .filter((item) => (item.end ? pathname === item.to : matchesPath(pathname, item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0] || null;
}
