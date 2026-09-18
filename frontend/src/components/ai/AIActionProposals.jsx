import { useEffect, useState } from 'react';
import { Plus, Check, X, ClipboardCheck } from 'lucide-react';
import api from '../../api/client';
import Button from '../Button';
import Badge from '../Badge';
import Input from '../Input';
import Modal from '../Modal';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';

const ACTION_LABEL = {
  create_task: 'Buat Task',
  create_approval: 'Buat Approval',
  create_document: 'Buat Dokumen',
  create_calendar_event: 'Buat Event',
  update_task: 'Ubah Task',
  send_notification: 'Kirim Notifikasi',
};

const STATUS_TONE = {
  proposed: 'info',
  confirmed: 'warning',
  rejected: 'error',
  executed: 'success',
  failed: 'error',
  expired: 'default',
};

const STATUS_LABEL = {
  proposed: 'Menunggu Konfirmasi',
  confirmed: 'Dikonfirmasi',
  rejected: 'Ditolak',
  executed: 'Dieksekusi',
  failed: 'Gagal',
  expired: 'Kedaluwarsa',
};

export default function AIActionProposals({ sessionId, session, refreshKey }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const canConfirm = (user?.permissions || []).includes('ai_command.action.confirm');
  const canPropose = (user?.permissions || []).includes('ai_command.action.propose');
  const isOwner = session && Number(session.ownerUserId) === Number(user?.id);
  const canManage = isOwner;
  const archived = session?.status === 'archived';

  const load = async () => {
    if (!sessionId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get(`/ai-command/sessions/${sessionId}/actions`);
      setRows(r.data.data || []);
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat actions', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sessionId, refreshKey]);

  const confirm = async () => {
    if (!confirmTarget) return;
    try {
      const r = await api.post(`/ai-command/actions/${confirmTarget.id}/confirm`);
      const data = r.data.data || {};
      if (data.status === 'executed' && data.executionResult?.taskId) {
        toast(`Task #${data.executionResult.taskId} berhasil dibuat`, 'success');
      } else if (data.executionDeferred) {
        toast('Dikonfirmasi — menunggu executor', 'info');
      } else {
        toast('Proposal dikonfirmasi', 'success');
      }
      setConfirmTarget(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal konfirmasi', 'error');
    }
  };

  const reject = async (reason) => {
    if (!rejectTarget) return;
    try {
      await api.post(`/ai-command/actions/${rejectTarget.id}/reject`, { reason: reason || null });
      toast('Proposal ditolak', 'success');
      setRejectTarget(null);
      load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menolak', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: 12, borderBottom: '1px solid var(--color-border)',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Action Proposals</div>
        {canPropose && canManage && !archived && (
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Plus size={12} /> Proposal
          </Button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          marginBottom: 8, lineHeight: 1.5,
        }}>
          AI tidak mengeksekusi aksi secara otomatis. Setiap proposal harus dikonfirmasi pengguna.
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Memuat…</div>
        )}

        {!loading && !rows.length && (
          <div style={{
            padding: 20, textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            Belum ada action proposal.
          </div>
        )}

        {!loading && rows.map((p) => (
          <ActionRow
            key={p.id}
            proposal={p}
            canConfirm={canConfirm}
            onConfirm={() => setConfirmTarget(p)}
            onReject={() => setRejectTarget(p)}
          />
        ))}
      </div>

      {createOpen && (
        <CreateActionModal
          sessionId={sessionId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(); }}
        />
      )}

      {confirmTarget && (
        <ConfirmModal
          proposal={confirmTarget}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={confirm}
        />
      )}

      {rejectTarget && (
        <RejectModal
          proposal={rejectTarget}
          onCancel={() => setRejectTarget(null)}
          onReject={reject}
        />
      )}
    </div>
  );
}

function ActionRow({ proposal, canConfirm, onConfirm, onReject }) {
  const label = ACTION_LABEL[proposal.actionType] || proposal.actionType;
  const tone = STATUS_TONE[proposal.status] || 'default';
  const statusLabel = STATUS_LABEL[proposal.status] || proposal.status;

  // Display rule: only mark executed when actually executed
  const executedOk = proposal.status === 'executed';
  const deferredConfirmed = proposal.status === 'confirmed' &&
    proposal.executionResult?.deferred === true;

  return (
    <div style={{
      padding: 10, marginBottom: 8,
      background: '#f8fafc',
      border: '1px solid var(--color-border)',
      borderRadius: 8, fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClipboardCheck size={14} />
          <b>{label}</b>
        </div>
        <Badge tone={tone}>{statusLabel}</Badge>
      </div>

      <div style={{ marginTop: 6, color: 'var(--color-text-muted)' }}>
        {proposal.payload?.title && (
          <div><b>{proposal.payload.title}</b></div>
        )}
        {proposal.payload?.description && (
          <div style={{ marginTop: 2 }}>
            {String(proposal.payload.description).slice(0, 140)}
          </div>
        )}
      </div>

      {executedOk && proposal.executionResult?.taskId && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-success)' }}>
          Task berhasil dibuat — <b>#{proposal.executionResult.taskId}</b>
        </div>
      )}

      {deferredConfirmed && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-warning)' }}>
          Dikonfirmasi — menunggu executor
        </div>
      )}

      {proposal.status === 'failed' && proposal.failureMessage && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-error)' }}>
          {proposal.failureMessage}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
        {new Date(proposal.createdAt).toLocaleString('id-ID')}
      </div>

      {proposal.status === 'proposed' && canConfirm && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Button onClick={onConfirm}><Check size={12} /> Konfirmasi</Button>
          <Button variant="danger" onClick={onReject}><X size={12} /> Tolak</Button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Confirm modal
   ============================================================ */

function ConfirmModal({ proposal, onCancel, onConfirm }) {
  const isDeferred = proposal.actionType !== 'create_task';
  return (
    <Modal open={true} onClose={onCancel} title="Konfirmasi Proposal" maxWidth={480}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <div>
          Aksi: <b>{ACTION_LABEL[proposal.actionType] || proposal.actionType}</b>
        </div>
        {proposal.payload?.title && (
          <div style={{ marginTop: 6 }}>
            <b>{proposal.payload.title}</b>
          </div>
        )}
        {isDeferred && (
          <div style={{
            marginTop: 12, padding: 10,
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, color: '#92400e', fontSize: 12,
          }}>
            Executor untuk aksi ini belum tersedia. Proposal akan ditandai
            <b> dikonfirmasi</b> dan menunggu eksekutor.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button onClick={onConfirm}>Konfirmasi</Button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Reject modal
   ============================================================ */

function RejectModal({ proposal, onCancel, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={true} onClose={onCancel} title="Tolak Proposal" maxWidth={480}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        Menolak: <b>{ACTION_LABEL[proposal.actionType] || proposal.actionType}</b>
        {proposal.payload?.title && <> — {proposal.payload.title}</>}
      </div>
      <Input
        label="Alasan (opsional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Alasan penolakan"
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button variant="danger" onClick={() => onReject(reason)}>Tolak</Button>
      </div>
    </Modal>
  );
}

/* ============================================================
   Create action proposal modal (create_task only)
   ============================================================ */

function CreateActionModal({ sessionId, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'normal',
    dueDate: '',
    departmentId: '',
    boardId: '',
    columnId: '',
    assigneeId: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) {
      toast('Judul wajib', 'error');
      return;
    }
    const payload = { title: form.title.trim() };
    if (form.description) payload.description = form.description;
    if (form.priority) payload.priority = form.priority;
    if (form.dueDate) payload.dueDate = form.dueDate;
    if (form.departmentId) payload.departmentId = Number(form.departmentId);
    if (form.boardId) payload.boardId = Number(form.boardId);
    if (form.columnId) payload.columnId = Number(form.columnId);
    if (form.assigneeId) payload.assigneeId = Number(form.assigneeId);

    setSaving(true);
    try {
      await api.post(`/ai-command/sessions/${sessionId}/actions`, {
        actionType: 'create_task',
        payload,
      });
      toast('Proposal dibuat', 'success');
      onCreated();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal membuat', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Action Proposal Baru" width={520}>
      <div style={{
        padding: 10, marginBottom: 12,
        background: '#f8fafc', border: '1px solid var(--color-border)',
        borderRadius: 8, fontSize: 12, color: 'var(--color-text-muted)',
      }}>
        Hanya <b>create_task</b> yang memiliki eksekutor pada fase ini.
      </div>

      <Input
        label="Judul Task *"
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Prioritas</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            style={{
              width: '100%', padding: 8, borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <Input
          label="Due Date"
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label="Department ID (opsional)"
          type="number"
          value={form.departmentId}
          onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
        />
        <Input
          label="Assignee User ID (opsional)"
          type="number"
          value={form.assigneeId}
          onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label="Board ID (opsional)"
          type="number"
          value={form.boardId}
          onChange={(e) => setForm({ ...form, boardId: e.target.value })}
        />
        <Input
          label="Column ID (opsional)"
          type="number"
          value={form.columnId}
          onChange={(e) => setForm({ ...form, columnId: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Buat Proposal'}
        </Button>
      </div>
    </Modal>
  );
}