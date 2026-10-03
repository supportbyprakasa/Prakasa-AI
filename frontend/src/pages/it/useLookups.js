import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { personResults } from './itModel';

// Lookups shared by the IT and directory pages: locations (GET /it/locations)
// and directory entries for holder/manager pickers (GET /people/directory,
// limit 500 as the contract says for pickers). `enabled` = the caller has the
// permission and the picker is on screen; nothing is fetched otherwise.
function useList(url, params, enabled) {
  // `loaded`: the list has answered at least once (rows or an error).
  const [state, setState] = useState({ rows: [], loading: false, error: '', loaded: false });
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const response = await api.get(url, { params: JSON.parse(key) });
      setState({ rows: response.data.data || [], loading: false, error: '', loaded: true });
    } catch (error) {
      setState({ rows: [], loading: false, error: error.response?.data?.error?.message || 'Daftar gagal dimuat.', loaded: true });
    }
  }, [url, key]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { ...state, reload: load };
}

export const useLocations = (enabled = true, includeInactive = false) => useList('/it/locations', includeInactive ? { includeInactive: 1 } : {}, enabled);
export const useDirectoryEntries = (enabled = true) => useList('/people/directory', { limit: 500 }, enabled);
export const useDepartments = (enabled = true) => useList('/departments/options', {}, enabled);

// Select options.
export const locationOptions = (rows, currentId) => (rows || [])
  .filter((l) => l.isActive !== false || String(l.id) === String(currentId || ''))
  // `suffix`: an interface note beside the record's name (components/Select.jsx).
  .map((l) => ({ value: String(l.id), label: l.name, suffix: l.isActive === false ? '(nonaktif)' : undefined }));
export const departmentOptions = (rows) => (rows || []).map((d) => ({ value: String(d.id), label: d.name }));

// Prakasa AI's person lookup over the list a people picker already loaded
// (docs/prakasa-ai-rencana.md §9.9): no request of its own. It waits a moment
// until that list has loaded, then filters it.
export function useDirectorySearch(directory, entries = directory.rows) {
  const latest = useRef({ entries, loaded: directory.loaded });
  latest.current = { entries, loaded: directory.loaded };
  return useCallback(async (text) => {
    for (let waited = 0; !latest.current.loaded && waited < 4000; waited += 150) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 150); });
    }
    return personResults(latest.current.entries, text);
  }, []);
}
