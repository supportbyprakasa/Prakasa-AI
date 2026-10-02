import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import Button from '../../../components/Button';
import IconButton from '../../../components/IconButton';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import { REFRESH_MS, groupMessagesByDay, mergeMessages } from '../chatModel';
import Composer from './Composer';
import MessageItem from './MessageItem';
import { errorText } from './parts';

// A thread beside the conversation (full screen on phones): the root, every
// reply, and a composer that replies in this thread.
export default function ThreadPanel({
  spaceId, root, localMessages, members, title, titleIsData = true, mineFor, onClose, onSend, onChanged, onDeleted, onReact, onForward, onCopyLink,
}) {
  const [fetched, setFetched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const scrollerRef = useRef(null);
  const stick = useRef(true);
  const threadId = root.threadName.split('/threads/')[1];

  const load = useCallback((quiet) => {
    if (document.hidden && quiet) return;
    if (!quiet) { setLoading(true); setError(null); }
    api.get(`/google-chat/spaces/${spaceId}/threads/${threadId}/messages`)
      .then((response) => setFetched(response.data.data.messages || []))
      .catch((err) => { if (!quiet) setError(errorText(err, 'Gagal memuat utas')); })
      .finally(() => { if (!quiet) setLoading(false); });
  }, [spaceId, threadId]);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Fetched thread + whatever the conversation already holds (optimistic sends, edits).
  const messages = useMemo(() => {
    const local = localMessages.filter((m) => m.threadName === root.threadName);
    const localNames = new Set(local.map((m) => m.name));
    return mergeMessages(fetched.filter((m) => !localNames.has(m.name)), local);
  }, [fetched, localMessages, root.threadName]);
  const groups = useMemo(() => groupMessagesByDay(messages), [messages]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const handleDeleted = (name) => {
    setFetched((list) => list.filter((m) => m.name !== name));
    onDeleted(name);
    if (name === root.name) onClose();
  };

  return (
    <aside className="pw-gchat__thread" aria-label="Utas">
      <header className="pw-gchat__thread-head">
        <div className="pw-gchat__conversation-title">
          <h2>Utas</h2>
          <span data-no-translate={titleIsData ? '' : undefined}>{title}</span>
        </div>
        <IconButton label="Tutup utas" icon="close" onClick={onClose} />
      </header>
      <div className="pw-gchat__messages" ref={scrollerRef} onScroll={onScroll}>
        {loading && !messages.length ? <LoadingState label="Memuat utas…" /> : null}
        {error && !messages.length ? (
          <EmptyState tone="error" compact title="Gagal memuat utas" description={error} action={<Button variant="text" onClick={() => load(false)}>Coba lagi</Button>} />
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className="pw-gchat__day">
            <div className="pw-gchat__day-label" role="separator"><span>{group.label}</span></div>
            <ul className="pw-gchat__message-list">
              {group.items.map(({ message, showHeader }) => (
                <MessageItem
                  key={message.name}
                  spaceId={spaceId}
                  message={message}
                  showHeader={showHeader}
                  inThread
                  mine={mineFor(message.name)}
                  onChanged={(updated) => { setFetched((list) => list.map((m) => (m.name === updated.name ? updated : m))); onChanged(updated); }}
                  onDeleted={handleDeleted}
                  onReact={(msg, emoji) => onReact(msg, emoji, (name, update) => setFetched((list) => list.map((m) => (m.name === name ? update(m) : m))))}
                  onForward={onForward}
                  onCopyLink={onCopyLink}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Composer
        compact
        title={title}
        members={members}
        placeholder="Balas di utas"
        onSubmit={(payload) => { stick.current = true; return onSend({ ...payload, threadName: root.threadName }); }}
      />
    </aside>
  );
}
