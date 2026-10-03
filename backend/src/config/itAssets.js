// IT assets and the people directory (People & Culture wave 1, rows 1.1 and 1.2):
// the one backend source of truth for device types, device statuses and location
// kinds, with their Indonesian labels, and how the owner's device report names
// them. The DB enums (migrations 106/107), the zod rules in it.routes.js and the
// frontend model must agree with these lists — test/peopleCulture*.test.js checks.

// Order = the DB enum order (existing values first, wave-1 additions appended).
const DEVICE_TYPES = Object.freeze([
  'laptop', 'pc', 'macbook', 'smartphone', 'tablet', 'printer',
  'router', 'switch', 'access_point', 'cctv_nvr', 'monitor',
  'external_hdd', 'peripheral', 'other',
  'telephone', 'label_printer', 'fingerprint',
]);

const DEVICE_TYPE_LABELS = Object.freeze({
  laptop: 'Laptop',
  pc: 'PC',
  macbook: 'MacBook',
  smartphone: 'Smartphone',
  tablet: 'Tablet',
  printer: 'Printer',
  router: 'Router',
  switch: 'Switch',
  access_point: 'Access point',
  cctv_nvr: 'CCTV / NVR',
  monitor: 'Monitor',
  external_hdd: 'Harddisk eksternal',
  peripheral: 'Periferal',
  other: 'Lainnya',
  telephone: 'Telepon',
  label_printer: 'Printer label',
  fingerprint: 'Mesin sidik jari',
});

// Order = the DB enum order.
const DEVICE_STATUSES = Object.freeze([
  'available', 'assigned', 'maintenance', 'repair', 'damaged', 'retired', 'lost', 'disposed',
]);

// Labelled like the owner's report: Aktif / Cadangan / Rusak / Tidak aktif, plus
// the lifecycle states the report does not have.
const DEVICE_STATUS_LABELS = Object.freeze({
  assigned: 'Aktif',
  available: 'Cadangan',
  damaged: 'Rusak',
  retired: 'Tidak aktif',
  maintenance: 'Perawatan',
  repair: 'Perbaikan',
  lost: 'Hilang',
  disposed: 'Dibuang',
});

// The report's "Problematic Devices" = Rusak + Tidak aktif.
const PROBLEMATIC_STATUSES = Object.freeze(['damaged', 'retired']);

// A disposed device is gone for good: no status change leads out of it.
const FINAL_STATUSES = Object.freeze(['disposed']);
// A device can be handed to someone from these statuses only (lost/disposed cannot).
const ASSIGNABLE_FROM = Object.freeze(['available', 'damaged', 'maintenance', 'repair', 'retired']);

const LOCATION_KINDS = Object.freeze(['office', 'store', 'warehouse', 'other']);
const LOCATION_KIND_LABELS = Object.freeze({
  office: 'Kantor',
  store: 'Toko',
  warehouse: 'Gudang',
  other: 'Lainnya',
});

const PERSON_KINDS = Object.freeze(['employee', 'group_staff', 'excluded']);
const PERSON_KIND_LABELS = Object.freeze({
  employee: 'Karyawan',
  group_staff: 'Staf grup (entitas lain)',
  excluded: 'Dikecualikan',
});
const PERSON_STATUS_LABELS = Object.freeze({ active: 'Aktif', resigned: 'Resign' });
const RESIGN_SOURCE_LABELS = Object.freeze({
  entered: 'Diisi People & Culture',
  import: 'Tanggal resign tidak ada di file',
  account: 'Akun aplikasi dinonaktifkan',
});

// ------------------------------------------------------------ device report
// The owner's "IT - Device Management Report": sheet "Device Inventory" (+ the
// hidden "User List"). Keys are the report's texts, lowercased and trimmed.
const REPORT_TYPE_MAP = Object.freeze({
  laptop: 'laptop',
  notebook: 'laptop',
  macbook: 'macbook',
  pc: 'pc',
  desktop: 'pc',
  monitor: 'monitor',
  'mobile phone': 'smartphone',
  smartphone: 'smartphone',
  handphone: 'smartphone',
  tablet: 'tablet',
  ipad: 'tablet',
  printer: 'printer',
  'printer label': 'label_printer',
  'printer sticker label': 'label_printer',
  'label printer': 'label_printer',
  telephone: 'telephone',
  telepon: 'telephone',
  'ip phone': 'telephone',
  fingerprint: 'fingerprint',
  'combo touch': 'peripheral',
  speaker: 'peripheral',
  keyboard: 'peripheral',
  mouse: 'peripheral',
  router: 'router',
  switch: 'switch',
  'access point': 'access_point',
  'external hdd': 'external_hdd',
  'external harddisk': 'external_hdd',
});

