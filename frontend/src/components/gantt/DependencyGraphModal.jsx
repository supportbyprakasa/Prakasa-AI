import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, X } from 'lucide-react';
import api from '../../api/client';
import Modal from '../Modal';
import Button from '../Button';
import Badge from '../Badge';
import { toast } from '../Toast';

/**
 * Minimal graph viewer — nodes listed by depth level.
 * Full visual graph rendering is intentionally not implemented here
 * (would require a layout engine). The backend graph endpoint is
 * available for future visualization work.
 */
export default function DependencyGraphModal({ taskId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/tasks/${taskId}/dependencies/graph`)
      .then((r) => setData(r.data.data))
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat graph', 'error'))
      .finally(() => setLoading(false));
  }, [taskId]);

  const grouped = (data?.nodes || []).reduce((acc, n) => {
    const d = n.depth;
    if (!acc[d]) acc[d] = [];
    acc[d].push(n);
    return acc;
  }, {});

  return (
    <Modal open={true} onClose={onClose} title="Dependency Graph" width={640}>
      {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}

      {!loading && !data && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tidak ada data.</div>
      )}

      {!loading && data && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <span><Network size={12} /> {data.meta?.nodeCount || 0} node</span>
            <span>{data.meta?.edgeCount || 0} edge</span>
            <span>depth ≤ {data.meta?.depth || 3}</span>
            {data.meta?.truncated && <Badge tone="warning">truncated</Badge>}
          </div>

          {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map((depth) => (
            <div key={depth} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Depth {depth}
              </div>
              {grouped[depth].map((n) => (
                <div key={n.id} style={{
                  padding: 8, marginBottom: 4,
                  background: n.isRoot ? 'rgba(31,78,216,.08)' : '#f8fafc',
                  border: `1px solid ${n.isRoot ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 6, fontSize: 13,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <Link to={`/tasks/${n.id}`} style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}>
                    {n.isRoot && '★ '}{n.title}
                  </Link>
                  <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                    {n.viaType && <Badge tone={n.viaType === 'blocks' ? 'warning' : 'default'}>{n.viaType}</Badge>}
                    <Badge tone="default">{n.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button variant="secondary" onClick={onClose}>Tutup</Button>
          </div>
        </>
      )}
    </Modal>
  );
}