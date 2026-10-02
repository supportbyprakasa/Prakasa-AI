import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import FilterMenuChip from '../../components/FilterMenuChip';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { downloadMatrix } from '../../components/datagrid/gridFile';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { DeviceFormDialog, DeviceReturnDialog, DeviceStatusDialog } from './DeviceDialogs';
import LocationsPanel from './LocationsPanel';
import ReportImportDialog from './ReportImportDialog';
import {
  ASSIGNABLE_FROM, DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS, HOLDER_KIND_LABELS, MAIN_DEVICE_STATUSES, OTHER_DEVICE_STATUSES,
  brandModel, deviceQuery, deviceStatusKey, holderName, specLine,
} from './itModel';
import { useLocations } from './useLookups';
import './it-assets.css';

const PAGE_SIZE = 20;
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// Drill-down filters (the IT dashboard links here with one of them).
const DRILLS = [
  { key: 'problematic', label: 'Bermasalah (Rusak + Tidak aktif)' },
  { key: 'noAssetCode', label: 'Tanpa nomor aset' },
  { key: 'resignedHolder', label: 'Di tangan karyawan resign' },
  { key: 'warrantyDays', label: 'Garansi ≤ 60 hari' },
];
const TYPE_OPTIONS = [{ value: '', label: 'Semua' }, ...Object.entries(DEVICE_TYPE_LABELS)
  .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'id'))];
const HOLDER_OPTIONS = [{ value: '', label: 'Semua' }, ...['user', 'person', 'label', 'none'].map((value) => ({ value, label: HOLDER_KIND_LABELS[value] }))];

function HolderCell({ device }) {
  const name = holderName(device);
  if (!name) return null;
  return (
    <span className="it-holder">
      <span>{name}</span>
      {device.holder?.resigned ? <StatusBadge status="holder_resigned" /> : null}
    </span>
  );
}

const COLUMNS = [
  { key: 'deviceType', header: 'Tipe', translate: true, render: (r) => r.deviceTypeLabel || DEVICE_TYPE_LABELS[r.deviceType] || r.deviceType, exportValue: (r) => r.deviceTypeLabel || r.deviceType },
  { key: 'model', header: 'Merek / model', render: brandModel, sortValue: brandModel, exportValue: brandModel },
  { key: 'serialNumber', header: 'Nomor seri' },
  { key: 'assetCode', header: 'No. aset' },
  { key: 'purchaseYear', header: 'Tahun beli', align: 'end', nowrap: true },
  { key: 'spec', header: 'RAM / SSD / OS', render: specLine, sortValue: specLine, exportValue: specLine },
  { key: 'holder', header: 'Pemakai', render: (r) => (holderName(r) ? <HolderCell device={r} /> : null), sortValue: holderName, exportValue: holderName },
  { key: 'locationName', header: 'Lokasi' },
  {
    key: 'status', header: 'Status', nowrap: true,
    render: (r) => <StatusBadge status={deviceStatusKey(r.status)} label={r.statusLabel || DEVICE_STATUS_LABELS[r.status]} />,
    exportValue: (r) => r.statusLabel || DEVICE_STATUS_LABELS[r.status] || r.status,
  },
];

