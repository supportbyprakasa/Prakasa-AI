import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AliasDialog from './AliasDialog';
import api from '../../../api/client';
import ActionMenu from '../../../components/ActionMenu';
import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import SearchField from '../../../components/SearchField';
import Spinner from '../../../components/Spinner';
import TabBar from '../../../components/TabBar';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import { toast } from '../../../components/Toast';
import {
  MAX_TEXT_LENGTH, REFRESH_MS, accessSummary, applyReactionToggle, buildDriveMessage, groupMessagesByDay, mergeMessages,
  messageLink, searchMessages, spaceTabs, spaceTypeLabel, threadView,
} from '../chatModel';
import ProjectTracker from '../../projects/ProjectTracker';
import Composer from './Composer';
import DriveAccessDialog from './DriveAccessDialog';
import FilesTab from './FilesTab';
import ForwardDialog from './ForwardDialog';
import MessageItem from './MessageItem';
import SpaceDetails from './SpaceDetails';
import ThreadPanel from './ThreadPanel';
import { Avatar, errorText } from './parts';

const MESSAGE_PAGE_SIZE = 50;
const EMPTY = {};
const TAB_LABELS = { chat: 'Chat', files: 'File', tasks: 'Tugas' };
const FOCUS_PAGES = 3; // older pages fetched to find a linked message

