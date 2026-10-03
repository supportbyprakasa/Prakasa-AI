// Tukar faktur (program 2.3): how a row and its status read.
export const EXCHANGE_FILTERS = [
  { key: 'pending', label: 'Belum tukar faktur' },
  { key: 'done', label: 'Sudah tukar faktur' },
];

export function exchangeChipLabel(key, counts) {
  const entry = EXCHANGE_FILTERS.find((f) => f.key === key);
  const n = counts?.[key];
  return n === undefined || n === null ? entry.label : `${entry.label} (${n})`;
}

// The pieces of the text below, each { text, data }: `data` marks what the
// user typed (the tanda terima number), which the language switch never
// translates; the others are interface text.
export function exchangeParts(exchange, formatDate) {
  if (!exchange) return [{ text: 'Belum' }];
  const parts = [{ text: `Tukar ${formatDate(exchange.exchangedOn)}` }];
  if (exchange.receiptNo) parts.push({ text: exchange.receiptNo, data: true });
  if (exchange.promisedPayDate) parts.push({ text: `janji bayar ${formatDate(exchange.promisedPayDate)}` });
  return parts;
}

// "Tukar 29 Sep · TT-12 · janji bayar 15 Okt" — dates formatted by the caller.
export function exchangeText(exchange, formatDate) {
  return exchangeParts(exchange, formatDate).map((part) => part.text).join(' · ');
}

// Due for tukar faktur a week after the invoice date (the escalation's rule).
export const EXCHANGE_AFTER_DAYS = 7;
export const isDueForExchange = (row) => !row?.exchange && Number(row?.daysSinceInvoice) >= EXCHANGE_AFTER_DAYS;

// The form's body, or an error text and the field it belongs to.
export function exchangeBody(form) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.exchangedOn || '')) return { error: 'Isi tanggal tukar faktur.', field: 'exchangedOn' };
  if (form.promisedPayDate && form.promisedPayDate < form.exchangedOn) {
    return { error: 'Janji bayar tidak boleh sebelum tanggal tukar faktur.', field: 'promisedPayDate' };
  }
  return { body: { exchangedOn: form.exchangedOn, receiptNo: form.receiptNo || null, promisedPayDate: form.promisedPayDate || null, note: form.note || null } };
}
