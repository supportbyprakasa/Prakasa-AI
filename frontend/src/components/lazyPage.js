import { lazy } from 'react';

// Route-level code splitting (App.jsx). After a redeploy, a tab opened before
// it still asks for the old hashed chunk names, which no longer exist on the
// server: the import fails. Reload once to pick up the new index.html (served
// no-cache, frontend/public/.htaccess); if the import fails again right after
// that reload, let the ErrorBoundary show the error instead of looping.
const RELOAD_KEY = 'prakasa.chunk-reload-at';
const RELOAD_WINDOW_MS = 30000;

function reloadedRecently() {
  try {
    return Date.now() - Number(window.sessionStorage.getItem(RELOAD_KEY) || 0) < RELOAD_WINDOW_MS;
  } catch {
    return true; // storage blocked: never risk a reload loop
  }
}

export default function lazyPage(load) {
  return lazy(() => load().catch((error) => {
    if (typeof window === 'undefined' || reloadedRecently()) throw error;
    try { window.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
    window.location.reload();
    return new Promise(() => {}); // keep the fallback up until the reload lands
  }));
}
