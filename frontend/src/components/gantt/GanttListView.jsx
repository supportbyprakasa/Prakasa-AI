import EmptyState from '../EmptyState';
import IconButton from '../IconButton';
import ProgressBar from '../ProgressBar';
import StatusBadge from '../StatusBadge';
import { dateRangeText, isEstimated, pressProps } from './ganttModel';
import './gantt.css';

/**
 * The same tasks as a list — what a phone shows by default, where a Gantt is
 * not readable. canOpenTask(id) as in GanttChart: a row that leads nowhere is
 * not a button.
 */
export default function GanttListView({ tasks, onTaskClick, onGraphClick, canOpenTask }) {
  if (!tasks.length) {
    return <EmptyState icon="event_busy" title="Tidak ada task pada rentang tanggal ini" compact />;
  }

  return (
    <ul className="gantt-list">
      {tasks.map((t) => {
        const open = onTaskClick && (!canOpenTask || canOpenTask(t.id)) ? () => onTaskClick(t.id) : null;
        const pct = Math.max(0, Math.min(100, Math.round(Number(t.progressPercent) || 0)));
        return (
          <li key={t.id} className={`gantt-list__item${t.isCancelled ? ' gantt-list__item--cancelled' : ''}`}>
            <div
              {...pressProps(open, `Buka ${t.title}`)}
              className={['gantt-list__main', open ? 'pw-state-layer' : ''].filter(Boolean).join(' ')}
            >
              <div className="gantt-list__head">
                <span className="gantt-list__title" data-no-translate="">{t.title}</span>
                <StatusBadge status={t.status} />
              </div>

              <div className="gantt-list__meta">
                <span>{dateRangeText(t)}</span>
                {isEstimated(t) ? <span>(estimasi)</span> : null}
                {t.assigneeName ? <span data-no-translate="">· {t.assigneeName}</span> : null}
              </div>

              {pct > 0 ? (
                <div className="gantt-list__progress">
                  <ProgressBar value={pct} label={`Progres ${t.title}`} />
                  <span className="pw-text-helper">{pct}%</span>
                </div>
              ) : null}
            </div>
            {onGraphClick ? (
              <IconButton
                label="Lihat graf dependensi"
                size="sm"
                icon="lan"
                className="gantt-list__graph"
                onClick={() => onGraphClick(t.id)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
