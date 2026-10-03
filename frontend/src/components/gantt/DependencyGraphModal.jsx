import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Badge from '../Badge';
import Banner from '../Banner';
import Button from '../Button';
import EmptyState, { LoadingState } from '../EmptyState';
import Icon from '../Icon';
import Modal from '../Modal';
import StatusBadge from '../StatusBadge';
import './gantt.css';

/**
 * Minimal graph viewer — nodes listed by level (how many dependency steps away
 * from the task). Full visual graph rendering is intentionally not implemented
 * here (would require a layout engine). The backend graph endpoint is
 * available for future visualization work.
 */
export default function DependencyGraphModal({ taskId, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(() => {
    setState({ loading: true, error: '', data: null });
    api.get(`/tasks/${taskId}/dependencies/graph`)
      .then((r) => setState({ loading: false, error: '', data: r.data.data }))
      .catch((e) => setState({ loading: false, error: e.response?.data?.error?.message || 'Periksa koneksi, lalu coba lagi.', data: null }));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const grouped = (data?.nodes || []).reduce((acc, n) => {
    const d = n.depth;
    if (!acc[d]) acc[d] = [];
    acc[d].push(n);
    return acc;
  }, {});

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Graf dependensi"
      size="md"
      footer={<Button variant="text" type="button" onClick={onClose}>Tutup</Button>}
    >
      {loading ? <LoadingState compact label="Memuat graf dependensi…" /> : null}

      {!loading && error ? (
        <EmptyState
          tone="error"
          compact
          title="Graf dependensi gagal dimuat"
          description={error}
          action={<Button variant="secondary" type="button" onClick={load}>Coba lagi</Button>}
        />
      ) : null}

      {!loading && !error && !data?.nodes?.length ? <EmptyState compact icon="lan" title="Belum ada dependensi" /> : null}

      {!loading && !error && data?.nodes?.length ? (
        <div className="pw-stack">
          <div className="gantt-graph__stats">
            <Icon name="lan" size="sm" />
            <span>{`${data.meta?.nodeCount || 0} tugas · ${data.meta?.edgeCount || 0} hubungan · paling jauh ${data.meta?.depth || 3} tingkat`}</span>
          </div>
          {data.meta?.truncated ? <Banner tone="warning">Grafik terpotong — hanya sebagian dependensi yang ditampilkan.</Banner> : null}

          {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map((depth) => (
            <section key={depth} className="gantt-graph__level" aria-label={`Tingkat ${depth}`}>
              <span className="pw-overline">{`Tingkat ${depth}`}</span>
              <ul className="gantt-graph__nodes">
                {grouped[depth].map((n) => (
                  <li key={n.id} className={`gantt-graph__node${n.isRoot ? ' gantt-graph__node--root' : ''}`}>
                    <Link to={`/tasks/${n.id}`} className="pw-link gantt-graph__node-link" data-no-translate="">{n.title}</Link>
                    <span className="gantt-graph__node-badges">
                      {n.isRoot ? <Badge>Tugas ini</Badge> : null}
                      {n.viaType ? <StatusBadge status={n.viaType} /> : null}
                      <StatusBadge status={n.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
