import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  FileText,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
  X,
} from 'lucide-react';
import AISessionList from '../../components/ai/AISessionList';
import AIConversation from '../../components/ai/AIConversation';
import AIContextPanel from '../../components/ai/AIContextPanel';
import AIActionProposals from '../../components/ai/AIActionProposals';
import AIDocumentWorkspace from '../../components/ai/AIDocumentWorkspace';
import AIAccountMenu from '../../components/ai/AIAccountMenu';
import api from '../../api/client';
import {
  MAX_DOCUMENT_PANEL_WIDTH,
  MIN_DOCUMENT_PANEL_WIDTH,
  clampDocumentPanelWidth,
  normalizeStoredPanelWidth,
  resolveResponsiveMode,
} from './aiCommandCenterModel';
import '../../styles/layout.css';
import './ai-command-center.css';

const PANEL_WIDTH_STORAGE_KEY = 'prakasa-ai-document-panel-width';
const SIDEBAR_COLLAPSED_KEY = 'prakasa-ai-sidebar-collapsed';
const WORKSPACE_OPEN_KEY = 'prakasa-ai-workspace-open';

function readStored(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStored(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* storage disabled */ }
}

function useViewport() {
  const [width, setWidth] = useState(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { width, mode: resolveResponsiveMode(width) };
}

// Material-style ripple that starts at the pointer position of any `.ai-ripple` element.
function usePointerRipple(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onPointerDown = (event) => {
      const target = event.target.closest?.('.ai-ripple');
      if (!target || !root.contains(target) || target.disabled) return;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const size = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;
      target.style.setProperty('--ripple-x', `${x}px`);
      target.style.setProperty('--ripple-y', `${y}px`);
      target.style.setProperty('--ripple-size', `${size}px`);
      target.classList.remove('is-rippling');
      void target.offsetWidth; // restart the animation on rapid repeated clicks
      target.classList.add('is-rippling');
    };

    const onAnimationEnd = (event) => {
      if (event.animationName === 'ai-ripple') event.target.classList.remove('is-rippling');
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('animationend', onAnimationEnd);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('animationend', onAnimationEnd);
    };
  }, [rootRef]);
}

