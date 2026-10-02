import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';

const EMPTY = { departments: [], people: [], locations: [], subscriptions: [], users: [], pic: { itUserId: null, gaUserId: null } };

// GET /hrga/lookups (hrga.view): departments, directory people, locations,
// active subscriptions, app users and the IT/GA PIC for the HRGA pickers.
// Fetched only while `enabled` (a dialog that needs them is open).
export default function useHrgaLookups(enabled) {
  const [state, setState] = useState({ data: EMPTY, loading: false, error: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/hrga/lookups');
      setState({ data: { ...EMPTY, ...(r.data.data || {}) }, loading: false, error: '' });
    } catch (error) {
      setState({ data: EMPTY, loading: false, error: error.response?.data?.error?.message || 'Pilihan gagal dimuat.' });
    }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { ...state.data, loading: state.loading, error: state.error, reload: load };
}
