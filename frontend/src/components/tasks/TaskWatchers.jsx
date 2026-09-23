import { useEffect, useState } from 'react';
import { UserPlus, X, Eye } from 'lucide-react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import Input from '../Input';
import Modal from '../Modal';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';

export default function TaskWatchers({ task, canWatch, canManage, onChanged }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${task.id}/watchers`);
      setRows(r.data.data || []);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat watchers', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [task.id]);

  const isSelfWatching = rows.some((w) => Number(w.userId) === Number(user?.id));

  const toggleSelf = async () => {
    try {
      if (isSelfWatching) {
        await api.delete(`/tasks/${task.id}/watchers/${user.id}`);
      } else {
        await api.post(`/tasks/${task.id}/watchers`, {});
      }
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const removeWatcher = async (userId) => {
    try {
      await api.delete(`/tasks/${task.id}/watchers/${userId}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <Card
      title="Watchers"
      actions={
        canManage ? (
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} />
          </Button>
        ) : null
      }
    >
      {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}

      {!loading && !rows.length && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Belum ada watcher.
        </div>
      )}

      {rows.map((w) => (
        <div key={w.userId} style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', padding: '6px 0',
          boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 13,
        }}>
          <span>👤 {w.userName}</span>
          {canManage && Number(w.userId) !== Number(user?.id) && (
            <button type="button" onClick={() => removeWatcher(w.userId)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {canWatch && (
        <div style={{ marginTop: 10 }}>
          <Button variant="secondary" onClick={toggleSelf}>
            <Eye size={14} /> {isSelfWatching ? 'Unwatch' : 'Watch Task'}
          </Button>
        </div>
      )}

      <AddWatcherModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        taskId={task.id}
        onAdded={() => { setAddOpen(false); load(); onChanged?.(); }}
      />
    </Card>
  );
}

function AddWatcherModal({ open, onClose, taskId, onAdded }) {
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      toast('User ID tidak valid', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tasks/${taskId}/watchers`, { userId: parsedUserId });
      toast('Watcher ditambahkan', 'success');
      setUserId('');
      onAdded();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah Watcher" maxWidth={420}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Masukkan User ID. Backend memvalidasi bahwa user berada di entity yang sama.
      </div>
      <Input
        label="User ID"
        type="number"
        min="1"
        step="1"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Menambahkan…' : 'Tambah'}
        </Button>
      </div>
    </Modal>
  );
}