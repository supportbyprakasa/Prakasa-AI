import { useEffect, useMemo, useState } from 'react';
import api from '../../../api/client';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import Icon from '../../../components/Icon';
import SearchField from '../../../components/SearchField';
import Textarea from '../../../components/Textarea';
import FormActions from '../../../components/FormActions';
import EmptyState from '../../../components/EmptyState';
import { toast } from '../../../components/Toast';
import { filterSpaces, messageIdOf, plainText, sortSpaces, spaceIdFromName, spaceTypeLabel } from '../chatModel';
import { Avatar, errorText } from './parts';

const activate = (fn) => (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fn(); }
};

// Google Chat API has no native "forward": the message is re-posted as the
// user in the chosen conversation with a "Diteruskan dari …" line (server-side,
// so an uploaded attachment travels along too).
export default function ForwardDialog({ message, spaceId, spaces, onClose, onForwarded }) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (message) { setQuery(''); setTarget(null); setNote(''); } }, [message]);

  const options = useMemo(
    () => filterSpaces(sortSpaces(spaces).filter((s) => !s.isBotDm && spaceIdFromName(s.name)), query).slice(0, 50),
    [spaces, query],
  );

  const submit = async (event) => {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    try {
      await api.post(`/google-chat/spaces/${spaceId}/messages/${messageIdOf(message.name)}/forward`, {
        targetSpaceId: spaceIdFromName(target.name),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast(`Pesan diteruskan ke ${target.displayName}`, 'success');
      onForwarded?.(target);
    } catch (err) {
      toast(errorText(err, 'Gagal meneruskan pesan'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const preview = message ? plainText(message.text, message.mentions).slice(0, 200) : '';

  return (
    <Modal open={Boolean(message)} onClose={busy ? undefined : onClose} title="Teruskan pesan" size="md">
      <form className="pw-stack" onSubmit={submit}>
        {preview || message?.attachments?.length ? (
          <blockquote className="pw-gchat__quote" data-no-translate={preview ? '' : undefined}>
            {preview || `${message.attachments.length} lampiran`}
          </blockquote>
        ) : null}
        <span className="pw-gchat__label" aria-hidden="true">Teruskan ke</span>
        <SearchField
          variant="panel"
          label="Teruskan ke: cari orang atau space"
          placeholder="Cari orang atau space"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="pw-gchat__forward-list" role="listbox" aria-label="Percakapan tujuan">
          {options.length ? options.map((space) => {
            const chosen = target?.name === space.name;
            return (
              <div
                key={space.name}
                role="option"
                tabIndex={0}
                aria-selected={chosen}
                className={`pw-gchat__option pw-state-layer pw-ripple${chosen ? ' is-active' : ''}`}
                onClick={() => setTarget(space)}
                onKeyDown={activate(() => setTarget(space))}
              >
                <Avatar space={space} size="sm" />
                <span className="pw-gchat__option-text">
                  <span data-no-translate="">{space.displayName}</span>
                  <span className="pw-gchat__muted">{spaceTypeLabel(space)}</span>
                </span>
                {chosen ? <Icon name="check" size="md" className="pw-gchat__drive-check" /> : null}
              </div>
            );
          }) : <EmptyState compact icon="search_off" title="Tidak ditemukan" description="Coba kata kunci lain." />}
        </div>
        <Textarea label="Catatan (opsional)" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        <FormActions>
          <Button variant="text" type="button" onClick={onClose} disabled={busy}>Batal</Button>
          <Button type="submit" loading={busy} disabled={!target}>Teruskan pesan</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
