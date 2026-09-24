import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { resolveToolForPath } from '../components/ai/aiToolModel';

// Knows which registered tool the current route belongs to, which page state a screen
// has chosen to publish, and which assistant conversation belongs to which page.

const PrakasaAIToolContext = createContext(null);

export function PrakasaAIToolProvider({ children }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const enabled = (user?.permissions || []).includes('ai_command.use');

  const [catalog, setCatalog] = useState({ tools: [], roleLevel: 'member', loaded: false });
  const [published, setPublished] = useState(null);
  const [open, setOpen] = useState(false);
  const sessions = useRef(new Map());

  useEffect(() => {
    if (!enabled) {
      setCatalog({ tools: [], roleLevel: 'member', loaded: true });
      return undefined;
    }
    let cancelled = false;
    api.get('/ai-command/tools')
      .then((response) => {
        if (!cancelled) setCatalog({ ...response.data.data, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setCatalog({ tools: [], roleLevel: 'member', loaded: true });
      });
    return () => { cancelled = true; };
  }, [enabled, user?.id]);

  const resolved = useMemo(
    () => (enabled ? resolveToolForPath(catalog.tools, pathname) : null),
    [enabled, catalog.tools, pathname],
  );

  const sessionFor = useCallback((key) => (key ? sessions.current.get(key) || null : null), []);
  const rememberSession = useCallback((key, sessionId) => {
    if (!key) return;
    if (sessionId) sessions.current.set(key, sessionId);
    else sessions.current.delete(key);
  }, []);

  const value = useMemo(() => ({
    enabled,
    loaded: catalog.loaded,
    roleLevel: catalog.roleLevel,
    resolved,
    published: published && resolved && published.toolKey === resolved.tool.key ? published : null,
    publish: setPublished,
    open,
    setOpen,
    sessionFor,
    rememberSession,
  }), [enabled, catalog.loaded, catalog.roleLevel, resolved, published, open, sessionFor, rememberSession]);

  return <PrakasaAIToolContext.Provider value={value}>{children}</PrakasaAIToolContext.Provider>;
}

export const usePrakasaAIToolContext = () => useContext(PrakasaAIToolContext);

// A screen can describe what the user is looking at (allow-listed filters, status, etc.).
// The server still loads the record itself; this only helps it know what is on screen.
export function usePublishPrakasaAIContext({ toolKey, subjectType = null, subjectId = null, visibleState = null }) {
  const context = useContext(PrakasaAIToolContext);
  const publish = context?.publish;
  const serialized = JSON.stringify(visibleState || {});

  useEffect(() => {
    if (!publish || !toolKey) return undefined;
    publish({ toolKey, subjectType, subjectId, visibleState: JSON.parse(serialized) });
    return () => publish((current) => (current?.toolKey === toolKey && current?.subjectId === subjectId ? null : current));
  }, [publish, toolKey, subjectType, subjectId, serialized]);
}
