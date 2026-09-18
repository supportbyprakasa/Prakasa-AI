import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Input from '../../components/Input';
import Button from '../../components/Button';

const routeFor = (r) => {
  switch (r.type) {
    case 'document': return `/documents?highlight=${r.id}`;
    case 'task': return `/tasks`;
    case 'customer': return `/workspaces?customerId=${r.id}`;
    case 'sales_pipeline': return `/sales/pipeline`;
    case 'meeting': return `/meetings/${r.id}`;
    case 'device': return `/it/devices`;
    case 'subscription': return `/it/subscriptions`;
    case 'finance_workflow': return `/finance/payment-requests/${r.id}`;
    case 'hrga_workflow': return `/hrga/workflows/${r.id}`;
    case 'kb_document': return `/kb`;
    case 'decision_log': return `/decision-log`;
    default: return '#';
  }
};

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const run = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    try {
      const r = await api.get('/search', { params: { q } });
      setRows(r.data.data);
    } finally { setLoading(false); }
  };

  return (
    <div>
      <h2>Global Search</h2>
      <form onSubmit={run} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Cari lintas modul…" style={{ margin: 0, width: 400 }} />
        <Button type="submit" disabled={loading || q.length < 2}>{loading ? 'Mencari…' : 'Cari'}</Button>
      </form>

      {!rows.length && !loading && q.length >= 2 && (
        <div style={{ color: 'var(--color-text-muted)' }}>Tidak ada hasil.</div>
      )}

      {rows.map((r, i) => (
        <div key={i} style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 8, padding: 10, marginBottom: 6, fontSize: 13,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <div>
            <Link to={routeFor(r)}>
              <b>{r.title || r.name || r.label || r.dealTitle || r.productName
                    || r.assetCode || r.employeeFullName || r.requestNumber || r.workflowNumber
                    || `#${r.id}`}</b>
            </Link>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Tipe: {r.type}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
