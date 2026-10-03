import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import AccurateWriteForm from './AccurateWriteForm';
import {
  ACTION_LABEL, KIND_LABEL, KIND_STATUS, RECORD_LABEL, STATUS_FILTERS, requestStatus,
} from './accurateWriteModel';

// Pengajuan ke Accurate: every proposal of the company, newest first, with
// what happens next. Opened from Data Accurate; the detail page decides.
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);

const COLUMNS = [
  { key: 'title', header: 'Pengajuan', render: (r) => cell(r.name || r.title, r.number), exportValue: (r) => r.title },
  { key: 'recordType', header: 'Jenis', translate: true, render: (r) => `${RECORD_LABEL[r.recordType] || r.recordType} · ${ACTION_LABEL[r.action] || r.action}`, exportValue: (r) => RECORD_LABEL[r.recordType] || r.recordType },
  { key: 'departmentName', header: 'Divisi', translate: true },
  { key: 'requestedByName', header: 'Diajukan oleh' },
  { key: 'createdAt', header: 'Tanggal', type: 'datetime' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => { const s = requestStatus(r.status); return <StatusBadge status={s.status} label={s.label} />; },
    exportValue: (r) => requestStatus(r.status).label,
  },
];

export function AccurateWriteRequestList() {
  const { user } = useAuth();
  const canPropose = (user?.permissions || []).includes('accurate.write.request');
  const [params, setParams] = useSearchParams();
  const status = STATUS_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : 'open';
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const list = useSalesList('/accurate-write/requests', { status, q });
  const setStatus = (key) => setParams((p) => { const next = new URLSearchParams(p); if (key) next.set('status', key); else next.delete('status'); return next; }, { replace: true });
  const [sendInfo, setSendInfo] = useState(null);
  useEffect(() => {
    // Whether the send channel is on: said once, above the list.
    if (!list.rows.length || sendInfo !== null) return;
    api.get(`/accurate-write/requests/${list.rows[0].id}`).then((r) => setSendInfo(Boolean(r.data.data.sendEnabled))).catch(() => setSendInfo(false));
  }, [list.rows, sendInfo]);
  return (
    <div className="pw-stack pw-stack--lg">
      {sendInfo === false ? (
        <Banner tone="warning" title="Saluran kirim ke Accurate belum dinyalakan">
          Pengajuan yang disetujui menunggu di antrean dan belum ada yang dikirim. Accurate tetap sumber kebenaran: data baru dianggap selesai setelah tarikan berikutnya menampilkannya.
        </Banner>
      ) : null}
      <DataGrid
        title="Pengajuan ke Accurate"
        columns={COLUMNS}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nama atau nomor"
        filters={STATUS_FILTERS.map((f) => <Chip key={f.key || 'all'} selected={status === f.key} onClick={() => setStatus(f.key)}>{f.label}</Chip>)}
        toolbarActions={canPropose ? (
          <>
            <Button variant="secondary" icon="person_add" onClick={() => setForm({ recordType: 'customer' })}>Pelanggan baru</Button>
            <Button variant="secondary" icon="local_shipping" onClick={() => setForm({ recordType: 'vendor' })}>Pemasok baru</Button>
          </>
        ) : null}
        exportName={`pengajuan-accurate-${status || 'semua'}`}
        rowActions={(r) => <IconButton size="sm" icon="visibility" label="Lihat pengajuan" to={`/data-accurate/pengajuan/${r.id}`} />}
        empty={status === 'open' ? 'Tidak ada pengajuan yang belum selesai' : 'Tidak ada pengajuan untuk filter ini'}
      />
      <AccurateWriteForm open={Boolean(form)} recordType={form?.recordType} action="create" onClose={() => setForm(null)} onSaved={list.reload} />
    </div>
  );
}

// Selisih pelanggan: app customers the approved Accurate mirror lacks or names
// differently, each with a button to propose it. Read-only against both sides.
export function AccurateCustomerReconciliation() {
  const { user } = useAuth();
  const canPropose = (user?.permissions || []).includes('accurate.write.request');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const list = useSalesList('/accurate-write/reconciliation', { kind, q });
  const loadSummary = useCallback(async () => {
    try {
      const r = await api.get('/accurate-write/reconciliation', { params: { limit: 1 } });
      setSummary(r.data.meta?.summary || null);
      setError('');
    } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const columns = [
    { key: 'name', header: 'Pelanggan di aplikasi', render: (r) => cell(r.name, r.customerCode), exportValue: (r) => r.name },
    { key: 'kind', header: 'Selisih', translate: true, render: (r) => <StatusBadge status={KIND_STATUS[r.kind]} label={KIND_LABEL[r.kind]} />, exportValue: (r) => KIND_LABEL[r.kind] },
    { key: 'accurateName', header: 'Nama di Accurate', render: (r) => r.accurateName || '—' },
    {
      key: 'request', header: 'Pengajuan', translate: true,
      render: (r) => (r.request ? <StatusBadge status={requestStatus(r.request.status).status} label={requestStatus(r.request.status).label} /> : '—'),
      exportValue: (r) => (r.request ? requestStatus(r.request.status).label : ''),
    },
  ];
  const rows = list.rows;
  return (
    <div className="pw-stack pw-stack--lg">
      <Banner tone="info">
        Dibandingkan per ID pelanggan antara pelanggan di aplikasi dan data Accurate yang sudah disetujui. Accurate tetap sumber kebenaran: selisih diselesaikan dengan mengajukan data ke Accurate, bukan mengubah aplikasi.
        {summary ? ` Pelanggan di aplikasi: ${summary.customers} · sama: ${summary.matched} · belum ada di Accurate: ${summary.missing} · nama berbeda: ${summary.differs}.` : ''}
      </Banner>
      {error ? <EmptyState tone="error" title="Ringkasan belum bisa dimuat" description={error} action={<Button variant="text" onClick={loadSummary}>Coba lagi</Button>} /> : null}
      <DataGrid
        title="Selisih pelanggan"
        columns={columns}
        rows={rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nama atau ID pelanggan"
        filters={[['', 'Semua'], ['missing', 'Belum ada di Accurate'], ['name', 'Nama berbeda']].map(([k, l]) => (
          <Chip key={k || 'all'} selected={kind === k} onClick={() => setKind(k)}>{l}</Chip>
        ))}
        exportName="selisih-pelanggan-accurate"
        rowActions={(r) => (
          <>
            <IconButton size="sm" icon="visibility" label="Lihat pelanggan" to={`/sales/customers/${r.id}`} />
            {r.request ? <IconButton size="sm" icon="fact_check" label="Lihat pengajuan" to={`/data-accurate/pengajuan/${r.request.id}`} /> : null}
            {canPropose && !r.request ? (
              <IconButton
                size="sm" icon="send" label="Ajukan ke Accurate"
                onClick={() => setForm(r.kind === 'missing'
                  ? { action: 'create', localId: r.id, initial: r.payload }
                  : { action: 'update', accurateId: r.accurateId, localId: r.id, initial: { ...r.payload, number: r.customerCode } })}
              />
            ) : null}
          </>
        )}
        empty="Tidak ada selisih: setiap pelanggan di aplikasi ada di Accurate dengan nama yang sama."
      />
      <AccurateWriteForm
        open={Boolean(form)} recordType="customer" action={form?.action} accurateId={form?.accurateId} localId={form?.localId} initial={form?.initial}
        onClose={() => setForm(null)} onSaved={() => { list.reload(); loadSummary(); }}
      />
    </div>
  );
}
