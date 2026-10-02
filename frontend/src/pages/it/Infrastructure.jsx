import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FilterMenuChip from '../../components/FilterMenuChip';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { Translate, Mixed } from '../../i18n/NoTranslate';
import { formatDate, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { BackupCheckDialog, CctvStatusDialog, GwsReviewDialog, PhoneHolderDialog, RegisterFormDialog } from './InfraDialogs';
import BastDialog from './BastDialog';
import InfraImportDialog from './InfraImportDialog';
import {
  ADD_LABELS, BACKUP_FREQUENCY_LABELS, BACKUP_STORAGE_LABELS, CCTV_RECORDER_LABELS, ENDPOINTS, NETWORK_TYPE_LABELS,
  PHONE_KIND_LABELS, RECORD_LABELS, TABS, VENDOR_KIND_LABELS, detailItems, filterRows, gwsItems, locationChips,
  phoneText, rowTitle, rowTitleParts, statusChips, statusKey, statusText, tabCount, tabFrom,
} from './infraModel';
import './it-infra.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;
const yesNo = (v) => (v === null || v === undefined ? '' : (v ? 'Ya' : 'Tidak'));
const statusColumn = (kind) => ({
  key: 'status', header: 'Status', nowrap: true,
  render: (r) => <StatusBadge status={statusKey(kind, r)} label={statusText(kind, r)} />,
  sortValue: (r) => statusText(kind, r),
  exportValue: (r) => statusText(kind, r),
});
const label = (map) => (key) => (r) => map[r[key]] || r[key] || '';

const COLUMNS = {
  network: [
    { key: 'deviceType', header: 'Tipe', translate: true, render: label(NETWORK_TYPE_LABELS)('deviceType'), sortValue: label(NETWORK_TYPE_LABELS)('deviceType'), exportValue: label(NETWORK_TYPE_LABELS)('deviceType') },
    { key: 'brandModel', header: 'Merek / model' },
    { key: 'serialNumber', header: 'Nomor seri' },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'ipAddress', header: 'Alamat IP', nowrap: true },
    { key: 'ispName', header: 'ISP terkait' },
    statusColumn('network'),
  ],
  isp: [
    { key: 'providerName', header: 'Provider' },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'bandwidthMbps', header: 'Bandwidth (Mbps)', type: 'number' },
    { key: 'isBackup', header: 'Cadangan', translate: true, render: (r) => yesNo(r.isBackup), exportValue: (r) => yesNo(r.isBackup) },
    { key: 'customerNumber', header: 'No. pelanggan' },
    { key: 'contractEnd', header: 'Akhir kontrak', type: 'date' },
    { key: 'monthlyCost', header: 'Biaya per bulan', type: 'money', align: 'end' },
    statusColumn('isp'),
  ],
  cctv: [
    { key: 'locationName', header: 'Lokasi' },
    { key: 'cameraCount', header: 'Kamera', type: 'number' },
    { key: 'camerasOffline', header: 'Offline', type: 'number' },
    { key: 'recorderType', header: 'Perekam', translate: true, render: label(CCTV_RECORDER_LABELS)('recorderType'), exportValue: label(CCTV_RECORDER_LABELS)('recorderType') },
    { key: 'cameraModel', header: 'Model' },
    { key: 'remoteAccess', header: 'Akses jarak jauh', translate: true, render: (r) => yesNo(r.remoteAccess), exportValue: (r) => yesNo(r.remoteAccess) },
    statusColumn('cctv'),
  ],
  backup: [
    { key: 'dataScope', header: 'Data' },
    { key: 'method', header: 'Metode' },
    { key: 'frequency', header: 'Frekuensi', translate: true, render: label(BACKUP_FREQUENCY_LABELS)('frequency'), exportValue: label(BACKUP_FREQUENCY_LABELS)('frequency') },
    { key: 'storageLocation', header: 'Lokasi backup', translate: true, render: label(BACKUP_STORAGE_LABELS)('storageLocation'), exportValue: label(BACKUP_STORAGE_LABELS)('storageLocation') },
    { key: 'lastCheckedOn', header: 'Diperiksa', type: 'date' },
    { key: 'dueOn', header: 'Pemeriksaan berikutnya', translate: true, render: (r) => (r.status === 'active' && r.dueOn ? `${formatDate(r.dueOn)}${r.overdue ? ' (terlambat)' : ''}` : ''), sortValue: (r) => r.dueOn || '' },
    { key: 'restoreTestedOn', header: 'Uji restore', type: 'date' },
    statusColumn('backup'),
  ],
  phone: [
    { key: 'number', header: 'Nomor', render: phoneText, sortValue: phoneText, exportValue: phoneText, nowrap: true },
    { key: 'kind', header: 'Jenis', translate: true, render: label(PHONE_KIND_LABELS)('kind'), exportValue: label(PHONE_KIND_LABELS)('kind') },
    { key: 'holderName', header: 'Pemegang', render: (r) => (r.holderName ? <>{r.holderName}{r.personResigned ? <Translate>{' (resign)'}</Translate> : ''}</> : '') },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'provider', header: 'Operator' },
    { key: 'monthlyCost', header: 'Biaya per bulan', type: 'money', align: 'end' },
    statusColumn('phone'),
  ],
  vendor: [
    { key: 'name', header: 'Nama' },
    { key: 'vendorKind', header: 'Jenis', translate: true, render: label(VENDOR_KIND_LABELS)('vendorKind'), exportValue: label(VENDOR_KIND_LABELS)('vendorKind') },
    { key: 'contactPerson', header: 'Kontak PIC' },
    { key: 'phone', header: 'Telepon PIC' },
    { key: 'email', header: 'Email' },
  ],
};

