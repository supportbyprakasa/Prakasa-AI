import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Page from '../../components/Page';
import ProgressBar from '../../components/ProgressBar';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import WorkflowFormDialog from './WorkflowFormDialog';
import {
  WORKFLOW_STATUS_LABELS, apiErrorMessage, baseDateLabel, progressPct, progressText, statusChips, workflowBadge, workflowListQuery,
} from './hrgaModel';
import './hrga-workflow.css';

const PAGE_SIZE = 20;

function ProgressCell({ row }) {
  const total = Number(row.totalTasks) || 0;
  if (!total) return null;
  return (
    <span className="hrga-progress-cell">
      <ProgressBar value={progressPct(row.doneTasks, total)} label={`Progres ${row.workflowNumber}`} />
      <span className="hrga-progress-cell__text">{progressText(row.doneTasks, total)}</span>
    </span>
  );
}

// Onboarding / Offboarding list (spec §2.1.6, list template §3.1): status
// chips with counts, search, server paging; a row opens the detail.
export default function WorkflowList({ type }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRequest = (user?.permissions || []).includes('hrga.request');
  const [params, setParams] = useSearchParams();
  const offboarding = type === 'offboarding';
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  // /hrga/onboarding?baru=1 (or /hrga/offboarding?baru=1) opens the create dialog.
  useOpenFromUrl('baru', () => setCreateOpen(true), { enabled: canRequest });

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/hrga/workflows', { params: workflowListQuery({ type, status, q, page, limit: PAGE_SIZE }) });
      const m = r.data.meta || {};
      setRows(r.data.data || []);
      setMeta({ page, limit: PAGE_SIZE, total: 0, ...m });
      setCounts(m.counts || null);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [type, status, q]);
  useEffect(() => { load(1); }, [load]);

  const setFilter = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return next;
  }, { replace: true });

  const dateHeader = baseDateLabel(type);
  const columns = [
    { key: 'workflowNumber', header: 'Nomor', nowrap: true },
    {
      key: 'employeeName', header: 'Karyawan',
      render: (r) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{r.employeeName}</span>
          {r.position ? <span className="pw-cell__meta">{r.position}</span> : null}
        </span>
      ),
      sortValue: (r) => r.employeeName,
      exportValue: (r) => r.employeeName,
    },
    { key: 'departmentName', header: 'Divisi', translate: true },
    { key: 'baseDate', header: dateHeader, nowrap: true, render: (r) => formatDate(r.baseDate), exportValue: (r) => r.baseDate || '' },
    {
      key: 'status', header: 'Status', nowrap: true,
      render: (r) => { const b = workflowBadge(r.status); return <StatusBadge status={b.status} label={b.label} />; },
      exportValue: (r) => WORKFLOW_STATUS_LABELS[r.status] || r.status,
    },
    { key: 'progress', header: 'Progres', render: (r) => <ProgressCell row={r} />, sortValue: (r) => progressPct(r.doneTasks, r.totalTasks), exportValue: (r) => progressText(r.doneTasks, r.totalTasks) },
    {
      key: 'lateTasks', header: 'Lewat tenggat', align: 'end', nowrap: true,
      render: (r) => (Number(r.lateTasks) > 0 ? <span className="hrga-late">{formatNumber(r.lateTasks)}</span> : null),
      exportValue: (r) => Number(r.lateTasks) || 0,
    },
  ];

  const filterBar = statusChips(counts, status).map((chip) => (
    <Chip key={chip.key || 'all'} selected={chip.selected} onClick={() => setFilter({ status: chip.key })}>{chip.label}</Chip>
  ));

  const label = offboarding ? 'offboarding' : 'onboarding';
  return (
    <Page
      title={offboarding ? 'Offboarding' : 'Onboarding'}
      description={offboarding
        ? 'Karyawan yang keluar: approval atasan, lalu checklist pengembalian perangkat, lisensi, nomor, dan akses sampai hari terakhir.'
        : 'Karyawan baru: approval atasan, lalu checklist IT, GA, atasan, dan People & Culture sampai hari pertama.'}
      actions={canRequest ? <Button icon="add" onClick={() => setCreateOpen(true)}>{`Buat ${label}`}</Button> : null}
    >
      <DataGrid
        title={offboarding ? 'Offboarding' : 'Onboarding'}
        showTitle={false}
        exportName={label}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={() => load(meta.page || 1)}
        meta={meta}
        onPageChange={load}
        search={q}
        onSearchChange={(value) => setFilter({ q: value })}
        searchPlaceholder="Cari nama atau nomor"
        filters={filterBar}
        empty={q || status ? `Tidak ada ${label} yang cocok dengan filter ini` : `Belum ada ${label}`}
        onRowClick={(r) => navigate(`/hrga/workflows/${r.id}`)}
        columns={columns}
      />
      {canRequest ? (
        <WorkflowFormDialog
          open={createOpen}
          type={type}
          onClose={() => setCreateOpen(false)}
          onSaved={(out) => {
            setCreateOpen(false);
            if (out?.id) navigate(`/hrga/workflows/${out.id}`);
            else load(1);
          }}
        />
      ) : null}
    </Page>
  );
}
