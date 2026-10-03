import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import StatCard from '../../components/StatCard';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { apiError } from '../sales/salesModel';
import { dateOnly, dayText, documentsNotice, referenceText } from './warehouseStockModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';

// The Warehouse's day, from approved Accurate data (Warehouse stage 2): what
// ships today, what arrives today, and what needs a look. Read-only. Until the
// data is there (documents not switched on, or not approved yet) it says so —
// never "nothing ships today".

const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

const DELIVERY_COLUMNS = [
  { key: 'number', header: 'Surat jalan', exportValue: (r) => r.number },
  { key: 'party', header: 'Pelanggan', render: (r) => cell(r.party || '—', r.channel), exportValue: (r) => r.party },
  { key: 'refs', header: 'No. SO', render: referenceText, exportValue: referenceText },
  { key: 'lineCount', header: 'Baris', align: 'end' },
];
const RECEIPT_COLUMNS = [
  { key: 'number', header: 'Penerimaan', exportValue: (r) => r.number },
  { key: 'party', header: 'Pemasok' },
  { key: 'refs', header: 'PO', render: referenceText, exportValue: referenceText },
  { key: 'lineCount', header: 'Baris', align: 'end' },
];

// POs due this week, from approved Procurement data: quantities and dates only (P1).
const INCOMING_COLUMNS = [
  { key: 'dueDate', header: 'Diharapkan', translate: true, render: (r) => cell(dayText(r.dueDate), r.estimated ? '(perkiraan)' : ''), exportValue: (r) => dateOnly(r.dueDate) },
  { key: 'number', header: 'Nomor PO', exportValue: (r) => r.number },
  { key: 'vendorName', header: 'Pemasok', render: (r) => r.vendorName || '—' },
  { key: 'percentReceived', header: 'Diterima', align: 'end', render: (r) => `${r.percentReceived}%`, exportValue: (r) => r.percentReceived },
  { key: 'lineCount', header: 'Baris', align: 'end' },
];

export default function WarehouseToday() {
  const [state, setState] = useState({ loading: true, error: '', day: null, status: null });
  usePublishPrakasaAIContext({ toolKey: 'warehouse', visibleState: { tab: 'today' } });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [day, status] = await Promise.all([api.get('/warehouse/today'), api.get('/warehouse/accurate/status')]);
      const data = day.data.data;
      // An answer without the day's figures is a failed load, never a page of zeros.
      if (!data || typeof data !== 'object' || !data.attention) throw new Error('Data hari ini tidak lengkap.');
      setState({ loading: false, error: '', day: { deliveries: [], receipts: [], incomingPos: [], ...data }, status: status.data.data });
    } catch (err) {
      setState({ loading: false, error: apiError(err), day: null, status: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Memuat hari ini…" />;
  if (state.error) {
    return <EmptyState tone="error" title="Hari ini belum bisa dimuat" description={state.error} action={<Button variant="secondary" icon="refresh" onClick={load}>Coba lagi</Button>} />;
  }
  const { day, status } = state;
  const docsReady = Boolean(status?.documents?.ready);
  const notice = documentsNotice(status);
  // Today lists at most TODAY_LIMIT per type; the full list is one tap away.
  const seeAll = (type, total, shown) => (docsReady && total > shown
    ? <Link className="pw-link" to={`/warehouse?tab=documents&type=${type}&from=${day.date}&to=${day.date}`}>Lihat semua {total}</Link>
    : null);
  // A count from data that is not there yet reads "—", never 0.
  const stat = (label, ready, n, unit, to) => (
    <StatCard
      label={label}
      value={ready ? `${formatNumber(n)} ${unit}` : null}
      note={ready ? null : 'Belum ada data'}
      empty={!ready}
      action={ready && to ? <Link className="pw-link" to={to}>Lihat daftar</Link> : null}
    />
  );
  return (
    <div className="pw-stack pw-stack--lg">
      {notice ? <Banner tone="info" title={notice.title}>{notice.body}</Banner> : null}
      {!notice && status?.pending ? (
        <Banner tone="warning" title="Ada pembaruan dari Accurate menunggu persetujuan">
          Yang tampil di sini per tarikan terakhir yang sudah disetujui; surat jalan atau penerimaan yang lebih baru muncul setelah batch #{status.pending.batchId} diputuskan.
        </Banner>
      ) : null}
      <section className="pw-stack" aria-labelledby="wh-today-attention">
        <h2 id="wh-today-attention" className="pw-title-section">Perlu perhatian</h2>
        <div className="pw-text-helper">{dayText(day.date)} · dari Accurate, setelah disetujui Supervisor atau Head Warehouse.</div>
        <div className="wh-stats">
          {stat('Barang stok minus', status?.ready, day.attention.stockMinus, 'barang', '/warehouse?tab=stock&status=minus')}
          {stat('Pindah gudang dalam perjalanan', docsReady, day.attention.inTransit, 'dokumen', '/warehouse?tab=documents&type=transfer&status=in_transit')}
          {stat('Tertahan 3 hari atau lebih', docsReady, day.attention.stuckTransfers, 'dokumen')}
          {stat('SO harus dikirim (hari ini atau lewat)', true, day.attention.soDue ?? 0, 'SO', '/warehouse?tab=shipping')}
        </div>
      </section>
      <DataGrid
        title={docsReady ? `Kirim hari ini (${day.totals?.deliveries ?? day.deliveries.length})` : 'Kirim hari ini'}
        toolbarActions={seeAll('delivery', day.totals?.deliveries ?? 0, day.deliveries.length)}
        columns={DELIVERY_COLUMNS}
        rows={docsReady ? day.deliveries : []}
        searchable={false}
        exportName="kirim-hari-ini"
        empty={docsReady ? 'Belum ada surat jalan hari ini' : 'Belum ada data surat jalan dari Accurate'}
      />
      <DataGrid
        title="PO akan datang (7 hari)"
        columns={INCOMING_COLUMNS}
        rows={day.incomingPos || []}
        searchable={false}
        exportName="po-akan-datang"
        empty="Belum ada PO dari Accurate yang dijadwalkan datang 7 hari ke depan"
      />
      <DataGrid
        title={docsReady ? `Datang hari ini (${day.totals?.receipts ?? day.receipts.length})` : 'Datang hari ini'}
        toolbarActions={seeAll('receipt', day.totals?.receipts ?? 0, day.receipts.length)}
        columns={RECEIPT_COLUMNS}
        rows={docsReady ? day.receipts : []}
        searchable={false}
        exportName="datang-hari-ini"
        empty={docsReady ? 'Belum ada penerimaan barang hari ini' : 'Belum ada data penerimaan barang dari Accurate'}
      />
    </div>
  );
}
