import { useEffect, useRef, useState } from 'react';
import { Send, Settings, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../api/client';
import Button from '../Button';
import Badge from '../Badge';
import { SkeletonCard } from '../Skeleton';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIVisibilityBadge from './AIVisibilityBadge';
import AISessionSettings from './AISessionSettings';

export default function AIConversation({ sessionId, onSessionUpdated, onSessionDeleted }) {
  const { user } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageMeta, setMessageMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef(null);

  const loadSession = async () => {
    if (!sessionId) {
      setSession(null);
      setMessages([]);
      setMessageMeta({ page: 1, limit: 50, total: 0 });
      return;
    }
    setLoading(true);
    try {
      const [sr, mr] = await Promise.all([
        api.get(`/ai-command/sessions/${sessionId}`),
        api.get(`/ai-command/sessions/${sessionId}/messages`, {
          params: { page: 1, limit: 50 },
        }),
      ]);
      setSession(sr.data.data);
      setMessages(mr.data.data || []);
      setMessageMeta(mr.data.meta || { page: 1, limit: 50, total: mr.data.data?.length || 0 });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 30);
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (e.response?.status === 403) {
        toast('Anda tidak punya akses ke percakapan ini', 'error');
      } else if (e.response?.status === 404) {
        toast('Percakapan tidak ditemukan', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal memuat percakapan', 'error');
      }
      setSession(null); setMessages([]);
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

  const send = async () => {
    if (!sessionId || !input.trim()) return;
    if (session?.status !== 'active') {
      toast('Percakapan sudah diarsipkan.', 'error');
      return;
    }
    if (session?.generationStatus === 'generating') {
      toast('AI masih memproses pesan sebelumnya.', 'error');
      return;
    }

    const text = input;
    setInput('');
    setSending(true);

    // Optimistic user message
    const optimistic = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((m) => [...m, optimistic]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);

    try {
      const r = await api.post(`/ai-command/sessions/${sessionId}/messages`, {
        message: text,
      });
      // Reload to get authoritative list (keeps ordering + ids)
      const mr = await api.get(`/ai-command/sessions/${sessionId}/messages`, {
        params: { page: 1, limit: 50 },
      });
      setMessages(mr.data.data || []);
      setMessageMeta(mr.data.meta || { page: 1, limit: 50, total: mr.data.data?.length || 0 });
      // Refresh session metadata (lastMessageAt, generationStatus)
      const sr = await api.get(`/ai-command/sessions/${sessionId}`);
      setSession(sr.data.data);
      onSessionUpdated?.();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    } catch (e) {
      const errCode = e.response?.data?.error?.code;
      const status = e.response?.status;
      // Always reload authoritative state. Provider failures occur after the
      // user message has already been persisted by the backend.
      try {
        const [mr, sr] = await Promise.all([
          api.get(`/ai-command/sessions/${sessionId}/messages`, {
            params: { page: 1, limit: 50 },
          }),
          api.get(`/ai-command/sessions/${sessionId}`),
        ]);
        setMessages(mr.data.data || []);
        setMessageMeta(mr.data.meta || { page: 1, limit: 50, total: mr.data.data?.length || 0 });
        setSession(sr.data.data);
      } catch {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      }

      if (errCode === 'SESSION_BUSY') {
        setInput(text);
        toast('AI masih memproses pesan sebelumnya.', 'error');
      } else if (errCode === 'SESSION_NOT_ACTIVE') {
        setInput(text);
        toast('Percakapan sudah diarsipkan.', 'error');
      } else if (errCode === 'AI_PROVIDER_ERROR' || status === 502 || status === 503 || status === 504) {
        toast('Layanan AI sedang tidak dapat dijangkau. Coba lagi.', 'error');
      } else {
        toast(e.response?.data?.error?.message || 'Gagal mengirim pesan', 'error');
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /* -------------------------- Empty state -------------------------- */
  if (!sessionId) {
    return (
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        padding: 24, color: 'var(--color-text-muted)', fontSize: 14,
      }}>
        <div style={{ textAlign: 'center' }}>
          <Sparkles size={36} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>Pilih percakapan atau buat percakapan baru.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ flex: 1, padding: 24 }}>
        <SkeletonCard lines={8} />
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        padding: 24, color: 'var(--color-text-muted)', fontSize: 14,
      }}>
        <div style={{ textAlign: 'center' }}>
          <AlertTriangle size={28} style={{ color: 'var(--color-warning)' }} />
          <div style={{ marginTop: 8 }}>Percakapan tidak tersedia.</div>
        </div>
      </div>
    );
  }

  const isOwner = Number(session.ownerUserId) === Number(user?.id);
  const canManage =
    isOwner && (user?.permissions || []).includes('ai_command.session.manage');
  const canSend =
    isOwner && (user?.permissions || []).includes('ai_command.use');
  const archived = session.status === 'archived';
  const generating = session.generationStatus === 'generating';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: 12, borderBottom: '1px solid var(--color-border)',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.title || `Percakapan #${session.id}`}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <AIVisibilityBadge visibility={session.visibility} />
            {archived && <Badge tone="default">arsip</Badge>}
            {generating && <Badge tone="warning">memproses…</Badge>}
            {session.provider && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {session.provider}{session.model ? ` · ${session.model}` : ''}
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Pengaturan"
            style={{
              width: 36, height: 36, borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Settings size={14} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.length < (messageMeta.total || 0) && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <Button variant="secondary" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Memuat…' : 'Muat pesan lebih lama'}
            </Button>
          </div>
        )}

        {!messages.length && (
          <div style={{
            textAlign: 'center', color: 'var(--color-text-muted)',
            fontSize: 13, marginTop: 40,
          }}>
            Mulai percakapan dengan AI.
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {generating && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--color-text-muted)', fontSize: 13, marginTop: 8,
          }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            AI sedang memproses…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div style={{
        padding: 12, borderTop: '1px solid var(--color-border)',
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={archived || sending || generating}
          placeholder={
            archived
              ? 'Percakapan sudah diarsipkan.'
              : generating
                ? 'AI sedang memproses…'
                : !canSend
                  ? 'Session dibagikan sebagai read-only.'
                  : 'Tulis pesan… (Enter untuk kirim, Shift+Enter baris baru)'
          }
          style={{
            flex: 1, minHeight: 42, maxHeight: 200,
            padding: 10, borderRadius: 10,
            border: '1px solid var(--color-border)',
            fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
            background: archived ? '#f8fafc' : '#fff',
          }}
        />
        <Button
          onClick={send}
          disabled={!canSend || !input.trim() || archived || sending || generating}
        >
          <Send size={14} /> Kirim
        </Button>
      </div>

      {settingsOpen && (
        <AISessionSettings
          session={session}
          onClose={() => setSettingsOpen(false)}
          onUpdated={loadSession}
          onArchived={() => onSessionUpdated?.()}
          onDeleted={() => {
            onSessionDeleted?.(session.id);
            onSessionUpdated?.();
          }}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ============================================================
   Message bubble — safe plain text
   ============================================================ */

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system' || message.role === 'tool';

  if (isSystem) {
    return (
      <div style={{
        fontSize: 11, color: 'var(--color-text-muted)',
        textAlign: 'center', margin: '8px 0',
        fontStyle: 'italic',
      }}>
        {message.content}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '80%',
        padding: '10px 12px',
        borderRadius: 12,
        background: isUser ? 'var(--color-primary)' : '#f1f5f9',
        color: isUser ? '#fff' : 'var(--color-text)',
        fontSize: 14, lineHeight: 1.55,
      }}>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.content}
        </div>
        <div style={{
          fontSize: 10, marginTop: 6,
          opacity: isUser ? 0.75 : 0.6,
          textAlign: isUser ? 'right' : 'left',
          display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
          gap: 6, flexWrap: 'wrap',
        }}>
          <span>{new Date(message.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
          {isAssistant && message.provider && (
            <span>· {message.provider}{message.model ? ` ${message.model}` : ''}</span>
          )}
          {isAssistant && message.tokensOut != null && (
            <span>· {message.tokensOut} tok</span>
          )}
        </div>
      </div>
    </div>
  );
}