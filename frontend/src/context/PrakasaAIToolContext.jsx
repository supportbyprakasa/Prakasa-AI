import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buildPageContext } from '../components/ai/aiPageContext';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { contextKeyFor, resolveToolForPath } from '../components/ai/aiToolModel';

// Knows which registered tool the current route belongs to, which page state a screen
// has chosen to publish, and which assistant conversation belongs to which page.

const PrakasaAIToolContext = createContext(null);
// Only the (stable) function pages and shared components publish with: a
// component that publishes must not re-render every time something is published.
const PrakasaAIPublishContext = createContext(null);

export function PrakasaAIToolProvider({ children }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  // Not while a temporary password must be replaced (the API answers 403 then).
  const enabled = !user?.passwordChangeRequired && (user?.permissions || []).includes('ai_command.use');

  const [catalog, setCatalog] = useState({ tools: [], roleLevel: 'member', loaded: false });
  const [published, setPublished] = useState(null);
  // The standard page context (components/ai/aiPageContext.js), in slots:
  // 'header' (PageHeader), 'grid:<id>' (each DataGrid), 'page' (the page itself).
  const [parts, setParts] = useState(() => new Map());
  const publishPart = useCallback((slot, value) => {
    setParts((current) => {
      const had = current.has(slot);
      if (value == null) {
        if (!had) return current;
        const next = new Map(current);
        next.delete(slot);
        return next;
      }
      if (had && JSON.stringify(current.get(slot)) === JSON.stringify(value)) return current;
      const next = new Map(current);
      next.set(slot, value);
      return next;
    });
  }, []);
  const [open, setOpen] = useState(false);
  // A question another part of the page hands to the assistant ("Tanya Prakasa
  // AI tentang ini"): the panel opens with it in the message box. It is never
  // sent by itself — the user reads it and sends it.
  const [draft, setDraft] = useState(null);
  const ask = useCallback((text) => {
    const question = String(text || '').trim().slice(0, 500);
    if (!question) return;
    setDraft({ text: question, id: Date.now() });
    setOpen(true);
  }, []);
  const takeDraft = useCallback(() => setDraft(null), []);
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

  // Route + title for every page under Layout; nothing at all for a page the
  // registry marks publishesState: false.
  const page = useMemo(() => {
    if (!resolved) return null;
    return buildPageContext({
      resolved,
      pathname,
      search,
      parts: {
        header: parts.get('header') || null,
        page: parts.get('page') || null,
        grids: [...parts.entries()].filter(([slot]) => slot.startsWith('grid:')).map(([, value]) => value),
      },
    });
  }, [resolved, pathname, search, parts]);

  const sessionFor = useCallback((key) => (key ? sessions.current.get(key) || null : null), []);
  const rememberSession = useCallback((key, sessionId) => {
    if (!key) return;
    if (sessionId) sessions.current.set(key, sessionId);
    else sessions.current.delete(key);
  }, []);

  // Wave C: when the AI opens another page while answering, the conversation
  // goes with it — the panel on the new page shows the same chat.
  const carrySession = useCallback((toPathname, sessionId) => {
    const key = contextKeyFor(resolveToolForPath(catalog.tools, toPathname));
    if (key && sessionId) sessions.current.set(key, sessionId);
  }, [catalog.tools]);

  const value = useMemo(() => ({
    enabled,
    loaded: catalog.loaded,
    roleLevel: catalog.roleLevel,
    resolved,
    published: published && resolved && published.toolKey === resolved.tool.key ? published : null,
    publish: setPublished,
    page,
    open,
    setOpen,
    ask,
    draft,
    takeDraft,
    sessionFor,
    rememberSession,
    carrySession,
  }), [enabled, catalog.loaded, catalog.roleLevel, resolved, published, page, open, ask, draft, takeDraft, sessionFor, rememberSession, carrySession]);

  return (
    <PrakasaAIPublishContext.Provider value={enabled ? publishPart : null}>
      <PrakasaAIToolContext.Provider value={value}>{children}</PrakasaAIToolContext.Provider>
    </PrakasaAIPublishContext.Provider>
  );
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

// One slot of the standard page context. Used by the shared building blocks
// (PageHeader → 'header', DataGrid → 'grid:<id>') and by usePublishPrakasaAIPage.
// Outside the provider (login, print views) it does nothing.
export function usePublishPrakasaAIPart(slot, value) {
  const publishPart = useContext(PrakasaAIPublishContext);
  const serialized = value == null ? '' : JSON.stringify(value);
  useEffect(() => {
    if (!publishPart || !slot) return undefined;
    publishPart(slot, serialized ? JSON.parse(serialized) : null);
    return () => publishPart(slot, null);
  }, [publishPart, slot, serialized]);
}

// The one line a list or detail page adds to say more than the shared blocks know:
//   usePublishPrakasaAIPage({ selection: { type: 'task', id, name: task.title }, counts: { terbuka: 4 } });
// Shape: { title?, filters?, selection?: { type, id, name? }, counts?, formState?: { id, dirty } }.
// Never pass money or personal fields: such keys are dropped here and again on the server.
export function usePublishPrakasaAIPage(page) {
  usePublishPrakasaAIPart('page', page || null);
}