export default function AICommandCenter() {
  const rootRef = useRef(null);
  const { width: viewportWidth, mode } = useViewport();
  const isDesktop = mode === 'desktop';

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingMessage, setPendingMessage] = useState(null);
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [supportTab, setSupportTab] = useState('documents');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStored(SIDEBAR_COLLAPSED_KEY) === '1');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop side panel preference is remembered; the tablet/phone drawer always starts closed.
  const [workspaceOpen, setWorkspaceOpen] = useState(() => readStored(WORKSPACE_OPEN_KEY) === '1');
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => (
    normalizeStoredPanelWidth(readStored(PANEL_WIDTH_STORAGE_KEY), typeof window === 'undefined' ? 1440 : window.innerWidth)
  ));
  const resizeStart = useRef({ pointerX: 0, width: panelWidth });

  usePointerRipple(rootRef);

  useEffect(() => {
    let cancelled = false;
    api.get('/ai-command/providers')
      .then((response) => { if (!cancelled) setProviders(response.data.data || []); })
      .catch(() => { if (!cancelled) setProviders([]); })
      .finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { writeStored(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0'); }, [sidebarCollapsed]);
  useEffect(() => { writeStored(WORKSPACE_OPEN_KEY, workspaceOpen ? '1' : '0'); }, [workspaceOpen]);
  useEffect(() => { if (isDesktop) writeStored(PANEL_WIDTH_STORAGE_KEY, String(panelWidth)); }, [isDesktop, panelWidth]);

  useEffect(() => {
    setPanelWidth((current) => clampDocumentPanelWidth(current, viewportWidth));
  }, [viewportWidth]);

  useEffect(() => {
    if (!isDesktop) return;
    setSidebarOpen(false);
    setWorkspaceDrawerOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const onMove = (event) => {
      const nextWidth = resizeStart.current.width + (resizeStart.current.pointerX - event.clientX);
      setPanelWidth(clampDocumentPanelWidth(nextWidth, window.innerWidth));
    };
    const onEnd = () => setIsResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
    };
  }, [isResizing]);

  // Escape closes the drawers used on tablet and phone.
  useEffect(() => {
    if (isDesktop || (!sidebarOpen && !workspaceDrawerOpen)) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      setWorkspaceDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, sidebarOpen, workspaceDrawerOpen]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/ai-command/sessions/${selectedSessionId}`)
      .then((response) => { if (!cancelled) setSelectedSession(response.data.data); })
      .catch(() => { if (!cancelled) setSelectedSession(null); });
    return () => { cancelled = true; };
  }, [selectedSessionId, refreshKey]);

  const bumpRefresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  const closeDrawers = () => {
    setSidebarOpen(false);
    setWorkspaceDrawerOpen(false);
  };

  const selectSession = (id) => {
    setSelectedSessionId(id);
    closeDrawers();
  };

  const startNewChat = () => {
    setSelectedSessionId(null);
    setPendingMessage(null);
    closeDrawers();
  };

  const handleSessionCreated = (id, firstMessage) => {
    setPendingMessage(firstMessage ? { sessionId: id, text: firstMessage } : null);
    setSelectedSessionId(id);
    closeDrawers();
    bumpRefresh();
  };

  // After an upload/export: show the file on desktop; on small screens only preselect the
  // tab so a full-screen drawer does not cover the conversation unexpectedly.
  const openWorkspace = (tab) => {
    setSupportTab(tab);
    if (isDesktop) setWorkspaceOpen(true);
  };

  const toggleWorkspace = () => {
    if (isDesktop) setWorkspaceOpen((current) => !current);
    else setWorkspaceDrawerOpen((current) => !current);
  };

  const closeWorkspace = () => {
    if (isDesktop) setWorkspaceOpen(false);
    else setWorkspaceDrawerOpen(false);
  };

  const showWorkspace = Boolean(selectedSessionId) && (isDesktop ? workspaceOpen : workspaceDrawerOpen);
  const appStyle = isDesktop ? {
    gridTemplateColumns: `${sidebarCollapsed ? 68 : 280}px minmax(0, 1fr) ${showWorkspace ? `${panelWidth}px` : ''}`.trim(),
  } : undefined;

  const sidebar = (drawer) => (
    <SidebarContent
      collapsed={!drawer && sidebarCollapsed}
      drawer={drawer}
      onToggle={() => (drawer ? setSidebarOpen(false) : setSidebarCollapsed((current) => !current))}
      onNewChat={startNewChat}
      selectedSessionId={selectedSessionId}
      onSelectSession={selectSession}
      refreshKey={refreshKey}
    />
  );

  const supportingPane = (
    <SupportingPane
      supportTab={supportTab}
      setSupportTab={setSupportTab}
      sessionId={selectedSessionId}
      session={selectedSession}
      refreshKey={refreshKey}
      onClose={closeWorkspace}
    />
  );

  return (
    <div
      ref={rootRef}
      className={`ai-app is-${mode}${isResizing ? ' is-resizing' : ''}`}
      style={appStyle}
    >
      {isDesktop ? (
        <aside className={`ai-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label="Navigasi Prakasa AI">
          {sidebar(false)}
        </aside>
      ) : sidebarOpen && (
        <>
          <div className="ai-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="ai-sidebar is-drawer" aria-label="Navigasi Prakasa AI">
            {sidebar(true)}
          </aside>
        </>
      )}

      <main className="ai-main">
        <AIConversation
          sessionId={selectedSessionId}
          providers={providers}
          providersLoading={providersLoading}
          onSessionUpdated={bumpRefresh}
          onSessionDeleted={startNewChat}
          onSessionCreated={handleSessionCreated}
          pendingMessage={pendingMessage}
          onPendingConsumed={() => setPendingMessage(null)}
          onOpenWorkspace={openWorkspace}
          workspaceOpen={showWorkspace}
          onToggleWorkspace={toggleWorkspace}
          onOpenSidebar={isDesktop ? undefined : () => setSidebarOpen(true)}
        />
      </main>

      {showWorkspace && (isDesktop ? (
        <div className="ai-support-region">
          <div
            className="ai-panel-resizer"
            role="separator"
            aria-label="Ubah lebar panel dokumen"
            aria-orientation="vertical"
            aria-valuemin={MIN_DOCUMENT_PANEL_WIDTH}
            aria-valuemax={MAX_DOCUMENT_PANEL_WIDTH}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              resizeStart.current = { pointerX: event.clientX, width: panelWidth };
              setIsResizing(true);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const delta = event.key === 'ArrowLeft' ? 24 : -24;
              setPanelWidth((current) => clampDocumentPanelWidth(current + delta, viewportWidth));
            }}
          />
          {supportingPane}
        </div>
      ) : (
        <>
          <div className="ai-scrim" onClick={closeWorkspace} aria-hidden="true" />
          <div className="ai-support-region is-drawer">{supportingPane}</div>
        </>
      ))}
    </div>
  );
}

