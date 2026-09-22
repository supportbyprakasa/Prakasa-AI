import { Network } from 'lucide-react';
import TaskProgress from '../tasks/TaskProgress';
import Badge from '../Badge';

/**
 * Mobile fallback — Gantt tidak realistis di layar <700px.
 */
export default function GanttListView({ tasks, onTaskClick, onGraphClick }) {
  if (!tasks.length) {
    return (
      <div style={{
        padding: 24, textAlign: 'center',
        color: 'var(--color-text-muted)', fontSize: 13,
      }}>
        Tidak ada task pada rentang tanggal ini.
      </div>
    );
  }

  return (
    <div>
      {tasks.map((t) => (
        <div
          key={t.id}
          onClick={() => onTaskClick(t.id)}
          style={{
            padding: 12,
            borderBottom: '1px solid var(--color-border)',
            cursor: 'pointer',
            opacity: t.isCancelled ? 0.6 : 1,
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-start', gap: 8, marginBottom: 4,
          }}>
            <div style={{
              fontSize: 14, fontWeight: 600,
              textDecoration: t.isCancelled ? 'line-through' : 'none',
              flex: 1, minWidth: 0,
            }}>
              {t.title}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              <Badge tone={
                t.status === 'done' || t.status === 'closed' || t.status === 'completed' ? 'success'
                : t.status === 'cancelled' ? 'default'
                : t.status === 'review' ? 'warning'
                : 'info'
              }>
                {t.status}
              </Badge>
              {onGraphClick && (
                <button
                  type="button"
                  title="Lihat dependency graph"
                  aria-label="Lihat dependency graph"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGraphClick(t.id);
                  }}
                  style={{
                    width: 26, height: 26, padding: 0,
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6, cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Network size={13} />
                </button>
              )}
            </div>
          </div>

          <div style={{
            fontSize: 11, color: 'var(--color-text-muted)',
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6,
          }}>
            <span>{t.startDate} → {t.dueDate}</span>
            {(t.isFallbackStart || t.isFallbackDue) && (
              <span style={{ fontStyle: 'italic' }}>(estimasi)</span>
            )}
            {t.assigneeName && <span>· {t.assigneeName}</span>}
          </div>

          {t.progressPercent > 0 && (
            <TaskProgress percent={t.progressPercent} />
          )}
        </div>
      ))}
    </div>
  );
}