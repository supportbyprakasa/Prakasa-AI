// Forms Prakasa AI may fill (Wave C, docs/prakasa-ai-rencana.md §9.8). Pure
// functions and a small registry — no React, no DOM — so every rule is tested
// in node (test/aiFormModel.test.js).
//
// A page registers a form with usePrakasaAIForm (usePrakasaAIForm.jsx):
//   { id, title, permission, fields: [{ name, label, type, options?, required?,
//     aiFillable?, maxLength?, hint? }], getValues, setValues, validate?, initialValues? }
// The agent can then READ the form (describeForm) and SET values in it
// (fillForm) through the form's own state setter. That is all: nothing here
// can press a button, and a form is saved by the user.
//
// Rules of fillForm, in order, per field:
//   1. the field must be registered on this form;
//   2. it must be AI-fillable: never a secret (password, token, code), never
//      where money goes (payee bank account), never an approval decision, a
//      signature or a file upload, never a person's private data (NIK, salary,
//      home address …) or an infrastructure identifier (IP address, serial
//      number, licence key …) — by name, whatever the page says — and never a
//      field the page marked aiFillable: false;
//   3. a value the user typed is never overwritten: the field must be empty,
//      still at its initial value, or hold what the AI put there before;
//   4. the value must fit the field's type (number, date in WIB, time, an
//      option matched by its label, yes/no) and its maxLength;
//   5. the form's own validate(values) must accept the field.
// Everything refused is reported with its reason; nothing is silently changed.
//
// Wave C2a (§9.11) adds, under the same five rules:
//   rows      repeating line items ({ type: 'rows', columns, maxRows, allowAdd,
//             emptyRow, getRows?/setRows? }). The AI adds rows (replacing rows
//             that are still empty) and may replace rows it added itself; a row
//             the user entered is never changed and never removed. Every cell
//             passes rules 2, 4 and 5 like a field (a column named like a
//             secret, a bank account, a decision or an upload is refused).
//   lookup /  a record chosen through the page's OWN search ({ search: async
//   person    (text) => [{ value, label, hint }] }): the AI gives a text; the
//             value is set only when exactly one result is a confident match,
//             otherwise the candidates' labels go back so the AI can ask.
//   datetime, month, multiselect, number with min / max / step / currency.
//   mode: 'edit' + record: { type, id } — a form that edits an existing record.
//             Rule 3 is the same: a field still holding the loaded value may be
//             changed (and undone); one the user changed in this session may not.

export const FIELD_TYPES = Object.freeze(['text', 'textarea', 'number', 'date', 'time', 'datetime', 'month', 'select', 'multiselect', 'checkbox', 'radio', 'lookup', 'person', 'rows']);
export const DEFAULT_MAX_ROWS = 20;
export const MAX_ROWS = 50;
export const MAX_ROW_COLUMNS = 12;
export const MAX_CANDIDATES = 5;
export const MAX_LOOKUPS_PER_FILL = 12;
const MAX_SYNC_WAITS = 6;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

// Field names that are never the agent's. Same lists as the server's
// backend/src/services/ai/agent/fieldPolicy.js (a backend test compares them).
//   secret    passwords, tokens, codes — never even listed
//   userOnly  bank account, decision, signature, upload
//   personal  NIK, KTP, NPWP, BPJS, salary, birth date, home address, personal phone
//   infra     IP address, IMEI, MAC, serial number, licence key, portal, SSID / Wi-Fi, customer number
// Only 'open' may be filled or read. A name is read word by word (camelCase and
// snake_case segments), never by substring: `description` does not hold `ip`.
const SECRET_WORDS = new Set(['password', 'pass', 'passwd', 'sandi', 'secret', 'token', 'otp', 'pin', 'apikey', 'credential', 'credentials', 'kredensial', 'cvv']);
const USER_ONLY_WORDS = new Set(['bank', 'rekening', 'iban', 'swift', 'approval', 'approve', 'approved', 'approver', 'setujui', 'persetujuan', 'keputusan', 'decision',
  'signature', 'file', 'files', 'lampiran', 'attachment', 'attachments', 'upload', 'photo', 'foto']);
const USER_ONLY_PHRASE = /(^|_)(account|akun)_(number|no|name|holder)($|_)|(^|_)(nomor|no|nama)_rekening($|_)|(^|_)kata_sandi($|_)|(^|_)api_key($|_)|(^|_)tanda_tangan($|_)/;
const PERSONAL_WORDS = new Set(['nik', 'ktp', 'npwp', 'bpjs', 'gaji', 'salary', 'payroll', 'birth', 'birthday', 'birthdate', 'birthplace', 'lahir', 'dob']);
const PERSONAL_PHRASE = /(^|_)alamat_(rumah|tinggal|domisili)($|_)|(^|_)home_address($|_)|(^|_)(telepon|telp|phone|hp|mobile|nomor|no)_(pribadi|personal)($|_)|(^|_)(personal|private)_(phone|mobile|number|email)($|_)|(^|_)kartu_keluarga($|_)/;
const INFRA_WORDS = new Set(['ip', 'ipv4', 'ipv6', 'imei', 'mac', 'serial', 'ssid', 'wifi', 'portal']);
const INFRA_PHRASE = /(^|_)(nomor|no)_seri($|_)|(^|_)(license|licence|lisensi)_key($|_)|(^|_)kunci_lisensi($|_)|(^|_)customer_(number|no)($|_)|(^|_)(nomor|no|id)_pelanggan($|_)|(^|_)(nomor|no)_meter($|_)|(^|_)meter_(number|no)($|_)/;
// Names reviewed by hand that hold a word above but not the thing it guards (same list as the server).
const REVIEWED_OPEN = Object.freeze({ publicIpDedicated: true });
export const wordsOf = (name) => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// A word counts with or without a trailing number: `imei2`, `password2`, `phone1`.
const inSet = (words, set) => words.some((word) => set.has(word) || set.has(word.replace(/\d+$/, '')));
// 'secret' (never even listed) | 'userOnly' | 'personal' | 'infra' (listed, never filled, value never read) | 'open'
export function fieldClass(name) {
  const words = wordsOf(name);
  const joined = words.join('_');
  if (inSet(words, SECRET_WORDS) || /(^|_)kata_sandi($|_)|(^|_)api_key($|_)/.test(joined)) return 'secret';
  if (Object.prototype.hasOwnProperty.call(REVIEWED_OPEN, String(name))) return 'open';
  if (inSet(words, USER_ONLY_WORDS) || USER_ONLY_PHRASE.test(joined)) return 'userOnly';
  if (inSet(words, PERSONAL_WORDS) || PERSONAL_PHRASE.test(joined)) return 'personal';
  if (inSet(words, INFRA_WORDS) || INFRA_PHRASE.test(joined)) return 'infra';
  return 'open';
}

