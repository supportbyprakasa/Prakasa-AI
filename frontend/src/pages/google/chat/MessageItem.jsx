import { memo, useMemo, useState } from 'react';
import api from '../../../api/client';
import ActionMenu from '../../../components/ActionMenu';
import Button from '../../../components/Button';
import Chip from '../../../components/Chip';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import Textarea from '../../../components/Textarea';
import { toast } from '../../../components/Toast';
import {
  MAX_TEXT_LENGTH, decodeMentions, encodeMentions, formatTime, parseChatText, plainText, summarizeReactions,
} from '../chatModel';
import Attachments from './Attachments';
import DriveChips from './DriveChips';
import MessageCards from './MessageCards';
import EmojiPicker from './EmojiPicker';
import { Avatar, RichNodes, errorText } from './parts';

function messageId(name) {
  return String(name).split('/messages/')[1];
}

function MessageItem({
  spaceId, message, showHeader, canThread, replyCount = 0, inThread = false, mine = {},
  onOpenThread, onQuote, onChanged, onDeleted, onReact, onForward, onCopyLink, highlighted = false,
}) {
  const nodes = useMemo(() => parseChatText(message.text, message.mentions), [message.text, message.mentions]);
  const reactions = useMemo(() => summarizeReactions(message.reactions, mine), [message.reactions, mine]);
  const [editing, setEditing] = useState(null); // { text, picked }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const own = Boolean(message.sender?.isMe);
  const name = own ? 'Anda' : (message.sender?.displayName || 'Pengguna');
  const actionable = !message.pending && !message.deleted;

  const startEdit = () => setEditing(decodeMentions(message.text, message.mentions));

  const saveEdit = async () => {
    const text = encodeMentions(editing.text, editing.picked);
    if (!text.trim()) return;
    if (text === message.text) { setEditing(null); return; }
    setSaving(true);
    try {
      const response = await api.patch(`/google-chat/spaces/${spaceId}/messages/${messageId(message.name)}`, { text });
      onChanged?.({ ...message, ...response.data.data, reactions: message.reactions, mentions: { ...message.mentions, ...response.data.data.mentions } });
      setEditing(null);
    } catch (err) {
      toast(errorText(err, 'Gagal mengubah pesan'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/google-chat/spaces/${spaceId}/messages/${messageId(message.name)}`);
      setConfirmDelete(false);
      onDeleted?.(message.name);
      toast('Pesan dihapus', 'success');
    } catch (err) {
      toast(errorText(err, 'Gagal menghapus pesan'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    // tabIndex -1: a tap focuses the message so its actions show on touch screens.
    <li
      tabIndex={-1}
      data-message={message.name}
      className={`pw-gchat__message${showHeader ? ' has-header' : ''}${message.pending ? ' is-pending' : ''}${highlighted ? ' is-highlighted' : ''}`}
    >
      <div className="pw-gchat__message-gutter">
        {showHeader ? <Avatar person={message.sender} /> : <span className="pw-gchat__hover-time">{formatTime(message.createTime)}</span>}
      </div>
      <div className="pw-gchat__message-body">
        {showHeader ? (
          <div className="pw-gchat__message-head">
            <span className="pw-gchat__sender" data-no-translate={!own && message.sender?.displayName ? '' : undefined}>{name}</span>
            <time className="pw-gchat__time" dateTime={message.createTime || undefined}>{message.pending ? 'Mengirim…' : formatTime(message.createTime)}</time>
            {message.lastUpdateTime && message.lastUpdateTime !== message.createTime && !message.pending ? <span className="pw-gchat__time">· Diedit</span> : null}
          </div>
        ) : null}
        {message.threadReply && !inThread ? (
          <span className="pw-gchat__thread-tag"><Icon name="subdirectory_arrow_right" size="sm" />Balasan di utas</span>
        ) : null}
        {message.quoted ? (
          <blockquote className="pw-gchat__quote" data-no-translate={plainText(message.quoted.text) ? '' : undefined}>{plainText(message.quoted.text) || 'Pesan yang dikutip'}</blockquote>
        ) : null}
        {message.deleted ? <p className="pw-gchat__text is-muted">Pesan ini telah dihapus</p> : null}
        {!message.deleted && editing ? (
          <div className="pw-gchat__edit">
            <Textarea
              aria-label="Ubah pesan"
              rows={2}
              maxLength={MAX_TEXT_LENGTH}
              value={editing.text}
              autoFocus
              onChange={(event) => setEditing((e) => ({ ...e, text: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(null);
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); saveEdit(); }
              }}
            />
            <div className="pw-gchat__edit-actions">
              <Button variant="text" onClick={() => setEditing(null)} disabled={saving}>Batal</Button>
              <Button onClick={saveEdit} loading={saving} disabled={!editing.text.trim()}>Simpan perubahan</Button>
            </div>
          </div>
        ) : null}
        {/* A div, not a <p>: the text may hold a code block (<pre>). */}
        {!message.deleted && !editing && nodes.length ? <div data-no-translate="" className="pw-gchat__text"><RichNodes nodes={nodes} /></div> : null}
        {!message.deleted && message.cards?.length ? <MessageCards cards={message.cards} /> : null}
        {!message.deleted && message.hasCards && !message.cards?.length ? <p className="pw-gchat__text is-muted">[Kartu aplikasi — tidak dapat ditampilkan di sini]</p> : null}
        {!message.deleted ? <DriveChips message={message} /> : null}
        <Attachments spaceId={spaceId} message={message} />
        {reactions.length ? (
          <div className="pw-gchat__reactions">
            {reactions.map((reaction) => (
              <Chip
                key={reaction.emoji}
                selected={reaction.mine}
                aria-label={`${reaction.emoji} ${reaction.count} reaksi${reaction.mine ? ', termasuk Anda' : ''}`}
                onClick={() => actionable && onReact?.(message, reaction.emoji)}
              >
                {reaction.emoji} {reaction.count}
              </Chip>
            ))}
          </div>
        ) : null}
        {canThread && !inThread && replyCount > 0 ? (
          <Button variant="text" icon="forum" className="pw-gchat__replies" onClick={() => onOpenThread?.(message)}>
            {`${replyCount} balasan`}
          </Button>
        ) : null}
      </div>
      {actionable && !editing ? (
        <div className="pw-gchat__message-actions">
          <EmojiPicker onPick={(emoji) => onReact?.(message, emoji)} />
          {canThread && !inThread && message.threadName ? (
            <IconButton size="sm" label="Balas di utas" icon="reply" onClick={() => onOpenThread?.(message)} />
          ) : null}
          {onQuote ? <IconButton size="sm" label="Kutip" icon="format_quote" onClick={() => onQuote(message)} /> : null}
          <ActionMenu
            size="sm"
            label="Aksi lainnya"
            items={[
              onForward ? { label: 'Teruskan pesan', icon: 'forward', onClick: () => onForward(message) } : null,
              onCopyLink ? { label: 'Salin link pesan', icon: 'link', onClick: () => onCopyLink(message) } : null,
              own && !message.hasCards ? { label: 'Ubah pesan', icon: 'edit', onClick: startEdit } : null,
              own ? { label: 'Hapus pesan', icon: 'delete', tone: 'danger', onClick: () => setConfirmDelete(true) } : null,
            ]}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Hapus pesan?"
        message="Pesan ini akan dihapus untuk semua orang di percakapan."
        confirmLabel="Hapus pesan"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  );
}

export default memo(MessageItem);
