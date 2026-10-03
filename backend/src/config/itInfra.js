// IT infrastructure registers (People & Culture wave 2, row 2.3 —
// docs/rancangan-people-culture-g2.md Bagian 4): the one backend source of
// truth for the registers' enums and Indonesian labels, the escalation
// thresholds, and the import allow-list of the owner's IT report. The DB enums
// (migration 110), the zod rules in itInfrastructure.routes.js and the frontend
// model (frontend/src/pages/it/infraModel.js) must agree — the tests check.

const freeze = Object.freeze;

// ------------------------------------------------------------ enums (DB order)
const NETWORK_TYPES = freeze(['router', 'switch', 'access_point', 'nvr', 'dvr', 'firewall', 'modem', 'other']);
const NETWORK_TYPE_LABELS = freeze({
  router: 'Router', switch: 'Switch', access_point: 'Access point', nvr: 'NVR', dvr: 'DVR',
  firewall: 'Firewall', modem: 'Modem', other: 'Lainnya',
});
const NETWORK_STATUSES = freeze(['active', 'spare', 'damaged', 'retired']);
const NETWORK_STATUS_LABELS = freeze({ active: 'Aktif', spare: 'Cadangan', damaged: 'Rusak', retired: 'Tidak aktif' });

const ISP_STATUSES = freeze(['active', 'terminated']);
const ISP_STATUS_LABELS = freeze({ active: 'Aktif', terminated: 'Berhenti' });

const CCTV_RECORDERS = freeze(['nvr', 'dvr', 'cloud', 'none']);
const CCTV_RECORDER_LABELS = freeze({ nvr: 'NVR', dvr: 'DVR', cloud: 'Cloud', none: 'Tanpa perekam' });
const CCTV_STATUSES = freeze(['online', 'partial', 'offline', 'retired']);
const CCTV_STATUS_LABELS = freeze({ online: 'Online', partial: 'Sebagian offline', offline: 'Offline', retired: 'Tidak aktif' });

