// Document numbers for Sales records entered in the app, in the formats the
// Sales team already uses (verified against the imported data):
//   customer  PFN-PR-GT-JKT-0379      legal form · channel code · city · running number
//   lead      PFN-CS-260900361        yymm + running number
//   order     SO65/HRC-PFN/IX/2026    running number per month · prefix · month · year
//   DO / SI   DO65/HRC-PFN/IX/2026    same as the order, SO → DO / SI
// Pure functions: the callers read the existing numbers and pass them in.

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const LEGAL_FORMS = ['PR', 'PT', 'CV', 'IN'];

// Customer categories as used in the Customer List.
const CUSTOMER_CHANNELS = ['GT', 'MT', 'FoodService', 'Shopee', 'TokoPedia', 'GRAB', 'GOJEK', 'Export'];
const CHANNEL_CODE = {
  GT: 'GT', MT: 'MT', FoodService: 'HRC', Shopee: 'SHP', TokoPedia: 'TPD', GRAB: 'GM', GOJEK: 'GO', Export: 'EXP',
};

// Order channels as used in Data Master.
const ORDER_CHANNELS = ['GT', 'MT', 'FoodService', 'e-Commerce', 'QuickCommerce', 'Export', 'Internal'];
const ORDER_CHANNEL_FOR_CATEGORY = { Shopee: 'e-Commerce', TokoPedia: 'e-Commerce', GRAB: 'QuickCommerce', GOJEK: 'QuickCommerce' };
const ORDER_PREFIX = { FoodService: 'HRC-PFN', MT: 'MT-PFN' };
const DEFAULT_ORDER_PREFIX = 'SO-PFN';

const pad = (n, width) => String(n).padStart(width, '0');

// The reverse: "PFN-IN-SHP-TGR-0337" → "Shopee". Accurate uses the same
// customer numbers, and its own categories are not consistent, so the channel of
// an Accurate customer is read from its number. Unknown segment → null.
function channelFromCustomerCode(code) {
  const m = /^[A-Z]+-[A-Z]{2}-([A-Z]{2,4})-/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  return Object.keys(CHANNEL_CODE).find((channel) => CHANNEL_CODE[channel] === m[1]) || null;
}

function channelCode(channel) {
  if (CHANNEL_CODE[channel]) return CHANNEL_CODE[channel];
  const letters = String(channel || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  return letters.slice(0, 3) || 'GEN';
}

function orderChannelFor(customerChannel) {
  if (ORDER_CHANNEL_FOR_CATEGORY[customerChannel]) return ORDER_CHANNEL_FOR_CATEGORY[customerChannel];
  return ORDER_CHANNELS.includes(customerChannel) ? customerChannel : 'GT';
}

function orderPrefix(channel) {
  return ORDER_PREFIX[channel] || DEFAULT_ORDER_PREFIX;
}

// Highest trailing number among `codes` whose tail has at least `width` digits.
function maxTrailing(codes, width) {
  let max = 0;
  const re = new RegExp(`(\\d{${width}})$`);
  for (const code of codes || []) {
    const m = re.exec(String(code || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function customerCode({ legalForm, channel, cityCode }, existingCodes) {
  const form = LEGAL_FORMS.includes(legalForm) ? legalForm : 'PR';
  const city = String(cityCode || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'JKT';
  const seq = maxTrailing((existingCodes || []).filter((c) => /^PFN-/.test(c)), 4) + 1;
  return `PFN-${form}-${channelCode(channel)}-${city}-${pad(seq, 4)}`;
}

// The city segment of a customer number (PFN-PR-GT-JKT-0001 → JKT) and its
// name: where a delivery goes, without storing anyone's address.
const CITY_NAMES = Object.freeze({
  JKT: 'Jakarta', TGR: 'Tangerang', BKS: 'Bekasi', DPK: 'Depok', BGR: 'Bogor', BDG: 'Bandung',
  CJR: 'Cianjur', CLG: 'Cilegon', SRG: 'Serang', KRW: 'Karawang', SBY: 'Surabaya', SMG: 'Semarang',
});

function cityFromCustomerCode(code) {
  const m = /^PFN-[A-Z]{2}-[A-Z]{2,4}-([A-Z]{3})-\d+$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  return { code: m[1], name: CITY_NAMES[m[1]] || m[1] };
}

function leadCode(date, existingCodes) {
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00Z`);
  const yymm = `${pad(d.getUTCFullYear() % 100, 2)}${pad(d.getUTCMonth() + 1, 2)}`;
  const seq = maxTrailing(existingCodes, 5) + 1;
  return `PFN-CS-${yymm}${pad(seq, 5)}`;
}

// Order numbers run per month, whatever the prefix, so two channels never
// produce the same number in the same month.
function orderNumber({ date, channel, prefix }, existingNumbers) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const roman = ROMAN[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const suffix = `/${roman}/${year}`;
  let max = 0;
  for (const n of existingNumbers || []) {
    const m = /^SO(\d+)\//.exec(String(n || ''));
    if (m && String(n).endsWith(suffix)) max = Math.max(max, Number(m[1]));
  }
  return `SO${max + 1}/${prefix || orderPrefix(channel)}${suffix}`;
}

// SO65/HRC-PFN/IX/2026 → DO65/HRC-PFN/IX/2026; SO68/SO-PFN/VII/2026 → DO68/DO-PFN/VII/2026.
// Numbers not in that format get the kind in front: DO-11147.
function documentNumber(orderNo, kind) {
  const text = String(orderNo || '');
  if (/^SO\d+\//.test(text)) return text.split('/').map((part) => part.replace(/^SO/, kind)).join('/');
  return `${kind}-${text}`;
}

module.exports = {
  ROMAN, LEGAL_FORMS, CUSTOMER_CHANNELS, ORDER_CHANNELS,
  channelCode, channelFromCustomerCode, cityFromCustomerCode, orderChannelFor, orderPrefix, customerCode, leadCode, orderNumber, documentNumber, maxTrailing,
};
