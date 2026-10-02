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
import { PO_STATES, PO_STATUS, chipLabel, dueMeta, formatDate, isPoState, qtyText, receivedText, rupiah } from './procurementModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';

// Purchase orders from approved Accurate data. Quantities in each line's own
// unit; values and prices only for those allowed to see them (P1).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateExport = (value) => (value ? String(value).slice(0, 10) : '');
const cell = (title, meta, metaClass = 'pw-cell__meta') => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className={metaClass}>{meta}</span> : null}
  </span>
);

function orderColumns(prices) {
  return [
    { key: 'date', header: 'Tanggal PO', render: (r) => formatDate(r.date), exportValue: (r) => dateExport(r.date) },
    { key: 'number', header: 'Nomor PO', exportValue: (r) => r.number },
    { key: 'vendorName', header: 'Pemasok', render: (r) => cell(r.vendorName || '—', r.vendorNo), exportValue: (r) => r.vendorName },
    {
      key: 'dueDate', header: 'Diharapkan datang', translate: true,
      render: (r) => cell(formatDate(r.dueDate), dueMeta(r), r.state === 'late' ? 'pw-cell__meta pc-late' : 'pw-cell__meta'),
      exportValue: (r) => dateExport(r.dueDate),
    },
    { key: 'percentReceived', header: 'Diterima', align: 'end', render: receivedText, exportValue: (r) => r.percentReceived },
    { key: 'state', header: 'Status', render: (r) => <StatusBadge status={PO_STATUS[r.state]} />, exportValue: (r) => statusLabel(PO_STATUS[r.state]) },
    { key: 'lineCount', header: 'Baris', align: 'end' },
    ...(prices ? [{ key: 'value', header: 'Nilai sebelum PPN', align: 'end', render: (r) => rupiah(r.value), exportValue: (r) => r.value }] : []),
  ];
}

