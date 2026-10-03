import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import FilterMenuChip from '../../components/FilterMenuChip';
import Menu from '../../components/Menu';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { GaCreateDialog } from './GaForms';
import GaResources from './GaResources';
import GaSchedule from './GaSchedule';
import {
  BOOKING_STATUS_LABELS, CREATE_CHOICES, REQUEST_STATUSES, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS, RESOURCE_KIND_LABELS,
  apiErrorMessage, bookingStatusKey, formatWibRange, requestStatusKey, targetText,
} from './gaModel';
import './ga.css';

const PAGE_SIZE = 20;

function useGaLookups(enabled) {
  const [state, setState] = useState({ locations: [], resources: [], defaultLocationId: null, loaded: false });
  const { user } = useAuth();
  const load = useCallback(async () => {
    const [locations, resources, me] = await Promise.allSettled([
      api.get('/it/locations'),
      api.get('/ga/resources'),
      user?.id ? api.get(`/people/directory/u${user.id}`) : Promise.reject(new Error('no user')),
    ]);
    const locs = locations.status === 'fulfilled' ? (locations.value.data.data || []).filter((l) => l.isActive !== false) : [];
    const mine = me.status === 'fulfilled' ? me.value.data.data?.locationId : null;
    setState({
      locations: locs,
      resources: resources.status === 'fulfilled' ? resources.value.data.data || [] : [],
      defaultLocationId: mine || (locs.length === 1 ? locs[0].id : null),
      loaded: true,
    });
  }, [user?.id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { ...state, reload: load };
}

const REQUEST_COLUMNS = [
  { key: 'requestNumber', header: 'Nomor', nowrap: true },
  { key: 'typeLabel', header: 'Jenis', translate: true, render: (r) => REQUEST_TYPE_LABELS[r.requestType] || r.typeLabel },
  // "ATK: <barang> (+2 barang lain)" is composed by the server; an "other"
  // request carries the title its requester typed: a sentence zone.
  { key: 'title', header: 'Judul', translate: 'strict' },
  { key: 'locationName', header: 'Lokasi' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => <StatusBadge status={requestStatusKey(r.status)} label={REQUEST_STATUS_LABELS[r.status]} />,
    exportValue: (r) => REQUEST_STATUS_LABELS[r.status] || r.status,
  },
  {
    key: 'dueAt', header: 'Target', nowrap: true, translate: true,
    render: (r) => <span className={r.overdue ? 'ga-late' : undefined}>{targetText(r)}</span>,
    sortValue: (r) => r.dueAt || '', exportValue: targetText,
  },
];
const ALL_COLUMNS = [
  ...REQUEST_COLUMNS.slice(0, 3),
  { key: 'requester', header: 'Pengaju', render: (r) => r.requester?.name, sortValue: (r) => r.requester?.name || '', exportValue: (r) => r.requester?.name || '' },
  ...REQUEST_COLUMNS.slice(3),
  {
    key: 'overdue', header: 'Lewat target', nowrap: true,
    render: (r) => (r.overdue ? <StatusBadge status="ga_overdue" /> : null),
    sortValue: (r) => (r.overdue ? 1 : 0), exportValue: (r) => (r.overdue ? 'Ya' : ''),
  },
];
const BOOKING_COLUMNS = [
  { key: 'bookingNumber', header: 'Nomor', nowrap: true },
  { key: 'resourceKind', header: 'Jenis', translate: true, render: (b) => `Pinjam ${RESOURCE_KIND_LABELS[b.resourceKind]?.toLowerCase() || ''}`.trim() },
  { key: 'resourceName', header: 'Ruang' },
  { key: 'startsAt', header: 'Waktu', render: (b) => formatWibRange(b.startsAt, b.endsAt), sortValue: (b) => b.startsAt, exportValue: (b) => formatWibRange(b.startsAt, b.endsAt) },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (b) => <StatusBadge status={b.late ? 'booking_late' : bookingStatusKey(b.status)} label={b.late ? undefined : BOOKING_STATUS_LABELS[b.status]} />,
    exportValue: (b) => BOOKING_STATUS_LABELS[b.status] || b.status,
  },
];

// Layanan GA (People & Culture wave 2, row 2.2; §3.5). One menu entry under
// Kerja Harian for everyone: "Permintaan saya" (requests and bookings),
// "Semua permintaan" for People & Culture, "Jadwal" of rooms and vehicles
// (others' bookings masked), and "Sumber daya" for the Supervisor/Head.
export default function GaServices() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canProcess = permissions.includes('ga.request.process');
  const canManage = permissions.includes('ga.resource.manage');
  const [params, setParams] = useSearchParams();
  const tabs = [
    { k: 'saya', l: 'Permintaan saya', icon: 'person' },
    ...(canProcess ? [{ k: 'semua', l: 'Semua permintaan', icon: 'inbox' }] : []),
    { k: 'jadwal', l: 'Jadwal', icon: 'calendar_month' },
    ...(canManage ? [{ k: 'sumber', l: 'Sumber daya', icon: 'meeting_room' }] : []),
  ];
  const tab = tabs.some((t) => t.k === params.get('tab')) ? params.get('tab') : 'saya';
  const lookups = useGaLookups(true);
  const menuAnchor = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [create, setCreate] = useState(null); // { kind, resourceId?, day? }
  const [resourceCreate, setResourceCreate] = useState(null);

  const setParam = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return next;
  }, { replace: true });

  // A create form opens by URL too: /ga?baru=atk | facility_repair | other |
  // room (a link, or Prakasa AI's buka_halaman); vehicles are borrowed in
  // TrackCar, so /ga?baru=vehicle opens nothing. The parameter is
  // removed once the form is open, so closing it does not reopen it. A form
  // opens once its choices (locations, rooms) have loaded.
  useOpenFromUrl('baru', (kind) => {
    if (CREATE_CHOICES.some((choice) => choice.kind === kind && !choice.href)) setCreate({ kind });
  }, { enabled: lookups.loaded, keepUnsaved: true });
  // /ga?form=pinjam-ruang opens "Pinjam ruang" (the route Prakasa AI is given
  // for it; /ga?baru=room opens it too) and /ga?tab=sumber&form=ruang opens
  // "Tambah ruang" (Supervisor/Head only).
  useOpenFromUrl('form', (name) => {
    if (name === 'pinjam-ruang') setCreate({ kind: 'room' });
    if (name === 'ruang' && canManage) setResourceCreate({ kind: 'room' });
    // One dialog for every create form: an unsaved one is never replaced by a link (keepUnsaved).
  }, { enabled: lookups.loaded, keepUnsaved: true });

  // ---- lists
  const [mine, setMine] = useState({ rows: [], meta: { page: 1, limit: PAGE_SIZE, total: 0 }, loading: true, error: '' });
  const [myBookings, setMyBookings] = useState({ rows: [], loading: true, error: '' });
  const [all, setAll] = useState({ rows: [], meta: { page: 1, limit: PAGE_SIZE, total: 0 }, loading: true, error: '' });
  const filters = { status: params.get('status') || '', type: params.get('type') || '', locationId: params.get('location') || '', q: params.get('q') || '' };
  const filterKey = JSON.stringify(filters);

  const loadMine = useCallback(async (page = 1) => {
    setMine((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/ga/requests', { params: { scope: 'mine', page, limit: PAGE_SIZE } });
      setMine({ rows: r.data.data || [], meta: { page, limit: PAGE_SIZE, total: 0, ...(r.data.meta || {}) }, loading: false, error: '' });
    } catch (error) {
      setMine((s) => ({ ...s, loading: false, error: apiErrorMessage(error) }));
    }
  }, []);
  const loadMyBookings = useCallback(async () => {
    setMyBookings((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/ga/bookings', { params: { mine: 1 } });
      setMyBookings({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setMyBookings((s) => ({ ...s, loading: false, error: apiErrorMessage(error) }));
    }
  }, []);
  const loadAll = useCallback(async (page = 1) => {
    if (!canProcess) return;
    setAll((s) => ({ ...s, loading: true, error: '' }));
    try {
      const f = JSON.parse(filterKey);
      const r = await api.get('/ga/requests', { params: { scope: 'all', page, limit: PAGE_SIZE, ...f } });
      setAll({ rows: r.data.data || [], meta: { page, limit: PAGE_SIZE, total: 0, ...(r.data.meta || {}) }, loading: false, error: '' });
    } catch (error) {
      setAll((s) => ({ ...s, loading: false, error: apiErrorMessage(error) }));
    }
  }, [canProcess, filterKey]);

  useEffect(() => { if (tab === 'saya') { loadMine(1); loadMyBookings(); } }, [tab, loadMine, loadMyBookings]);
  useEffect(() => { if (tab === 'semua') loadAll(1); }, [tab, loadAll]);

  const created = (record, kind) => {
    setCreate(null);
    if (record?.id) navigate(kind === 'booking' ? `/ga/bookings/${record.id}` : `/ga/requests/${record.id}`);
  };

  const counts = all.meta.statusCounts || null;
  const total = counts ? Object.values(counts).reduce((n, v) => n + (Number(v) || 0), 0) : null;
  const countText = (n) => (counts ? ` (${formatNumber(n || 0)})` : '');
  const allFilters = (
    <>
      <Chip selected={!filters.status} onClick={() => setParam({ status: '' })}>{`Semua${total !== null ? ` (${formatNumber(total)})` : ''}`}</Chip>
      {REQUEST_STATUSES.filter((s) => s !== 'cancelled' || counts?.cancelled).map((status) => (
        <Chip key={status} selected={filters.status === status} onClick={() => setParam({ status: filters.status === status ? '' : status })}>
          {`${REQUEST_STATUS_LABELS[status]}${countText(counts?.[status])}`}
        </Chip>
      ))}
      <Chip selected={filters.status === 'overdue'} onClick={() => setParam({ status: filters.status === 'overdue' ? '' : 'overdue' })}>
        {`Lewat target${counts ? ` (${formatNumber(all.meta.overdue || 0)})` : ''}`}
      </Chip>
      <FilterMenuChip
        label="Jenis" icon="category" value={filters.type}
        options={[{ value: '', label: 'Semua' }, ...Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => ({ value, label }))]}
        onChange={(value) => setParam({ type: value })}
      />
      <FilterMenuChip
        label="Lokasi" icon="location_on" value={filters.locationId} dataOptions
        options={[{ value: '', label: 'Semua', translate: true }, ...lookups.locations.map((l) => ({ value: String(l.id), label: l.name }))]}
        onChange={(value) => setParam({ location: value })}
      />
    </>
  );

  const headerAction = (
    <>
      <Button ref={menuAnchor} icon="add" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
        Buat permintaan
      </Button>
      <Menu
        open={menuOpen}
        anchorRef={menuAnchor}
        onClose={() => setMenuOpen(false)}
        label="Buat permintaan"
        items={CREATE_CHOICES.map((c) => ({
          key: c.kind, label: c.label, icon: c.icon, description: c.description,
          onClick: () => {
            setMenuOpen(false);
            if (c.href) { window.open(c.href, '_blank', 'noopener,noreferrer'); return; }
            setCreate({ kind: c.kind });
          },
        }))}
      />
    </>
  );

  return (
    <Page
      title="Layanan GA"
      description="Minta ATK atau perbaikan fasilitas, dan pinjam ruang kantor. Peminjaman kendaraan lewat TrackCar."
      actions={tab === 'sumber' ? (
        <Button icon="add" onClick={() => setResourceCreate({ kind: 'room' })}>Tambah ruang</Button>
      ) : headerAction}
    >
      <TabBar tabs={tabs} value={tab} onChange={(k) => setParam({ tab: k === 'saya' ? '' : k, status: '', type: '', location: '', q: '' })} label="Bagian Layanan GA" idPrefix="ga-tab" panelId="ga-panel" />
      <div id="ga-panel" role="tabpanel" aria-labelledby={`ga-tab-${tab}`} className="pw-stack pw-stack--lg">
        {tab === 'saya' ? (
          <>
            <DataGrid
              title="Permintaan saya"
              rows={mine.rows}
              loading={mine.loading}
              error={mine.error}
              onRetry={() => loadMine(mine.meta.page || 1)}
              meta={mine.meta}
              onPageChange={loadMine}
              columns={REQUEST_COLUMNS}
              empty="Belum ada permintaan. Pilih Buat permintaan untuk ATK, perbaikan, atau lainnya."
              onRowClick={(r) => navigate(`/ga/requests/${r.id}`)}
              exportName="permintaan-ga-saya"
            />
            <DataGrid
              title="Peminjaman saya"
              rows={myBookings.rows}
              loading={myBookings.loading}
              error={myBookings.error}
              onRetry={loadMyBookings}
              columns={BOOKING_COLUMNS}
              empty="Belum ada peminjaman ruang."
              onRowClick={(b) => navigate(`/ga/bookings/${b.id}`)}
              exportName="peminjaman-ga-saya"
            />
          </>
        ) : null}
        {tab === 'semua' ? (
          <DataGrid
            title="Semua permintaan"
            showTitle={false}
            rows={all.rows}
            loading={all.loading}
            error={all.error}
            onRetry={() => loadAll(all.meta.page || 1)}
            meta={all.meta}
            onPageChange={loadAll}
            search={filters.q}
            onSearchChange={(value) => setParam({ q: value })}
            searchPlaceholder="Cari nomor, judul, atau pengaju"
            filters={allFilters}
            columns={ALL_COLUMNS}
            empty={filters.status || filters.type || filters.locationId || filters.q ? 'Tidak ada permintaan yang cocok dengan filter ini' : 'Belum ada permintaan GA'}
            onRowClick={(r) => navigate(`/ga/requests/${r.id}`)}
            exportName="permintaan-ga"
          />
        ) : null}
        {tab === 'jadwal' ? (
          <GaSchedule
            resources={lookups.resources}
            canProcess={canProcess}
            onBook={(resource, day) => setCreate({ kind: resource.kind, resourceId: resource.id, day })}
          />
        ) : null}
        {tab === 'sumber' ? (
          <GaResources
            locations={lookups.locations}
            locationsReady={lookups.loaded}
            createRequest={resourceCreate}
            onCreateClose={() => setResourceCreate(null)}
            onChanged={lookups.reload}
          />
        ) : null}
      </div>

      <GaCreateDialog
        open={Boolean(create)}
        kind={create?.kind || 'atk'}
        resourceId={create?.resourceId || null}
        day={create?.day || null}
        locations={lookups.locations}
        resources={lookups.resources}
        defaultLocationId={lookups.defaultLocationId}
        onClose={() => setCreate(null)}
        onCreated={created}
      />
    </Page>
  );
}