// Names that hold rupiah (same list as the server). The server's catalog
// decides which form may have such a field filled; here it guards the fields
// whose names come from data (dynamicFieldFillable).
const MONEY_WORDS = new Set(['amount', 'price', 'harga', 'nominal', 'subtotal', 'tax', 'pajak', 'diskon', 'discount', 'budget', 'anggaran', 'biaya', 'cost', 'rupiah',
  'dpp', 'ppn', 'omzet', 'revenue', 'margin', 'salary', 'gaji', 'spend', 'belanja', 'nilai', 'tarif', 'fee', 'hpp', 'cogs']);
const NOT_MONEY = Object.freeze({ usageAmount: true });
export const moneyLike = (name) => !Object.prototype.hasOwnProperty.call(NOT_MONEY, String(name)) && inSet(wordsOf(name), MONEY_WORDS);

// A field whose NAME comes from data (a document template's placeholder): may
// the AI fill it? Only a well-formed, open name that holds no rupiah, on a
// text, textarea or date field, and never a phone number of any kind — the
// server applies the same rule (fieldPolicy.js dynamicFieldFillable).
export const DYNAMIC_TYPES = Object.freeze(['text', 'textarea', 'date']);
const DYNAMIC_REFUSED_WORDS = new Set(['telepon', 'telp', 'phone', 'hp', 'handphone', 'ponsel', 'mobile', 'wa', 'whatsapp']);
export const validFieldName = (name) => /^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(String(name || ''));
export function dynamicFieldFillable(name, type = 'text') {
  if (!validFieldName(name)) return false;
  return fieldClass(name) === 'open' && !moneyLike(name) && !inSet(wordsOf(name), DYNAMIC_REFUSED_WORDS) && DYNAMIC_TYPES.includes(type);
}

export const REASONS = Object.freeze({
  unknown: 'Kolom ini tidak ada di formulir.',
  userOnly: 'Kolom ini hanya diisi pengguna.',
  userValue: 'Sudah diisi pengguna.',
  required: 'Kolom ini wajib diisi.',
  number: 'Isi harus berupa angka.',
  date: 'Tanggal tidak dikenali. Pakai format YYYY-MM-DD.',
  time: 'Jam tidak dikenali. Pakai format JJ:MM.',
  option: 'Pilihan itu tidak ada di kolom ini.',
  yesNo: 'Isi dengan "ya" atau "tidak".',
  readOnly: 'Kolom ini tidak bisa diubah.',
  dateTime: 'Tanggal dan jam tidak dikenali. Pakai format YYYY-MM-DD JJ:MM.',
  month: 'Bulan tidak dikenali. Pakai format YYYY-MM.',
  notRows: 'Kolom ini bukan daftar baris. Isi dengan "isi".',
  needRows: 'Kolom ini daftar baris. Isi dengan "baris".',
  emptyRow: 'Baris ini tidak punya isi yang bisa dipakai.',
  noAdd: 'Formulir ini tidak mengizinkan baris baru.',
  lookupNone: 'Tidak ditemukan. Tanyakan nama yang benar ke pengguna.',
  lookupMany: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.',
  lookupLoose: 'Tidak ada yang cocok persis. Tanyakan ke pengguna yang dimaksud.',
  lookupFailed: 'Pencarian di halaman gagal atau terlalu lama. Pengguna bisa memilihnya sendiri.',
  lookupTooMany: 'Terlalu banyak pencarian dalam satu kali isi. Isi sisanya di panggilan berikutnya.',
  lookupShort: 'Teks pencarian terlalu pendek.',
  noRecord: 'Formulir ubah ini tidak menyebut data yang diubah.',
});

// ---------------------------------------------------------------- values

const WIB_OFFSET_MS = 7 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');
// Today in WIB (UTC+7, no daylight saving), as YYYY-MM-DD.
export function wibToday(now = Date.now()) {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400e3).toISOString().slice(0, 10);
const MONTHS = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, nopember: 11, des: 12, desember: 12, dec: 12, december: 12,
};
const RELATIVE_DAYS = { 'hari ini': 0, today: 0, sekarang: 0, besok: 1, tomorrow: 1, lusa: 2, kemarin: -1, yesterday: -1 };
function validDay(year, month, day) {
  if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
// A date as the browser's date field holds it (YYYY-MM-DD), read in WIB.
export function parseDate(raw, now = Date.now()) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;
  if (value in RELATIVE_DAYS) return addDays(wibToday(now), RELATIVE_DAYS[value]);
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  // A moment with a time and zone: the WIB day it falls on.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(value)) {
    const at = Date.parse(String(raw).trim());
    return Number.isFinite(at) ? wibToday(at) : null;
  }
  m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // Indonesian order: day, month, year
  if (m) return validDay(Number(m[3]), Number(m[2]), Number(m[1]));
  m = value.match(/^(\d{1,2}) ([a-z]+)\.? (\d{4})$/);
  if (m && MONTHS[m[2]]) return validDay(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  return null;
}

// "9", "9.30", "09:30", "9:30 WIB" → "09:30".
export function parseTime(raw) {
  const m = String(raw ?? '').trim().toLowerCase().replace(/\s*wib$/, '').match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  return hour <= 23 && minute <= 59 ? `${pad(hour)}:${pad(minute)}` : null;
}

// A moment as a datetime-local field holds it (YYYY-MM-DDTHH:MM), in WIB:
// "2026-10-05 14:00", "2026-10-05T14:00", "besok 09.30", "5 Oktober 2026 jam 14",
// or a moment with a zone ("2026-10-05T07:00:00Z" → 14:00 WIB).
export function parseDateTime(raw, now = Date.now()) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const at = Date.parse(value);
    return Number.isFinite(at) ? new Date(at + WIB_OFFSET_MS).toISOString().slice(0, 16) : null;
  }
  const m = value.toLowerCase().replace(/\s+/g, ' ').match(/^(.+?)(?:t|,? (?:jam |pukul )?)(\d{1,2}(?:[:.]\d{2})?)(?::\d{2})?(?: wib)?$/);
  if (!m) return null;
  const day = parseDate(m[1], now);
  const time = parseTime(m[2]);
  return day && time ? `${day}T${time}` : null;
}

