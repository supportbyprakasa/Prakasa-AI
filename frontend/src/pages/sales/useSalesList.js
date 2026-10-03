import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { apiError } from './salesModel';

// One page of a Sales list, fetched from the server. Every Sales list pages on
// the API (DataGrid's `meta` + `onPageChange`), so any amount of data can be
// browsed; the search text is sent as `q` and searched on the server too.
// `params` changes (filters, search) go back to page 1.
export default function useSalesList(path, params, { limit = 25, enabled = true } = {}) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: enabled, error: '', rows: [], meta: { page: 1, limit, total: 0 } });
  const key = JSON.stringify(params || {});
  const lastKey = useRef(key);
  const request = useRef(0);

  // New filters start again from the first page.
  const effectivePage = lastKey.current === key ? page : 1;
  useEffect(() => {
    if (lastKey.current !== key) { lastKey.current = key; setPage(1); }
  }, [key]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++request.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const query = Object.fromEntries(Object.entries(JSON.parse(key)).filter(([, v]) => v !== '' && v !== null && v !== undefined));
      const r = await api.get(path, { params: { ...query, page: effectivePage, limit } });
      if (id !== request.current) return;
      setState({
        loading: false, error: '', rows: r.data.data || [],
        meta: { ...(r.data.meta || {}), page: r.data.meta?.page || effectivePage, limit: r.data.meta?.limit || limit, total: r.data.meta?.total ?? 0 },
      });
    } catch (err) {
      if (id !== request.current) return;
      setState((s) => ({ ...s, loading: false, error: apiError(err) }));
    }
  }, [path, key, effectivePage, limit, enabled]);

  useEffect(() => { load(); }, [load]);

  return useMemo(() => ({
    ...state, page: effectivePage, setPage, reload: load,
  }), [state, effectivePage, load]);
}

// Debounced text for server search: the input updates at once, the query
// after the user pauses typing.
export function useDebouncedValue(value, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
