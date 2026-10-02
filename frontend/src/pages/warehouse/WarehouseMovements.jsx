import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import { usePublishPrakasaAIContext } from '../../context/PrakasaAIToolContext';
import { MOVEMENT_STATUSES, formatQuantity, movementStatusLabel } from './warehouseMovementModel';
import { dateOnly, dayText } from './warehouseStockModel';
import './warehouse-movements.css';

const MODES = {
  inbound: { type: 'inbound', title: 'Barang masuk', empty: 'Belum ada transaksi barang masuk.' },
  outbound: { type: 'outbound', title: 'Barang keluar', empty: 'Belum ada transaksi barang keluar.' },
  approval: { status: 'pending_approval', title: 'Approval Supervisor', empty: 'Tidak ada pergerakan yang menunggu review.' },
  history: { title: 'Riwayat transaksi', empty: 'Belum ada riwayat transaksi.' },
};

// Movement wording comes from the model; the tone from the shared statusTone map.
export function MovementStatusChip({ status }) {
  return <StatusBadge status={status} label={movementStatusLabel(status).label} />;
}

export function AccurateNotice() {
  return (
    <Banner tone="info">
      Pergerakan yang disetujui tidak dikirim ke Accurate. Aplikasi mencocokkannya dengan dokumen Accurate yang sudah disetujui (tab Cocokkan Accurate).
    </Banner>
  );
}

const totalQuantity = (items) => items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
const itemsText = (row) => `${row.items.length} baris · ${formatQuantity(totalQuantity(row.items))} total`;

// One list per tab (Barang masuk, Barang keluar, Approval Supervisor, Riwayat
// transaksi). The create button lives in the page header (WarehouseDashboard).
export default function MovementList({ mode }) {
  const config = MODES[mode];
  const { user } = useAuth();
  const navigate = useNavigate();
  const permissions = user?.permissions || [];
  const canCreate = Boolean(config.type) && permissions.includes('warehouse.movement.create');

  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
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
          q: filters.q.trim() || undefined,
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

  const setFilter = (key, value) => {
    if (filters[key] === value) return;
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const statusOptions = state.meta?.statusesVisible || MOVEMENT_STATUSES;
  const showType = !config.type;
  const openRow = (row) => navigate(`/warehouse/movements/${row.type}/${row.id}`);
  // History mixes inbound and outbound, whose ids can collide.
  const rows = useMemo(() => state.rows.map((row) => ({ ...row, rowKey: `${row.type}-${row.id}` })), [state.rows]);

  const columns = [
    { key: 'movementDate', header: 'Tanggal', render: (row) => dayText(row.movementDate), sortValue: (row) => String(row.movementDate || ''), exportValue: (row) => dateOnly(row.movementDate) },
    ...(showType ? [{ key: 'typeLabel', header: 'Jenis', translate: true }] : []),
    { key: 'referenceNo', header: 'Referensi', render: (row) => row.referenceNo || `#${row.id}`, exportValue: (row) => row.referenceNo || `#${row.id}` },
    { key: 'party', header: 'Supplier / tujuan' },
    { key: 'items', header: 'Barang', translate: true, render: itemsText, exportValue: itemsText },
    { key: 'status', header: 'Status', render: (row) => <MovementStatusChip status={row.status} />, exportValue: (row) => movementStatusLabel(row.status).label },
    { key: 'createdByName', header: 'Dibuat oleh' },
  ];

  const filterBar = (
    <>
      {!config.status ? ['', ...statusOptions].map((status) => (
        <Chip key={status || 'all'} selected={filters.status === status} onClick={() => setFilter('status', status)}>
          {status ? movementStatusLabel(status).label : 'Semua'}
        </Chip>
      )) : null}
      <DateInput label="Dari" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} fieldClassName="wh-filter-date" />
      <DateInput label="Sampai" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} fieldClassName="wh-filter-date" />
    </>
  );

  return (
    <DataGrid
      title={config.title}
      showTitle={false}
      exportName={`warehouse-${mode}`}
      columns={columns}
      rows={rows}
      idKey="rowKey"
      loading={state.loading}
      error={state.error}
      onRetry={load}
      search={filters.q}
      onSearchChange={(value) => setFilter('q', value)}
      searchPlaceholder="Cari referensi, supplier, atau tujuan"
      filters={filterBar}
      meta={state.meta ? { ...state.meta, page, limit: state.meta.limit || 20 } : undefined}
      onPageChange={state.meta ? setPage : undefined}
      onRowClick={openRow}
      empty={canCreate ? `${config.empty} Mulai dengan membuat draft, lalu ajukan untuk direview Supervisor.` : config.empty}
    />
  );
}