// A month as a month field holds it (YYYY-MM): "2026-10", "10/2026",
// "Oktober 2026", "bulan ini", "bulan depan", or any date in that month.
export function parseMonth(raw, now = Date.now()) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;
  const valid = (year, month) => (year >= 1900 && year <= 2200 && month >= 1 && month <= 12 ? `${year}-${pad(month)}` : null);
  const shift = { 'bulan ini': 0, 'this month': 0, 'bulan depan': 1, 'next month': 1, 'bulan lalu': -1, 'last month': -1 };
  if (value in shift) {
    const [year, month] = wibToday(now).split('-').map(Number);
    const index = year * 12 + (month - 1) + shift[value];
    return valid(Math.floor(index / 12), (index % 12) + 1);
  }
  let m = value.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]));
  m = value.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) return valid(Number(m[2]), Number(m[1]));
  m = value.match(/^([a-z]+)\.? (\d{4})$/);
  if (m && MONTHS[m[1]]) return valid(Number(m[2]), MONTHS[m[1]]);
  const day = parseDate(value, now);
  return day ? day.slice(0, 7) : null;
}

// "250000", "250.000", "Rp 1.250.000,50", "1,5" → the plain number as text
// (form state holds what a number input would hold). Indonesian separators.
export function parseNumber(raw) {
  let value = String(raw ?? '').trim().replace(/^rp\.?\s*/i, '').replace(/\s+/g, '');
  if (!value || !/^-?[\d.,]+$/.test(value)) return null;
  const dots = (value.match(/\./g) || []).length;
  const commas = (value.match(/,/g) || []).length;
  if (commas > 1 && dots === 0 && /^-?\d{1,3}(,\d{3})+$/.test(value)) value = value.replace(/,/g, ''); // 1,250,000
  else if (commas === 1) value = value.replace(/\./g, '').replace(',', '.'); // 1.250.000,50 · 1,5
  else if (commas === 0 && (dots > 1 || /^-?\d{1,3}\.\d{3}$/.test(value))) value = value.replace(/\./g, ''); // 1.250.000 · 250.000
  else if (commas > 1) return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
}

const YES = new Set(['ya', 'iya', 'y', 'yes', 'true', '1', 'benar', 'centang', 'aktif', 'on']);
const NO = new Set(['tidak', 'tdk', 'bukan', 't', 'no', 'n', 'false', '0', 'salah', 'kosong', 'nonaktif', 'off']);
export function parseYesNo(raw) {
  if (typeof raw === 'boolean') return raw;
  const value = String(raw ?? '').trim().toLowerCase();
  if (YES.has(value)) return true;
  if (NO.has(value)) return false;
  return null;
}

