import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import Segmented from '../../components/Segmented';
import {
  barPath, donutGeometry, groupedBarGeometry, issueComposition, trendGeometry, trendRows,
} from './trackerModel';

// Inline SVG charts for the management portfolio — same contract as the report
// charts in TrackerReports: pure geometry from trackerModel, an accessible name,
// a live readout, and every number also printed as text (colour is never alone).

function useWidth(ref, fallback = 520) {
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

function Legend({ items }) {
  return (
    <ul className="tracker-legend" aria-hidden="true">
      {items.map((item) => (
        <li key={item.key}><span className={`tracker-swatch tracker-swatch--${item.tone}`} />{item.label}</li>
      ))}
    </ul>
  );
}

// 1 — Donut: composition of the issue pile right now.
export function IssueDonut({ totals, projects }) {
  const [active, setActive] = useState(null);
  const slices = useMemo(() => issueComposition(totals, projects), [totals, projects]);
  const g = useMemo(() => donutGeometry(slices, { size: 168, thickness: 22 }), [slices]);
  const arc = g.arcs.find((a) => a.key === active) || null;
  const summary = g.empty
    ? 'Komposisi issue: belum ada issue.'
    : `Komposisi ${g.total} issue: ${g.arcs.map((a) => `${a.label} ${a.value} (${a.pct}%)`).join(', ')}.`;

  return (
    <div className="tracker-chart tracker-donut">
      <p className="tracker-chart__readout" aria-live="polite">
        {g.empty
          ? 'Belum ada issue.'
          : (arc ? `${arc.label}: ${arc.value} issue (${arc.pct}%)` : `Total ${g.total} issue · arahkan kursor ke sebuah bagian.`)}
      </p>
      <div className="tracker-donut__body">
        <svg
          width={g.size}
          height={g.size}
          viewBox={`0 0 ${g.size} ${g.size}`}
          role="img"
          aria-label={summary}
          className="tracker-chart__svg tracker-donut__svg"
        >
          <g transform={`rotate(-90 ${g.cx} ${g.cy})`}>
            <circle className="tracker-donut__track" cx={g.cx} cy={g.cy} r={g.radius} strokeWidth={g.thickness} />
            {g.arcs.map((a) => (a.length ? (
              <g
                key={a.key}
                className="tracker-chart__bar-hit"
                onPointerEnter={() => setActive(a.key)}
                onPointerLeave={() => setActive(null)}
              >
                <circle
                  className={`tracker-donut__arc tracker-donut__arc--${a.tone}${active === a.key ? ' is-active' : ''}`}
                  cx={g.cx}
                  cy={g.cy}
                  r={g.radius}
                  strokeWidth={g.thickness}
                  strokeDasharray={a.dash}
                  strokeDashoffset={a.dashOffset}
                />
              </g>
            ) : null))}
          </g>
          <text className="tracker-donut__total" x={g.cx} y={g.cy + 2} textAnchor="middle">{g.total}</text>
          <text className="tracker-donut__caption" x={g.cx} y={g.cy + 20} textAnchor="middle">issue</text>
        </svg>
        <ul className="tracker-donut__legend">
          {g.arcs.map((a) => (
            <li key={a.key}>
              <span className={`tracker-swatch tracker-swatch--${a.tone}`} aria-hidden="true" />
              <span className="tracker-donut__legend-label">{a.label}</span>
              <span className="tracker-donut__legend-value">{a.value} · {a.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="pw-text-helper tracker-donut__note">Setiap issue dihitung satu kali, sesuai statusnya saat ini.</p>
    </div>
  );
}

const DIVISION_SERIES = [
  { key: 'open', label: 'Belum selesai', tone: 'todo' },
  { key: 'inProgress', label: 'Dikerjakan', tone: 'in-progress' },
  { key: 'done', label: 'Selesai', tone: 'done' },
];
const MAX_DIVISIONS = 8;

// 2 — Grouped bars per division. Three separate measures side by side (never
// stacked: `open` already contains `inProgress`, so a sum would double-count).
export function DivisionBars({ rows }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);
  const list = useMemo(() => (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      key: r.departmentId ?? r.departmentName,
      label: r.departmentName,
      open: r.open || 0,
      inProgress: r.inProgress || 0,
      done: r.done || 0,
      overdue: r.overdue || 0,
    }))
    .sort((a, b) => (b.open + b.done) - (a.open + a.done))
    .slice(0, MAX_DIVISIONS), [rows]);
  const g = useMemo(() => groupedBarGeometry(list, DIVISION_SERIES, { width, height: 220 }), [list, width]);

  if (!list.length) {
    return <div className="tracker-chart" ref={wrapRef}><EmptyState compact icon="bar_chart" description="Belum ada project per divisi." /></div>;
  }
  const group = g.groups.find((x) => x.key === active) || null;
  const summary = `Perbandingan ${list.length} divisi: ${list.map((r) => `${r.label} ${r.open} belum selesai, ${r.inProgress} dikerjakan, ${r.done} selesai, ${r.overdue} terlambat`).join('; ')}.`;

  return (
    <div className="tracker-chart" ref={wrapRef}>
      <Legend items={DIVISION_SERIES} />
      <p className="tracker-chart__readout" aria-live="polite">
        {group
          ? `${group.label}: ${group.open} belum selesai · ${group.inProgress} dikerjakan · ${group.done} selesai · ${group.overdue} terlambat`
          : 'Arahkan kursor atau Tab ke sebuah divisi untuk angka lengkapnya.'}
      </p>
      <svg
        width={g.width}
        height={g.height}
        viewBox={`0 0 ${g.width} ${g.height}`}
        role="img"
        aria-label={summary}
        className="tracker-chart__svg"
      >
        {g.ticks.map((t) => (
          <g key={t.value}>
            <line className="tracker-chart__grid" x1={g.pad.left} x2={g.width - g.pad.right} y1={t.y} y2={t.y} />
            <text className="tracker-chart__tick" x={g.pad.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
          </g>
        ))}
        {g.groups.map((row) => (
          <g
            key={row.key}
            className="tracker-chart__bar-hit"
            onPointerEnter={() => setActive(row.key)}
            onPointerLeave={() => setActive(null)}
          >
            <rect className="tracker-chart__hit" x={row.hit.x} y={g.pad.top} width={row.hit.w} height={g.baseline - g.pad.top} />
            {row.bars.map((b) => (
              <path
                key={b.key}
                d={barPath(b)}
                className={`tracker-chart__bar tracker-chart__bar--${b.tone}${active === row.key ? ' is-active' : ''}`}
              />
            ))}
            <text className="tracker-chart__tick" x={row.cx} y={g.height - 10} textAnchor="middle">
              {row.short}
              <title>{row.label}</title>
            </text>
          </g>
        ))}
        <line className="tracker-chart__axis" x1={g.pad.left} x2={g.width - g.pad.right} y1={g.baseline} y2={g.baseline} />
      </svg>
      <ul className="pw-visually-hidden">
        {list.map((r) => (
          <li key={r.key}>{`${r.label}: ${r.open} belum selesai, ${r.inProgress} dikerjakan, ${r.done} selesai, ${r.overdue} terlambat.`}</li>
        ))}
      </ul>
      {(rows || []).length > MAX_DIVISIONS
        ? <p className="pw-text-helper">{`Menampilkan ${MAX_DIVISIONS} divisi tersibuk — tabel di bawah memuat semuanya.`}</p>
        : null}
    </div>
  );
}

const TREND_SERIES = [
  { key: 'created', label: 'Dibuat', tone: 'created' },
  { key: 'completed', label: 'Selesai', tone: 'completed' },
];
const TREND_VARIANTS = [{ value: 'line', label: 'Garis' }, { value: 'bar', label: 'Batang' }];
const TREND_STORAGE_KEY = 'pw.tracker.trendVariant';

// localStorage throws in private mode / blocked storage — the chart must still render.
function readVariant() {
  try {
    return window.localStorage.getItem(TREND_STORAGE_KEY) === 'bar' ? 'bar' : 'line';
  } catch {
    return 'line';
  }
}
function writeVariant(value) {
  try {
    window.localStorage.setItem(TREND_STORAGE_KEY, value);
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
}

// 3 — Eight-week trend, as lines with a soft area or as grouped bars.
export function TrendChart({ weeks }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [variant, setVariant] = useState(readVariant);
  const [active, setActive] = useState(null);
  const rows = useMemo(() => trendRows(weeks), [weeks]);
  const line = useMemo(() => trendGeometry(rows, { width, height: 220 }), [rows, width]);
  const bar = useMemo(() => groupedBarGeometry(rows, TREND_SERIES, { width, height: 220 }), [rows, width]);

  if (!rows.length) {
    return <div className="tracker-chart" ref={wrapRef}><EmptyState compact icon="show_chart" description="Tren mingguan tampil setelah ada aktivitas issue." /></div>;
  }
  const created = rows.reduce((sum, r) => sum + r.created, 0);
  const completed = rows.reduce((sum, r) => sum + r.completed, 0);
  const summary = `Tren ${rows.length} minggu: ${rows.map((r) => `${r.label} ${r.created} dibuat ${r.completed} selesai`).join(', ')}.`;
  const point = active !== null ? line.points[active] : null;
  const pick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * line.width;
    let best = 0;
    line.points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(line.points[best].x - x)) best = i; });
    setActive(best);
  };
  const onKeyDown = (event) => {
    const lastIndex = rows.length - 1;
    const current = active ?? lastIndex;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: lastIndex }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(lastIndex, next)));
  };
  const choose = (value) => { setVariant(value); setActive(null); writeVariant(value); };
  const readout = point
    ? `${point.label}: ${point.created} dibuat, ${point.completed} selesai`
    : `${rows.length} minggu terakhir: ${created} issue dibuat, ${completed} selesai.`;

  return (
    <div className="tracker-chart" ref={wrapRef}>
      <div className="tracker-chart__head">
        <Legend items={TREND_SERIES} />
        <Segmented
          label="Bentuk grafik tren"
          value={variant}
          options={TREND_VARIANTS.map((v) => ({ value: v.value, label: v.label }))}
          onChange={choose}
        />
      </div>
      <p className="tracker-chart__readout" aria-live="polite">{readout}</p>
      {variant === 'line' ? (
        <svg
          width={line.width}
          height={line.height}
          viewBox={`0 0 ${line.width} ${line.height}`}
          role="img"
          aria-label={summary}
          tabIndex={0}
          className="tracker-chart__svg"
          onPointerMove={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {line.ticks.map((t) => (
            <g key={t.value}>
              <line className="tracker-chart__grid" x1={line.pad.left} x2={line.width - line.pad.right} y1={t.y} y2={t.y} />
              <text className="tracker-chart__tick" x={line.pad.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
            </g>
          ))}
          <path className="tracker-chart__area tracker-chart__area--created" d={line.areas.created} />
          <path className="tracker-chart__area tracker-chart__area--completed" d={line.areas.completed} />
          <path className="tracker-chart__line tracker-chart__line--created" d={line.lines.created} />
          <path className="tracker-chart__line tracker-chart__line--completed" d={line.lines.completed} />
          {line.labels.map((l) => (
            <text key={l.i} className="tracker-chart__tick" x={l.x} y={line.height - 8} textAnchor="middle">{l.text}</text>
          ))}
          {/* One week has no line to draw — show the two values as dots instead. */}
          {line.points.length === 1 ? (
            <g>
              <circle className="tracker-chart__dot tracker-chart__dot--created" cx={line.points[0].x} cy={line.points[0].yCreated} r={5} />
              <circle className="tracker-chart__dot tracker-chart__dot--completed" cx={line.points[0].x} cy={line.points[0].yCompleted} r={5} />
            </g>
          ) : null}
          {point ? (
            <g>
              <line className="tracker-chart__cross" x1={point.x} x2={point.x} y1={line.pad.top} y2={line.baseline} />
              <circle className="tracker-chart__dot tracker-chart__dot--created" cx={point.x} cy={point.yCreated} r={5} />
              <circle className="tracker-chart__dot tracker-chart__dot--completed" cx={point.x} cy={point.yCompleted} r={5} />
            </g>
          ) : null}
        </svg>
      ) : (
        <svg
          width={bar.width}
          height={bar.height}
          viewBox={`0 0 ${bar.width} ${bar.height}`}
          role="img"
          aria-label={summary}
          className="tracker-chart__svg"
        >
          {bar.ticks.map((t) => (
            <g key={t.value}>
              <line className="tracker-chart__grid" x1={bar.pad.left} x2={bar.width - bar.pad.right} y1={t.y} y2={t.y} />
              <text className="tracker-chart__tick" x={bar.pad.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
            </g>
          ))}
          {bar.groups.map((row, i) => (
            <g
              key={row.key}
              className="tracker-chart__bar-hit"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              <rect className="tracker-chart__hit" x={row.hit.x} y={bar.pad.top} width={row.hit.w} height={bar.baseline - bar.pad.top} />
              {row.bars.map((b) => (
                <path key={b.key} d={barPath(b)} className={`tracker-chart__bar tracker-chart__bar--${b.tone}${active === i ? ' is-active' : ''}`} />
              ))}
              <text className="tracker-chart__tick" x={row.cx} y={bar.height - 10} textAnchor="middle">
                {row.short}
                <title>{row.label}</title>
              </text>
            </g>
          ))}
          <line className="tracker-chart__axis" x1={bar.pad.left} x2={bar.width - bar.pad.right} y1={bar.baseline} y2={bar.baseline} />
        </svg>
      )}
      <ul className="pw-visually-hidden">
        {rows.map((r) => <li key={r.key}>{`Minggu ${r.label}: ${r.created} issue dibuat, ${r.completed} selesai.`}</li>)}
      </ul>
    </div>
  );
}
