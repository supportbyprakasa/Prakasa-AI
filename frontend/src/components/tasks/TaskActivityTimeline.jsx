import { useEffect, useState } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import { toast } from '../Toast';

const EVENT_LABEL = {
  'task.created': 'Task dibuat',
  'task.updated': 'Task diperbarui',
  'task.moved': 'Task dipindahkan',
  'task.assigned': 'Assignee ditambahkan',
  'task.reassigned': 'Assignee diganti',
  'task.unassigned': 'Assignee dilepas',
  'task.status_changed': 'Status berubah',
  'task.completed': 'Task selesai',
  'task.reopened': 'Task dibuka kembali',
  'task.comment_added': 'Komentar ditambahkan',
  'task.checklist_added': 'Checklist ditambahkan',
  'task.checklist_completed': 'Checklist selesai',
  'task.checklist_reopened': 'Checklist dibuka kembali',
  'task.checklist_deleted': 'Checklist dihapus',
  'task.watcher_added': 'Watcher ditambahkan',
  'task.watcher_removed': 'Watcher dihapus',
  'task.dependency_added': 'Dependency ditambahkan',
  'task.dependency_removed': 'Dependency dihapus',
};

function labelFor(event) {
  return EVENT_LABEL[event] || event;
}

export default function TaskActivityTimeline({ taskId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const r = await api.get(`/tasks/${taskId}/activity`, {
        params: { page, limit: 50 },
      });
      const nextRows = r.data.data || [];
      setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
      setMeta(r.data.meta || { page, limit: 50, total: nextRows.length });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat aktivitas', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(1, false); /* eslint-disable-next-line */ }, [taskId, refreshKey]);

  const hasMore = rows.length < (meta.total || 0);

  return (
    <Card title={`Aktivitas (${meta.total || rows.length})`}>
      {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}

      {!loading && !rows.length && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Belum ada aktivitas.
        </div>
      )}

      {rows.map((a) => (
        <div key={a.id} style={{
          display: 'flex', gap: 8, padding: '8px 0',
          boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 13,
        }}>
          <Clock size={13} style={{ marginTop: 3, color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{labelFor(a.event)}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {a.actorName || 'Sistem'} · {new Date(a.createdAt).toLocaleString('id-ID')}
            </div>
            <MetadataPreview metadata={a.metadata} />
          </div>
        </div>
      ))}

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <Button variant="secondary" onClick={() => load((meta.page || 1) + 1, true)}
            disabled={loadingMore}>
            <ChevronDown size={14} /> {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function MetadataPreview({ metadata }) {
  if (!metadata || typeof metadata !== 'object') return null;
  const entries = Object.entries(metadata)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4);
  if (!entries.length) return null;

  return (
    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{ marginRight: 8 }}>
          {k}: <b>{typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 40)}</b>
        </span>
      ))}
    </div>
  );
}