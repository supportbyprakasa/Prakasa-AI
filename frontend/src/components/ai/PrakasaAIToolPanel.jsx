import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, Info, Loader2, ShieldCheck, Sparkles, SquarePen, X } from 'lucide-react';
import api from '../../api/client';
import { toast } from '../Toast';
import { usePrakasaAIToolContext } from '../../context/PrakasaAIToolContext';
import AIConversation from './AIConversation';
import usePointerRipple from './usePointerRipple';
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
import '../../pages/ai/ai-command-center.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

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
    resolved, published, sessionFor, rememberSession,
  } = usePrakasaAIToolContext();
  const location = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const headingRef = useRef(null);
  const resizeStart = useRef(null);
  usePointerRipple(rootRef);

  const key = contextKeyFor(resolved);
  const tool = resolved?.tool;
  const visibleState = sanitizeVisibleState(published?.visibleState, tool?.queryKeys || []);
  const stateKey = JSON.stringify(visibleState);

  const [sessionId, setSessionId] = useState(() => sessionFor(key));
  const [pendingMessage, setPendingMessage] = useState(null);
  const [preview, setPreview] = useState({ loading: true, context: null, error: '' });
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [startingStarter, setStartingStarter] = useState('');
  const [showRules, setShowRules] = useState(false);

  useEffect(() => { headingRef.current?.focus(); }, []);

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

  const handleSessionCreated = async (id, firstMessage, { autoSend = true } = {}) => {
    try {
      await attachAndRemember(id);
    } catch (error) {
      toast(errorMessage(error, 'Konteks halaman gagal dilampirkan; percakapan tetap dibuat tanpa konteks.'), 'error');
      rememberSession(key, id);
      setSessionId(id);
    }
    setPendingMessage(firstMessage ? { sessionId: id, text: firstMessage, autoSend } : null);
  };

  const startWithStarter = async (text) => {
    setStartingStarter(text);
    try {
      const response = await api.post('/ai-command/sessions', {
        title: `Bantu: ${tool.title}`.slice(0, 255),
        visibility: 'private',
      });
      await handleSessionCreated(response.data.data.id, text);
    } catch (error) {
      toast(errorMessage(error, 'Percakapan belum bisa dibuat'), 'error');
    } finally {
      setStartingStarter('');
    }
  };

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
  const actions = (preview.context?.actions || tool.actions || []).filter((action) => action.riskTier !== 'read');
  const subject = subjectLabel(preview.context);

  return (
    <aside
      ref={rootRef}
      className={`pw-ai-panel is-${mode}`}
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
        <span className="pw-ai-panel__mark" aria-hidden="true"><Sparkles size={18} /></span>
        <div className="pw-ai-panel__title">
          <h2 ref={headingRef} tabIndex={-1}>Prakasa AI</h2>
          <span>{tool.title}{subject ? ` · ${subject}` : ''}</span>
        </div>
        <button type="button" className="pw-icon-button pw-state-layer pw-ripple" onClick={newConversation} aria-label="Percakapan baru untuk halaman ini" title="Percakapan baru">
          <SquarePen size={18} aria-hidden="true" />
        </button>
        <button type="button" className="pw-icon-button pw-state-layer pw-ripple" onClick={() => openInCommandCenter()} aria-label="Buka di AI Command Center" title="Buka di AI Command Center">
          <ExternalLink size={18} aria-hidden="true" />
        </button>
        <button type="button" className="pw-icon-button pw-state-layer pw-ripple" onClick={onClose} aria-label="Tutup Prakasa AI" title="Tutup">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <div className="pw-ai-panel__context">
        {preview.loading && <span className="pw-ai-panel__status"><Loader2 size={14} className="ai-spin" aria-hidden="true" /> Menyiapkan konteks halaman…</span>}
        {!preview.loading && preview.error && <span className="pw-ai-panel__status is-error" role="alert">{preview.error}</span>}
        {!preview.loading && !preview.error && (
          <span className="pw-ai-panel__status">
            <ShieldCheck size={14} aria-hidden="true" />
            {subject ? 'AI membaca record ini sesuai izin Anda.' : 'AI membaca halaman ini sesuai izin Anda.'}
          </span>
        )}
        <button type="button" className="pw-ai-panel__rules-toggle" onClick={() => setShowRules((value) => !value)} aria-expanded={showRules}>
          <Info size={14} aria-hidden="true" /> Batas bantuan AI
        </button>
        {showRules && (
          <ul className="pw-ai-panel__rules">
            {actions.map((action) => (
              <li key={action.key}>
                <span className={`pw-ai-tier is-${action.riskTier}`}>{riskTierLabel(action.riskTier)}</span>
                <span><strong>{action.label}</strong> — {actionAvailabilityText(action)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!sessionId && starters.length > 0 && (
        <div className="pw-ai-panel__starters" aria-label="Saran pertanyaan">
          {starters.map((text) => (
            <button
              key={text}
              type="button"
              className="pw-ai-starter pw-state-layer pw-ripple"
              disabled={Boolean(startingStarter) || Boolean(preview.error)}
              onClick={() => startWithStarter(text)}
            >
              {startingStarter === text ? <Loader2 size={14} className="ai-spin" aria-hidden="true" /> : null}
              {text}
            </button>
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
        />
      </div>
    </aside>
  );
}
