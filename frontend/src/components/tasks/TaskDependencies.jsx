import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import IconButton from '../IconButton';
import Input from '../Input';
import Select from '../Select';
import StatusBadge from '../StatusBadge';
import Modal from '../Modal';
import FormActions from '../FormActions';
import ConfirmDialog from '../ConfirmDialog';
import EmptyState, { LoadingState } from '../EmptyState';
import { statusLabel } from '../statusTone';
import { toast } from '../Toast';
import { defineAIForm, f } from '../ai/aiFormFields';
import usePrakasaAIForm from '../ai/usePrakasaAIForm';
import useOpenFromUrl from '../ai/useOpenFromUrl';
import './tasks.css';

const MODE_OPTIONS = [
  { value: 'blocked_by', label: 'Task ini diblokir oleh task lain' },
  { value: 'blocking', label: 'Task ini memblokir task lain' },
  { value: 'related', label: 'Terkait dengan task lain' },
];
const EMPTY_DEPENDENCY = { mode: 'blocked_by', otherId: '' };

// Prakasa AI may choose the kind of dependency and type the other task's ID: a
// task ID is not personal and is shown on the page (decision of Wave C2,
// docs/prakasa-ai-rencana.md §9.12). Whether that task exists and this user
// may see it is checked when the user saves (POST /tasks/:id/dependencies).
const AI_DEPENDENCY = defineAIForm({
  id: 'task-dependency',
  title: 'Tambah dependensi',
  permission: 'task.dependency.manage',
  submitLabel: 'Tambah dependensi',
  fields: [
    f.select('mode', 'Jenis', MODE_OPTIONS, { required: true }),
    f.number('otherId', 'ID task lain', { required: true, min: 1, step: 1, hint: 'Nomor ID task, dari halaman tugas atau dari data tugas pengguna. Jangan dikarang: bila tidak diketahui, tanyakan.' }),
  ],
});

