import CountBadge from '../CountBadge';
import './kanban.css';

// The one kanban look, shared by the Task Board and the Project Tracker board:
// tinted generation-B columns (radius 12) that scroll sideways inside the
// board only, a column header with the name and a CountBadge, and white panel
// cards (1px --pw-outline-panel, radius 3) with the state layer as hover.
// Drag and drop stays with the page; these parts only carry its handlers.

export function KanbanBoard({ label, children, className = '' }) {
  return (
    <div className={['pw-kanban', className].filter(Boolean).join(' ')} role="list" aria-label={label}>
      {children}
    </div>
  );
}

// count: shown in the CountBadge (a number, or text such as "3/5" for a WIP
// limit). `note`: one line under the header (e.g. the WIP limit); `alert`
// turns it --pw-error. `actions`: small header controls (an IconButton).
// `dataTitle`: the column is named by users (a board column), so the language
// switch leaves the heading alone.
export function KanbanColumn({
  title, dataTitle = false, count, countLabel, note, alert = false, actions, dropTarget = false,
  empty, className = '', children, ...handlers
}) {
  const text = count === undefined || count === null ? '' : String(count);
  return (
    <section
      role="listitem"
      aria-label={countLabel ? `${title}, ${countLabel}` : title}
      className={['pw-kanban__column', dropTarget ? 'is-drop-target' : '', className].filter(Boolean).join(' ')}
      {...handlers}
    >
      <header className="pw-kanban__head">
        <h3 className="pw-kanban__name" data-no-translate={dataTitle ? '' : undefined}>{title}</h3>
        {text && text !== '0' ? <CountBadge label={countLabel}>{text}</CountBadge> : <span className="pw-kanban__zero" aria-hidden="true">{text}</span>}
        {actions ? <span className="pw-kanban__actions">{actions}</span> : null}
      </header>
      {note ? <p className={`pw-kanban__note${alert ? ' is-alert' : ''}`}>{note}</p> : null}
      <ul className="pw-kanban__list">
        {children}
        {empty ? <li className="pw-kanban__empty">{empty}</li> : null}
      </ul>
    </section>
  );
}

// A card; `dragging` dims it, `marker` draws the drop line above it.
export function KanbanCard({ dragging = false, marker = false, muted = false, className = '', children, ...props }) {
  return (
    <>
      {marker ? <li className="pw-kanban__marker" aria-hidden="true" /> : null}
      <li
        className={[
          'pw-kanban__card', 'pw-state-layer', dragging ? 'is-dragging' : '', muted ? 'is-muted' : '',
          props.draggable ? 'is-draggable' : '', className,
        ].filter(Boolean).join(' ')}
        {...props}
      >
        {children}
      </li>
    </>
  );
}

// The empty slot a dragged card would land in at the end of a column.
export function KanbanPlaceholder() {
  return <li className="pw-kanban__placeholder" aria-hidden="true" />;
}