export default function Conversation({ spaceId, space, spaces = [], focusMessageId, onSent, onRename, onSpaceChanged, onGone }) {
  const [aliasOpen, setAliasOpen] = useState(false);
  const spaceName = `spaces/${spaceId}`;
  const [messages, setMessages] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const [members, setMembers] = useState([]);
  const [quoted, setQuoted] = useState(null);
  const [threadRoot, setThreadRoot] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetLink, setMeetLink] = useState(null);
  const [mine, setMine] = useState({}); // message name → { emoji: true|false } toggled this session
  const [tab, setTab] = useState('chat');
  const [forwarding, setForwarding] = useState(null);
  const [accessPrompt, setAccessPrompt] = useState(null); // { check, resolve }
  const [highlight, setHighlight] = useState(null);
  const focusTries = useRef(0);
  const scrollerRef = useRef(null);
  const scrollIntent = useRef(null); // 'bottom' | 'stick' | { height, top }
  const activeSpace = useRef(spaceName);
  activeSpace.current = spaceName;

  const fetchPage = useCallback((pageToken) => api.get(`/google-chat/spaces/${spaceId}/messages`, {
    params: { pageSize: MESSAGE_PAGE_SIZE, ...(pageToken ? { pageToken } : {}) },
  }).then((response) => response.data.data), [spaceId]);

  const loadLatest = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPage().then((data) => {
      if (activeSpace.current !== spaceName) return;
      scrollIntent.current = 'bottom';
      setMessages((current) => mergeMessages(current.filter((m) => m.pending), data.messages || []));
      setNextPageToken(data.nextPageToken || null);
    }).catch((err) => {
      if (activeSpace.current === spaceName) setError(errorText(err, 'Gagal memuat pesan'));
    }).finally(() => {
      if (activeSpace.current === spaceName) setLoading(false);
    });
  }, [fetchPage, spaceName]);

  const loadMembers = useCallback(() => {
    api.get(`/google-chat/spaces/${spaceId}/details`)
      .then((response) => { if (activeSpace.current === spaceName) setMembers(response.data.data.members || []); })
      .catch(() => { /* mentions just won't suggest anyone */ });
  }, [spaceId, spaceName]);

  useEffect(() => { loadLatest(); loadMembers(); }, [loadLatest, loadMembers]);

  // Quiet refresh of the newest page every 10s while the tab is visible.
  const refresh = useCallback(() => {
    if (document.hidden) return;
    fetchPage().then((data) => {
      if (activeSpace.current !== spaceName) return;
      setMessages((current) => {
        const merged = mergeMessages(current, data.messages || []);
        if (merged.length !== current.length) scrollIntent.current = 'stick';
        return merged;
      });
      setNextPageToken((token) => token ?? data.nextPageToken ?? null);
    }).catch(() => { /* keep what is on screen; next tick retries */ });
  }, [fetchPage, spaceName]);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const intent = scrollIntent.current;
    if (!el || !intent) return;
    scrollIntent.current = null;
    if (intent === 'bottom') el.scrollTop = el.scrollHeight;
    else if (intent === 'stick') {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
    } else el.scrollTop = el.scrollHeight - intent.height + intent.top;
  }, [messages]);

  const loadOlder = () => {
    if (!nextPageToken || loadingOlder) return;
    setLoadingOlder(true);
    fetchPage(nextPageToken).then((data) => {
      if (activeSpace.current !== spaceName) return;
      const el = scrollerRef.current;
      if (el && !query) scrollIntent.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((current) => mergeMessages(data.messages || [], current));
      setNextPageToken(data.nextPageToken || null);
    }).catch((err) => toast(errorText(err, 'Gagal memuat pesan lama'), 'error'))
      .finally(() => setLoadingOlder(false));
  };

  // One send path for the main composer and the thread panel: optimistic
  // message, then JSON (text) or multipart (file) to the backend.
  // Drive files: ask Drive who in this space can't open them yet; if anyone,
  // let the user share (view/comment/edit), send anyway, or cancel.
  const prepareDrive = useCallback(async (text, driveFiles) => {
    let check = null;
    try {
      const response = await api.post(`/google-chat/spaces/${spaceId}/drive-access`, { fileIds: driveFiles.map((f) => f.id) });
      check = response.data.data;
    } catch (err) {
      toast(errorText(err, 'Akses file tidak dapat diperiksa — tautan tetap dikirim.'), 'error');
    }
    if (check && accessSummary(check).needsDecision) {
      const decision = await new Promise((resolve) => setAccessPrompt({ check, resolve }));
      if (decision === 'cancel') return null;
      if (decision?.role) {
        try {
          const response = await api.post(`/google-chat/spaces/${spaceId}/drive-access/grant`, { fileIds: driveFiles.map((f) => f.id), role: decision.role });
          const { granted, failed } = response.data.data;
          if (granted) toast(`Akses diberikan ke ${granted} anggota`, 'success');
          if (failed) toast(`${failed} akses gagal diberikan`, 'error');
        } catch (err) {
          toast(errorText(err, 'Gagal memberi akses file'), 'error');
          return null;
        }
      }
    }
    const full = buildDriveMessage(text, driveFiles);
    if (full.length > MAX_TEXT_LENGTH) { toast(`Pesan maksimal ${MAX_TEXT_LENGTH} karakter`, 'error'); return null; }
    return full;
  }, [spaceId]);

  // The grant itself runs inside prepareDrive while the message shows as sending.
  const decideAccess = (decision) => {
    accessPrompt?.resolve(decision);
    setAccessPrompt(null);
  };

  const send = useCallback(async ({ text: typed, file, driveFiles, quoted: quote, mentions, threadName }) => {
    let text = typed;
    if (driveFiles?.length) {
      text = await prepareDrive(typed, driveFiles);
      if (text === null) return false;
    }
    const me = messages.find((message) => message.sender?.isMe)?.sender || { isMe: true, name: 'me', displayName: 'Anda' };
    const temp = {
      name: `local/${Date.now()}`,
      text,
      mentions: mentions || {},
      createTime: new Date().toISOString(),
      sender: me,
      threadName: threadName || null,
      threadReply: Boolean(threadName),
      attachments: file ? [{ index: 0, title: file.name, contentType: file.type, url: null, downloadable: false }] : [],
      reactions: [],
      quoted: quote ? { name: quote.name, text: quote.text } : null,
      pending: true,
    };
    if (!threadName) scrollIntent.current = 'bottom';
    setMessages((current) => [...current, temp]);
    if (quote) setQuoted(null);
    try {
      let response;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        if (text) form.append('text', text);
        if (threadName) form.append('threadName', threadName);
        response = await api.post(`/google-chat/spaces/${spaceId}/attachments`, form);
      } else {
        response = await api.post(`/google-chat/spaces/${spaceId}/messages`, {
          text,
          ...(threadName ? { threadName } : {}),
          ...(quote ? { quoted: { name: quote.name, lastUpdateTime: quote.lastUpdateTime || quote.createTime } } : {}),
        });
      }
      if (activeSpace.current !== spaceName) return true;
      const created = response.data.data;
      setMessages((current) => mergeMessages(current.filter((m) => m.name !== temp.name), [{
        ...created, mentions: { ...(mentions || {}), ...(created.mentions || {}) },
      }]));
      onSent?.(spaceName);
      return true;
    } catch (err) {
      if (activeSpace.current === spaceName) setMessages((current) => current.filter((m) => m.name !== temp.name));
      if (quote) setQuoted(quote);
      toast(errorText(err, 'Pesan gagal dikirim'), 'error');
      return false;
    }
  }, [messages, spaceId, spaceName, onSent, prepareDrive]);

  const replaceMessage = useCallback((updated) => {
    setMessages((current) => current.map((m) => (m.name === updated.name ? updated : m)));
  }, []);
  const removeMessage = useCallback((name) => {
    setMessages((current) => current.filter((m) => m.name !== name));
  }, []);

  const react = useCallback(async (message, emoji, applyElsewhere) => {
    try {
      const response = await api.post(`/google-chat/spaces/${spaceId}/messages/${message.name.split('/messages/')[1]}/reactions`, { emoji });
      const { reacted } = response.data.data;
      const update = (m) => ({ ...m, reactions: applyReactionToggle(m.reactions, emoji, reacted) });
      setMessages((current) => current.map((m) => (m.name === message.name ? update(m) : m)));
      applyElsewhere?.(message.name, update);
      setMine((state) => ({ ...state, [message.name]: { ...(state[message.name] || {}), [emoji]: reacted } }));
    } catch (err) {
      toast(errorText(err, 'Gagal menambahkan reaksi'), 'error');
    }
  }, [spaceId]);
  const mineFor = useCallback((name) => mine[name] || EMPTY, [mine]);

  const copyLink = useCallback(async (message) => {
    const link = messageLink(window.location.origin, spaceId, message.name);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link pesan disalin', 'success');
    } catch {
      toast('Browser tidak mengizinkan menyalin. Link: ' + link, 'error');
    }
  }, [spaceId]);
  const onForward = useCallback((message) => setForwarding(message), []);

  // /chat?space=…&message=… — scroll to that message (fetching a few older
  // pages if needed) and highlight it briefly.
  useEffect(() => {
    if (!focusMessageId || loading) return undefined;
    const name = `${spaceName}/messages/${focusMessageId}`;
    const found = messages.some((m) => m.name === name);
    if (!found) {
      if (nextPageToken && focusTries.current < FOCUS_PAGES && !loadingOlder) { focusTries.current += 1; loadOlder(); }
      else if (!nextPageToken || focusTries.current >= FOCUS_PAGES) {
        if (focusTries.current !== Infinity) toast('Pesan yang ditautkan tidak ditemukan di riwayat yang dimuat.', 'error');
        focusTries.current = Infinity;
      }
      return undefined;
    }
    if (highlight === name) return undefined;
    setTab('chat');
    setHighlight(name);
    const frame = requestAnimationFrame(() => {
      scrollerRef.current?.querySelector(`[data-message="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'center' });
    });
    const timer = setTimeout(() => setHighlight((h) => (h === name ? `${name}#done` : h)), 4000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, loading, messages, nextPageToken, loadingOlder, spaceName]);

  const startMeet = async () => {
    // Open the tab now (inside the click) so the browser doesn't block it.
    const tab = window.open('about:blank', '_blank');
    setMeetBusy(true);
    setMeetLink(null);
    try {
      const response = await api.post(`/google-chat/spaces/${spaceId}/meet`);
      const { meetUrl, message } = response.data.data;
      if (message) setMessages((current) => mergeMessages(current, [message]));
      scrollIntent.current = 'bottom';
      if (tab) { tab.opener = null; tab.location.href = meetUrl; } else setMeetLink(meetUrl);
      toast('Google Meet dibuat. Tautannya dikirim ke percakapan dan tersimpan di Kalender Anda.', 'success');
    } catch (err) {
      tab?.close();
      toast(errorText(err, 'Gagal membuat Google Meet'), 'error');
    } finally {
      setMeetBusy(false);
    }
  };

  const botName = space?.isBotDm
    ? messages.find((message) => message.sender?.type === 'BOT' && message.sender.displayName)?.sender.displayName
    : null;
  useEffect(() => {
    if (botName && space && space.displayName !== botName) onRename?.(space.name, botName);
  }, [botName, space, onRename]);
  const title = botName || space?.displayName || 'Percakapan';
  // The name of a space, a person or an app is record data; the fallback is interface text.
  const titleIsData = Boolean(botName || space?.displayName);
  const canThread = space ? space.threaded : false;
  const tabs = spaceTabs(space);
  const activeTab = tabs.includes(tab) ? tab : 'chat';

  const searching = searchOpen && query.trim().length > 0;
  const { main, replies } = useMemo(() => threadView(messages), [messages]);
  const shown = useMemo(() => (searching ? searchMessages(messages, query) : (canThread ? main : messages)), [searching, messages, query, canThread, main]);
  const groups = useMemo(() => groupMessagesByDay(shown), [shown]);

  const openThread = useCallback((message) => setThreadRoot(message), []);
  const onQuote = useCallback((message) => setQuoted(message), []);

  const chatView = (
    <>
      {searchOpen ? (
        <div className="pw-gchat__search-bar">
          <SearchField
            variant="panel"
            label="Cari di percakapan ini"
            placeholder="Cari pesan, nama, atau lampiran"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="pw-gchat-search-hint"
          />
          <p id="pw-gchat-search-hint" className="pw-gchat__hint">
            Mencari di {messages.length} pesan yang sudah dimuat. Muat pesan lebih lama untuk mencari lebih jauh.
          </p>
        </div>
      ) : null}
      {meetLink ? (
        <div className="pw-gchat__banner">
          <Banner tone="success" title="Google Meet siap" action={<Button variant="secondary" href={meetLink} target="_blank" rel="noopener noreferrer">Buka Meet</Button>}>
            Browser memblokir tab baru — buka rapat dari tombol ini.
          </Banner>
        </div>
      ) : null}
      {space?.historyOff ? (
        <div className="pw-gchat__banner"><Banner tone="info">Riwayat percakapan ini nonaktif — pesan dapat terhapus otomatis.</Banner></div>
      ) : null}

      <div className="pw-gchat__messages" ref={scrollerRef}>
        {loading && !messages.length ? <LoadingState label="Memuat pesan…" /> : null}
        {!loading && error && !messages.length ? (
          <EmptyState tone="error" title="Gagal memuat pesan" description={error} action={<Button variant="text" onClick={loadLatest}>Coba lagi</Button>} />
        ) : null}
        {!loading && !error && !messages.length ? (
          <EmptyState icon="forum" title="Belum ada pesan" description="Mulai percakapan dengan menulis pesan di bawah." />
        ) : null}
        {searching && !shown.length ? <EmptyState compact icon="search_off" title="Tidak ditemukan" description="Tidak ada pesan termuat yang cocok." /> : null}
        {nextPageToken && messages.length ? (
          <div className="pw-gchat__older">
            <Button variant="text" loading={loadingOlder} onClick={loadOlder}>Muat pesan lebih lama</Button>
          </div>
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
                  canThread={canThread}
                  replyCount={message.threadReply ? 0 : (replies.get(message.threadName)?.length || 0)}
                  mine={mine[message.name] || EMPTY}
                  highlighted={highlight === message.name}
                  onOpenThread={openThread}
                  onQuote={onQuote}
                  onChanged={replaceMessage}
                  onDeleted={removeMessage}
                  onReact={react}
                  onForward={onForward}
                  onCopyLink={copyLink}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Composer
        title={title}
        members={members}
        quoted={quoted}
        onClearQuoted={() => setQuoted(null)}
        onSubmit={send}
      />
    </>
  );

  return (
    <section className={`pw-gchat__conversation${threadRoot && activeTab === 'chat' ? ' has-thread' : ''}`} aria-label={title} data-no-translate={titleIsData ? 'attr' : undefined}>
      <div className="pw-gchat__conversation-main">
        <header className={`pw-gchat__conversation-head${tabs.length > 1 ? ' has-tabs' : ''}`}>
          <div className="pw-gchat__conversation-bar">
            <IconButton to="/chat" size="sm" label="Kembali ke daftar" icon="arrow_back" className="pw-gchat__back" />
            <Avatar space={space || { displayName: title }} />
            <div className="pw-gchat__conversation-title">
              <h2 data-no-translate={titleIsData ? '' : undefined}>{title}</h2>
              <span>{spaceTypeLabel(space)}</span>
            </div>
            {space?.isBotDm ? null : (
              <IconButton size="sm" label="Mulai Meet" onClick={startMeet} disabled={meetBusy} aria-busy={meetBusy || undefined}>
                {meetBusy ? <Spinner label={null} /> : <Icon name="videocam" />}
              </IconButton>
            )}
            {activeTab === 'chat' ? (
              <IconButton
                size="sm"
                label={searchOpen ? 'Tutup pencarian' : 'Cari di percakapan'}
                icon="search"
                selected={searchOpen}
                onClick={() => { setSearchOpen((v) => !v); setQuery(''); }}
              />
            ) : null}
            <IconButton size="sm" label="Detail percakapan" icon="info" onClick={() => setDetailsOpen(true)} />
            <ActionMenu
              size="sm"
              label="Opsi percakapan"
              items={[
                space && !space.isBotDm && space.spaceType !== 'SPACE'
                  ? { label: space.alias ? 'Ubah nama tampilan' : 'Beri nama', icon: 'sell', onClick: () => setAliasOpen(true) }
                  : null,
                activeTab === 'chat' ? { label: 'Muat ulang pesan', icon: 'refresh', onClick: loadLatest } : null,
              ]}
            />
          </div>
          {tabs.length > 1 ? (
            <TabBar
              className="pw-gchat__space-tabs"
              tabs={tabs.map((key) => ({ k: key, l: TAB_LABELS[key] }))}
              value={activeTab}
              onChange={setTab}
              label="Tampilan space"
              idPrefix="pw-gchat-tab"
              panelId="pw-gchat-panel"
            />
          ) : null}
        </header>

        <div
          className="pw-gchat__panel"
          id="pw-gchat-panel"
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={tabs.length > 1 ? `pw-gchat-tab-${activeTab}` : undefined}
        >
          {activeTab === 'chat' ? chatView : null}
          {activeTab === 'files' ? (
            <FilesTab
              spaceId={spaceId}
              messages={messages}
              loading={loading}
              nextPageToken={nextPageToken}
              loadingOlder={loadingOlder}
              onLoadOlder={loadOlder}
            />
          ) : null}
          {activeTab === 'tasks' ? (
            <div className="pw-gchat__tab-panel pw-gchat__tasks">
              <ProjectTracker spaceId={spaceId} spaceDisplayName={title} embedded />
            </div>
          ) : null}
        </div>
      </div>

      {threadRoot && activeTab === 'chat' ? (
        <ThreadPanel
          key={threadRoot.threadName}
          spaceId={spaceId}
          root={threadRoot}
          localMessages={messages}
          members={members}
          title={title}
          titleIsData={titleIsData}
          mineFor={mineFor}
          onClose={() => setThreadRoot(null)}
          onSend={send}
          onChanged={replaceMessage}
          onDeleted={removeMessage}
          onReact={react}
          onForward={onForward}
          onCopyLink={copyLink}
        />
      ) : null}

      <SpaceDetails
        open={detailsOpen}
        spaceId={spaceId}
        onClose={() => setDetailsOpen(false)}
        onChanged={(updated) => onSpaceChanged?.(updated)}
        onGone={() => { setDetailsOpen(false); onGone?.(); }}
      />
      <ForwardDialog
        message={forwarding}
        spaceId={spaceId}
        spaces={spaces}
        onClose={() => setForwarding(null)}
        onForwarded={() => setForwarding(null)}
      />
      <DriveAccessDialog check={accessPrompt?.check || null} title={titleIsData ? title : ''} busy={false} onDecision={decideAccess} />
      {aliasOpen && space ? (
        <AliasDialog space={space} onClose={() => setAliasOpen(false)} onSaved={(updated) => onSpaceChanged?.(updated)} />
      ) : null}
    </section>
  );
}
