import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, ArrowLeft, Layers } from 'lucide-react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import TaskProgress from '../../components/tasks/TaskProgress';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const PRIORITY_TONE = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'error',
};
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

function isDueToday(task) {
  if (!task.dueDate || FINAL_STATUSES.has(task.status)) return false;
  return String(task.dueDate).slice(0, 10) === localDateKey();
}

export default function TaskBoard() {
  const { user } = useAuth();
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [createBoardOpen, setCreateBoardOpen] = useState(false);

  const canManageBoard = (user?.permissions || []).includes('board.manage');
  const canCreateTask = (user?.permissions || []).includes('task.create');

  const loadBoards = async () => {
    setBoardsLoading(true);
    try {
      const r = await api.get('/boards');
      setBoards(r.data.data || []);
    } catch (e) {
      const code = e.response?.data?.error?.code;
      toast(
        code === 'FORBIDDEN'
          ? 'Anda tidak memiliki akses untuk tindakan ini.'
          : (e.response?.data?.error?.message || 'Gagal memuat board'),
        'error'
      );
    } finally {
      setBoardsLoading(false);
    }
  };

  useEffect(() => { loadBoards(); }, []);

  if (selectedBoardId) {
    return (
      <BoardWorkspace
        boardId={selectedBoardId}
        onBack={() => setSelectedBoardId(null)}
        canCreateTask={canCreateTask}
        canManageBoard={canManageBoard}
        onBoardDeleted={() => { setSelectedBoardId(null); loadBoards(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Task Board</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={loadBoards}>
            <RefreshCw size={14} />
          </Button>
          {canManageBoard && (
            <Button onClick={() => setCreateBoardOpen(true)}>
              <Plus size={14} /> Board
            </Button>
          )}
        </div>
      </div>

      {boardsLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {!boardsLoading && !boards.length && (
        <Card>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            <Layers size={28} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>Belum ada board.</div>
          </div>
        </Card>
      )}

      {!boardsLoading && boards.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBoardId(b.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', font: 'inherit',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12, padding: 16, color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <b style={{ fontSize: 15 }}>{b.name}</b>
                {b.isArchived && <Badge tone="default">arsip</Badge>}
              </div>
              {b.description && (
                <div style={{
                  fontSize: 12, color: 'var(--color-text-muted)',
                  marginTop: 6, lineHeight: 1.5,
                }}>
                  {String(b.description).slice(0, 120)}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
                Entity {b.entityId}
                {b.departmentId ? ` · Dept ${b.departmentId}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateBoardModal
        open={createBoardOpen}
        onClose={() => setCreateBoardOpen(false)}
        onCreated={(id) => {
          setCreateBoardOpen(false);
          loadBoards();
          setSelectedBoardId(id);
        }}
      />
    </div>
  );
}

/* ============================================================
   Create board modal
   ============================================================ */

function CreateBoardModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    departmentId: '',
  });
  const [columns, setColumns] = useState([
    { name: 'Backlog', position: 0, wipLimit: '' },
    { name: 'In Progress', position: 1, wipLimit: '' },
    { name: 'Done', position: 2, wipLimit: '' },
  ]);
  const [saving, setSaving] = useState(false);

  const setCol = (idx, key, value) => {
    const copy = [...columns];
    copy[idx] = { ...copy[idx], [key]: value };
    setColumns(copy);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast('Nama board wajib', 'error'); return; }
    if (!columns.length) { toast('Minimal 1 kolom', 'error'); return; }
    for (const c of columns) {
      if (!c.name.trim()) { toast('Nama kolom wajib', 'error'); return; }
      if (c.wipLimit !== '' && (!Number.isInteger(Number(c.wipLimit)) || Number(c.wipLimit) <= 0)) {
        toast('WIP limit harus berupa angka positif atau dikosongkan', 'error');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      // entityId intentionally omitted — backend derives from user
    };
    if (form.departmentId) payload.departmentId = Number(form.departmentId);
    payload.columns = columns.map((c, i) => ({
      name: c.name.trim(),
      position: i,
      wipLimit: c.wipLimit === '' ? null : Number(c.wipLimit),
    }));

    setSaving(true);
    try {
      const r = await api.post('/boards', payload);
      toast('Board dibuat', 'success');
      onCreated?.(r.data.data.id);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal membuat board', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Board Baru" maxWidth={560}>
      <Input
        label="Nama Board *"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Input
        label="Deskripsi"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <Input
        label="Department ID (opsional)"
        type="number"
        value={form.departmentId}
        onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
      />

      <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ fontSize: 13 }}>Kolom</b>
        <Button variant="secondary" onClick={() =>
          setColumns([...columns, { name: '', position: columns.length, wipLimit: '' }])
        }>
          <Plus size={12} /> Kolom
        </Button>
      </div>

      {columns.map((c, idx) => (
        <div key={idx} style={{
          display: 'grid', gridTemplateColumns: '1fr 90px auto',
          gap: 8, alignItems: 'end', marginBottom: 6,
        }}>
          <Input
            label={idx === 0 ? 'Nama' : ''}
            value={c.name}
            onChange={(e) => setCol(idx, 'name', e.target.value)}
            style={{ margin: 0 }}
          />
          <Input
            label={idx === 0 ? 'WIP' : ''}
            type="number"
            value={c.wipLimit}
            onChange={(e) => setCol(idx, 'wipLimit', e.target.value)}
            placeholder="—"
            style={{ margin: 0 }}
          />
          <Button variant="danger" onClick={() =>
            setColumns(columns.filter((_, i) => i !== idx))
          } disabled={columns.length === 1}>×</Button>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Membuat…' : 'Buat Board'}
        </Button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Board workspace
   ============================================================ */

function BoardWorkspace({ boardId, onBack, canCreateTask, canManageBoard, onBoardDeleted }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const canUpdateTask = (user?.permissions || []).includes('task.update');
  const [board, setBoard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ assigneeId: '', priority: '', status: '' });
  const [dragging, setDragging] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [b, t] = await Promise.all([
        api.get(`/boards/${boardId}`),
        api.get(`/boards/${boardId}/tasks`, {
          params: Object.fromEntries(
            Object.entries(filters).filter(([, v]) => v !== '')
          ),
        }),
      ]);
      setBoard(b.data.data);
      setTasks(t.data.data || []);
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (e.response?.status === 403) {
        toast('Anda tidak memiliki akses untuk tindakan ini.', 'error');
        onBack();
      } else if (e.response?.status === 404) {
        toast('Board tidak ditemukan.', 'error');
        onBack();
      } else {
        toast(e.response?.data?.error?.message || 'Gagal memuat board', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [boardId, filters.assigneeId, filters.priority, filters.status]);

  const filteredTasks = useMemo(() => {
    if (!localSearch.trim()) return tasks;
    const q = localSearch.toLowerCase();
    return tasks.filter((t) => (t.title || '').toLowerCase().includes(q));
  }, [tasks, localSearch]);

  const onDragStart = (e, task) => {
    if (!canUpdateTask || board?.isArchived) {
      e.preventDefault();
      return;
    }
    setDragging(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = async (e, colId) => {
    e.preventDefault();
    if (!canUpdateTask || board?.isArchived || !dragging) return;
    if (Number(dragging.columnId) === Number(colId)) { setDragging(null); return; }

    const previous = tasks;
    const optimistic = tasks.map((t) =>
      t.id === dragging.id ? { ...t, columnId: colId } : t
    );
    setTasks(optimistic);

    try {
      await api.patch(`/tasks/${dragging.id}`, { columnId: colId });
      setDragging(null);
    } catch (err) {
      const code = err.response?.data?.error?.code;
      setTasks(previous);
      if (code === 'WIP_LIMIT_EXCEEDED') {
        toast('Kolom sudah mencapai WIP limit.', 'error');
      } else if (code === 'BOARD_ARCHIVED') {
        toast('Board ini sudah diarsipkan.', 'error');
      } else {
        toast(err.response?.data?.error?.message || 'Gagal memindahkan task', 'error');
      }
      setDragging(null);
      // Reload authoritative state
      load();
    }
  };

  const doDeleteBoard = async () => {
    try {
      await api.delete(`/boards/${boardId}`);
      toast('Board dihapus', 'success');
      onBoardDeleted?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus board', 'error');
    }
  };

  if (loading && !board) {
    return (
      <div>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={14} /> Semua Board
        </Button>
        <div style={{ marginTop: 16 }}>
          <SkeletonCard lines={6} />
        </div>
      </div>
    );
  }

  if (!board) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={14} /> Semua Board
          </Button>
          <h2 style={{ margin: '8px 0 0' }}>{board.name}</h2>
          {board.departmentId && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Department #{board.departmentId}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreateTask && !board.isArchived && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Task
            </Button>
          )}
          <Button variant="secondary" onClick={load}><RefreshCw size={14} /></Button>
          {canManageBoard && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>Hapus Board</Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12,
        flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Input
            placeholder="Cari judul (board ini saja)…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            style={{ margin: 0 }}
          />
        </div>
        <div style={{ minWidth: 140 }}>
          <select
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
          >
            <option value="">Semua prioritas</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div style={{ minWidth: 140 }}>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
          >
            <option value="">Semua status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
            <option value="closed">Closed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <Input
          placeholder="Assignee ID"
          type="number"
          min="1"
          value={filters.assigneeId}
          onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}
          style={{ width: 140, margin: 0 }}
        />
        <Button variant="secondary" onClick={() => setFilters({ assigneeId: '', priority: '', status: '' })}>
          Reset
        </Button>
      </div>

      {/* Kanban */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${board.columns.length}, minmax(260px, 1fr))`,
        gap: 12, overflowX: 'auto', paddingBottom: 8,
      }}>
        {board.columns.map((col) => {
          const colTasks = filteredTasks.filter((t) => Number(t.columnId) === Number(col.id));
          const allColumnTasks = tasks.filter((t) => Number(t.columnId) === Number(col.id));
          const nonFinal = allColumnTasks.filter((t) => !FINAL_STATUSES.has(t.status)).length;
          const wipExceeded = col.wipLimit != null && nonFinal >= Number(col.wipLimit);

          return (
            <div
              key={col.id}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, col.id)}
              style={{
                background: '#f1f5f9',
                borderRadius: 12,
                padding: 10,
                minHeight: 260,
                border: dragging && Number(dragging.columnId) !== Number(col.id)
                  ? '2px dashed var(--color-primary)'
                  : '2px solid transparent',
                transition: 'border-color 150ms',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 8,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{col.name}</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {col.wipLimit != null && (
                    <Badge tone={wipExceeded ? 'error' : 'default'}>
                      WIP {nonFinal}/{col.wipLimit}
                    </Badge>
                  )}
                  <Badge tone="info">{colTasks.length}</Badge>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                {colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    dragging={dragging?.id === t.id}
                    canDrag={canUpdateTask && !board.isArchived}
                    onDragStart={onDragStart}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => nav(`/tasks/${t.id}`)}
                  />
                ))}
                {!colTasks.length && (
                  <div style={{
                    fontSize: 12, color: 'var(--color-text-muted)',
                    padding: 12, textAlign: 'center',
                  }}>
                    Kosong
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        board={board}
        onCreated={() => { setCreateOpen(false); load(); }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus board ini?"
        message="Board akan di-soft-delete. Task di dalamnya tidak akan ditampilkan pada board."
        confirmLabel="Ya, hapus"
        tone="danger"
        onConfirm={doDeleteBoard}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

/* ============================================================
   Task card
   ============================================================ */

function TaskCard({ task, dragging, canDrag, onDragStart, onDragEnd, onClick }) {
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const done = FINAL_STATUSES.has(task.status);

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: 10,
        marginBottom: 6,
        fontSize: 13,
        cursor: canDrag ? 'grab' : 'pointer',
        opacity: done && !dragging ? 0.7 : dragging ? 0.5 : 1,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>
        {task.title}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        <Badge tone={PRIORITY_TONE[task.priority] || 'default'}>{task.priority || 'normal'}</Badge>
        {done && <Badge tone="success">selesai</Badge>}
        {overdue && <Badge tone="error">overdue</Badge>}
        {!overdue && dueToday && <Badge tone="warning">hari ini</Badge>}
      </div>

      {task.progressPercent > 0 && (
        <div style={{ marginBottom: 6 }}>
          <TaskProgress percent={task.progressPercent} />
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{task.assigneeName || 'Unassigned'}</span>
        {task.dueDate && <span>{task.dueDate}</span>}
      </div>
    </div>
  );
}

/* ============================================================
   Create task modal
   ============================================================ */

function CreateTaskModal({ open, onClose, board, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    columnId: board?.columns?.[0]?.id || '',
    priority: 'normal',
    assigneeId: '',
    startDate: '',
    dueDate: '',
    progressPercent: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        title: '',
        description: '',
        columnId: board?.columns?.[0]?.id || '',
        priority: 'normal',
        assigneeId: '',
        startDate: '',
        dueDate: '',
        progressPercent: '',
      });
    }
    /* eslint-disable-next-line */
  }, [open]);

  const submit = async () => {
    if (!form.title.trim()) { toast('Judul wajib', 'error'); return; }
    if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
      toast('Tanggal mulai harus <= tanggal jatuh tempo', 'error'); return;
    }

    const payload = {
      departmentId: board.departmentId ?? null,
      boardId: board.id,
      columnId: form.columnId ? Number(form.columnId) : null,
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
    };
    if (form.assigneeId) payload.assigneeId = Number(form.assigneeId);
    if (form.startDate) payload.startDate = form.startDate;
    if (form.dueDate) payload.dueDate = form.dueDate;
    if (form.progressPercent !== '') payload.progressPercent = Number(form.progressPercent);

    setSaving(true);
    try {
      await api.post('/tasks', payload);
      toast('Task dibuat', 'success');
      onCreated?.();
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (code === 'WIP_LIMIT_EXCEEDED') {
        toast('Kolom sudah mencapai WIP limit.', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal membuat task', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Task Baru" maxWidth={560}>
      <Input
        label="Judul *"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Deskripsi</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          style={{
            width: '100%', padding: 10, borderRadius: 8,
            border: '1px solid var(--color-border)', fontSize: 13,
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Kolom</label>
          <select
            value={form.columnId}
            onChange={(e) => setForm({ ...form, columnId: e.target.value })}
            style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
          >
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        <Input
          label="Assignee ID (opsional)"
          type="number"
          value={form.assigneeId}
          onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
        />
        <Input
          label="Start Date"
          type="date"
          value={form.startDate}
          onChange={(e) => setForm({ ...form, startDate: e.target.value })}
        />
        <Input
          label="Due Date"
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
        />
      </div>

      <Input
        label="Progress (%)"
        type="number"
        min={0}
        max={100}
        value={form.progressPercent}
        onChange={(e) => setForm({ ...form, progressPercent: e.target.value })}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Membuat…' : 'Buat Task'}
        </Button>
      </div>
    </Modal>
  );
}