// Tasks this one waits for, tasks waiting for it, and related tasks.
export default function TaskDependencies({ task, canManage, onChanged }) {
  const [data, setData] = useState({ blockedBy: [], blocking: [], related: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  // /tasks/<id>?form=dependensi opens the dialog (a link, or Prakasa AI's buka_halaman).
  useOpenFromUrl('form', (name) => { if (name === 'dependensi') setAddOpen(true); }, { enabled: Boolean(canManage) });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${task.id}/dependencies`);
      setData(r.data.data || { blockedBy: [], blocking: [], related: [] });
      setLoadError('');
    } catch (e) {
      setLoadError(e.response?.data?.error?.message || 'Dependensi gagal dimuat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [task.id]);

  const remove = async (id) => {
    setRemoving(true);
    try {
      await api.delete(`/tasks/${task.id}/dependencies/${id}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Dependensi gagal dihapus.', 'error');
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  };

  const related = (data.related || []).map((r) => {
    const taskIsPredecessor = Number(r.predecessorTaskId) === Number(task.id);
    const relatedTaskId = taskIsPredecessor ? r.successorTaskId : r.predecessorTaskId;
    const relatedTitle = taskIsPredecessor ? r.successorTitle : r.predecessorTitle;
    return { id: r.id, taskId: relatedTaskId, title: relatedTitle || `Task #${relatedTaskId}` };
  });

  return (
    <Card
      title="Dependensi"
      actions={canManage ? <IconButton label="Tambah dependensi" icon="add_link" onClick={() => setAddOpen(true)} /> : null}
    >
      {loading && !loadError ? <LoadingState compact label="Memuat dependensi…" /> : null}

      {!loading && loadError ? (
        <EmptyState compact tone="error" title="Dependensi gagal dimuat" description={loadError} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      ) : null}

      {!loading && !loadError ? (
        <div className="task-deps">
          <Section kind="blocked_by" rows={data.blockedBy || []} canManage={canManage} onRemove={setRemoveTarget} />
          <Section kind="blocks" rows={data.blocking || []} canManage={canManage} onRemove={setRemoveTarget} />
          <Section kind="related" rows={related} canManage={canManage} onRemove={setRemoveTarget} />
        </div>
      ) : null}

      <AddDependencyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        taskId={task.id}
        onAdded={() => { setAddOpen(false); load(); onChanged?.(); }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title="Hapus dependensi?"
        message={removeTarget ? `Dependensi ke "${removeTarget.title}" akan dihapus.` : ''}
        confirmLabel="Hapus dependensi"
        tone="danger"
        loading={removing}
        onConfirm={() => remove(removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
      />
    </Card>
  );
}

function Section({ kind, rows, canManage, onRemove }) {
  return (
    <section className="task-deps__group" aria-label={statusLabel(kind)}>
      <h4 className="pw-overline">{`${statusLabel(kind)} (${rows.length})`}</h4>
      {!rows.length ? <span className="pw-text-helper">Tidak ada.</span> : (
        <ul className="task-list">
          {rows.map((r) => (
            <li key={r.id} className="task-list__row">
              <span className="task-list__main">
                {r.taskId ? <Link to={`/tasks/${r.taskId}`} className="pw-link" data-no-translate="">{r.title}</Link> : <span data-no-translate="">{r.title}</span>}
                {r.status ? <StatusBadge status={r.status} /> : null}
              </span>
              {canManage ? (
                <IconButton label={`Hapus dependensi ke ${r.title}`} size="sm" icon="link_off" onClick={() => onRemove(r)} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddDependencyModal({ open, onClose, taskId, onAdded }) {
  const [mode, setMode] = useState(EMPTY_DEPENDENCY.mode);
  const [otherId, setOtherId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setMode(EMPTY_DEPENDENCY.mode); setOtherId(''); setError(''); } }, [open]);

  const ai = usePrakasaAIForm(AI_DEPENDENCY, {
    enabled: open,
    values: { mode, otherId },
    setters: { mode: setMode, otherId: setOtherId },
    initialValues: EMPTY_DEPENDENCY,
    onFill: () => setError(''),
    validate: (next) => (String(next.otherId || '') !== '' && Number(next.otherId) === Number(taskId) ? { otherId: 'Task tidak dapat bergantung ke dirinya sendiri.' } : {}),
  });

  const submit = async (event) => {
    event.preventDefault();
    const other = Number(otherId);
    if (!Number.isInteger(other) || other <= 0) {
      setError('Isi ID task berupa bilangan bulat positif.');
      return;
    }
    if (other === Number(taskId)) {
      setError('Task tidak dapat bergantung ke dirinya sendiri.');
      return;
    }

    let predecessorTaskId;
    let successorTaskId;
    let dependencyType = 'blocks';

    if (mode === 'blocked_by') {
      predecessorTaskId = other;
      successorTaskId = taskId;
    } else if (mode === 'blocking') {
      predecessorTaskId = taskId;
      successorTaskId = other;
    } else {
      // related — no strict direction
      predecessorTaskId = taskId;
      successorTaskId = other;
      dependencyType = 'related';
    }

    setSaving(true);
    try {
      await api.post(`/tasks/${taskId}/dependencies`, {
        predecessorTaskId,
        successorTaskId,
        dependencyType,
      });
      toast('Dependensi ditambahkan', 'success');
      setOtherId('');
      onAdded();
    } catch (e) {
      const code = e.response?.data?.error?.code;
      setError(code === 'DEPENDENCY_CYCLE'
        ? 'Dependensi ini akan membuat siklus.'
        : (e.response?.data?.error?.message || 'Dependensi gagal ditambahkan.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah dependensi" size="sm">
      <form className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <Select
          label="Jenis"
          value={mode}
          {...ai.field('mode')}
          onChange={(e) => setMode(e.target.value)}
          options={MODE_OPTIONS}
        />
        <Input
          label="ID task lain"
          type="number"
          min="1"
          step="1"
          required
          value={otherId}
          {...ai.field('otherId')}
          error={error}
          onChange={(e) => { setOtherId(e.target.value); if (error) setError(''); }}
          hint="Task di entitas yang sama. Dependensi yang membentuk siklus ditolak."
        />
        <FormActions>
          <Button type="button" variant="text" onClick={onClose}>Batal</Button>
          <Button type="submit" loading={saving}>Tambah dependensi</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
