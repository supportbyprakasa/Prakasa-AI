import TaskProgress from '../tasks/TaskProgress';
import Badge from '../Badge';

/**
 * Mobile fallback — Gantt tidak realistis di layar <700px.
 */
export default function GanttListView({ tasks, onTaskClick }) {
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
            }}>
              {t.title}
            </div>
            <Badge tone={
              t.status === 'done' || t.status === 'closed' || t.status === 'completed' ? 'success'
              : t.status === 'cancelled' ? 'default'
              : t.status === 'review' ? 'warning'
              : 'info'
            }>
              {t.status}
            </Badge>
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