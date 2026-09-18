import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';

export default function NotificationCenter() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/notifications', { params: { limit: 50 } })
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const markAll = async () => {
    await api.patch('/notifications/read-all');
    toast('Semua ditandai dibaca', 'success');
    load();
  };

  const markOne = async (id) => {
    await api.patch(`/notifications/${id}/read`);
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Notification Center</h2>
        <Button variant="secondary" onClick={markAll}>Tandai semua dibaca</Button>
      </div>
      {loading && <div style={{ color: 'var(--color-text-muted)' }}>Memuat…</div>}
      {!loading && !rows.length && <div style={{ color: 'var(--color-text-muted)' }}>Belum ada notifikasi.</div>}
      <div>
        {rows.map((n) => (
          <div key={n.id} style={{
            background: n.isRead ? 'var(--color-surface)' : '#eff6ff',
            border: '1px solid var(--color-border)', borderRadius: 8,
            padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{n.body}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
            {!n.isRead && <button onClick={() => markOne(n.id)} style={{
              alignSelf: 'flex-start', background: 'transparent', border: 'none',
              color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12,
            }}>Tandai dibaca</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