// Report status → device status. The Indonesian labels are accepted too, so a
// list exported from the app imports back unchanged.
const REPORT_STATUS_MAP = Object.freeze({
  active: 'assigned',
  aktif: 'assigned',
  spare: 'available',
  cadangan: 'available',
  damaged: 'damaged',
  rusak: 'damaged',
  'not active': 'retired',
  'tidak aktif': 'retired',
  inactive: 'retired',
  maintenance: 'maintenance',
  perawatan: 'maintenance',
  repair: 'repair',
  perbaikan: 'repair',
  lost: 'lost',
  hilang: 'lost',
  disposed: 'disposed',
  dibuang: 'disposed',
});

// Device status → the report's own word (export, in the report's layout).
const REPORT_STATUS_LABELS = Object.freeze({
  assigned: 'Active',
  available: 'Spare',
  damaged: 'Damaged',
  retired: 'Not Active',
  maintenance: 'Maintenance',
  repair: 'Repair',
  lost: 'Lost',
  disposed: 'Disposed',
});

const REPORT_TYPE_LABELS = Object.freeze({
  laptop: 'Laptop',
  pc: 'PC',
  macbook: 'Macbook',
  smartphone: 'Mobile Phone',
  tablet: 'Tablet',
  printer: 'Printer',
  router: 'Router',
  switch: 'Switch',
  access_point: 'Access Point',
  cctv_nvr: 'CCTV / NVR',
  monitor: 'Monitor',
  external_hdd: 'External HDD',
  peripheral: 'Peripheral',
  other: 'Other',
  telephone: 'Telephone',
  label_printer: 'Printer Label',
  fingerprint: 'Fingerprint',
});

// "Device Inventory" columns, in the report's order. Explicit names only — the
// holder column is "User Name" and is read as the holder, never dropped.
const REPORT_DEVICE_COLUMNS = Object.freeze([
  { header: 'No', field: 'no' },
  { header: 'Device Type', field: 'type', required: true },
  { header: 'Brand / Model', field: 'model' },
  { header: 'Serial Number', field: 'serial' },
  { header: 'Asset No.', field: 'assetCode' },
  { header: 'Purchase Year', field: 'purchaseYear' },
  { header: 'User Name', field: 'holder' },
  { header: 'Location', field: 'location' },
  { header: 'Company', field: 'company', required: true },
  { header: 'Status', field: 'status', required: true },
  { header: 'Notes', field: 'notes' },
]);

// Hidden "User List" columns.
const REPORT_PEOPLE_COLUMNS = Object.freeze([
  { header: 'No', field: 'no' },
  { header: 'Employee Name', field: 'name', required: true },
  { header: 'Position', field: 'position' },
  { header: 'Entity', field: 'company', required: true },
  { header: 'Status', field: 'status', required: true },
  { header: 'Email', field: 'email' },
]);

const REPORT_PEOPLE_STATUS_MAP = Object.freeze({
  active: 'active',
  aktif: 'active',
  resign: 'resigned',
  resigned: 'resigned',
});

// The report's summary block under the table (Active/Spare/Damaged/Not Active/TOTAL).
const REPORT_SUMMARY_LABELS = Object.freeze(['active', 'spare', 'damaged', 'not active', 'total', 'grand total']);

// A column whose header contains one of these is never read (IT Security: no
// passwords or account names in the app). "User Name" (two words) is the holder.
const CREDENTIAL_HEADER_RE = /password|sandi|username|credential/i;

module.exports = {
  DEVICE_TYPES,
  DEVICE_TYPE_LABELS,
  DEVICE_STATUSES,
  DEVICE_STATUS_LABELS,
  PROBLEMATIC_STATUSES,
  FINAL_STATUSES,
  ASSIGNABLE_FROM,
  LOCATION_KINDS,
  LOCATION_KIND_LABELS,
  PERSON_KINDS,
  PERSON_KIND_LABELS,
  PERSON_STATUS_LABELS,
  RESIGN_SOURCE_LABELS,
  REPORT_TYPE_MAP,
  REPORT_STATUS_MAP,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  REPORT_DEVICE_COLUMNS,
  REPORT_PEOPLE_COLUMNS,
  REPORT_PEOPLE_STATUS_MAP,
  REPORT_SUMMARY_LABELS,
  CREDENTIAL_HEADER_RE,
};
