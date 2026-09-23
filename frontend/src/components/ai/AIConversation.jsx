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
  PanelRightOpen,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import api from '../../api/client';
import Badge from '../Badge';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIVisibilityBadge from './AIVisibilityBadge';
import AISessionSettings from './AISessionSettings';
import AIComposer from './AIComposer';
import AIDropdown from './AIDropdown';
import AINewChat from './AINewChat';
import AIMarkdown from './AIMarkdown';
import { engineChipLabel, engineMenuItems } from './aiEngineOptions';
import { isGenerationActive } from '../../pages/ai/aiCommandCenterModel';

const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.png,.jpg,.jpeg,.webp,.txt,.csv,.md,.markdown,.json,.xml,.html,.htm,.rtf';

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
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const consumedPendingRef = useRef(null);

  const scrollToBottom = (behavior = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 30);
  };

  const refreshMessagesAndSession = async () => {
    const [mr, sr] = await Promise.all([
      api.get(`/ai-command/sessions/${sessionId}/messages`, { params: { page: 1, limit: 50 } }),
      api.get(`/ai-command/sessions/${sessionId}`),
    ]);
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

  useEffect(() => { loadSession(); /* eslint-disable-next-line */ }, [sessionId]);

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

  const send = async (textOverride) => {
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

    if (typeof textOverride !== 'string') setInput('');
    setSending(true);

    const optimistic = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((current) => [...current, optimistic]);
    scrollToBottom();

    try {
      await api.post(`/ai-command/sessions/${sessionId}/messages`, { message: text });
      await refreshMessagesAndSession();
      onSessionUpdated?.();
      scrollToBottom();
    } catch (e) {
      const errCode = e.response?.data?.error?.code;
      const status = e.response?.status;
      // Always reload authoritative state. Provider failures occur after the
      // user message has already been persisted by the backend.
      try {
        await refreshMessagesAndSession();
      } catch {
        setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      }

      if (errCode === 'SESSION_BUSY') {
        setInput(text);
        toast('AI masih memproses pesan sebelumnya.', 'error');
      } else if (errCode === 'SESSION_NOT_ACTIVE') {
        setInput(text);
        toast('Percakapan sudah diarsipkan.', 'error');
      } else if (status === 400 || status === 403) {
        setInput(text);
        toast(e.response?.data?.error?.message || 'Pesan tidak dapat dikirim', 'error');
      } else if (errCode === 'AI_PROVIDER_ERROR' || status === 502 || status === 503 || status === 504) {
        toast('Layanan AI sedang tidak dapat dijangkau. Pesan Anda tetap tersimpan di riwayat.', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal mengirim pesan', 'error');
      }
    } finally {
      setSending(false);
    }
  };

  // First message typed on the new-chat screen is sent once the new session is loaded.
  useEffect(() => {
    if (!session || !pendingMessage) return;
    if (Number(pendingMessage.sessionId) !== Number(session.id)) return;
    if (consumedPendingRef.current === session.id) return;
    consumedPendingRef.current = session.id;
    onPendingConsumed?.();
    send(pendingMessage.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pendingMessage]);

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !sessionId) return;
    if (file.size > 25 * 1024 * 1024) {
      toast('Ukuran file maksimum 25 MB', 'error');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    setUploading(true);
    try {
      const response = await api.post(`/ai-command/sessions/${sessionId}/files`, form);
      const artifact = response.data.data;
      const saved = artifact.compressionMethod === 'gzip'
        ? ` Dikompresi dari ${formatBytes(artifact.originalSize)} menjadi ${formatBytes(artifact.storedSize)}.`
        : '';
      const readable = artifact.extractionStatus === 'ready'
        ? ' File siap dibaca AI.'
        : ' File tersimpan, tetapi teksnya belum dapat dibaca AI.';
      toast(`File tersimpan di Shared Drive.${saved}${readable}`, 'success');
      onSessionUpdated?.();
      onOpenWorkspace?.('documents');
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengunggah file', 'error');
    } finally {
      setUploading(false);
    }
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
          providers={providers}
          providersLoading={providersLoading}
          onSessionCreated={onSessionCreated}
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
  const canManage = isOwner && permissions.includes('ai_command.session.manage');
  const canSend = isOwner && permissions.includes('ai_command.use');
  const canCreateDocument = canSend && permissions.includes('document.create');
  const archived = session.status === 'archived';
  const generating = isGenerationActive({ sending, generationStatus: session.generationStatus });
  const title = session.title || `Percakapan #${session.id}`;
  const engineLabel = engineChipLabel(providers, session.provider, session.model);

  return (
    <div className="ai-conversation">
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

      <div className="ai-message-scroll">
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
            />
          ))}

          {generating && (
            <div className="ai-thinking" role="status" aria-live="polite">
              <span className="ai-thinking-mark" aria-hidden="true"><Sparkles size={18} /></span>
              <span>Prakasa AI sedang membaca konteks dan menyiapkan jawaban…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="ai-composer-dock">
        <AIComposer
          value={input}
          onChange={setInput}
          onSubmit={() => send()}
          busy={sending}
          disabled={!canSend || archived || generating}
          sendDisabled={!canSend || !input.trim() || archived || generating}
          placeholder={
            archived
              ? 'Percakapan sudah diarsipkan.'
              : generating
                ? 'Prakasa AI sedang menjawab…'
                : !canSend
                  ? 'Percakapan ini dibagikan sebagai read-only.'
                  : 'Balas ke Prakasa AI…'
          }
          tools={canCreateDocument && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="ai-visually-hidden"
                accept={FILE_ACCEPT}
                onChange={uploadFile}
              />
              <button
                type="button"
                className="ai-icon-button ai-ripple"
                onClick={() => fileInputRef.current?.click()}
                disabled={archived || generating || uploading}
                aria-label="Lampirkan file"
                title="Lampirkan file (maks. 25 MB)"
              >
                {uploading ? <Loader2 className="ai-spin" size={19} /> : <Paperclip size={19} />}
              </button>
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
function MessageItem({ message, canExport, exportingKey, onExport }) {
  const [copied, setCopied] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  if (message.role === 'system' || message.role === 'tool') {
    return <div className="ai-system-message">{message.content}</div>;
  }

  if (message.role === 'user') {
    return (
      <div className="ai-msg is-user">
        <div className="ai-user-bubble" title={time}>{message.content}</div>
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
