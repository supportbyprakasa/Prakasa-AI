import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Card from '../../components/Card';
import SearchResultCard from '../../components/search/SearchResultCard';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const ALL_TYPES = [
  { value: 'document', label: 'Documents' },
  { value: 'task', label: 'Tasks' },
  { value: 'customer', label: 'Customers' },
  { value: 'sales_pipeline', label: 'Sales Pipeline' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'device', label: 'Devices' },
  { value: 'subscription', label: 'Subscriptions' },
  { value: 'finance_workflow', label: 'Finance' },
  { value: 'hrga_workflow', label: 'HRGA' },
  { value: 'kb_document', label: 'Knowledge Base' },
  { value: 'decision_log', label: 'Decision Logs' },
  { value: 'approval_request', label: 'Approvals' },
  { value: 'signature_request', label: 'Signatures' },
];

const TYPE_PERMISSION = {
  document: 'document.view',
  task: 'task.view',
  customer: 'sales.customer.view',
  sales_pipeline: 'sales.pipeline.view',
  meeting: 'meeting.view',
  device: 'device.view',
  subscription: 'subscription.view',
  finance_workflow: 'finance.view',
  hrga_workflow: 'hrga.view',
  kb_document: 'kb.view',
  decision_log: 'decision_log.view',
  approval_request: 'approval.view',
  signature_request: 'signature.view',
};

const ALLOWED_TYPES_SET = new Set(ALL_TYPES.map((t) => t.value));
const PAGE_SIZE = 20;

