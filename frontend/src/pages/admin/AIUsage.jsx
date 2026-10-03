import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import SideSheet from '../../components/SideSheet';
import { formatDateTime, formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import FilterChips from './FilterChips';
import {
  AI_EVENT_LABELS, AI_MODULE_LABELS, AI_PROVIDER_LABELS, aiEventLabel, aiModuleLabel, aiProviderLabel, aiUserLabel, labelWithCode,
} from './aiLabels';
import './AIUsage.css';
import { NoTranslate, Translate } from '../../i18n/NoTranslate';

const NO_FILTERS = { entityId: '', departmentId: '', module: '', provider: '', from: '', to: '' };
const optionsOf = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

// A person's name is record data; the "Pengguna #12" fallback is a label.
function userValue(row) {
  if (row?.userName) return row.userName;
  const fallback = aiUserLabel(row);
  return fallback ? <Translate>{fallback}</Translate> : '';
}

// labelWithCode for a translated zone: the label is translated, the code never.
// A code the label map does not know is shown in words: data as well.
function codeValue(label, code, labels) {
  if (!code) return null;
  if (!label || label === code) return <NoTranslate>{String(code)}</NoTranslate>;
  if (labels && !labels[code]) return <NoTranslate>{`${label} (${code})`}</NoTranslate>;
  return <>{label}<NoTranslate>{` (${code})`}</NoTranslate></>;
}

// A code column: the Indonesian label, the code on a quiet second line; the
// code stays in search and export ("Pusat perintah AI (ai_command_center)").
function codeColumn(key, header, toLabel, labels) {
  return {
    key,
    header,
    translate: true,
    render: (row) => (row[key] ? (
      <span className="pw-cell">
        <span className="pw-cell__title" data-no-translate={labels[row[key]] ? undefined : ''}>{toLabel(row[key])}</span>
        <span data-no-translate="" className="pw-cell__meta">{row[key]}</span>
      </span>
    ) : ''),
    exportValue: (row) => labelWithCode(toLabel(row[key]), row[key]),
  };
}

const tokens = (row) => `${formatNumber(row.tokensIn || 0)} / ${formatNumber(row.tokensOut || 0)}`;

export default function AIUsage() {
  const { user } = useAuth();
  const isAdmin = (user?.permissions || []).includes('ai_command.admin.view');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 20 };
      Object.entries(filters).forEach(([key, value]) => {
        if (!value) return;
        if (key === 'from' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          params[key] = `${value} 00:00:00`;
        } else if (key === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          params[key] = `${value} 23:59:59`;
        } else {
          params[key] = value;
        }
      });
      const r = await api.get('/ai-command/usage', { params });
      setRows(r.data.data || []);
      setMeta(r.data.meta || { page, limit: 20, total: r.data.data?.length || 0 });
    } catch (e) {
      setError(apiErrorMessage(e, 'Riwayat penggunaan AI tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1); }, [load]);

  const columns = [
    { key: 'createdAt', header: 'Waktu', type: 'datetime' },
    {
      key: 'userId',
      header: 'Pengguna',
      render: userValue,
      exportValue: (r) => (r.userName ? `${r.userName} (#${r.userId})` : aiUserLabel(r)),
    },
    codeColumn('eventType', 'Peristiwa', aiEventLabel, AI_EVENT_LABELS),
    codeColumn('module', 'Modul', aiModuleLabel, AI_MODULE_LABELS),
    codeColumn('provider', 'Penyedia', aiProviderLabel, AI_PROVIDER_LABELS),
    { key: 'model', header: 'Model' },
    { key: 'tokens', header: 'Token masuk / keluar', render: tokens },
    { key: 'durationMs', header: 'Durasi', render: (r) => (r.durationMs != null ? `${formatNumber(r.durationMs)} ms` : '') },
  ];

  return (
    <Page>
      <PageHeader
        title="Pemakaian AI"
        description={isAdmin
          ? 'Riwayat penggunaan AI. Tambahkan filter entitas untuk melihat cakupan admin yang lebih luas.'
          : 'Riwayat penggunaan AI Anda.'}
        actions={<Button variant="secondary" icon="refresh" onClick={() => load(1)}>Muat ulang</Button>}
      />

      <DataGrid
        title={isAdmin ? 'Semua penggunaan' : 'Penggunaan saya'}
        exportName="ai-usage"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={() => load(meta.page || 1)}
        meta={meta}
        onPageChange={load}
        filters={(
          <FilterChips
            label="Filter penggunaan AI"
            values={filters}
            onChange={setFilters}
            fields={[
              ...(isAdmin ? [
                { key: 'entityId', label: 'ID entitas', type: 'number' },
                { key: 'departmentId', label: 'ID divisi', type: 'number' },
              ] : []),
              { key: 'module', label: 'Modul', type: 'select', options: optionsOf(AI_MODULE_LABELS) },
              { key: 'provider', label: 'Penyedia', type: 'select', options: optionsOf(AI_PROVIDER_LABELS) },
              { key: 'from', label: 'Dari tanggal', type: 'date' },
              { key: 'to', label: 'Sampai tanggal', type: 'date' },
            ]}
          />
        )}
        empty="Belum ada riwayat penggunaan"
        onRowClick={(r) => setDetail(r)}
      />

      <SideSheet open={!!detail} onClose={() => setDetail(null)} title={`Penggunaan #${detail?.id || ''}`}>
        {detail ? (
          <div className="pw-stack">
            <KeyValue
              items={[
                { label: 'Peristiwa', value: codeValue(aiEventLabel(detail.eventType), detail.eventType, AI_EVENT_LABELS), translate: true },
                { label: 'Waktu', value: detail.createdAt ? formatDateTime(detail.createdAt) : null },
                { label: 'Sesi', value: detail.sessionId },
                { label: 'Pesan', value: detail.messageId },
                { label: 'Entitas', value: detail.entityId },
                { label: 'Divisi', value: detail.departmentId },
                { label: 'Pengguna', value: userValue(detail) },
                { label: 'Modul', value: codeValue(aiModuleLabel(detail.module), detail.module, AI_MODULE_LABELS), translate: true },
                { label: 'Penyedia', value: codeValue(aiProviderLabel(detail.provider), detail.provider, AI_PROVIDER_LABELS), translate: true },
                { label: 'Model', value: detail.model },
                { label: 'Token masuk / keluar', value: tokens(detail) },
                { label: 'Durasi', value: `${formatNumber(detail.durationMs || 0)} ms` },
              ]}
            />

            {detail.metadata ? (
              <section className="ai-usage__meta">
                <h3 className="pw-overline">Metadata</h3>
                <pre className="ai-usage__pre" data-no-translate="">
                  {typeof detail.metadata === 'string'
                    ? detail.metadata
                    : JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </section>
            ) : null}

            <p className="pw-text-helper ai-usage__note">Isi prompt dan percakapan tidak disimpan di riwayat penggunaan.</p>
          </div>
        ) : null}
      </SideSheet>
    </Page>
  );
}