function SidebarContent({
  collapsed,
  drawer,
  onToggle,
  onNewChat,
  selectedSessionId,
  onSelectSession,
  refreshKey,
}) {
  const ToggleIcon = drawer ? X : (collapsed ? PanelLeftOpen : PanelLeftClose);
  const toggleLabel = drawer
    ? 'Tutup navigasi'
    : collapsed ? 'Perlebar sidebar' : 'Ringkas sidebar';

  return (
    <>
      <div className="ai-sidebar-header">
        {!collapsed && (
          <Link to="/" className="ai-brand" title="Kembali ke Work OS">
            <span className="ai-brand-mark">P</span>
            <span>Prakasa AI</span>
          </Link>
        )}
        <button
          type="button"
          className="ai-icon-button ai-ripple"
          onClick={onToggle}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <ToggleIcon size={20} />
        </button>
      </div>

      {collapsed ? (
        <div className="ai-rail">
          <button
            type="button"
            className="ai-icon-button ai-ripple"
            onClick={onNewChat}
            aria-label="Percakapan baru"
            title="Percakapan baru"
          >
            <SquarePen size={20} />
          </button>
        </div>
      ) : (
        <AISessionList
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          onNewChat={onNewChat}
          refreshKey={refreshKey}
        />
      )}

      <div className="ai-sidebar-footer">
        <AIAccountMenu compact={collapsed} />
      </div>
    </>
  );
}

function SupportingPane({ supportTab, setSupportTab, sessionId, session, refreshKey, onClose }) {
  return (
    <aside className="ai-support-pane" aria-label="Dokumen, konteks, dan aksi">
      <div className="ai-support-header">
        <div className="ai-support-tabs" role="tablist" aria-label="Panel pendukung">
          <SupportTab active={supportTab === 'documents'} onClick={() => setSupportTab('documents')} icon={FileText} label="Dokumen" />
          <SupportTab active={supportTab === 'context'} onClick={() => setSupportTab('context')} icon={Link2} label="Konteks" />
          <SupportTab active={supportTab === 'actions'} onClick={() => setSupportTab('actions')} icon={ClipboardList} label="Aksi" />
        </div>
        <button
          type="button"
          className="ai-icon-button ai-ripple"
          onClick={onClose}
          aria-label="Tutup panel"
          title="Tutup panel"
        >
          <X size={19} />
        </button>
      </div>
      <div className="ai-support-content" role="tabpanel">
        {supportTab === 'documents' && (
          <AIDocumentWorkspace
            sessionId={sessionId}
            refreshKey={refreshKey}
            onAttachContext={() => setSupportTab('context')}
          />
        )}
        {supportTab === 'context' && (
          <AIContextPanel sessionId={sessionId} session={session} refreshKey={refreshKey} />
        )}
        {supportTab === 'actions' && (
          <AIActionProposals sessionId={sessionId} session={session} refreshKey={refreshKey} />
        )}
      </div>
    </aside>
  );
}

function SupportTab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`ai-support-tab ai-ripple${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}
