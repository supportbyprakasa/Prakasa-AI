import { useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from './endpoint';
import { createRealtimeHub } from './realtimeModel';

// Live updates from GET /realtime/stream over ONE shared fetch-SSE connection per tab
// (Authorization header like aiStream.js — EventSource can't send headers).
// A 401 never logs the user out from here: the stream simply stops.
// Multi-instance backends need a shared bus (Redis pub/sub) — see the contract.

let hub = null;

function getHub() {
  if (hub) return hub;
  hub = createRealtimeHub({
    url: `${apiBaseUrl}/realtime/stream`,
    fetchImpl: (...args) => window.fetch(...args),
    getToken: () => {
      try { return localStorage.getItem('prakasa.token'); } catch { return null; }
    },
    isHidden: () => document.hidden,
  });
  document.addEventListener('visibilitychange', () => hub.onVisibilityChange(document.hidden));
  return hub;
}

/**
 * Subscribe to a server event (e.g. 'tracker'). `handler(data, meta)` — after a
 * reconnect (network drop, tab hidden > 60s) it is called once with
 * (null, { resync: true }) so the caller can refetch everything it shows.
 */
export function useRealtime(eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!eventName) return undefined;
    return getHub().subscribe(eventName, (data, meta) => handlerRef.current?.(data, meta));
  }, [eventName]);
}

/** 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'stopped' */
export function useRealtimeStatus() {
  const [status, setStatus] = useState(() => getHub().getStatus());
  useEffect(() => {
    const h = getHub();
    setStatus(h.getStatus());
    return h.onStatus(setStatus);
  }, []);
  return status;
}
