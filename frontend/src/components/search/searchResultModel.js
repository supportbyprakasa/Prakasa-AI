// Labels for the global search (/search): the record types a search can
// return, and the few meta fields a result carries. Pure, so the page, the
// result row and the tests share one table. Types are categories, so they are
// shown neutrally (never in a status colour).
import { formatDate } from '../format.js';
import { priorityLabel, statusLabel } from '../statusTone.js';
import { humanizeCode, subjectLabel } from '../notifications/notificationModel.js';

export const SEARCH_TYPES = [
  { value: 'document', label: 'Dokumen', icon: 'description' },
  { value: 'task', label: 'Task', icon: 'task_alt' },
  { value: 'customer', label: 'Pelanggan', icon: 'group' },
  { value: 'sales_order', label: 'Data Sales', icon: 'trending_up' },
  { value: 'meeting', label: 'Rapat', icon: 'calendar_month' },
  { value: 'device', label: 'Perangkat', icon: 'devices' },
  { value: 'subscription', label: 'Langganan', icon: 'apps' },
  { value: 'finance_workflow', label: 'Finance', icon: 'account_balance_wallet' },
  { value: 'hrga_workflow', label: 'HRGA', icon: 'badge' },
  { value: 'kb_document', label: 'Knowledge base', icon: 'menu_book' },
  { value: 'decision_log', label: 'Log keputusan', icon: 'receipt_long' },
  { value: 'approval_request', label: 'Approval', icon: 'approval' },
  { value: 'signature_request', label: 'Tanda tangan', icon: 'draw' },
];
const TYPES = Object.fromEntries(SEARCH_TYPES.map((t) => [t.value, t]));

export const isSearchType = (value) => Boolean(TYPES[value]);
export const searchTypeLabel = (value) => TYPES[value]?.label || humanizeCode(value) || 'Data';
export const searchTypeIcon = (value) => TYPES[value]?.icon || 'article';

const DEVICE_TYPES = {
  laptop: 'Laptop', pc: 'PC', macbook: 'MacBook', smartphone: 'Smartphone', tablet: 'Tablet', printer: 'Printer',
  router: 'Router', switch: 'Switch', access_point: 'Access point', cctv_nvr: 'CCTV / NVR', monitor: 'Monitor',
  external_hdd: 'Harddisk eksternal', peripheral: 'Periferal', other: 'Lainnya',
};
const CURRENCIES = { IDR: 'Rupiah', USD: 'Dolar AS', SGD: 'Dolar Singapura' };

// The whitelisted meta keys of a result, as [label, readable value] pairs.
const META_FIELDS = [
  ['priority', 'Prioritas', priorityLabel],
  ['dueDate', 'Tenggat', formatDate],
  ['city', 'Kota', String],
  ['stage', 'Tahap', statusLabel],
  ['deviceType', 'Tipe', (v) => DEVICE_TYPES[v] || humanizeCode(v)],
  ['renewalDate', 'Perpanjangan', formatDate],
  ['currency', 'Mata uang', (v) => CURRENCIES[String(v).toUpperCase()] || String(v)],
  ['workflowType', 'Alur', statusLabel],
  ['category', 'Kategori', humanizeCode],
  ['visibility', 'Visibilitas', statusLabel],
];

export function resultMetaItems(meta) {
  if (!meta || typeof meta !== 'object') return [];
  return META_FIELDS
    .filter(([key]) => meta[key] !== null && meta[key] !== undefined && meta[key] !== '')
    // `data`: the value is the record's own text (a city), never translated.
    .map(([key, label, format]) => ({ key, label, value: format(meta[key]), data: format === String }));
}

// The second line of a result. Some providers send codes: an approval sends
// its subject type, a document its document type (also shown as "Kategori"),
// a signature request "Signature #id".
export function resultSubtitle(result) {
  const text = result?.subtitle;
  if (!text) return null;
  if (result.type === 'approval_request' && /^[a-z_]+$/.test(text)) return subjectLabel(text);
  if (result.type === 'document') {
    if (text === result.meta?.category) return null;
    if (/^[a-z]+(?:_[a-z]+)+$/.test(text)) return humanizeCode(text);
  }
  const signature = /^Signature #(\d+)$/.exec(text);
  if (signature) return `Tanda tangan #${signature[1]}`;
  if (result.type === 'hrga_workflow') {
    const [kind, ...rest] = String(text).split(' · ');
    if (/^[a-z_]+$/.test(kind)) return [statusLabel(kind), ...rest].join(' · ');
  }
  return text;
}

// "Entitas #3" only when the result lives in another entity than the
// signed-in user's (a cross-entity search); otherwise nothing.
export function resultEntity(entityId, currentEntityId) {
  if (entityId === null || entityId === undefined || entityId === '') return null;
  if (currentEntityId !== null && currentEntityId !== undefined && String(entityId) === String(currentEntityId)) return null;
  return `Entitas #${entityId}`;
}

// Summary under the search box: labels of the chosen types, never codes.
export const typeSummary = (types) => (types || []).map(searchTypeLabel).join(', ');