const plain = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The option the AI means: its label (as shown to the user) or its value, then
// a label that starts with or contains the text — only when exactly one does.
export function matchOption(options, raw) {
  const list = (options || []).filter((option) => option && !option.disabled);
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const exact = list.find((option) => String(option.value) === text)
    || list.find((option) => plain(option.label) === plain(text))
    || list.find((option) => plain(option.value) === plain(text));
  if (exact) return exact;
  const wanted = plain(text);
  if (!wanted) return null;
  for (const test of [(label) => label.startsWith(wanted), (label) => label.includes(wanted)]) {
    const hits = list.filter((option) => test(plain(option.label)));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

// "Kertas A4; Spidol" (or one per line; a comma works when no label holds one)
// → the options meant, by label. One unknown choice refuses the whole value.
function matchOptions(options, raw) {
  const text = String(raw ?? '').trim();
  let parts = null;
  if (text.startsWith('[')) {
    try { const list = JSON.parse(text); if (Array.isArray(list)) parts = list.map((item) => String(item ?? '')); } catch { /* not a list: read as text */ }
  }
  if (!parts) parts = /[;\n]/.test(text) ? text.split(/[;\n]/) : (matchOption(options, text) ? [text] : text.split(','));
  const found = [];
  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    const option = matchOption(options, part);
    if (!option) return { ok: false, alasan: `Pilihan "${part.slice(0, 60)}" tidak ada di kolom ini.` };
    if (!found.some((value) => same(value, option.value))) found.push(option.value);
  }
  return { ok: true, value: found };
}

const plainNumber = (value) => String(Number(value));
function fitNumber(field, value) {
  const number = Number(value);
  if (field.min !== null && number < field.min) return `Paling kecil ${plainNumber(field.min)}.`;
  if (field.max !== null && number > field.max) return `Paling besar ${plainNumber(field.max)}.`;
  if (field.step !== null) {
    const steps = (number - (field.min ?? 0)) / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return field.step === 1 ? 'Isi harus bilangan bulat.' : `Isi harus kelipatan ${plainNumber(field.step)}.`;
  }
  return null;
}

// The proposed text as the form's state holds it, or the reason it is refused.
// (lookup / person values come from the page's search: resolveLookups.)
export function coerceValue(field, raw, { now = Date.now() } = {}) {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const empty = text.trim() === '';
  if (empty && field.type !== 'checkbox') {
    if (field.required) return { ok: false, alasan: REASONS.required };
    return { ok: true, value: field.type === 'multiselect' ? [] : '' };
  }
  switch (field.type) {
    case 'number': {
      const value = parseNumber(text);
      if (value === null) return { ok: false, alasan: REASONS.number };
      const unfit = fitNumber({ min: null, max: null, step: null, ...field }, value);
      return unfit ? { ok: false, alasan: unfit } : { ok: true, value };
    }
    case 'date': {
      const value = parseDate(text, now);
      return value ? { ok: true, value } : { ok: false, alasan: REASONS.date };
    }
    case 'time': {
      const value = parseTime(text);
      return value ? { ok: true, value } : { ok: false, alasan: REASONS.time };
    }
    case 'datetime': {
      const value = parseDateTime(text, now);
      return value ? { ok: true, value } : { ok: false, alasan: REASONS.dateTime };
    }
    case 'month': {
      const value = parseMonth(text, now);
      return value ? { ok: true, value } : { ok: false, alasan: REASONS.month };
    }
    case 'select':
    case 'radio': {
      const option = matchOption(field.options, text);
      if (!option) return { ok: false, alasan: REASONS.option };
      return { ok: true, value: field.type === 'select' ? String(option.value) : option.value };
    }
    case 'multiselect': {
      const picked = matchOptions(field.options, text);
      if (picked.ok && field.required && !picked.value.length) return { ok: false, alasan: REASONS.required };
      return picked;
    }
    case 'checkbox': {
      const value = parseYesNo(raw);
      return value === null ? { ok: false, alasan: REASONS.yesNo } : { ok: true, value };
    }
    case 'lookup':
    case 'person':
    case 'rows':
      return { ok: false, alasan: REASONS.lookupFailed };
    default: {
      const value = field.type === 'textarea' ? text.replace(/\r\n/g, '\n').trim() : text.replace(/\s+/g, ' ').trim();
      if (field.maxLength && value.length > field.maxLength) return { ok: false, alasan: `Paling banyak ${field.maxLength} karakter.` };
      return { ok: true, value };
    }
  }
}

// ---------------------------------------------------------------- lookups

const short = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// A person is shown with a work contact only: a long run of digits (a phone
// number, an ID number) never leaves the page.
const withoutNumbers = (value) => value.replace(/\+?\d[\d\s().-]{6,}\d/g, '').replace(/\s+/g, ' ').trim();
const candidateText = (option) => (option.hint ? `${option.label} — ${option.hint}` : option.label);

function cleanResults(field, results) {
  const list = [];
  for (const item of Array.isArray(results) ? results.slice(0, 50) : []) {
    if (!item || item.value === undefined || item.value === null || item.disabled) continue;
    const label = short(item.label);
    if (!label) continue;
    const hint = field.type === 'person' ? withoutNumbers(short(item.hint)) : short(item.hint);
    list.push({ value: item.value, label, hint });
  }
  return list;
}

// The one record the text means, among what the page's search returned:
//   - exactly one result whose label (or hint: a code, a plate number) IS the text; or
//   - exactly one result that holds every word of the text.
// Anything else is not set: the candidates (labels the page would show, at most
// MAX_CANDIDATES) go back so the AI can ask the user. The option's value never
// leaves the page.
export function pickLookup(field, text, results) {
  const list = cleanResults(field, results);
  if (!list.length) return { ok: false, alasan: REASONS.lookupNone };
  const wanted = plain(text);
  const many = (hits, alasan) => ({ ok: false, alasan, kandidat: hits.slice(0, MAX_CANDIDATES).map(candidateText) });
  const exact = list.filter((option) => plain(option.label) === wanted || (option.hint && plain(option.hint) === wanted));
  if (exact.length === 1) return { ok: true, value: exact[0].value, label: exact[0].label };
  if (exact.length > 1) return many(exact, REASONS.lookupMany);
  const words = wanted.split(' ').filter(Boolean);
  const holding = words.length ? list.filter((option) => { const hay = ` ${plain(`${option.label} ${option.hint}`)} `; return words.every((word) => hay.includes(word)); }) : [];
  if (holding.length === 1) return { ok: true, value: holding[0].value, label: holding[0].label };
  if (holding.length > 1) return many(holding, REASONS.lookupMany);
  return many(list, REASONS.lookupLoose);
}

const cellKey = (name, rowNo, column) => `${name}[${rowNo}].${column}`;
const isLookup = (field) => field && (field.type === 'lookup' || field.type === 'person');
const timeout = (ms, sleep) => sleep(ms).then(() => { throw new Error('timeout'); });
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Runs the page's own search for every lookup / person value in `isian`, one
// after another. Returns Map(key → { ok, value, label } | { ok: false, alasan,
// kandidat? }); key = field name, or "rows[2].column" for a cell. Fields that
// would be refused anyway (not registered, not fillable, typed by the user) are
// not searched.
export async function resolveLookups(entry, isian, { searchMs = 6000, budgetMs = 20000, sleep = wait, clock = () => Date.now() } = {}) {
  const { values, initial, byName } = formState(entry);
  const jobs = [];
  for (const item of Array.isArray(isian) ? isian : []) {
    const name = String(item?.kolom ?? item?.nama ?? '');
    const field = byName.get(name);
    if (!field || !field.aiFillable) continue;
    if (field.type === 'rows') {
      (Array.isArray(item?.baris) ? item.baris : []).slice(0, MAX_ROWS).forEach((row, index) => {
        for (const column of field.columns) {
          if (isLookup(column) && column.aiFillable && row && typeof row === 'object' && column.name in row) jobs.push({ key: cellKey(name, index + 1, column.name), field: column, text: row[column.name] });
        }
      });
    } else if (isLookup(field) && userMayBeOverwritten(entry, field, values, initial)) {
      jobs.push({ key: name, field, text: item?.isi ?? item?.nilai });
    }
  }
  const found = new Map();
  const started = clock();
  let searched = 0;
  for (const job of jobs) {
    const text = short(job.text, 80);
    if (!text) { found.set(job.key, job.field.required ? { ok: false, alasan: REASONS.required } : { ok: true, value: job.field.emptyValue, label: '' }); continue; }
    if (plain(text).length < 2) { found.set(job.key, { ok: false, alasan: REASONS.lookupShort }); continue; }
    if (searched >= MAX_LOOKUPS_PER_FILL) { found.set(job.key, { ok: false, alasan: REASONS.lookupTooMany }); continue; }
    if (clock() - started >= budgetMs) { found.set(job.key, { ok: false, alasan: REASONS.lookupFailed }); continue; }
    searched += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.race([Promise.resolve(job.field.search(text)), timeout(searchMs, sleep)]);
      found.set(job.key, pickLookup(job.field, text, results));
    } catch {
      found.set(job.key, { ok: false, alasan: REASONS.lookupFailed });
    }
  }
  return found;
}

// ---------------------------------------------------------------- registry

// Values are compared as the form holds them: text and numbers by their text,
// lists and records (multiselect, rows, a lookup's opaque value) by content.
function stable(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}
const same = (a, b) => stable(a) === stable(b);
const isEmpty = (value) => value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
const finite = (value) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

