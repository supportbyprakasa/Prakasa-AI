import { noTranslate } from '../../i18n/NoTranslate';
import { tr } from '../../i18n/tr.js';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { riskTone } from '../statusTone';
import Badge from '../Badge';
import Button from '../Button';
import Chip from '../Chip';
import ConfirmDialog from '../ConfirmDialog';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Spinner from '../Spinner';
import { toast } from '../Toast';
import { useOverlay } from '../useOverlay';
import { useAuth } from '../../context/AuthContext';
import { usePrakasaAIToolContext } from '../../context/PrakasaAIToolContext';
import { hasRouteAccess } from '../navigation';
import AIConversation from './AIConversation';
import AIFormChip from './AIFormChip';
import { createClientToolExecutor } from './aiClientTools';
import aiFormRegistry from './aiFormRegistry';
import { filledCount } from './aiFormModel';
import { pickFiles } from './aiFiles';
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  actionAvailabilityText,
  clampPanelWidth,
  contextKeyFor,
  filterStarters,
  riskTierLabel,
  sanitizeVisibleState,
} from './aiToolModel';
import './ai-components.css';
import './ai-tool-panel.css';

// Risk tier → Badge tone (§3.4 meaning: draft = in progress, needs confirmation =
// attention, human/admin decision = blocked for the AI).
// Shorter than the server's 30 s wait for the page's answer.
const LEAVE_ANSWER_MS = 20000;
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// The forms on the page as one text (a stable snapshot for useSyncExternalStore):
// "<forms open>|<fields the AI filled>|<rows the AI added>".
function formsSnapshot() {
  let fields = 0;
  let rows = 0;
  const forms = aiFormRegistry.list();
  for (const entry of forms) { const count = filledCount(entry); fields += count.fields; rows += count.rows; }
  return `${forms.length}|${fields}|${rows}`;
}

function subjectLabel(context) {
  const facts = context?.subject?.facts;
  if (!facts) return null;
  if (context.subject.type === 'warehouse_movement') {
    return [facts.jenis, facts.referensi || context.route?.params?.id].filter(Boolean).join(' ');
  }
  if (context.subject.type === 'approval_request') return facts.judul || `Approval #${context.route?.params?.id}`;
  return context.subject.sourceRef;
}

