import { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Check } from 'lucide-react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import Input from '../Input';
import { toast } from '../Toast';
import TaskProgress from './TaskProgress';

/**
 * Checklist card for TaskDetail.
 * Props: taskId, canManage, onChanged (optional callback after mutation)
 */
export default function TaskChecklist({ taskId, canManage, onChanged }) {
  const [data, setData] = useState({ items: [], done: 0, total: 0, percent: 0 });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${taskId}/checklist`);
      setData(r.data.data || { items: [], done: 0, total: 0, percent: 0 });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat checklist', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [taskId]);

  const afterMutate = (fresh) => {
    if (fresh) setData(fresh);
    else load();
    onChanged?.();
  };

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      await api.post(`/tasks/${taskId}/checklist`, { title });
      setNewTitle('');
      setAdding(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menambahkan', 'error');
    }
  };

  const toggle = async (item) => {
    setBusyId(item.id);
    try {
      await api.patch(`/tasks/${taskId}/checklist/${item.id}`, {
        isDone: !item.isDone,
      });
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal mengubah', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item) => {
    if (!confirm(`Hapus "${item.title}"?`)) return;
    try {
      await api.delete(`/tasks/${taskId}/checklist/${item.id}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus', 'error');
    }
  };

  const move = async (idx, dir) => {
    const items = [...data.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    // Optimistic
    setData({ ...data, items });
    try {
      await api.post(`/tasks/${taskId}/checklist/reorder`, {
        orderedIds: items.map((x) => x.id),
      });
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal mengurutkan', 'error');
      load();
    }
  };

  return (
    <Card
      title={`Checklist ${data.total ? `${data.done}/${data.total} · ${data.percent}%` : ''}`}
      actions={
        canManage ? (
          <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
            <Plus size={14} /> Item
          </Button>
        ) : null
      }
    >
      {data.total > 0 && (
        <div style={{ marginBottom: 10 }}>
          <TaskProgress percent={data.percent} showLabel={false} />
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}

      {!loading && !data.items.length && !adding && (
        <div style={{
          fontSize: 13, color: 'var(--color-text-muted)',
          padding: 12, textAlign: 'center',
          boxShadow: 'inset 0 0 0 1px var(--color-border)', borderRadius: 8,
        }}>
          Belum ada checklist.
        </div>
      )}

      {data.items.map((item, idx) => (
        <div key={item.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 0', boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
          fontSize: 13,
        }}>
          <input
            type="checkbox"
            checked={!!item.isDone}
            disabled={busyId === item.id || !canManage}
            onChange={() => toggle(item)}
            style={{ cursor: canManage ? 'pointer' : 'default' }}
          />
          <span style={{
            flex: 1,
            textDecoration: item.isDone ? 'line-through' : 'none',
            color: item.isDone ? 'var(--color-text-muted)' : 'var(--color-text)',
          }}>
            {item.title}
          </span>
          {canManage && (
            <div style={{ display: 'flex', gap: 2 }}>
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                style={iconBtnStyle}>
                <ChevronUp size={12} />
              </button>
              <button type="button" onClick={() => move(idx, 1)}
                disabled={idx === data.items.length - 1}
                style={iconBtnStyle}>
                <ChevronDown size={12} />
              </button>
              <button type="button" onClick={() => remove(item)} style={{ ...iconBtnStyle, color: 'var(--color-error)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Judul item"
            maxLength={500}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            style={{ flex: 1, margin: 0 }}
          />
          <Button onClick={add}><Check size={14} /> Tambah</Button>
        </div>
      )}
    </Card>
  );
}

const iconBtnStyle = {
  width: 22, height: 22, padding: 0,
  background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--color-border)',
  borderRadius: 4, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};