function cleanField(field, { inRow = false } = {}) {
  if (!field || !NAME.test(String(field.name || '')) || !FIELD_TYPES.includes(field.type)) return null;
  if (inRow && field.type === 'rows') return null;
  const kind = fieldClass(field.name);
  const cleaned = {
    name: field.name,
    label: String(field.label || field.name),
    type: field.type,
    required: field.required === true,
    options: Array.isArray(field.options) ? field.options.filter((o) => o && o.label !== undefined).map((o) => ({ value: o.value, label: String(o.label), disabled: Boolean(o.disabled) })) : null,
    maxLength: Number.isInteger(field.maxLength) && field.maxLength > 0 ? field.maxLength : null,
    hint: field.hint ? String(field.hint) : null,
    kind,
    readOnly: field.readOnly === true,
    aiFillable: kind === 'open' && field.aiFillable !== false && field.readOnly !== true,
  };
  if (field.type === 'number') {
    cleaned.min = finite(field.min);
    cleaned.max = finite(field.max);
    cleaned.step = finite(field.step) > 0 ? finite(field.step) : null;
    cleaned.currency = field.currency === true || field.currency === 'IDR';
  }
  if (isLookup(field)) {
    cleaned.search = typeof field.search === 'function' ? field.search : null;
    cleaned.labelOf = typeof field.labelOf === 'function' ? field.labelOf : null;
    cleaned.emptyValue = field.emptyValue === undefined ? '' : field.emptyValue;
    if (!cleaned.search) cleaned.aiFillable = false;
  }
  if (field.type === 'rows') {
    cleaned.columns = (Array.isArray(field.columns) ? field.columns : []).slice(0, MAX_ROW_COLUMNS).map((column) => cleanField(column, { inRow: true })).filter(Boolean);
    cleaned.maxRows = Math.min(MAX_ROWS, Number.isInteger(field.maxRows) && field.maxRows > 0 ? field.maxRows : DEFAULT_MAX_ROWS);
    cleaned.allowAdd = field.allowAdd !== false;
    cleaned.emptyRow = typeof field.emptyRow === 'function' ? field.emptyRow : null;
    cleaned.isEmptyRow = typeof field.isEmptyRow === 'function' ? field.isEmptyRow : null;
    cleaned.getRows = typeof field.getRows === 'function' ? field.getRows : null;
    cleaned.setRows = typeof field.setRows === 'function' ? field.setRows : null;
    if (!cleaned.columns.some((column) => column.aiFillable)) cleaned.aiFillable = false;
  }
  return cleaned;
}

// The form as it is right now (the page's config is read on every use: its
// fields, options and values change as the user works). Rows a form keeps
// outside its values (getRows) are read into `values` under the field's name.
//
// A fill goes through the form's own state setter, and React commits it a
// moment later. Until the form has shown it (mark.seen), the registry's own
// record of that fill is the latest value: a read in the same tick as the fill
// sees what the AI set, not what was there before. `raw: true` skips that —
// for the code that watches the form's state arrive (syncForm, undoFill).
export function formState(entry, { raw = false } = {}) {
  const config = entry.getConfig() || {};
  const fields = (config.fields || []).map((field) => cleanField(field)).filter(Boolean);
  const values = { ...((typeof config.getValues === 'function' ? config.getValues() : null) || {}) };
  for (const field of fields) if (field.type === 'rows' && field.getRows) values[field.name] = field.getRows();
  const committed = { ...values };
  if (!raw && entry.filled) {
    for (const [name, mark] of entry.filled) if (!mark.seen && same(values[name], mark.before)) values[name] = mark.value;
  }
  const initial = config.initialValues || entry.snapshot || {};
  return { config, fields, values, committed, initial, byName: new Map(fields.map((field) => [field.name, field])) };
}

// A patch goes through the form's own setter; rows with their own state through setRows.
function applyPatch({ config, byName }, patch) {
  const rest = {};
  for (const [name, value] of Object.entries(patch)) {
    const field = byName.get(name);
    if (field?.type === 'rows' && field.setRows) field.setRows(value);
    else rest[name] = value;
  }
  if (Object.keys(rest).length && typeof config.setValues === 'function') config.setValues(rest);
}

// A form's permission: one code, or a list that means "any of".
export const permissionList = (permission) => {
  const list = Array.isArray(permission) ? permission : [permission];
  return list.length && list.length <= 4 && list.every((code) => typeof code === 'string' && /^[a-z_]+(\.[a-z_]+)+$/.test(code)) ? list : [];
};

// { type, id } of the record an edit form changes — for the audit, never a value.
export function recordOf(config) {
  if (config?.mode !== 'edit') return null;
  const type = String(config.record?.type || '');
  const id = config.record?.id;
  // Up to 100 characters: a recurring Google Calendar event id is longer than 40 (the server allows the same).
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(type) || !['string', 'number'].includes(typeof id) || !/^[A-Za-z0-9_-]{1,100}$/.test(String(id))) return null;
  return { type, id: String(id) };
}

export function createFormRegistry() {
  const forms = new Map();
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    // getConfig() → the page's current { title, permission, fields, getValues, setValues, validate?, initialValues?, mode?, record? }
    register(id, getConfig) {
      if (!NAME.test(String(id || ''))) throw new Error('usePrakasaAIForm: id formulir tidak valid');
      const config = getConfig() || {};
      const entry = {
        id,
        getConfig,
        // name → { value: what the AI set, previous: what was there before its first fill,
        //          before: what was there when this fill was asked, seen: the form shows it,
        //          label?: a lookup's label, signatures?: the rows the AI added (rows fields) }
        filled: new Map(),
        snapshot: {},
        // The page's own reset on open runs after it registers: the first sync takes the values again.
        snapshotPending: true,
        noticeDismissed: false,
        version: 0,
      };
      entry.snapshot = { ...formState({ ...entry, getConfig: () => config }).values };
      forms.set(id, entry);
      notify();
      return () => {
        if (forms.get(id) === entry) { forms.delete(id); notify(); }
      };
    },
    get: (id) => forms.get(id) || null,
    list: () => [...forms.values()],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify,
  };
}

function touch(entry, registry) {
  entry.version += 1;
  registry?.notify();
}

// ---------------------------------------------------------------- rows

