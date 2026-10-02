import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import SideSheet from '../../components/SideSheet';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import { toast } from '../../components/Toast';
import { formatDateTime, formatNumber } from '../../components/format';
import FilterChips from './FilterChips';
import { NoTranslate } from '../../i18n/NoTranslate';
import './IntegrationLogs.css';

const PROVIDER_LABELS = {
  google_drive: 'Google Drive',
  google_docs: 'Google Docs',
  google_sheets: 'Google Sheets',
  google_slides: 'Google Slides',
  google_calendar: 'Google Calendar',
  google_calendar_user: 'Google Calendar (akun pengguna)',
  google_meet: 'Google Meet',
  google_chat: 'Google Chat',
  google_chat_user: 'Google Chat (akun pengguna)',
  google_chat_drive: 'Google Chat · lampiran Drive',
  gmail: 'Gmail',
  google_gmail: 'Gmail',
  google_gmail_user: 'Gmail (akun pengguna)',
  google_mydrive: 'My Drive',
  google_groups: 'Google Groups',
  google_directory: 'Direktori Google Workspace',
  google_analytics: 'Google Analytics',
  google_tasks: 'Google Tasks',
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude',
  n8n: 'n8n',
  claude_team: 'Claude Team',
  accurate: 'Accurate',
  simplidots: 'SimpliDOTS',
  jurnal: 'Jurnal',
  kantorku: 'KantorKu',
  internal: 'Internal',
};
// A provider the list does not know shows its raw code: record data, never translated.
const providerNode = (provider) => (PROVIDER_LABELS[provider] ? PROVIDER_LABELS[provider] : <NoTranslate>{provider}</NoTranslate>);

const LOG_STATUS_LABELS = { success: 'Berhasil', failed: 'Gagal', skipped: 'Dilewati' };
const TABS = [
  { k: 'health', l: 'Kesehatan 24 jam', icon: 'monitor_heart' },
  { k: 'logs', l: 'Log detail', icon: 'list_alt' },
];
const NO_FILTERS = { provider: '', status: '', from: '', to: '' };

function LogStatusBadge({ status }) {
  return <StatusBadge status={status} label={LOG_STATUS_LABELS[status]} />;
}

const parseMeta = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

