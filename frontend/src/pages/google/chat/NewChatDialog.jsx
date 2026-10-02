import { useEffect, useState } from 'react';
import api from '../../../api/client';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import Segmented from '../../../components/Segmented';
import Input from '../../../components/Input';
import Textarea from '../../../components/Textarea';
import FormActions from '../../../components/FormActions';
import { toast } from '../../../components/Toast';
import PeoplePicker from './PeoplePicker';
import { errorText } from './parts';

export const NEW_CHAT_MODES = [
  { mode: 'DIRECT_MESSAGE', label: 'Pesan langsung', icon: 'chat_bubble' },
  { mode: 'GROUP_CHAT', label: 'Grup chat', icon: 'group' },
  { mode: 'SPACE', label: 'Space', icon: 'groups' },
];

const HINTS = {
  DIRECT_MESSAGE: 'Percakapan pribadi dengan satu orang. Jika sudah ada, percakapan lama akan dibuka.',
  GROUP_CHAT: 'Percakapan tanpa nama dengan beberapa orang (minimal 2).',
  SPACE: 'Space bernama untuk tim atau topik. Anda menjadi pengelola space.',
};

export default function NewChatDialog({ open, initialMode = 'DIRECT_MESSAGE', onClose, onCreated }) {
  const [mode, setMode] = useState(initialMode);
  const [people, setPeople] = useState([]);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setPeople([]);
    setDisplayName('');
    setDescription('');
    setNameError(null);
  }, [open, initialMode]);

  const max = mode === 'DIRECT_MESSAGE' ? 1 : 20;
  const canSubmit = mode === 'DIRECT_MESSAGE' ? people.length === 1
    : mode === 'GROUP_CHAT' ? people.length >= 2
      : displayName.trim().length > 0;

  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'SPACE' && !displayName.trim()) { setNameError('Nama space wajib diisi'); return; }
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body = { type: mode, emails: people.map((p) => p.email) };
      if (mode === 'SPACE') Object.assign(body, { displayName: displayName.trim(), description: description.trim() });
      const response = await api.post('/google-chat/spaces', body);
      const { space, created } = response.data.data;
      toast(created ? 'Percakapan dibuat' : 'Membuka percakapan yang sudah ada', 'success');
      onCreated(space);
    } catch (err) {
      toast(errorText(err, 'Gagal membuat percakapan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} title="Chat baru" size="md">
      <form className="pw-stack" noValidate onSubmit={submit}>
        <Segmented
          label="Jenis percakapan"
          className="pw-gchat__mode"
          options={NEW_CHAT_MODES.map(({ mode: value, label, icon }) => ({ value, label, icon }))}
          value={mode}
          onChange={(value) => { setMode(value); setPeople((p) => (value === 'DIRECT_MESSAGE' ? p.slice(0, 1) : p)); }}
        />
        <p className="pw-gchat__muted">{HINTS[mode]}</p>
        {mode === 'SPACE' ? (
          <>
            <Input
              label="Nama space"
              required
              maxLength={128}
              value={displayName}
              error={nameError}
              onChange={(event) => { setDisplayName(event.target.value); setNameError(null); }}
              placeholder="mis. Tim Gudang Surabaya"
            />
            <Textarea
              label="Deskripsi"
              rows={2}
              maxLength={150}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              hint={`${description.length}/150`}
            />
          </>
        ) : null}
        <PeoplePicker
          key={mode}
          label={mode === 'DIRECT_MESSAGE' ? 'Kirim pesan ke' : mode === 'GROUP_CHAT' ? 'Anggota grup' : 'Tambahkan anggota (opsional)'}
          selected={people}
          onChange={setPeople}
          max={max}
          autoFocus={mode !== 'SPACE'}
        />
        <FormActions>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          {/* A space without a name gets a field error instead of a disabled button. */}
          <Button type="submit" loading={saving} disabled={mode !== 'SPACE' && !canSubmit}>
            {mode === 'DIRECT_MESSAGE' ? 'Mulai chat' : mode === 'GROUP_CHAT' ? 'Buat grup' : 'Buat space'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
