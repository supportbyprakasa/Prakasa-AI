import { useEffect, useState } from 'react';
import { Plus, Trash2, Link2, FileText, CheckSquare, Calendar, CheckCircle2, ClipboardList, BookOpen, Layers } from 'lucide-react';
import api from '../../api/client';
import Button from '../Button';
import Badge from '../Badge';
import Input from '../Input';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';

const TYPE_META = {
  document: { label: 'Dokumen', icon: FileText },
  task: { label: 'Task', icon: CheckSquare },
  meeting: { label: 'Meeting', icon: Calendar },
  approval_request: { label: 'Approval', icon: CheckCircle2 },
  form_submission: { label: 'Form Submission', icon: ClipboardList },
  decision_log: { label: 'Decision', icon: Layers },
  kb_document: { label: 'Knowledge Base', icon: BookOpen },
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
      toast(e.response?.data?.error?.message || 'Gagal memuat context', 'error');
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
      toast('Context dihapus', 'success');
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus', 'error');
    }
  };

  return (
    <div className="ai-context-panel">
      <div className="ai-support-section-header">
        <div style={{ fontSize: 13, fontWeight: 600 }}>Konteks Internal</div>
        {canEdit && !archived && (
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus size={12} /> Context
          </Button>
        )}
      </div>

      <div className="ai-support-section-body">
        <div className="ai-support-helper">
          AI hanya menerima context record yang berhasil diverifikasi backend.
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>
        )}

        {!loading && !rows.length && (
          <div className="ai-support-empty">
            Belum ada context terhubung.
          </div>
        )}

        {!loading && rows.map((c) => {
          const meta = TYPE_META[c.contextType] || { label: c.contextType, icon: Link2 };
          const Icon = meta.icon;
          return (
            <div key={c.id} className="ai-support-card">
              <Icon size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {c.title || `${meta.label} #${c.contextId}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  <Badge tone="default">{c.contextType}</Badge> · id {c.contextId}
                  {c.relation && <> · {c.relation}</>}
                </div>
              </div>
              {canEdit && !archived && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(c)}
                  title="Hapus"
                  aria-label={`Lepas ${c.title || meta.label} dari konteks`}
                  className="ai-support-delete ai-ripple"
                >
                  <Trash2 size={13} />
                </button>
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
        title="Hapus context?"
        message="Link context ini akan dilepas dari percakapan. Data sumber tidak terhapus."
        confirmLabel="Ya, lepas"
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

  const submit = async () => {
    if (!form.contextId || isNaN(Number(form.contextId))) {
      toast('ID record tidak valid', 'error');
      return;
    }
    if (!/^[a-zA-Z0-9:_-]+$/.test(form.relation || 'reference')) {
      toast('Relation hanya boleh berisi huruf, angka, :, _, atau -', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/ai-command/sessions/${sessionId}/contexts`, {
        contextType: form.contextType,
        contextId: Number(form.contextId),
        relation: form.relation || 'reference',
      });
      toast('Context ditambahkan', 'success');
      onAdded();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menambahkan context', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Tambah Context" maxWidth={480}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Tipe</label>
        <select
          value={form.contextType}
          onChange={(e) => setForm({ ...form, contextType: e.target.value })}
          style={{
            width: '100%', padding: 8, borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--color-border)',
          }}
        >
          {Object.keys(TYPE_META).map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
      </div>

      <Input
        label="ID Record"
        type="number"
        value={form.contextId}
        onChange={(e) => setForm({ ...form, contextId: e.target.value })}
        placeholder="Nomor ID record sumber"
      />
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: -6, marginBottom: 12 }}>
        Backend memvalidasi bahwa record ini ada di entity Anda. Bukan teks bebas.
      </div>

      <Input
        label="Relation (opsional)"
        value={form.relation}
        onChange={(e) => setForm({ ...form, relation: e.target.value })}
        placeholder="reference"
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Menambahkan…' : 'Tambahkan'}
        </Button>
      </div>
    </Modal>
  );
}