function MetaBlock({ title, value }) {
  const data = parseMeta(value);
  return (
    <section className="intlog-meta">
      <h3 className="pw-overline">{title}</h3>
      <pre className="intlog-meta__code" data-no-translate="">{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
    </section>
  );
}

export default function IntegrationLogs() {
  const [tab, setTab] = useState('health');
  const [health, setHealth] = useState([]);
  const [healthError, setHealthError] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [logsError, setLogsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [detail, setDetail] = useState(null);

  const loadHealth = useCallback(() => {
    setLoading(true);
    setHealthError('');
    api.get('/integration-logs/health')
      .then((r) => setHealth(r.data.data || []))
      .catch((e) => setHealthError(apiErrorMessage(e, 'Kesehatan integrasi tidak dapat dimuat.')))
      .finally(() => setLoading(false));
  }, []);

  const loadLogs = useCallback(async (page = 1) => {
    setLoading(true);
    setLogsError('');
    try {
      const params = { page, limit: 20 };
      if (filters.provider) params.provider = filters.provider;
      if (filters.status) params.status = filters.status;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const r = await api.get('/integration-logs', { params });
      setRows(r.data.data || []);
      setMeta(r.data.meta || { page, total: r.data.data?.length || 0 });
    } catch (e) {
      setLogsError(apiErrorMessage(e, 'Log integrasi tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (tab === 'health') loadHealth();
    else loadLogs(1);
  }, [tab, loadHealth, loadLogs]);

  const showDetail = async (id) => {
    try {
      const r = await api.get(`/integration-logs/${id}`);
      setDetail(r.data.data);
    } catch (e) {
      toast(apiErrorMessage(e, 'Detail log gagal dimuat.'), 'error');
    }
  };

  const columns = [
    { key: 'createdAt', header: 'Waktu', type: 'datetime' },
    { key: 'provider', header: 'Layanan', translate: true, render: (r) => providerNode(r.provider) },
    { key: 'operation', header: 'Operasi', render: (r) => (r.operation ? <code data-no-translate="" className="intlog-code">{r.operation}</code> : '') },
    { key: 'status', header: 'Status', render: (r) => <LogStatusBadge status={r.status} /> },
    { key: 'durationMs', header: 'Durasi (ms)', type: 'number' },
    { key: 'errorMessage', header: 'Kesalahan', render: (r) => (r.errorMessage ? <span data-no-translate="" className="intlog-error">{r.errorMessage}</span> : '') },
  ];

  let healthBody;
  if (loading) healthBody = <LoadingState />;
  else if (healthError) {
    healthBody = (
      <EmptyState
        tone="error"
        title="Kesehatan integrasi gagal dimuat"
        description={healthError}
        action={<Button variant="text" type="button" onClick={loadHealth}>Coba lagi</Button>}
      />
    );
  } else if (!health.length) {
    healthBody = <EmptyState icon="monitor_heart" title="Tidak ada aktivitas integrasi dalam 24 jam terakhir." />;
  } else {
    healthBody = (
      <div className="intlog-health">
        {health.map((h) => {
          const success = Number(h.success || 0);
          const failed = Number(h.failed || 0);
          const skipped = Number(h.skipped || 0);
          const total = success + failed + skipped;
          const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
          return (
            <StatCard
              key={h.provider}
              label={providerNode(h.provider)}
              value={`${successRate}%`}
              empty={total === 0}
              note={(
                <span className="intlog-health__note">
                  <span>
                    {formatNumber(success)} berhasil · <span className={failed > 0 ? 'intlog-failed' : undefined}>{formatNumber(failed)} gagal</span> · {formatNumber(skipped)} dilewati
                  </span>
                  <span>
                    {h.avgDurationMs ? `Rata-rata ${formatNumber(Math.round(Number(h.avgDurationMs)))} ms · ` : ''}
                    Terakhir {h.lastCall ? formatDateTime(h.lastCall) : '—'}
                  </span>
                </span>
              )}
            />
          );
        })}
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Log integrasi"
        description="Panggilan ke layanan luar: kesehatan 24 jam terakhir dan log per panggilan."
        actions={(
          <Button variant="secondary" icon="refresh" onClick={() => (tab === 'health' ? loadHealth() : loadLogs(1))}>
            Muat ulang
          </Button>
        )}
      />

      <div className="pw-stack pw-stack--lg">
        <TabBar tabs={TABS} value={tab} onChange={setTab} label="Tampilan log integrasi" idPrefix="intlog-tab" panelId="intlog-panel" />
        <div id="intlog-panel" role="tabpanel" aria-labelledby={`intlog-tab-${tab}`}>
          {tab === 'health' ? healthBody : (
            <DataGrid
              title="Log integrasi"
              exportName="integration-logs"
              columns={columns}
              rows={rows}
              loading={loading}
              error={logsError}
              onRetry={() => loadLogs(meta.page || 1)}
              meta={meta}
              onPageChange={loadLogs}
              filters={(
                <FilterChips
                  label="Filter log"
                  values={filters}
                  onChange={setFilters}
                  fields={[
                    { key: 'provider', label: 'Layanan', type: 'select', options: Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label })) },
                    { key: 'status', label: 'Status', type: 'select', options: Object.entries(LOG_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
                    { key: 'from', label: 'Dari tanggal', type: 'date' },
                    { key: 'to', label: 'Sampai tanggal', type: 'date' },
                  ]}
                />
              )}
              empty="Tidak ada log"
              onRowClick={(r) => showDetail(r.id)}
            />
          )}
        </div>
      </div>

      <SideSheet open={!!detail} onClose={() => setDetail(null)} title={detail ? `Log #${detail.id}` : ''}>
        {detail ? (
          <div className="pw-stack">
            <KeyValue
              items={[
                { label: 'Layanan', value: providerNode(detail.provider), translate: true },
                { label: 'Operasi', value: detail.operation },
                { label: 'Status', value: <LogStatusBadge status={detail.status} /> },
                { label: 'Durasi', value: `${formatNumber(detail.durationMs || 0)} ms` },
                { label: 'Waktu', value: detail.createdAt ? formatDateTime(detail.createdAt) : null },
                { label: 'Entitas', value: detail.entityId },
                { label: 'Pengguna', value: detail.userId },
                { label: 'Subjek', value: detail.subjectType || detail.subjectId ? `${detail.subjectType || '—'} #${detail.subjectId || '—'}` : null },
              ]}
            />
            {detail.errorMessage ? <Banner tone="error" title="Kesalahan"><NoTranslate>{detail.errorMessage}</NoTranslate></Banner> : null}
            {detail.requestMeta ? <MetaBlock title="Meta permintaan" value={detail.requestMeta} /> : null}
            {detail.responseMeta ? <MetaBlock title="Meta respons" value={detail.responseMeta} /> : null}
          </div>
        ) : null}
      </SideSheet>
    </Page>
  );
}
