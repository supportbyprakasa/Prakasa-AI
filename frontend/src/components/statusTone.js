// The single status/priority → tone + Indonesian label table
// (docs/ui-guideline.md §4.12). StatusBadge / PriorityBadge render the tone as
// coloured text. Every module reads from here; a page may override the LABEL
// for its own wording, never the tone.
//
//   default  neutral / not started / archived / a category  --pw-text-muted
//   info     in progress, moving                             --pw-info
//   warning  needs someone's attention                       --pw-warning
//   success  finished well / available                      --pw-success
//   error    failed, refused, lost                           --pw-error

const STATUSES = {
  // "Ringkasan pagi" on the home page: how urgent a row is.
  briefing_danger: ['error', 'Mendesak'],
  briefing_warning: ['warning', 'Perlu perhatian'],
  briefing_info: ['info', 'Info'],
  // "Periksa dengan AI" on a Data Accurate batch: how serious a finding is.
  finding_high: ['error', 'Tinggi'],
  finding_medium: ['warning', 'Sedang'],
  finding_low: ['default', 'Rendah'],
  // generic lifecycle
  draft: ['default', 'Draf'],
  new: ['default', 'Baru'],
  open: ['default', 'Terbuka'],
  pending: ['default', 'Menunggu'],
  requested: ['default', 'Diminta'],
  queued: ['default', 'Dalam antrean'],
  inactive: ['default', 'Nonaktif'],
  closed: ['default', 'Ditutup'],
  skipped: ['default', 'Dilewati'],
  in_progress: ['info', 'Dikerjakan'],
  processing: ['info', 'Diproses'],
  submitted: ['info', 'Diajukan'],
  active: ['info', 'Aktif'],
  assigned: ['info', 'Dipakai'],
  scheduled: ['info', 'Terjadwal'],
  preparing: ['info', 'Disiapkan'],
  ready: ['info', 'Siap'],
  uploaded: ['info', 'Diunggah'],
  review: ['warning', 'Review'],
  under_review: ['warning', 'Ditinjau'],
  pending_approval: ['warning', 'Menunggu persetujuan'],
  pending_document_check: ['warning', 'Pemeriksaan dokumen'],
  pending_upload: ['warning', 'Menunggu unggah'],
  waiting_on_user: ['warning', 'Menunggu balasan'],
  revision_requested: ['warning', 'Perlu revisi'],
  need_follow_up: ['warning', 'Perlu follow-up'],
  on_hold: ['warning', 'Ditahan'],
  paused: ['warning', 'Dijeda'],
  blocked: ['warning', 'Terhambat'],
  expiring: ['warning', 'Segera berakhir'],
  warning: ['warning', 'Peringatan'],
  approved: ['success', 'Disetujui'],
  accepted: ['success', 'Diterima'],
  completed: ['success', 'Selesai'],
  done: ['success', 'Selesai'],
  resolved: ['success', 'Selesai'],
  paid: ['success', 'Dibayar'],
  signed: ['success', 'Ditandatangani'],
  delivered: ['success', 'Terkirim'],
  // Stock from Accurate (Warehouse): available / none / below zero.
  in_stock: ['success', 'Ada'],
  out_of_stock: ['default', 'Habis'],
  negative_stock: ['error', 'Minus'],
  low_stock: ['warning', 'Menipis'],
  in_transit: ['info', 'Dalam perjalanan'],
  // Shipping schedule (Warehouse): does Accurate's stock cover the SO?
  stock_enough: ['success', 'Stok cukup'],
  stock_short: ['error', 'Stok kurang'],
  // Purchase orders from Accurate (Procurement).
  po_open: ['default', 'Menunggu barang'],
  po_partial: ['info', 'Sebagian diterima'],
  po_late: ['error', 'Terlambat'],
  po_received: ['success', 'Diterima'],
  po_closed: ['default', 'Ditutup'],
  po_legacy: ['warning', 'PO lama'],
  // Saran pesan ulang (Procurement): how urgent a reorder is.
  reorder_critical: ['error', 'Habis sebelum barang datang'],
  reorder_now: ['warning', 'Pesan sekarang'],
  reorder_check: ['warning', 'Habis, perlu dicek'],
  // Pencocokan Barang Masuk/Keluar ↔ Accurate (Warehouse, program 3.2).
  recon_matched: ['success', 'Cocok'],
  recon_qty_diff: ['error', 'Selisih jumlah'],
  recon_app_only: ['warning', 'Belum di Accurate'],
  recon_acc_only: ['warning', 'Belum di aplikasi'],
  recon_uncomparable: ['default', 'Belum bisa dibandingkan'],
  // A difference the Accurate data cannot confirm yet (a Warehouse batch waits for approval).
  recon_waiting: ['default', 'Menunggu data Accurate'],
  recon_explained: ['info', 'Dijelaskan'],
  // Alur & Margin (program 3.3, Management): what is stuck in the order flow…
  flow_so_late: ['error', 'Lewat janji kirim'],
  flow_so_legacy: ['warning', 'SO lama'],
  flow_not_billed: ['error', 'Belum difaktur'],
  flow_not_billed_old: ['warning', 'Lama, belum difaktur'],
  // …the margin estimate per product…
  margin_negative: ['error', 'Rugi'],
  cost_after: ['warning', 'Harga PO sesudahnya'],
  cost_partial: ['warning', 'Sebagian terhitung'],
  cost_missing: ['default', 'Tanpa harga beli'],
  unit_missing: ['default', 'Satuan belum diketahui'],
  // …and slow movers.
  slow_moving: ['warning', 'Lambat laku'],
  not_moving: ['error', 'Tidak laku'],
  never_sold: ['default', 'Belum pernah terjual'],
  received: ['success', 'Diterima'],
  processed: ['success', 'Diproses'],
  passed: ['success', 'Lolos'],
  success: ['success', 'Berhasil'],
  won: ['success', 'Menang'],
  rejected: ['error', 'Ditolak'],
  cancelled: ['error', 'Dibatalkan'],
  failed: ['error', 'Gagal'],
  overdue: ['error', 'Terlambat'],
  expired: ['error', 'Kedaluwarsa'],
  revoked: ['error', 'Dicabut'],
  lost: ['error', 'Hilang'],

  // Calendar RSVP
  needsaction: ['default', 'Belum menjawab'],
  tentative: ['warning', 'Mungkin'],
  declined: ['error', 'Tidak'],

  // IT assets & subscriptions
  available: ['success', 'Tersedia'],
  returned: ['success', 'Dikembalikan'],
  maintenance: ['warning', 'Maintenance'],
  repair: ['warning', 'Perbaikan'],
  in_repair: ['info', 'Diperbaiki'],
  reported: ['default', 'Dilaporkan'],
  transferred: ['default', 'Dipindahkan'],
  retired: ['default', 'Pensiun'],
  disposed: ['default', 'Dimusnahkan'],
  idle: ['warning', 'Idle'],
  unrepairable: ['error', 'Tidak bisa diperbaiki'],

  // Device status as the owner's IT report names it (People & Culture wave 1,
  // rule 14): Aktif / Cadangan / Rusak / Tidak aktif, plus the lifecycle
  // states the report does not have. Pages pass `device_<status>`.
  device_assigned: ['success', 'Aktif'],
  device_available: ['default', 'Cadangan'],
  device_damaged: ['error', 'Rusak'],
  device_retired: ['default', 'Tidak aktif'],
  device_maintenance: ['warning', 'Perawatan'],
  device_repair: ['warning', 'Perbaikan'],
  device_lost: ['error', 'Hilang'],
  device_disposed: ['default', 'Dibuang'],
  // A device still held by someone who resigned.
  holder_resigned: ['warning', 'Pemegang sudah resign'],

  // Layanan GA (People & Culture wave 2, row 2.2). Pages pass `ga_<status>`
  // for requests and `booking_<status>` for room/vehicle bookings.
  ga_pending_approval: ['warning', 'Menunggu approval'],
  ga_open: ['default', 'Baru'],
  ga_in_progress: ['info', 'Diproses'],
  ga_done: ['success', 'Selesai'],
  ga_rejected: ['error', 'Ditolak'],
  ga_cancelled: ['error', 'Dibatalkan'],
  ga_overdue: ['error', 'Lewat target'],
  booking_pending_approval: ['warning', 'Menunggu approval'],
  booking_confirmed: ['success', 'Terkonfirmasi'],
  booking_in_use: ['info', 'Dipakai'],
  booking_returned: ['success', 'Dikembalikan'],
  booking_rejected: ['error', 'Ditolak'],
  booking_cancelled: ['error', 'Dibatalkan'],
  booking_expired: ['default', 'Kedaluwarsa'],
  booking_late: ['error', 'Terlambat kembali'],

  // Operasional GA (migration 114). Pages pass `upkeep_<state>`,
  // `contract_<state>` and `bill_<state>`.
  upkeep_ok: ['success', 'Sesuai jadwal'],
  upkeep_soon: ['warning', 'Segera'],
  upkeep_overdue: ['error', 'Lewat jadwal'],
  upkeep_retired: ['default', 'Tidak dipakai'],
  upkeep_done_ok: ['success', 'Baik'],
  upkeep_done_follow_up: ['warning', 'Perlu tindak lanjut'],
  contract_active: ['success', 'Aktif'],
  contract_ending: ['warning', 'Segera berakhir'],
  contract_lapsed: ['error', 'Lewat masa kontrak'],
  contract_ended: ['default', 'Selesai'],
  bill_paid: ['success', 'Dibayar'],
  bill_unpaid: ['default', 'Belum dibayar'],
  bill_soon: ['warning', 'Segera jatuh tempo'],
  bill_overdue: ['error', 'Lewat jatuh tempo'],

  // IT infrastructure registers (People & Culture wave 2, row 2.3). Pages pass
  // `net_<status>`, `cctv_<status>`, `backup_<last result>`, `line_<status>`, `isp_<status>`.
  net_active: ['success', 'Aktif'],
  net_spare: ['default', 'Cadangan'],
  net_damaged: ['error', 'Rusak'],
  net_retired: ['default', 'Tidak aktif'],
  cctv_online: ['success', 'Online'],
  cctv_partial: ['warning', 'Sebagian offline'],
  cctv_offline: ['error', 'Offline'],
  cctv_retired: ['default', 'Tidak aktif'],
  backup_ok: ['success', 'Berhasil'],
  backup_failed: ['error', 'Gagal'],
  backup_unknown: ['default', 'Belum diperiksa'],
  backup_retired: ['default', 'Tidak aktif'],
  line_active: ['success', 'Aktif'],
  line_spare: ['default', 'Cadangan'],
  line_terminated: ['default', 'Berhenti'],
  isp_active: ['success', 'Aktif'],
  isp_terminated: ['default', 'Berhenti'],

  // Directory (People & Culture): a person's status and the marks beside a name.
  person_active: ['success', 'Aktif'],
  person_resigned: ['default', 'Resign'],
  person_excluded: ['default', 'Dikecualikan'],
  // Onboarding/offboarding dates beside a name ("Bergabung 12 Okt", "Hari terakhir 15 Okt").
  person_starting: ['info', 'Akan bergabung'],
  person_last_day: ['warning', 'Hari terakhir'],
  no_account: ['default', 'Tanpa akun'],
  group_staff: ['default', 'Staf grup'],
  unreviewed: ['warning', 'Belum ditinjau'],

  // Import preview (device report, directory): what apply will do per row,
  // and how serious a row's note is.
  import_new: ['success', 'Baru'],
  import_link: ['info', 'Tautkan ke akun'],
  import_exists: ['default', 'Sudah ada'],
  import_skip: ['error', 'Dilewati'],
  import_different: ['warning', 'Berbeda'],
  issue_error: ['error', 'Galat'],
  issue_warning: ['warning', 'Peringatan'],
  issue_info: ['default', 'Info'],

  // Target & realisasi (computed by the server per division × metric × period)
  no_target: ['default', 'Belum ada target'],
  no_data: ['default', 'Belum ada data'],
  billed_monthly: ['default', 'Ditagih bulanan'],
  on_track: ['info', 'Sesuai jalur'],
  at_risk: ['warning', 'Perlu perhatian'],
  off_track: ['error', 'Tertinggal'],
  achieved: ['success', 'Tercapai'],

  // Sales customer status and funnel stage (derived from order dates; same
  // rule as the Sales Data Tracker). `lost` keeps its error tone above.
  aktif: ['success', 'Aktif'],
  dormant: ['warning', 'Dormant'],
  prospek: ['default', 'Prospek'],
  belum_order: ['default', 'Belum order'],
  order_pertama: ['info', 'Order pertama'],
  unpaid: ['warning', 'Belum lunas'],
  running: ['info', 'Berjalan'],

  // External connections (Integrasi Accurate)
  connected: ['success', 'Tersambung'],
  disconnected: ['default', 'Belum tersambung'],

  // Incidents and tickets being looked into (Warehouse, IT).
  investigating: ['info', 'Diselidiki'],

  // AI document check results (Finance payment requests, AI documents).
  verified: ['success', 'Terverifikasi'],
  needs_review: ['warning', 'Perlu dicek'],

  // Accurate batch rows: what the pull will do to the app's copy.
  batch_create: ['success', 'Baru'],
  batch_update: ['warning', 'Berubah'],
  batch_missing: ['error', 'Tidak ada lagi'],

  // Sales visits, prices and leads.
  geo_mismatch: ['warning', 'Lokasi tidak cocok'],
  price_up: ['warning', 'Harga naik'],
  price_down: ['success', 'Harga turun'],
  price_same: ['default', 'Harga tetap'],
  converted: ['success', 'Sudah jadi pelanggan'],
  dropped: ['default', 'Tidak berminat'],

  // Task / issue dependency types.
  blocks: ['warning', 'Memblokir'],
  blocked_by: ['warning', 'Diblokir oleh'],
  related: ['default', 'Terkait'],

  // Visibility of a chat, document or folder — a category, so neutral.
  private: ['default', 'Pribadi'],
  department: ['default', 'Divisi'],
  entity: ['default', 'Lintas divisi'],
  company: ['default', 'Semua karyawan'],
  public: ['default', 'Publik'],

  // Approval flow and HR workflow types — categories, so neutral.
  sequential: ['default', 'Berurutan'],
  parallel: ['default', 'Paralel'],
  onboarding: ['default', 'Onboarding'],
  offboarding: ['default', 'Offboarding'],
  payment_request: ['default', 'Payment request'],
  reimbursement: ['default', 'Reimbursement'],

  // Notification delivery.
  read: ['default', 'Dibaca'],
  unread: ['info', 'Belum dibaca'],
  sent: ['success', 'Terkirim'],
};

