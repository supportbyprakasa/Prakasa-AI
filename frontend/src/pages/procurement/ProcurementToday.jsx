import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { apiError } from '../sales/salesModel';
import { PO_STATUS, dueMeta, formatDate, procurementNotice, receivedText, reorderTodayCount } from './procurementModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';

// The Procurement day, from approved Accurate data: what needs a look, what
// arrived (Warehouse-approved receipts), what is expected today and tomorrow.
// Quantities and dates only — no prices on this tab.
const dateExport = (value) => (value ? String(value).slice(0, 10) : '');
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

const ARRIVAL_COLUMNS = [
  { key: 'number', header: 'Penerimaan', exportValue: (r) => r.number },
  { key: 'vendorName', header: 'Pemasok', render: (r) => r.vendorName || '—' },
  { key: 'poNumbers', header: 'PO', render: (r) => (r.poNumbers.length ? r.poNumbers.join(', ') : '—'), exportValue: (r) => r.poNumbers.join(', ') },
  { key: 'lineCount', header: 'Baris', align: 'end' },
];
const EXPECTED_COLUMNS = [
  { key: 'number', header: 'Nomor PO', exportValue: (r) => r.number },
  { key: 'vendorName', header: 'Pemasok', render: (r) => r.vendorName || '—' },
  { key: 'dueDate', header: 'Diharapkan', translate: true, render: (r) => cell(formatDate(r.dueDate), dueMeta(r)), exportValue: (r) => dateExport(r.dueDate) },
  { key: 'percentReceived', header: 'Diterima', align: 'end', render: receivedText, exportValue: (r) => r.percentReceived },
  { key: 'state', header: 'Status', render: (r) => <StatusBadge status={PO_STATUS[r.state]} />, exportValue: (r) => statusLabel(PO_STATUS[r.state]) },
];

// "5 barang" from the saran pesan ulang counts, linking to exactly the list it
// counts; "—" until stock is approved; "mulai 7 Okt 2026" for a timed count
// before the outflow can be known.
function reorderCount(meta, key, to, options) {
  const c = reorderTodayCount(meta, key, options);
  return { value: c.text, link: c.link ? to : null };
}

export default function ProcurementToday({ status, canSeeReorder = false }) {
  const [state, setState] = useState({ loading: true, error: '', day: null });
  // Saran pesan ulang counts, only for those allowed to see stock (D2 extended).
  // The two figures read "—" when these counts cannot be loaded.
  const [reorder, setReorder] = useState(null);
  useEffect(() => {
    if (!canSeeReorder) return undefined;
    let alive = true;
    api.get('/procurement/reorder', { params: { limit: 1 } }).then((r) => { if (alive) setReorder(r.data.meta || null); }).catch(() => {});
    return () => { alive = false; };
  }, [canSeeReorder]);
  usePublishPrakasaAIContext({ toolKey: 'procurement', visibleState: { tab: 'today' } });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.get('/procurement/today');
      const data = res.data.data;
      // An answer without the day's figures is a failed load, never a page of zeros.
      if (!data || typeof data !== 'object' || !data.attention) throw new Error('Data hari ini tidak lengkap.');
      setState({ loading: false, error: '', day: { arrivals: [], expected: [], ...data } });
    } catch (err) {
      setState({ loading: false, error: apiError(err), day: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Memuat hari ini…" />;
  if (state.error) return <EmptyState tone="error" title="Hari ini belum bisa dimuat" description={state.error} action={<Button variant="secondary" icon="refresh" onClick={load}>Coba lagi</Button>} />;
  const { day } = state;
  const notice = procurementNotice(status);
  const ready = Boolean(status?.ready);
  // A count from data that is not there yet reads "—", never 0.
  const stat = (label, { value, link }) => (
    <StatCard
      key={label}
      label={label}
      value={value === '—' ? null : value}
      note={value === '—' ? 'Belum ada data' : null}
      empty={value === '—'}
      action={link ? <Link className="pw-link" to={link}>Lihat daftar</Link> : null}
    />
  );
  const count = (n, unit, to) => (ready ? { value: `${formatNumber(n)} ${unit}`, link: to || null } : { value: '—', link: null });
  return (
    <div className="pw-stack pw-stack--lg">
      {notice ? <Banner tone="info" title={notice.title}>{notice.body}</Banner> : null}
      <section className="pw-stack" aria-labelledby="pc-today-attention">
        <h2 id="pc-today-attention" className="pw-title-section">Perlu perhatian</h2>
        <div className="pw-text-helper">{formatDate(day.date)} · dari Accurate, setelah disetujui Head Procurement.</div>
        <div className="pc-stats">
          {stat('PO terlambat', count(day.attention.late, 'PO', '/procurement?tab=orders&state=late'))}
          {stat('Dijadwalkan datang 7 hari', count(day.attention.dueSoon, 'PO', '/procurement?tab=orders&state=open'))}
          {stat('PO tanpa tgl datang di Accurate', count(day.attention.noExpectedDate, 'PO'))}
          {stat('PO lama belum ditutup', count(day.attention.legacy, 'PO', '/procurement?tab=orders&state=legacy'))}
          {canSeeReorder ? stat('Perlu dipesan', reorderCount(reorder, 'total', '/procurement?tab=reorder')) : null}
          {canSeeReorder ? stat('Habis sebelum barang datang', reorderCount(reorder, 'critical', '/procurement?tab=reorder&urgency=critical', { timed: true })) : null}
        </div>
      </section>
      <DataGrid
        title="Barang datang hari ini"
        columns={ARRIVAL_COLUMNS}
        rows={status?.receiptsLive ? day.arrivals : []}
        searchable={false}
        exportName="barang-datang-hari-ini"
        empty={status?.receiptsLive ? 'Belum ada barang datang hari ini' : 'Data penerimaan menunggu persetujuan Warehouse'}
      />
      <DataGrid
        title="Dijadwalkan datang hari ini & besok"
        columns={EXPECTED_COLUMNS}
        rows={ready ? day.expected : []}
        searchable={false}
        exportName="po-dijadwalkan-datang"
        empty={ready ? 'Tidak ada PO yang dijadwalkan datang hari ini atau besok' : 'Belum ada data PO dari Accurate'}
      />
    </div>
  );
}
