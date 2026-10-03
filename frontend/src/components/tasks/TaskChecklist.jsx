import { useEffect, useState } from 'react';
import api from '../../api/client';
import ActionMenu from '../ActionMenu';
import Card from '../Card';
import Button from '../Button';
import Checkbox from '../Checkbox';
import IconButton from '../IconButton';
import Input from '../Input';
import ConfirmDialog from '../ConfirmDialog';
import EmptyState, { LoadingState } from '../EmptyState';
import { toast } from '../Toast';
import TaskProgress from './TaskProgress';
import { defineAIForm, f } from '../ai/aiFormFields';
import usePrakasaAIForm from '../ai/usePrakasaAIForm';
import useOpenFromUrl from '../ai/useOpenFromUrl';
import './tasks.css';

const EMPTY = { items: [], done: 0, total: 0, percent: 0 };
const EMPTY_ITEM = { title: '' };

// Prakasa AI may write the new item's title; the user presses "Simpan item"
// (docs/prakasa-ai-rencana.md §9.9). Ticking, moving and deleting items stay
// with the user: they save as they are pressed.
const AI_CHECKLIST_ITEM = defineAIForm({
  id: 'task-checklist-item',
  title: 'Item checklist',
  permission: 'task.checklist.manage',
  submitLabel: 'Simpan item',
  fields: [f.text('title', 'Judul item', { required: true, maxLength: 500 })],
});

/**
 * Checklist card for TaskDetail.
 * Props: taskId, canManage, onChanged (optional callback after mutation)
 */
export default function TaskChecklist({ taskId, canManage, onChanged }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  // /tasks/<id>?form=checklist opens the "Tambah item" row (a link, or Prakasa AI's buka_halaman).
  useOpenFromUrl('form', (name) => { if (name === 'checklist') setAdding(true); }, { enabled: Boolean(canManage) });
  const ai = usePrakasaAIForm(AI_CHECKLIST_ITEM, {
    enabled: adding && Boolean(canManage),
    values: { title: newTitle },
    setters: { title: setNewTitle },
    onFill: () => setTitleError(''),
    initialValues: EMPTY_ITEM,
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${taskId}/checklist`);
      setData(r.data.data || EMPTY);
      setLoadError('');
    } catch (e) {
      setLoadError(e.response?.data?.error?.message || 'Checklist gagal dimuat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [taskId]);

  const add = async (event) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) { setTitleError('Judul item wajib diisi.'); return; }
    setSaving(true);
    try {
      await api.post(`/tasks/${taskId}/checklist`, { title });
      setNewTitle('');
      setTitleError('');
      setAdding(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Item gagal ditambahkan.', 'error');
    } finally {
      setSaving(false);
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
      toast(e.response?.data?.error?.message || 'Item gagal diubah.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item) => {
    setRemoving(true);
    try {
      await api.delete(`/tasks/${taskId}/checklist/${item.id}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Item gagal dihapus.', 'error');
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
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
      toast(e.response?.data?.error?.message || 'Urutan gagal disimpan.', 'error');
      load();
    }
  };

  const cancelAdd = () => { setAdding(false); setNewTitle(''); setTitleError(''); };

  return (
    <Card
      title={data.total ? `Checklist ${data.done}/${data.total}` : 'Checklist'}
      actions={canManage && !adding ? (
        <Button variant="secondary" icon="add" onClick={() => setAdding(true)}>Tambah item</Button>
      ) : null}
    >
      <div className="pw-stack pw-stack--sm">
        {data.total > 0 ? <TaskProgress percent={data.percent} label="Checklist selesai" /> : null}

        {loading && !data.items.length ? <LoadingState compact label="Memuat checklist…" /> : null}

        {!loading && loadError ? (
          <EmptyState compact tone="error" title="Checklist gagal dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
        ) : null}

        {!loading && !loadError && !data.items.length && !adding ? <EmptyState compact icon="checklist" description="Belum ada checklist." /> : null}

        {data.items.length > 0 ? (
          <ul className="task-list">
            {data.items.map((item, idx) => (
              <li key={item.id} className="task-list__row">
                <Checkbox
                  className="task-list__main"
                  checked={!!item.isDone}
                  disabled={busyId === item.id || !canManage}
                  onChange={() => toggle(item)}
                  label={<span data-no-translate="" className={item.isDone ? 'task-checklist__title--done' : undefined}>{item.title}</span>}
                />
                {canManage ? (
                  <span className="task-list__actions">
                    <IconButton label="Naikkan item" size="sm" icon="expand_less" onClick={() => move(idx, -1)} disabled={idx === 0} />
                    <IconButton label="Turunkan item" size="sm" icon="expand_more" onClick={() => move(idx, 1)} disabled={idx === data.items.length - 1} />
                    <ActionMenu
                      label={`Aksi untuk ${item.title}`}
                      size="sm"
                      items={[{ label: 'Hapus item', icon: 'delete', tone: 'danger', onClick: () => setRemoveTarget(item) }]}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {ai.notice}
        {adding ? (
          <form className="task-checklist__add" onSubmit={add}>
            <Input
              label="Judul item"
              value={newTitle}
              {...ai.field('title')}
              onChange={(e) => { setNewTitle(e.target.value); if (titleError) setTitleError(''); }}
              error={titleError}
              hint="Contoh: Kirim draf ke klien."
              maxLength={500}
              autoFocus
            />
            <Button variant="text" type="button" onClick={cancelAdd}>Batal</Button>
            <Button type="submit" loading={saving}>Simpan item</Button>
          </form>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Hapus item checklist?"
        message={removeTarget ? `Item "${removeTarget.title}" akan dihapus dari checklist.` : ''}
        confirmLabel="Hapus item"
        tone="danger"
        loading={removing}
        onConfirm={() => remove(removeTarget)}
        onClose={() => setRemoveTarget(null)}
      />
    </Card>
  );
}
