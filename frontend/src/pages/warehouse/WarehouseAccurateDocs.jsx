import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { statusLabel } from '../../components/statusTone';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import {
  DOC_TYPES, adjustmentKindLabel, dateOnly, dayText, docTypeLabel, documentsNotice, lineQtyText, referenceText, routeText, transferStatus,
} from './warehouseStockModel';
import { Mixed, Translate, data as dataPart } from '../../i18n/NoTranslate';

// Documents that move goods, from approved Accurate data (Warehouse stage 2):
// surat jalan, penerimaan barang, pindah gudang, penyesuaian stok. Quantities
// only; no address is kept — a surat jalan shows its destination city only.

const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);
const date = { key: 'date', header: 'Tanggal', render: (r) => dayText(r.date), exportValue: (r) => dateOnly(r.date) };
const number = { key: 'number', header: 'Nomor', exportValue: (r) => r.number };
const lineCount = { key: 'lineCount', header: 'Baris', align: 'end' };

const COLUMNS = {
  delivery: [
    date, number,
    { key: 'party', header: 'Pelanggan', render: (r) => cell(r.party || '—', r.channel), exportValue: (r) => r.party },
    { key: 'refs', header: 'No. SO', render: referenceText, exportValue: referenceText },
    lineCount, { key: 'status', header: 'Status' },
  ],
  receipt: [
    date, number,
    { key: 'party', header: 'Pemasok' },
    { key: 'supplierDo', header: 'No. SJ pemasok' },
    { key: 'refs', header: 'PO', render: referenceText, exportValue: referenceText },
    lineCount, { key: 'status', header: 'Status' },
  ],
  transfer: [
    date, number,
    { key: 'route', header: 'Dari → Ke', render: (r) => routeText(r), exportValue: routeText },
    { key: 'moving', header: 'Status', render: (r) => <StatusBadge status={transferStatus(r)} />, exportValue: (r) => statusLabel(transferStatus(r)) },
    lineCount,
  ],
  adjustment: [
    date, number,
    { key: 'kind', header: 'Jenis', translate: true, render: (r) => adjustmentKindLabel(r.kind), exportValue: (r) => adjustmentKindLabel(r.kind) },
    lineCount,
  ],
};

