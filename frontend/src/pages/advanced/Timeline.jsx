import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';

export default function Timeline() {
  const [from, setFrom] = useState(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get('/timeline', { params: { from, to } })
      .then((r) => setData(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div>
      <h2>Timeline</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
        <Input label="Dari" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ margin: 0 }} />
        <Input label="Sampai" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ margin: 0 }} />
        <button
          onClick={load}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Terapkan
        </button>
      </div>

      {loading && <SkeletonCard lines={6} />}
      {data && (
        <Card title={`${data.items?.length || 0} item dari ${data.from} ke ${data.to}`}>
          <div style={{ display: 'grid', gap: 6 }}>
            {data.items
              ?.sort((a, b) => new Date(a.date) - new Date(b.date))
              .map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '100px 100px 1fr auto',
                    gap: 12,
                    padding: 8,
                    alignItems: 'center',
                    borderBottom: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.date?.slice(0, 10)}</div>
                  <Badge
                    tone={
                      item.type === 'task'
                        ? 'info'
                        : item.type === 'meeting'
                        ? 'warning'
                        : item.type === 'approval'
                        ? 'warning'
                        : item.type === 'finance'
                        ? 'success'
                        : item.type === 'hrga'
                        ? 'info'
                        : 'default'
                    }
                  >
                    {item.type}
                  </Badge>
                  <div>{item.label}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.status}</div>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

