import { useEffect, useState } from 'react';
import api from '../../api/client';
import Modal from '../Modal';
import Button from '../Button';
import FormActions from '../FormActions';
import Input from '../Input';
import Select from '../Select';
import Textarea from '../Textarea';
import ConfirmDialog from '../ConfirmDialog';
import { toast } from '../Toast';
import { visibilityOptions } from './AIVisibilityBadge';
import './ai-components.css';

/**
 * Edit / archive / delete modal for a session.
 * Only shown when user can manage the session (owner or admin).
 */
export default function AISessionSettings({ session, onClose, onUpdated, onArchived, onDeleted }) {
  const [form, setForm] = useState({
    title: session.title || '',
    visibility: session.visibility || 'private',
    systemContext: session.systemContext || '',
    provider: session.provider || '',
  });
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    api.get('/ai-command/providers')
      .then((r) => {
        if (!cancelled) setProviders(r.data.data || []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) {
      setTitleError('Judul percakapan wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/ai-command/sessions/${session.id}`, {
        title: form.title.trim(),
        visibility: form.visibility,
        systemContext: form.systemContext || null,
        provider: form.provider || null,
      });
      toast('Percakapan diperbarui', 'success');
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
      toast('Percakapan diarsipkan', 'success');
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
      <Modal open={true} onClose={onClose} title="Pengaturan percakapan" size="md">
        <div className="pw-stack">
          <Input
            label="Judul percakapan"
            required
            value={form.title}
            error={titleError}
            onChange={(e) => { set('title', e.target.value); setTitleError(''); }}
            placeholder="Contoh: Analisa pipeline Q4"
          />

          <Select
            label="Engine AI"
            value={form.provider}
            onChange={(e) => set('provider', e.target.value)}
            disabled={providersLoading || session.generationStatus === 'generating'}
            hint="Engine dapat diganti per percakapan. Kredensial tetap tersimpan di server."
            placeholder="Bawaan server"
            options={providers.map((item) => ({
              value: item.id,
              disabled: !item.available,
              label: `${item.label}${item.model ? ` · ${item.model}` : ''}${!item.available ? ' · belum dikonfigurasi' : ''}`,
            }))}
          />

          <Select
            label="Visibilitas"
            value={form.visibility}
            onChange={(e) => set('visibility', e.target.value)}
            hint="Visibilitas mengikuti kebijakan akses server dan tidak dapat melewati izin entitas."
            options={visibilityOptions()}
          />

          <Textarea
            label="Catatan atau instruksi percakapan"
            value={form.systemContext}
            onChange={(e) => set('systemContext', e.target.value)}
            rows={4}
            placeholder="Konteks tambahan yang Anda kontrol untuk percakapan ini."
            hint="Catatan percakapan adalah konteks tambahan yang Anda kontrol, bukan izin atau otorisasi."
          />

          <FormActions align="between">
            <div className="pw-row">
              {session.status === 'active' && (
                <Button
                  variant="secondary"
                  onClick={() => setArchiveOpen(true)}
                  disabled={session.generationStatus === 'generating'}
                >
                  Arsipkan percakapan
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => setDeleteOpen(true)}
                disabled={session.generationStatus === 'generating'}
              >
                Hapus percakapan
              </Button>
            </div>
            <div className="pw-row">
              <Button variant="text" onClick={onClose}>Batal</Button>
              <Button onClick={save} loading={saving}>Simpan perubahan</Button>
            </div>
          </FormActions>
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