// A document has its own number, but no page of its own in the app yet: its
// detail opens in a dialog (also from the Cocokkan Accurate sheet).
export function DocumentModal({ doc, onClose }) {
  const [state, setState] = useState({ loading: false, error: '', full: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!doc) return undefined;
    let alive = true;
    setState({ loading: true, error: '', full: null });
    api.get(`/warehouse/documents/${doc.type}/${doc.id}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', full: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), full: null }); });
    return () => { alive = false; };
  }, [doc, attempt]);
  const { full } = state;
  const lineColumns = [
    { key: 'itemName', header: 'Barang', render: (l) => cell(l.itemName, l.itemNo), exportValue: (l) => l.itemName },
    { key: 'qty', header: 'Jumlah', translateContext: 'quantity', align: 'end', render: lineQtyText, exportValue: (l) => l.qty },
    ...(full?.type === 'transfer'
      ? [{ key: 'receivedQty', header: 'Diterima', align: 'end', render: (l) => (l.receivedQty === null ? '—' : lineQtyText({ qty: l.receivedQty, unit: l.unit })) }]
      : [{ key: 'warehouse', header: 'Gudang', render: (l) => l.warehouse || '—' }]),
    ...(full?.type === 'adjustment' ? [{ key: 'direction', header: 'Arah', translate: true, translateContext: 'direction', render: (l) => (l.direction === 'out' ? 'Keluar' : 'Masuk') }] : []),
  ];
  return (
    <Modal open={Boolean(doc)} onClose={onClose} title={doc ? <Mixed separator=" " parts={[docTypeLabel(doc.type), dataPart(doc.number)]} /> : 'Dokumen'} size="lg">
      {state.loading ? <LoadingState label="Memuat dokumen…" /> : null}
      {state.error ? (
        <EmptyState tone="error" title="Dokumen belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {full ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue columns={2} items={[
            { label: 'Tanggal', value: dayText(full.date) },
            // Adjustments have no status of their own worth showing (Accurate's approval code).
            ...(full.type === 'adjustment' ? [] : [{ label: 'Status', value: full.type === 'transfer' ? <StatusBadge status={transferStatus(full)} /> : full.status }]),
            ...(full.party ? [{ label: full.type === 'receipt' ? 'Pemasok' : 'Pelanggan', value: full.party }] : []),
            // No address is kept in the app; the full address is on the Accurate delivery order.
            ...(full.type === 'delivery' ? [{ label: 'Tujuan', value: <>{full.destination ? full.destination.name : '—'}{' · '}<Translate>alamat lengkap di surat jalan Accurate</Translate></> }] : []),
            ...(full.type === 'transfer' ? [{ label: 'Dari → Ke', value: routeText(full) }] : []),
            ...(full.type === 'adjustment' ? [{ label: 'Jenis', value: adjustmentKindLabel(full.kind), translate: true }] : []),
            ...(full.supplierDo ? [{ label: 'No. SJ pemasok', value: full.supplierDo }] : []),
            ...(full.soNumbers.length || full.poNumbers.length ? [{ label: full.type === 'receipt' ? 'PO' : 'No. SO', value: referenceText(full) }] : []),
          ]}
          />
          <DataGrid title="Barang" columns={lineColumns} rows={full.lines} idKey="lineNo" searchable={false} exportName={`dokumen-${full.number}`} />
        </div>
      ) : null}
    </Modal>
  );
}

// A date from the URL (the Today tab links here), only as YYYY-MM-DD.
const dateParam = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '');

export default function WarehouseAccurateDocs() {
  const [searchParams] = useSearchParams();
  const [type, setType] = useState(DOC_TYPES.some((d) => d.key === searchParams.get('type')) ? searchParams.get('type') : 'delivery');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [inTransit, setInTransit] = useState(searchParams.get('status') === 'in_transit');
  const [status, setStatus] = useState(null);
  const [from, setFrom] = useState(dateParam(searchParams.get('from')));
  const [to, setTo] = useState(dateParam(searchParams.get('to')));
  const [warehouse, setWarehouse] = useState('');
  const [warehouses, setWarehouses] = useState([]);
  const [open, setOpen] = useState(null);
  const list = useSalesList('/warehouse/documents', { type, q, from, to, warehouse, status: type === 'transfer' && inTransit ? 'in_transit' : '' });

  // The gudang list and the "not ready yet" banner; the list shows its own error.
  useEffect(() => {
    let alive = true;
    api.get('/warehouse/accurate/status')
      .then((r) => { if (alive) { setWarehouses(r.data.data?.warehouses || []); setStatus(r.data.data || null); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const notice = documentsNotice(status);
  return (
    <div className="pw-stack">
      {notice ? <Banner tone="info" title={notice.title}>{notice.body}</Banner> : null}
      <DataGrid
        key={type}
        title={docTypeLabel(type)}
        showTitle={false}
        columns={COLUMNS[type]}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Nomor dokumen, pelanggan atau pemasok"
        filters={(
          <>
            {DOC_TYPES.map((d) => (
              <Chip key={d.key} selected={type === d.key} onClick={() => setType(d.key)}>{docTypeLabel(d.key, list.meta.counts)}</Chip>
            ))}
            {type === 'transfer' ? (
              <Chip selected={inTransit} onClick={() => setInTransit((v) => !v)}>Hanya dalam perjalanan</Chip>
            ) : null}
            <DateInput label="Dari" value={from} onChange={(e) => setFrom(e.target.value)} fieldClassName="wh-filter-date" />
            <DateInput label="Sampai" value={to} onChange={(e) => setTo(e.target.value)} fieldClassName="wh-filter-date" />
            <Select
              label="Gudang"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              options={warehouses.map((w) => ({ value: w.name, label: w.name }))}
              dataOptions
              placeholder="Semua gudang"
              fieldClassName="wh-filter-select"
            />
          </>
        )}
        exportName={`dokumen-gudang-${type}`}
        onRowClick={(row) => setOpen(row)}
      />
      <div className="pw-text-helper">Dari Accurate, setelah disetujui Supervisor atau Head Warehouse · jumlah saja, tanpa harga.</div>
      <DocumentModal doc={open} onClose={() => setOpen(null)} />
    </div>
  );
}
