import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Avatar from '../../components/Avatar';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import FilterMenuChip from '../../components/FilterMenuChip';
import IconButton from '../../components/IconButton';
import Page from '../../components/Page';
import Segmented from '../../components/Segmented';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import ReportImportDialog from '../it/ReportImportDialog';
import { departmentOptions, useDepartments, useLocations } from '../it/useLookups';
import OrgChart from './OrgChart';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import PersonFormDialog from './PersonFormDialog';
import PersonSheet from './PersonSheet';
import {
  ACCOUNT_FILTERS, STATUS_FILTERS, directoryQuery, personDateMarks, personMarks, personStatusKey, unreviewedNote,
} from './directoryModel';
import './people.css';

const PAGE_SIZE = 50;
const VIEWS = [
  { value: 'daftar', label: 'Daftar', icon: 'list' },
  { value: 'bagan', label: 'Bagan', icon: 'account_tree' },
];

function NameCell({ entry, manage }) {
  const marks = personMarks(entry, manage);
  const dates = personDateMarks(entry);
  return (
    <span className="people-name">
      <Avatar name={entry.name} size="md" tone="auto" />
      <span className="pw-cell">
        <span data-no-translate="" className="pw-cell__title">{entry.name}</span>
        {marks.length || dates.length ? (
          <span className="people-name__marks">
            {dates.map((d) => <StatusBadge key={d.status} status={d.status} label={d.label} />)}
            {marks.map((m) => <StatusBadge key={m} status={m} />)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

// Direktori (People & Culture wave 1, row 1.1; Kerja Harian menu): everyone
// in the company sees the work contacts; People & Culture also manages the
// profile, resign, exclusion, and imports the report's User List. A row opens
// the person's profile in a side sheet (/people/directory/:key).
export default function Directory() {
  const navigate = useNavigate();
  const { key: personKey } = useParams();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const manage = permissions.includes('people.directory.manage');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'bagan' ? 'bagan' : 'daftar';
  const filters = {
    status: STATUS_FILTERS.some((f) => f.key === params.get('status')) ? params.get('status') : 'active',
    departmentId: params.get('division') || '',
    locationId: params.get('location') || '',
    account: params.get('account') || '',
    unreviewed: manage && params.get('unreviewed') === '1',
    q: params.get('q') || '',
  };
  const queryKey = JSON.stringify(filters);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [summary, setSummary] = useState(null);
  const [formEntry, setFormEntry] = useState(undefined); // undefined closed, null new, object edit
  // /people/directory?baru=1 opens "Tambah orang"; an edit opens from the person's sheet (PersonSheet: ?ubah=1).
  useOpenFromUrl('baru', () => setFormEntry(null), { enabled: manage, keepUnsaved: true });
  const [importOpen, setImportOpen] = useState(false);
  const [sheetReload, setSheetReload] = useState(0);
  const departments = useDepartments(true);
  const locations = useLocations(true);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/people/directory', { params: directoryQuery({ ...JSON.parse(queryKey), page, limit: PAGE_SIZE }, manage) });
      setRows(r.data.data || []);
      setMeta({ page, limit: PAGE_SIZE, total: 0, ...(r.data.meta || {}) });
    } catch (error) {
      setLoadError(error.response?.data?.error?.message || 'Periksa koneksi, lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  }, [queryKey, manage]);
  const loadSummary = useCallback(async () => {
    try {
      const r = await api.get('/people/directory/summary');
      setSummary(r.data.data || null);
    } catch {
      setSummary(null); // the list still works; only the counts are missing
    }
  }, []);
  useEffect(() => { if (view === 'daftar') load(1); }, [load, view]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const setFilter = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [k, value] of Object.entries(changes)) { if (value) next.set(k, value); else next.delete(k); }
    return next;
  }, { replace: true });
  const search = params.toString();
  const linkTo = (k) => `/people/directory/${k}${search ? `?${search}` : ''}`;
  const closeSheet = () => navigate(`/people/directory${search ? `?${search}` : ''}`);

  const saved = async (result) => {
    const created = formEntry === null;
    setFormEntry(undefined);
    await Promise.all([load(meta.page || 1), loadSummary()]);
    setSheetReload((n) => n + 1);
    // A new person, or an account whose first save created its row (u… → p…),
    // opens under its own key.
    if (result?.key && (created || personKey) && result.key !== personKey) navigate(linkTo(result.key));
  };

  const divisionChoices = [{ value: '', label: 'Semua' }, ...departmentOptions(departments.rows)];
  const locationChoices = [{ value: '', label: 'Semua', translate: true }, ...locations.rows.map((l) => ({ value: String(l.id), label: l.name }))];
  const countOf = (key) => {
    if (!summary) return '';
    const n = { resigned: summary.resigned, excluded: summary.excluded }[key];
    return n === undefined || n === null ? '' : ` (${formatNumber(n)})`;
  };
  const unreviewed = Number(summary?.unreviewedAccounts) || 0;

  const filterBar = (
    <>
      {manage ? STATUS_FILTERS.map((f) => (
        <Chip key={f.key} selected={!filters.unreviewed && filters.status === f.key} onClick={() => setFilter({ status: f.key === 'active' ? '' : f.key, unreviewed: '' })}>
          {`${f.label}${countOf(f.key)}`}
        </Chip>
      )) : null}
      {manage && (filters.unreviewed || unreviewed > 0) ? (
        <Chip selected={filters.unreviewed} onClick={() => setFilter({ unreviewed: filters.unreviewed ? '' : '1', status: '' })}>
          {`Belum ditinjau${summary ? ` (${formatNumber(unreviewed)})` : ''}`}
        </Chip>
      ) : null}
      <FilterMenuChip label="Divisi" icon="groups" value={filters.departmentId} options={divisionChoices} onChange={(value) => setFilter({ division: value })} />
      <FilterMenuChip label="Lokasi" icon="location_on" value={filters.locationId} options={locationChoices} dataOptions onChange={(value) => setFilter({ location: value })} />
      <FilterMenuChip label="Akun" icon="badge" value={filters.account} options={ACCOUNT_FILTERS} onChange={(value) => setFilter({ account: value })} />
    </>
  );

  const columns = [
    { key: 'name', header: 'Nama', render: (r) => <NameCell entry={r} manage={manage} />, sortValue: (r) => r.name, exportValue: (r) => r.name },
    { key: 'position', header: 'Jabatan' },
    { key: 'departmentName', header: 'Divisi', translate: true },
    { key: 'managerName', header: 'Atasan' },
    { key: 'workEmail', header: 'Email kerja' },
    { key: 'workPhone', header: 'Telepon kerja', nowrap: true },
    { key: 'locationName', header: 'Lokasi' },
    manage ? {
      key: 'status', header: 'Status', nowrap: true,
      render: (r) => <StatusBadge status={personStatusKey(r)} label={r.kind === 'excluded' ? 'Dikecualikan' : r.statusLabel} />,
      exportValue: (r) => (r.kind === 'excluded' ? 'Dikecualikan' : r.statusLabel),
    } : null,
  ].filter(Boolean);

  return (
    <Page
      title="Direktori"
      description="Kontak kerja, jabatan, atasan langsung, dan lokasi kerja setiap orang di perusahaan."
      actions={manage ? (
        <>
          <Button variant="secondary" icon="upload_file" onClick={() => setImportOpen(true)}>Impor dari laporan</Button>
          <Button icon="person_add" onClick={() => setFormEntry(null)}>Tambah orang</Button>
        </>
      ) : null}
    >
      <Segmented label="Tampilan direktori" options={VIEWS} value={view} onChange={(value) => setFilter({ view: value === 'bagan' ? 'bagan' : '' })} />
      {manage && unreviewed > 0 && !filters.unreviewed ? (
        <Banner
          tone="info"
          title={unreviewedNote(unreviewed)}
          action={<Button variant="text" onClick={() => setFilter({ unreviewed: '1', status: '', view: '' })}>Tampilkan</Button>}
        >
          Lengkapi jabatan, atasan, dan lokasinya, atau tandai Dikecualikan untuk akun uji dan akun bersama.
        </Banner>
      ) : null}

      {view === 'bagan' ? (
        <>
          <div className="pw-row">
            <FilterMenuChip label="Divisi" icon="groups" value={filters.departmentId} options={divisionChoices} onChange={(value) => setFilter({ division: value })} />
          </div>
          <OrgChart departmentId={filters.departmentId} linkTo={linkTo} />
        </>
      ) : (
        <DataGrid
          title="Direktori"
          showTitle={false}
          idKey="key"
          exportName="direktori"
          rows={rows}
          loading={loading}
          error={loadError}
          onRetry={() => load(meta.page || 1)}
          meta={meta}
          onPageChange={load}
          search={filters.q}
          onSearchChange={(value) => setFilter({ q: value })}
          searchPlaceholder="Cari nama, email kerja, atau jabatan"
          filters={filterBar}
          columns={columns}
          empty={filters.q || filters.departmentId || filters.locationId || filters.account ? 'Tidak ada orang yang cocok dengan filter ini' : 'Belum ada orang di direktori'}
          onRowClick={(r) => navigate(linkTo(r.key))}
          rowActions={manage ? (r) => <IconButton size="sm" icon="edit" label={`Ubah profil ${r.name}`} onClick={() => setFormEntry(r)} /> : undefined}
        />
      )}

      <PersonSheet
        personKey={formEntry === undefined ? personKey : null}
        manage={manage}
        linkTo={linkTo}
        reloadKey={sheetReload}
        onClose={closeSheet}
        onEdit={(entry) => setFormEntry(entry)}
      />
      {manage ? (
        <>
          <PersonFormDialog open={formEntry !== undefined} entry={formEntry || null} onClose={() => setFormEntry(undefined)} onSaved={saved} />
          <ReportImportDialog
            open={importOpen}
            kind="people"
            onClose={() => setImportOpen(false)}
            onImported={async () => { await Promise.all([load(1), loadSummary()]); }}
          />
        </>
      ) : null}
    </Page>
  );
}
