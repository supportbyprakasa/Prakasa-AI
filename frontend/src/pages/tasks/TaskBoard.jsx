import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function TaskBoard() {
  const [boards, setBoards] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [board, setBoard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get('/boards').then((r) => setBoards(r.data.data));
  }, []);

  const loadBoard = async (b) => {
    setSelectedBoard(b);
    const [d, t] = await Promise.all([
      api.get(`/boards/${b.id}`),
      api.get(`/boards/${b.id}/tasks`),
    ]);
    setBoard(d.data.data);
    setTasks(t.data.data);
  };

  const createTask = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/tasks', {
        entityId: board.entityId,
        departmentId: board.departmentId,
        boardId: board.id,
        columnId: Number(fd.get('columnId')),
        title: fd.get('title'),
        description: fd.get('description'),
        priority: fd.get('priority') || 'normal',
        assigneeId: fd.get('assigneeId') ? Number(fd.get('assigneeId')) : null,
        dueDate: fd.get('dueDate') || null,
      });
      toast('Task dibuat', 'success');
      setOpen(false);
      loadBoard(selectedBoard);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Task Board</h2>
        {selectedBoard && <Button onClick={() => setOpen(true)}>+ Task</Button>}
      </div>

      {!selectedBoard && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {boards.map((b) => (
            <div key={b.id} onClick={() => loadBoard(b)} style={{
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 12, padding: 16, cursor: 'pointer', minWidth: 220,
            }}>
              <div style={{ fontWeight: 600 }}>{b.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Entity {b.entityId} · Dept {b.departmentId ?? '—'}
              </div>
            </div>
          ))}
          {!boards.length && <div style={{ color: 'var(--color-text-muted)' }}>Belum ada board.</div>}
        </div>
      )}

      {selectedBoard && board && (
        <>
          <Button variant="secondary" onClick={() => { setSelectedBoard(null); setBoard(null); setTasks([]); }}>
            ← Semua Board
          </Button>
          <h3 style={{ marginTop: 12 }}>{board.name}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${board.columns.length}, minmax(240px, 1fr))`, gap: 12, marginTop: 8, overflowX: 'auto' }}>
            {board.columns.map((col) => (
              <div key={col.id} style={{
                background: '#f1f5f9', borderRadius: 12, padding: 12, minHeight: 200,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{col.name}</div>
                {tasks.filter((t) => t.columnId === col.id).map((t) => (
                  <div key={t.id} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 8, padding: 10, marginBottom: 6, fontSize: 13,
                  }}>
                    <div style={{ fontWeight: 500 }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {t.assigneeName || 'Belum ada PIC'} · {t.priority}
                      {t.dueDate && <> · Due {t.dueDate}</>}
                    </div>
                  </div>
                ))}
                {!tasks.some((t) => t.columnId === col.id) && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Kosong</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Buat Task">
        {board && (
          <form onSubmit={createTask}>
            <Input label="Judul" name="title" required />
            <Input label="Deskripsi" name="description" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Kolom</label>
              <select name="columnId" required style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Priority</label>
              <select name="priority" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <Input label="Assignee User ID (opsional)" name="assigneeId" type="number" />
            <Input label="Due Date (YYYY-MM-DD)" name="dueDate" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit">Simpan</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
