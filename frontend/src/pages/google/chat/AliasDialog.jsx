import { useState } from 'react';
import api from '../../../api/client';
import Modal from '../../../components/Modal';
import Input from '../../../components/Input';
import Button from '../../../components/Button';
import FormActions from '../../../components/FormActions';
import { toast } from '../../../components/Toast';
import { spaceIdFromName } from '../chatModel';

// A private label for a DM / group chat — mainly for conversations whose partner's
// Google account was deleted (Google no longer tells anyone their name).
export default function AliasDialog({ space, onClose, onSaved }) {
  const [value, setValue] = useState(space?.alias || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = spaceIdFromName(space?.name);

  const save = async (alias) => {
    if (alias !== null && !alias.trim()) { setError('Nama tampilan wajib diisi'); return; }
    setBusy(true);
    try {
      const { data } = await api.put(`/google-chat/spaces/${id}/alias`, { alias });
      const saved = data.data.alias;
      const original = space.originalName || space.displayName;
      onSaved({
        ...space,
        alias: saved,
        displayName: saved || original,
        originalName: saved ? original : undefined,
      });
      toast(saved ? 'Nama tampilan disimpan' : 'Nama tampilan dihapus', 'success');
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Nama tampilan gagal disimpan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={busy ? undefined : onClose} size="sm" title="Beri nama percakapan">
      <form className="pw-stack" noValidate onSubmit={(event) => { event.preventDefault(); save(value.trim()); }}>
        <p className="pw-gchat__dialog-text">
          {space?.partnerDeleted || space?.originalName === 'Pengguna dihapus'
            ? 'Akun Google lawan bicara ini sudah dihapus, sehingga Google tidak lagi memberi tahu namanya. Isi nama mereka agar percakapan ini mudah dikenali.'
            : 'Nama ini hanya terlihat oleh Anda di Prakasa Workspace — tidak mengubah apa pun di Google Chat.'}
        </p>
        <Input
          label="Nama tampilan"
          value={value}
          maxLength={120}
          autoFocus
          required
          error={error}
          onChange={(event) => { setValue(event.target.value); setError(''); }}
          placeholder="mis. Budi Santoso"
        />
        <FormActions align={space?.alias ? 'between' : 'end'}>
          {space?.alias ? (
            <Button type="button" variant="text" onClick={() => save(null)} disabled={busy}>Hapus nama</Button>
          ) : null}
          <div className="pw-row">
            <Button type="button" variant="text" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" loading={busy}>Simpan nama</Button>
          </div>
        </FormActions>
      </form>
    </Modal>
  );
}
