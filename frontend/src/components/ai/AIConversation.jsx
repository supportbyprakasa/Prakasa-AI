import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileDown,
  Loader2,
  Menu,
  PanelRightClose,
  Pencil,
  PanelRightOpen,
  Paperclip,
  Sparkles,
  Upload,
} from 'lucide-react';
import api from '../../api/client';
import { streamSessionMessage } from '../../api/aiStream';
import Badge from '../Badge';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIVisibilityBadge from './AIVisibilityBadge';
import AISessionSettings from './AISessionSettings';
import AIComposer from './AIComposer';
import AIDropdown from './AIDropdown';
import AINewChat from './AINewChat';
import AIMarkdown from './AIMarkdown';
import AIWebToggle, { toolStatusLabel } from './AIWebToggle';
import useFileDrop from './useFileDrop';
import { engineChipLabel, engineMenuItems } from './aiEngineOptions';
import { AI_FILE_ACCEPT, AI_MAX_PENDING_FILES, AI_MAX_UPLOAD_BYTES, formatBytes } from './aiFiles';
import {
  canEditMessage,
  closeOpenMarkdown,
  isGenerationActive,
  messagesAfterEdit,
} from '../../pages/ai/aiCommandCenterModel';

const GENERATION_POLL_MS = 4000;
const STICK_TO_BOTTOM_PX = 160;

