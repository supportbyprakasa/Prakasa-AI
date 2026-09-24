import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Inbox, Plus, RefreshCw, Search } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import { SkeletonTable } from '../../components/Skeleton';
import { useAuth } from '../../context/AuthContext';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import {
  MOVEMENT_STATUSES,
  MOVEMENT_TYPE_COPY,
  formatQuantity,
  movementStatusLabel,
} from './warehouseMovementModel';
import './warehouse-movements.css';

const MODES = {
  inbound: { type: 'inbound', title: 'Barang Masuk', empty: 'Belum ada transaksi barang masuk.' },
  outbound: { type: 'outbound', title: 'Barang Keluar', empty: 'Belum ada transaksi barang keluar.' },
  approval: { status: 'pending_approval', title: 'Approval Supervisor', empty: 'Tidak ada pergerakan yang menunggu review.' },
  history: { title: 'Riwayat Transaksi', empty: 'Belum ada riwayat transaksi.' },
};

export function MovementStatusChip({ status }) {
  const { label, tone } = movementStatusLabel(status);
  return <span className={`wm-status wm-status--${tone}`}>{label}</span>;
}

export function AccurateNotice() {
  return (
    <p className="wm-notice">
      Integrasi Accurate belum aktif. Pergerakan yang disetujui tersimpan di Prakasa Workspace dan tidak dikirim ke sistem lain.
    </p>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const totalQuantity = (items) => items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

export default function MovementList({ mode }) {
  const config = MODES[mode];
  const { user } = useAuth();
  const navigate = useNavigate();
  const permissions = user?.permissions || [];
  const canCreate = Boolean(config.type) && permissions.includes('warehouse.movement.create');

  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await api.get('/warehouse/movements', {
        params: {
          type: config.type,
          status: config.status || filters.status || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          q: filters.q || undefined,
          page,
          limit: 20,
        },
      });
      setState({ loading: false, error: '', rows: response.data.data || [], meta: response.data.meta || null });
    } catch (error) {
      setState({ loading: false, error: error.response?.data?.error?.message || 'Gagal memuat pergerakan barang.', rows: [], meta: null });
    }
  }, [config.type, config.status, filters, page]);

  useEffect(() => { load(); }, [load]);

  usePublishPrakasaAIContext({
    toolKey: 'warehouse',
    visibleState: {
      tab: mode,
      status: config.status || filters.status,
      q: filters.q,
      from: filters.from,
      to: filters.to,
      page,
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setFilters((current) => (current.q === search.trim() ? current : { ...current, q: search.trim() }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const statusOptions = state.meta?.statusesVisible || MOVEMENT_STATUSES;
  const totalPages = state.meta ? Math.max(1, Math.ceil((state.meta.total || 0) / (state.meta.limit || 20))) : 1;
  const showType = !config.type;
  const openRow = (row) => navigate(`/warehouse/movements/${row.type}/${row.id}`);

  return (
    <section className="wm-list" aria-label={config.title}>
      <div className="wm-toolbar">
        <label className="wm-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Cari referensi atau {config.type ? MOVEMENT_TYPE_COPY[config.type].partyLabel.toLowerCase() : 'supplier/tujuan'}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari referensi, supplier, atau tujuan"
          />
        </label>
        {!config.status && (
          <label className="wm-filter">
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
              <option value="">Semua status</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{movementStatusLabel(status).label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="wm-filter">
          <span>Dari</span>
          <input type="date" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} />
        </label>
        <label className="wm-filter">
          <span>Sampai</span>
          <input type="date" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} />
        </label>
        {canCreate && (
          <Button className="wm-toolbar__create" onClick={() => navigate(`/warehouse/movements/${config.type}/new`)}>
            <Plus size={18} aria-hidden="true" /> Buat {MOVEMENT_TYPE_COPY[config.type].label.toLowerCase()}
          </Button>
        )}
      </div>

      {state.loading && <SkeletonTable rows={5} columns={6} />}

      {!state.loading && state.error && (
        <div className="wm-state wm-state--error" role="alert">
          <strong>Data belum bisa dimuat</strong>
          <span>{state.error}</span>
          <Button variant="secondary" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Coba lagi</Button>
        </div>
      )}

      {!state.loading && !state.error && state.rows.length === 0 && (
        <div className="wm-state">
          <Inbox size={28} aria-hidden="true" />
          <strong>{config.empty}</strong>
          {canCreate && <span>Mulai dengan membuat draft, lalu ajukan untuk direview Supervisor.</span>}
        </div>
      )}

      {!state.loading && !state.error && state.rows.length > 0 && (
        <>
          <div className="wm-table">
            <div className={`wm-table__head${showType ? ' has-type' : ''}`} aria-hidden="true">
              <span>Tanggal</span>
              {showType && <span>Jenis</span>}
              <span>Referensi</span>
              <span>Supplier / tujuan</span>
              <span>Barang</span>
              <span>Status</span>
              <span>Dibuat oleh</span>
              <span />
            </div>
            {state.rows.map((row) => (
              <button
                key={`${row.type}-${row.id}`}
                type="button"
                aria-label={`${row.typeLabel} ${row.referenceNo || `#${row.id}`}, ${movementStatusLabel(row.status).label}, ${formatDate(row.movementDate)}`}
                className={`wm-table__row pw-state-layer${showType ? ' has-type' : ''}`}
                onClick={() => openRow(row)}
              >
                <span data-label="Tanggal">{formatDate(row.movementDate)}</span>
                {showType && <span data-label="Jenis">{row.typeLabel}</span>}
                <span data-label="Referensi" className="wm-strong">{row.referenceNo || `#${row.id}`}</span>
                <span data-label="Supplier / tujuan">{row.party || '—'}</span>
                <span data-label="Barang">
                  {row.items.length} baris · {formatQuantity(totalQuantity(row.items))} total
                </span>
                <span data-label="Status"><MovementStatusChip status={row.status} /></span>
                <span data-label="Dibuat oleh">{row.createdByName || '—'}</span>
                <span className="wm-table__chevron" aria-hidden="true"><ChevronRight size={18} /></span>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="wm-pager">
              <span>Halaman {page} dari {totalPages} · {state.meta.total} transaksi</span>
              <Button variant="text" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Sebelumnya</Button>
              <Button variant="text" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Berikutnya</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