const rowsOf = (values, field) => (Array.isArray(values[field.name]) ? values[field.name] : []);
const signature = (field, row) => JSON.stringify(field.columns.map((column) => stable(row?.[column.name])));
function emptyRowOf(field, row) {
  if (field.isEmptyRow) return field.isEmptyRow(row) === true;
  const blank = (field.emptyRow && field.emptyRow()) || {};
  return field.columns.every((column) => isEmpty(row?.[column.name]) || same(row?.[column.name], blank[column.name]));
}
// Which of `rows` are the AI's: a row counts while it still holds exactly what the AI put in it.
function aiRowIndexes(field, rows, mark) {
  const left = [...(mark?.signatures || [])];
  const indexes = new Set();
  rows.forEach((row, index) => {
    const at = left.indexOf(signature(field, row));
    if (at >= 0) { left.splice(at, 1); indexes.add(index); }
  });
  return indexes;
}

// The AI's rows for one rows field → the rows the form would hold, or nothing to set.
function fillRows(field, item, { values, mark, lookups, now, ditolak }) {
  const name = field.name;
  const asked = (Array.isArray(item?.baris) ? item.baris : []).slice(0, MAX_ROWS);
  const current = rowsOf(values, field);
  const owned = aiRowIndexes(field, current, mark);
  const replace = item?.cara === 'ganti';
  const byColumn = new Map(field.columns.map((column) => [column.name, column]));
  const accepted = [];
  asked.forEach((raw, index) => {
    const rowNo = index + 1;
    const cells = {};
    let usable = raw && typeof raw === 'object' && !Array.isArray(raw);
    for (const [columnName, rawValue] of usable ? Object.entries(raw) : []) {
      const column = byColumn.get(columnName);
      const key = cellKey(name, rowNo, columnName);
      if (!column) { ditolak.push({ nama: key, alasan: fieldClass(columnName) === 'open' ? REASONS.unknown : REASONS.userOnly }); continue; }
      if (!column.aiFillable) { ditolak.push({ nama: key, alasan: column.readOnly ? REASONS.readOnly : REASONS.userOnly }); continue; }
      const coerced = isLookup(column) ? (lookups?.get(key) || { ok: false, alasan: REASONS.lookupFailed }) : coerceValue(column, rawValue, { now });
      if (!coerced.ok) {
        ditolak.push({ nama: key, alasan: coerced.alasan, ...(coerced.kandidat ? { kandidat: coerced.kandidat } : {}) });
        if (column.required) usable = false;
        continue;
      }
      cells[columnName] = coerced.value;
    }
    if (!usable) { if (!raw || typeof raw !== 'object') ditolak.push({ nama: `${name}[${rowNo}]`, alasan: REASONS.emptyRow }); return; }
    const missing = field.columns.find((column) => column.required && column.aiFillable && isEmpty(cells[column.name]));
    if (missing) { ditolak.push({ nama: `${name}[${rowNo}]`, alasan: `Kolom "${missing.label}" wajib diisi di tiap baris.` }); return; }
    if (!Object.values(cells).some((value) => !isEmpty(value) && value !== false)) { ditolak.push({ nama: `${name}[${rowNo}]`, alasan: REASONS.emptyRow }); return; }
    accepted.push(cells);
  });
  if (!accepted.length) return null;

  const blank = () => (field.emptyRow && field.emptyRow()) || {};
  let next;
  let added;
  if (field.allowAdd) {
    // Rows the user entered stay, in place; rows still empty make room; the
    // AI's own earlier rows stay too unless it asked to replace them.
    const kept = current.filter((row, index) => !emptyRowOf(field, row) && !(replace && owned.has(index)));
    const room = Math.max(0, field.maxRows - kept.length);
    added = accepted.slice(0, room).map((cells) => ({ ...blank(), ...cells }));
    if (accepted.length > room) ditolak.push({ nama: name, alasan: `Paling banyak ${field.maxRows} baris; ${accepted.length - room} baris tidak ditambahkan.` });
    next = [...kept, ...added];
  } else {
    // A fixed list: only rows that are still empty (or the AI's own, when replacing) take a value.
    const queue = [...accepted];
    added = [];
    next = current.map((row, index) => {
      if (!queue.length || !(emptyRowOf(field, row) || (replace && owned.has(index)))) return row;
      const filled = { ...row, ...queue.shift() };
      added.push(filled);
      return filled;
    });
    if (queue.length) ditolak.push({ nama: name, alasan: `${REASONS.noAdd} ${queue.length} baris tidak dipakai.` });
  }
  if (!added.length) return null;
  const stillOwned = replace ? [] : current.filter((row, index) => owned.has(index)).map((row) => signature(field, row));
  return { next, added: added.length, signatures: [...stillOwned, ...added.map((row) => signature(field, row))] };
}

// "Urungkan" for a rows field: the AI's rows go, the user's stay.
function undoRows(field, current, mark) {
  const owned = aiRowIndexes(field, current, mark);
  if (!owned.size) return null;
  if (!field.allowAdd) {
    const blank = (field.emptyRow && field.emptyRow()) || {};
    return current.map((row, index) => (owned.has(index) ? { ...row, ...Object.fromEntries(field.columns.map((column) => [column.name, blank[column.name] ?? ''])) } : row));
  }
  const left = current.filter((row, index) => !owned.has(index));
  if (left.length) return left;
  const before = (Array.isArray(mark.previous) ? mark.previous : []).filter((row) => emptyRowOf(field, row));
  return before.length ? before : (field.emptyRow ? [field.emptyRow()] : []);
}

// ---------------------------------------------------------------- marks

// Called after every render of the form: a field the user edited loses its
// "diisi AI" mark; so does a row. Returns true when something changed.
export function syncForm(entry, registry = null) {
  const { values, byName } = formState(entry, { raw: true });
  let changed = false;
  if (entry.snapshotPending) {
    entry.snapshotPending = false;
    if (!entry.filled.size) entry.snapshot = { ...values };
  }
  for (const [name, mark] of entry.filled) {
    if (same(values[name], mark.value)) { mark.seen = true; continue; }
    // Not rendered yet: the form's state update for this fill is still on its way.
    // (A form that never takes the value — its setter ignored it — loses the mark after a few renders.)
    if (!mark.seen && same(values[name], mark.before)) {
      mark.waits = (mark.waits || 0) + 1;
      if (mark.waits <= MAX_SYNC_WAITS) continue;
      entry.filled.delete(name);
      changed = true;
      continue;
    }
    const field = byName.get(name);
    if (mark.signatures && field?.type === 'rows') {
      // The rows changed: the AI's rows that are still as it left them keep their mark.
      const rows = rowsOf(values, field);
      const owned = aiRowIndexes(field, rows, mark);
      mark.seen = true;
      mark.value = rows;
      if (owned.size) {
        if (owned.size !== mark.signatures.length) { mark.signatures = rows.filter((row, index) => owned.has(index)).map((row) => signature(field, row)); changed = true; }
        continue;
      }
    }
    entry.filled.delete(name);
    changed = true;
  }
  if (changed) touch(entry, registry);
  return changed;
}

