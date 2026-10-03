import { useEffect, useState } from 'react';
import api from '../api/client';

// Count of urgent Sales work for the caller (dormant customers, orders to ship,
// late invoices), shown as a badge on the Sales Pipeline menu item. Refreshed
// every few minutes, when the window regains focus, and right after a Sales
// change in this tab (salesChanged()).
const REFRESH_MS = 5 * 60 * 1000;
const EVENT = 'sales:changed';

export function salesChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export default function useSalesActionBadge(enabled) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    let alive = true;
    const load = () => api.get('/sales/actions/count')
      .then((r) => { if (alive) setCount(r.data.data.badge || 0); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener(EVENT, load);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(EVENT, load);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);
  return count;
}
