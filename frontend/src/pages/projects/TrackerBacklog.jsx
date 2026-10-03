import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import StatusBadge from '../../components/StatusBadge';
import PriorityBadge from '../../components/PriorityBadge';
import { Avatar, IssueTypeIcon } from './TrackerBits';
import {
  activeSprintOf, backlogSections, categoryStatus, formatDate, formatPoints, sectionTotals, sprintTargets,
} from './trackerModel';
import { NoTranslate } from '../../i18n/NoTranslate';

// Active sprint, planned sprints and the backlog. Issues move between them by
// drag & drop or through the row menu ("Pindahkan ke …").
export default function TrackerBacklog({ project, issues, issueSearch, onOpen, onMoveSprint, onCreate, onSprintAction }) {
  const [showDone, setShowDone] = useState(false);
  const sections = useMemo(() => backlogSections(issues, project), [issues, project]);
  const hiddenDone = useMemo(() => sections.find((s) => s.kind === 'backlog')?.issues.filter((i) => i.status === 'done').length || 0, [sections]);
  const hasActive = Boolean(activeSprintOf(project));
  const dragRef = useRef(null);
  const [dropSection, setDropSection] = useState(null);

  const drop = (sprintId) => {
    const issue = issues.find((i) => i.id === dragRef.current);
    dragRef.current = null;
    setDropSection(null);
    if (!issue || (issue.sprintId || null) === sprintId) return;
    onMoveSprint(issue, sprintId);
  };

  return (
    <div className="tracker-backlog">
      <div className="pw-row pw-row--between">
        <p className="pw-text-helper">Seret issue antar-sprint, atau pakai menu ⋮ di setiap baris.</p>
        <div className="pw-row">
          {hiddenDone ? (
            <Chip selected={showDone} onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Sembunyikan yang selesai' : `Tampilkan ${hiddenDone} yang selesai`}
            </Chip>
          ) : null}
          <Button variant="secondary" icon="add" onClick={() => onSprintAction('create')}>Buat sprint</Button>
        </div>
      </div>
      {sections.map((section) => {
        const visible = section.kind === 'backlog' && !showDone ? section.issues.filter((i) => i.status !== 'done') : section.issues;
        const totals = sectionTotals(visible);
        const sprint = section.sprint;
        return (
          <section
            key={section.id}
            className={`tracker-section tracker-section--${section.kind}${dropSection === section.id ? ' is-drop-target' : ''}`}
            aria-labelledby={`${section.id}-title`}
            onDragOver={(event) => {
              if (dragRef.current == null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropSection !== section.id) setDropSection(section.id);
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropSection(null); }}
            onDrop={(event) => { event.preventDefault(); drop(section.sprintId); }}
          >
            <header className="tracker-section__head">
              <div className="tracker-section__title">
                <h3 id={`${section.id}-title`} className="pw-title-section" data-no-translate={sprint ? '' : undefined}>{section.title}</h3>
                {section.kind === 'active' ? <StatusBadge status="active" /> : null}
                {section.kind === 'planned' ? <StatusBadge status="scheduled" label="Direncanakan" /> : null}
                <span className="pw-text-helper">
                  {totals.count} issue · {totals.points} poin
                  {sprint?.startDate || sprint?.endDate ? ` · ${formatDate(sprint.startDate) || '…'} – ${formatDate(sprint.endDate) || '…'}` : ''}
                </span>
              </div>
              <div className="tracker-section__actions">
                {section.kind === 'active' ? (
                  <Button variant="secondary" icon="check_circle" onClick={() => onSprintAction('complete', sprint)}>Selesaikan sprint</Button>
                ) : null}
                {section.kind === 'planned' ? (
                  <Button
                    variant="secondary"
                    icon="play_arrow"
                    disabled={hasActive}
                    tooltip={hasActive ? 'Selesaikan sprint aktif terlebih dahulu' : undefined}
                    onClick={() => onSprintAction('start', sprint)}
                  >
                    Mulai sprint
                  </Button>
                ) : null}
                {sprint ? (
                  <ActionMenu label={`Aksi ${sprint.name}`} items={[{ label: 'Ubah sprint', icon: 'edit', onClick: () => onSprintAction('edit', sprint) }]} />
                ) : null}
              </div>
            </header>
            {sprint?.goal ? <p data-no-translate="" className="tracker-section__goal">{sprint.goal}</p> : null}
            <ul className="tracker-rows" aria-label={`Issue di ${section.title}`}>
              {visible.map((issue) => (
                <li
                  key={issue.id}
                  className="tracker-row pw-state-layer"
                  draggable
                  onDragStart={(event) => {
                    dragRef.current = issue.id;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', issue.key || String(issue.id));
                  }}
                  onDragEnd={() => { dragRef.current = null; setDropSection(null); }}
                  onClick={(event) => { if (!event.target.closest('a, button, [role="menu"]')) onOpen(issue.id); }}
                >
                  <IssueTypeIcon type={issue.type} />
                  <span className="tracker-key tracker-row__key" data-no-translate="">{issue.key}</span>
                  <Link data-no-translate="" className="tracker-row__title" to={{ search: issueSearch(issue.id) }}>{issue.title}</Link>
                  <span className="tracker-row__meta">
                    <StatusBadge status={categoryStatus(issue.status)} label={issue.statusName ? <NoTranslate>{issue.statusName}</NoTranslate> : undefined} />
                    <span className="tracker-row__priority"><PriorityBadge priority={issue.priority} /></span>
                    {formatPoints(issue.storyPoints) ? <span className="tracker-points">{formatPoints(issue.storyPoints)}<span className="pw-visually-hidden"> story points</span></span> : null}
                    <Avatar person={issue.assignee} size="sm" />
                  </span>
                  <ActionMenu
                    label={`Aksi untuk ${issue.key}`}
                    size="sm"
                    items={[
                      { label: 'Buka detail', icon: 'visibility', onClick: () => onOpen(issue.id) },
                      ...sprintTargets(project, issue.sprintId || null).map((t) => ({
                        label: t.label, icon: 'swap_horiz', onClick: () => onMoveSprint(issue, t.sprintId),
                      })),
                    ]}
                  />
                </li>
              ))}
              {!visible.length ? (
                <li className="tracker-rows__empty">
                  {section.kind === 'backlog' ? 'Backlog kosong.' : 'Seret issue ke sprint ini untuk merencanakan.'}
                </li>
              ) : null}
            </ul>
            <div>
              <Button variant="text" icon="add" onClick={() => onCreate({ sprintId: section.sprintId ? String(section.sprintId) : '' })}>
                Buat issue
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
