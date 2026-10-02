import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Input from '../Input';
import Modal from '../Modal';
import FormActions from '../FormActions';
import EmptyState, { LoadingState } from '../EmptyState';
import { toast } from '../Toast';
import './tasks.css';
import { useAuth } from '../../context/AuthContext';

// People who get a notification when the task changes ("pemantau").
export default function TaskWatchers({ task, canWatch, canManage, onChanged }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${task.id}/watchers`);
      setRows(r.data.data || []);
      setLoadError('');
    } catch (e) {
      setLoadError(e.response?.data?.error?.message || 'Daftar pemantau gagal dimuat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [task.id]);

  const isSelfWatching = rows.some((w) => Number(w.userId) === Number(user?.id));

  const toggleSelf = async () => {
    setToggling(true);
    try {
      if (isSelfWatching) {
        await api.delete(`/tasks/${task.id}/watchers/${user.id}`);
      } else {
        await api.post(`/tasks/${task.id}/watchers`, {});
      }
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal mengubah pemantauan.', 'error');
    } finally {
      setToggling(false);
    }
  };

  const removeWatcher = async (userId) => {
    try {
      await api.delete(`/tasks/${task.id}/watchers/${userId}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Pemantau gagal dihapus.', 'error');
    }
  };

  return (
    <Card
      title="Pemantau"
      actions={canManage ? <IconButton label="Tambah pemantau" icon="person_add" onClick={() => setAddOpen(true)} /> : null}
    >
      <div className="pw-stack pw-stack--sm">
        {loading && !rows.length ? <LoadingState compact label="Memuat pemantau…" /> : null}

        {!loading && loadError ? (
          <EmptyState compact tone="error" title="Pemantau gagal dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
        ) : null}

        {!loading && !loadError && !rows.length ? <EmptyState compact icon="visibility" description="Belum ada pemantau." /> : null}

        {rows.length > 0 ? (
          <ul className="task-list">
            {rows.map((w) => (
              <li key={w.userId} className="task-list__row">
                <span className="task-list__main">
                  <Icon name="person" size="md" className="task-list__icon" />
                  <span data-no-translate="">{w.userName}</span>
                </span>
                {canManage && Number(w.userId) !== Number(user?.id) ? (
                  <IconButton label={`Hapus ${w.userName || 'pemantau'}`} size="sm" icon="close" onClick={() => removeWatcher(w.userId)} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canWatch ? (
          <div>
            <Button variant="secondary" icon={isSelfWatching ? 'visibility_off' : 'visibility'} loading={toggling} onClick={toggleSelf}>
              {isSelfWatching ? 'Berhenti memantau' : 'Pantau task'}
            </Button>
          </div>
        ) : null}
      </div>

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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setUserId(''); setError(''); } }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      setError('Isi ID pengguna berupa bilangan bulat positif.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/tasks/${taskId}/watchers`, { userId: parsedUserId });
      toast('Pemantau ditambahkan', 'success');
      setUserId('');
      onAdded();
    } catch (e) {
      setError(e.response?.data?.error?.message || 'Pemantau gagal ditambahkan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah pemantau" size="sm">
      <form className="pw-stack" onSubmit={submit} noValidate>
        <Input
          label="ID pengguna"
          type="number"
          min="1"
          step="1"
          required
          value={userId}
          error={error}
          onChange={(e) => { setUserId(e.target.value); if (error) setError(''); }}
          hint="Pengguna harus berada di entitas yang sama dengan task ini."
        />
        <FormActions>
          <Button type="button" variant="text" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>Tambah pemantau</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
