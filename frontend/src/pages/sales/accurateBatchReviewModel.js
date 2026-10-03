// Pure helpers for "Periksa dengan AI" on a Data Accurate batch.
import { formatRupiah } from './salesModel.js';

// A finding's severity; its tone and label come from the one status map
// (components/statusTone.js `finding_<severity>`).
const SEVERITIES = ['high', 'medium', 'low'];
export const findingStatus = (severity) => `finding_${SEVERITIES.includes(severity) ? severity : 'low'}`;

// A review in one known shape (the POST answer, the `findings` event, or the stored one).
export function normalizeReview(data) {
  if (!data || typeof data !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    contents: list(data.contents).map((c) => ({ type: String(c.type), label: String(c.label || c.type), create: Number(c.create) || 0, update: Number(c.update) || 0, missing: Number(c.missing) || 0 })),
    findings: list(data.findings).filter((f) => f && f.code).map((f) => ({
      code: String(f.code),
      severity: SEVERITIES.includes(f.severity) ? f.severity : 'low',
      title: String(f.title || f.code),
      count: Number(f.count) || 0,
      why: String(f.why || ''),
      examples: list(f.examples).slice(0, 5).filter((e) => e && e.number).map((e) => ({
        number: String(e.number),
        customerNo: e.customerNo ? String(e.customerNo) : null,
        percent: Number.isFinite(Number(e.percent)) && e.percent != null ? Number(e.percent) : null,
        before: Number.isFinite(Number(e.before)) && e.before != null ? Number(e.before) : null,
        after: Number.isFinite(Number(e.after)) && e.after != null ? Number(e.after) : null,
      })),
    })),
    notChecked: list(data.notChecked).filter((x) => x && x.title).map((x) => ({ code: String(x.code), title: String(x.title), reason: String(x.reason || '') })),
    requestedByName: data.requestedByName || null,
    createdAt: data.createdAt || null,
    aiNote: data.aiNote || null,
    aiStatus: data.aiStatus || null,
  };
}

// "Rp 10.000.000 → Rp 15.000.000" — only when the server sent the values
// (the reader holds the division's money permission).
export function valueChange(example) {
  if (example.before == null || example.after == null) return '';
  return `${formatRupiah(example.before)} → ${formatRupiah(example.after)}`;
}