export const filledNames = (entry) => [...entry.filled.keys()];

// How much the AI filled, for the notice: fields, and rows in rows fields.
export function filledCount(entry) {
  let fields = 0;
  let rows = 0;
  for (const mark of entry.filled.values()) {
    if (mark.signatures) rows += mark.signatures.length;
    else fields += 1;
  }
  return { fields, rows };
}

// Is row `index` of rows field `name` one the AI added (and the user has not touched)?
export function isRowFilled(entry, name, index) {
  const mark = entry.filled.get(name);
  if (!mark?.signatures) return false;
  const { values, byName } = formState(entry);
  const field = byName.get(name);
  return field?.type === 'rows' ? aiRowIndexes(field, rowsOf(values, field), mark).has(index) : false;
}

// Unsaved changes in the form: by the user or by the AI.
export function isDirty(entry) {
  const { fields, values, initial } = formState(entry);
  return fields.some((field) => {
    // Rows a form keeps outside its values have no initial value: any row with content counts.
    if (field.type === 'rows' && initial[field.name] === undefined) return rowsOf(values, field).some((row) => !emptyRowOf(field, row));
    return !same(values[field.name], initial[field.name]);
  });
}

// The registered forms that hold unsaved input and that an opener must not
// replace (useOpenFromUrl `keepUnsaved`). `keep`: true = any form on the page
// (a page whose forms are all dialogs); a list of form ids = only those forms
// (a page that also has a form in the page itself, such as a comment box: an
// unsaved comment does not stop a dialog from opening); anything else = none.
export function unsavedForms(entries, keep = true) {
  if (keep !== true && !Array.isArray(keep)) return [];
  const only = Array.isArray(keep) ? new Set(keep.map(String)) : null;
  return (entries || []).filter((entry) => (!only || only.has(String(entry.id))) && isDirty(entry));
}

// Rule 3: may the AI set this field? It is empty, still holds its initial
// (create) or loaded (edit) value, or holds what the AI put there.
function userMayBeOverwritten(entry, field, values, initial) {
  const current = values[field.name];
  const mark = entry.filled.get(field.name);
  const aiOwned = Boolean(mark) && (same(mark.value, current) || (!mark.seen && same(mark.before, current)));
  return isEmpty(current) || aiOwned || same(current, initial[field.name]);
}

function shown(field, value, mark) {
  if (typeof value === 'boolean') return value;
  if (isLookup(field)) {
    if (isEmpty(value)) return '';
    if (mark && same(mark.value, value) && mark.label) return mark.label;
    return field.labelOf ? short(field.labelOf(value)) : '(sudah dipilih)';
  }
  if (field.type === 'multiselect') {
    return (Array.isArray(value) ? value : []).map((item) => field.options?.find((o) => same(o.value, item))?.label ?? String(item)).join('; ');
  }
  const option = field.options ? field.options.find((o) => same(o.value, value)) : null;
  return option ? option.label : String(value ?? '');
}

function describeField(field) {
  const item = { nama: field.name, label: field.label, jenis: field.type, wajib: field.required, bisa_diisi: field.aiFillable };
  if (field.options) item.pilihan = field.options.filter((o) => !o.disabled).map((o) => o.label);
  if (field.maxLength) item.maks = field.maxLength;
  if (field.hint) item.petunjuk = field.hint;
  if (field.type === 'number') {
    if (field.min !== null) item.min = field.min;
    if (field.max !== null) item.maks_angka = field.max;
    if (field.step !== null) item.kelipatan = field.step;
    if (field.currency) item.mata_uang = 'rupiah';
  }
  if (field.readOnly && field.kind === 'open') item.hanya_baca = true;
  return item;
}

// What baca_formulir returns for one form. Secret fields are left out; fields
// only the user fills are listed without their value.
export function describeForm(entry) {
  const { config, fields, values, initial } = formState(entry);
  const kolom = [];
  for (const field of fields) {
    if (field.kind === 'secret') continue;
    const item = describeField(field);
    const mark = entry.filled.get(field.name);
    if (field.type === 'rows') {
      const columns = field.columns.filter((column) => column.kind !== 'secret');
      item.maks_baris = field.maxRows;
      item.boleh_tambah = field.allowAdd;
      item.kolom_baris = columns.map(describeField);
      if (field.aiFillable) {
        const rows = rowsOf(values, field);
        const owned = aiRowIndexes(field, rows, mark);
        item.baris = [];
        rows.forEach((row, index) => {
          if (emptyRowOf(field, row) || item.baris.length >= MAX_ROWS) return;
          const isi = {};
          for (const column of columns) if (column.kind === 'open' && (column.aiFillable || column.readOnly)) isi[column.name] = shown(column, row?.[column.name], null);
          item.baris.push({ no: index + 1, isi, ...(owned.has(index) ? { diisi_ai: true } : { diisi_pengguna: true }) });
        });
      }
      kolom.push(item);
      continue;
    }
    if (field.aiFillable || (field.readOnly && field.kind === 'open')) {
      const current = values[field.name];
      item.isi = shown(field, current, mark);
      const byAi = Boolean(mark) && same(mark.value, current);
      if (byAi) item.diisi_ai = true;
      else if (field.aiFillable && !isEmpty(current) && !same(current, initial[field.name])) item.diisi_pengguna = true;
    }
    kolom.push(item);
  }
  const record = recordOf(config);
  return {
    id: entry.id,
    judul: String(config.title || entry.id),
    izin: permissionList(config.permission).length ? (Array.isArray(config.permission) ? permissionList(config.permission) : config.permission) : null,
    ...(config.mode === 'edit' ? { mode: 'ubah', rekaman: record ? { jenis: record.type, id: record.id } : null } : {}),
    belum_disimpan: isDirty(entry),
    kolom,
  };
}

