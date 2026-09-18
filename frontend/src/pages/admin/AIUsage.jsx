import { useEffect, useState } from 'react';
import { RefreshCw, Info } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import FilterBar from '../../components/FilterBar';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

export default function AIUsage() {
  const { user } = useAuth();
  const isAdmin = (user?.permissions || []).includes('ai_command.admin.view');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    entityId: '', departmentId: '',
    module: '', provider: '', from: '', to: '',
  });
  const [detail, setDetail] = useState(null);

  const load = async (page = 1) => {
    setLoading(true);
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
      toast(e.response?.data?.error?.message || 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{isAdmin ? 'AI Usage' : 'AI Usage Saya'}</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {isAdmin
              ? 'Riwayat penggunaan AI. Gunakan filter Entity ID untuk scope admin yang lebih luas.'
              : 'Riwayat penggunaan AI Anda.'}
          </div>
        </div>
        <Button variant="secondary" onClick={() => load(1)}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <FilterBar
        filters={[
          ...(isAdmin
            ? [
                { name: 'entityId', label: 'Entity ID', type: 'text', placeholder: 'opsional' },
                { name: 'departmentId', label: 'Department ID', type: 'text', placeholder: 'opsional' },
              ]
            : []),
          { name: 'module', label: 'Module', type: 'text', placeholder: 'ai_command_center' },
          { name: 'provider', label: 'Provider', type: 'text', placeholder: 'openai / n8n' },
          { name: 'from', label: 'Dari', type: 'text', placeholder: 'YYYY-MM-DD' },
          { name: 'to', label: 'Sampai', type: 'text', placeholder: 'YYYY-MM-DD' },
        ]}
        values={filters}
        onChange={setFilters}
        onReset={() =>
          setFilters({
            entityId: '',
            departmentId: '',
            module: '',
            provider: '',
            from: '',
            to: '',
          })
        }
      >
        <Button variant="secondary" onClick={() => load(1)}>Terapkan</Button>
      </FilterBar>

      <DataTable
        loading={loading}
        rows={rows}
        meta={meta}
        onPageChange={load}
        empty="Belum ada riwayat penggunaan"
        onRowClick={(r) => setDetail(r)}
        columns={[
          {
            key: 'createdAt', title: 'Waktu',
            render: (r) => new Date(r.createdAt).toLocaleString('id-ID'),
          },
          { key: 'userId', title: 'User' },
          {
            key: 'eventType', title: 'Event',
            render: (r) => <Badge tone="info">{r.eventType}</Badge>,
          },
          { key: 'module', title: 'Module' },
          { key: 'provider', title: 'Provider' },
          { key: 'model', title: 'Model' },
          {
            key: 'tokens', title: 'Tokens',
            render: (r) => `${r.tokensIn || 0} / ${r.tokensOut || 0}`,
          },
          {
            key: 'durationMs', title: 'Durasi',
            render: (r) => r.durationMs != null ? `${r.durationMs} ms` : '—',
          },
        ]}
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`Usage #${detail?.id || ''}`}
      >
        {detail && (
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div><b>Event:</b> {detail.eventType}</div>
            <div><b>Session:</b> {detail.sessionId ?? '—'}</div>
            <div><b>Message:</b> {detail.messageId ?? '—'}</div>
            <div><b>Entity:</b> {detail.entityId}</div>
            <div><b>Department:</b> {detail.departmentId ?? '—'}</div>
            <div><b>User:</b> {detail.userId ?? '—'}</div>
            <div><b>Module:</b> {detail.module || '—'}</div>
            <div><b>Provider:</b> {detail.provider || '—'}</div>
            <div><b>Model:</b> {detail.model || '—'}</div>
            <div><b>Tokens in/out:</b> {detail.tokensIn || 0} / {detail.tokensOut || 0}</div>
            <div><b>Duration:</b> {detail.durationMs || 0} ms</div>
            <div><b>Waktu:</b> {new Date(detail.createdAt).toLocaleString('id-ID')}</div>

            {detail.metadata && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Info size={12} />
                  <b>Metadata</b>
                </div>
                <pre style={{
                  background: '#f8fafc', padding: 10, borderRadius: 8,
                  fontSize: 11, overflowX: 'auto', maxHeight: 200,
                  border: '1px solid var(--color-border)',
                }}>
                  {typeof detail.metadata === 'string'
                    ? detail.metadata
                    : JSON.stringify(detail.metadata, null, 2)}
                </pre>
              </div>
            )}

            <div style={{
              marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)',
            }}>
              Isi prompt/percakapan tidak disimpan pada endpoint usage.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}