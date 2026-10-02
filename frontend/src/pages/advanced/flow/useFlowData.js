import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/client';
import { apiError } from '../../sales/salesModel';

// Loads one Alur & Margin endpoint; a slower answer for parameters the user
// already left never overwrites the newer one.
export default function useFlowData(url, params) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const requestRef = useRef(0);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.get(url, { params: JSON.parse(key) });
      if (request === requestRef.current) setState({ loading: false, error: '', data: res.data.data });
    } catch (err) {
      if (request === requestRef.current) setState({ loading: false, error: apiError(err), data: null });
    }
  }, [url, key]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
