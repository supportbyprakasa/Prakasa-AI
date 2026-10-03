import { useEffect, useState } from 'react';
import api from '../api/client';
import Page from '../components/Page';
import DataGrid from '../components/datagrid/DataGrid';
import './activity-logs.css';

// Audit codes ("task.create", "device.repair.create") read as Indonesian
// text: the subject, any detail, then what happened. A code missing from the
// maps is shown in words (dots and underscores become spaces). The raw code
// stays visible as a second mono line, stays searchable, and is what the
// export writes, so audits can still be matched against the backend.
const SUBJECT_LABELS = {
  accurate: 'Accurate',
  accurate_connection: 'Koneksi Accurate',
  ai: 'AI',
  ai_action: 'Aksi AI',
  ai_action_proposal: 'Usulan aksi AI',
  ai_claude_team_account: 'Akun Claude Team',
  ai_context_document: 'Dokumen konteks AI',
  ai_document: 'Dokumen AI',
  ai_document_download: 'Unduhan dokumen AI',
  ai_document_folder: 'Folder dokumen AI',
  ai_module_context: 'Konteks modul AI',
  ai_provider: 'Penyedia AI',
  ai_routing: 'Rute AI',
  ai_session: 'Sesi AI',
  ai_session_rollback: 'Pemulihan sesi AI',
  ai_tool: 'Alat AI',
  approval: 'Approval',
  approval_delegation: 'Delegasi approval',
  approval_matrix: 'Matriks approval',
  approval_request: 'Permintaan approval',
  board: 'Papan',
  calendar_event: 'Acara kalender',
  chat: 'Chat',
  department: 'Divisi',
  device: 'Perangkat',
  device_assignment: 'Pemakaian perangkat',
  device_handover: 'Serah terima perangkat',
  device_repair_log: 'Log kerusakan perangkat',
  device_return: 'Pengembalian perangkat',
  division_storage: 'Penyimpanan divisi',
  document: 'Dokumen',
  document_template: 'Template dokumen',
  document_type: 'Jenis dokumen',
  document_verification: 'Verifikasi dokumen',
  drive_file: 'File Drive',
  entity: 'Entitas',
  finance: 'Finance',
  finance_workflow: 'Pengajuan finance',
  folder_mapping_rule: 'Aturan folder',
  ga: 'GA',
  ga_maintenance_item: 'Item perawatan GA',
  folder_rule: 'Aturan folder',
  gmail_message: 'Email Gmail',
  google_chat_space: 'Ruang Google Chat',
  google_docs: 'Google Docs',
  hrga: 'Alur karyawan',
  hrga_checklist_template: 'Template checklist',
  hrga_workflow: 'Alur karyawan',
  hrga_workflow_task: 'Tugas checklist',
  it_backup_job: 'Pekerjaan backup IT',
  it_cctv_system: 'Sistem CCTV',
  it_device_import: 'Impor perangkat IT',
  it_gws_review: 'Tinjauan keamanan Google Workspace',
  it_infra: 'Infrastruktur IT',
  it_phone_line: 'Nomor telepon perusahaan',
  it_support: 'Dukungan IT',
  it_ticket: 'Tiket IT',
  letterhead: 'Cap surat',
  mkt_campaign: 'Kampanye marketing',
  mydrive: 'My Drive',
  notification_rule: 'Aturan notifikasi',
  org_location: 'Lokasi kantor',
  people_culture: 'People & Culture',
  people_directory: 'Direktori karyawan',
  permission: 'Izin',
  role: 'Peran',
  sales: 'Sales',
  sales_accurate_batch: 'Batch Accurate sales',
  sales_accurate_sync: 'Sinkronisasi Accurate sales',
  sales_customer: 'Pelanggan',
  sales_document_settings: 'Pengaturan dokumen sales',
  sales_invoice_exchange: 'Tukar faktur',
  sales_lead: 'Lead',
  sales_order: 'Order sales',
  sales_people: 'Tim sales',
  sales_person_accounts: 'Akun tim sales',
  sales_person_targets: 'Target tim sales',
  sales_product: 'Produk',
  sales_sync_run: 'Sinkronisasi sales',
  sales_targets: 'Target sales',
  sales_visits: 'Kunjungan sales',
  signature: 'Tanda tangan',
  signature_asset: 'Gambar tanda tangan',
  signature_precheck: 'Pemeriksaan AI tanda tangan',
  signature_qr: 'QR tanda tangan',
  signature_request: 'Permintaan tanda tangan',
  signature_rule: 'Aturan tanda tangan',
  software_subscription: 'Langganan software',
  software_vendor: 'Vendor software',
  subscription: 'Langganan software',
  subscription_invoice: 'Invoice langganan',
  subscription_license: 'Lisensi langganan',
  subscription_payment: 'Pembayaran langganan',
  task: 'Tugas',
  template: 'Template',
  test_data: 'Data uji',
  user: 'Pengguna',
  warehouse: 'Warehouse',
  warehouse_checklist: 'Checklist warehouse',
  warehouse_inbound: 'Barang masuk',
  warehouse_incident: 'Insiden warehouse',
  warehouse_outbound: 'Barang keluar',
  warehouse_recon: 'Pencocokan warehouse',
  workspace_sync: 'Sinkronisasi Workspace',
  workspace_sync_candidate: 'Kandidat sinkronisasi Workspace',
};
const DETAIL_LABELS = {
  accurate_batch: 'batch Accurate',
  attachment: 'lampiran',
  booking: 'pemesanan',
  connect: 'sambungan',
  credentials: 'kredensial',
  default: 'bawaan',
  division: 'divisi',
  invoice_exchange: 'tukar faktur',
  maintenance: 'maintenance',
  message: 'pesan',
  module_config: 'konfigurasi modul',
  pic: 'penanggung jawab',
  movement: 'pergerakan barang',
  recon: 'pencocokan',
  refresh: 'pembaruan',
  repair: 'kerusakan',
  request: 'permintaan',
  resource: 'sumber daya',
  settings: 'pengaturan',
  task: 'tugas',
  warranty: 'garansi',
};
const VERB_LABELS = {
  accurate_sync: 'disinkronkan dari Accurate',
  apply: 'diterapkan',
  approve: 'disetujui',
  archive: 'diarsipkan',
  assign: 'ditetapkan',
  attach_context: 'konteks dilampirkan',
  attachment: 'lampiran ditambahkan',
  backfill_drive_access: 'akses Drive dilengkapi',
  call: 'dipanggil',
  cancel: 'dibatalkan',
  cancelled: 'dibatalkan',
  check: 'diperiksa',
  checkout: 'selesai dipakai',
  clear: 'dikosongkan',
  comment: 'dikomentari',
  complete: 'diselesaikan',
  completed: 'selesai',
  confirm_action: 'aksi dikonfirmasi',
  confirm_deferred: 'dikonfirmasi',
  connect: 'disambungkan',
  context_built: 'konteks disiapkan',
  convert: 'dijadikan pelanggan',
  convert_to_task: 'dijadikan tugas',
  create: 'dibuat',
  create_file: 'file dibuat',
  create_folder: 'folder dibuat',
  deactivate: 'dinonaktifkan',
  decision_denied: 'keputusan ditolak',
  delete: 'dihapus',
  delete_group: 'grup dihapus',
  disconnect: 'diputus',
  done: 'selesai',
  document_assistant: 'asisten dokumen dipakai',
  document_check: 'dokumen diperiksa',
  drive_access_failed: 'akses Drive gagal',
  email: 'email diatur',
  execute: 'dijalankan',
  expired: 'kedaluwarsa',
  explain: 'dijelaskan',
  failed: 'gagal',
  fetch: 'diambil',
  generate: 'dibuat',
  holder: 'pemegang diubah',
  holdings_sync: 'kepemilikan disinkronkan',
  import: 'diimpor',
  import_create: 'dibuat lewat impor',
  import_link: 'ditautkan lewat impor',
  import_update: 'diubah lewat impor',
  it_asset_report: 'laporan aset IT dibuat',
  link: 'ditautkan',
  link_jurnal: 'ditautkan ke Jurnal.id',
  link_account: 'ditautkan ke akun',
  link_kantorku: 'ditautkan ke KantorKu',
  login: 'masuk',
  login_failed: 'gagal masuk',
  logout: 'keluar',
  manage: 'dikelola',
  map: 'dipetakan',
  mark_idle: 'ditandai idle',
  message: 'pesan dikirim',
  message_edit: 'pesan diubah',
  missing: 'tidak ditemukan',
  password_change: 'mengganti kata sandi',
  password_reset: 'kata sandi direset',
  payment: 'pembayaran dicatat',
  propose: 'diusulkan',
  propose_action: 'aksi diusulkan',
  refresh: 'diperbarui',
  reject: 'ditolak',
  remove_file: 'file dihapus',
  rename_file: 'nama file diubah',
  request: 'diminta',
  request_revision: 'diminta revisi',
  reset_standard: 'dikembalikan ke standar',
  resign: 'ditandai resign',
  resolve: 'diselesaikan',
  return: 'dikembalikan',
  revoke: 'dicabut',
  run: 'dijalankan',
  save: 'disimpan',
  send_message: 'pesan dikirim',
  settings_update: 'pengaturan diubah',
  signed: 'ditandatangani',
  skip: 'dilewati',
  start: 'dimulai',
  status: 'status diubah',
  status_change: 'status diubah',
  submit: 'diajukan',
  submit_approval: 'diajukan ke approval',
  summarize: 'diringkas',
  trash_file: 'file dibuang',
  unexplain: 'penjelasan dicabut',
  unlink: 'tautan dilepas',
  update: 'diubah',
  update_group: 'grup diubah',
  upload: 'diunggah',
  upload_file: 'file diunggah',
  use: 'dipakai',
  verify: 'diverifikasi',
  view: 'dilihat',
  visit: 'kunjungan dicatat',
  withdraw: 'ditarik',
  withdrawn: 'ditarik',
};

