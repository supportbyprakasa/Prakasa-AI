import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { statusLabel } from '../../components/statusTone';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import { PO_STATUS, VENDOR_FILTERS, daysText, formatDate, rateText, receivedText, rupiah } from './procurementModel';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { useAuth } from '../../context/AuthContext';
import AccurateWriteForm from '../accurate/AccurateWriteForm';

// Vendors from approved Accurate data: only what the vendor list gives. Contact,
// address, NPWP, KTP and bank data are never taken from Accurate.
const dateExport = (value) => (value ? String(value).slice(0, 10) : '');
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

function vendorColumns(prices) {
  return [
    { key: 'name', header: 'Pemasok', render: (r) => cell(r.name, r.vendorNo), exportValue: (r) => r.name },
    { key: 'category', header: 'Kategori', render: (r) => r.category || '—' },
    { key: 'openCount', header: 'PO terbuka', align: 'end' },
    // A late PO is a count, not a status: the number turns the error colour.
    { key: 'lateCount', header: 'Terlambat', align: 'end', render: (r) => (r.lateCount ? <span className="pc-late">{r.lateCount}</span> : '0'), exportValue: (r) => r.lateCount },
    { key: 'fillRate', header: 'Fill rate 90 hari', align: 'end', render: (r) => rateText(r.fillRate), exportValue: (r) => r.fillRate },
    { key: 'onTimeRate', header: 'Tepat waktu 90 hari', align: 'end', render: (r) => rateText(r.onTimeRate), exportValue: (r) => r.onTimeRate },
    { key: 'leadTimeDays', header: 'Rata-rata datang', align: 'end', translate: true, render: (r) => daysText(r.leadTimeDays), exportValue: (r) => r.leadTimeDays },
    { key: 'lastPoDate', header: 'PO terakhir', render: (r) => formatDate(r.lastPoDate), exportValue: (r) => dateExport(r.lastPoDate) },
    { key: 'status', header: 'Status', translate: true, render: (r) => r.status },
    ...(prices ? [{ key: 'spend12m', header: 'Nilai PO 12 bulan', align: 'end', render: (r) => rupiah(r.spend12m), exportValue: (r) => r.spend12m }] : []),
  ];
}