const PRIORITIES = {
  low: ['default', 'Rendah'],
  normal: ['default', 'Normal'],
  medium: ['default', 'Sedang'],
  high: ['warning', 'Tinggi'],
  urgent: ['error', 'Mendesak'],
  critical: ['error', 'Kritis'],
};

// AI action risk tiers: the higher the risk, the stronger the tone.
const RISK_TIERS = {
  read: 'default',
  draft: 'info',
  confirmed_write: 'warning',
  controlled_decision: 'error',
  system_administration: 'error',
};

const key = (value) => String(value || '').toLowerCase();

function humanize(value) {
  const text = key(value).replace(/_/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

export const STATUS_LABELS = Object.fromEntries(Object.entries(STATUSES).map(([k, [, label]]) => [k, label]));
export const PRIORITY_LABELS = Object.fromEntries(Object.entries(PRIORITIES).map(([k, [, label]]) => [k, label]));

export function statusTone(status) { return STATUSES[key(status)]?.[0] || 'default'; }
export function statusLabel(status) { return STATUSES[key(status)]?.[1] || humanize(status); }
export function priorityTone(priority) { return PRIORITIES[key(priority)]?.[0] || 'default'; }
export function priorityLabel(priority) { return PRIORITIES[key(priority)]?.[1] || humanize(priority); }
export function riskTone(tier) { return RISK_TIERS[key(tier)] || 'default'; }
