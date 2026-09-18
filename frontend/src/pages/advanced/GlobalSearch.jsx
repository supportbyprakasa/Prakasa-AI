import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { SkeletonTable } from '../../components/Skeleton';

const routeFor = (r) => {
  switch (r.type) {
    case 'document': return `/documents?highlight=${r.id}`;
    case 'task': return `/tasks/${r.id}`;
    case 'customer': return `/sales/customers/${r.id}`;
    case 'sales_pipeline': return `/sales/pipeline`;
    case 'meeting': return `/meetings/${r.id}`;
    case 'device': return `/it/devices/${r.id}`;
    case 'subscription': return `/it/subscriptions/${r.id}`;
    case 'finance_workflow': return `/finance/payment-requests/${r.id}`;
    case 'hrga_workflow': return `/hrga/workflows/${r.id}`;
    case 'kb_document': return `/kb`;
    case 'decision_log': return `/decision-log`;
    default: return '#';
  }
};

export default function GlobalSearch() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const run = async (query) => {
    if (!query || query.length < 2) return;
    setLoading(true);
    try {
      const r = await api.get('/search', { params: { q: query } });
      setRows(r.data.data);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const initial = params.get('q') || '';
    if (initial.length >= 2) run(initial);
    /* eslint-disable-next-line */
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setParams({ q });
    run(q);
  };

  return (
    <div>
      <h2>Global Search</h2>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16 }}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari lintas modul…"
          style={{ margin: 0, width: 400 }}
        />
        <Button type="submit" disabled={loading || q.length < 2}>
          {loading ? 'Mencari…' : 'Cari'}
        </Button>
      </form>

      {loading && <SkeletonTable rows={4} columns={1} />}
      {!loading && !rows.length && q.length >= 2 && (
        <div style={{ color: 'var(--color-text-muted)' }}>Tidak ada hasil.</div>
      )}

      {!loading &&
        rows.map((r, i) => (
          <Link key={i} to={routeFor(r)} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 10,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <b>
                {r.title ||
                  r.name ||
                  r.label ||
                  r.dealTitle ||
                  r.productName ||
                  r.assetCode ||
                  r.employeeFullName ||
                  r.requestNumber ||
                  r.workflowNumber ||
                  `#${r.id}`}
              </b>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Tipe: {r.type}</div>
            </div>
          </Link>
        ))}
    </div>
  );
}
