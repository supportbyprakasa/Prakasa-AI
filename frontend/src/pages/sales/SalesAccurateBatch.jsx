import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import ReasonDialog from '../../components/ReasonDialog';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime } from '../../components/format';
import { toast } from '../../components/Toast';
import { stockCheckLines } from '../warehouse/warehouseStockModel';
import { procurementCheckLines } from '../procurement/procurementModel';
import { apiError, formatCount, formatRupiah } from './salesModel';
import {
  ACTION_LABEL, ACTION_STATUS, BATCH_STATUS, RECORD_LABEL, describeChange, describeChangeParts, summaryLines,
} from './accurateBatchModel';
import { Mixed, Translate, data } from '../../i18n/NoTranslate';
import { resetSalesScope } from './SalesScopeBanner';
import useSalesList from './useSalesList';
import FilterMenuChip from './FilterMenuChip';
import AccurateBatchReview from './AccurateBatchReview';
import { salesChanged } from '../../components/useSalesActionBadge';
import './sales.css';

// Data Accurate waits here until the division's Supervisor or Head approves it.
// Approving applies every change in the batch at once; rejecting changes
// nothing, and the next pull from Accurate brings the differences again.

const status = (s) => BATCH_STATUS[s] || { status: s };
const summaryText = (summary) => summaryLines(summary).map((l) => `${l.label}: ${l.text}`).join(' · ');

// ------------------------------------------------------------------ list (Data Sales → Data Accurate)

// The last pull from Accurate, and a button to start one. A pull only reads
// Accurate and prepares batches; nothing is used until a batch is approved.
// endpoint: which pull — Sales (default) or Warehouse (/warehouse/accurate/sync).
function SyncPanel({ onFinished, endpoint = '/sales/accurate/sync' }) {
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.get(endpoint);
      setRun(r.data.data);
      return r.data.data;
    } catch { return null; }
  }, [endpoint]);
  useEffect(() => { load(); }, [load]);
  const running = Boolean(run?.running) || starting;
  useEffect(() => {
    if (!run?.running) return undefined;
    const timer = setInterval(async () => {
      const latest = await load();
      if (latest && !latest.running) onFinished?.();
    }, 5000);
    return () => clearInterval(timer);
  }, [run?.running, load, onFinished]);
  const start = async () => {
    setStarting(true);
    try {
      await api.post(endpoint);
      toast('Menarik data dari Accurate (hanya membaca). Tarikan pertama bisa beberapa menit.', 'info');
      await load();
    } catch (err) {
      toast(apiError(err, 'Tarikan dari Accurate gagal dimulai'), 'error');
    } finally { setStarting(false); }
  };
  const stats = run?.stats;
  const summary = stats?.changes ? summaryText({ counts: stats.changes }) : null;
  let last = '';
  if (run && !running) {
    const outcome = run.status === 'failed' ? `gagal: ${run.errorMessage}`
      : run.status === 'skipped' ? 'dilewati, masih ada batch yang menunggu keputusan'
        : (summary || 'tidak ada perubahan');
    last = ` Terakhir: ${formatDateTime(run.finishedAt || run.startedAt)}${run.triggeredBy ? ` oleh ${run.triggeredBy}` : ''}, ${outcome}.`;
  }
  return (
    <Banner
      tone={run?.status === 'failed' ? 'error' : 'info'}
      title={running ? 'Sedang menarik data dari Accurate…' : 'Sinkron otomatis dengan Accurate'}
      action={<Button variant="secondary" icon="cloud_download" onClick={start} loading={running}>Tarik sekarang</Button>}
    >
      Perubahan di Accurate ditarik otomatis setiap 5 menit dan diajukan sebagai batch; begitu disetujui, data langsung tampil di aplikasi.
      Hanya membaca Accurate: tidak ada data yang diubah atau dihapus, di Accurate maupun di aplikasi.
      {last}
    </Banner>
  );
}

const BATCH_FILTERS = [{ value: '', label: 'Semua' }, ...Object.entries(BATCH_STATUS).map(([value, s]) => ({ value, label: s.label }))];

