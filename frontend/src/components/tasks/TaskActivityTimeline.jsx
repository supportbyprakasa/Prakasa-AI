import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../Card';
import Button from '../Button';
import Icon from '../Icon';
import EmptyState, { LoadingState } from '../EmptyState';
import { formatDateTime } from '../format';
import { toast } from '../Toast';
import { activityLabel, activityParts } from './taskModel';
import { Mixed, data } from '../../i18n/NoTranslate';
import './tasks.css';

// Everything that happened to a task, newest first, 50 at a time.
export default function TaskActivityTimeline({ taskId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const r = await api.get(`/tasks/${taskId}/activity`, {
        params: { page, limit: 50 },
      });
      const nextRows = r.data.data || [];
      setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
      setMeta(r.data.meta || { page, limit: 50, total: nextRows.length });
      setLoadError('');
    } catch (e) {
      const message = e.response?.data?.error?.message || 'Aktivitas gagal dimuat.';
      if (append) toast(message, 'error');
      else setLoadError(message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(1, false); /* eslint-disable-next-line */ }, [taskId, refreshKey]);

  const hasMore = rows.length < (meta.total || 0);

  return (
    <Card title={`Aktivitas (${meta.total || rows.length})`}>
      <div className="pw-stack pw-stack--sm">
        {loading && !rows.length ? <LoadingState compact label="Memuat aktivitas…" /> : null}

        {!loading && loadError ? (
          <EmptyState compact tone="error" title="Aktivitas gagal dimuat" description={loadError} action={<Button variant="secondary" onClick={() => load(1, false)}>Coba lagi</Button>} />
        ) : null}

        {!loading && !loadError && !rows.length ? <EmptyState compact icon="history" description="Belum ada aktivitas." /> : null}

        {rows.length > 0 ? (
          <ol className="task-activity">
            {rows.map((a) => {
              // A title someone typed stays as typed; the labels around it translate.
              const details = activityParts(a.metadata);
              return (
                <li key={a.id} className="task-activity__row">
                  <Icon name="schedule" size="sm" className="task-activity__icon" />
                  <span className="pw-cell">
                    <span className="pw-cell__title pw-strong">{activityLabel(a.event)}</span>
                    <span className="pw-cell__meta"><span data-no-translate={a.actorName ? '' : undefined}>{a.actorName || 'Sistem'}</span>{' · '}{formatDateTime(a.createdAt)}</span>
                    {details.length ? (
                      <span className="pw-cell__meta">
                        {details.map((part, index) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <span key={index}>
                            {index > 0 ? ' · ' : null}
                            {typeof part === 'string' ? part : <Mixed separator=" " parts={[part.label, data(part.value)]} />}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {hasMore ? (
          <div className="task-activity__more">
            <Button variant="text" icon="expand_more" onClick={() => load((meta.page || 1) + 1, true)} loading={loadingMore}>
              Muat lebih banyak
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
