import { useMemo } from 'react';
import DataGrid from '../../components/datagrid/DataGrid';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { IssueTypeIcon } from './TrackerBits';
import { categoryStatus, formatDate, formatPoints, isOverdue, issueRows, sortedColumns, typeLabel } from './trackerModel';
import { NoTranslate } from '../../i18n/NoTranslate';

// "Daftar": every issue in a sortable DataGrid (phone → cards automatically).
export default function TrackerIssueList({ project, issues, loading, onOpen, projectKey }) {
  const rows = useMemo(() => issueRows(issues), [issues]);
  const columnOrder = useMemo(() => new Map(sortedColumns(project.columns).map((c, i) => [c.id, i])), [project.columns]);

  const columns = useMemo(() => [
    { key: 'key', header: 'Kunci', width: 110, sortValue: (r) => r.number, exportValue: (r) => r.key, render: (r) => <span className="tracker-key">{r.key}</span> },
    { key: 'typeName', header: 'Tipe', translate: true, render: (r) => <IssueTypeIcon type={r.type} withLabel />, exportValue: (r) => typeLabel(r.type) },
    { key: 'title', header: 'Judul', render: (r) => <span className="pw-break">{r.title}</span> },
    {
      key: 'statusName', header: 'Status', sortValue: (r) => columnOrder.get(r.columnId) ?? 99,
      render: (r) => <StatusBadge status={categoryStatus(r.status)} label={r.statusName ? <NoTranslate>{r.statusName}</NoTranslate> : undefined} />,
    },
    { key: 'assigneeName', header: 'Penanggung jawab', render: (r) => r.assigneeName || <span className="pw-muted">—</span> },
    {
      key: 'priority', header: 'Prioritas', sortValue: (r) => r.prioritySort,
      exportValue: (r) => PRIORITY_LABELS[r.priority] || r.priority, render: (r) => <PriorityBadge priority={r.priority} />,
    },
    { key: 'storyPoints', header: 'Poin', align: 'end', sortValue: (r) => r.pointsSort, render: (r) => formatPoints(r.storyPoints) || <span className="pw-muted">—</span> },
    {
      key: 'dueDate', header: 'Jatuh tempo', sortValue: (r) => r.dueDateSort, exportValue: (r) => r.dueDate || '',
      render: (r) => (r.dueDate ? (
        <span className="pw-row pw-row--nowrap tracker-due">
          {formatDate(r.dueDate)}
          {isOverdue(r) ? <StatusBadge status="overdue" /> : null}
        </span>
      ) : <span className="pw-muted">—</span>),
    },
  ], [columnOrder]);

  return (
    <DataGrid
      columns={columns}
      rows={rows}
      loading={loading}
      onRowClick={(row) => onOpen(row.id)}
      searchable={false}
      exportName={`issue-${String(projectKey || 'project').toLowerCase()}`}
      empty="Tidak ada issue yang cocok dengan filter."
      pageSize={50}
    />
  );
}
