import { Mixed, data } from '../../i18n/NoTranslate';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDate, formatMoney, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import { GaOpsFormDialog, MaintenanceLogDialog } from './GaOpsDialogs';
import {
  ADD_LABELS, CATEGORY_LABELS, CONTRACT_KIND_LABELS, ENDPOINTS, RECORD_LABELS, STATE_LABELS, TABS, UTILITY_LABELS,
  attentionText, detailItems, formatPeriod, rowTitle, rowTitleParts, stateChips, stateOf, tabCount, tabFrom,
} from './gaOpsModel';
import './ga.css';

const errorMessage = (error, fallback) => error?.response?.data?.error?.message || fallback;
const stateColumn = (kind) => ({
  key: 'state', header: 'Status', nowrap: true,
  render: (r) => <StatusBadge status={stateOf(kind, r)} label={STATE_LABELS[stateOf(kind, r)]} />,
  sortValue: (r) => STATE_LABELS[stateOf(kind, r)],
  exportValue: (r) => STATE_LABELS[stateOf(kind, r)],
});
const label = (map, key) => (r) => map[r[key]] || r[key] || '';

const COLUMNS = {
  maintenance: [
    { key: 'name', header: 'Nama' },
    { key: 'category', header: 'Jenis', translate: true, render: label(CATEGORY_LABELS, 'category'), sortValue: label(CATEGORY_LABELS, 'category'), exportValue: label(CATEGORY_LABELS, 'category') },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'vendorName', header: 'Vendor' },
    { key: 'intervalDays', header: 'Interval (hari)', type: 'number' },
    { key: 'lastDoneOn', header: 'Terakhir', translateContext: 'upkeep', type: 'date' },
    { key: 'nextDueOn', header: 'Jadwal berikutnya', type: 'date' },
    stateColumn('maintenance'),
  ],
  contracts: [
    { key: 'vendorName', header: 'Vendor' },
    { key: 'kind', header: 'Jenis', translate: true, render: label(CONTRACT_KIND_LABELS, 'kind'), sortValue: label(CONTRACT_KIND_LABELS, 'kind'), exportValue: label(CONTRACT_KIND_LABELS, 'kind') },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'endOn', header: 'Berakhir', type: 'date' },
    { key: 'monthlyCost', header: 'Biaya per bulan', type: 'money', align: 'end' },
    stateColumn('contracts'),
  ],
  bills: [
    { key: 'period', header: 'Periode', render: (r) => formatPeriod(r.period), sortValue: (r) => r.period, exportValue: (r) => r.period, nowrap: true },
    { key: 'utility', header: 'Jenis', translate: true, render: label(UTILITY_LABELS, 'utility'), sortValue: label(UTILITY_LABELS, 'utility'), exportValue: label(UTILITY_LABELS, 'utility') },
    { key: 'locationName', header: 'Lokasi' },
    { key: 'usageAmount', header: 'Pemakaian', render: (r) => (r.usageAmount != null ? `${formatNumber(r.usageAmount)} ${r.unit || ''}`.trim() : ''), sortValue: (r) => r.usageAmount ?? -1, exportValue: (r) => r.usageAmount ?? '' },
    { key: 'amount', header: 'Tagihan', type: 'money', align: 'end' },
    { key: 'dueOn', header: 'Jatuh tempo', type: 'date' },
    stateColumn('bills'),
  ],
};

const SEARCH_PLACEHOLDER = { maintenance: 'Cari nama, lokasi, atau vendor', contracts: 'Cari vendor atau lokasi', bills: 'Cari lokasi atau ID pelanggan' };
const EMPTY = {
  maintenance: { icon: 'build', title: 'Belum ada jadwal perawatan', description: 'Catat perawatan rutin seperti servis AC, isi ulang APAR, genset, dan pengendalian hama. Sistem mengingatkan saat jatuh tempo.' },
  contracts: { icon: 'handshake', title: 'Belum ada kontrak', description: 'Catat sewa gedung serta kontrak kebersihan, keamanan, dan vendor lain. Eskalasi muncul sebelum kontrak berakhir.' },
  bills: { icon: 'bolt', title: 'Belum ada tagihan utilitas', description: 'Catat tagihan listrik, air, dan gas per lokasi tiap bulan untuk memantau biaya dan jatuh tempo.' },
};

