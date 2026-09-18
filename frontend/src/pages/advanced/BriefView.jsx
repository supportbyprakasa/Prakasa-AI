import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';

export default function BriefView() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/brief').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const generate = async () => {
    setRunning(true);
    try {
      await api.post('/brief/generate', { briefType: 'daily' });
      toast('Brief dibuat', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
    finally { setRunning(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>AI Daily / Weekly Brief</h2>
        <Button onClick={generate} disabled={running}>
          {running ? 'Membuat…' : 'Generate Brief Hari Ini'}
        </Button>
      </div>

      {loading && <div>Memuat…</div>}
      {!loading && !rows.length && (
        <div style={{ color: 'var(--color-text-muted)' }}>Belum ada brief. Klik Generate untuk membuat.</div>
      )}

      {rows.map((b) => (
        <Card key={b.id} title={`${b.briefType.toUpperCase()} — ${b.briefDate}`}>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{b.content}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
            {b.provider} · {b.model} · {new Date(b.createdAt).toLocaleString('id-ID')}
          </div>
        </Card>
      ))}
    </div>
  );
}
