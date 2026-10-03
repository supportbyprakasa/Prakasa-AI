import { useEffect, useMemo, useRef } from 'react';
import EmptyState from '../EmptyState';
import IconButton from '../IconButton';
import { barText, isEstimated, pressProps, tickLabel, toneClass } from './ganttModel';
import './gantt.css';
import { todayIso } from '../../pages/projects/trackerModel';

// Keep in sync with gantt.css (.gantt__row / .gantt__header heights).
const ROW_H = 40;
const DAY_PX = { week: 24, month: 6 };
const TICK_EVERY = { week: 7, month: 30 };

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

/* ============================================================
   Bar
   ============================================================ */

function Bar({ task, left, width, onOpen }) {
  const text = barText(task);
  const classes = [
    'gantt__bar', toneClass(task.status), onOpen ? 'pw-state-layer' : '',
    isEstimated(task) ? 'gantt__bar--estimated' : '', task.isCancelled ? 'gantt__bar--cancelled' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      {...pressProps(onOpen, text)}
      data-pw-tooltip={text}
      className={classes}
      style={{ left, width }}
    >
      {/* Progress fill */}
      <div
        className="gantt__bar-progress"
        style={{ width: `${Math.max(0, Math.min(100, task.progressPercent || 0))}%` }}
      />

      {/* Label */}
      {width > 60 && (
        <span className="gantt__bar-label" aria-hidden="true" data-no-translate="">
          {task.title}
        </span>
      )}
      {onOpen ? null : <span className="sr-only">{text}</span>}
    </div>
  );
}

/* ============================================================
   Chart
   ============================================================ */

// canOpenTask(id): whether a row leads anywhere. A row that does not is plain
// text — never a button that does nothing. Defaults to every row.
export default function GanttChart({
  tasks, links, range, zoom, onTaskClick, onGraphClick, canOpenTask, sideLabel = 'Tugas',
}) {
  const scrollRef = useRef(null);
  const dayPx = DAY_PX[zoom] || DAY_PX.week;
  const totalDays = useMemo(() => daysBetween(range.from, range.to) + 1, [range]);
  const canvasWidth = totalDays * dayPx;
  const ticks = useMemo(
    () => generateTicks(range.from, range.to, TICK_EVERY[zoom] || TICK_EVERY.week),
    [range, zoom]
  );
  const opener = (id) => (onTaskClick && (!canOpenTask || canOpenTask(id)) ? () => onTaskClick(id) : null);

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
  const todayOff = dateToDayOffset(todayIso(), range.from);
  const showToday = todayOff >= 0 && todayOff < totalDays;

  // The canvas opens at range.from, which is usually weeks in the past — so
  // today and everything still ahead sat off-screen to the right. Bring today
  // to the first quarter of the visible canvas, keeping a little history in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !showToday) return;
    const side = el.querySelector('.gantt__side')?.offsetWidth || 0;
    const visible = Math.max(0, el.clientWidth - side);
    el.scrollLeft = Math.max(0, todayOff * dayPx - visible * 0.25);
  }, [showToday, todayOff, dayPx, range.from, range.to]);

  if (!tasks.length) {
    return (
      <EmptyState icon="event_busy" title="Tidak ada task pada rentang tanggal ini" compact />
    );
  }

  return (
    <div className="gantt" ref={scrollRef}>
      <div className="gantt__inner">
        {/* -------- LEFT COLUMN (sticky) -------- */}
        <div className="gantt__side">
          {/* Corner header */}
          <div className="gantt__corner">
            {sideLabel}
          </div>

          {tasks.map((t) => {
            const open = opener(t.id);
            return (
              <div key={t.id} className="gantt__task">
                <div
                  {...pressProps(open, `Buka ${t.title}`)}
                  className={['gantt__task-main', open ? 'pw-state-layer' : ''].filter(Boolean).join(' ')}
                >
                  <span className={`gantt__dot ${toneClass(t.status)}`} aria-hidden="true" />
                  <span className={`gantt__task-title${t.isCancelled ? ' gantt__task-title--cancelled' : ''}`} data-no-translate="">
                    {t.title}
                  </span>
                </div>
                {onGraphClick && (
                  <IconButton
                    label="Lihat graf dependensi"
                    size="sm"
                    icon="lan"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGraphClick(t.id);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* -------- RIGHT CANVAS -------- */}
        <div className="gantt__canvas" style={{ width: canvasWidth }}>
          {/* Header with ticks */}
          <div className="gantt__header" aria-hidden="true">
            {ticks.map((tick, index) => {
              const off = dateToDayOffset(tick, range.from);
              return (
                <div key={tick} className="gantt__tick" style={{ left: off * dayPx }}>
                  {tickLabel(tick, ticks[index - 1])}
                </div>
              );
            })}
          </div>

          {/* Vertical grid lines */}
          {ticks.map((tick) => {
            const off = dateToDayOffset(tick, range.from);
            return (
              <div key={`grid-${tick}`} className="gantt__gridline" style={{ left: off * dayPx }} />
            );
          })}

          {/* Today marker */}
          {showToday && (
            <div className="gantt__today" style={{ left: todayOff * dayPx }} />
          )}

          {/* SVG dependency arrows (behind bars) */}
          <svg
            className="gantt__links"
            width={canvasWidth}
            height={tasks.length * ROW_H}
            aria-hidden="true"
          >
            <defs>
              <marker id="arrow-blocks" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" className="gantt__arrow--blocks" />
              </marker>
              <marker id="arrow-related" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" className="gantt__arrow--related" />
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
                  className={`gantt__link ${isBlocks ? 'gantt__link--blocks' : 'gantt__link--related'}`}
                  markerEnd={isBlocks ? 'url(#arrow-blocks)' : 'url(#arrow-related)'}
                />
              );
            })}
          </svg>

          {/* Rows with bars (above SVG) */}
          {tasks.map((t) => {
            const geo = geometry.get(t.id);
            return (
              <div key={t.id} className="gantt__row">
                {geo && (
                  <Bar
                    task={t}
                    left={geo.leftPx}
                    width={geo.widthPx}
                    onOpen={opener(t.id)}
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
