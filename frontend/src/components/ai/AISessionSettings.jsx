import { useState } from 'react';
import api from '../../api/client';
import Modal from '../Modal';
import Button from '../Button';
import Input from '../Input';
import ConfirmDialog from '../ConfirmDialog';
import { toast } from '../Toast';
import { visibilityHelper } from './AIVisibilityBadge';

/**
 * Edit / archive / delete modal for a session.
 * Only shown when user can manage the session (owner or admin).
 */
export default function AISessionSettings({ session, onClose, onUpdated, onArchived, onDeleted }) {
  const [form, setForm] = useState({
    title: session.title || '',
    visibility: session.visibility || 'private',
    systemContext: session.systemContext || '',
  });
  const [saving, setSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) {
      toast('Judul percakapan wajib', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/ai-command/sessions/${session.id}`, {
        title: form.title.trim(),
        visibility: form.visibility,
        systemContext: form.systemContext || null,
      });
      toast('Session diperbarui', 'success');
      onUpdated?.();
      onClose?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menyimpan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    try {
      await api.post(`/ai-command/sessions/${session.id}/archive`);
      toast('Session diarsipkan', 'success');
      setArchiveOpen(false);
      onArchived?.();
      onClose?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal mengarsipkan', 'error');
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/ai-command/sessions/${session.id}`);
      toast('Percakapan dihapus', 'success');
      setDeleteOpen(false);
      onDeleted?.();
      onClose?.();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal menghapus', 'error');
    }
  };

  return (
    <>
      <Modal open={true} onClose={onClose} title="Pengaturan Session" maxWidth={560}>
        <Input
          label="Judul Percakapan"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Judul singkat"
        />

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Visibilitas</label>
          <select
            value={form.visibility}
            onChange={(e) => set('visibility', e.target.value)}
            style={{
              width: '100%', padding: 8, borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <option value="private">Private — {visibilityHelper('private')}</option>
            <option value="department">Department — {visibilityHelper('department')}</option>
            <option value="entity">Entity — {visibilityHelper('entity')}</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Visibilitas mengikuti kebijakan akses backend. Tidak dapat mem-bypass izin entity.
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
            Catatan / Instruksi Session
          </label>
          <textarea
            value={form.systemContext}
            onChange={(e) => set('systemContext', e.target.value)}
            rows={4}
            placeholder="Konteks tambahan yang Anda kontrol untuk percakapan ini."
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid var(--color-border)', fontSize: 13,
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Catatan session adalah konteks tambahan yang Anda kontrol. Ini bukan permission atau otorisasi.
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginTop: 20,
          paddingTop: 12, borderTop: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {session.status === 'active' && (
              <Button
                variant="secondary"
                onClick={() => setArchiveOpen(true)}
                disabled={session.generationStatus === 'generating'}
              >
                Arsipkan
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => setDeleteOpen(true)}
              disabled={session.generationStatus === 'generating'}
            >
              Hapus
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Batal</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        title="Arsipkan percakapan?"
        message="Setelah diarsipkan, percakapan tidak dapat menerima pesan baru. Riwayat tetap dapat dilihat."
        confirmLabel="Ya, arsipkan"
        tone="warning"
        onConfirm={archive}
        onClose={() => setArchiveOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus percakapan ini?"
        message="Riwayat tidak akan tampil lagi. Tindakan ini tidak dapat dibatalkan dari antarmuka."
        confirmLabel="Ya, hapus"
        tone="danger"
        onConfirm={remove}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}