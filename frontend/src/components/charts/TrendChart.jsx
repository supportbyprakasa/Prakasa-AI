import { useId, useLayoutEffect, useRef, useState } from 'react';
import { areaPath, formatMetric, linePath, niceScale, seriesPoints } from './chartModel';
import { useSeen, useWidth } from './motion';
import './charts.css';

const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 8;
const AXIS = 24;
// Points pop in one after another.
const STAGGER_MS = 70;

// A 12-month trend: area + line that draws itself in when it comes into view,
// a dashed target line, and a guide with the month's value on hover, tap or
// arrow keys. A hidden table carries the numbers for screen readers.
// months: [{ key, label, partial? }]; values / targets: numbers or null per month.
// The running month (partial: true, as the division dashboard sends it) is not
// complete yet: its segment is dashed, its point lighter and the tooltip says
// "berjalan", so a half month never reads as a drop.
export default function TrendChart({ months, values, targets = [], unit, label, height = 150 }) {
  const id = useId().replace(/:/g, '');
  const box = useRef(null);
  const width = useWidth(box);
  const seen = useSeen(box);
  const [active, setActive] = useState(null);
  const plotW = Math.max(120, width - PAD_LEFT - PAD_RIGHT);
  const scale = niceScale([...values, ...targets]);
  const points = seriesPoints(values, { width: plotW, height, padX: 8, scale });
  const targetPoints = seriesPoints(targets, { width: plotW, height, padX: 8, scale });
  const hasTarget = targets.some((t) => t !== null && t !== undefined);
  const last = months.length - 1;
  const partial = last >= 0 && months[last]?.partial === true ? last : null;
  const partialSegment = partial !== null && partial > 0 && points[partial]?.y !== null && points[partial - 1]?.y !== null
    ? linePath([points[partial - 1], points[partial]]) : null;
  // The solid line stops at the last complete month; the running one is dashed apart.
  const line = linePath(partial === null ? points : points.map((p) => (p.index === partial ? { ...p, y: null } : p)));
  const area = areaPath(points, height);
  const shortMonth = (m) => m.label.split(' ')[0];
  const step = months.length > 8 && plotW < 420 ? 2 : 1;

  const pick = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    const x = clientX - rect.left - PAD_LEFT;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = i; });
    setActive(best);
  };
  const onKey = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    setActive((cur) => {
      const at = cur ?? last;
      if (e.key === 'Home') return 0;
      if (e.key === 'End') return last;
      return Math.max(0, Math.min(last, at + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };
  const a = active !== null ? points[active] : null;

  // The tooltip sits beside the guide (right of it, or left when there is no
  // room) and in the half of the plot away from the point, so it never covers
  // the line it describes; it is clamped inside the card at any width.
  const tipRef = useRef(null);
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const next = { w: el.offsetWidth, h: el.offsetHeight };
    setTipSize((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
  }, [active, width]);
  let tipPos = null;
  if (a) {
    const gx = PAD_LEFT + a.x;
    const gap = 12;
    const right = gx + gap;
    const left = gx - gap - tipSize.w;
    const x = right + tipSize.w <= width ? right : (left >= 0 ? left : gx - tipSize.w / 2);
    const pointY = a.y === null ? height : PAD_TOP + a.y;
    const y = pointY < (height + PAD_TOP) / 2 ? Math.max(0, height + PAD_TOP - tipSize.h) : 0;
    tipPos = { left: Math.max(0, Math.min(x, width - tipSize.w)), top: y };
  }

  return (
    <div className="pw-trend" ref={box}>
      <div
        className="pw-trend__plot"
        role="img"
        aria-label={`${label}: tren ${months.length} bulan`}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={height + PAD_TOP + AXIS} className={seen ? 'is-seen' : ''} aria-hidden="true">
          <defs>
            <linearGradient id={`pw-trend-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--pw-accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--pw-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(${PAD_LEFT},${PAD_TOP})`}>
            {scale.ticks.map((t) => {
              const y = height - ((t - scale.min) / (scale.max - scale.min || 1)) * height;
              return (
                <g key={t}>
                  <line className="pw-trend__grid" x1={0} x2={plotW} y1={y} y2={y} />
                  <text className="pw-trend__tick" x={-8} y={y} textAnchor="end" dominantBaseline="middle">{formatMetric(t, unit, { compact: true })}</text>
                </g>
              );
            })}
            {area ? <path className="pw-trend__area" d={area} fill={`url(#pw-trend-fill-${id})`} /> : null}
            {hasTarget ? <path className="pw-trend__target" d={linePath(targetPoints)} /> : null}
            {line ? <path key={`${line}`} className="pw-trend__line" d={line} pathLength={1} /> : null}
            {partialSegment ? <path className="pw-trend__partial" d={partialSegment} /> : null}
            {points.map((p) => (p.y === null ? null : (
              <circle key={p.index} className={`pw-trend__dot${p.index === partial ? ' is-partial' : ''}`} cx={p.x} cy={p.y} r={active === p.index ? 5 : 3} style={{ '--delay': `${p.index * STAGGER_MS}ms` }} />
            )))}
            {a ? <line className="pw-trend__guide" x1={a.x} x2={a.x} y1={0} y2={height} /> : null}
            {months.map((m, i) => (i % step === 0 || i === months.length - 1 ? (
              <text key={m.key} className={`pw-trend__month${active === i ? ' is-active' : ''}`} x={points[i].x} y={height + 18} textAnchor="middle">{shortMonth(m)}</text>
            ) : null))}
          </g>
        </svg>
        {a ? (
          <div ref={tipRef} className="pw-trend__tip" style={tipPos} aria-hidden="true">
            <span className="pw-trend__tip-month">{months[active].label}{active === partial ? ' · berjalan' : ''}</span>
            <span className="pw-trend__tip-value">{formatMetric(values[active], unit)}</span>
            {targets[active] !== null && targets[active] !== undefined ? <span className="pw-trend__tip-target">{`Target ${formatMetric(targets[active], unit)}`}</span> : null}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Bulan</th><th scope="col">Nilai</th>{hasTarget ? <th scope="col">Target</th> : null}</tr></thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m.key}><th scope="row">{m.label}{i === partial ? ' (berjalan)' : ''}</th><td>{formatMetric(values[i], unit)}</td>{hasTarget ? <td>{formatMetric(targets[i], unit)}</td> : null}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