function positivePage(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default function GlobalSearch() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const initialQ = params.get('q') || '';
  const initialTypes = (params.get('type') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const initialEntityId = params.get('entityId') || '';
  const initialPage = positivePage(params.get('page'));

  const [q, setQ] = useState(initialQ);
  const [types, setTypes] = useState(initialTypes.filter((t) => ALLOWED_TYPES_SET.has(t)));
  const [entityId, setEntityId] = useState(initialEntityId);
  const [page, setPage] = useState(initialPage);

  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(initialQ.length >= 2);

  const permissions = user?.permissions || [];
  const canCrossEntity = permissions.includes('entity.cross_access');
  const visibleTypes = useMemo(
    () => ALL_TYPES.filter((item) => permissions.includes(TYPE_PERMISSION[item.value])),
    [permissions]
  );

  const writeUrl = useCallback((next) => {
    const p = {};
    if (next.q && next.q.length >= 2) p.q = next.q;
    if (next.types && next.types.length) p.type = next.types.join(',');
    if (next.entityId) p.entityId = String(next.entityId);
    if (next.page && next.page > 1) p.page = String(next.page);
    setParams(p, { replace: true });
  }, [setParams]);

  const runSearch = useCallback(async (opts) => {
    const {
      qq = q, tt = types, ee = entityId, pp = 1,
    } = opts || {};

    const query = String(qq || '').trim();
    const permittedTypeValues = new Set(visibleTypes.map((item) => item.value));
    const safeTypes = Array.isArray(tt)
      ? tt.filter((type) => permittedTypeValues.has(type))
      : [];
    const safeEntityId = canCrossEntity ? ee : '';
    if (query.length < 2) {
      toast('Kata kunci minimal 2 karakter', 'error');
      return;
    }
    setTouched(true);
    setLoading(true);
    setError(null);

    try {
      const p = { q: query, page: pp, limit: PAGE_SIZE };
      if (safeTypes.length) p.type = safeTypes.join(',');
      if (safeEntityId) p.entityId = safeEntityId;

      const r = await api.get('/search', { params: p });
      setResults(r.data.data || []);
      setMeta(r.data.meta || { page: pp, limit: PAGE_SIZE, total: r.data.data?.length || 0 });
      setPage(pp);
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.error?.code;
      setResults([]);
      setMeta({ page: pp, limit: PAGE_SIZE, total: 0 });
      if (status === 403) setError('Anda tidak memiliki akses ke pencarian ini.');
      else if (code === 'VALIDATION_ERROR') setError(e.response?.data?.error?.message || 'Kata kunci tidak valid.');
      else setError(e.response?.data?.error?.message || 'Gagal melakukan pencarian.');
    } finally {
      setLoading(false);
    }
  }, [q, types, entityId, visibleTypes, canCrossEntity]);

  useEffect(() => {
    if (initialQ.length >= 2) {
      runSearch({ qq: initialQ, tt: initialTypes, ee: initialEntityId, pp: initialPage });
    }
    /* eslint-disable-next-line */
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const safeEntityId = canCrossEntity ? entityId : '';
    const permittedTypeValues = new Set(visibleTypes.map((item) => item.value));
    const safeTypes = types.filter((type) => permittedTypeValues.has(type));
    writeUrl({ q, types: safeTypes, entityId: safeEntityId, page: 1 });
    runSearch({ qq: q, tt: safeTypes, ee: safeEntityId, pp: 1 });
  };

  const toggleType = (t) => {
    setTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  };

  const clearAllTypes = () => setTypes([]);

  const goPage = (nextPage) => {
    if (nextPage < 1) return;
    const safeEntityId = canCrossEntity ? entityId : '';
    const permittedTypeValues = new Set(visibleTypes.map((item) => item.value));
    const safeTypes = types.filter((type) => permittedTypeValues.has(type));
    writeUrl({ q, types: safeTypes, entityId: safeEntityId, page: nextPage });
    runSearch({ qq: q, tt: safeTypes, ee: safeEntityId, pp: nextPage });
  };

  const totalPages = useMemo(() => {
    const l = meta.limit || PAGE_SIZE;
    return Math.max(1, Math.ceil((meta.total || 0) / l));
  }, [meta]);

  const resetAll = () => {
    setQ('');
    setTypes([]);
    setEntityId('');
    setPage(1);
    setResults([]);
    setMeta({ page: 1, limit: PAGE_SIZE, total: 0 });
    setError(null);
    setTouched(false);
    setParams({}, { replace: true });
  };

  return (
    <div>
      <h2 style={{ margin: 0, marginBottom: 12 }}>Global Search</h2>

      <form onSubmit={submit} style={{
        display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 320px', position: 'relative', minWidth: 220 }}>
          <SearchIcon size={16} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--color-text-muted)',
          }} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari dokumen, task, customer, device…"
            style={{ margin: 0, paddingLeft: 34 }}
          />
        </div>
        <Button type="submit" disabled={loading || q.trim().length < 2}>
          {loading ? 'Mencari…' : 'Cari'}
        </Button>
        {(q || types.length || entityId) && (
          <Button type="button" variant="secondary" onClick={resetAll}>
            <X size={14} /> Reset
          </Button>
        )}
      </form>

      {/* Type filter chips */}      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12,
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Tipe:</span>
        <button
          type="button"
          onClick={clearAllTypes}
          style={chipStyle(types.length === 0)}
        >
          Semua
        </button>
        {visibleTypes.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => toggleType(t.value)}
            style={chipStyle(types.includes(t.value))}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Cross-entity control (only when permitted) */}
      {canCrossEntity && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          marginBottom: 12, flexWrap: 'wrap',
        }}>
          <Input
            label="Entity ID (opsional)"
            type="number"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="kosong = entity Anda"
            style={{ margin: 0, width: 220 }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', paddingBottom: 8 }}>
            Cari lintas entity (memerlukan <code>entity.cross_access</code>).
          </div>
        </div>
      )}

      {/* Results header */}
      {touched && !loading && !error && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          {meta.total} hasil {q ? <>untuk <b>“{q}”</b></> : null}
          {types.length > 0 && <> · filter: {types.join(', ')}</>}
        </div>
      )}

      {/* Error */}
      {error && (
        <Card>
          <div style={{ padding: 16, fontSize: 13, color: 'var(--color-error)' }}>{error}</div>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {/* Before search */}
      {!touched && !loading && (
        <Card>
          <div style={{
            padding: 24, textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            Cari data lintas modul Work OS.
          </div>
        </Card>
      )}

      {/* Empty */}
      {touched && !loading && !error && !results.length && (
        <Card>
          <div style={{
            padding: 24, textAlign: 'center',
            color: 'var(--color-text-muted)', fontSize: 13,
          }}>
            Tidak ada hasil yang sesuai.
          </div>
        </Card>
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r) => (
            <SearchResultCard
              key={`${r.type}-${r.id}`}
              result={r}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {touched && !loading && results.length > 0 && totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 12, fontSize: 13, color: 'var(--color-text-muted)',
        }}>
          <Button variant="secondary" onClick={() => goPage(page - 1)} disabled={page <= 1}>
            ← Sebelumnya
          </Button>
          <span>Halaman {page} dari {totalPages}</span>
          <Button variant="secondary" onClick={() => goPage(page + 1)} disabled={page >= totalPages}>
            Selanjutnya →
          </Button>
        </div>
      )}
    </div>
  );
}

function chipStyle(active) {
  return {
    padding: '4px 10px', fontSize: 12, borderRadius: 999,
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
    background: active ? 'rgba(31,78,216,.08)' : 'transparent',
    color: active ? 'var(--color-primary)' : 'var(--color-text)',
    cursor: 'pointer', font: 'inherit',
  };
}