import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import PageTrail from './PageTrail';
import Footer from './Footer';
import { useNavConfig } from './Sidebar';
import { pageTrail } from './navigation';
import PrakasaAIAssistButton from './ai/PrakasaAIAssistButton';
import PrakasaAIToolPanel from './ai/PrakasaAIToolPanel';
import { PrakasaAIToolProvider, usePrakasaAIToolContext } from '../context/PrakasaAIToolContext';
import { PANEL_DEFAULT_WIDTH, clampPanelWidth, panelModeForWidth } from './ai/aiToolModel';
import '../styles/layout.css';

const PANEL_WIDTH_KEY = 'prakasa-ai-tool-panel-width';

function readWidth() {
  try { return clampPanelWidth(window.localStorage.getItem(PANEL_WIDTH_KEY) || PANEL_DEFAULT_WIDTH); } catch { return PANEL_DEFAULT_WIDTH; }
}

function usePanelMode() {
  const [mode, setMode] = useState(() => panelModeForWidth(window.innerWidth));
  useEffect(() => {
    const onResize = () => setMode(panelModeForWidth(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mode;
}

function LayoutShell() {
  const { pathname } = useLocation();
  const sections = useNavConfig();
  const ai = usePrakasaAIToolContext();
  const mode = usePanelMode();
  const [width, setWidth] = useState(readWidth);
  const panelOpen = Boolean(ai?.open && ai.resolved);

  useEffect(() => {
    try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(width)); } catch { /* storage disabled */ }
  }, [width]);

  // Escape closes the overlay/full-screen assistant on tablet and phone.
  useEffect(() => {
    if (!panelOpen || mode === 'desktop') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || document.querySelector('.pw-dialog')) return;
      ai.setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, mode, ai]);

  const desktopPanel = panelOpen && mode === 'desktop';
  return (
    <div
      className={`prakasa-layout${desktopPanel ? ' has-ai-panel' : ''}`}
      style={desktopPanel ? { '--pw-ai-panel-width': `${width}px` } : undefined}
    >
      <Navbar />
      <PageTrail trail={pageTrail(pathname, sections)} />
      <main className={`prakasa-layout__main ${pathname === '/' ? 'prakasa-layout__main--home' : ''}`}>
        <Outlet />
      </main>
      <Footer />
      <PrakasaAIAssistButton />
      {panelOpen && mode !== 'desktop' && <div className="pw-ai-scrim" onClick={() => ai.setOpen(false)} aria-hidden="true" />}
      {panelOpen && (
        <PrakasaAIToolPanel mode={mode} width={width} onResize={setWidth} onClose={() => ai.setOpen(false)} />
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
