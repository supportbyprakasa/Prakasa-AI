import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${id}`);
      setTask(r.data.data);
    } catch {
      toast('Task tidak ditemukan', 'error');
      nav('/tasks');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const save = async () => {
    try {
      await api.patch(`/tasks/${id}`, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        dueDate: task.due_date || null,
        assigneeId: task.assignee_id || null,
      });
      toast('Tersimpan', 'success');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      await api.post(`/tasks/${id}/comments`, { body: comment });
      setComment('');
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menambah komentar', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={6} />;
  if (!task) return null;

  return (
    <div>
      <Button variant="secondary" onClick={() => nav(-1)}>← Kembali</Button>
      <h2 style={{ marginTop: 12 }}>Task #{task.id}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <Card title="Detail">
            <Input
              label="Judul"
              value={task.title || ''}
              onChange={(e) => setTask({ ...task, title: e.target.value })}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Deskripsi</label>
              <textarea
                value={task.description || ''}
                rows={5}
                onChange={(e) => setTask({ ...task, description: e.target.value })}
                style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Priority</label>
                <select
                  value={task.priority || 'normal'}
                  onChange={(e) => setTask({ ...task, priority: e.target.value })}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
                >
                  {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Status</label>
                <Input
                  value={task.status || ''}
                  onChange={(e) => setTask({ ...task, status: e.target.value })}
                  style={{ margin: 0 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Due Date</label>
                <Input
                  type="date"
                  value={task.due_date || ''}
                  onChange={(e) => setTask({ ...task, due_date: e.target.value })}
                  style={{ margin: 0 }}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={save}>Simpan Perubahan</Button>
            </div>
          </Card>

          <div style={{ marginTop: 12 }}>
            <Card title={`Komentar (${task.comments?.length || 0})`}>
              {task.comments?.map((c) => (
                <div key={c.id} style={{ padding: 8, borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {c.userName} · {new Date(c.createdAt).toLocaleString('id-ID')}
                  </div>
                  <div>{c.body}</div>
                </div>
              ))}
              <form onSubmit={addComment} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tulis komentar…"
                  style={{ flex: 1, margin: 0 }}
                />
                <Button type="submit">Kirim</Button>
              </form>
            </Card>
          </div>
        </div>

        <Card title="Info">
          <div style={{ fontSize: 13, marginBottom: 6 }}>Assignee: <b>{task.assigneeName || '—'}</b></div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Reporter: <b>{task.reporter_id}</b></div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Dibuat: {task.created_at ? new Date(task.created_at).toLocaleString('id-ID') : '—'}
          </div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Priority: <Badge tone={task.priority === 'urgent' ? 'error' : 'info'}>{task.priority}</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