// detailBase: where a batch opens — inside Data Sales, or on the division-wide
// Data Accurate page. The pull button is for whoever may start a pull.
// division: only that division's batches (e.g. inside the Warehouse module).
// A row opens its batch (a Data Accurate list, not a Sales one).
export function AccurateBatchList({
  detailBase = '/sales/orders/accurate', canPull = true, division = '', syncEndpoint, note,
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const list = useSalesList('/sales/accurate/batches', { status: filter, division });
  const columns = [
    // A real link: opens in a new tab and copies like any link.
    { key: 'id', header: 'Batch', render: (r) => <Link to={`${detailBase}/${r.id}`}>#{r.id}</Link>, exportValue: (r) => r.id, nowrap: true },
    { key: 'createdAt', header: 'Ditarik', type: 'datetime' },
    { key: 'departmentName', header: 'Divisi', translate: true },
    {
      key: 'summary', header: 'Isi', translate: true,
      render: (r) => summaryText(r.summary) || `${formatCount(r.itemCount)} perubahan`,
      exportValue: (r) => summaryText(r.summary),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge {...status(r.status)} />, exportValue: (r) => status(r.status).label || r.status, nowrap: true },
    { key: 'decidedByName', header: 'Diputuskan oleh' },
  ];
  return (
    <div className="pw-stack">
      {canPull ? <SyncPanel onFinished={list.reload} endpoint={syncEndpoint} /> : null}
      <DataGrid
        title="Batch"
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        searchable={false}
        filters={BATCH_FILTERS.map((f) => (
          <Chip key={f.value || 'all'} selected={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Chip>
        ))}
        onRowClick={(r) => navigate(`${detailBase}/${r.id}`)}
        rowActions={(r) => (
          <IconButton
            size="sm"
            icon={r.status === 'pending' ? 'fact_check' : 'visibility'}
            label={r.status === 'pending' ? 'Periksa & putuskan' : 'Lihat detail'}
            to={`${detailBase}/${r.id}`}
          />
        )}
        exportName="data-accurate"
        empty="Belum ada data dari Accurate. Batch muncul di sini setelah integrasi Accurate menarik data."
      />
      <p className="pw-text-helper">
        {note || `Data dari Accurate baru dipakai di aplikasi setelah disetujui Supervisor atau Head divisinya. Satu batch per tarikan per divisi:
        pelanggan Shopee/Tokopedia ke Retail Commerce, sisanya ke Sales.`}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ detail

// "Yang berubah": the column names are interface text, the values are record
// data from Accurate (never translated).
function changeCell(item) {
  const { note, changes, more } = describeChangeParts(item);
  if (note) return <Translate>{note}</Translate>;
  return (
    <>
      {changes.map((c, index) => (
        <span key={c.field}>{index ? ' · ' : ''}<Translate>{c.label}</Translate>{c.translate ? <>{': '}<Mixed parts={c.values} separator=" → " /></> : `: ${c.value}`}</span>
      ))}
      {more ? <>{' · '}<Translate>{`+${more} kolom lain (lihat ekspor)`}</Translate></> : null}
    </>
  );
}

const ITEM_COLUMNS = [
  { key: 'recordType', header: 'Jenis', translate: true, render: (r) => RECORD_LABEL[r.recordType] || r.recordType, exportValue: (r) => RECORD_LABEL[r.recordType] || r.recordType },
  {
    key: 'action', header: 'Perubahan', nowrap: true,
    render: (r) => <StatusBadge status={ACTION_STATUS[r.action]} label={ACTION_LABEL[r.action]} />,
    exportValue: (r) => ACTION_LABEL[r.action],
  },
  {
    key: 'externalKey', header: 'Data',
    render: (r) => (
      <span className="pw-cell sales-accurate__key">
        <span className="pw-cell__title">{r.label || r.externalKey}</span>
        {r.label && r.label !== r.externalKey && !/^\d+$/.test(r.externalKey) ? <span className="pw-cell__meta">{r.externalKey}</span> : null}
      </span>
    ),
  },
  { key: 'detail', header: 'Yang berubah', render: (r) => <span className="sales-accurate__change">{changeCell(r)}</span>, exportValue: (r) => describeChange(r, { full: true }) },
  { key: 'amount', header: 'Nilai', type: 'money' },
];

const RECORD_FILTERS = [{ value: '', label: 'Semua' }, ...Object.entries(RECORD_LABEL).map(([value, label]) => ({ value, label }))];
const ACTION_FILTERS = [{ value: '', label: 'Semua' }, ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))];

export default function SalesAccurateBatch() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true, error: '', batch: null, steps: [] });
  const [recordType, setRecordType] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState('');
  const [deciding, setDeciding] = useState(false);
  const items = useSalesList(`/sales/accurate/batches/${id}/items`, { recordType, action, q });

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/sales/accurate/batches/${id}`);
      const batch = r.data.data;
      let steps = [];
      if (batch.status === 'pending' && batch.approvalRequestId) {
        steps = await api.get(`/approvals/${batch.approvalRequestId}/my-pending-steps`).then((s) => s.data.data || []).catch(() => []);
      }
      setState({ loading: false, error: '', batch, steps });
    } catch (err) {
      setState({ loading: false, error: apiError(err), batch: null, steps: [] });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const retry = () => { setState((s) => ({ ...s, loading: true, error: '' })); load(); };
  // A document number picked in the review: shown in the batch's own list.
  const gridRef = useRef(null);
  const pickDocument = useCallback((number) => {
    setRecordType(''); setAction(''); setQ(number);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const decide = async (decision, note) => {
    setDeciding(true);
    try {
      await api.post(`/approvals/${state.batch.approvalRequestId}/decide`, { action: decision, note: note || null, stepId: state.steps[0]?.id });
      toast(decision === 'approve' ? 'Disetujui, data Accurate sudah diterapkan' : 'Batch ditolak, tidak ada data yang berubah', 'success');
      setModal('');
      resetSalesScope();
      salesChanged();
      await load();
    } catch (err) {
      toast(apiError(err, 'Keputusan gagal disimpan'), 'error');
    } finally { setDeciding(false); }
  };

  if (state.loading) return <Page><LoadingState label="Memuat data Accurate…" /></Page>;
  if (state.error) {
    return (
      <Page>
        <EmptyState tone="error" title="Batch belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={retry}>Coba lagi</Button>} />
      </Page>
    );
  }
  const { batch } = state;
  const canDecide = batch.status === 'pending' && state.steps.length > 0;
  const lines = summaryLines(batch.summary);

  return (
    <Page>
      <PageHeader
        eyebrow="Data Accurate"
        title={`Batch #${batch.id} — ${batch.departmentName}`}
        description={(
          <span className="pw-row">
            <StatusBadge {...status(batch.status)} />
            <span>Ditarik {formatDateTime(batch.createdAt)} · {formatCount(batch.itemCount)} perubahan</span>
          </span>
        )}
        actions={canDecide ? (
          <>
            <Button variant="secondary" icon="close" onClick={() => setModal('reject')}>Tolak</Button>
            <Button icon="check" onClick={() => setModal('approve')}>Setujui &amp; terapkan</Button>
          </>
        ) : null}
      />

      {batch.status === 'pending' ? (
        <Banner tone="warning" title="Belum dipakai di aplikasi">
          {canDecide
            ? `Periksa perubahan di bawah. Setelah Anda setujui, semuanya disimpan sekaligus sebagai data Accurate divisi ${batch.departmentName}. Data lama di aplikasi tidak diubah dan tidak ada yang dihapus.`
            : `Menunggu persetujuan Supervisor atau Head ${batch.departmentName}. Sampai itu, angka di aplikasi belum ikut berubah.`}
        </Banner>
      ) : null}
      {batch.status === 'rejected' ? (
        <Banner tone="info" title="Ditolak, tidak ada data yang berubah">
          {batch.decisionNote ? `Alasan: ${batch.decisionNote}. ` : ''}Tarikan berikutnya dari Accurate membawa perubahan terbaru untuk diperiksa lagi.
        </Banner>
      ) : null}

      <Card title="Ringkasan">
        <KeyValue columns={2} items={[
          ...lines.map((l) => ({ key: l.type, label: l.label, value: l.text, translate: true })),
          ...(batch.summary?.revenue ? [{ label: 'DPP SO baru/berubah', value: formatRupiah(batch.summary.revenue) }] : []),
          ...stockCheckLines(batch.summary?.checks).map((l) => ({ ...l, translate: true })),
          ...procurementCheckLines(batch.summary?.checks).map((l) => ({ ...l, translate: true })),
          { label: 'Penyetuju', value: `Supervisor atau Head ${batch.departmentName}`, translate: true },
          { label: 'Diajukan oleh', value: batch.requestedByName },
          { label: 'Diputuskan oleh', value: batch.decidedByName ? <Mixed parts={[data(batch.decidedByName), formatDateTime(batch.decidedAt)]} /> : null },
          { label: 'Diterapkan', value: batch.appliedAt ? formatDateTime(batch.appliedAt) : null },
        ]}
        />
      </Card>
      {/* Notes before deciding (Prakasa AI Wave D2). Read-only: the decision stays on the buttons above. */}
      <AccurateBatchReview batchId={batch.id} pending={batch.status === 'pending'} onPick={pickDocument} />
      <div ref={gridRef}>
      <DataGrid
        title="Isi batch"
        columns={ITEM_COLUMNS}
        rows={items.rows}
        loading={items.loading}
        error={items.error}
        onRetry={items.reload}
        meta={items.meta}
        onPageChange={items.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari nomor SO, kode, atau nama"
        filters={(
          <>
            <FilterMenuChip label="Jenis" icon="category" value={recordType} options={RECORD_FILTERS} onChange={setRecordType} />
            {ACTION_FILTERS.map((f) => (
              <Chip key={f.value || 'all'} selected={action === f.value} onClick={() => setAction(f.value)}>{f.label}</Chip>
            ))}
          </>
        )}
        exportName={`data-accurate-${batch.id}`}
        empty="Tidak ada perubahan yang cocok"
      />
      </div>

      <ConfirmDialog
        open={modal === 'approve'}
        tone="primary"
        title="Setujui data Accurate?"
        message={`${formatCount(batch.itemCount)} perubahan dari Accurate disimpan sebagai data Accurate divisi ${batch.departmentName}. Data lama di aplikasi tidak diubah, dan tidak ada data yang dihapus.`}
        confirmLabel="Setujui & terapkan"
        loading={deciding}
        onConfirm={() => decide('approve')}
        onClose={() => setModal('')}
      />
      <ReasonDialog
        open={modal === 'reject'}
        title="Tolak data Accurate?"
        description="Tidak ada data yang berubah di aplikasi. Perbaiki datanya di Accurate; tarikan berikutnya membuat batch baru untuk diperiksa lagi."
        label="Alasan penolakan"
        confirmLabel="Tolak batch"
        tone="danger"
        onClose={() => setModal('')}
        onConfirm={(note) => decide('reject', note)}
      />
    </Page>
  );
}
