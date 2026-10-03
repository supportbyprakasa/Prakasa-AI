import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import ProgressBar from '../../components/ProgressBar';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import { IssueTypeIcon } from './TrackerBits';
import {
  apiErrorMessage, barPath, burndownGeometry, categoryLabel, formatDate, shareRows, typeLabel, velocityGeometry, unwrap,
} from './trackerModel';

function useWidth(ref, fallback = 560) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// Share of the total per row as a ProgressBar; the number is always printed,
// the bar is a secondary cue.
function ShareBars({ rows, valueKey, label, render, name, unit }) {
  const list = shareRows(rows, valueKey);
  if (!list.length) return <EmptyState compact icon="bar_chart" description="Belum ada data." />;
  return (
    <ul className="tracker-share" aria-label={label}>
      {list.map((row) => (
        <li key={row.key} className="tracker-share__row">
          <span className="tracker-share__label">{render(row)}</span>
          <ProgressBar value={row.pct} label={`${name(row)}: ${row.pct}%`} className="tracker-share__bar" />
          <span className="tracker-share__value">{row[valueKey]}{unit ? ` ${unit}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function Burndown({ burndown }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);
  const days = burndown?.days || [];
  const g = useMemo(() => burndownGeometry(days, { width, height: 220 }), [days, width]);
  if (!days.length) return <div className="tracker-chart" ref={wrapRef}><EmptyState compact icon="trending_down" description="Burndown tampil setelah sprint aktif berjalan." /></div>;
  const point = active !== null ? g.points[active] : null;
  const last = days[days.length - 1];
  const lastActual = [...g.points].reverse().find((p) => p.remainingPoints !== null && p.remainingPoints !== undefined);
  const summary = `Burndown sprint ${days.length} hari sampai ${formatDate(last.date)}: sisa ${lastActual?.remainingPoints ?? 0} poin per ${formatDate(lastActual?.date) || '-'}, target akhir ${last.idealPoints ?? 0}.`;
  const pick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * g.width;
    let best = 0;
    g.points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(g.points[best].x - x)) best = i; });
    setActive(best);
  };
  const onKeyDown = (event) => {
    const lastIndex = days.length - 1;
    const current = active ?? lastIndex;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: lastIndex }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(lastIndex, next)));
  };
  return (
    <div className="tracker-chart" ref={wrapRef}>
      <ul className="tracker-legend" aria-hidden="true">
        <li><span className="tracker-swatch tracker-swatch--actual" />Sisa poin</li>
        <li><span className="tracker-swatch tracker-swatch--ideal" />Ideal</li>
      </ul>
      <p className="tracker-chart__readout" aria-live="polite">
        {point ? `${formatDate(point.date)}: sisa ${point.remainingPoints ?? '—'} poin · ideal ${point.idealPoints ?? '—'} · ${point.remainingIssues ?? '—'} issue terbuka` : 'Arahkan kursor atau pakai panah kiri/kanan untuk melihat per hari.'}
      </p>
      <svg
        width={g.width}
        height={g.height}
        viewBox={`0 0 ${g.width} ${g.height}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="tracker-chart__svg"
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {g.ticks.map((t) => (
          <g key={t.value}>
            <line className="tracker-chart__grid" x1={g.pad.left} x2={g.width - g.pad.right} y1={t.y} y2={t.y} />
            <text className="tracker-chart__tick" x={g.pad.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
          </g>
        ))}
        {g.labels.map((l) => <text key={l.i} className="tracker-chart__tick" x={l.x} y={g.height - 8} textAnchor="middle">{l.text}</text>)}
        <path className="tracker-chart__ideal" d={g.ideal} />
        <path className="tracker-chart__actual" d={g.actual} />
        {lastActual && !point ? <circle className="tracker-chart__dot" cx={lastActual.x} cy={lastActual.y} r={4} /> : null}
        {point ? (
          <g>
            <line className="tracker-chart__cross" x1={point.x} x2={point.x} y1={g.pad.top} y2={g.baseline} />
            {point.remainingPoints !== null && point.remainingPoints !== undefined
              ? <circle className="tracker-chart__dot" cx={point.x} cy={point.y} r={5} /> : null}
          </g>
        ) : null}
      </svg>
      <ul className="pw-visually-hidden">
        {days.map((d) => <li key={d.date}>{`${formatDate(d.date)}: sisa ${d.remainingPoints ?? '—'} poin, ideal ${d.idealPoints ?? '—'}, ${d.remainingIssues ?? '—'} issue`}</li>)}
      </ul>
    </div>
  );
}

function Velocity({ rows }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);
  const g = useMemo(() => velocityGeometry(rows, { width, height: 200 }), [rows, width]);
  if (!rows?.length) return <div className="tracker-chart" ref={wrapRef}><EmptyState compact icon="bar_chart" description="Velocity tampil setelah ada sprint yang selesai." /></div>;
  const avg = Math.round((rows.reduce((s, r) => s + (Number(r.completedPoints) || 0), 0) / rows.length) * 10) / 10;
  const bar = active !== null ? g.bars[active] : null;
  return (
    <div className="tracker-chart" ref={wrapRef}>
      <p className="tracker-chart__readout" aria-live="polite">
        {bar ? `${bar.name}: ${bar.value} poin selesai` : `Rata-rata ${avg} poin per sprint.`}
      </p>
      <svg width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`Velocity ${rows.length} sprint terakhir, rata-rata ${avg} poin.`} className="tracker-chart__svg">
        {g.ticks.map((t) => (
          <g key={t.value}>
            <line className="tracker-chart__grid" x1={g.pad.left} x2={g.width - g.pad.right} y1={t.y} y2={t.y} />
            <text className="tracker-chart__tick" x={g.pad.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
          </g>
        ))}
        {g.bars.map((b, i) => (
          <g
            key={b.sprintId ?? i}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            className="tracker-chart__bar-hit"
          >
            <rect x={b.x - 6} y={g.pad.top} width={b.w + 12} height={g.baseline - g.pad.top} className="tracker-chart__hit" />
            <path d={barPath(b)} className={`tracker-chart__bar${active === i ? ' is-active' : ''}`} />
            <text className="tracker-chart__tick" x={b.cx} y={g.height - 8} textAnchor="middle" data-no-translate="">{String(b.name || '').slice(0, 12)}</text>
          </g>
        ))}
        <line className="tracker-chart__axis" x1={g.pad.left} x2={g.width - g.pad.right} y1={g.baseline} y2={g.baseline} />
      </svg>
      <ul className="pw-visually-hidden">
        {rows.map((r) => <li key={r.sprintId}>{`${r.name}: ${r.completedPoints ?? 0} poin selesai`}</li>)}
      </ul>
    </div>
  );
}


export default function TrackerReports({ projectId, reloadKey }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const load = useCallback((silent) => {
    if (!silent) setState((s) => ({ ...s, loading: !s.data, error: '' }));
    return api.get(`/tracker/projects/${projectId}/reports`)
      .then((r) => setState({ loading: false, error: '', data: unwrap(r) }))
      .catch((e) => setState((s) => ({ loading: false, error: s.data ? '' : apiErrorMessage(e, 'Laporan gagal dimuat.'), data: s.data })));
  }, [projectId]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => { if (reloadKey) load(true); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <LoadingState label="Memuat laporan…" />;
  if (state.error) return <EmptyState tone="error" title="Laporan gagal dimuat" description={state.error} action={<Button variant="secondary" onClick={() => load(false)}>Coba lagi</Button>} />;
  const d = state.data || {};
  const byStatus = (d.byStatus || []).map((r) => ({ ...r, key: r.category }));
  const byAssignee = (d.byAssignee || []).map((r) => ({ ...r, key: r.email || 'none', total: (r.open || 0) + (r.done || 0) }));
  const byType = (d.byType || []).map((r) => ({ ...r, key: r.type }));

  return (
    <div className="tracker-reports">
      <Card title="Per status">
        <ShareBars rows={byStatus} valueKey="count" label="Jumlah issue per status" unit="issue" name={(r) => categoryLabel(r.category)} render={(r) => `${categoryLabel(r.category)}${r.points ? ` · ${r.points} poin` : ''}`} />
      </Card>
      <Card title="Per tipe">
        <ShareBars rows={byType} valueKey="count" label="Jumlah issue per tipe" name={(r) => typeLabel(r.type)} render={(r) => <IssueTypeIcon type={r.type} withLabel />} />
      </Card>
      <Card title="Per anggota" className="tracker-reports__wide">
        {byAssignee.length ? (
          <>
            {/* The bar is each person's finished share of their own issues. */}
            <ul className="tracker-share" aria-label="Beban kerja per anggota">
              {byAssignee.map((r) => {
                const name = r.name || r.email || 'Belum ditugaskan';
                return (
                  <li key={r.key} className="tracker-share__row">
                    <span className="tracker-share__label" data-no-translate={r.name || r.email ? '' : undefined}>{name}</span>
                    <ProgressBar value={r.done || 0} max={r.total || 1} label={`${name}: ${r.done || 0} dari ${r.total} selesai`} className="tracker-share__bar" />
                    <span className="tracker-share__value">{r.open || 0} terbuka · {r.done || 0} selesai{r.points ? ` · ${r.points} poin` : ''}</span>
                  </li>
                );
              })}
            </ul>
            <p className="pw-text-helper">Batang menunjukkan bagian issue yang sudah selesai.</p>
          </>
        ) : <EmptyState compact icon="group" description="Belum ada issue yang ditugaskan." />}
      </Card>
      <Card title="Burndown sprint aktif" variant="chart" className="tracker-reports__wide tracker-chart-card">
        <Burndown burndown={d.burndown} />
      </Card>
      <Card title="Velocity" variant="chart" className="tracker-reports__wide tracker-chart-card">
        <Velocity rows={d.velocity || []} />
      </Card>
    </div>
  );
}
