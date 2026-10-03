import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../Button';
import Badge from '../Badge';
import EmptyState, { LoadingState } from '../EmptyState';
import FormActions from '../FormActions';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Input from '../Input';
import Modal from '../Modal';
import Select from '../Select';
import ConfirmDialog from '../ConfirmDialog';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import './ai-components.css';

const TYPE_META = {
  document: { label: 'Dokumen', icon: 'description' },
  task: { label: 'Tugas', icon: 'check_box' },
  meeting: { label: 'Rapat', icon: 'calendar_today' },
  approval_request: { label: 'Approval', icon: 'check_circle' },
  form_submission: { label: 'Isian formulir', icon: 'assignment' },
  decision_log: { label: 'Keputusan', icon: 'layers' },
  kb_document: { label: 'Basis pengetahuan', icon: 'menu_book' },
};

export default function AIContextPanel({ sessionId, session, refreshKey }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const canAttach = (user?.permissions || []).includes('ai_command.context.attach');
  const isOwner = session && Number(session.ownerUserId) === Number(user?.id);
  const canEdit = canAttach && isOwner;
  const archived = session?.status === 'archived';

  const load = async () => {
    if (!sessionId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get(`/ai-command/sessions/${sessionId}/contexts`);
      setRows(r.data.data || []);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat konteks', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sessionId, refreshKey]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      // IMPORTANT: contextId in URL is the AI context-link ID (row.id),
      // NOT the underlying source record's id.
      await api.delete(`/ai-command/sessions/${sessionId}/contexts/${deleteTarget.id}`);
      toast('Konteks dilepas', 'success');
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus', 'error');
    }
  };

  return (
    <div className="ai-context-panel">
      <div className="ai-support-section-header">
        <h3 className="ai-support-section-title">Konteks internal</h3>
        {canEdit && !archived && (
          <Button variant="secondary" icon="add" onClick={() => setAddOpen(true)}>
            Tambah konteks
          </Button>
        )}
      </div>

      <div className="ai-support-section-body">
        <div className="ai-support-helper">
          AI hanya menerima konteks dari record yang berhasil diverifikasi server.
        </div>

        {loading && <LoadingState compact />}

        {!loading && !rows.length && (
          <EmptyState compact icon="link" description="Belum ada konteks terhubung." />
        )}

        {!loading && rows.map((c) => {
          const meta = TYPE_META[c.contextType] || { label: c.contextType, icon: 'link' };
          return (
            <div key={c.id} className="ai-support-card">
              <Icon name={meta.icon} size="sm" className="ai-context-icon" />
              <div className="pw-grow">
                <div className="ai-context-title" data-no-translate={c.title ? '' : undefined}>
                  {c.title || `${meta.label} #${c.contextId}`}
                </div>
                <div className="ai-context-meta">
                  <Badge tone="default">{meta.label}</Badge> · id {c.contextId}
                  {c.relation && <> · {c.relation}</>}
                </div>
              </div>
              {canEdit && !archived && (
                <IconButton
                  size="sm"
                  tone="danger"
                  label="Lepas dari konteks"
                  icon="delete"
                  onClick={() => setDeleteTarget(c)}
                  aria-label={`Lepas ${c.title || meta.label} dari konteks`}
                />
              )}
            </div>
          );
        })}
      </div>

      {addOpen && (
        <AddContextModal
          sessionId={sessionId}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Lepas konteks ini?"
        message="Tautan konteks ini akan dilepas dari percakapan. Data sumber tidak terhapus."
        confirmLabel="Lepas konteks"
        tone="danger"
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ============================================================
   Add context modal
   ============================================================ */

function AddContextModal({ sessionId, onClose, onAdded }) {
  const [form, setForm] = useState({
    contextType: 'document',
    contextId: '',
    relation: 'reference',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const change = (key, value) => {
    setForm({ ...form, [key]: value });
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const submit = async () => {
    const next = {};
    if (!form.contextId || isNaN(Number(form.contextId))) next.contextId = 'ID record tidak valid.';
    if (!/^[a-zA-Z0-9:_-]+$/.test(form.relation || 'reference')) next.relation = 'Relasi hanya boleh berisi huruf, angka, :, _, atau -.';
    if (next.contextId || next.relation) {
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/ai-command/sessions/${sessionId}/contexts`, {
        contextType: form.contextType,
        contextId: Number(form.contextId),
        relation: form.relation || 'reference',
      });
      toast('Konteks ditambahkan', 'success');
      onAdded();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menambahkan konteks', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Tambah konteks" size="sm">
      <div className="pw-stack">
        <Select
          label="Tipe"
          value={form.contextType}
          onChange={(e) => setForm({ ...form, contextType: e.target.value })}
          options={Object.keys(TYPE_META).map((t) => ({ value: t, label: TYPE_META[t].label }))}
        />

        <Input
          label="ID Record"
          required
          type="number"
          value={form.contextId}
          error={errors.contextId}
          onChange={(e) => change('contextId', e.target.value)}
          placeholder="Contoh: 128"
          hint="Server memeriksa bahwa record ini ada di entitas Anda. Bukan teks bebas."
        />

        <Input
          label="Relasi (opsional)"
          value={form.relation}
          error={errors.relation}
          onChange={(e) => change('relation', e.target.value)}
          placeholder="reference"
        />

        <FormActions>
          <Button variant="text" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>Tambah konteks</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
