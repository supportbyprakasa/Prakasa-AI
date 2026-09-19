import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Save, Trash2, CheckCircle2, RotateCcw,
} from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import TaskProgress from '../../components/tasks/TaskProgress';
import TaskChecklist from '../../components/tasks/TaskChecklist';
import TaskWatchers from '../../components/tasks/TaskWatchers';
import TaskDependencies from '../../components/tasks/TaskDependencies';
import TaskActivityTimeline from '../../components/tasks/TaskActivityTimeline';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const DONE_STATUSES = new Set(['done', 'closed', 'completed']);
const FINAL_STATUSES = new Set(['done', 'closed', 'completed', 'cancelled']);

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isOverdue(task) {
  if (!task.dueDate || FINAL_STATUSES.has(task.status)) return false;
  return String(task.dueDate).slice(0, 10) < localDateKey();
}

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const canUpdate = (user?.permissions || []).includes('task.update');
  const canDelete = (user?.permissions || []).includes('task.delete');
  const canWatch = (user?.permissions || []).includes('task.watch');
  const canWatchManage = (user?.permissions || []).includes('task.watch.manage');
  const canChecklist = (user?.permissions || []).includes('task.checklist.manage');
  const canDependency = (user?.permissions || []).includes('task.dependency.manage');
  const canActivity = (user?.permissions || []).includes('task.activity.view');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${id}`);
      setTask(r.data.data);
      setForm(initialFormFromTask(r.data.data));
      setDirty({});
    } catch (e) {
      const s = e.response?.status;
      if (s === 403) {
        toast('Anda tidak memiliki akses untuk tindakan ini.', 'error');
        nav('/tasks');
      } else if (s === 404) {
        toast('Task tidak ditemukan.', 'error');
        nav('/tasks');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal memuat task', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const save = async () => {
    if (!task) return;
    if (!form.title.trim()) {
      toast('Judul task wajib', 'error');
      return;
    }
    if (form.progressPercent !== '') {
      const progress = Number(form.progressPercent);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        toast('Progress harus berupa integer 0–100', 'error');
        return;
      }
    }
    const payload = {};
    for (const key of Object.keys(dirty)) {
      if (!dirty[key]) continue;
      const v = form[key];
      // Null semantics for nullable fields
      if (['assigneeId', 'dueDate', 'startDate', 'description'].includes(key)) {
        payload[key] = (v === '' || v === null || v === undefined) ? null : v;
        if (key === 'assigneeId' && payload[key] !== null) payload[key] = Number(payload[key]);
        if (key === 'progressPercent' && payload[key] !== null) payload[key] = Number(payload[key]);
      } else if (key === 'progressPercent') {
        payload[key] = v === '' ? 0 : Number(v);
      } else {
        payload[key] = v;
      }
    }
    if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
      toast('Tanggal mulai harus <= tanggal jatuh tempo', 'error');
      return;
    }
    if (!Object.keys(payload).length) {
      toast('Tidak ada perubahan', 'info');
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/tasks/${id}`, payload);
      toast('Task diperbarui', 'success');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (code === 'WIP_LIMIT_EXCEEDED') toast('Kolom sudah mencapai WIP limit.', 'error');
      else toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    try {
      await api.patch(`/tasks/${id}`, { status: 'done' });
      toast('Task selesai', 'success');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const reopen = async () => {
    try {
      await api.patch(`/tasks/${id}`, { status: 'open' });
      toast('Task dibuka kembali', 'success');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/tasks/${id}`);
      toast('Task dihapus', 'success');
      nav('/tasks');
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus', 'error');
    }
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setCommentSubmitting(true);
    try {
      await api.post(`/tasks/${id}/comments`, { body: comment.trim() });
      setComment('');
      await load();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal mengirim komentar', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Button variant="secondary" onClick={() => nav('/tasks')}>
          <ArrowLeft size={14} /> Task Board
        </Button>
        <div style={{ marginTop: 16 }}><SkeletonCard lines={10} /></div>
      </div>
    );
  }
  if (!task || !form) return null;

  const done = DONE_STATUSES.has(task.status);
  const overdue = isOverdue(task);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="secondary" onClick={() => nav('/tasks')}>
          <ArrowLeft size={14} /> Task Board
        </Button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canUpdate && !done && (
            <Button onClick={complete}>
              <CheckCircle2 size={14} /> Tandai Selesai
            </Button>
          )}
          {canUpdate && done && (
            <Button variant="secondary" onClick={reopen}>
              <RotateCcw size={14} /> Buka Kembali
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={14} /> Hapus Task
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Task #{task.id}</h2>
        <Badge tone={done ? 'success' : 'info'}>{task.status}</Badge>
        {overdue && <Badge tone="error">overdue</Badge>}
      </div>

      {/* Two column layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: 12, marginTop: 16,
      }}
        className="task-detail-grid"
      >
        {/* MAIN COLUMN */}
        <div style={{ minWidth: 0 }}>
          <Card title="Detail" actions={
            canUpdate && Object.keys(dirty).length > 0 ? (
              <Button onClick={save} disabled={saving}>
                <Save size={14} /> {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            ) : null
          }>
            <Input
              label="Judul"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              disabled={!canUpdate}
            />

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Deskripsi</label>
              <textarea
                value={form.description || ''}
                onChange={(e) => setField('description', e.target.value)}
                rows={4}
                disabled={!canUpdate}
                style={{
                  width: '100%', padding: 10, borderRadius: 8,
                  border: '1px solid var(--color-border)', fontSize: 13,
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value)}
                  disabled={!canUpdate}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
                >
                  {['open', 'in_progress', 'review', 'done', 'closed', 'completed', 'cancelled'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setField('priority', e.target.value)}
                  disabled={!canUpdate}
                  style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
                >
                  {['low', 'normal', 'high', 'urgent'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Input
                label="Progress (%)"
                type="number"
                min={0}
                max={100}
                value={form.progressPercent}
                onChange={(e) => setField('progressPercent', e.target.value)}
                disabled={!canUpdate || done}
              />
            </div>

            <div style={{ marginTop: 6 }}>
              <TaskProgress percent={form.progressPercent || 0} />
            </div>
          </Card>

          <div style={{ marginTop: 12 }}>
            <TaskChecklist
              taskId={task.id}
              canManage={canChecklist}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <Card title={`Komentar (${task.comments?.length || 0})`}>
              {task.comments?.map((c) => (
                <div key={c.id} style={{
                  padding: 8, borderBottom: '1px solid var(--color-border)', fontSize: 13,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {c.userName} · {new Date(c.createdAt).toLocaleString('id-ID')}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.body}</div>
                </div>
              ))}
              {!task.comments?.length && (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Belum ada komentar.
                </div>
              )}
              <form onSubmit={submitComment} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Tulis komentar…"
                  disabled={!canUpdate}
                  style={{
                    width: '100%', padding: 10, borderRadius: 8,
                    border: '1px solid var(--color-border)', fontSize: 13,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button type="submit" disabled={!comment.trim() || commentSubmitting || !canUpdate}>
                    {commentSubmitting ? 'Mengirim…' : 'Kirim'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {canActivity && (
            <div style={{ marginTop: 12 }}>
              <TaskActivityTimeline taskId={task.id} refreshKey={refreshKey} />
            </div>
          )}
        </div>

        {/* SIDE COLUMN */}
        <div style={{ minWidth: 0 }}>
          <Card title="Info">
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Reporter:</span>{' '}
                <b>{task.reporterName || `#${task.reporterId}`}</b>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Assignee:</span>{' '}
                <b>{task.assigneeName || 'Unassigned'}</b>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Board:</span>{' '}
                {task.boardId ? <Link to="/tasks">#{task.boardId}</Link> : '—'}
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Column:</span>{' '}
                #{task.columnId || '—'}
              </div>
            </div>

            {canUpdate && (
              <div style={{ marginTop: 8 }}>
                <Input
                  label="Assignee ID"
                  type="number"
                  value={form.assigneeId || ''}
                  onChange={(e) => setField('assigneeId', e.target.value)}
                />
              </div>
            )}
          </Card>

          <div style={{ marginTop: 12 }}>
            <Card title="Tanggal">
              {canUpdate ? (
                <>
                  <Input
                    label="Start Date"
                    type="date"
                    value={form.startDate || ''}
                    onChange={(e) => setField('startDate', e.target.value)}
                  />
                  <Input
                    label="Due Date"
                    type="date"
                    value={form.dueDate || ''}
                    onChange={(e) => setField('dueDate', e.target.value)}
                  />
                </>
              ) : (
                <div style={{ fontSize: 13 }}>
                  <div>Start: {task.startDate || '—'}</div>
                  <div>Due: {task.dueDate || '—'}</div>
                </div>
              )}
            </Card>
          </div>

          {done && (
            <div style={{ marginTop: 12 }}>
              <Card title="Penyelesaian">
                <div style={{ fontSize: 13 }}>
                  Selesai oleh <b>{task.completedByName || (task.completedBy ? `#${task.completedBy}` : 'Sistem')}</b>
                  {task.completedAt && (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {new Date(task.completedAt).toLocaleString('id-ID')}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <TaskWatchers
              task={task}
              canWatch={canWatch}
              canManage={canWatchManage}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <TaskDependencies
              task={task}
              canManage={canDependency}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <Card title="Sumber">
              <div style={{ fontSize: 13 }}>
                <Badge tone={
                  task.sourceType === 'ai_action' ? 'info'
                  : task.sourceType === 'chat' ? 'warning'
                  : 'default'
                }>
                  {task.sourceType === 'ai_action' ? 'AI Action'
                    : task.sourceType === 'chat' ? 'Chat'
                    : 'Manual'}
                </Badge>
                {task.sourceId != null && (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 8 }}>
                    #{task.sourceId}
                  </span>
                )}
              </div>
            </Card>
          </div>

          {task.attachments?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Card title={`Lampiran (${task.attachments.length})`}>
                {task.attachments.map((a) => (
                  <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                    {a.webViewLink ? (
                      <a href={a.webViewLink} target="_blank" rel="noreferrer">{a.name}</a>
                    ) : (
                      <span>{a.name}</span>
                    )}
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .task-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus task ini?"
        message="Task akan di-soft-delete. Tidak akan tampil lagi di board."
        confirmLabel="Ya, hapus"
        tone="danger"
        onConfirm={doDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function initialFormFromTask(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'open',
    priority: task.priority || 'normal',
    assigneeId: task.assigneeId || '',
    startDate: task.startDate || '',
    dueDate: task.dueDate || '',
    progressPercent: task.progressPercent ?? 0,
  };
}