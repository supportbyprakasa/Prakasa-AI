import StatusBadge from '../../components/StatusBadge';
import { formatQty } from '../../components/format';
import { Translate } from '../../i18n/NoTranslate';
import { OTHER_PLATFORM, receivableStatus, shipmentStatus } from './retailModel';

// Columns shared by the marketplace dashboard and the "Pesanan & piutang" page.
export const pct = (v) => (v === null || v === undefined ? '—' : `${formatQty(v)}%`);

// A platform's name is record data; "Lainnya" (no platform on the customer) is
// interface text inside those data zones.
export const platformColumn = (key) => ({
  key, header: 'Platform',
  render: (r) => (r[key] === OTHER_PLATFORM ? <Translate>{r[key]}</Translate> : r[key]),
  sortValue: (r) => r[key], exportValue: (r) => r[key],
});

export const SHIPMENT_COLUMNS = [
  { key: 'number', header: 'No. SO', nowrap: true },
  platformColumn('platform'),
  { key: 'date', header: 'Tanggal SO', type: 'date' },
  { key: 'promisedDate', header: 'Janji kirim', type: 'date' },
  { key: 'daysOpen', header: 'Umur (hari)', type: 'number' },
  { key: 'percentShipped', header: 'Terkirim', type: 'number', render: (r) => pct(r.percentShipped) },
  { key: 'amount', header: 'Nilai (sebelum PPN)', type: 'money' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => { const s = shipmentStatus(r); return <StatusBadge status={s.status} label={s.label} />; },
    exportValue: (r) => shipmentStatus(r).label,
    sortValue: (r) => r.daysLate,
  },
];

export const RECEIVABLE_COLUMNS = [
  { key: 'number', header: 'No. faktur', nowrap: true },
  platformColumn('platform'),
  { key: 'date', header: 'Tanggal', type: 'date' },
  { key: 'dueDate', header: 'Jatuh tempo', type: 'date' },
  { key: 'total', header: 'Nilai faktur', type: 'money' },
  { key: 'outstanding', header: 'Belum cair', type: 'money' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => { const s = receivableStatus(r); return <StatusBadge status={s.status} label={s.label} />; },
    exportValue: (r) => receivableStatus(r).label,
    sortValue: (r) => r.daysOverdue,
  },
];
