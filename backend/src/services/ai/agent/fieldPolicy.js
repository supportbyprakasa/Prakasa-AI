// Which form fields are never Prakasa AI's to fill — by NAME, whatever a page
// or a catalog entry says (docs/prakasa-ai-rencana.md §9.8, §9.11, §9.12). The
// same lists as the browser's components/ai/aiFormModel.js;
// test/aiClientTools.test.js keeps the two equal.
//   secret    passwords, tokens, codes — not even listed to the model
//   userOnly  where money goes (payee bank account), approval decisions,
//             signatures, file uploads — listed, never filled, value never read
//   personal  a person's private data (NIK, KTP, NPWP, BPJS, salary, birth
//             date, home address, personal phone) — listed, never filled,
//             value never read. That data lives in KantorKu, not here.
//   infra     identifiers of infrastructure and devices (IP address, IMEI, MAC,
//             serial number, licence key, portal address, SSID / Wi-Fi, ISP or
//             utility customer number) — listed, never filled, value never read
// A column of a `rows` field is judged the same way, by its own name. A name is
// read word by word (camelCase and snake_case segments), never by substring:
// `description` does not hold `ip`.

const SECRET_WORDS = new Set(['password', 'pass', 'passwd', 'sandi', 'secret', 'token', 'otp', 'pin', 'apikey', 'credential', 'credentials', 'kredensial', 'cvv']);
const USER_ONLY_WORDS = new Set(['bank', 'rekening', 'iban', 'swift', 'approval', 'approve', 'approved', 'approver', 'setujui', 'persetujuan', 'keputusan', 'decision',
  'signature', 'file', 'files', 'lampiran', 'attachment', 'attachments', 'upload', 'photo', 'foto']);
const USER_ONLY_PHRASE = /(^|_)(account|akun)_(number|no|name|holder)($|_)|(^|_)(nomor|no|nama)_rekening($|_)|(^|_)kata_sandi($|_)|(^|_)api_key($|_)|(^|_)tanda_tangan($|_)/;
const PERSONAL_WORDS = new Set(['nik', 'ktp', 'npwp', 'bpjs', 'gaji', 'salary', 'payroll', 'birth', 'birthday', 'birthdate', 'birthplace', 'lahir', 'dob']);
const PERSONAL_PHRASE = /(^|_)alamat_(rumah|tinggal|domisili)($|_)|(^|_)home_address($|_)|(^|_)(telepon|telp|phone|hp|mobile|nomor|no)_(pribadi|personal)($|_)|(^|_)(personal|private)_(phone|mobile|number|email)($|_)|(^|_)kartu_keluarga($|_)/;
const INFRA_WORDS = new Set(['ip', 'ipv4', 'ipv6', 'imei', 'mac', 'serial', 'ssid', 'wifi', 'portal']);
const INFRA_PHRASE = /(^|_)(nomor|no)_seri($|_)|(^|_)(license|licence|lisensi)_key($|_)|(^|_)kunci_lisensi($|_)|(^|_)customer_(number|no)($|_)|(^|_)(nomor|no|id)_pelanggan($|_)|(^|_)(nomor|no)_meter($|_)|(^|_)meter_(number|no)($|_)/;
// Names reviewed by hand that hold a word above but not the thing it guards.
// Keep it short; a module file cannot add itself here.
const REVIEWED_OPEN = Object.freeze({
  publicIpDedicated: 'ya/tidak: apakah tautan ISP punya IP publik dedicated — bukan alamat IP',
});
const wordsOf = (name) => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// A word counts with or without a trailing number: `imei2`, `password2`, `phone1`.
const inSet = (words, set) => words.some((word) => set.has(word) || set.has(word.replace(/\d+$/, '')));
// 'secret' | 'userOnly' | 'personal' | 'infra' | 'open'. Only 'open' may be filled or read.
function fieldClass(name) {
  const words = wordsOf(name);
  const joined = words.join('_');
  if (inSet(words, SECRET_WORDS) || /(^|_)kata_sandi($|_)|(^|_)api_key($|_)/.test(joined)) return 'secret';
  if (Object.prototype.hasOwnProperty.call(REVIEWED_OPEN, String(name))) return 'open';
  if (inSet(words, USER_ONLY_WORDS) || USER_ONLY_PHRASE.test(joined)) return 'userOnly';
  if (inSet(words, PERSONAL_WORDS) || PERSONAL_PHRASE.test(joined)) return 'personal';
  if (inSet(words, INFRA_WORDS) || INFRA_PHRASE.test(joined)) return 'infra';
  return 'open';
}

