import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Badge from '../../components/Badge';

export default function Workspaces() {
  const [customerId, setCustomerId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!customerId) return;
    setLoading(true); setData(null);
    try {
      const r = await api.get(`/workspaces/customer/${customerId}`);
      setData(r.data.data);
    } finally { setLoading(false); }
  };

  return (
    <div>
      <h2>Customer Workspace</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <Input label="Customer ID" value={customerId} onChange={(e) => setCustomerId(e.target.value)}
          style={{ margin: 0 }} />
        <Button onClick={load} disabled={loading}>{loading ? 'Memuat…' : 'Buka Workspace'}</Button>
      </div>

      {data && (
        <>
          <Card title="Customer">
            <div style={{ fontSize: 14 }}>{data.customer.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {data.customer.contact_person} · {data.customer.phone} · {data.customer.city}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Card title={`Pipeline (${data.pipeline.length})`}>
              {data.pipeline.map((p) => (
                <div key={p.id} style={{ fontSize: 13, padding: 4 }}>
                  <b>{p.deal_title}</b> · <Badge tone="info">{p.stage}</Badge>
                </div>
              ))}
              {!data.pipeline.length && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada pipeline</div>}
            </Card>
            <Card title={`Sample Requests (${data.samples.length})`}>
              {data.samples.map((s) => (
                <div key={s.id} style={{ fontSize: 13, padding: 4 }}>
                  {s.productName} x{s.quantity} · {s.status} · WH: {s.warehouseStatus || '-'}
                </div>
              ))}
            </Card>
            <Card title={`Quotations (${data.quotations.length})`}>
              {data.quotations.map((q) => (
                <div key={q.id} style={{ fontSize: 13, padding: 4 }}>
                  {q.quotationNumber} · {q.currency} {Number(q.totalAmount).toLocaleString('id-ID')} · {q.status}
                </div>
              ))}
            </Card>
            <Card title={`Meetings (${data.meetings.length})`}>
              {data.meetings.map((m) => (
                <div key={m.id} style={{ fontSize: 13, padding: 4 }}>
                  <b>{m.title}</b> · {new Date(m.startTime).toLocaleDateString('id-ID')} · {m.status}
                </div>
              ))}
            </Card>
            <Card title={`Tasks terkait (${data.tasks.length})`}>
              {data.tasks.map((t) => (
                <div key={t.id} style={{ fontSize: 13, padding: 4 }}>
                  {t.title} · {t.status}
                </div>
              ))}
            </Card>
            <Card title={`Activity Timeline (${data.activities.length})`}>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {data.activities.slice(0, 20).map((a) => (
                  <div key={a.id} style={{ fontSize: 12, padding: 4, borderBottom: '1px solid var(--color-border)' }}>
                    <b>{a.action}</b> · {a.subjectType} #{a.subjectId} · {new Date(a.createdAt).toLocaleString('id-ID')}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
