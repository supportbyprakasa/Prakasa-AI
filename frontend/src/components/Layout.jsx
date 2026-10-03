import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { LoadingState } from './EmptyState';
import lazyPage from './lazyPage';
import PageTrail from './PageTrail';
import Sidebar, { useNavConfig } from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { hasRouteAccess, pageTrail } from './navigation';
import { PrakasaAIToolProvider, usePrakasaAIToolContext } from '../context/PrakasaAIToolContext';
import { PANEL_DEFAULT_WIDTH, clampPanelWidth, panelModeForWidth } from './ai/aiToolModel';
import '../styles/layout.css';

// The assistant panel carries the markdown renderer (~0.5 MB): load it the
// first time the panel opens, not with every page.
const PrakasaAIToolPanel = lazyPage(() => import('./ai/PrakasaAIToolPanel'));

const PANEL_WIDTH_KEY = 'prakasa-ai-tool-panel-width';
const SIDEBAR_COLLAPSED_KEY = 'prakasa-sidebar-collapsed';

// Admin console breakpoints (docs/ui-guideline.md §1.9): from 1024 px the side
// menu is docked at 256 px and ☰ narrows it to the 64 px rail; below 1024 px it
// is hidden and ☰ opens it as a 280 px overlay drawer.
const DOCKED_MIN_WIDTH = 1024;
const DRAWER_EXIT_MS = 300; // --pw-dur-md (250ms) slide-out, with a margin
function sidebarModeFor(width) {
  return width >= DOCKED_MIN_WIDTH ? 'docked' : 'overlay';
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function readCollapsed() {
  try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
}

function readWidth() {
  try { return clampPanelWidth(window.localStorage.getItem(PANEL_WIDTH_KEY) || PANEL_DEFAULT_WIDTH); } catch { return PANEL_DEFAULT_WIDTH; }
}

function LayoutShell() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const sections = useNavConfig();
  const ai = usePrakasaAIToolContext();
  const viewportWidth = useViewportWidth();
  const mode = panelModeForWidth(viewportWidth);
  const sidebarMode = sidebarModeFor(viewportWidth);
  const [width, setWidth] = useState(readWidth);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const panelOpen = Boolean(ai?.open && ai.resolved);

  useEffect(() => {
    try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* storage disabled */ }
  }, [width]);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* storage disabled */ }
  }, [collapsed]);

  useEffect(() => { setDrawerOpen(false); }, [pathname, sidebarMode]);

  // The overlay drawer (< 1024 px) is mounted only while it is open, plus its
  // 250ms slide-out: closed, it would still load its badges (the Sales action
  // count) on every page. It slides in from @starting-style (layout.css).
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => {
    if (drawerOpen) { setDrawerMounted(true); return undefined; }
    const timer = window.setTimeout(() => setDrawerMounted(false), DRAWER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [drawerOpen]);

  const toggleSidebar = useCallback(() => {
    if (sidebarMode === 'docked') setCollapsed((value) => !value);
    else setDrawerOpen((open) => !open);
  }, [sidebarMode]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const sidebarExpanded = sidebarMode === 'docked' ? !collapsed : drawerOpen;

  // Escape, the focus trap (below 1024 px) and focus return of the assistant
  // live in the panel itself (useOverlay in ai/PrakasaAIToolPanel.jsx).

  const desktopPanel = panelOpen && mode === 'desktop';
  // Dialogs are portals on <body>: they read the docked panel's width from the
  // root, and stay beside it (dialog.css --pw-ai-dock).
  useEffect(() => {
    const root = document.documentElement;
    if (desktopPanel) root.style.setProperty('--pw-ai-dock', `${width}px`);
    else root.style.removeProperty('--pw-ai-dock');
    return () => root.style.removeProperty('--pw-ai-dock');
  }, [desktopPanel, width]);
  return (
    <div
      className={`prakasa-layout${desktopPanel ? ' has-ai-panel' : ''}`}
      style={desktopPanel ? { '--pw-ai-panel-width': `${width}px` } : undefined}
    >
      <a className="prakasa-skip" href="#konten">Lewati ke konten</a>
      <Navbar ref={menuButtonRef} onToggleSidebar={toggleSidebar} sidebarExpanded={sidebarExpanded} />
      <div className="prakasa-shell">
        {sidebarMode === 'docked' && <Sidebar collapsed={collapsed} />}
        <div className="prakasa-shell__content">
          <PageTrail trail={pageTrail(pathname, sections)} />
          <main id="konten" className="prakasa-layout__main" tabIndex={-1}>
            {/* Pages are lazy chunks (App.jsx): the shell stays while one loads. */}
            {hasRouteAccess(pathname, user?.permissions)
              ? <Suspense fallback={<LoadingState />}><Outlet /></Suspense>
              : <Navigate to="/" replace />}
          </main>
        </div>
      </div>
      {sidebarMode === 'overlay' && (drawerOpen || drawerMounted) && (
        <Sidebar variant="drawer" open={drawerOpen} onToggle={closeDrawer} onNavigate={closeDrawer} returnFocusRef={menuButtonRef} />
      )}
      {panelOpen && mode !== 'desktop' && <div className="pw-ai-scrim" onClick={() => ai.setOpen(false)} aria-hidden="true" />}
      {panelOpen && (
        <Suspense fallback={null}>
          <PrakasaAIToolPanel mode={mode} width={width} onResize={setWidth} onClose={() => ai.setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

export default function Layout() {
  return (
    <PrakasaAIToolProvider>
      <LayoutShell />
    </PrakasaAIToolProvider>
  );
}