const BACKUP_FREQUENCIES = freeze(['daily', 'weekly', 'monthly', 'other']);
const BACKUP_FREQUENCY_LABELS = freeze({ daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', other: 'Lainnya' });
const BACKUP_STORAGE = freeze(['onsite', 'offsite', 'cloud']);
const BACKUP_STORAGE_LABELS = freeze({ onsite: 'Di lokasi', offsite: 'Di luar lokasi', cloud: 'Cloud' });
const BACKUP_RESULTS = freeze(['ok', 'failed', 'unknown']);
const BACKUP_RESULT_LABELS = freeze({ ok: 'Berhasil', failed: 'Gagal', unknown: 'Belum diperiksa' });
const BACKUP_STATUSES = freeze(['active', 'retired']);
const BACKUP_STATUS_LABELS = freeze({ active: 'Aktif', retired: 'Tidak aktif' });

const PHONE_KINDS = freeze(['mobile', 'ip_phone']);
const PHONE_KIND_LABELS = freeze({ mobile: 'HP', ip_phone: 'Telepon IP' });
const PHONE_STATUSES = freeze(['active', 'spare', 'terminated']);
const PHONE_STATUS_LABELS = freeze({ active: 'Aktif', spare: 'Cadangan', terminated: 'Berhenti' });

const VENDOR_KINDS = freeze(['software', 'isp', 'cctv', 'network', 'hardware', 'service', 'other']);
const VENDOR_KIND_LABELS = freeze({
  software: 'Software', isp: 'ISP', cctv: 'CCTV', network: 'Jaringan', hardware: 'Perangkat keras', service: 'Jasa', other: 'Lainnya',
});

// ------------------------------------------------------------ thresholds (§4.5)
// Time to renew or switch an internet contract before it ends.
const ISP_DECISION_DAYS = 30;
// The IT dashboard card "Kontrak ISP berakhir ≤ 60 hari".
const ISP_CONTRACT_WINDOW_DAYS = 60;
// A backup is overdue when not checked within this many days of its frequency
// (a few days' slack over the cycle itself).
const CHECK_DAYS = freeze({ daily: 3, weekly: 10, monthly: 35, other: 35 });
// A job never checked is due this many days after it was registered.
const FIRST_CHECK_GRACE_DAYS = 7;
// CCTV offline or partly offline longer than this escalates.
const CCTV_OFFLINE_DAYS = 2;
// A Google Workspace security review is due every quarter.
const GWS_REVIEW_DAYS = 90;

// ------------------------------------------------------------ import (§4.3)
// A header matching this is never read, even when it is on the allow-list by
// mistake: passwords, usernames, logins, PIN/PUK, tokens, secrets, credentials.
const SECRET_HEADER_RE = /pass|sandi|kata\s*kunci|user\s*name|username|login|\bpin\b|puk|token|secret|credential/i;

// Header text as compared: trimmed, inner spaces collapsed, lowercase.
const normalizeHeader = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Allow-listed columns per sheet kind, with the header texts of the owner's IT
// report (03 - Network Devices, 04_ISP_Info, 08_CCTV_System) and of the device
// management report (Network & ISP, ISP Information, CCTV & Security). Only
// these are read; every other column is left in the browser.
const IMPORT_COLUMNS = freeze({
  network: freeze([
    freeze({ field: 'deviceType', label: 'Tipe', headers: freeze(['Device Type (Router/Switch/AP/NVR)', 'Device Type']), required: true }),
    freeze({ field: 'serialNumber', label: 'Nomor seri', headers: freeze(['Serial Number']) }),
    freeze({ field: 'brandModel', label: 'Merek / model', headers: freeze(['Brand/Model', 'Brand / Model']) }),
    freeze({ field: 'location', label: 'Lokasi', headers: freeze(['Lokasi', 'Location']), required: true }),
    freeze({ field: 'ipAddress', label: 'Alamat IP', headers: freeze(['IP Address']) }),
    freeze({ field: 'installedYear', label: 'Tahun pasang', headers: freeze(['Tahun Install', 'Year']) }),
    freeze({ field: 'ispName', label: 'ISP terkait', headers: freeze(['ISP Terkait', 'ISP']) }),
    freeze({ field: 'firmware', label: 'Update firmware terakhir', headers: freeze(['Firmware Update Terakhir']) }),
    freeze({ field: 'status', label: 'Status', headers: freeze(['Status']) }),
    freeze({ field: 'notes', label: 'Catatan', headers: freeze(['Notes', 'Note', 'Catatan']) }),
  ]),
  isp: freeze([
    freeze({ field: 'location', label: 'Lokasi', headers: freeze(['Lokasi', 'Location']), required: true }),
    freeze({ field: 'provider', label: 'Provider', headers: freeze(['Provider']), required: true }),
    freeze({ field: 'customerNumber', label: 'No. pelanggan', headers: freeze(['No Pelanggan', 'Customer No.']) }),
    freeze({ field: 'bandwidth', label: 'Bandwidth', headers: freeze(['Bandwidth']) }),
    freeze({ field: 'dedicatedIp', label: 'IP publik dedicated', headers: freeze(['IP Public Dedicated (Yes/No)', 'Dedicated IP']) }),
    freeze({ field: 'backupIsp', label: 'ISP cadangan', headers: freeze(['Backup ISP (Yes/No)', 'Backup ISP']) }),
    freeze({ field: 'notes', label: 'Catatan', headers: freeze(['Note', 'Notes', 'Catatan']) }),
  ]),
  cctv: freeze([
    freeze({ field: 'location', label: 'Lokasi', headers: freeze(['Lokasi', 'Location']), required: true }),
    freeze({ field: 'cameraCount', label: 'Jumlah kamera', headers: freeze(['Jumlah Kamera', 'No. of Cameras']), required: true }),
    freeze({ field: 'cameraModel', label: 'Model', headers: freeze(['Model']) }),
    freeze({ field: 'recorderType', label: 'DVR/NVR', headers: freeze(['DVR/NVR', 'Type (DVR/NVR)']) }),
    freeze({ field: 'remoteAccess', label: 'Akses jarak jauh', headers: freeze(['Remote Access (Yes/No)', 'Remote Access']) }),
    freeze({ field: 'serialNumber', label: 'Nomor seri', headers: freeze(['Serial Number']) }),
    freeze({ field: 'sameNetworkAsPc', label: 'Satu jaringan dengan PC', headers: freeze(['Satu Network dengan PC (Yes/No)', '1 Network with PC']) }),
    freeze({ field: 'notes', label: 'Catatan', headers: freeze(['Catatan', 'Notes', 'Note']) }),
  ]),
});
const IMPORT_KINDS = freeze(Object.keys(IMPORT_COLUMNS));
const IMPORT_KIND_LABELS = freeze({ network: 'Perangkat jaringan', isp: 'ISP', cctv: 'CCTV' });
const IMPORT_MAX_ROWS = 2000;

// Report words → register values (keys lowercased and trimmed; a code in
// brackets after the type, e.g. "Access Point (NET-PG-AP-01)", is ignored).
const REPORT_NETWORK_TYPE_MAP = freeze({
  router: 'router', switch: 'switch', ap: 'access_point', 'access point': 'access_point', 'access_point': 'access_point',
  nvr: 'nvr', dvr: 'dvr', firewall: 'firewall', modem: 'modem', ont: 'modem',
});
const REPORT_NETWORK_STATUS_MAP = freeze({
  active: 'active', aktif: 'active', spare: 'spare', cadangan: 'spare', damaged: 'damaged', rusak: 'damaged',
  'not active': 'retired', inactive: 'retired', 'tidak aktif': 'retired', retired: 'retired',
});
const REPORT_RECORDER_MAP = freeze({ nvr: 'nvr', dvr: 'dvr', cloud: 'cloud', none: 'none', '-': 'none', tidak: 'none' });
const YES = freeze(['yes', 'ya', 'y', 'true', '1']);
const NO = freeze(['no', 'tidak', 'n', 'false', '0']);

module.exports = {
  NETWORK_TYPES, NETWORK_TYPE_LABELS, NETWORK_STATUSES, NETWORK_STATUS_LABELS,
  ISP_STATUSES, ISP_STATUS_LABELS,
  CCTV_RECORDERS, CCTV_RECORDER_LABELS, CCTV_STATUSES, CCTV_STATUS_LABELS,
  BACKUP_FREQUENCIES, BACKUP_FREQUENCY_LABELS, BACKUP_STORAGE, BACKUP_STORAGE_LABELS,
  BACKUP_RESULTS, BACKUP_RESULT_LABELS, BACKUP_STATUSES, BACKUP_STATUS_LABELS,
  PHONE_KINDS, PHONE_KIND_LABELS, PHONE_STATUSES, PHONE_STATUS_LABELS,
  VENDOR_KINDS, VENDOR_KIND_LABELS,
  ISP_DECISION_DAYS, ISP_CONTRACT_WINDOW_DAYS, CHECK_DAYS, FIRST_CHECK_GRACE_DAYS, CCTV_OFFLINE_DAYS, GWS_REVIEW_DAYS,
  SECRET_HEADER_RE, normalizeHeader, IMPORT_COLUMNS, IMPORT_KINDS, IMPORT_KIND_LABELS, IMPORT_MAX_ROWS,
  REPORT_NETWORK_TYPE_MAP, REPORT_NETWORK_STATUS_MAP, REPORT_RECORDER_MAP, YES, NO,
};
