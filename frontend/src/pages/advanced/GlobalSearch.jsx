import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Page from '../../components/Page';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Input from '../../components/Input';
import SearchField from '../../components/SearchField';
import Select from '../../components/Select';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Pager from '../../components/datagrid/Pager';
import SearchResultCard from '../../components/search/SearchResultCard';
import { SEARCH_TYPES, isSearchType, typeSummary } from '../../components/search/searchResultModel';
import { formatNumber } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import './global-search.css';

const PAGE_SIZE = 20;
const MIN_QUERY = 2;
const TOO_SHORT = `Ketik minimal ${MIN_QUERY} karakter`;

export default function GlobalSearch() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const initialQ = params.get('q') || '';
  const initialTypes = (params.get('type') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const initialEntityId = params.get('entityId') || '';
  const initialPage = Math.max(1, Number(params.get('page') || 1));

  const [q, setQ] = useState(initialQ);
  const [queryError, setQueryError] = useState('');
  const [types, setTypes] = useState(initialTypes.filter(isSearchType));
  const [entityId, setEntityId] = useState(initialEntityId);
  const [page, setPage] = useState(initialPage);

  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [searched, setSearched] = useState({ q: '', types: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(initialQ.length >= MIN_QUERY);

  const canCrossEntity = (user?.permissions || []).includes('entity.cross_access');
  // Entity names come from GET /entities, which needs entity.manage; without
  // it (or if it fails) the entity stays a typed ID as before.
  const canListEntities = (user?.permissions || []).includes('entity.manage');
  const [entities, setEntities] = useState(null);
  useEffect(() => {
    if (!canCrossEntity || !canListEntities) return;
    api.get('/entities', { params: { limit: 100 } })
      .then((r) => setEntities((r.data.data || []).map((e) => ({ value: String(e.id), label: e.name }))))
      .catch(() => setEntities(null));
  }, [canCrossEntity, canListEntities]);

  const writeUrl = useCallback((next) => {
    const p = {};
    if (next.q && next.q.length >= MIN_QUERY) p.q = next.q;
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
    if (query.length < MIN_QUERY) {
      setQueryError(TOO_SHORT);
      return;
    }
    setQueryError('');
    setTouched(true);
    setLoading(true);
    setError(null);

    try {
      const p = { q: query, page: pp, limit: PAGE_SIZE };
      if (tt && tt.length) p.type = tt.join(',');
      if (ee) p.entityId = ee;

      const r = await api.get('/search', { params: p });
      setResults(r.data.data || []);
      setMeta(r.data.meta || { page: pp, limit: PAGE_SIZE, total: r.data.data?.length || 0 });
      setSearched({ q: query, types: tt || [] });
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
  }, [q, types, entityId]);

  useEffect(() => {
    if (initialQ.length >= MIN_QUERY) {
      runSearch({ qq: initialQ, tt: initialTypes, ee: initialEntityId, pp: initialPage });
    }
    /* eslint-disable-next-line */
  }, []);

  const submit = (e) => {
    e.preventDefault();
    writeUrl({ q, types, entityId, page: 1 });
    runSearch({ qq: q, tt: types, ee: entityId, pp: 1 });
  };

  // Type chips only change the selection; the search runs on submit (Cari / Enter).
  const toggleType = (t) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const goPage = (nextPage) => {
    if (nextPage < 1) return;
    writeUrl({ q, types, entityId, page: nextPage });
    runSearch({ qq: q, tt: types, ee: entityId, pp: nextPage });
  };

  const totalPages = useMemo(() => {
    const l = meta.limit || PAGE_SIZE;
    return Math.max(1, Math.ceil((meta.total || 0) / l));
  }, [meta]);

  const resetAll = () => {
    setQ('');
    setQueryError('');
    setTypes([]);
    setEntityId('');
    setPage(1);
    setResults([]);
    setMeta({ page: 1, limit: PAGE_SIZE, total: 0 });
    setError(null);
    setTouched(false);
    setParams({}, { replace: true });
  };

  let body;
  if (error) {
    body = (
      <EmptyState
        tone="error"
        title="Pencarian gagal"
        description={error}
        action={<Button variant="secondary" onClick={() => runSearch({ qq: q, tt: types, ee: entityId, pp: page })}>Coba lagi</Button>}
      />
    );
  } else if (loading) {
    body = <LoadingState label="Mencari…" />;
  } else if (!touched) {
    body = <EmptyState icon="search" title="Cari data lintas modul" description={`Ketik kata kunci (minimal ${MIN_QUERY} karakter), lalu tekan Enter atau Cari.`} />;
  } else if (!results.length) {
    body = <EmptyState icon="search_off" title="Tidak ada hasil" description="Coba kata kunci lain atau pilih jenis data yang lain." />;
  } else {
    body = (
      <section className="gs-results" aria-label="Hasil pencarian">
        <div className="gs-results__toolbar">
          <h2 className="pw-title-panel">{formatNumber(meta.total)} hasil untuk “<span data-no-translate="">{searched.q}</span>”</h2>
          {searched.types.length ? <span className="pw-text-helper">Jenis: {typeSummary(searched.types)}</span> : null}
        </div>
        <ul className="pw-search-results">
          {results.map((r) => (
            <SearchResultCard key={`${r.type}-${r.id}`} result={r} currentEntityId={user?.entityId} />
          ))}
        </ul>
        <Pager page={page} pageCount={totalPages} onPageChange={goPage} disabled={loading} label="Halaman hasil pencarian" />
      </section>
    );
  }

  return (
    <Page title="Pencarian" description="Cari dokumen, task, pelanggan, data sales, perangkat, dan data lain yang boleh Anda buka.">
      <form className="gs-form" onSubmit={submit} noValidate>
        <div className="gs-query-block">
          <div className="gs-query">
            <SearchField
              className="gs-query__field"
              label="Kata kunci"
              placeholder="Cari dokumen, task, pelanggan, perangkat…"
              value={q}
              onChange={(e) => { setQ(e.target.value); if (queryError) setQueryError(''); }}
              aria-invalid={queryError ? 'true' : undefined}
              aria-describedby={queryError ? 'gs-query-error' : undefined}
            />
            <Button type="submit" loading={loading}>Cari</Button>
            {(q || types.length || entityId) ? (
              <Button type="button" variant="text" icon="restart_alt" onClick={resetAll}>Setel ulang</Button>
            ) : null}
          </div>
          {queryError ? <p id="gs-query-error" className="gs-query__error" role="alert">{queryError}</p> : null}
        </div>

        <div className="pw-row" role="group" aria-label="Jenis data">
          <Chip selected={types.length === 0} onClick={() => setTypes([])}>Semua</Chip>
          {SEARCH_TYPES.map((t) => (
            <Chip key={t.value} selected={types.includes(t.value)} onClick={() => toggleType(t.value)}>{t.label}</Chip>
          ))}
        </div>

        {canCrossEntity ? (
          <div className="gs-entity">
            {entities ? (
              <Select
                label="Entitas"
                value={entityId}
                placeholder="Entitas saya"
                options={entityId && !entities.some((e) => e.value === String(entityId))
                  ? [...entities, { value: String(entityId), label: `ID ${entityId}` }]
                  : entities}
                dataOptions
                hint="Pilih entitas lain untuk mencari di sana."
                onChange={(e) => setEntityId(e.target.value)}
              />
            ) : (
              <Input
                label="ID entitas"
                type="number"
                min={1}
                value={entityId}
                hint="Nomor ID entitas. Kosongkan untuk mencari di entitas Anda sendiri."
                onChange={(e) => setEntityId(e.target.value)}
              />
            )}
          </div>
        ) : null}
      </form>

      {meta.partial && !error && !loading ? (
        <Banner tone="warning">Sebagian modul gagal dimuat, jadi hasilnya mungkin belum lengkap.</Banner>
      ) : null}

      {body}
    </Page>
  );
}
