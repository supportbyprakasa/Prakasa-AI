import { useState } from 'react';
import api from '../api/client';
import Button from './Button';
import Card from './Card';
import EmptyState from './EmptyState';
import Select from './Select';
import './ai/ai-components.css';

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
    <Card title="Tanya AI">
      <div className="pw-stack">
        <div className="pw-row ai-doc-assistant__controls">
          <Select
            label="Aksi"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            fieldClassName="pw-grow"
            options={[
              { value: 'summarize', label: 'Ringkas' },
              { value: 'check_completeness', label: 'Cek kelengkapan' },
              { value: 'check_consistency', label: 'Cek konsistensi angka' },
            ]}
          />
          <Button onClick={run} loading={loading}>Jalankan analisis</Button>
        </div>
        {error && (
          <EmptyState
            compact
            tone="error"
            description={error}
            action={<Button variant="secondary" onClick={run}>Coba lagi</Button>}
          />
        )}
        {result && (
          <pre className="ai-doc-assistant__result">{result}</pre>
        )}
      </div>
    </Card>
  );
}
