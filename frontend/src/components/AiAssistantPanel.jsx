import { useState } from 'react';
import api from '../api/client';
import Button from './Button';

export default function AiAssistantPanel({ documentId }) {
  const [action, setAction] = useState('summarize');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError(''); setResult('');
    try {
      const r = await api.post('/ai/document-assistant', { documentId, action });
      setResult(r.data.data.content);
    } catch (e) {
      setError(e.response?.data?.error?.message || e.message);
    } finally { setLoading(false); }
  };

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <h4 style={{ marginTop: 0 }}>Tanya AI</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <option value="summarize">Ringkas</option>
          <option value="check_completeness">Cek kelengkapan</option>
          <option value="check_consistency">Cek konsistensi angka</option>
        </select>
        <Button onClick={run} disabled={loading}>{loading ? 'Memproses…' : 'Jalankan'}</Button>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {result && (
        <pre style={{
          whiteSpace: 'pre-wrap', fontSize: 13, background: '#f8fafc',
          padding: 12, borderRadius: 8, border: '1px solid var(--color-border)', margin: 0,
        }}>{result}</pre>
      )}
    </div>
  );
}
