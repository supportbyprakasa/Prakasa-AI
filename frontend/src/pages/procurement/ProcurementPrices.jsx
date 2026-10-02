import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Input from '../../components/Input';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import useSalesList, { useDebouncedValue } from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import { PRICE_TRENDS, changeStatus, changeText, formatDate, rupiah, trendChipLabel } from './procurementModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';

// Harga beli (program 3.1): the latest purchase price per vendor × item × unit,
// from approved PO lines, and how it moved against the same vendor's previous
// one. Only for the Procurement Supervisor/Head and the Management Office (P1).
const dateExport = (value) => (value ? String(value).slice(0, 10) : '');
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

const COLUMNS = [
  { key: 'itemName', header: 'Barang', render: (r) => cell(r.itemName, r.itemNo), exportValue: (r) => r.itemName },
  { key: 'vendorName', header: 'Pemasok', render: (r) => r.vendorName || '—' },
  { key: 'unit', header: 'Satuan' },
  { key: 'unitPrice', header: 'Harga terakhir', align: 'end', render: (r) => rupiah(r.unitPrice), exportValue: (r) => r.unitPrice },
  { key: 'pricePerBase', header: 'Per satuan dasar', align: 'end', render: (r) => (r.unitRatio > 1 ? rupiah(r.pricePerBase) : '—'), exportValue: (r) => r.pricePerBase },
  { key: 'date', header: 'Tanggal PO', render: (r) => cell(formatDate(r.date), r.poNumber), exportValue: (r) => dateExport(r.date) },
  { key: 'previousPrice', header: 'Sebelumnya', align: 'end', render: (r) => rupiah(r.previousPrice), exportValue: (r) => r.previousPrice },
  {
    key: 'changePct', header: 'Perubahan', align: 'end',
    render: (r) => (r.changePct === null ? '—' : <StatusBadge status={changeStatus(r.changePct)} label={changeText(r.changePct)} />),
    exportValue: (r) => r.changePct,
  },
];

// A computed drill-down (§2.2): this vendor's price history for the item and
// what other vendors charged for the same unit, in a side sheet.
function PriceSheet({ row, onClose }) {
  const [state, setState] = useState({ loading: false, error: '', data: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!row) return undefined;
    let alive = true;
    setState({ loading: true, error: '', data: null });
    api.get('/procurement/prices/history', { params: { vendor: row.vendorNo, item: row.itemNo, unit: row.unit } })
      .then((r) => { if (alive) setState({ loading: false, error: '', data: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), data: null }); });
    return () => { alive = false; };
  }, [row, attempt]);
  const history = [
    { key: 'date', header: 'Tanggal PO', render: (h) => formatDate(h.date), exportValue: (h) => dateExport(h.date) },
    { key: 'poNumber', header: 'PO' },
    { key: 'unitPrice', header: 'Harga', align: 'end', render: (h) => rupiah(h.unitPrice), exportValue: (h) => h.unitPrice },
    { key: 'discPct', header: 'Diskon', align: 'end', render: (h) => (h.discPct ? `${h.discPct}%` : '—'), exportValue: (h) => h.discPct },
  ];
  const others = [
    { key: 'vendorName', header: 'Pemasok' },
    { key: 'unitPrice', header: 'Harga terakhir', align: 'end', render: (r) => rupiah(r.unitPrice), exportValue: (r) => r.unitPrice },
    { key: 'date', header: 'Tanggal PO', render: (r) => formatDate(r.date), exportValue: (r) => dateExport(r.date) },
  ];
  return (
    <SideSheet open={Boolean(row)} onClose={onClose} dataTitle={Boolean(row)} title={row ? `${row.itemName} · ${row.unit}` : 'Harga'}>
      {state.loading ? <LoadingState label="Memuat riwayat harga…" /> : null}
      {state.error ? (
        <EmptyState compact tone="error" title="Riwayat harga belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {state.data ? (
        <div className="pw-stack pw-stack--lg">
          <DataGrid
            title={`Riwayat harga dari ${row.vendorName}`}
            columns={history}
            rows={state.data.history.map((h, i) => ({ ...h, id: i }))}
            searchable={false}
            exportName={`riwayat-harga-${row.itemNo}`}
          />
          <DataGrid
            title={`Pemasok lain (${row.unit})`}
            columns={others}
            rows={state.data.otherVendors.map((o, i) => ({ ...o, id: i }))}
            searchable={false}
            exportName={`pemasok-lain-${row.itemNo}`}
            empty="Belum ada pemasok lain dengan satuan yang sama."
          />
        </div>
      ) : null}
    </SideSheet>
  );
}

export default function ProcurementPrices() {
  const [trend, setTrend] = useState('all');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('');
  const vendorSearch = useDebouncedValue(vendor);
  const [open, setOpen] = useState(null);
  const list = useSalesList('/procurement/prices', { trend: trend === 'all' ? '' : trend, q, vendor: vendorSearch });
  // Only the tab: Prakasa AI never reads purchase prices.
  usePublishPrakasaAIContext({ toolKey: 'procurement', visibleState: { tab: 'prices' } });
  return (
    <div className="pw-stack">
      <DataGrid
        key={trend}
        title="Harga beli"
        showTitle={false}
        columns={COLUMNS}
        rows={list.rows.map((r, i) => ({ ...r, id: `${r.vendorNo}-${r.itemNo}-${r.unit}-${i}` }))}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Kode atau nama barang"
        filters={(
          <>
            {PRICE_TRENDS.map((t) => <Chip key={t.key} selected={trend === t.key} onClick={() => setTrend(t.key)}>{trendChipLabel(t.key, list.meta.counts)}</Chip>)}
            <Input label="Nama atau ID pemasok" value={vendor} onChange={(e) => setVendor(e.target.value)} fieldClassName="pc-filter-field" />
          </>
        )}
        exportName={`harga-beli-${trend}`}
        onRowClick={setOpen}
      />
      <div className="pw-text-helper">Dari baris PO Accurate yang disetujui Head Procurement · harga per satuan, tidak dibandingkan antar-satuan · hanya untuk yang berwenang.</div>
      <PriceSheet row={open} onClose={() => setOpen(null)} />
    </div>
  );
}