// A PO has its own number, but no page of its own in the app yet: its detail
// opens in a dialog over the list (also from a deep link, ?po=).
function OrderModal({ order, prices, canSeeReceipts, onClose }) {
  const [state, setState] = useState({ loading: false, error: '', full: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!order) return undefined;
    let alive = true;
    setState({ loading: true, error: '', full: null });
    api.get(`/procurement/orders/${order.id}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', full: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), full: null }); });
    return () => { alive = false; };
  }, [order, attempt]);
  const { full } = state;
  const lineColumns = [
    { key: 'itemName', header: 'Barang', render: (l) => cell(l.itemName || '—', l.itemNo), exportValue: (l) => l.itemName },
    { key: 'qty', header: 'Dipesan', align: 'end', render: (l) => qtyText(l.qty, l.unit), exportValue: (l) => l.qty },
    { key: 'receivedQty', header: 'Diterima', align: 'end', render: (l) => qtyText(l.receivedQty, l.unit), exportValue: (l) => l.receivedQty },
    { key: 'remainingQty', header: 'Sisa', align: 'end', render: (l) => qtyText(l.remainingQty, l.unit), exportValue: (l) => l.remainingQty },
    { key: 'warehouse', header: 'Gudang tujuan', render: (l) => l.warehouse || '—' },
    ...(prices ? [
      { key: 'unitPrice', header: 'Harga satuan', align: 'end', render: (l) => rupiah(l.unitPrice), exportValue: (l) => l.unitPrice },
      { key: 'lineTotal', header: 'Jumlah', align: 'end', render: (l) => rupiah(l.lineTotal), exportValue: (l) => l.lineTotal },
    ] : []),
  ];
  const receiptColumns = [
    { key: 'date', header: 'Tanggal', render: (r) => formatDate(r.date), exportValue: (r) => dateExport(r.date) },
    { key: 'number', header: 'Nomor' },
    { key: 'warehouse', header: 'Gudang', render: (r) => r.warehouse || '—' },
    { key: 'lineCount', header: 'Baris', align: 'end' },
  ];
  return (
    <Modal open={Boolean(order)} onClose={onClose} title={order?.number ? `Purchase order ${order.number}` : full ? `Purchase order ${full.number}` : 'Purchase order'} size="lg">
      {state.loading ? <LoadingState label="Memuat PO…" /> : null}
      {state.error ? (
        <EmptyState tone="error" title="PO belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {full ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue columns={2} items={[
            { label: 'Tanggal PO', value: formatDate(full.date) },
            { label: 'Pemasok', value: `${full.vendorName || '—'}${full.vendorNo ? ` (${full.vendorNo})` : ''}` },
            { label: 'Diharapkan datang', value: <>{formatDate(full.dueDate)}{dueMeta(full) ? <>{' · '}{dueMeta(full)}</> : null}</>, translate: true },
            { label: 'Termin', value: full.paymentTerm || '—' },
            { label: 'Status', value: cell(<StatusBadge status={PO_STATUS[full.state]} />, `Accurate: ${full.status || '—'}`) },
            { label: 'Diterima', value: receivedText(full) },
            ...(prices && full.value ? [
              { label: 'Nilai sebelum PPN', value: rupiah(full.value.dpp) },
              { label: 'PPN', value: rupiah(full.value.tax) },
              { label: 'Total', value: rupiah(full.value.total) },
            ] : []),
          ]}
          />
          <DataGrid title="Barang" columns={lineColumns} rows={full.lines} idKey="lineNo" searchable={false} exportName={`po-${full.number}`} />
          <DataGrid
            title="Penerimaan barang"
            columns={receiptColumns}
            rows={full.receipts}
            searchable={false}
            exportName={`penerimaan-${full.number}`}
            empty={full.percentReceived > 0 ? 'Penerimaan menunggu persetujuan Warehouse.' : 'Belum ada barang datang untuk PO ini.'}
          />
          <div className="pw-text-helper">
            {full.receipts.length && canSeeReceipts ? 'Rincian penerimaan ada di Warehouse → Dokumen Accurate. ' : ''}
            Dari Accurate, setelah disetujui Head Procurement · harga hanya untuk yang berwenang.
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function ProcurementOrders({ status, canSeeReceipts }) {
  const [searchParams] = useSearchParams();
  const initial = searchParams.get('state');
  const [state, setState] = useState(isPoState(initial) ? initial : 'all');
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [from, setFrom] = useState(DATE_RE.test(searchParams.get('from') || '') ? searchParams.get('from') : '');
  const [to, setTo] = useState(DATE_RE.test(searchParams.get('to') || '') ? searchParams.get('to') : '');
  const [open, setOpen] = useState(null);
  const prices = Boolean(status?.prices);
  const list = useSalesList('/procurement/orders', { state: state === 'all' ? '' : state, q, from, to });
  usePublishPrakasaAIContext({ toolKey: 'procurement', visibleState: { tab: 'orders', state: state === 'all' ? '' : state, q, from, to, nomor_po: open?.number || '' } });
  // A deep link from an escalation opens its PO straight away.
  const linked = Number(searchParams.get('po'));
  useEffect(() => { if (linked > 0) setOpen({ id: linked, number: '' }); }, [linked]);

  return (
    <div className="pw-stack">
      <DataGrid
        key={`${state}-${prices}`}
        title="Purchase order"
        showTitle={false}
        columns={orderColumns(prices)}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Nomor PO, pemasok, atau barang"
        filters={(
          <>
            {PO_STATES.map((s) => (
              <Chip key={s.key} selected={state === s.key} onClick={() => setState(s.key)}>{chipLabel(s.key, list.meta.counts)}</Chip>
            ))}
            <DateInput label="Dari" value={from} onChange={(e) => setFrom(e.target.value)} fieldClassName="pc-filter-field" />
            <DateInput label="Sampai" value={to} onChange={(e) => setTo(e.target.value)} fieldClassName="pc-filter-field" />
          </>
        )}
        exportName={`purchase-order-${state}`}
        onRowClick={setOpen}
      />
      <div className="pw-text-helper">Dari Accurate, setelah disetujui Head Procurement{prices ? '' : ' · jumlah dan tanggal saja, tanpa harga'}.</div>
      <OrderModal order={open} prices={prices} canSeeReceipts={canSeeReceipts} onClose={() => setOpen(null)} />
    </div>
  );
}