export default function AIConversation({
  sessionId,
  providers = [],
  providersLoading = false,
  onSessionUpdated,
  onSessionDeleted,
  onSessionCreated,
  pendingMessage,
  onPendingConsumed,
  onOpenWorkspace,
  workspaceOpen,
  onToggleWorkspace,
  onOpenSidebar,
  newChatVisibility = 'private',
}) {
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageMeta, setMessageMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [switchingEngine, setSwitchingEngine] = useState(false);
  const [exportingKey, setExportingKey] = useState('');
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streamingText, setStreamingText] = useState(null);
  const [toolStatus, setToolStatus] = useState(null);
  const [togglingWeb, setTogglingWeb] = useState(false);
  const [stopping, setStopping] = useState(false);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const fileInputRef = useRef(null);
  const consumedPendingRef = useRef(null);
  const streamBufferRef = useRef('');
  const flushFrameRef = useRef(null);
  // Latest selected session, so async work started for another session never writes here.
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;

  // Hooks must run before the early returns below, so derive upload rights from raw state.
  const userPermissions = user?.permissions || [];
  const canDropFiles = Boolean(
    session &&
    session.status === 'active' &&
    (session.access ? session.access.canSend : Number(session.ownerUserId) === Number(user?.id)) &&
    userPermissions.includes('ai_command.use') &&
    userPermissions.includes('document.create') &&
    !uploading
  );
  const { dragging, dropProps } = useFileDrop((files) => uploadFiles(files), canDropFiles);

  const scrollToBottom = (behavior = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 30);
  };

  const cancelStreamFlush = () => {
    if (flushFrameRef.current !== null) cancelAnimationFrame(flushFrameRef.current);
    flushFrameRef.current = null;
  };

  // Deltas arrive many times per second; render at most once per animation frame.
  const appendDelta = (targetSessionId, text) => {
    if (activeSessionRef.current !== targetSessionId) return;
    streamBufferRef.current += text;
    if (flushFrameRef.current !== null) return;
    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      if (activeSessionRef.current === targetSessionId) setStreamingText(streamBufferRef.current);
    });
  };

  // A tool call means the text so far was only a preamble: clear the draft and show
  // what the AI is doing until the final answer starts streaming.
  const handleToolStatus = (targetSessionId, status) => {
    if (activeSessionRef.current !== targetSessionId) return;
    cancelStreamFlush();
    streamBufferRef.current = '';
    setStreamingText('');
    setToolStatus(status);
  };

  const onMessageScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (streamingText && element && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [streamingText]);

  const refreshMessagesAndSession = async () => {
    const targetSessionId = sessionId;
    const [mr, sr] = await Promise.all([
      api.get(`/ai-command/sessions/${targetSessionId}/messages`, { params: { page: 1, limit: 50 } }),
      api.get(`/ai-command/sessions/${targetSessionId}`),
    ]);
    if (activeSessionRef.current !== targetSessionId) return;
    setMessages(mr.data.data || []);
    setMessageMeta(mr.data.meta || { page: 1, limit: 50, total: mr.data.data?.length || 0 });
    setSession(sr.data.data);
  };

  const loadSession = async () => {
    if (!sessionId) {
      setSession(null);
      setMessages([]);
      setMessageMeta({ page: 1, limit: 50, total: 0 });
      return;
    }
    setLoading(true);
    try {
      await refreshMessagesAndSession();
      scrollToBottom('auto');
    } catch (e) {
      if (e.response?.status === 403) {
        toast('Anda tidak punya akses ke percakapan ini', 'error');
      } else if (e.response?.status === 404) {
        toast('Percakapan tidak ditemukan', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal memuat percakapan', 'error');
      }
      setSession(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cancelStreamFlush();
    streamBufferRef.current = '';
    setStreamingText(null);
    setToolStatus(null);
    setSending(false);
    stickToBottomRef.current = true;
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // After a reload or dropped stream the server may still be generating: poll until idle.
  useEffect(() => {
    if (!sessionId || sending || session?.generationStatus !== 'generating') return undefined;
    const timer = setInterval(() => {
      refreshMessagesAndSession().catch(() => {});
    }, GENERATION_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sending, session?.generationStatus]);

  const loadOlder = async () => {
    if (!sessionId || loadingOlder || messages.length >= (messageMeta.total || 0)) return;
    const nextPage = (messageMeta.page || 1) + 1;
    setLoadingOlder(true);
    try {
      const response = await api.get(`/ai-command/sessions/${sessionId}/messages`, {
        params: { page: nextPage, limit: messageMeta.limit || 50 },
      });
      const older = response.data.data || [];
      setMessages((current) => [...older, ...current]);
      setMessageMeta(response.data.meta || {
        page: nextPage,
        limit: messageMeta.limit || 50,
        total: messageMeta.total || messages.length + older.length,
      });
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal memuat pesan lama', 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (textOverride, { editMessageId = null } = {}) => {
    const text = typeof textOverride === 'string' ? textOverride : input;
    if (!sessionId || !text.trim()) return;
    if (session?.status !== 'active') {
      toast('Percakapan sudah diarsipkan.', 'error');
      return;
    }
    if (session?.generationStatus === 'generating') {
      toast('AI masih memproses pesan sebelumnya.', 'error');
      return;
    }

    const targetSessionId = sessionId;
    const stillActive = () => activeSessionRef.current === targetSessionId;

    if (typeof textOverride !== 'string') setInput('');
    setSending(true);
    cancelStreamFlush();
    streamBufferRef.current = '';
    setStreamingText('');
    setToolStatus(null);
    stickToBottomRef.current = true;

    const optimistic = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdBy: user?.id,
      authorName: user?.name,
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((current) => (
      editMessageId ? messagesAfterEdit(current, editMessageId, optimistic) : [...current, optimistic]
    ));
    scrollToBottom();

    try {
      let result;
      try {
        result = await streamSessionMessage(targetSessionId, text, {
          onDelta: (delta) => appendDelta(targetSessionId, delta),
          onStatus: (status) => handleToolStatus(targetSessionId, status),
          editMessageId,
        });
      } catch (streamFailure) {
        // Backends without the stream endpoint still get a complete (non-streamed) reply.
        if (!streamFailure.streamUnavailable) throw streamFailure;
        const response = await api.post(`/ai-command/sessions/${targetSessionId}/messages`, (
          editMessageId ? { message: text, editMessageId } : { message: text }
        ));
        result = response.data.data;
      }
      if (!stillActive()) return;

      // Swap the streamed draft for the saved message in one render to avoid a flicker.
      cancelStreamFlush();
      setMessages((current) => [
        ...current.map((item) => (
          item.id === optimistic.id ? { ...item, id: result.userMessageId, _optimistic: false } : item
        )),
        ...(result.assistantMessage
          ? [{ ...result.assistantMessage, createdAt: new Date().toISOString() }]
          : []),
      ]);
      setStreamingText(null);
      setToolStatus(null);
      onSessionUpdated?.();
      await refreshMessagesAndSession();
    } catch (e) {
      if (!stillActive()) return;
      cancelStreamFlush();
      setStreamingText(null);
      setToolStatus(null);
      const errCode = e.response?.data?.error?.code;
      const status = e.response?.status;
      // Always reload authoritative state. Provider failures occur after the
      // user message has already been persisted by the backend.
      try {
        await refreshMessagesAndSession();
      } catch {
        setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      }

      if (editMessageId && (status === 403 || status === 404)) {
        toast(e.response?.data?.error?.message || 'Pesan tidak dapat diedit', 'error');
      } else if (errCode === 'SESSION_BUSY') {
        setInput(text);
        toast('AI masih memproses pesan sebelumnya.', 'error');
      } else if (errCode === 'SESSION_NOT_ACTIVE') {
        setInput(text);
        toast('Percakapan sudah diarsipkan.', 'error');
      } else if (status === 400 || status === 403) {
        setInput(text);
        toast(e.response?.data?.error?.message || 'Pesan tidak dapat dikirim', 'error');
      } else if (errCode === 'STREAM_INTERRUPTED') {
        toast('Koneksi ke AI terputus. Jawaban akan muncul otomatis bila AI selesai memproses.', 'error');
      } else if (errCode === 'AI_PROVIDER_ERROR' || status === 502 || status === 503 || status === 504) {
        toast('Layanan AI sedang tidak dapat dijangkau. Pesan Anda tetap tersimpan di riwayat.', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal mengirim pesan', 'error');
      }
    } finally {
      if (stillActive()) setSending(false);
    }
  };

  // First message typed on the new-chat screen is sent once the new session is loaded.
  useEffect(() => {
    if (!session || !pendingMessage) return;
    if (Number(pendingMessage.sessionId) !== Number(session.id)) return;
    if (consumedPendingRef.current === session.id) return;
    consumedPendingRef.current = session.id;
    onPendingConsumed?.();
    if (pendingMessage.autoSend === false) setInput(pendingMessage.text);
    else send(pendingMessage.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pendingMessage]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !sessionId) return;
    const tooBig = files.filter((file) => file.size > AI_MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      toast(`Ukuran file maksimum ${formatBytes(AI_MAX_UPLOAD_BYTES)}: ${tooBig.map((f) => f.name).join(', ')}`, 'error');
    }
    const accepted = files.filter((file) => file.size <= AI_MAX_UPLOAD_BYTES);
    if (accepted.length > AI_MAX_PENDING_FILES) toast(`Maksimum ${AI_MAX_PENDING_FILES} file sekaligus`, 'error');
    const batch = accepted.slice(0, AI_MAX_PENDING_FILES);
    if (!batch.length) return;

    setUploading(true);
    const saved = [];
    const failed = [];
    for (const file of batch) {
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await api.post(`/ai-command/sessions/${sessionId}/files`, form);
        saved.push(response.data.data);
      } catch (error) {
        failed.push(`${file.name} (${error.response?.data?.error?.message || 'gagal'})`);
      }
    }
    setUploading(false);

    if (saved.length) {
      const unreadable = saved.filter((item) => item.extractionStatus !== 'ready').length;
      const byVision = saved.filter((item) => item.readBy === 'vision').length;
      const parts = [`${saved.length} file tersimpan.`];
      if (byVision) parts.push(`${byVision} gambar/scan dibaca dengan AI vision.`);
      if (unreadable) parts.push(`${unreadable} file belum dapat dibaca AI.`);
      toast(parts.join(' '), unreadable ? 'info' : 'success');
      onSessionUpdated?.();
      onOpenWorkspace?.('documents');
    }
    if (failed.length) toast(`Gagal mengunggah: ${failed.join(', ')}`, 'error');
  };

  const exportMessage = async (message, format) => {
    if (!sessionId || !message?.id) return;
    setExportingKey(`${message.id}:${format}`);
    try {
      const response = await api.post(`/ai-command/sessions/${sessionId}/artifacts`, {
        messageId: Number(message.id),
        format,
        title: session.title || `Dokumen AI ${message.id}`,
      });
      const artifact = response.data.data;
      const download = await api.get(artifact.downloadUrl, { responseType: 'blob' });
      downloadBlob(download.data, artifact.originalName || `dokumen-ai.${format}`);
      toast(`${format.toUpperCase()} dibuat, disimpan di Shared Drive, dan diunduh`, 'success');
      onSessionUpdated?.();
      onOpenWorkspace?.('documents');
    } catch (error) {
      toast(error.response?.data?.error?.message || `Gagal membuat ${format.toUpperCase()}`, 'error');
    } finally {
      setExportingKey('');
    }
  };

  const stopGeneration = async () => {
    setStopping(true);
    try {
      await api.post(`/ai-command/sessions/${sessionId}/generation/stop`);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menghentikan jawaban', 'error');
    } finally {
      setStopping(false);
    }
  };

  const toggleWebResearch = async () => {
    const next = !session.webResearch;
    setTogglingWeb(true);
    try {
      await api.patch(`/ai-command/sessions/${sessionId}`, { webResearch: next });
      const response = await api.get(`/ai-command/sessions/${sessionId}`);
      setSession(response.data.data);
      toast(next ? 'Riset web aktif untuk percakapan ini' : 'Riset web dimatikan', 'success');
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengubah riset web', 'error');
    } finally {
      setTogglingWeb(false);
    }
  };

  const changeEngine = async (providerId) => {
    setSwitchingEngine(true);
    try {
      await api.patch(`/ai-command/sessions/${sessionId}`, { provider: providerId });
      const response = await api.get(`/ai-command/sessions/${sessionId}`);
      setSession(response.data.data);
      onSessionUpdated?.();
      toast(`Engine diganti ke ${engineChipLabel(providers, providerId)}`, 'success');
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengganti engine', 'error');
    } finally {
      setSwitchingEngine(false);
    }
  };

  const topbar = (content) => (
    <header className="ai-topbar">
      {onOpenSidebar && (
        <button
          type="button"
          className="ai-icon-button ai-ripple"
          onClick={onOpenSidebar}
          aria-label="Buka daftar percakapan"
        >
          <Menu size={20} />
        </button>
      )}
      {content}
    </header>
  );

  if (!sessionId) {
    return (
      <div className="ai-conversation">
        {topbar(<span className="ai-topbar-brand">Prakasa AI</span>)}
        <AINewChat
          key={newChatVisibility}
          providers={providers}
          providersLoading={providersLoading}
          onSessionCreated={onSessionCreated}
          initialVisibility={newChatVisibility}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ai-conversation">
        {topbar(null)}
        <div className="ai-conversation-state" role="status">
          <Loader2 className="ai-spin" size={22} />
          <p>Memuat percakapan…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ai-conversation">
        {topbar(null)}
        <div className="ai-conversation-state">
          <div className="ai-state-icon is-warning"><AlertTriangle size={24} /></div>
          <strong>Percakapan tidak tersedia</strong>
          <p>Periksa kembali akses Anda atau pilih percakapan lain.</p>
        </div>
      </div>
    );
  }

  const permissions = user?.permissions || [];
  const isOwner = Number(session.ownerUserId) === Number(user?.id);
  // The server decides who may write: the owner, or any member of the division for
  // shared division chats.
  const canManage = (session.access ? session.access.canManage : isOwner) && permissions.includes('ai_command.session.manage');
  const canSend = (session.access ? session.access.canSend : isOwner) && permissions.includes('ai_command.use');
  const sharedChat = session.visibility !== 'private';
  const canCreateDocument = canSend && permissions.includes('document.create');
  const archived = session.status === 'archived';
  const generating = isGenerationActive({ sending, generationStatus: session.generationStatus });
  const title = session.title || `Percakapan #${session.id}`;
  const engineLabel = engineChipLabel(providers, session.provider, session.model);
  const webCapable = Boolean(providers.find((item) => item.id === session.provider)?.webResearch);

  return (
    <div className="ai-conversation" {...dropProps}>
      {dragging && (
        <div className="ai-drop-overlay" aria-hidden="true">
          <Upload size={28} />
          <span>Lepaskan file untuk dilampirkan ke percakapan</span>
        </div>
      )}
      {topbar(
        <>
          {canManage ? (
            <button
              type="button"
              className="ai-title-button ai-ripple"
              onClick={() => setSettingsOpen(true)}
              title="Pengaturan percakapan"
            >
              <span>{title}</span>
              <ChevronDown size={16} />
            </button>
          ) : (
            <span className="ai-title-text" title={title}>{title}</span>
          )}
          <div className="ai-topbar-meta">
            {archived && <Badge tone="default">arsip</Badge>}
            <AIVisibilityBadge visibility={session.visibility} />
          </div>
          <div className="ai-topbar-actions">
            <button
              type="button"
              className={`ai-icon-button ai-ripple${workspaceOpen ? ' is-selected' : ''}`}
              onClick={onToggleWorkspace}
              aria-pressed={Boolean(workspaceOpen)}
              aria-label={workspaceOpen ? 'Tutup panel dokumen' : 'Buka panel dokumen, konteks, dan aksi'}
              title={workspaceOpen ? 'Tutup panel dokumen' : 'Dokumen, konteks & aksi'}
            >
              {workspaceOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            </button>
          </div>
        </>,
      )}

      <div className="ai-message-scroll" ref={scrollRef} onScroll={onMessageScroll}>
        <div className="ai-thread">
          {messages.length < (messageMeta.total || 0) && (
            <div className="ai-load-older">
              <button type="button" className="ai-text-button ai-ripple" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? 'Memuat…' : 'Muat pesan lebih lama'}
              </button>
            </div>
          )}

          {!messages.length && !generating && (
            <div className="ai-thread-empty">
              <span className="ai-greeting-mark" aria-hidden="true"><Sparkles size={22} /></span>
              <p>Belum ada pesan. Tulis permintaan pertama Anda di bawah.</p>
            </div>
          )}

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              canExport={canCreateDocument && !archived}
              exportingKey={exportingKey}
              onExport={exportMessage}
              showAuthor={sharedChat && message.role === 'user' && Number(message.createdBy) !== Number(user?.id)}
              canEdit={canEditMessage({ message, userId: user?.id, canSend, generating, archived })}
              onEdit={(text) => send(text, { editMessageId: message.id })}
            />
          ))}

          {sending && streamingText ? (
            <div className="ai-msg is-assistant is-streaming" aria-busy="true">
              <div className="ai-assistant-text"><AIMarkdown>{closeOpenMarkdown(streamingText)}</AIMarkdown></div>
            </div>
          ) : generating && (
            <div className="ai-thinking" role="status" aria-live="polite">
              <span className="ai-thinking-mark" aria-hidden="true"><Sparkles size={18} /></span>
              <span>{toolStatus ? toolStatusLabel(toolStatus) : 'Prakasa AI sedang membaca konteks dan menyiapkan jawaban…'}</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {session.provider === 'gemini' && (
        <div role="note" style={{ padding: '8px 12px', fontSize: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 6, margin: '0 16px 8px' }}>
          Gemini kuota gratis: hanya pesan saat ini yang dikirim ke Google. Jangan tulis data pribadi atau rahasia; dokumen, catatan, dan riwayat percakapan tidak disertakan otomatis.
        </div>
      )}

      <div className="ai-composer-dock">
        <AIComposer
          value={input}
          onChange={setInput}
          onSubmit={() => send()}
          busy={sending}
          canStop={generating && canSend}
          onFiles={canCreateDocument && !archived ? uploadFiles : undefined}
          onStop={stopGeneration}
          stopping={stopping}
          disabled={!canSend || archived || generating}
          sendDisabled={!canSend || !input.trim() || archived || generating}
          placeholder={
            archived
              ? 'Percakapan sudah diarsipkan.'
              : generating
                ? 'Prakasa AI sedang menjawab…'
                : !canSend
                  ? 'Percakapan ini dibagikan sebagai read-only.'
                  : session.visibility === 'department'
                    ? 'Balas ke Prakasa AI… (terlihat oleh anggota divisi)'
                    : 'Balas ke Prakasa AI…'
          }
          tools={(
            <>
              {canCreateDocument && (
                <>
              <input
                ref={fileInputRef}
                type="file"
                className="ai-visually-hidden"
                multiple
                accept={AI_FILE_ACCEPT}
                onChange={(event) => {
                  uploadFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                className="ai-icon-button ai-ripple"
                onClick={() => fileInputRef.current?.click()}
                disabled={archived || generating || uploading}
                aria-label="Lampirkan file"
                title={`Lampirkan file (maks. ${AI_MAX_PENDING_FILES} file, ${formatBytes(AI_MAX_UPLOAD_BYTES)} per file) — bisa juga seret atau tempel`}
              >
                {uploading ? <Loader2 className="ai-spin" size={19} /> : <Paperclip size={19} />}
              </button>
                </>
              )}
              {webCapable && canManage && (
                <AIWebToggle
                  active={Boolean(session.webResearch)}
                  onToggle={toggleWebResearch}
                  disabled={togglingWeb || generating || archived}
                />
              )}
            </>
          )}
          trailing={canManage ? (
            <AIDropdown
              label={switchingEngine ? 'Mengganti…' : engineLabel}
              ariaLabel="Ganti engine AI untuk percakapan ini"
              items={engineMenuItems(providers)}
              value={session.provider}
              onSelect={changeEngine}
              disabled={switchingEngine || generating || archived || providersLoading}
              align="right"
            />
          ) : (
            <span className="ai-engine-static" title="Engine AI percakapan ini">{engineLabel}</span>
          )}
        />
        <p className="ai-disclaimer">
          Prakasa AI dapat membuat kesalahan. Periksa kembali informasi penting. · Powered by Prakasa
        </p>
      </div>

      {settingsOpen && (
        <AISessionSettings
          session={session}
          onClose={() => setSettingsOpen(false)}
          onUpdated={async () => {
            await loadSession();
            onSessionUpdated?.();
          }}
          onArchived={async () => {
            await loadSession();
            onSessionUpdated?.();
          }}
          onDeleted={() => {
            onSessionDeleted?.(session.id);
            onSessionUpdated?.();
          }}
        />
      )}
    </div>
  );
}

/* User text renders as plain text; assistant text renders as sanitized Markdown. */
function MessageItem({ message, canExport, exportingKey, onExport, showAuthor = false, canEdit = false, onEdit }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const time = new Date(message.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  if (message.role === 'system' || message.role === 'tool') {
    return <div className="ai-system-message">{message.content}</div>;
  }

  if (message.role === 'user') {
    if (editing) {
      const submitEdit = () => {
        const text = draft.trim();
        if (!text) return;
        setEditing(false);
        if (text !== message.content.trim()) onEdit?.(text);
      };
      return (
        <div className="ai-msg is-user is-editing">
          <div className="ai-edit-box">
            <textarea
              className="ai-edit-input"
              value={draft}
              autoFocus
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              aria-label="Edit pesan"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setDraft(message.content); setEditing(false); }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitEdit(); }
              }}
            />
            <p className="ai-edit-note">Jawaban setelah pesan ini akan diganti dengan jawaban baru.</p>
            <div className="ai-edit-actions">
              <button type="button" className="ai-text-button ai-ripple" onClick={() => { setDraft(message.content); setEditing(false); }}>Batal</button>
              <button type="button" className="ai-tonal-button ai-ripple" onClick={submitEdit} disabled={!draft.trim()}>Kirim ulang</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="ai-msg is-user">
        {showAuthor && <span className="ai-msg-author">{message.authorName || 'Anggota divisi'}</span>}
        <div className="ai-user-row">
          {canEdit && (
            <button
              type="button"
              className="ai-icon-button is-small ai-ripple ai-edit-trigger"
              onClick={() => { setDraft(message.content); setEditing(true); }}
              aria-label="Edit pesan ini"
              title="Edit pesan"
            >
              <Pencil size={15} />
            </button>
          )}
          <div className="ai-user-bubble" title={time}>{message.content}</div>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('Tidak dapat menyalin ke clipboard', 'error');
    }
  };

  const exportable = canExport && Number.isFinite(Number(message.id));

  return (
    <div className="ai-msg is-assistant">
      <div className="ai-assistant-text"><AIMarkdown>{message.content}</AIMarkdown></div>
      <div className="ai-msg-actions">
        <button
          type="button"
          className="ai-icon-button is-small ai-ripple"
          onClick={copy}
          aria-label={copied ? 'Tersalin' : 'Salin jawaban'}
          title={copied ? 'Tersalin' : 'Salin'}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        {exportable && (
          <div className="ai-export-group" aria-label="Unduh jawaban sebagai dokumen">
            <FileDown size={15} aria-hidden="true" />
            {['pdf', 'docx', 'xlsx'].map((format) => {
              const active = exportingKey === `${message.id}:${format}`;
              return (
                <button
                  key={format}
                  type="button"
                  className="ai-export-chip ai-ripple"
                  disabled={Boolean(exportingKey)}
                  onClick={() => onExport(message, format)}
                  title={`Jadikan ${format.toUpperCase()}`}
                >
                  {active && <Loader2 className="ai-spin" size={12} />}
                  {format.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}
        <span className="ai-msg-meta">
          {time}
          {message.provider && ` · ${message.provider}${message.model ? ` ${message.model}` : ''}`}
        </span>
      </div>
    </div>
  );
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
