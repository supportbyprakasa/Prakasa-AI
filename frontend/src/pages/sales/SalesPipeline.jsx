import { useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import { toast } from '../../components/Toast';

const STAGES = [
  { key: 'new_inquiry', label: 'New Inquiry' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'need_follow_up', label: 'Need Follow-up' },
  { key: 'sample_requested', label: 'Sample Requested' },
  { key: 'quotation_sent', label: 'Quotation Sent' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'on_hold', label: 'On Hold' },
];

export default function SalesPipeline() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/sales/pipeline');
      setRows(r.data.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const moveStage = async (id, stage) => {
    try {
      await api.patch(`/sales/pipeline/${id}/stage`, { stage });
      toast('Stage dipindah', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <h2>Sales Pipeline</h2>
      {loading && <div style={{ color: 'var(--color-text-muted)' }}>Memuat…</div>}
      {!loading && !rows.length && (
        <div style={{ color: 'var(--color-text-muted)' }}>Belum ada deal. Buat pipeline baru dari halaman Customer.</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto' }}>
        {STAGES.map((s) => (
          <div key={s.key} style={{ background: '#f1f5f9', borderRadius: 12, padding: 10, minHeight: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              {s.label} <span style={{ color: 'var(--color-text-muted)' }}>
                ({rows.filter((r) => r.stage === s.key).length})
              </span>
            </div>
            {rows.filter((r) => r.stage === s.key).map((d) => (
              <div key={d.id} style={{
                background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-border)',
                borderRadius: 8, padding: 10, marginBottom: 6, fontSize: 13,
              }}>
                <div style={{ fontWeight: 500 }}>{d.dealTitle}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{d.customerName}</div>
                {d.estimatedValue && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Rp {Number(d.estimatedValue).toLocaleString('id-ID')}
                  </div>
                )}
                <select
                  value={d.stage}
                  onChange={(e) => moveStage(d.id, e.target.value)}
                  style={{ marginTop: 6, fontSize: 11, width: '100%' }}
                >
                  {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
            ))}
            {!rows.some((r) => r.stage === s.key) && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Kosong</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
