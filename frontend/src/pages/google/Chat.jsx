import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Page from '../../components/Page';
import Banner from '../../components/Banner';
import EmptyState from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { isValidMessageId, isValidSpaceId, spaceIdFromName } from './chatModel';
import Conversation from './chat/Conversation';
import NewChatDialog from './chat/NewChatDialog';
import SpaceList from './chat/SpaceList';
import { errorText } from './chat/parts';
import './chat.css';

const SPACE_PAGE_SIZE = 100;
const LIST_REFRESH_MS = 30000;

export default function Chat() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rawSpace = params.get('space');
  const spaceId = isValidSpaceId(rawSpace) ? rawSpace : null;
  const spaceName = spaceId ? `spaces/${spaceId}` : null;
  const rawMessage = params.get('message');
  const focusMessageId = spaceId && isValidMessageId(rawMessage) ? rawMessage : null;
  const { user } = useAuth() || {};

  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [extraSpace, setExtraSpace] = useState(null);
  const [readStates, setReadStates] = useState(null); // null = unread UI hidden
  const [newChat, setNewChat] = useState(null); // mode or null
  const namePolls = useRef(0);
  const appNames = useRef(new Map()); // bot DM → app name learned from its messages
  const readStateAvailable = useRef(true);

  const loadReadStates = useCallback((list) => {
    if (!readStateAvailable.current || !list.length) return;
    const ids = list.map((s) => spaceIdFromName(s.name)).filter(Boolean).slice(0, 200);
    api.get('/google-chat/read-states', { params: { spaces: ids.join(',') } })
      .then((response) => {
        const { available, states } = response.data.data;
        if (!available) { readStateAvailable.current = false; setReadStates(null); return; }
        setReadStates((current) => ({ ...(current || {}), ...states }));
      })
      .catch(() => { /* unread dots are optional */ });
  }, []);

  const loadSpaces = useCallback((quiet = false) => {
    if (!quiet) { setLoading(true); setError(null); }
    return api.get('/google-chat/spaces', { params: { pageSize: SPACE_PAGE_SIZE } })
      .then(async (response) => {
        let { spaces: list = [], nextPageToken } = response.data.data;
        for (let page = 0; nextPageToken && page < 4; page += 1) {
          const more = await api.get('/google-chat/spaces', { params: { pageSize: SPACE_PAGE_SIZE, pageToken: nextPageToken } });
          list = list.concat(more.data.data.spaces || []);
          nextPageToken = more.data.data.nextPageToken;
        }
        setSpaces(list.map((s) => (appNames.current.has(s.name) ? { ...s, displayName: appNames.current.get(s.name) } : s)));
        setError(null);
        setErrorCode(null);
        loadReadStates(list);
        return list;
      })
      .catch((err) => {
        if (!quiet) {
          setError(errorText(err, 'Gagal memuat daftar percakapan'));
          setErrorCode(err?.response?.data?.error?.code || null);
        }
        return null;
      })
      .finally(() => { if (!quiet) setLoading(false); });
  }, [loadReadStates]);

  useEffect(() => { loadSpaces(); }, [loadSpaces]);

  // DM names still resolving on the server → ask again shortly (a few times).
  useEffect(() => {
    if (!spaces.some((space) => space.namePending) || namePolls.current >= 4) return undefined;
    const timer = setTimeout(() => { namePolls.current += 1; loadSpaces(true); }, 2500);
    return () => clearTimeout(timer);
  }, [spaces, loadSpaces]);

  // Keep order, "last active" and unread fresh while the page is visible.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) loadSpaces(true); }, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadSpaces]);

  // Opening a space marks it read (when the read-state scope is granted).
  const markRead = useCallback((name) => {
    if (!readStateAvailable.current || !name) return;
    const id = spaceIdFromName(name);
    api.put(`/google-chat/spaces/${id}/read-state`)
      .then((response) => {
        if (!response.data.data.available) { readStateAvailable.current = false; setReadStates(null); return; }
        setReadStates((current) => ({ ...(current || {}), [name]: response.data.data.lastReadTime || new Date().toISOString() }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => { if (spaceName) markRead(spaceName); }, [spaceName, markRead]);

  const listed = spaces.find((space) => space.name === spaceName) || null;
  // A deep link to a space outside the loaded list: fetch just that one.
  useEffect(() => {
    setExtraSpace(null);
    if (!spaceId || loading || listed) return;
    api.get(`/google-chat/spaces/${spaceId}`)
      .then((response) => setExtraSpace(response.data.data))
      .catch((err) => toast(errorText(err, 'Percakapan tidak ditemukan'), 'error'));
  }, [spaceId, loading, listed]);
  const space = listed || (extraSpace?.name === spaceName ? extraSpace : null);

  const onSent = useCallback((name) => {
    const now = new Date().toISOString();
    setSpaces((current) => current.map((s) => (s.name === name ? { ...s, lastActiveTime: now } : s)));
    markRead(name);
  }, [markRead]);

  const onRename = useCallback((name, displayName) => {
    appNames.current.set(name, displayName);
    setSpaces((current) => current.map((s) => (s.name === name ? { ...s, displayName } : s)));
  }, []);

  const onSpaceChanged = useCallback((updated) => {
    if (!updated?.name) return;
    setSpaces((current) => current.map((s) => (s.name === updated.name ? { ...s, ...updated } : s)));
  }, []);

  const onCreated = (created) => {
    setNewChat(null);
    if (!created?.name) return;
    setSpaces((current) => (current.some((s) => s.name === created.name) ? current : [created, ...current]));
    navigate(`/chat?space=${spaceIdFromName(created.name)}`);
    loadSpaces(true);
  };

  const onGone = () => {
    setSpaces((current) => current.filter((s) => s.name !== spaceName));
    navigate('/chat');
    loadSpaces(true);
  };

  const setupProblem = ['GOOGLE_SCOPE_NOT_GRANTED', 'GOOGLE_API_DISABLED', 'GOOGLE_ACCOUNT_NOT_LINKED'].includes(errorCode);

  return (
    <Page
      title="Google Chat"
      description="Pesan langsung, space, dan aplikasi Google Chat Anda, langsung dari Prakasa Workspace."
      className={`pw-gchat${spaceId ? ' is-conversation' : ''}`}
    >
      {setupProblem ? <Banner tone="warning" title="Google Chat belum siap">{error}</Banner> : null}
      {rawSpace && !spaceId ? <Banner tone="error">Alamat space Chat tidak valid.</Banner> : null}
      <div className="pw-gchat__frame">
        <SpaceList
          spaces={spaces}
          loading={loading}
          error={error}
          onRetry={() => loadSpaces()}
          activeName={spaceName}
          readStates={readStates}
          onNewChat={setNewChat}
          userId={user?.id}
        />
        {spaceId ? (
          <Conversation
            key={spaceId}
            spaceId={spaceId}
            space={space}
            spaces={spaces}
            focusMessageId={focusMessageId}
            onSent={onSent}
            onRename={onRename}
            onSpaceChanged={onSpaceChanged}
            onGone={onGone}
          />
        ) : (
          <section className="pw-gchat__conversation pw-gchat__placeholder" aria-label="Belum ada percakapan dipilih">
            <EmptyState icon="forum" title="Pilih percakapan" description="Pilih pesan langsung, space, atau aplikasi di sebelah kiri, atau mulai dengan “Chat baru”." />
          </section>
        )}
      </div>
      <NewChatDialog
        open={Boolean(newChat)}
        initialMode={newChat || 'DIRECT_MESSAGE'}
        onClose={() => setNewChat(null)}
        onCreated={onCreated}
      />
    </Page>
  );
}
