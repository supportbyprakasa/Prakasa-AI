import { noTranslate, strictTranslate } from '../../i18n/NoTranslate';
import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { streamSessionMessage } from '../../api/aiStream';
import Banner from '../Banner';
import Button from '../Button';
import Chip from '../Chip';
import EmptyState, { LoadingState } from '../EmptyState';
import FormActions from '../FormActions';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Spinner from '../Spinner';
import StatusBadge from '../StatusBadge';
import Textarea from '../Textarea';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIVisibilityBadge from './AIVisibilityBadge';
import AISessionSettings from './AISessionSettings';
import AIComposer from './AIComposer';
import AIDropdown from './AIDropdown';
import AINewChat from './AINewChat';
import AIMarkdown from './AIMarkdown';
import AIWebToggle, { toolStatusLabel } from './AIWebToggle';
import AISteps from './AISteps';
import { runningStep, stepText, upsertStep } from './aiStepsModel';
import useFileDrop from './useFileDrop';
import { engineChipLabel, engineMenuItems } from './aiEngineOptions';
import { EXPORT_FILE_FORMATS, FORMAT_LABELS, artifactMessage, googleExportItems, isNativeFormat } from './aiConversionModel';
import AIAttachmentChips, { AIAttachmentErrors } from './AIAttachmentChips';
import {
  AI_FILE_ACCEPT, AI_MAX_MESSAGE_ATTACHMENTS, AI_MAX_PENDING_FILES, AI_MAX_UPLOAD_BYTES,
  addAttachments, attachmentIdsOf, formatBytes, markFailed, markUploaded, removeAttachment, sentAttachments,
} from './aiFiles';
import './ai-components.css';
import {
  canEditMessage,
  closeOpenMarkdown,
  isGenerationActive,
  messagesAfterEdit,
} from '../../pages/ai/aiCommandCenterModel';
import { dateLocale } from '../../i18n/language.js';

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
  // Wave C: where this conversation is shown ('panel' = beside a page, 'full' =
  // the Command Center), the page the panel is on, and — in the panel only —
  // the function that opens a page or fills a registered form for the AI.
  surface = 'full',
  route = null,
  onClientTool = null,
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
  const [liveSteps, setLiveSteps] = useState([]);
  const [togglingWeb, setTogglingWeb] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Side panel only ("dari dokumen ke formulir", §9.15): the files of the
  // message being written. They are uploaded when the message is sent, and the
  // message names them, so the AI reads exactly these files for this request.
  const panel = surface === 'panel';
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attachErrors, setAttachErrors] = useState([]);
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;
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
  // Attach button, drag and drop, and paste all end here in the side panel.
  const addPanelFiles = (fileList) => {
    if (session && (session.visibility !== 'private' || session.webResearch)) {
      setAttachErrors([{ name: null, text: 'Lampiran hanya bisa dipakai di percakapan pribadi tanpa riset web. Buat percakapan pribadi baru, lalu lampirkan lagi.' }]);
      return;
    }
    const { next, errors } = addAttachments(pendingFilesRef.current, fileList);
    pendingFilesRef.current = next;
    setPendingFiles(next);
    setAttachErrors(errors);
  };
  const { dragging, dropProps } = useFileDrop((files) => (panel ? addPanelFiles(files) : uploadFiles(files)), canDropFiles);

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
  // what the AI is doing until the final answer starts streaming. Agent steps are
  // kept as a timeline above the answer; a notice (e.g. daily limit) is a toast.
  const handleToolStatus = (targetSessionId, status) => {
    if (activeSessionRef.current !== targetSessionId) return;
    if (status?.type === 'notice') {
      toast(status.message, 'info');
      return;
    }
    if (status?.type === 'queue') {
      setToolStatus(status);
      return;
    }
    if (status?.type === 'step') {
      setLiveSteps((current) => upsertStep(current, status));
      if (status.status !== 'running' || !status.label) return;
    }
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
    setLiveSteps([]);
    setSending(false);
    setPendingFiles([]);
    setAttachErrors([]);
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

  // `attachments`: the uploaded files this message carries (side panel).
  const send = async (textOverride, { editMessageId = null, attachments = [] } = {}) => {
    const text = typeof textOverride === 'string' ? textOverride : input;
    const attachmentIds = attachmentIdsOf(attachments);
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
    setLiveSteps([]);
    stickToBottomRef.current = true;

    const optimistic = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdBy: user?.id,
      authorName: user?.name,
      createdAt: new Date().toISOString(),
      _optimistic: true,
      ...(attachmentIds.length ? { attachments: sentAttachments(attachments) } : {}),
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
          surface,
          route,
          onClientTool,
          attachmentIds,
        });
      } catch (streamFailure) {
        // Backends without the stream endpoint still get a complete (non-streamed) reply.
        if (!streamFailure.streamUnavailable) throw streamFailure;
        const response = await api.post(`/ai-command/sessions/${targetSessionId}/messages`, {
          message: text,
          ...(editMessageId ? { editMessageId } : {}),
          ...(attachmentIds.length ? { attachmentIds } : {}),
        });
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
      setLiveSteps([]);
      onSessionUpdated?.();
      await refreshMessagesAndSession();
    } catch (e) {
      if (!stillActive()) return;
      cancelStreamFlush();
      setStreamingText(null);
      setToolStatus(null);
      setLiveSteps([]);
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
        if (attachmentIds.length) setPendingFiles(attachments);
        toast('AI masih memproses pesan sebelumnya.', 'error');
      } else if (errCode === 'SESSION_NOT_ACTIVE') {
        setInput(text);
        toast('Percakapan sudah diarsipkan.', 'error');
      } else if (attachmentIds.length && [400, 403, 404, 409].includes(status)) {
        // The message was refused with its files (not private, too many, a file
        // that is gone): the request and the files come back, with the reason.
        setInput(text);
        setPendingFiles(attachments);
        setAttachErrors([{ name: null, text: e.response?.data?.error?.message || 'Pesan dengan lampiran tidak dapat dikirim.' }]);
      } else if (status === 400 || status === 403) {
        setInput(text);
        toast(e.response?.data?.error?.message || 'Pesan tidak dapat dikirim', 'error');
      } else if (errCode === 'STREAM_INTERRUPTED') {
        toast('Koneksi ke AI terputus. Jawaban akan muncul otomatis bila AI selesai memproses.', 'error');
      } else if (['AI_RATE_LIMITED', 'AI_BUSY', 'AI_PROVIDER_LOGGED_OUT'].includes(errCode)) {
        toast(e.response?.data?.error?.message || e.message || 'Prakasa AI sedang tidak tersedia', 'error');
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
    // A starter that works from a file hands the picked files over with its text.
    if (panel && pendingMessage.files?.length) addPanelFiles(pendingMessage.files);
    // Files already uploaded on the new-chat screen, when the message itself was not sent.
    if (panel && pendingMessage.autoSend === false && pendingMessage.attachments?.length) setPendingFiles(pendingMessage.attachments);
    if (pendingMessage.autoSend === false) setInput(pendingMessage.text);
    else send(pendingMessage.text, { attachments: pendingMessage.attachments || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, pendingMessage]);

  // Side panel: upload the files of this message (one by one: each image is
  // read by AI vision on the way in), then send the message naming them. A file
  // that fails stays on its chip with the reason and nothing is sent.
  const submitWithFiles = async () => {
    const text = input;
    if (!sessionId || !text.trim() || uploading) return;
    const targetSessionId = sessionId;
    setUploading(true);
    setAttachErrors([]);
    let list = pendingFilesRef.current;
    const errors = [];
    for (const item of list) {
      if (item.status === 'uploaded') continue;
      list = list.map((entry) => (entry.key === item.key ? { ...entry, status: 'uploading', error: '' } : entry));
      if (activeSessionRef.current === targetSessionId) setPendingFiles(list);
      const form = new FormData();
      form.append('file', item.file);
      try {
        const response = await api.post(`/ai-command/sessions/${targetSessionId}/files`, form);
        list = markUploaded(list, item.key, response.data.data);
      } catch (error) {
        const message = error.response?.data?.error?.message || 'Gagal mengunggah';
        list = markFailed(list, item.key, message);
        errors.push({ name: item.name, text: message });
      }
      if (activeSessionRef.current === targetSessionId) setPendingFiles(list);
    }
    if (activeSessionRef.current !== targetSessionId) return;
    pendingFilesRef.current = list;
    setUploading(false);
    if (errors.length) {
      setAttachErrors([...errors, { name: null, text: 'Pesan belum dikirim. Hapus atau lampirkan ulang file yang gagal, lalu kirim lagi.' }]);
      return;
    }
    setPendingFiles([]);
    pendingFilesRef.current = [];
    onSessionUpdated?.();
    send(undefined, { attachments: list });
  };

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
      // A Google Doc/Sheet/Slides lives in Drive and opens in its editor; a
      // file is downloaded as well.
      if (!isNativeFormat(format) || !artifact.native) {
        const download = await api.get(artifact.downloadUrl, { responseType: 'blob' });
        downloadBlob(download.data, artifact.originalName || `dokumen-ai.${format}`);
      }
      toast(artifactMessage(artifact.native ? format : (isNativeFormat(format) ? 'docx' : format)), 'success');
      onSessionUpdated?.();
      onOpenWorkspace?.('documents');
    } catch (error) {
      toast(error.response?.data?.error?.message || `Gagal membuat ${FORMAT_LABELS[format] || format.toUpperCase()}`, 'error');
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
        <IconButton label="Buka daftar percakapan" icon="menu" onClick={onOpenSidebar} />
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
          surface={surface}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ai-conversation">
        {topbar(null)}
        <div className="ai-conversation-state">
          <LoadingState label="Memuat percakapan…" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ai-conversation">
        {topbar(null)}
        <div className="ai-conversation-state">
          <EmptyState
            tone="error"
            icon="warning"
            title="Percakapan tidak tersedia"
            description="Periksa kembali akses Anda atau pilih percakapan lain."
            action={<Button variant="secondary" onClick={loadSession}>Coba lagi</Button>}
          />
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
  const filesFull = pendingFiles.length >= AI_MAX_MESSAGE_ATTACHMENTS;
  const attachmentHeader = panel && (pendingFiles.length || attachErrors.length) ? (
    <>
      <AIAttachmentChips
        items={pendingFiles}
        disabled={uploading}
        onRemove={(key) => { setPendingFiles((current) => removeAttachment(current, key)); setAttachErrors([]); }}
      />
      <AIAttachmentErrors errors={attachErrors} onClose={() => setAttachErrors([])} />
      {uploading ? <p className="ai-progress-note" role="status">Mengunggah dan membaca lampiran…</p> : null}
    </>
  ) : null;
  const archived = session.status === 'archived';
  const generating = isGenerationActive({ sending, generationStatus: session.generationStatus });
  const title = session.title || `Percakapan #${session.id}`;
  const engineLabel = engineChipLabel(providers, session.provider, session.model);
  const webCapable = Boolean(providers.find((item) => item.id === session.provider)?.webResearch);

  return (
    <div className="ai-conversation" {...dropProps}>
      {dragging && (
        <div className="ai-drop-overlay" aria-hidden="true">
          <Icon name="upload" size="xl" />
          <span>Lepaskan file untuk dilampirkan ke percakapan</span>
        </div>
      )}
      {topbar(
        <>
          <span className="pw-tooltip-anchor ai-title" data-pw-tooltip={title}>
            <span className="ai-title-text">{title}</span>
          </span>
          {canManage && (
            <IconButton size="sm" label="Pengaturan percakapan" icon="settings" onClick={() => setSettingsOpen(true)} />
          )}
          <div className="ai-topbar-meta">
            {archived && <StatusBadge status={session.status} label="Diarsipkan" />}
            <AIVisibilityBadge visibility={session.visibility} />
          </div>
          <div className="ai-topbar-actions">
            <IconButton
              label={workspaceOpen ? 'Tutup panel dokumen' : 'Dokumen, konteks & aksi'}
              icon={workspaceOpen ? 'right_panel_close' : 'right_panel_open'}
              selected={Boolean(workspaceOpen)}
              onClick={onToggleWorkspace}
              aria-label={workspaceOpen ? 'Tutup panel dokumen' : 'Buka panel dokumen, konteks, dan aksi'}
            />
          </div>
        </>,
      )}

      <div className="ai-message-scroll" ref={scrollRef} onScroll={onMessageScroll}>
        <div className="ai-thread">
          {messages.length < (messageMeta.total || 0) && (
            <div className="ai-load-older">
              <Button variant="text" onClick={loadOlder} loading={loadingOlder}>
                Muat pesan lebih lama
              </Button>
            </div>
          )}

          {!messages.length && !generating && (
            <EmptyState
              icon="auto_awesome"
              description="Belum ada pesan. Tulis permintaan pertama Anda di bawah."
            />
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

          {sending && liveSteps.length ? <AISteps steps={liveSteps} live /> : null}
          {sending && streamingText ? (
            <div className="ai-msg is-assistant is-streaming" aria-busy="true">
              <div className="ai-assistant-text"><AIMarkdown>{closeOpenMarkdown(streamingText)}</AIMarkdown></div>
            </div>
          ) : generating && (
            <div className="ai-thinking" role="status" aria-live="polite">
              <Spinner label={null} />
              <span>
                {runningStep(liveSteps)
                  ? `${stepText(runningStep(liveSteps))}…`
                  : toolStatus?.type === 'queue'
                    ? `Prakasa AI sedang ramai — menunggu giliran (${toolStatus.position} di depan Anda)…`
                    : toolStatus && toolStatus.type !== 'step'
                      ? toolStatusLabel(toolStatus)
                    : 'Prakasa AI sedang membaca konteks dan menyiapkan jawaban…'}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {session.provider === 'gemini' && (
        <div className="ai-provider-note">
          <Banner tone="warning">
            Gemini kuota gratis: hanya pesan saat ini yang dikirim ke Google. Jangan tulis data pribadi atau rahasia; dokumen, catatan, dan riwayat percakapan tidak disertakan otomatis.
          </Banner>
        </div>
      )}

      <div className="ai-composer-dock">
        <AIComposer
          value={input}
          onChange={setInput}
          onSubmit={() => (panel && pendingFiles.length ? submitWithFiles() : send())}
          busy={sending || (panel && uploading)}
          canStop={generating && canSend}
          header={attachmentHeader}
          onFiles={canCreateDocument && !archived ? (panel ? addPanelFiles : uploadFiles) : undefined}
          onStop={stopGeneration}
          stopping={stopping}
          disabled={!canSend || archived || generating || (panel && uploading)}
          sendDisabled={!canSend || !input.trim() || archived || generating || (panel && uploading)}
          placeholder={
            archived
              ? 'Percakapan sudah diarsipkan.'
              : generating
                ? 'Prakasa AI sedang menjawab…'
              : panel && pendingFiles.length
                ? 'Apa yang ingin Anda lakukan dengan file ini?'
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
                className="pw-visually-hidden"
                tabIndex={-1}
                aria-label="Lampirkan file ke percakapan"
                multiple
                accept={AI_FILE_ACCEPT}
                onChange={(event) => {
                  if (panel) addPanelFiles(event.target.files);
                  else uploadFiles(event.target.files);
                  event.target.value = '';
                }}
              />
              <IconButton
                label={panel && filesFull ? `Paling banyak ${AI_MAX_MESSAGE_ATTACHMENTS} lampiran per pesan` : 'Lampirkan file'}
                onClick={() => fileInputRef.current?.click()}
                disabled={archived || generating || uploading || (panel && filesFull)}
                aria-label={panel
                  ? `Lampirkan foto, scan, atau dokumen (maks. ${AI_MAX_MESSAGE_ATTACHMENTS} file per pesan, ${formatBytes(AI_MAX_UPLOAD_BYTES)} per file) — bisa juga seret atau tempel`
                  : `Lampirkan file (maks. ${AI_MAX_PENDING_FILES} file, ${formatBytes(AI_MAX_UPLOAD_BYTES)} per file) — bisa juga seret atau tempel`}
              >
                {uploading ? <Spinner label={null} /> : <Icon name="attach_file" />}
              </IconButton>
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
              dataLabel={!switchingEngine && engineLabel !== 'Engine default'}
              ariaLabel="Ganti engine AI untuk percakapan ini"
              items={engineMenuItems(providers)}
              value={session.provider}
              onSelect={changeEngine}
              disabled={switchingEngine || generating || archived || providersLoading}
              align="right"
            />
          ) : (
            <span className="pw-tooltip-anchor ai-engine-static" data-pw-tooltip="Engine AI percakapan ini">
              <span className="ai-engine-static-text" data-no-translate={engineLabel === 'Engine default' ? undefined : ''}>{engineLabel}</span>
            </span>
          )}
        />
        <p className="ai-disclaimer">
          Prakasa AI dapat membuat kesalahan. Periksa kembali informasi penting. · Didukung Prakasa
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
  const time = new Date(message.createdAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

  if (message.role === 'system' || message.role === 'tool') {
    return <div className="ai-system-message" {...strictTranslate}>{message.content}</div>;
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
            <Textarea
              label="Ubah pesan"
              value={draft}
              autoFocus
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              hint="Jawaban setelah pesan ini akan diganti dengan jawaban baru."
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setDraft(message.content); setEditing(false); }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitEdit(); }
              }}
            />
            <FormActions>
              <Button variant="text" onClick={() => { setDraft(message.content); setEditing(false); }}>Batal</Button>
              <Button onClick={submitEdit} disabled={!draft.trim()}>Kirim ulang</Button>
            </FormActions>
          </div>
        </div>
      );
    }
    return (
      <div className="ai-msg is-user">
        {showAuthor && <span className="ai-msg-author">{message.authorName || 'Anggota divisi'}</span>}
        <div className="ai-user-row">
          {canEdit && (
            <IconButton
              size="sm"
              label="Ubah pesan"
              icon="edit"
              className="ai-edit-trigger"
              onClick={() => { setDraft(message.content); setEditing(true); }}
              aria-label="Ubah pesan ini"
            />
          )}
          <div className="ai-user-bubble" data-pw-tooltip={time} {...noTranslate}>{message.content}</div>
        </div>
        <AIAttachmentChips items={message.attachments} sent />
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
      <AISteps steps={message.steps} />
      <div className="ai-assistant-text"><AIMarkdown>{message.content}</AIMarkdown></div>
      <div className="ai-msg-actions">
        <IconButton size="sm" label={copied ? 'Tersalin' : 'Salin jawaban'} icon={copied ? 'check' : 'content_copy'} onClick={copy} />
        {exportable && (
          <div className="ai-export-group" role="group" aria-label="Jadikan jawaban sebuah dokumen">
            <Icon name="download" />
            {EXPORT_FILE_FORMATS.map((format) => {
              const active = exportingKey === `${message.id}:${format}`;
              return (
                <Chip
                  key={format}
                  icon={active ? <Spinner label={null} /> : undefined}
                  tooltip={exportingKey ? undefined : `Jadikan ${FORMAT_LABELS[format]}`}
                  disabled={Boolean(exportingKey)}
                  onClick={() => onExport(message, format)}
                >
                  {FORMAT_LABELS[format]}
                </Chip>
              );
            })}
            <AIDropdown
              icon={exportingKey.startsWith(`${message.id}:g`) ? <Spinner label={null} /> : undefined}
              label="Google"
              ariaLabel="Jadikan Google Doc, Sheet, atau Slides"
              items={googleExportItems()}
              value={null}
              onSelect={(format) => onExport(message, format)}
              disabled={Boolean(exportingKey)}
              placement="bottom"
            />
          </div>
        )}
        <span className="ai-msg-meta">
          {time}
          {message.provider && <>{' · '}<span {...noTranslate}>{`${message.provider}${message.model ? ` ${message.model}` : ''}`}</span></>}
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
