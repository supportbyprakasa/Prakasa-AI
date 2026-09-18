import { useEffect, useState } from 'react';
import { RefreshCw, Activity, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import FilterBar from '../../components/FilterBar';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';

const PROVIDERS = [
  'google_drive','google_docs','google_sheets','google_slides',
  'google_calendar','google_meet','google_chat','gmail','google_tasks',
  'openai','gemini','claude','jurnal','kantorku','internal',
];

export default function IntegrationLogs() {
  const [tab, setTab] = useState('health');
  const [health, setHealth] = useState([]);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ provider: '', status: '', from: '', to: '' });
  const [detail, setDetail] = useState(null);

  const loadHealth = () => {
    setLoading(true);
    api.get('/integration-logs/health')
      .then((r) => setHealth(r.data.data || []))
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };

  const loadLogs = async (page = 1) => {
    setLoading(true);
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
      toast(e.response?.data?.error?.message || 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'health') loadHealth();
    else loadLogs(1);
    /* eslint-disable-next-line */
  }, [tab, filters.provider, filters.status]);

  const showDetail = async (id) => {
    try {
      const r = await api.get(`/integration-logs/${id}`);
      setDetail(r.data.data);
    } catch (e) {
      toast('Gagal memuat detail', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Integration Logs</h2>
        <Button variant="secondary" onClick={() => tab === 'health' ? loadHealth() : loadLogs(1)}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <div style={{
        display: 'flex', gap: 4, marginBottom: 12,
        borderBottom: '1px solid var(--color-border)',
      }}>
        {[
          { k: 'health', l: 'Health (24h)' },
          { k: 'logs', l: 'Detail Logs' },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === t.k ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: tab === t.k ? 'var(--color-primary)' : 'var(--color-text-muted)',
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
          }}>{t.l}</button>
        ))}
      </div>

      {tab === 'health' && (
        <>
          {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}
          {!loading && !health.length && (
            <Card>
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                Tidak ada aktivitas integrasi dalam 24 jam terakhir.
              </div>
            </Card>
          )}
          {!loading && health.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {health.map((h) => {
                const total = Number(h.success || 0) + Number(h.failed || 0) + Number(h.skipped || 0);
                const successRate = total > 0 ? Math.round((Number(h.success) / total) * 100) : 0;
                return (
                  <Card key={h.provider}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <b style={{ fontSize: 14 }}>{h.provider}</b>
                      <Badge tone={
                        h.failed > 0 ? 'warning' : (Number(h.success) > 0 ? 'success' : 'default')
                      }>
                        {successRate}% OK
                      </Badge>
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
                        {h.success || 0}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={14} style={{ color: 'var(--color-error)' }} />
                        {h.failed || 0}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertCircle size={14} style={{ color: 'var(--color-warning)' }} />
                        {h.skipped || 0}
                      </span>
                    </div>
                    {h.avgDurationMs && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                        avg {Math.round(Number(h.avgDurationMs))} ms
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      Terakhir: {h.lastCall ? new Date(h.lastCall).toLocaleString('id-ID') : '—'}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'logs' && (
        <>
          <FilterBar
            filters={[
              {
                name: 'provider', label: 'Provider', type: 'select',
                options: PROVIDERS.map((p) => ({ value: p, label: p })),
              },
              {
                name: 'status', label: 'Status', type: 'select',
                options: [
                  { value: 'success', label: 'success' },
                  { value: 'failed', label: 'failed' },
                  { value: 'skipped', label: 'skipped' },
                ],
              },
              { name: 'from', label: 'Dari', type: 'text', placeholder: 'YYYY-MM-DD' },
              { name: 'to', label: 'Sampai', type: 'text', placeholder: 'YYYY-MM-DD' },
            ]}
            values={filters}
            onChange={setFilters}
            onReset={() => setFilters({ provider: '', status: '', from: '', to: '' })}
          >
            <Button variant="secondary" onClick={() => loadLogs(1)}>Terapkan</Button>
          </FilterBar>

          <DataTable
            loading={loading}
            rows={rows}
            meta={meta}
            onPageChange={loadLogs}
            empty="Tidak ada log"
            onRowClick={(r) => showDetail(r.id)}
            columns={[
              { key: 'createdAt', title: 'Waktu',
                render: (r) => new Date(r.createdAt).toLocaleString('id-ID') },
              { key: 'provider', title: 'Provider' },
              { key: 'operation', title: 'Operation' },
              {
                key: 'status', title: 'Status',
                render: (r) => <Badge tone={
                  r.status === 'success' ? 'success'
                  : r.status === 'failed' ? 'error' : 'default'
                }>{r.status}</Badge>,
              },
              { key: 'durationMs', title: 'Durasi (ms)' },
              { key: 'errorMessage', title: 'Error',
                render: (r) => r.errorMessage ? r.errorMessage.slice(0, 40) + '…' : '—' },
            ]}
          />
        </>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)}
        title={detail ? `Log #${detail.id}` : ''}>
        {detail && (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div><b>Provider:</b> {detail.provider}</div>
            <div><b>Operation:</b> {detail.operation}</div>
            <div><b>Status:</b> <Badge tone={
              detail.status === 'success' ? 'success'
              : detail.status === 'failed' ? 'error' : 'default'
            }>{detail.status}</Badge></div>
            <div><b>Duration:</b> {detail.duration_ms || 0} ms</div>
            <div><b>Entity:</b> {detail.entity_id || '—'}</div>
            <div><b>User:</b> {detail.user_id || '—'}</div>
            <div><b>Subject:</b> {detail.subject_type || '—'} #{detail.subject_id || '—'}</div>
            {detail.error_message && (
              <div style={{ color: 'var(--color-error)' }}>
                <b>Error:</b> {detail.error_message}
              </div>
            )}
            {detail.request_meta && (
              <div style={{ marginTop: 8 }}>
                <b>Request Meta:</b>
                <pre style={{
                  background: '#f8fafc', padding: 8, borderRadius: 6,
                  fontSize: 11, overflowX: 'auto', maxHeight: 200,
                }}>{JSON.stringify(typeof detail.request_meta === 'string' ? JSON.parse(detail.request_meta) : detail.request_meta, null, 2)}</pre>
              </div>
            )}
            {detail.response_meta && (
              <div style={{ marginTop: 8 }}>
                <b>Response Meta:</b>
                <pre style={{
                  background: '#f8fafc', padding: 8, borderRadius: 6,
                  fontSize: 11, overflowX: 'auto', maxHeight: 200,
                }}>{JSON.stringify(typeof detail.response_meta === 'string' ? JSON.parse(detail.response_meta) : detail.response_meta, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