const NO_ROWS = [];
const SEARCH_PLACEHOLDER = {
  network: 'Cari model, seri, IP, atau lokasi',
  isp: 'Cari provider atau lokasi',
  cctv: 'Cari lokasi atau model',
  backup: 'Cari data atau metode',
  phone: 'Cari nomor atau pemegang',
  vendor: 'Cari vendor',
};
const EMPTY_TEXT = {
  network: 'Belum ada perangkat jaringan. Tambahkan atau impor dari laporan IT.',
  isp: 'Belum ada ISP. Tambahkan atau impor dari laporan IT.',
  cctv: 'Belum ada CCTV. Tambahkan atau impor dari laporan IT.',
  backup: 'Belum ada backup tercatat.',
  phone: 'Belum ada nomor perusahaan tercatat.',
  vendor: 'Belum ada vendor.',
};

function BackupHistory({ row }) {
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`${ENDPOINTS.backup}/${row.id}/checks`);
      setState({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setState({ rows: [], loading: false, error: errorMessage(error, 'Riwayat gagal dimuat.') });
    }
  }, [row.id, row.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (state.loading) return <LoadingState label="Memuat riwayat" />;
  if (state.error) return <EmptyState compact tone="error" title="Riwayat gagal dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  if (!state.rows.length) return <EmptyState compact title="Belum ada pemeriksaan" />;
  return (
    <ul className="it-infra__history">
      {state.rows.map((c) => (
        <li key={c.id} className="it-infra__history-item">
          <span className="it-infra__history-head">
            <span>{formatDate(c.checkedOn)}</span>
            <StatusBadge status={`backup_${c.result}`} label={c.resultLabel} />
          </span>
          <span className="it-infra__history-meta">{[c.restoreTested ? 'Uji restore dilakukan' : null, c.checkedByName, c.note].filter(Boolean).join(' · ') || '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function GwsPanel({ canManage, reloadKey, onAdd }) {
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(ENDPOINTS.gws);
      setState({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setState({ rows: [], loading: false, error: errorMessage(error, 'Periksa koneksi, lalu coba lagi.') });
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  const latest = state.rows[0] || null;
  return (
    <>
      {state.loading && !state.rows.length ? <LoadingState label="Memuat review" /> : null}
      {!state.loading && !state.error && !latest ? (
        <EmptyState
          icon="admin_panel_settings"
          title="Belum ada review keamanan"
          description="Catat review dari konsol admin Google tiap 3 bulan: pengguna aktif, super admin, MFA, berbagi ke luar, akun bersama, dan akun eks-karyawan."
          action={canManage ? <Button onClick={onAdd}>Catat review</Button> : null}
        />
      ) : null}
      {latest ? (
        <Card title="Review terakhir" subtitle={formatDate(latest.reviewedOn)}>
          <div className="pw-stack">
            <ul className="it-infra__flags" aria-label="Tanda risiko">
              {latest.riskFlags.length
                ? latest.riskFlags.map((f) => <li key={f.key} className="it-infra__flag">{f.label}</li>)
                : <li className="it-infra__flag it-infra__flag--ok">Tidak ada tanda risiko</li>}
            </ul>
            <KeyValue items={gwsItems(latest)} columns={2} />
          </div>
        </Card>
      ) : null}
      {state.rows.length || state.error ? (
        <DataGrid
          title="Riwayat review"
          rows={state.rows}
          loading={state.loading}
          error={state.error}
          onRetry={load}
          exportable={canManage}
          exportName="review-google-workspace"
          searchable={false}
          empty="Belum ada review"
          columns={[
            { key: 'reviewedOn', header: 'Tanggal', type: 'date' },
            { key: 'activeUsers', header: 'Pengguna aktif', type: 'number' },
            { key: 'superAdmins', header: 'Super admin', type: 'number' },
            { key: 'mfaEnforced', header: 'MFA wajib', translate: true, render: (r) => yesNo(r.mfaEnforced), exportValue: (r) => yesNo(r.mfaEnforced) },
            { key: 'exUsersActive', header: 'Eks-karyawan aktif', type: 'number' },
            { key: 'riskFlags', header: 'Tanda risiko', render: (r) => formatNumber(r.riskFlags.length), sortValue: (r) => r.riskFlags.length, exportValue: (r) => r.riskFlags.map((f) => f.label).join('; ') },
            { key: 'reviewedByName', header: 'Direview oleh' },
          ]}
        />
      ) : null}
    </>
  );
}

// Infrastruktur IT (People & Culture wave 2, row 2.3 — §4.4): one page with a
// tab per register. Each tab is one DataGrid with location and status chips;
// a row opens a side sheet with its facts and actions. Writes, export and
// the report import are for People & Culture Supervisor/Head (it.infra.manage).
export default function Infrastructure() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('it.infra.manage');
  const canVendor = canManage || permissions.includes('software_vendor.manage');
  const canDevices = permissions.includes('device.view');
  // Company numbers: IT and GA (operator subscriptions) both make the BAST.
  const canBast = canManage || permissions.includes('ga.ops.manage');
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('tab'));
  const openId = Number(params.get('open')) || null;

  const [summary, setSummary] = useState(null);
  // The rows are kept with the tab they were loaded for: on the render right
  // after a tab switch (and when a slow request of the previous tab answers
  // late) the grid and the filter chips must not show another tab's rows.
  const [loaded, setLoaded] = useState({ tab: '', rows: [] });
  const rows = loaded.tab === tab ? loaded.rows : NO_ROWS;
  const currentTab = useRef(tab);
  currentTab.current = tab;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filters, setFilters] = useState({ location: '', status: '' });
  const [form, setForm] = useState(null); // { kind, row }
  const [cctvTarget, setCctvTarget] = useState(null);
  const [checkTarget, setCheckTarget] = useState(null);
  const [holderTarget, setHolderTarget] = useState(null);
  const [gwsOpen, setGwsOpen] = useState(false);
  const [gwsReload, setGwsReload] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [bast, setBast] = useState(null); // { kind, row }

  const loadSummary = useCallback(async () => {
    try {
      const r = await api.get('/it/infrastructure/summary');
      setSummary(r.data.data || null);
    } catch { setSummary(null); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const load = useCallback(async () => {
    if (tab === 'gws') { setLoading(false); return; }
    setLoading(true); setLoadError('');
    try {
      const r = await api.get(ENDPOINTS[tab]);
      if (currentTab.current === tab) setLoaded({ tab, rows: r.data.data || [] });
    } catch (error) {
      if (currentTab.current !== tab) return;
      setLoaded({ tab, rows: [] });
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      if (currentTab.current === tab) setLoading(false);
    }
  }, [tab]);
  useEffect(() => { setFilters({ location: '', status: '' }); load(); }, [load]);

  const setParam = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });

  const refresh = async () => { await Promise.all([load(), loadSummary()]); };
  const selected = openId && tab !== 'gws' ? rows.find((r) => r.id === openId) || null : null;
  const closeSheet = () => setParam({ open: '' });

  // Dialogs opened from the URL (a link, or Prakasa AI's buka_halaman): the
  // same dialogs, under the same permissions, as the buttons below. Opening
  // one saves nothing.
  //   ?tab=isp&baru=1 · ?tab=isp&ubah=<id> · ?tab=cctv&open=<id>&form=status
  //   ?tab=backup&open=<id>&form=pemeriksaan · ?tab=phone&open=<id>&form=pemegang
  //   ?tab=phone&open=<id>&form=bast-serah-terima | bast-pengembalian
  const canEditTab = tab === 'vendor' ? canVendor : canManage;
  const rowsReady = tab !== 'gws' && !loading && loaded.tab === tab;
  useOpenFromUrl('baru', () => {
    if (!canEditTab) return;
    if (tab === 'gws') setGwsOpen(true); else setForm({ kind: tab, row: null });
    // One dialog host for every register of the page: an unsaved form is never replaced by a link (keepUnsaved).
  }, { keepUnsaved: true });
  useOpenFromUrl('ubah', (id) => {
    const target = rows.find((r) => String(r.id) === String(id));
    if (target && canEditTab) setForm({ kind: tab, row: target });
  }, { enabled: rowsReady, keepUnsaved: true });
  useOpenFromUrl('form', (name) => {
    const r = selected;
    if (!r) return;
    if (name === 'status' && tab === 'cctv' && canManage) setCctvTarget(r);
    if (name === 'pemeriksaan' && tab === 'backup' && canManage && r.status === 'active') setCheckTarget(r);
    if (name === 'pemegang' && tab === 'phone' && canManage && r.status !== 'terminated') setHolderTarget(r);
    if (name === 'bast-serah-terima' && tab === 'phone' && canBast && r.status === 'active') setBast({ kind: 'handover', row: r });
    if (name === 'bast-pengembalian' && tab === 'phone' && canBast) setBast({ kind: 'return', row: r });
  }, { enabled: rowsReady && (Boolean(selected) || !openId), keepUnsaved: true });

  const afterSave = async () => {
    setForm(null); setCctvTarget(null); setCheckTarget(null); setHolderTarget(null);
    await refresh();
  };

  // Row actions: at most two buttons (§4.9).
  const rowActions = (r) => {
    const buttons = [];
    if (tab === 'cctv' && canManage) buttons.push(<IconButton key="status" size="sm" icon="swap_horiz" label={`Ubah status ${rowTitle(tab, r)}`} onClick={() => setCctvTarget(r)} />);
    if (tab === 'backup' && canManage && r.status === 'active') buttons.push(<IconButton key="check" size="sm" icon="fact_check" label={`Catat pemeriksaan ${rowTitle(tab, r)}`} onClick={() => setCheckTarget(r)} />);
    if (tab === 'phone' && canManage && r.status !== 'terminated') buttons.push(<IconButton key="holder" size="sm" icon="person" label={`Ganti pemegang ${phoneText(r)}`} onClick={() => setHolderTarget(r)} />);
    if ((tab === 'vendor' && canVendor) || (tab !== 'vendor' && canManage)) buttons.push(<IconButton key="edit" size="sm" icon="edit" label={`Ubah ${rowTitle(tab, r)}`} onClick={() => setForm({ kind: tab, row: r })} />);
    return buttons.length ? <>{buttons}</> : null;
  };

  const sheetActions = (r) => {
    if (!r) return null;
    const buttons = [];
    if (tab === 'cctv' && canManage) buttons.push(<Button key="status" variant="secondary" icon="swap_horiz" onClick={() => setCctvTarget(r)}>Ubah status</Button>);
    if (tab === 'backup' && canManage && r.status === 'active') buttons.push(<Button key="check" variant="secondary" icon="fact_check" onClick={() => setCheckTarget(r)}>Catat pemeriksaan</Button>);
    if (tab === 'phone' && canManage && r.status !== 'terminated') buttons.push(<Button key="holder" variant="secondary" icon="person" onClick={() => setHolderTarget(r)}>Ganti pemegang</Button>);
    if (tab === 'phone' && canBast) {
      if (r.status === 'active') buttons.push(<Button key="bast-out" variant="secondary" icon="contract" onClick={() => setBast({ kind: 'handover', row: r })}>BAST serah terima</Button>);
      buttons.push(<Button key="bast-back" variant="text" icon="assignment_return" onClick={() => setBast({ kind: 'return', row: r })}>BAST pengembalian</Button>);
    }
    if ((tab === 'vendor' && canVendor) || (tab !== 'vendor' && canManage)) buttons.push(<Button key="edit" variant="text" icon="edit" onClick={() => setForm({ kind: tab, row: r })}>Ubah</Button>);
    return buttons.length ? <div className="it-infra__sheet-actions">{buttons}</div> : null;
  };

  const chipsLocation = tab === 'vendor' ? [] : locationChips(rows);
  const chipsStatus = tab === 'vendor' ? [] : statusChips(tab, rows);
  const vendorKinds = [...new Set(rows.map((r) => r.vendorKind))];
  const visible = tab === 'vendor'
    ? rows.filter((r) => !filters.status || r.vendorKind === filters.status)
    : filterRows(tab, rows, filters);
  const filterBar = tab === 'vendor' ? (
    <>
      <Chip selected={!filters.status} onClick={() => setFilters({ location: '', status: '' })}>{`Semua (${formatNumber(rows.length)})`}</Chip>
      {vendorKinds.map((k) => (
        <Chip key={k} selected={filters.status === k} onClick={() => setFilters({ location: '', status: filters.status === k ? '' : k })}>
          {`${VENDOR_KIND_LABELS[k] || k} (${formatNumber(rows.filter((r) => r.vendorKind === k).length)})`}
        </Chip>
      ))}
    </>
  ) : (
    <>
      <Chip selected={!filters.status} onClick={() => setFilters((f) => ({ ...f, status: '' }))}>{`Semua (${formatNumber(filterRows(tab, rows, { location: filters.location }).length)})`}</Chip>
      {chipsStatus.map((c) => (
        <Chip key={c.key} selected={filters.status === c.key} onClick={() => setFilters((f) => ({ ...f, status: f.status === c.key ? '' : c.key }))}>
          {`${c.label} (${formatNumber(filterRows(tab, rows, { location: filters.location, status: c.key }).length)})`}
        </Chip>
      ))}
      {chipsLocation.length > 1 || filters.location ? (
        <FilterMenuChip
          label="Lokasi"
          icon="location_on"
          value={filters.location}
          dataOptions
          options={[{ value: '', label: 'Semua', translate: true }, ...chipsLocation.map((c) => ({ value: c.key, label: `${c.name} (${formatNumber(c.count)})` }))]}
          onChange={(value) => setFilters((f) => ({ ...f, location: value }))}
        />
      ) : null}
    </>
  );

  let headerActions = null;
  const addButton = tab === 'gws'
    ? (canManage ? <Button icon="add" onClick={() => setGwsOpen(true)}>{ADD_LABELS.gws}</Button> : null)
    : ((tab === 'vendor' ? canVendor : canManage) ? <Button icon="add" onClick={() => setForm({ kind: tab, row: null })}>{ADD_LABELS[tab]}</Button> : null);
  if (canManage || addButton) {
    headerActions = (
      <>
        {canManage ? <Button variant="secondary" icon="upload_file" onClick={() => setImportOpen(true)}>Impor dari laporan IT</Button> : null}
        {addButton}
      </>
    );
  }

  const tabs = TABS.map((t) => {
    const count = tabCount(summary, t.k);
    return count !== undefined ? { ...t, count } : t;
  });

  return (
    <Page
      title="Infrastruktur IT"
      description="Jaringan, ISP, CCTV, backup, keamanan Google Workspace, nomor telepon dan HP perusahaan, serta vendor IT."
      actions={headerActions}
    >
      <TabBar tabs={tabs} value={tab} onChange={(k) => setParam({ tab: k === 'network' ? '' : k, open: '' })} label="Register infrastruktur" idPrefix="it-infra-tab" panelId="it-infra-panel" />
      <div id="it-infra-panel" role="tabpanel" aria-labelledby={`it-infra-tab-${tab}`} className="pw-stack pw-stack--lg">
        {tab === 'phone' ? <Banner tone="info">Hanya nomor milik perusahaan. Nomor pribadi, PIN, PUK, dan nomor SIM tidak dicatat.</Banner> : null}
        {tab === 'gws' ? (
          <GwsPanel canManage={canManage} reloadKey={gwsReload} onAdd={() => setGwsOpen(true)} />
        ) : (
          <DataGrid
            key={tab}
            title={TABS.find((t) => t.k === tab)?.l}
            showTitle={false}
            rows={visible}
            loading={loading}
            error={loadError}
            onRetry={load}
            exportable={canManage}
            exportName={`infrastruktur-${tab}`}
            searchPlaceholder={SEARCH_PLACEHOLDER[tab]}
            filters={rows.length ? filterBar : undefined}
            empty={rows.length ? 'Tidak ada data yang cocok dengan filter ini' : EMPTY_TEXT[tab]}
            onRowClick={(r) => setParam({ open: String(r.id) })}
            rowActions={rowActions}
            columns={COLUMNS[tab]}
          />
        )}
      </div>

      <SideSheet open={Boolean(selected)} onClose={closeSheet} title={selected ? (rowTitle(tab, selected) ? <Mixed {...rowTitleParts(tab, selected)} /> : RECORD_LABELS[tab]) : ''} footer={sheetActions(selected)}>
        {selected ? (
          <div className="pw-stack">
            <KeyValue items={detailItems(tab, selected)} />
            {tab === 'backup' ? (
              <section className="pw-stack" aria-label="Riwayat pemeriksaan">
                <h3 className="pw-title-section">Riwayat pemeriksaan</h3>
                <BackupHistory row={selected} />
              </section>
            ) : null}
          </div>
        ) : null}
      </SideSheet>

      <RegisterFormDialog open={Boolean(form)} kind={form?.kind} row={form?.row || null} canDevices={canDevices} onClose={() => setForm(null)} onSaved={afterSave} />
      <CctvStatusDialog open={Boolean(cctvTarget)} row={cctvTarget} onClose={() => setCctvTarget(null)} onSaved={afterSave} />
      <BackupCheckDialog open={Boolean(checkTarget)} row={checkTarget} onClose={() => setCheckTarget(null)} onSaved={afterSave} />
      <PhoneHolderDialog open={Boolean(holderTarget)} row={holderTarget} onClose={() => setHolderTarget(null)} onSaved={afterSave} />
      <GwsReviewDialog
        open={gwsOpen}
        latest={null}
        onClose={() => setGwsOpen(false)}
        onSaved={async () => { setGwsOpen(false); setGwsReload((n) => n + 1); await loadSummary(); }}
      />
      <BastDialog open={Boolean(bast)} subject="phone" kind={bast?.kind} target={bast?.row} onClose={() => setBast(null)} />
      {canManage ? <InfraImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} /> : null}
    </Page>
  );
}