function UpkeepHistory({ row }) {
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`${ENDPOINTS.maintenance}/${row.id}/logs`);
      setState({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setState({ rows: [], loading: false, error: errorMessage(error, 'Riwayat gagal dimuat.') });
    }
  }, [row.id, row.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (state.loading) return <LoadingState label="Memuat riwayat" />;
  if (state.error) return <EmptyState compact tone="error" title="Riwayat gagal dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  if (!state.rows.length) return <EmptyState compact title="Belum ada perawatan dicatat" />;
  return (
    <ul className="ga-ops__history">
      {state.rows.map((g) => (
        <li key={g.id} className="ga-ops__history-item">
          <span className="ga-ops__history-head">
            <span>{formatDate(g.doneOn)}</span>
            <StatusBadge status={`upkeep_done_${g.result}`} label={g.resultLabel} />
          </span>
          <span className="ga-ops__history-meta">
            {g.onTime && g.cost == null && !g.doneByName && !g.note ? '—' : (
              <Mixed parts={[g.onTime ? null : `Terlambat dari jadwal ${formatDate(g.dueOn)}`, g.cost != null ? formatMoney(g.cost) : null, data(g.doneByName), data(g.note)]} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Operasional GA (People & Culture): one page, a tab per register. Each tab is
// a DataGrid with status chips; a row opens a side sheet with its facts, and
// for upkeep its history. People & Culture sees it (ga.ops.view); Supervisor/
// Head change it (ga.ops.manage); GA staff (ga.request.process) record upkeep.
export default function GaOperations() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('ga.ops.manage');
  const canRecord = canManage || permissions.includes('ga.request.process');
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('tab'));
  const openId = Number(params.get('open')) || null;

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowsTab, setRowsTab] = useState(null); // the register `rows` were loaded for
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [form, setForm] = useState(null); // { kind, row }
  const [logTarget, setLogTarget] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const r = await api.get('/ga/ops/summary');
      setSummary(r.data.data || null);
    } catch { setSummary(null); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await api.get(ENDPOINTS[tab]);
      setRows(r.data.data || []);
      setRowsTab(tab);
    } catch (error) {
      setRows([]);
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => { setRows([]); setStateFilter(''); load(); }, [load]);

  const setParam = (changes) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  }, { replace: true });

  const refresh = async () => { await Promise.all([load(), loadSummary()]); };
  const afterSave = async () => { setForm(null); setLogTarget(null); await refresh(); };
  const selected = openId ? rows.find((r) => r.id === openId) || null : null;

  const canLog = (r) => tab === 'maintenance' && canRecord && r.status === 'active';

  // The dialogs open by URL too (a link, or Prakasa AI's buka_halaman), under
  // the same rules as their buttons; nothing here saves:
  //   ?tab=contracts&baru=1                      the add form of that register
  //   ?tab=contracts&ubah=<id>                   the edit form of that row
  //   ?open=<id jadwal>&form=catat-perawatan     "Catat perawatan" for that schedule
  const listed = !loading && !loadError && rowsTab === tab;
  useOpenFromUrl('baru', () => {
    if (canManage) setForm({ kind: tab, row: null });
    // One dialog host for every tab's form: an unsaved form is never replaced by a link (keepUnsaved).
  }, { keepUnsaved: true });
  useOpenFromUrl('ubah', (id) => {
    const target = rows.find((r) => String(r.id) === String(id));
    if (target && canManage) setForm({ kind: tab, row: target });
  }, { enabled: listed, keepUnsaved: true });
  useOpenFromUrl('form', (name) => {
    if (name === 'catat-perawatan' && selected && canLog(selected)) setLogTarget(selected);
  }, { enabled: listed, keepUnsaved: true });
  const rowActions = (r) => {
    const buttons = [];
    if (canLog(r)) buttons.push(<IconButton key="log" size="sm" icon="task_alt" label={`Catat perawatan ${r.name}`} onClick={() => setLogTarget(r)} />);
    if (canManage) buttons.push(<IconButton key="edit" size="sm" icon="edit" label={`Ubah ${rowTitle(tab, r)}`} onClick={() => setForm({ kind: tab, row: r })} />);
    return buttons.length ? <>{buttons}</> : null;
  };
  const sheetActions = (r) => {
    if (!r) return null;
    const buttons = [];
    if (canLog(r)) buttons.push(<Button key="log" variant="secondary" icon="task_alt" onClick={() => setLogTarget(r)}>Catat perawatan</Button>);
    if (canManage) buttons.push(<Button key="edit" variant="text" icon="edit" onClick={() => setForm({ kind: tab, row: r })}>Ubah</Button>);
    return buttons.length ? <div className="ga-ops__sheet-actions">{buttons}</div> : null;
  };

  const chips = stateChips(tab, rows);
  const visible = stateFilter ? rows.filter((r) => stateOf(tab, r) === stateFilter) : rows;
  const filterBar = (
    <>
      <Chip selected={!stateFilter} onClick={() => setStateFilter('')}>{`Semua (${formatNumber(rows.length)})`}</Chip>
      {chips.map((c) => (
        <Chip key={c.key} selected={stateFilter === c.key} onClick={() => setStateFilter(stateFilter === c.key ? '' : c.key)}>
          {`${c.label} (${formatNumber(rows.filter((r) => stateOf(tab, r) === c.key).length)})`}
        </Chip>
      ))}
    </>
  );
  const attention = attentionText(summary);
  const tabs = TABS.map((t) => {
    const count = tabCount(summary, t.k);
    return count !== undefined ? { ...t, count } : t;
  });
  const empty = EMPTY[tab];

  return (
    <Page
      title="Operasional GA"
      description="Perawatan berkala, kontrak & sewa, dan tagihan utilitas kantor — dikelola GA, bagian People & Culture."
      actions={canManage ? <Button icon="add" onClick={() => setForm({ kind: tab, row: null })}>{ADD_LABELS[tab]}</Button> : null}
    >
      {attention ? <Banner tone="warning" title="Perlu ditindaklanjuti">{attention}</Banner> : null}
      <TabBar tabs={tabs} value={tab} onChange={(k) => setParam({ tab: k === 'maintenance' ? '' : k, open: '' })} label="Register operasional GA" idPrefix="ga-ops-tab" panelId="ga-ops-panel" />
      <div id="ga-ops-panel" role="tabpanel" aria-labelledby={`ga-ops-tab-${tab}`} className="pw-stack pw-stack--lg">
        {!loading && !loadError && !rows.length ? (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            action={canManage ? <Button onClick={() => setForm({ kind: tab, row: null })}>{ADD_LABELS[tab]}</Button> : null}
          />
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
            exportName={`operasional-ga-${tab}`}
            searchPlaceholder={SEARCH_PLACEHOLDER[tab]}
            filters={rows.length ? filterBar : undefined}
            empty="Tidak ada data yang cocok dengan filter ini"
            onRowClick={(r) => setParam({ open: String(r.id) })}
            rowActions={rowActions}
            columns={COLUMNS[tab]}
          />
        )}
      </div>

      <SideSheet open={Boolean(selected)} onClose={() => setParam({ open: '' })} title={selected ? (rowTitle(tab, selected) ? <Mixed parts={rowTitleParts(tab, selected)} /> : RECORD_LABELS[tab]) : ''} footer={sheetActions(selected)}>
        {selected ? (
          <div className="pw-stack">
            <StatusBadge status={stateOf(tab, selected)} label={STATE_LABELS[stateOf(tab, selected)]} />
            <KeyValue items={detailItems(tab, selected)} />
            {tab === 'maintenance' ? (
              <section className="pw-stack" aria-label="Riwayat perawatan">
                <h3 className="pw-title-section">Riwayat perawatan</h3>
                <UpkeepHistory row={selected} />
              </section>
            ) : null}
          </div>
        ) : null}
      </SideSheet>

      <GaOpsFormDialog open={Boolean(form)} kind={form?.kind} row={form?.row || null} onClose={() => setForm(null)} onSaved={afterSave} />
      <MaintenanceLogDialog open={Boolean(logTarget)} row={logTarget} onClose={() => setLogTarget(null)} onSaved={afterSave} />
    </Page>
  );
}