// Names that hold rupiah. A form may let the AI fill such a field only when the
// catalog allows that form (formCatalog.js MONEY_FORMS): the amount of the
// user's OWN request — never a price, a discount, a budget, a target or
// anything that comes from Accurate.
const MONEY_WORDS = new Set(['amount', 'price', 'harga', 'nominal', 'subtotal', 'tax', 'pajak', 'diskon', 'discount', 'budget', 'anggaran', 'biaya', 'cost', 'rupiah',
  'dpp', 'ppn', 'omzet', 'revenue', 'margin', 'salary', 'gaji', 'spend', 'belanja', 'nilai', 'tarif', 'fee', 'hpp', 'cogs']);
// Names reviewed by hand that hold a money word but no rupiah.
const NOT_MONEY = Object.freeze({
  usageAmount: 'pemakaian listrik / air (kWh, m³) di tagihan utilitas GA — bukan rupiah',
});
const moneyLike = (name) => !Object.prototype.hasOwnProperty.call(NOT_MONEY, String(name)) && inSet(wordsOf(name), MONEY_WORDS);

// A field whose NAME comes from data (a placeholder of a document template —
// formCatalog.js dynamicFields): nobody reviewed that name, so the rule is
// stricter. Open, no rupiah, no phone number of any kind, and only a text,
// textarea or date field.
const DYNAMIC_TYPES = Object.freeze(['text', 'textarea', 'date']);
const DYNAMIC_REFUSED_WORDS = new Set(['telepon', 'telp', 'phone', 'hp', 'handphone', 'ponsel', 'mobile', 'wa', 'whatsapp']);
function dynamicFieldFillable(name, type = 'text') {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(String(name || ''))) return false;
  return fieldClass(name) === 'open' && !moneyLike(name) && !inSet(wordsOf(name), DYNAMIC_REFUSED_WORDS) && DYNAMIC_TYPES.includes(type);
}

// A VALUE that holds a personal identifier or a bank account number — whatever
// the field is called. Used when the answer works from an attached document
// (a receipt, an invoice, a business card): such a number is never copied into
// a form, not even into a free-text field like notes or a description.
//   - a run of 15–19 digits (NIK, NPWP, card and most account numbers), also
//     when written with spaces, dots or dashes;
//   - an NPWP as printed (00.000.000.0-000.000);
//   - a number of 8 digits or more right after a word that says what it is
//     (NIK, KTP, NPWP, BPJS, rekening, a/n, virtual account, the name of a bank …).
// A rupiah amount, a date, a quantity or a document number does not match.
const LONG_NUMBER = /(?<![\d.,])\d(?:[ .-]?\d){14,18}(?![\d.,]*\d)/;
const NPWP_PRINTED = /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/;
const LABELLED_NUMBER = /(?:^|[^a-z])(?:nik|ktp|e-?ktp|npwp|bpjs|kartu keluarga|no\.? ?kk|rekening|rek|norek|no\.? ?rek|a\/n|a\.n\.?|atas nama|bank account|account (?:no|number)|virtual account|va|bank|bca|bri|bni|btn|bsi|mandiri|cimb|permata|danamon)(?![a-z])[^0-9\n]{0,24}\d(?:[ .-]?\d){7,}/i;
function identifierLike(value) {
  const text = String(value ?? '');
  if (text.length < 8) return false;
  return NPWP_PRINTED.test(text) || LONG_NUMBER.test(text) || LABELLED_NUMBER.test(text);
}

module.exports = { identifierLike, fieldClass, wordsOf, moneyLike, dynamicFieldFillable, DYNAMIC_TYPES, REVIEWED_OPEN, NOT_MONEY };
