import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, ArrowRight, ArrowLeft, Link as LinkIcon } from 'lucide-react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import Input from '../Input';
import Badge from '../Badge';
import Modal from '../Modal';
import { toast } from '../Toast';

export default function TaskDependencies({ task, canManage, onChanged }) {
  const [data, setData] = useState({ blockedBy: [], blocking: [], related: [] });
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/tasks/${task.id}/dependencies`);
      setData(r.data.data || { blockedBy: [], blocking: [], related: [] });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat dependencies', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [task.id]);

  const remove = async (id) => {
    if (!confirm('Hapus dependency ini?')) return;
    try {
      await api.delete(`/tasks/${task.id}/dependencies/${id}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <Card
      title="Dependencies"
      actions={
        canManage ? (
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus size={14} />
          </Button>
        ) : null
      }
    >
      {loading && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>}

      {!loading && (
        <>
          <Section
            icon={ArrowLeft}
            label="Blocked by"
            rows={data.blockedBy}
            canManage={canManage}
            onRemove={remove}
          />
          <Section
            icon={ArrowRight}
            label="Blocking"
            rows={data.blocking}
            canManage={canManage}
            onRemove={remove}
          />
          <Section
            icon={LinkIcon}
            label="Related"
            rows={(data.related || []).map((r) => ({
              id: r.id,
              taskId: r.predecessorTaskId === task.id ? r.successorTaskId : r.predecessorTaskId,
              title: `Task #${r.predecessorTaskId === task.id ? r.successorTaskId : r.predecessorTaskId}`,
            }))}
            canManage={canManage}
            onRemove={remove}
          />
        </>
      )}

      <AddDependencyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        taskId={task.id}
        onAdded={() => { setAddOpen(false); load(); onChanged?.(); }}
      />
    </Card>
  );
}

function Section({ icon: Icon, label, rows, canManage, onRemove }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11, color: 'var(--color-text-muted)',
        display: 'flex', alignItems: 'center', gap: 4,
        marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        <Icon size={11} /> {label} ({rows.length})
      </div>
      {!rows.length && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0' }}>
          —
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', padding: '6px 0',
          borderBottom: '1px solid var(--color-border)', fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.taskId ? (
              <Link to={`/tasks/${r.taskId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <b>{r.title}</b>
              </Link>
            ) : (
              <span>{r.title}</span>
            )}
            {r.status && <Badge tone="default">{r.status}</Badge>}
          </div>
          {canManage && (
            <button type="button" onClick={() => onRemove(r.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddDependencyModal({ open, onClose, taskId, onAdded }) {
  const [mode, setMode] = useState('blocked_by');
  const [otherId, setOtherId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!otherId || isNaN(Number(otherId))) {
      toast('Task ID tidak valid', 'error');
      return;
    }
    const other = Number(otherId);

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
      toast('Dependency ditambahkan', 'success');
      setOtherId('');
      onAdded();
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (code === 'DEPENDENCY_CYCLE') {
        toast('Dependency ini akan membuat siklus.', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal menambahkan dependency', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tambah Dependency" maxWidth={460}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Tipe</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}
        >
          <option value="blocked_by">Task ini diblokir oleh task lain</option>
          <option value="blocking">Task ini memblokir task lain</option>
          <option value="related">Terkait dengan task lain</option>
        </select>
      </div>

      <Input
        label="Task ID lainnya"
        type="number"
        value={otherId}
        onChange={(e) => setOtherId(e.target.value)}
      />
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: -6, marginBottom: 12 }}>
        Harus task di entity yang sama. Siklus dependency akan ditolak backend.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Menambahkan…' : 'Tambah'}
        </Button>
      </div>
    </Modal>
  );
}