// A vendor has its own ID, but no page of its own in the app yet: its detail
// opens in a dialog over the list.
function VendorModal({ vendor, prices, onClose, onPropose }) {
  const [state, setState] = useState({ loading: false, error: '', full: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!vendor) return undefined;
    let alive = true;
    setState({ loading: true, error: '', full: null });
    api.get(`/procurement/vendors/${vendor.id}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', full: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), full: null }); });
    return () => { alive = false; };
  }, [vendor, attempt]);
  const { full } = state;
  const orderColumns = [
    { key: 'date', header: 'Tanggal', render: (o) => formatDate(o.date), exportValue: (o) => dateExport(o.date) },
    { key: 'number', header: 'Nomor PO' },
    { key: 'dueDate', header: 'Diharapkan', render: (o) => formatDate(o.dueDate), exportValue: (o) => dateExport(o.dueDate) },
    { key: 'percentReceived', header: 'Diterima', align: 'end', render: receivedText, exportValue: (o) => o.percentReceived },
    { key: 'state', header: 'Status', render: (o) => <StatusBadge status={PO_STATUS[o.state]} />, exportValue: (o) => statusLabel(PO_STATUS[o.state]) },
  ];
  const priceColumns = [
    { key: 'itemName', header: 'Barang', render: (p) => cell(p.itemName, p.itemNo), exportValue: (p) => p.itemName },
    { key: 'unit', header: 'Satuan' },
    { key: 'unitPrice', header: 'Harga terakhir', align: 'end', render: (p) => rupiah(p.unitPrice), exportValue: (p) => p.unitPrice },
    { key: 'date', header: 'Tanggal PO', render: (p) => formatDate(p.date), exportValue: (p) => dateExport(p.date) },
    { key: 'poNumber', header: 'PO' },
  ];
  return (
    <Modal open={Boolean(vendor)} onClose={onClose} dataTitle={Boolean(vendor)} title={vendor ? vendor.name : 'Pemasok'} size="lg">
      {state.loading ? <LoadingState label="Memuat pemasok…" /> : null}
      {state.error ? (
        <EmptyState tone="error" title="Pemasok belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</Button>} />
      ) : null}
      {full ? (
        <div className="pw-stack pw-stack--lg">
          <KeyValue columns={2} items={[
            { label: 'ID pemasok', value: full.vendorNo },
            { label: 'Kategori', value: full.category || '—' },
            { label: 'Status', value: full.status, translate: true },
            { label: 'PO terbuka', value: `${full.openCount} (terlambat ${full.lateCount})`, translate: true },
            { label: 'Fill rate 90 hari', value: rateText(full.fillRate) },
            { label: 'Tepat waktu 90 hari', value: rateText(full.onTimeRate) },
            { label: 'Rata-rata waktu datang', value: daysText(full.leadTimeDays), translate: true },
            ...(prices ? [{ label: 'Nilai PO 12 bulan', value: rupiah(full.spend12m) }] : []),
          ]}
          />
          <DataGrid title="PO terakhir" columns={orderColumns} rows={full.orders} searchable={false} exportName={`po-${full.vendorNo}`} empty="Belum ada PO." />
          {prices && full.lastPrices?.length ? (
            <DataGrid title="Harga terakhir per barang" columns={priceColumns} rows={full.lastPrices.map((p, i) => ({ ...p, id: i }))} searchable={false} exportName={`harga-${full.vendorNo}`} />
          ) : null}
          <div className="pw-text-helper">Kontak, alamat, NPWP, KTP, dan rekening pemasok tidak diambil dari Accurate — lihat di Accurate.</div>
          {onPropose ? (
            <div className="pw-row">
              <Button variant="secondary" icon="send" onClick={() => onPropose(full)}>Ajukan perubahan ke Accurate</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export default function ProcurementVendors({ status }) {
  const { user } = useAuth();
  const canPropose = (user?.permissions || []).includes('accurate.write.request');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  // "Ajukan ke Accurate": a new vendor, or a change to one (decided by the
  // Procurement Supervisor/Head; nothing is sent from here).
  const [propose, setPropose] = useState(null);
  const prices = Boolean(status?.prices);
  const list = useSalesList('/procurement/vendors', { filter: filter === 'all' ? '' : filter, q });
  usePublishPrakasaAIContext({ toolKey: 'procurement', visibleState: { tab: 'vendors', filter: filter === 'all' ? '' : filter, q, kode_pemasok: open?.vendorNo || '' } });
  return (
    <div className="pw-stack">
      <DataGrid
        key={`${filter}-${prices}`}
        title="Pemasok"
        showTitle={false}
        columns={vendorColumns(prices)}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Nama atau ID pemasok"
        filters={VENDOR_FILTERS.map((f) => <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Chip>)}
        exportName={`pemasok-${filter}`}
        onRowClick={setOpen}
        toolbarActions={canPropose ? <Button variant="secondary" icon="send" onClick={() => setPropose({ action: 'create' })}>Ajukan pemasok baru</Button> : null}
      />
      <div className="pw-text-helper">Kontak, alamat, NPWP, KTP, dan rekening pemasok tidak diambil dari Accurate.</div>
      <VendorModal
        vendor={open} prices={prices} onClose={() => setOpen(null)}
        onPropose={canPropose ? (full) => { setOpen(null); setPropose({ action: 'update', accurateId: String(full.id), initial: { number: full.vendorNo, name: full.name, category: full.category || '' } }); } : null}
      />
      <AccurateWriteForm
        open={Boolean(propose)} recordType="vendor" action={propose?.action} accurateId={propose?.accurateId} initial={propose?.initial}
        onClose={() => setPropose(null)}
      />
    </div>
  );
}