export default function PrakasaAIToolPanel({ mode, width, onResize, onClose }) {
  const {
    resolved, published, page, sessionFor, rememberSession, carrySession, draft, takeDraft,
  } = usePrakasaAIToolContext();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const resizeStart = useRef(null);

  const key = contextKeyFor(resolved);
  const tool = resolved?.tool;
  const visibleState = sanitizeVisibleState(published?.visibleState, tool?.queryKeys || []);
  // The standard page context (aiPageContext.js); null on pages that publish nothing.
  const pageKey = JSON.stringify(page || null);
  const stateKey = `${JSON.stringify(visibleState)}|${pageKey}`;

  const [sessionId, setSessionId] = useState(() => sessionFor(key));
  const [pendingMessage, setPendingMessage] = useState(null);
  const [preview, setPreview] = useState({ loading: true, context: null, error: '' });
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [startingStarter, setStartingStarter] = useState('');
  const [showRules, setShowRules] = useState(false);

  // Wave C — Prakasa AI works on the page: it may open an in-app page and fill
  // a form the page registered (aiClientTools.js). It never saves: the user does.
  // Leaving a form with unsaved changes is asked here first; no answer is "stay".
  const [leaveAsk, setLeaveAsk] = useState(null); // { titles, answer }
  const live = useRef({});
  live.current = { location, navigate, permissions: user?.permissions || [], sessionId, carrySession };

  // Phone and tablet (< 1024 px): the panel covers the page, so a form the AI
  // works on would hide the conversation or be hidden by it.
  //   - the AI opened a form and has not filled it yet (it may be asking for
  //     data): the conversation stays on top, with "Lihat formulir";
  //   - the AI filled it: the panel steps aside and a chip over the form says
  //     how much was filled and brings the conversation back.
  // When the form closes, the panel is as before.
  const [formsOpen, filledFields, filledRows] = useSyncExternalStore(aiFormRegistry.subscribe, formsSnapshot).split('|').map(Number);
  const [aiOnForm, setAiOnForm] = useState(false);
  const [showChat, setShowChat] = useState(true);
  useEffect(() => { if (!formsOpen) { setAiOnForm(false); setShowChat(true); } }, [formsOpen]);
  const small = mode !== 'desktop';
  const tucked = small && aiOnForm && formsOpen > 0 && !showChat;
  const raised = small && aiOnForm && formsOpen > 0 && showChat;
  const runClientTool = useMemo(() => createClientToolExecutor({
    registry: aiFormRegistry,
    navigate: (to) => live.current.navigate(to),
    getLocation: () => live.current.location,
    getPermissions: () => live.current.permissions,
    canOpen: hasRouteAccess,
    beforeNavigate: (to) => live.current.carrySession?.(to.pathname, live.current.sessionId),
    onOpened: () => { setAiOnForm(true); setShowChat(true); },
    onFilled: () => { setAiOnForm(true); setShowChat(false); },
    confirmLeave: (titles) => new Promise((resolve) => {
      const timer = window.setTimeout(() => { setLeaveAsk(null); resolve(false); }, LEAVE_ANSWER_MS);
      setLeaveAsk({ titles, answer: (leave) => { window.clearTimeout(timer); setLeaveAsk(null); resolve(leave === true); } });
    }),
  }), []);

  // From 1024px the panel is docked beside the page: non-modal (no focus trap,
  // the page stays usable), Escape closes it while focus is inside it. Below
  // 1024px it covers the page: a modal dialog with a focus trap. Either way
  // closing returns focus to the button that opened it.
  const panelRef = useRef(null);
  const modal = mode !== 'desktop';
  // Over a form's dialog the panel has to be the top overlay again (the dialog
  // opened after it): it leaves the overlay stack for a moment and re-enters.
  const [overlayOn, setOverlayOn] = useState(true);
  useEffect(() => {
    if (!raised) return undefined;
    setOverlayOn(false);
    const timer = window.setTimeout(() => setOverlayOn(true), 0);
    return () => window.clearTimeout(timer);
  }, [raised, formsOpen]);
  useOverlay({
    open: !tucked && overlayOn,
    containerRef: panelRef,
    onEscape: onClose,
    modal,
    escapeWithin: !modal,
    initialFocus: () => headingRef.current,
  });
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/ai-command/providers')
      .then((response) => { if (!cancelled) setProviders(response.data.data || []); })
      .catch(() => { if (!cancelled) setProviders([]); })
      .finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Each page (tool + record) keeps its own assistant conversation for this browser tab.
  useEffect(() => {
    setSessionId(sessionFor(key));
    setPendingMessage(null);
  }, [key, sessionFor]);

  const requestContext = useCallback((targetSessionId = null) => api.post('/ai-command/tool-context', {
    pathname: location.pathname,
    search: location.search || '',
    visibleState,
    ...(page ? { page } : {}),
    ...(targetSessionId ? { sessionId: targetSessionId } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [location.pathname, location.search, stateKey]);

  // Preview what the assistant will see; refresh the attached context when the page changes.
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    setPreview((current) => ({ ...current, loading: true, error: '' }));
    const timer = window.setTimeout(() => {
      requestContext(sessionFor(key))
        .then((response) => { if (!cancelled) setPreview({ loading: false, context: response.data.data, error: '' }); })
        .catch((error) => {
          if (!cancelled) setPreview({ loading: false, context: null, error: errorMessage(error, 'Konteks halaman ini tidak dapat dimuat.') });
        });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key, requestContext, sessionFor]);

  const attachAndRemember = async (id) => {
    await requestContext(id);
    rememberSession(key, id);
    setSessionId(id);
  };

  // `attachments`: files already uploaded for the first message (new-chat
  // screen); `files`: files picked for a starter that works from a document.
  const handleSessionCreated = async (id, firstMessage, { autoSend = true, attachments = [], files = [] } = {}) => {
    try {
      await attachAndRemember(id);
    } catch (error) {
      toast(errorMessage(error, 'Konteks halaman gagal dilampirkan; percakapan tetap dibuat tanpa konteks.'), 'error');
      rememberSession(key, id);
      setSessionId(id);
    }
    setPendingMessage(firstMessage ? { sessionId: id, text: firstMessage, autoSend, attachments, files } : null);
  };

  // A starter that works from a file ("Isi pengajuan reimbursement dari struk
  // atau foto ini" — the server lists them in `attachStarters`): the file
  // picker opens first. With files, the request goes into the message box with
  // them attached; without (picker closed, or the user may not attach), the
  // same text goes there to be finished with pasted text. Nothing is sent here.
  const canAttach = (user?.permissions || []).includes('ai_command.use') && (user?.permissions || []).includes('document.create');

  const startWithStarter = async (text, { fromFile = false, files = [] } = {}) => {
    setStartingStarter(text);
    try {
      const response = await api.post('/ai-command/sessions', {
        title: `Bantu: ${tool.title}`.slice(0, 255),
        visibility: 'private',
      });
      // A starter that ends with "…" is the start of a request the user
      // finishes ("Buatkan tiket IT dari keluhan ini: …"): it goes into the
      // message box instead of being sent.
      const open = /…\s*$/.test(text);
      // The user finishes it in their own interface language.
      if (fromFile) await handleSessionCreated(response.data.data.id, files.length ? tr(text) : `${tr(text)}: `, { autoSend: false, files });
      else await handleSessionCreated(response.data.data.id, open ? tr(text).replace(/…\s*$/, '') : text, { autoSend: !open });
    } catch (error) {
      toast(errorMessage(error, 'Percakapan belum bisa dibuat'), 'error');
    } finally {
      setStartingStarter('');
    }
  };

  // Closing the picker without a file still starts the request, as text.
  const pickFileForStarter = async (text) => {
    const files = canAttach ? await pickFiles() : [];
    startWithStarter(text, { fromFile: true, files });
  };

  // A question handed over by the page ("Tanya Prakasa AI tentang ini" on the
  // home page's morning briefing): it goes into the message box of this page's
  // conversation — a new one when there is none yet — and is never sent here.
  const draftId = draft?.id || null;
  const handledDraft = useRef(null);
  useEffect(() => {
    // Once per question, also when React runs the effect twice (development).
    if (!draftId || !tool || handledDraft.current === draftId) return;
    handledDraft.current = draftId;
    const text = draft.text;
    takeDraft();
    if (sessionId) { setPendingMessage({ sessionId, text, autoSend: false }); return; }
    setStartingStarter(text);
    api.post('/ai-command/sessions', { title: `Bantu: ${tool.title}`.slice(0, 255), visibility: 'private' })
      .then((response) => handleSessionCreated(response.data.data.id, text, { autoSend: false }))
      .catch((error) => toast(errorMessage(error, 'Percakapan belum bisa dibuat'), 'error'))
      .finally(() => setStartingStarter(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const newConversation = () => {
    rememberSession(key, null);
    setSessionId(null);
    setPendingMessage(null);
  };

  const openInCommandCenter = (panel) => {
    if (!sessionId) { navigate('/ai-command'); return; }
    navigate(`/ai-command?session=${sessionId}${panel ? `&panel=${panel}` : ''}`);
  };

  const onResizeStart = (event) => {
    resizeStart.current = { x: event.clientX, width };
    const onMove = (moveEvent) => onResize(clampPanelWidth(resizeStart.current.width + (resizeStart.current.x - moveEvent.clientX)));
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
  };

  if (!tool) return null;

  const starters = filterStarters(preview.context || tool);
  const attachStarters = new Set((preview.context || tool).attachStarters || []);
  const actions = (preview.context?.actions || tool.actions || []).filter((action) => action.riskTier !== 'read');
  const subject = subjectLabel(preview.context);

  return (
    <>
    {tucked ? <AIFormChip filled={{ fields: filledFields, rows: filledRows }} onOpen={() => setShowChat(true)} /> : null}
    <aside
      ref={panelRef}
      tabIndex={-1}
      className={`pw-ai-panel is-${mode}${tucked ? ' is-tucked' : ''}${raised ? ' is-raised' : ''}`}
      style={mode === 'desktop' ? { width } : undefined}
      aria-label="Prakasa AI untuk halaman ini"
      role={mode === 'desktop' ? 'complementary' : 'dialog'}
      aria-modal={mode === 'desktop' ? undefined : 'true'}
    >
      {mode === 'desktop' && (
        <div
          className="pw-ai-panel__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ubah lebar panel Prakasa AI"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onResizeStart}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') onResize(clampPanelWidth(width + 24));
            if (event.key === 'ArrowRight') onResize(clampPanelWidth(width - 24));
          }}
        />
      )}

      <header className="pw-ai-panel__header">
        <span className="pw-ai-panel__mark" aria-hidden="true"><Icon name="auto_awesome" size="md" /></span>
        <div className="pw-ai-panel__title">
          <h2 ref={headingRef} tabIndex={-1}>Prakasa AI</h2>
          <span>{tool.title}{subject ? <> · <span {...noTranslate}>{subject}</span></> : null}</span>
        </div>
        <IconButton label="Percakapan baru" icon="edit_square" onClick={newConversation} aria-label="Percakapan baru untuk halaman ini" />
        <IconButton label="Buka di Pusat perintah AI" icon="open_in_new" onClick={() => openInCommandCenter()} />
        <IconButton label="Tutup" icon="close" onClick={onClose} aria-label="Tutup Prakasa AI" />
      </header>

      {raised ? (
        <div className="pw-ai-panel__form-bar">
          <span>{filledFields || filledRows ? 'Formulir sudah diisi sebagian. Periksa lalu simpan sendiri.' : 'Formulir terbuka di balik percakapan ini.'}</span>
          <Button variant="tonal" icon="edit_note" onClick={() => setShowChat(false)}>Lihat formulir</Button>
        </div>
      ) : null}

      <div className="pw-ai-panel__context">
        {preview.loading && <span className="pw-ai-panel__status"><Icon name="progress_activity" size="sm" spin /> Menyiapkan konteks halaman…</span>}
        {!preview.loading && preview.error && <span className="pw-ai-panel__status is-error" role="alert">{preview.error}</span>}
        {!preview.loading && !preview.error && (
          <span className="pw-ai-panel__status">
            <Icon name="verified_user" size="sm" />
            {subject ? 'AI membaca record ini sesuai izin Anda.' : 'AI membaca halaman ini sesuai izin Anda.'}
          </span>
        )}
        <span className="ai-panel-rules-toggle">
          <Button variant="text" icon="info" onClick={() => setShowRules((value) => !value)} aria-expanded={showRules}>
            {showRules ? 'Sembunyikan batas bantuan AI' : 'Lihat batas bantuan AI'}
          </Button>
        </span>
        {showRules && (
          <ul className="pw-ai-panel__rules">
            {actions.map((action) => (
              <li key={action.key}>
                <span className="ai-panel-tier"><Badge tone={riskTone(action.riskTier)}>{riskTierLabel(action.riskTier)}</Badge></span>
                <span><strong>{action.label}</strong> — {actionAvailabilityText(action)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!sessionId && starters.length > 0 && (
        <div className="pw-ai-panel__starters" aria-label="Saran pertanyaan">
          {starters.map((text) => (
            <Chip
              key={text}
              className="ai-starter-chip"
              icon={startingStarter === text ? <Spinner label={null} /> : undefined}
              disabled={Boolean(startingStarter) || Boolean(preview.error)}
              onClick={() => (attachStarters.has(text) ? pickFileForStarter(text) : startWithStarter(text))}
            >
              {text}
            </Chip>
          ))}
        </div>
      )}

      <div className="ai-app ai-app--embedded is-mobile">
        <AIConversation
          sessionId={sessionId}
          providers={providers}
          providersLoading={providersLoading}
          onSessionUpdated={() => {}}
          onSessionDeleted={newConversation}
          onSessionCreated={handleSessionCreated}
          pendingMessage={pendingMessage}
          onPendingConsumed={() => setPendingMessage(null)}
          onOpenWorkspace={(panel) => openInCommandCenter(panel)}
          workspaceOpen={false}
          onToggleWorkspace={() => openInCommandCenter('documents')}
          surface="panel"
          route={`${location.pathname}${location.search || ''}`}
          onClientTool={runClientTool}
        />
      </div>
      <ConfirmDialog
        open={Boolean(leaveAsk)}
        title="Pindah halaman?"
        message={`Prakasa AI ingin membuka halaman lain, tetapi isian di ${(leaveAsk?.titles || []).join(', ')} belum disimpan dan akan hilang.`}
        confirmLabel="Pindah halaman"
        cancelLabel="Tetap di sini"
        tone="danger"
        onClose={() => leaveAsk?.answer(false)}
        onConfirm={() => leaveAsk?.answer(true)}
      />
    </aside>
    </>
  );
}
