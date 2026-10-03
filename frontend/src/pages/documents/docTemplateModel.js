// Template dokumen, kop & footer per divisi, and BAST (migration 115). The
// standard placeholders are filled by the server; the form asks for the rest.

export const STANDARD_FIELDS = ['nomor_dokumen', 'tanggal', 'perusahaan', 'divisi', 'dibuat_oleh'];

export const TABS = [
  { k: 'templates', l: 'Template' },
  { k: 'kop', l: 'Kop & footer' },
  { k: 'generated', l: 'Dokumen dibuat' },
];
export const tabFrom = (value) => (TABS.some((t) => t.k === value) ? value : 'templates');

export const LAYOUTS = [
  { value: 'logo_left', label: 'Logo kiri' },
  { value: 'centered', label: 'Tengah' },
  { value: 'letterhead_image', label: 'Gambar kop surat' },
];

// Fields that hold longer text get a multi-line box.
const LONG_RE = /(catatan|isi|keterangan|uraian|alamat|deskripsi|kelengkapan|perihal)/;
const humanize = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The form fields a template asks for: its placeholders minus the standard ones. */
export function generateFields(template) {
  return (template?.placeholders || [])
    .filter((p) => !STANDARD_FIELDS.includes(p.key))
    .map((p) => ({ key: p.key, label: p.label || humanize(p.key), long: LONG_RE.test(p.key) }));
}

export function generateBody(template, values, title) {
  const out = {};
  for (const f of generateFields(template)) {
    const v = String(values[f.key] ?? '').trim();
    out[f.key] = v || '-';
  }
  return { values: out, ...(String(title || '').trim() ? { title: String(title).trim() } : {}) };
}

export function templateErrors(values) {
  const errors = {};
  if (!String(values.name || '').trim()) errors.name = 'Nama template wajib diisi.';
  if (values.source === 'copy' && !/docs\.google\.com\/document\/d\/|^[A-Za-z0-9_-]{20,}$/.test(String(values.sourceUrl || '').trim())) {
    errors.sourceUrl = 'Tempel tautan Google Docs, misalnya https://docs.google.com/document/d/…';
  }
  if (values.prefix && !/^[A-Za-z0-9]{2,12}$/.test(values.prefix)) errors.prefix = 'Awalan 2–12 huruf/angka, misalnya SK.';
  return errors;
}

export function templateBody(values) {
  return {
    name: String(values.name).trim(),
    source: values.source,
    departmentId: values.scope === 'company' ? null : Number(values.scope),
    ...(values.source === 'copy' ? { sourceUrl: String(values.sourceUrl).trim() } : {}),
    ...(values.prefix ? { prefix: values.prefix.toUpperCase() } : {}),
    ...(String(values.description || '').trim() ? { description: String(values.description).trim() } : {}),
  };
}

// ------------------------------------------------------------ kop
export const KOP_DEFAULTS = {
  layout: 'logo_left', companyName: '', headerLines: '', footerText: '', showPageNumber: true, accentColor: '#1A73E8',
};

export function kopValues(row, companyName) {
  const kop = row?.kop;
  if (!kop) return { ...KOP_DEFAULTS, companyName: companyName || '' };
  return {
    layout: kop.layout,
    companyName: kop.companyName,
    headerLines: kop.headerLines || '',
    footerText: kop.footerText || '',
    showPageNumber: kop.showPageNumber,
    accentColor: kop.accentColor,
  };
}

export function kopErrors(values, { hasLetterheadImage = false } = {}) {
  const errors = {};
  if (!String(values.companyName || '').trim()) errors.companyName = 'Nama perusahaan wajib diisi.';
  if (!/^#[0-9A-Fa-f]{6}$/.test(values.accentColor || '')) errors.accentColor = 'Warna berbentuk #RRGGBB.';
  if (values.layout === 'letterhead_image' && !hasLetterheadImage) errors.layout = 'Divisi ini belum punya gambar kop surat.';
  if (String(values.headerLines || '').split('\n').filter((l) => l.trim()).length > 6) errors.headerLines = 'Paling banyak 6 baris.';
  return errors;
}

/** logo: undefined = keep, null = remove, string = new (base64). */
export function kopBody(values, logo, version) {
  return {
    layout: values.layout,
    companyName: String(values.companyName).trim(),
    headerLines: String(values.headerLines || '').trim() || null,
    footerText: String(values.footerText || '').trim() || null,
    showPageNumber: Boolean(values.showPageNumber),
    accentColor: values.accentColor,
    ...(logo !== undefined ? { logoBase64: logo } : {}),
    ...(version ? { version } : {}),
  };
}

export const kopStatus = (row) => (row.kop ? 'Sudah diatur' : (row.departmentId == null ? 'Belum diatur' : 'Memakai kop perusahaan'));
export const scopeKey = (departmentId) => (departmentId == null ? 'company' : String(departmentId));

// ------------------------------------------------------------ BAST
export const TEAMS = [{ value: 'it', label: 'IT' }, { value: 'ga', label: 'GA' }];
export const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Sangat baik' },
  { value: 'good', label: 'Baik' },
  { value: 'fair', label: 'Cukup' },
  { value: 'poor', label: 'Kurang' },
  { value: 'broken', label: 'Rusak' },
];

/** The other team's PIC acknowledges by default (IT makes it → GA's PIC knows, and back). */
export function defaultAcknowledger(team, pic, myId) {
  const other = team === 'it' ? pic?.gaUserId : pic?.itUserId;
  return other && Number(other) !== Number(myId) ? String(other) : '';
}

export function bastBody(subject, kind, values) {
  const conditionLabel = CONDITION_OPTIONS.find((o) => o.value === values.conditionCode)?.label;
  const body = {
    kind,
    team: values.team,
    acknowledgerUserId: values.acknowledgerUserId ? Number(values.acknowledgerUserId) : null,
    accessories: String(values.accessories || '').trim() || null,
    condition: String(values.condition || '').trim() || conditionLabel || null,
    notes: String(values.notes || '').trim() || null,
  };
  if (subject === 'device' && kind === 'return' && values.conditionCode) body.conditionCode = values.conditionCode;
  if (subject === 'phone') {
    body.holderName = String(values.holderName || '').trim() || null;
    body.holderPosition = String(values.holderPosition || '').trim() || null;
    body.holderDivision = String(values.holderDivision || '').trim() || null;
  }
  return body;
}

export function bastErrors(subject, values) {
  const errors = {};
  if (!values.team) errors.team = 'Pilih tim petugas.';
  if (subject === 'phone' && !String(values.holderName || '').trim()) errors.holderName = 'Nama karyawan wajib diisi.';
  return errors;
}

export const BAST_TITLES = {
  device: { handover: 'Buat BAST serah terima perangkat', return: 'Buat BAST pengembalian perangkat' },
  phone: { handover: 'Buat BAST serah terima nomor', return: 'Buat BAST pengembalian nomor' },
};
