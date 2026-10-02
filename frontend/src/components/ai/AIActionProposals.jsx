import { noTranslate } from '../../i18n/NoTranslate';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../Banner';
import Button from '../Button';
import EmptyState, { LoadingState } from '../EmptyState';
import FormActions from '../FormActions';
import Icon from '../Icon';
import Input from '../Input';
import Modal from '../Modal';
import Select from '../Select';
import StatusBadge from '../StatusBadge';
import Textarea from '../Textarea';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import './ai-components.css';
import { dateLocale } from '../../i18n/language.js';

const ACTION_LABEL = {
  create_task: 'Buat tugas',
  create_approval: 'Buat approval',
  create_document: 'Buat dokumen',
  create_calendar_event: 'Buat acara',
  update_task: 'Ubah tugas',
  send_notification: 'Kirim notifikasi',
};

// Proposal statuses mapped to their statusTone() equivalent (§3.4), so the
// badge tone comes from the one shared map while the wording stays local.
const STATUS_TONE_KEY = {
  proposed: 'pending_approval',
  confirmed: 'processing',
  rejected: 'rejected',
  executed: 'completed',
  failed: 'failed',
  expired: 'expired',
};

const STATUS_LABEL = {
  proposed: 'Menunggu konfirmasi',
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
      toast(e.response?.data?.error?.message || 'Gagal memuat proposal aksi', 'error');
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
        toast(`Tugas #${data.executionResult.taskId} berhasil dibuat`, 'success');
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
    <div className="ai-action-panel">
      <div className="ai-support-section-header">
        <h3 className="ai-support-section-title">Proposal aksi</h3>
        {canPropose && canManage && !archived && (
          <Button variant="secondary" icon="add" onClick={() => setCreateOpen(true)}>
            Buat proposal
          </Button>
        )}
      </div>

      <div className="ai-support-section-body">
        <div className="ai-support-helper">
          AI tidak mengeksekusi aksi secara otomatis. Setiap proposal harus dikonfirmasi pengguna.
        </div>

        {loading && <LoadingState compact />}

        {!loading && !rows.length && (
          <EmptyState compact icon="assignment" description="Belum ada proposal aksi." />
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
  const statusLabel = STATUS_LABEL[proposal.status] || proposal.status;

  // Display rule: only mark executed when actually executed
  const executedOk = proposal.status === 'executed';
  const deferredConfirmed = proposal.status === 'confirmed' &&
    proposal.executionResult?.deferred === true;

  return (
    <div className="ai-support-card">
      <div className="pw-row pw-row--between pw-row--start pw-row--nowrap ai-proposal-head">
        <div className="pw-row pw-row--nowrap ai-proposal-label">
          <Icon name="assignment_turned_in" size="sm" />
          <span className="ai-proposal-name">{label}</span>
        </div>
        <StatusBadge status={STATUS_TONE_KEY[proposal.status] || proposal.status} label={statusLabel} />
      </div>

      <div className="ai-proposal-body">
        {proposal.payload?.title && (
          <div {...noTranslate}><b>{proposal.payload.title}</b></div>
        )}
        {proposal.payload?.description && (
          <div {...noTranslate}>
            {String(proposal.payload.description).slice(0, 140)}
          </div>
        )}
      </div>

      {executedOk && proposal.executionResult?.taskId && (
        <div className="ai-proposal-meta is-success">
          Tugas berhasil dibuat — <b>#{proposal.executionResult.taskId}</b>
        </div>
      )}

      {deferredConfirmed && (
        <div className="ai-proposal-meta is-warning">
          Dikonfirmasi — menunggu executor
        </div>
      )}

      {proposal.status === 'failed' && proposal.failureMessage && (
        <div className="ai-proposal-meta is-error">
          {proposal.failureMessage}
        </div>
      )}

      <div className="ai-proposal-meta">
        {new Date(proposal.createdAt).toLocaleString(dateLocale())}
      </div>

      {proposal.status === 'proposed' && canConfirm && (
        <div className="pw-row ai-proposal-actions">
          <Button variant="danger" icon="close" onClick={onReject}>Tolak</Button>
          <Button icon="check" onClick={onConfirm}>Konfirmasi</Button>
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
    <Modal open={true} onClose={onCancel} title="Konfirmasi proposal" size="sm">
      <div className="ai-modal-body">
        <div>
          Aksi: <b>{ACTION_LABEL[proposal.actionType] || proposal.actionType}</b>
        </div>
        {proposal.payload?.title && (
          <div {...noTranslate}>
            <b>{proposal.payload.title}</b>
          </div>
        )}
        {isDeferred && (
          <Banner tone="warning">
            Eksekutor untuk aksi ini belum tersedia. Proposal akan ditandai
            <b> dikonfirmasi</b> dan menunggu eksekutor.
          </Banner>
        )}
      </div>
      <FormActions>
        <Button variant="text" onClick={onCancel}>Batal</Button>
        <Button onClick={onConfirm}>Konfirmasi proposal</Button>
      </FormActions>
    </Modal>
  );
}

/* ============================================================
   Reject modal
   ============================================================ */

function RejectModal({ proposal, onCancel, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={true} onClose={onCancel} title="Tolak proposal" size="sm">
      <div className="pw-stack">
        <div className="ai-modal-body">
          Menolak: <b>{ACTION_LABEL[proposal.actionType] || proposal.actionType}</b>
          {proposal.payload?.title && <> — <span {...noTranslate}>{proposal.payload.title}</span></>}
        </div>
        <Input
          label="Alasan (opsional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Contoh: sudah ditangani manual"
        />
        <FormActions>
          <Button variant="text" onClick={onCancel}>Batal</Button>
          <Button variant="danger" onClick={() => onReject(reason)}>Tolak proposal</Button>
        </FormActions>
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
  const [titleError, setTitleError] = useState('');

  const submit = async () => {
    if (!form.title.trim()) {
      setTitleError('Judul tugas wajib diisi.');
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
      toast(e.response?.data?.error?.message || 'Gagal membuat proposal', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Proposal aksi baru" size="md">
      <div className="pw-stack">
        <Banner tone="info">
          Pada fase ini hanya aksi <b>Buat tugas</b> yang bisa dijalankan setelah dikonfirmasi.
        </Banner>

        <Input
          label="Judul tugas"
          required
          value={form.title}
          error={titleError}
          onChange={(e) => { setForm({ ...form, title: e.target.value }); setTitleError(''); }}
        />
        <Textarea
          label="Deskripsi"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
        />

        <div className="pw-form-grid">
          <Select
            label="Prioritas"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={[
              { value: 'low', label: 'Rendah' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'Tinggi' },
              { value: 'urgent', label: 'Mendesak' },
            ]}
          />
          <Input
            label="Tenggat"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
          <Input
            label="ID divisi (opsional)"
            type="number"
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          />
          <Input
            label="ID pengguna penerima tugas (opsional)"
            type="number"
            value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
          />
          <Input
            label="ID papan (opsional)"
            type="number"
            value={form.boardId}
            onChange={(e) => setForm({ ...form, boardId: e.target.value })}
          />
          <Input
            label="ID kolom (opsional)"
            type="number"
            value={form.columnId}
            onChange={(e) => setForm({ ...form, columnId: e.target.value })}
          />
        </div>
        <FormActions>
          <Button variant="text" onClick={onClose}>Batal</Button>
          <Button onClick={submit} loading={saving}>Buat proposal</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
