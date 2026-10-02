import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionMenu from '../../components/ActionMenu';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import IconButton from '../../components/IconButton';
import PriorityBadge from '../../components/PriorityBadge';
import { KanbanBoard, KanbanCard, KanbanColumn, KanbanPlaceholder } from '../../components/tasks/Kanban';
import { Avatar, IssueTypeIcon } from './TrackerBits';
import {
  activeSprintOf, boardIssues, computeMove, formatDate, formatPoints, groupByColumn,
  isOverdue, sortedColumns, wipState,
} from './trackerModel';
import { NoTranslate } from '../../i18n/NoTranslate';

// Kanban board: one column per status. Native HTML5 drag & drop; the card menu
// ("Pindahkan ke …") is the keyboard / touch alternative.
export default function TrackerBoard({ project, issues, issueSearch, onOpen, onMove, onCreate, onPlanSprint, filtered }) {
  const columns = useMemo(() => sortedColumns(project.columns), [project.columns]);
  const scoped = useMemo(() => boardIssues(issues, project), [issues, project]);
  const groups = useMemo(() => groupByColumn(scoped, columns), [scoped, columns]);
  const [dragId, setDragId] = useState(null);
  const [target, setTarget] = useState(null); // { columnId, beforeId }
  const dragRef = useRef(null);
  const sprint = activeSprintOf(project);

  const finishDrag = () => { dragRef.current = null; setDragId(null); setTarget(null); };

  const drop = (columnId, beforeId) => {
    const issue = scoped.find((i) => i.id === dragRef.current);
    finishDrag();
    if (!issue) return;
    if (issue.columnId === columnId && beforeId === issue.id) return;
    const { position } = computeMove(groups.get(columnId) || [], issue.id, beforeId);
    const current = (groups.get(issue.columnId) || []).findIndex((i) => i.id === issue.id);
    if (issue.columnId === columnId && current === position) return;
    onMove(issue, { columnId, position });
  };

  const moveTo = (issue, columnId) => {
    const { position } = computeMove(groups.get(columnId) || [], issue.id, null);
    onMove(issue, { columnId, position });
  };

  const onCardDragOver = (event, columnId, list, index) => {
    if (dragRef.current == null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const beforeId = after ? (list[index + 1]?.id ?? null) : list[index].id;
    if (target?.columnId !== columnId || target?.beforeId !== beforeId) setTarget({ columnId, beforeId });
  };

  if (!columns.length) {
    return <EmptyState icon="view_kanban" title="Belum ada kolom status" description="Tambahkan kolom lewat pengaturan project." />;
  }

  return (
    <div className="tracker-board-wrap">
      {sprint ? (
        <p className="tracker-board__sprint pw-text-helper">
          Sprint aktif: <span data-no-translate="" className="pw-strong">{sprint.name}</span>
          {sprint.endDate ? ` · berakhir ${formatDate(sprint.endDate)}` : ''}
        </p>
      ) : (
        <div className="tracker-board__sprint pw-row">
          <span className="pw-text-helper">Belum ada sprint aktif — board menampilkan semua issue di luar sprint.</span>
          {onPlanSprint ? <Button variant="text" onClick={onPlanSprint}>Rencanakan sprint</Button> : null}
        </div>
      )}
      <KanbanBoard label="Board issue">
        {columns.map((column) => {
          const list = groups.get(column.id) || [];
          const wip = wipState(column, list.length);
          const isTarget = target?.columnId === column.id;
          return (
            <KanbanColumn
              key={column.id}
              title={column.name}
              dataTitle
              count={wip.label}
              countLabel={wip.limit ? `${list.length} issue, batas WIP ${wip.limit}` : `${list.length} issue`}
              note={wip.over ? 'Melebihi batas WIP' : null}
              alert={wip.over}
              dropTarget={isTarget}
              actions={(
                <IconButton label={`Buat issue di ${column.name}`} size="sm" icon="add" onClick={() => onCreate({ columnId: String(column.id) })} />
              )}
              empty={!list.length && !isTarget ? (filtered ? 'Tidak ada yang cocok' : 'Seret issue ke sini') : null}
              onDragOver={(event) => {
                if (dragRef.current == null) return;
                event.preventDefault();
                if (!isTarget) setTarget({ columnId: column.id, beforeId: null });
              }}
              onDrop={(event) => { event.preventDefault(); drop(column.id, target?.columnId === column.id ? target.beforeId : null); }}
            >
              {list.map((issue, index) => {
                const overdue = isOverdue(issue);
                const points = formatPoints(issue.storyPoints);
                return (
                  <KanbanCard
                    key={issue.id}
                    dragging={dragId === issue.id}
                    marker={isTarget && target.beforeId === issue.id && dragId !== issue.id}
                    draggable
                    onDragStart={(event) => {
                      dragRef.current = issue.id;
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', issue.key || String(issue.id));
                      setDragId(issue.id);
                    }}
                    onDragEnd={finishDrag}
                    onDragOver={(event) => onCardDragOver(event, column.id, list, index)}
                    onClick={(event) => { if (!event.target.closest('a, button, [role="menu"]')) onOpen(issue.id); }}
                  >
                    <div className="pw-kanban__top">
                      <IssueTypeIcon type={issue.type} />
                      <span className="pw-kanban__key" data-no-translate="">{issue.key}</span>
                      <span className="pw-kanban__spacer" />
                      <ActionMenu
                        label={`Aksi untuk ${issue.key}`}
                        size="sm"
                        items={[
                          { label: 'Buka detail', icon: 'visibility', onClick: () => onOpen(issue.id) },
                          ...columns.filter((c) => c.id !== issue.columnId).map((c) => ({
                            label: `Pindahkan ke ${c.name}`, icon: 'swap_horiz', onClick: () => moveTo(issue, c.id),
                          })),
                        ]}
                      />
                    </div>
                    <Link data-no-translate="" className="pw-kanban__title" to={{ search: issueSearch(issue.id) }}>{issue.title}</Link>
                    {issue.labels?.length ? (
                      <div className="pw-kanban__tags">
                        {issue.labels.slice(0, 3).map((l) => <Badge key={l}><NoTranslate>{l}</NoTranslate></Badge>)}
                        {issue.labels.length > 3 ? <Badge>+{issue.labels.length - 3}</Badge> : null}
                      </div>
                    ) : null}
                    <div className="pw-kanban__meta">
                      <PriorityBadge priority={issue.priority} />
                      {issue.dueDate ? (
                        <span className={`pw-kanban__meta-item${overdue ? ' is-error' : ''}`}>
                          <Icon name="calendar_today" size="sm" />
                          {formatDate(issue.dueDate)}{overdue ? <span className="pw-visually-hidden"> (terlambat)</span> : null}
                        </span>
                      ) : null}
                      {issue.commentCount ? (
                        <span className="pw-kanban__meta-item">
                          <Icon name="chat_bubble" size="sm" />{issue.commentCount}
                          <span className="pw-visually-hidden"> komentar</span>
                        </span>
                      ) : null}
                      <span className="pw-kanban__spacer" />
                      {points ? <span className="pw-kanban__meta-item">{points}<span className="pw-visually-hidden"> story points</span></span> : null}
                      <Avatar person={issue.assignee} size="sm" />
                    </div>
                  </KanbanCard>
                );
              })}
              {isTarget && target.beforeId === null ? <KanbanPlaceholder /> : null}
            </KanbanColumn>
          );
        })}
      </KanbanBoard>
    </div>
  );
}