// isian: [{ kolom, isi }] or, for a rows field, [{ kolom, baris: [{ column: text }], cara?: 'tambah' | 'ganti' }].
// `lookups`: what resolveLookups found for the lookup / person values (fillFormAsync does both).
// Returns { diisi: [names], ditolak: [{ nama, alasan, kandidat? }], masih_perlu: [{ nama, alasan }], baris?: { name: rows added } }.
export function fillForm(entry, isian, { now = Date.now(), registry = null, lookups = null } = {}) {
  const state = formState(entry);
  const { config, values, committed, initial, byName } = state;
  const ditolak = [];
  const patch = {};
  const labels = {};
  const rowFills = {};
  const seen = new Set();
  for (const item of Array.isArray(isian) ? isian : []) {
    const name = String(item?.kolom ?? item?.nama ?? '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const field = byName.get(name);
    if (!field) { ditolak.push({ nama: name, alasan: fieldClass(name) === 'open' ? REASONS.unknown : REASONS.userOnly }); continue; }
    if (!field.aiFillable) { ditolak.push({ nama: name, alasan: field.readOnly && field.kind === 'open' ? REASONS.readOnly : REASONS.userOnly }); continue; }
    if (field.type === 'rows') {
      if (!Array.isArray(item?.baris)) { ditolak.push({ nama: name, alasan: REASONS.needRows }); continue; }
      const filled = fillRows(field, item, { values, mark: entry.filled.get(name), lookups, now, ditolak });
      if (filled) { patch[name] = filled.next; rowFills[name] = filled; }
      continue;
    }
    if (Array.isArray(item?.baris)) { ditolak.push({ nama: name, alasan: REASONS.notRows }); continue; }
    if (!userMayBeOverwritten(entry, field, values, initial)) { ditolak.push({ nama: name, alasan: REASONS.userValue }); continue; }
    const coerced = isLookup(field) ? (lookups?.get(name) || { ok: false, alasan: REASONS.lookupFailed }) : coerceValue(field, item?.isi ?? item?.nilai, { now });
    if (!coerced.ok) { ditolak.push({ nama: name, alasan: coerced.alasan, ...(coerced.kandidat ? { kandidat: coerced.kandidat } : {}) }); continue; }
    patch[name] = coerced.value;
    if (coerced.label) labels[name] = coerced.label;
  }

  // The form's own validation, on the values as they would be.
  const masihPerlu = [];
  if (typeof config.validate === 'function') {
    const errors = config.validate({ ...values, ...patch }) || {};
    // A rows field: a complaint the form already had before this fill (a line
    // the user left half-typed) is the user's to fix — it does not refuse the AI's rows.
    const earlier = Object.keys(rowFills).length ? (config.validate(values) || {}) : {};
    for (const [name, message] of Object.entries(errors)) {
      if (!message) continue;
      if (name in rowFills && String(earlier[name] || '') === String(message)) {
        masihPerlu.push({ nama: name, alasan: String(message) });
      } else if (name in patch) {
        delete patch[name];
        delete rowFills[name];
        ditolak.push({ nama: name, alasan: String(message) });
      } else if (byName.has(name) && byName.get(name).kind !== 'secret') {
        masihPerlu.push({ nama: name, alasan: String(message) });
      }
    }
  }
  // Required fields still empty, when the form's validation did not say so already.
  for (const field of byName.values()) {
    if (!field.required || field.kind === 'secret' || masihPerlu.some((item) => item.nama === field.name)) continue;
    const next = field.name in patch ? patch[field.name] : values[field.name];
    const blank = field.type === 'rows' ? !(Array.isArray(next) && next.some((row) => !emptyRowOf(field, row))) : isEmpty(next);
    if (blank) masihPerlu.push({ nama: field.name, alasan: REASONS.required });
  }

  const names = Object.keys(patch);
  if (names.length) {
    for (const name of names) {
      const before = entry.filled.get(name);
      entry.filled.set(name, {
        // `before` is what the form's state holds right now (a fill of the same tick may not have arrived yet).
        value: patch[name], previous: before ? before.previous : values[name], before: committed[name], seen: false,
        ...(labels[name] ? { label: labels[name] } : {}),
        ...(rowFills[name] ? { signatures: rowFills[name].signatures } : {}),
      });
    }
    entry.noticeDismissed = false;
    applyPatch(state, { ...patch });
    touch(entry, registry);
  }
  const baris = Object.fromEntries(Object.entries(rowFills).map(([name, filled]) => [name, filled.added]));
  return { diisi: names, ditolak, masih_perlu: masihPerlu, ...(Object.keys(baris).length ? { baris } : {}) };
}

// isi_form as the page runs it: the lookups first (the page's own searches), then the fill.
export async function fillFormAsync(entry, isian, options = {}) {
  const lookups = await resolveLookups(entry, isian, options);
  return fillForm(entry, isian, { ...options, lookups });
}

// "Urungkan isian AI": every field still holding the AI's value gets back what
// it held before; the AI's rows go and the user's rows stay. Returns the names restored.
export function undoFill(entry, registry = null) {
  const state = formState(entry, { raw: true });
  const { values, byName } = state;
  const patch = {};
  for (const [name, mark] of entry.filled) {
    const field = byName.get(name);
    if (mark.signatures && field?.type === 'rows') {
      // Not rendered yet: the rows as they were before this fill win over the update on its way.
      if (!mark.seen && same(values[name], mark.before)) { patch[name] = mark.previous; continue; }
      const rows = undoRows(field, rowsOf(values, field), mark);
      if (rows) patch[name] = rows;
    } else if (same(values[name], mark.value) || !mark.seen) patch[name] = mark.previous;
  }
  entry.filled.clear();
  if (Object.keys(patch).length) applyPatch(state, patch);
  touch(entry, registry);
  return Object.keys(patch);
}

// The user saved (or the form closed): the marks go, the values stay.
export function clearFilled(entry, registry = null) {
  if (!entry.filled.size && !entry.noticeDismissed) return;
  entry.filled.clear();
  entry.noticeDismissed = false;
  touch(entry, registry);
}

export function dismissNotice(entry, registry = null) {
  entry.noticeDismissed = true;
  touch(entry, registry);
}