// Perangkat (People & Culture wave 1, row 1.2): the device list like the
// owner's report — status chips Aktif / Cadangan / Rusak / Tidak aktif with
// counts, filters type / location / holder, export in the report's layout,
// import of the report — and the company's locations on a second tab.
export default function Devices() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('device.manage');
  const canAssign = permissions.includes('device.assign');
  const canImportPeople = permissions.includes('people.directory.manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'lokasi' ? 'lokasi' : 'perangkat';
  const filters = {
    status: params.get('status') || '',
    deviceType: params.get('type') || '',
    locationId: params.get('location') || '',
    holderKind: params.get('holder') || '',
    q: params.get('q') || '',
    problematic: params.get('problematic') === '1',
    noAssetCode: params.get('noAssetCode') === '1',
    resignedHolder: params.get('resignedHolder') === '1',
    warrantyDays: params.get('warrantyDays') ? 60 : null,
  };
  const query = deviceQuery(filters);
  const queryKey = JSON.stringify(query);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formDevice, setFormDevice] = useState(undefined); // undefined closed, null new, object edit
  const [statusTarget, setStatusTarget] = useState(null);
  const [returnTarget, setReturnTarget] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [locationCreate, setLocationCreate] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const locations = useLocations(tab === 'perangkat');
  // ?baru=1 opens "Tambah perangkat" (or "Tambah lokasi" on the Lokasi tab):
  // a link, or Prakasa AI's buka_halaman. Opening saves nothing.
  useOpenFromUrl('baru', () => {
    if (!canManage) return;
    if (tab === 'lokasi') setLocationCreate(true); else setFormDevice(null);
    // The device form serves add and edit: an unsaved one is never replaced by a link (keepUnsaved).
  }, { keepUnsaved: true });

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/it/devices', { params: { ...JSON.parse(queryKey), page, limit: PAGE_SIZE } });
      setRows(r.data.data || []);
      const m = r.data.meta || {};
      setMeta({ page, limit: PAGE_SIZE, total: 0, ...m });
      setCounts(m.statusCounts || null);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [queryKey]);
  useEffect(() => { if (tab === 'perangkat') load(1); }, [load, tab]);

  const setFilter = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });

  const exportAll = async (format) => {
    const r = await api.get('/it/devices/export', { params: query });
    const data = r.data.data || {};
    await downloadMatrix([data.columns || [], ...(data.rows || [])], 'perangkat-it', format, { sheet: data.sheetName || 'Device Inventory' });
  };

  const saved = async (result) => {
    setFormDevice(undefined);
    setWarnings(result?.warnings || []);
    await load(meta.page || 1);
  };

  const total = counts ? Object.values(counts).reduce((n, v) => n + (Number(v) || 0), 0) : null;
  const countText = (status) => (counts ? ` (${formatNumber(counts[status] || 0)})` : '');
  const otherShown = OTHER_DEVICE_STATUSES.filter((s) => (counts?.[s] || 0) > 0 || filters.status === s);
  const locationChoices = [
    { value: '', label: 'Semua', translate: true },
    { value: 'none', label: 'Tanpa lokasi', translate: true },
    ...locations.rows.map((l) => ({ value: String(l.id), label: l.name })),
  ];

  const filterBar = (
    <>
      <Chip selected={!filters.status} onClick={() => setFilter({ status: '' })}>{`Semua${total !== null ? ` (${formatNumber(total)})` : ''}`}</Chip>
      {[...MAIN_DEVICE_STATUSES, ...otherShown].map((status) => (
        <Chip key={status} selected={filters.status === status} onClick={() => setFilter({ status: filters.status === status ? '' : status })}>
          {`${DEVICE_STATUS_LABELS[status]}${countText(status)}`}
        </Chip>
      ))}
      <FilterMenuChip label="Tipe" icon="devices" value={filters.deviceType} options={TYPE_OPTIONS} onChange={(value) => setFilter({ type: value })} />
      <FilterMenuChip label="Lokasi" icon="location_on" value={filters.locationId} options={locationChoices} dataOptions onChange={(value) => setFilter({ location: value })} />
      <FilterMenuChip label="Pemegang" icon="person" value={filters.holderKind} options={HOLDER_OPTIONS} onChange={(value) => setFilter({ holder: value })} />
      {DRILLS.filter((d) => filters[d.key]).map((d) => (
        <Chip key={d.key} selected trailingIcon="close" aria-label={`Hapus filter ${d.label}`} onClick={() => setFilter({ [d.key]: '' })}>{d.label}</Chip>
      ))}
    </>
  );

  const rowMenu = (r) => {
    const items = [];
    if (canManage) {
      items.push({ label: 'Ubah perangkat', icon: 'edit', onClick: () => setFormDevice(r) });
      items.push({ label: 'Ubah status', icon: 'swap_horiz', disabled: r.status === 'disposed', onClick: () => setStatusTarget({ device: r, status: '' }) });
      if (ASSIGNABLE_FROM.includes(r.status)) items.push({ label: 'Serahkan perangkat', icon: 'person_add', onClick: () => setStatusTarget({ device: r, status: 'assigned' }) });
    }
    if (canAssign && r.status === 'assigned') items.push({ label: 'Kembalikan perangkat', icon: 'assignment_return', onClick: () => setReturnTarget(r) });
    return items.length ? <ActionMenu size="sm" label={`Aksi ${brandModel(r) || r.deviceTypeLabel || 'perangkat'}`} items={items} /> : null;
  };

  let headerActions = null;
  if (canManage && tab === 'perangkat') {
    headerActions = (
      <>
        <Button variant="secondary" icon="upload_file" onClick={() => setImportOpen(true)}>Impor dari laporan</Button>
        <Button icon="add" onClick={() => setFormDevice(null)}>Tambah perangkat</Button>
      </>
    );
  } else if (canManage) {
    headerActions = <Button icon="add" onClick={() => setLocationCreate(true)}>Tambah lokasi</Button>;
  }

  return (
    <Page
      title="Perangkat"
      description="Perangkat IT perusahaan, pemakainya, lokasinya, dan statusnya — sama dengan laporan perangkat IT."
      actions={headerActions}
    >
      <TabBar
        tabs={[{ k: 'perangkat', l: 'Perangkat', icon: 'devices' }, { k: 'lokasi', l: 'Lokasi', icon: 'location_on' }]}
        value={tab}
        onChange={(k) => setFilter({ tab: k === 'lokasi' ? 'lokasi' : '' })}
        label="Bagian perangkat"
        idPrefix="it-devices-tab"
        panelId="it-devices-panel"
      />
      <div id="it-devices-panel" role="tabpanel" aria-labelledby={`it-devices-tab-${tab}`} className="pw-stack pw-stack--lg">
        {tab === 'lokasi' ? (
          <LocationsPanel canManage={canManage} createOpen={locationCreate} onCreateClose={() => setLocationCreate(false)} />
        ) : (
          <>
            {warnings.length ? (
              <Banner tone="warning" title="Perangkat tersimpan dengan catatan" action={<Button variant="text" onClick={() => setWarnings([])}>Tutup</Button>}>
                {warnings.map((w) => w.message).join(' · ')}
              </Banner>
            ) : null}
            <DataGrid
              title="Perangkat"
              showTitle={false}
              exportName="perangkat-it"
              onExport={exportAll}
              rows={rows}
              loading={loading}
              error={loadError}
              onRetry={() => load(meta.page || 1)}
              meta={meta}
              onPageChange={load}
              search={filters.q}
              onSearchChange={(value) => setFilter({ q: value })}
              searchPlaceholder="Cari aset, model, seri, atau pemakai"
              filters={filterBar}
              empty={filters.q || filters.status || filters.deviceType || filters.locationId || filters.holderKind ? 'Tidak ada perangkat yang cocok dengan filter ini' : 'Belum ada perangkat'}
              onRowClick={(r) => navigate(`/it/devices/${r.id}`)}
              rowActions={canManage || canAssign ? rowMenu : undefined}
              columns={COLUMNS}
            />
          </>
        )}
      </div>

      <DeviceFormDialog open={formDevice !== undefined} device={formDevice || null} onClose={() => setFormDevice(undefined)} onSaved={saved} />
      <DeviceStatusDialog
        open={Boolean(statusTarget)}
        device={statusTarget?.device}
        initialStatus={statusTarget?.status || ''}
        onClose={() => setStatusTarget(null)}
        onChanged={async () => { setStatusTarget(null); await load(meta.page || 1); }}
      />
      <DeviceReturnDialog
        open={Boolean(returnTarget)}
        device={returnTarget}
        onClose={() => setReturnTarget(null)}
        onReturned={async () => { setReturnTarget(null); await load(meta.page || 1); }}
      />
      {canManage ? (
        <ReportImportDialog
          open={importOpen}
          kind="devices"
          canImportPeople={canImportPeople}
          onClose={() => setImportOpen(false)}
          onImported={() => load(1)}
        />
      ) : null}
    </Page>
  );
}
