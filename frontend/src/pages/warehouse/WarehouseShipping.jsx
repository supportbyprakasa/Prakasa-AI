import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { statusLabel } from '../../components/statusTone';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import {
  SHIPPING_FILTERS, SHIPPING_STOCK, dateOnly, dayText, legacySoText, lineQtyText, promiseSourceText, shipLateText, shippingChipLabel, shippingFilterFrom,
} from './warehouseStockModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';

// "Jadwal kirim" (program 2.2): sales orders not fully shipped, from approved
// Accurate data, with Accurate's stock given to the earliest promise first
// ("Janji kirim", program 3.4). Quantities only; the full address stays on
// the Accurate order.
const cell = (title, ...meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta.filter(Boolean).map((line) => <span key={line} className="pw-cell__meta">{line}</span>)}
  </span>
);

const columns = (otifFrom) => [
  {
    key: 'promisedDate', header: 'Janji kirim', translate: true,
    render: (r) => cell(dayText(r.promisedDate), shipLateText(r) || promiseSourceText(r), r.legacy ? legacySoText(r, dayText(otifFrom)) : ''),
    exportValue: (r) => dateOnly(r.promisedDate),
  },
  { key: 'number', header: 'Nomor SO', exportValue: (r) => r.number },
  { key: 'customerName', header: 'Pelanggan', render: (r) => cell(r.customerName || '—', r.channel), exportValue: (r) => r.customerName },
  { key: 'openLines', header: 'Baris belum dikirim', align: 'end' },
  { key: 'stock', header: 'Stok', render: (r) => <StatusBadge status={SHIPPING_STOCK[r.stock]} />, exportValue: (r) => statusLabel(SHIPPING_STOCK[r.stock]) },
];

// An SO has its own number, but no page of its own in the app yet: its detail
// opens in a dialog over the list.
function ShippingModal({ so, onClose }) {
  const [state, setState] = useState({ loading: false, error: '', full: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!so) return undefined;
    let alive = true;
    setState({ loading: true, error: '', full: null });
    api.get(`/warehouse/shipping/${so.id}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', full: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), full: null }); });
    return () => { alive = false; };
  }, [so, attempt]);
  const { full } = state;
  const lineColumns = [
    { key: 'itemName', header: 'Barang', render: (l) => cell(l.itemName || '—', l.itemNo), exportValue: (l) => l.itemName },
    { key: 'qty', header: 'Dipesan', align: 'end', render: lineQtyText, exportValue: (l) => l.qty },
    { key: 'shippedQty', header: 'Terkirim', align: 'end', render: (l) => lineQtyText({ qty: l.shippedQty, unit: l.unit }), exportValue: (l) => l.shippedQty },
    { key: 'remainingQty', header: 'Sisa', align: 'end', render: (l) => lineQtyText({ qty: l.remainingQty, unit: l.unit }), exportValue: (l) => l.remainingQty },
    { key: 'enough', header: 'Stok', render: (l) => <StatusBadge status={SHIPPING_STOCK[l.enough ? 'enough' : 'short']} />, exportValue: (l) => (l.enough ? 'cukup' : 'kurang') },
    { key: 'warehouse', header: 'Gudang', render: (l) => l.warehouse || '—' },
  ];
  return (
    <Modal open={Boolean(so)} onClose={onClose} title={so ? `SO ${so.number}` : 'SO'} size="lg">
      {state.loading ? <LoadingState label="Memuat SO…" /> : null}
      {state.error ? (
        <EmptyState tone="error" title="SO belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {full ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue columns={2} items={[
            { label: 'Janji kirim', value: <>{dayText(full.promisedDate)}{' · '}{shipLateText(full) || promiseSourceText(full)}</>, translate: true },
            { label: 'Tgl kirim Accurate', value: dayText(full.shipDate) },
            { label: 'Pelanggan', value: `${full.customerName || '—'}${full.channel ? ` · ${full.channel}` : ''}` },
            { label: 'Tanggal SO', value: dayText(full.date) },
            { label: 'Stok', value: full.shortLines ? `${full.shortLines} baris kurang` : 'Cukup untuk semua baris', translate: true },
          ]}
          />
          <DataGrid title="Barang" columns={lineColumns} rows={full.lines} idKey="lineNo" searchable={false} exportName={`jadwal-kirim-${full.number}`} />
          <div className="pw-text-helper">Stok dari Accurate dibagi ke SO dengan janji kirim paling awal lebih dulu. Alamat lengkap ada di SO Accurate.</div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function WarehouseShipping() {
  // A deep link from the escalation "SO lewat janji kirim" lands filtered.
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState(shippingFilterFrom(searchParams.get('status')));
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(null);
  const list = useSalesList('/warehouse/shipping', { status: filter === 'all' ? '' : filter, q, from, to });
  // What is on screen, for Prakasa AI (filters and the SO open in the modal — never prices).
  usePublishPrakasaAIContext({ toolKey: 'warehouse', visibleState: { tab: 'shipping', status: filter === 'all' ? '' : filter, q, from, to, nomor_so: open?.number || '' } });
  return (
    <div className="pw-stack">
      <DataGrid
        key={filter}
        title="Jadwal kirim"
        showTitle={false}
        columns={columns(list.meta.otifFrom)}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Nomor SO atau pelanggan"
        filters={(
          <>
            {SHIPPING_FILTERS.map((f) => <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>{shippingChipLabel(f.key, list.meta.counts)}</Chip>)}
            <DateInput label="Janji kirim dari" value={from} onChange={(e) => setFrom(e.target.value)} fieldClassName="wh-filter-date" />
            <DateInput label="Janji kirim sampai" value={to} onChange={(e) => setTo(e.target.value)} fieldClassName="wh-filter-date" />
          </>
        )}
        exportName={`jadwal-kirim-${filter}`}
        onRowClick={setOpen}
      />
      <div className="pw-text-helper">Janji kirim = Tgl kirim di SO Accurate bila diisi setelah tanggal SO; bila tidak, standar 2×24 jam dari tanggal SO (hari Minggu digeser ke Senin). Stok dibagi ke janji kirim paling awal lebih dulu · dari Accurate, setelah disetujui Supervisor atau Head Warehouse · jumlah saja, tanpa harga.</div>
      <ShippingModal so={open} onClose={() => setOpen(null)} />
    </div>
  );
}
