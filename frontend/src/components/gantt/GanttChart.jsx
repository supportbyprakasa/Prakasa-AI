import { useMemo } from 'react';

const ROW_H = 40;
const HEADER_H = 48;
const LEFT_W = 260;
const DAY_PX = { week: 24, month: 6 };
const TICK_EVERY = { week: 7, month: 30 };
const BAR_TOP = 8;
const BAR_H = ROW_H - 16;

const STATUS_FILL = {
  open: '#94a3b8',
  in_progress: '#3b82f6',
  review: '#f59e0b',
  done: '#16a34a',
  closed: '#16a34a',
  completed: '#16a34a',
  cancelled: '#cbd5e1',
};

/* ============================================================
   Date math (pure)
   ============================================================ */

function dateToDayOffset(dateStr, rangeStart) {
  if (!dateStr) return 0;
  const d = new Date(dateStr + 'T00:00:00Z').getTime();
  const s = new Date(rangeStart + 'T00:00:00Z').getTime();
  return Math.round((d - s) / 86400000);
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00Z').getTime();
  const b = new Date(toStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function generateTicks(rangeFrom, rangeTo, everyDays) {
  const total = daysBetween(rangeFrom, rangeTo);
  const out = [];
  for (let i = 0; i <= total; i += everyDays) {
    out.push(addDays(rangeFrom, i));
  }
  return out;
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/* ============================================================
   Bar
   ============================================================ */

function Bar({ task, left, width, onClick }) {
  const fill = STATUS_FILL[task.status] || '#94a3b8';
  const isEstimated = task.isFallbackStart || task.isFallbackDue;
  const isCancelled = task.isCancelled;

  const title = [
    task.title,
    `${task.startDate} → ${task.dueDate}`,
    isEstimated ? '(tanggal estimasi)' : null,
    isCancelled ? 'DIBATALKAN' : null,
  ].filter(Boolean).join('\n');

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        position: 'absolute',
        left,
        top: BAR_TOP,
        height: BAR_H,
        width,
        background: `${fill}33`,
        border: `1.5px ${isEstimated ? 'dashed' : 'solid'} ${fill}`,
        borderRadius: 6,
        cursor: 'pointer',
        overflow: 'hidden',
        opacity: isCancelled ? 0.55 : 1,
        transition: 'opacity 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = isCancelled ? 0.75 : 0.85; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = isCancelled ? 0.55 : 1; }}
    >
      {/* Progress fill */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, bottom: 0,
        width: `${Math.max(0, Math.min(100, task.progressPercent || 0))}%`,
        background: `${fill}66`,
        transition: 'width 200ms',
      }} />

      {/* Label */}
      {width > 60 && (
        <span style={{
          position: 'absolute',
          left: 6, top: 0, bottom: 0,
          display: 'flex', alignItems: 'center',
          fontSize: 10, fontWeight: 500,
          color: '#0f172a',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 'calc(100% - 12px)',
          pointerEvents: 'none',
        }}>
          {task.title}
        </span>
      )}
    </div>
  );
}

/* ============================================================
   Chart
   ============================================================ */

export default function GanttChart({ tasks, links, range, zoom, onTaskClick }) {
  const dayPx = DAY_PX[zoom] || DAY_PX.week;
  const totalDays = useMemo(() => daysBetween(range.from, range.to) + 1, [range]);
  const canvasWidth = totalDays * dayPx;
  const ticks = useMemo(
    () => generateTicks(range.from, range.to, TICK_EVERY[zoom] || TICK_EVERY.week),
    [range, zoom]
  );

  // Bar geometry per task — clamped to visible range
  const geometry = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const startOff = dateToDayOffset(t.startDate, range.from);
      const endOff = dateToDayOffset(t.dueDate, range.from);
      const visStart = Math.max(0, startOff);
      const visEnd = Math.min(totalDays - 1, endOff);

      if (visEnd < 0 || visStart > totalDays - 1) {
        map.set(t.id, null);
        continue;
      }
      map.set(t.id, {
        rowIndex: i,
        leftPx: visStart * dayPx,
        widthPx: Math.max(dayPx, (visEnd - visStart + 1) * dayPx),
        centerY: i * ROW_H + ROW_H / 2,
      });
    }
    return map;
  }, [tasks, range, totalDays, dayPx]);

  // Today marker
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayOff = dateToDayOffset(todayIso, range.from);
  const showToday = todayOff >= 0 && todayOff < totalDays;

  if (!tasks.length) {
    return (
      <div style={{
        padding: 40, textAlign: 'center',
        color: 'var(--color-text-muted)', fontSize: 13,
        background: 'var(--color-surface)',
      }}>
        Tidak ada task pada rentang tanggal ini.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', maxHeight: '70vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', minWidth: 'max-content' }}>
        {/* -------- LEFT COLUMN (sticky) -------- */}
        <div style={{
          position: 'sticky', left: 0, zIndex: 3,
          width: LEFT_W, flexShrink: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
        }}>
          {/* Corner header */}
          <div style={{
            height: HEADER_H, position: 'sticky', top: 0, zIndex: 4,
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center',
            padding: '0 12px',
            fontSize: 12, fontWeight: 600,
            color: 'var(--color-text-muted)',
          }}>
            Task
          </div>

          {tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onTaskClick(t.id)}
              style={{
                height: ROW_H,
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 12px',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer', fontSize: 13,
                background: 'var(--color-surface)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--color-surface)'}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 4,
                background: STATUS_FILL[t.status] || '#94a3b8',
                flexShrink: 0,
              }} />
              <span style={{
                flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: t.isCancelled ? 'var(--color-text-muted)' : 'var(--color-text)',
                textDecoration: t.isCancelled ? 'line-through' : 'none',
              }}>
                {t.title}
              </span>
            </div>
          ))}
        </div>

        {/* -------- RIGHT CANVAS -------- */}
        <div style={{ position: 'relative', width: canvasWidth, flexShrink: 0 }}>
          {/* Header with ticks */}
          <div style={{
            height: HEADER_H, position: 'sticky', top: 0, zIndex: 2,
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
          }}>
            {ticks.map((tick) => {
              const off = dateToDayOffset(tick, range.from);
              return (
                <div key={tick} style={{
                  position: 'absolute',
                  left: off * dayPx,
                  top: 0, bottom: 0,
                  borderLeft: '1px solid var(--color-border)',
                  padding: '6px 4px',
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {shortDate(tick)}
                </div>
              );
            })}
          </div>

          {/* Vertical grid lines */}
          {ticks.map((tick) => {
            const off = dateToDayOffset(tick, range.from);
            return (
              <div key={`grid-${tick}`} style={{
                position: 'absolute',
                left: off * dayPx,
                top: HEADER_H,
                bottom: 0,
                width: 1,
                background: 'var(--color-border)',
                opacity: 0.4,
                pointerEvents: 'none',
                zIndex: 0,
              }} />
            );
          })}

          {/* Today marker */}
          {showToday && (
            <div style={{
              position: 'absolute',
              left: todayOff * dayPx,
              top: HEADER_H,
              bottom: 0,
              width: 1.5,
              background: '#dc2626',
              opacity: 0.5,
              pointerEvents: 'none',
              zIndex: 0,
            }} />
          )}

          {/* SVG dependency arrows (behind bars) */}
          <svg
            style={{
              position: 'absolute',
              top: HEADER_H, left: 0,
              width: canvasWidth,
              height: tasks.length * ROW_H,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          >
            <defs>
              <marker id="arrow-blocks" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#dc2626" />
              </marker>
              <marker id="arrow-related" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#94a3b8" />
              </marker>
            </defs>

            {links.map((link) => {
              const from = geometry.get(link.fromTaskId);
              const to = geometry.get(link.toTaskId);
              if (!from || !to) return null;

              const x1 = from.leftPx + from.widthPx;
              const y1 = from.centerY;
              const x2 = to.leftPx;
              const y2 = to.centerY;

              const cx1 = x1 + 24;
              const cx2 = x2 - 24;
              const path = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
              const isBlocks = link.type === 'blocks';

              return (
                <path
                  key={link.id}
                  d={path}
                  stroke={isBlocks ? '#dc2626' : '#94a3b8'}
                  strokeWidth={1.5}
                  strokeDasharray={isBlocks ? '0' : '4 3'}
                  fill="none"
                  markerEnd={isBlocks ? 'url(#arrow-blocks)' : 'url(#arrow-related)'}
                  opacity={0.65}
                />
              );
            })}
          </svg>

          {/* Rows with bars (above SVG) */}
          {tasks.map((t) => {
            const geo = geometry.get(t.id);
            return (
              <div key={t.id} style={{
                height: ROW_H,
                position: 'relative',
                borderBottom: '1px solid var(--color-border)',
                zIndex: 1,
              }}>
                {geo && (
                  <Bar
                    task={t}
                    left={geo.leftPx}
                    width={geo.widthPx}
                    onClick={() => onTaskClick(t.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}