const words = (code) => String(code || '').replace(/[._]+/g, ' ').trim();
const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

function subjectLabel(code) {
  return SUBJECT_LABELS[code] || sentence(words(code));
}

// The pieces of an action label, each one an entry of a label map: the
// language switch translates them one by one ("Tugas" + "dibuat"). A piece
// with no entry in the maps is the raw code in words: `data: true`, never
// translated ("cleanup", "retire").
const known = (text) => ({ text, data: false });
const raw = (code) => ({ text: words(code), data: true });

function subjectZoned(code) {
  return SUBJECT_LABELS[code] ? known(SUBJECT_LABELS[code]) : { text: sentence(words(code)), data: true };
}

function actionZonedParts(code) {
  const parts = String(code || '').split('.').filter(Boolean);
  if (!parts.length) return [];
  if (parts.length === 1) {
    return [VERB_LABELS[parts[0]] ? known(sentence(VERB_LABELS[parts[0]])) : { text: sentence(words(parts[0])), data: true }];
  }
  const [subject, ...rest] = parts;
  const verb = rest.pop();
  const detail = rest.map((part) => (DETAIL_LABELS[part] ? known(DETAIL_LABELS[part]) : raw(part)));
  return [subjectZoned(subject), ...detail, VERB_LABELS[verb] ? known(VERB_LABELS[verb]) : raw(verb)];
}

