import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';

export default function CrossDivisionWorkspace() {
  const [type, setType] = useState('customer');
  const [id, setId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setData(null);
    try {
      const r = await api.get(`/workspaces/cross-division/${type}/${id}`);
      setData(r.data.data);
    } catch (e) {
      setData({ error: e.response?.data?.error?.message || e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Cross-Division Workspace</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12 }}>Context Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ padding: 8, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
          >
            {['customer', 'project', 'vendor', 'employee', 'asset'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <Input label="Context ID" value={id} onChange={(e) => setId(e.target.value)} style={{ margin: 0 }} />
        <Button onClick={load}>Buka</Button>
      </div>

      {loading && <SkeletonCard lines={8} />}
      {data?.error && <div style={{ color: 'var(--color-error)' }}>{data.error}</div>}

      {data && !data.error && (
        <>
          <Card title="Context">
            <div style={{ fontSize: 13 }}>
              <b>{data.context?.context_type}</b> · #{data.context?.context_id} · {data.context?.label}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Card title={`Related Records (${data.related?.length || 0})`}>
              {data.related?.map((r) => (
                <div key={r.id} style={{ fontSize: 13, padding: 6, boxShadow: 'inset 0 -1px 0 0 var(--color-border)' }}>
                  {r.relatedType} #{r.relatedId} · <Badge>{r.relation}</Badge>
                </div>
              ))}
              {!data.related?.length && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>—</div>}
            </Card>

            <Card title={`Cross Links (${data.links?.length || 0})`}>
              {data.links?.map((l) => (
                <div key={l.id} style={{ fontSize: 13, padding: 6, boxShadow: 'inset 0 -1px 0 0 var(--color-border)' }}>
                  {l.fromType} #{l.fromId} → {l.toType} #{l.toId} · <Badge>{l.relation}</Badge>
                </div>
              ))}
              {!data.links?.length && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>—</div>}
            </Card>

            <Card title="Activity">
              {data.activities?.map((a) => (
                <div key={a.id} style={{ fontSize: 13, padding: 6, boxShadow: 'inset 0 -1px 0 0 var(--color-border)' }}>
                  <b>{a.action}</b>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {new Date(a.createdAt).toLocaleString('id-ID')}
                  </div>
                </div>
              ))}
              {!data.activities?.length && <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>—</div>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

