import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import FilterMenuChip from '../../components/FilterMenuChip';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { toast } from '../../components/Toast';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { GaResourceDialog } from './GaForms';
import { apiErrorMessage, formatWibRange } from './gaModel';
import './ga.css';

const COLUMNS = [
  { key: 'name', header: 'Nama' },
  { key: 'locationName', header: 'Lokasi' },
  { key: 'detail', header: 'Kapasitas', translate: true, render: (r) => (r.capacity ? `${r.capacity} orang` : null), exportValue: (r) => r.capacity || '' },
  {
    key: 'isActive', header: 'Status', nowrap: true,
    render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} label={r.isActive ? 'Bisa dipinjam' : 'Nonaktif'} />,
    exportValue: (r) => (r.isActive ? 'Bisa dipinjam' : 'Nonaktif'),
  },
];

// Sumber daya (§3.5, People & Culture Supervisor/Head): rooms per (vehicles live in TrackCar)
// PFN location. Never deleted — deactivated, and only when no booking is
// running or scheduled (the server lists them otherwise).
export default function GaResources({ locations, locationsReady = true, createRequest, onCreateClose, onChanged }) {
  const kind = 'room';
  const [active, setActive] = useState('all');
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const [edit, setEdit] = useState(null);
  const [toggle, setToggle] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/ga/resources', { params: { active, ...(kind ? { kind } : {}) } });
      setState({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setState({ rows: [], loading: false, error: apiErrorMessage(error) });
    }
  }, [kind, active]);
  useEffect(() => { load(); }, [load]);

  // /ga?tab=sumber&ubah=<id ruang> opens that room's edit dialog (a link, or
  // Prakasa AI's buka_halaman) once the list has loaded. It only opens.
  useOpenFromUrl('ubah', (id) => {
    const room = state.rows.find((r) => String(r.id) === String(id));
    if (room) setEdit(room);
  }, { enabled: !state.loading && !state.error && locationsReady, keepUnsaved: true });

  const saved = async () => {
    setEdit(null);
    onCreateClose?.();
    await load();
    onChanged?.();
  };

  const confirmToggle = async () => {
    setBusy(true);
    try {
      await api.patch(`/ga/resources/${toggle.id}`, { isActive: !toggle.isActive, version: toggle.version });
      toast(toggle.isActive ? `${toggle.name} dinonaktifkan` : `${toggle.name} diaktifkan lagi`, 'success');
      setToggle(null);
      await load();
      onChanged?.();
    } catch (error) {
      const data = error?.response?.data?.error;
      if (data?.code === 'RESOURCE_HAS_BOOKINGS') setBlocked({ name: toggle.name, message: data.message, bookings: data.details?.bookings || [] });
      else toast(apiErrorMessage(error), 'error');
      setToggle(null);
    } finally {
      setBusy(false);
    }
  };

  const dialogOpen = Boolean(edit) || Boolean(createRequest);
  return (
    <>
      {blocked ? (
        <Banner tone="warning" title={`${blocked.name} belum bisa dinonaktifkan`} action={<Button variant="text" onClick={() => setBlocked(null)}>Tutup</Button>}>
          {`${blocked.message} ${blocked.bookings.map((b) => `${b.bookingNumber} (${formatWibRange(b.startsAt, b.endsAt)})`).join(', ')}`}
        </Banner>
      ) : null}
      <DataGrid
        title="Ruang"
        showTitle={false}
        rows={state.rows}
        loading={state.loading}
        error={state.error}
        onRetry={load}
        columns={COLUMNS}
        filters={(
          <>
            <FilterMenuChip
              label="Status" icon="toggle_on" value={active} defaultValue="all"
              options={[{ value: 'all', label: 'Semua' }, { value: '1', label: 'Bisa dipinjam' }, { value: '0', label: 'Nonaktif' }]}
              onChange={setActive}
            />
          </>
        )}
        empty="Belum ada ruang. Tambahkan ruang rapat dan ruang lain yang bisa dipinjam."
        onRowClick={(r) => setEdit(r)}
        rowActions={(r) => (
          <ActionMenu
            size="sm"
            label={`Aksi ${r.name}`}
            items={[
              { label: 'Ubah', icon: 'edit', onClick: () => setEdit(r) },
              r.isActive
                ? { label: 'Nonaktifkan', icon: 'block', onClick: () => setToggle(r) }
                : { label: 'Aktifkan lagi', icon: 'check_circle', onClick: () => setToggle(r) },
            ]}
          />
        )}
        exportName="ruang-ga"
      />
      <GaResourceDialog
        open={dialogOpen}
        resource={edit}
        kind={createRequest?.kind || 'room'}
        locations={locations}
        onClose={() => { setEdit(null); onCreateClose?.(); }}
        onSaved={saved}
      />
      <ConfirmDialog
        open={Boolean(toggle)}
        title={toggle?.isActive ? `Nonaktifkan ${toggle?.name}?` : `Aktifkan ${toggle?.name}?`}
        message={toggle?.isActive ? 'Tidak bisa dipinjam lagi sampai diaktifkan. Riwayat peminjamannya tetap tersimpan.' : 'Bisa dipinjam lagi.'}
        confirmLabel={toggle?.isActive ? 'Nonaktifkan' : 'Aktifkan'}
        tone={toggle?.isActive ? 'danger' : 'primary'}
        loading={busy}
        onConfirm={confirmToggle}
        onClose={() => setToggle(null)}
      />
    </>
  );
}
