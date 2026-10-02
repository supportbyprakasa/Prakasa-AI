import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SERIES, buildLineChart, formatDay, formatNumber } from './analyticsModel';

// Daily users/sessions line chart in plain SVG (no chart library). Colours
// come from CSS tokens (analytics.css); sessions is also dashed so the two
// series never rely on colour alone. Pointer + keyboard crosshair, and a
// visually hidden ARIA table carries the same numbers for screen readers.

function useWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const TIP_W = 168;
const TIP_H = 66;

export default function AnalyticsLineChart({ points }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 640);
  const narrow = width < 480;
  const height = narrow ? 220 : 260;
  const [active, setActive] = useState(null);

  const chart = useMemo(() => buildLineChart(points, {
    width,
    height,
    pad: { top: 16, right: narrow ? 16 : 96, bottom: 28, left: 44 },
    maxLabels: narrow ? 4 : width < 800 ? 6 : 8,
  }), [points, width, height, narrow]);

  // Direct end labels (wide screens only), nudged apart when they'd collide.
  const endLabels = useMemo(() => {
    if (narrow) return [];
    const labels = chart.lines.filter((line) => line.end).map((line) => ({ key: line.key, label: line.label, x: line.end.x + 8, y: line.end.y + 4 }));
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i += 1) {
      if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    }
    return labels;
  }, [chart, narrow]);

  const total = (key) => points.reduce((sum, p) => sum + (p[key] || 0), 0);
  const summary = points.length
    ? `Grafik garis harian ${formatDay(points[0].date, true)} sampai ${formatDay(points[points.length - 1].date, true)}: `
      + `total ${formatNumber(total('activeUsers'))} pengguna aktif dan ${formatNumber(total('sessions'))} sesi. Detail per hari ada di tabel.`
    : 'Tidak ada data.';

  const onPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(chart.indexAt(event.clientX - rect.left));
  };
  const onKeyDown = (event) => {
    const last = points.length - 1;
    const current = active ?? last;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  const point = active !== null ? points[active] : null;
  const cx = active !== null ? chart.x(active) : 0;
  const tipX = cx + 12 + TIP_W > width - 4 ? cx - 12 - TIP_W : cx + 12;
  const bottom = height - chart.pad.bottom;

  return (
    <div className="ga-chart" ref={wrapRef}>
      <ul className="ga-legend" aria-hidden="true">
        {SERIES.map((series) => (
          <li key={series.key}><span className={`ga-swatch ga-swatch--${series.key}`} />{series.label}</li>
        ))}
      </ul>
      <svg
        className="ga-chart__svg"
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        tabIndex={points.length ? 0 : -1}
        onPointerMove={onPointer}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick.value}>
            <line className={tick.value === 0 ? 'ga-axis-line' : 'ga-grid-line'} x1={chart.pad.left} x2={width - chart.pad.right} y1={tick.y} y2={tick.y} />
            <text className="ga-axis-text" x={chart.pad.left - 8} y={tick.y + 4} textAnchor="end">{tick.label}</text>
          </g>
        ))}
        {chart.xLabels.map((item, index) => (
          <text
            key={item.i}
            className="ga-axis-text"
            x={item.x}
            y={height - 8}
            textAnchor={index === 0 && chart.xLabels.length > 1 ? 'start' : index === chart.xLabels.length - 1 && chart.xLabels.length > 1 ? 'end' : 'middle'}
          >{item.label}</text>
        ))}
        {chart.lines.map((line) => (
          <path key={line.key} className={`ga-line ga-line--${line.key}`} d={line.path} />
        ))}
        {endLabels.map((item) => (
          <text key={item.key} className="ga-end-label" x={item.x} y={item.y}>{item.label}</text>
        ))}
        {point ? (
          <g className="ga-hover" aria-hidden="true">
            <line className="ga-crosshair" x1={cx} x2={cx} y1={chart.pad.top} y2={bottom} />
            {SERIES.map((series) => (
              <circle key={series.key} className={`ga-dot ga-dot--${series.key}`} cx={cx} cy={chart.y(point[series.key])} r="4" />
            ))}
            <g transform={`translate(${tipX},${chart.pad.top})`}>
              <rect className="ga-tip" width={TIP_W} height={TIP_H} rx="4" />
              <text className="ga-tip__title" x="12" y="20">{formatDay(point.date, true)}</text>
              {SERIES.map((series, i) => (
                <g key={series.key} transform={`translate(12,${38 + i * 18})`}>
                  <rect className={`ga-tip__swatch ga-swatch--${series.key}`} y="-7" width="10" height="3" />
                  <text className="ga-tip__label" x="16" y="0">{series.label}</text>
                  <text className="ga-tip__value" x={TIP_W - 24} y="0" textAnchor="end">{formatNumber(point[series.key])}</text>
                </g>
              ))}
            </g>
          </g>
        ) : null}
      </svg>
      {/* Same numbers as an ARIA table for screen readers (visually hidden). */}
      <div className="sr-only" role="table" aria-label="Pengguna aktif dan sesi per hari">
        <div role="rowgroup">
          <div role="row">
            <span role="columnheader">Tanggal</span>
            {SERIES.map((series) => <span key={series.key} role="columnheader">{series.label}</span>)}
          </div>
        </div>
        <div role="rowgroup">
          {points.map((p) => (
            <div key={p.date} role="row">
              <span role="rowheader">{formatDay(p.date, true)}</span>
              {SERIES.map((series) => <span key={series.key} role="cell">{formatNumber(p[series.key])}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
