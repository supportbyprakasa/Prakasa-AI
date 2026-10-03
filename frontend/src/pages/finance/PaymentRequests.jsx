import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import FilterMenuChip from '../../components/FilterMenuChip';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate, formatNumber } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { useAuth } from '../../context/AuthContext';
import PaymentRequestForm from './PaymentRequestForm';
import { REQUEST_STATUSES, WORKFLOW_TYPES, financeMoney, workflowTypeLabel } from './financeModel';

const LIMIT = 20;
const TYPE_OPTIONS = [{ value: '', label: 'Semua' }, ...WORKFLOW_TYPES];
const apiMessage = (err) => err?.response?.data?.error?.message || 'Periksa koneksi, lalu coba lagi.';

const COLUMNS = [
  { key: 'requestNumber', header: 'Nomor', nowrap: true },
  { key: 'workflowType', header: 'Jenis', translate: true, render: (r) => workflowTypeLabel(r.workflowType), exportValue: (r) => workflowTypeLabel(r.workflowType) },
  { key: 'title', header: 'Judul' },
  { key: 'payeeName', header: 'Penerima' },
  {
    key: 'totalAmount', header: 'Total', type: 'money',
    render: (r) => financeMoney(r.totalAmount, r.currency), exportValue: (r) => r.totalAmount,
  },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => statusLabel(r.status),
  },
  { key: 'requesterName', header: 'Pengaju' },
  { key: 'departmentName', header: 'Divisi', translate: true },
  {
    key: 'requestDate', header: 'Tanggal', nowrap: true,
    render: (r) => formatDate(r.requestDate), sortValue: (r) => r.requestDate || '', exportValue: (r) => r.requestDate || '',
  },
];

// Pengajuan pembayaran & reimbursement (list template, docs/ui-guideline.md
// §3.1): one grid with search, status chips and a type filter; a row opens the
// request. Everyone sees their own requests; a division Head sees the
// division's and Finance sees all (the server decides).
export default function PaymentRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRequest = (user?.permissions || []).includes('finance.request');
  // Approvers get a chip for what waits on them: /approvals is retired.
  const canDecide = (user?.permissions || []).includes('approval.decide');
  const [params, setParams] = useSearchParams();
  const awaiting = canDecide && params.get('awaiting') === '1';
  const status = REQUEST_STATUSES.includes(params.get('status')) ? params.get('status') : '';
  const type = WORKFLOW_TYPES.some((w) => w.value === params.get('type')) ? params.get('type') : '';
  const q = params.get('q') || '';
  const creating = canRequest && params.get('baru') === '1';
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: { page: 1, limit: LIMIT, total: 0 } });
  const request = useRef(0);
  const leaving = useRef(false); // a saved draft opens its page; closing the form must not navigate back

  // New filters start from the first page.
  const setParam = (changes) => {
    setPage(1);
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
      return next;
    }, { replace: true });
  };

  const load = useCallback(async () => {
    const id = ++request.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const query = { page, limit: LIMIT };
      if (type) query.workflowType = type;
      if (status) query.status = status;
      if (q) query.q = q;
      if (awaiting) query.awaiting = '1';
      const r = await api.get('/finance/payment-requests', { params: query });
      if (id !== request.current) return;
      const rows = r.data.data || [];
      setState({ loading: false, error: '', rows, meta: { page, limit: LIMIT, total: rows.length, ...(r.data.meta || {}) } });
    } catch (err) {
      if (id !== request.current) return;
      setState((s) => ({ ...s, loading: false, error: apiMessage(err) }));
    }
  }, [type, status, q, page, awaiting]);
  useEffect(() => { load(); }, [load]);

  const filtered = Boolean(q || type || status);
  return (
    <Page
      title="Pengajuan pembayaran"
      description="Pengajuan pembayaran ke pemasok dan reimbursement karyawan: disetujui atasan, lalu dibayar Finance."
      actions={canRequest ? <Button icon="add" onClick={() => setParam({ baru: '1' })}>Buat pengajuan</Button> : null}
    >
      <DataGrid
        title={state.loading ? 'Pengajuan' : `Pengajuan (${formatNumber(state.meta.total)})`}
        columns={COLUMNS}
        rows={state.rows}
        loading={state.loading}
        error={state.error}
        onRetry={load}
        meta={state.meta}
        onPageChange={setPage}
        search={q}
        onSearchChange={(value) => setParam({ q: value })}
        searchPlaceholder="Cari nomor, judul, penerima, atau kategori"
        filters={(
          <>
            <Chip selected={!status && !awaiting} onClick={() => setParam({ status: '', awaiting: '' })}>Semua</Chip>
            {canDecide ? <Chip selected={awaiting} onClick={() => setParam({ awaiting: awaiting ? '' : '1', status: '' })}>Menunggu keputusan saya</Chip> : null}
            {REQUEST_STATUSES.map((s) => (
              <Chip key={s} selected={status === s} onClick={() => setParam({ status: status === s ? '' : s, awaiting: '' })}>{statusLabel(s)}</Chip>
            ))}
            <FilterMenuChip label="Jenis" icon="category" value={type} options={TYPE_OPTIONS} onChange={(value) => setParam({ type: value })} />
          </>
        )}
        onRowClick={(r) => navigate(`/finance/payment-requests/${r.id}`)}
        exportName="pengajuan-pembayaran"
        empty={filtered ? 'Tidak ada pengajuan yang cocok dengan filter ini' : 'Belum ada pengajuan. Pilih Buat pengajuan untuk pembayaran atau reimbursement.'}
      />
      <PaymentRequestForm
        open={creating}
        onClose={() => { if (!leaving.current) setParam({ baru: '' }); }}
        onSaved={(created) => {
          if (!created?.id) return;
          leaving.current = true;
          navigate(`/finance/payment-requests/${created.id}`);
        }}
      />
    </Page>
  );
}