const actionLabel = (code) => actionZonedParts(code).map((part) => part.text).join(' ');

// Label on top, raw code underneath; search matches both, export keeps the code.
// `toParts` gives the label in pieces, shown as separate text nodes; a piece
// that is not a label of the maps is marked as data.
function codeColumn(key, header, toLabel, toParts) {
  return {
    key,
    header,
    translate: true,
    sortValue: (row) => `${toLabel(row[key])} ${row[key] ?? ''}`.trim(),
    render: (row) => (row[key] ? (
      <span className="pw-cell">
        <span className="pw-cell__title">
          {toParts(row[key]).flatMap((part, index) => {
            // eslint-disable-next-line react/no-array-index-key
            const node = part.data ? <span key={index} data-no-translate="">{part.text}</span> : part.text;
            return index ? [' ', node] : [node];
          })}
        </span>
        <span data-no-translate="" className="pw-cell__meta activity-log__code">{row[key]}</span>
      </span>
    ) : ''),
  };
}

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

export default function ActivityLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.get('/activity-logs', { params: { page: 1, limit: 50 } })
      .then((r) => setRows(r.data.data || []))
      .catch((error) => setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.')))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <Page title="Log aktivitas" description="Jejak audit aktivitas pengguna dan sistem, 50 kejadian terbaru.">
      <DataGrid
        title="Log aktivitas"
        showTitle={false}
        exportName="log-aktivitas"
        loading={loading}
        error={loadError}
        onRetry={load}
        rows={rows}
        empty="Belum ada aktivitas"
        columns={[
          { key: 'createdAt', header: 'Waktu', type: 'datetime' },
          { key: 'userName', header: 'Pengguna' },
          codeColumn('action', 'Aktivitas', actionLabel, actionZonedParts),
          codeColumn('subjectType', 'Objek', subjectLabel, (code) => [subjectZoned(code)]),
          { key: 'subjectId', header: 'ID objek' },
        ]}
      />
    </Page>
  );
}
