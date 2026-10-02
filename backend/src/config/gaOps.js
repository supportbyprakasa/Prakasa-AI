// Operasional GA (migration 114): labels and time rules shared by the
// service, the management provider and the frontend model (gaOpsModel.js
// keeps the same labels).

const MAINTENANCE_CATEGORY_LABELS = Object.freeze({
  ac: 'AC',
  apar: 'APAR (pemadam api)',
  genset: 'Genset',
  lift: 'Lift',
  pest_control: 'Pengendalian hama',
  water: 'Air & pompa',
  electrical: 'Listrik & panel',
  building: 'Gedung',
  other: 'Lainnya',
});

const MAINTENANCE_RESULT_LABELS = Object.freeze({ ok: 'Baik', follow_up: 'Perlu tindak lanjut' });
const MAINTENANCE_STATUS_LABELS = Object.freeze({ active: 'Aktif', retired: 'Tidak dipakai' });

const CONTRACT_KIND_LABELS = Object.freeze({
  building_lease: 'Sewa gedung',
  cleaning: 'Kebersihan',
  security: 'Keamanan',
  pest_control: 'Pengendalian hama',
  waste: 'Sampah',
  maintenance: 'Perawatan',
  other: 'Lainnya',
});
const CONTRACT_STATUS_LABELS = Object.freeze({ active: 'Aktif', ended: 'Selesai' });

const UTILITY_LABELS = Object.freeze({ electricity: 'Listrik', water: 'Air', gas: 'Gas', other: 'Lainnya' });
const UTILITY_UNITS = Object.freeze({ electricity: 'kWh', water: 'm³', gas: 'm³', other: '' });

// A maintenance item shows "segera" this many days before it is due.
const MAINTENANCE_SOON_DAYS = 7;
// A bill shows "segera" this many days before its due date.
const BILL_SOON_DAYS = 5;

module.exports = {
  MAINTENANCE_CATEGORY_LABELS, MAINTENANCE_RESULT_LABELS, MAINTENANCE_STATUS_LABELS,
  CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS, UTILITY_LABELS, UTILITY_UNITS,
  MAINTENANCE_SOON_DAYS, BILL_SOON_DAYS,
};
