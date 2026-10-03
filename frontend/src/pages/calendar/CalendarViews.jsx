import { useEffect, useMemo, useRef } from 'react';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import {
  WEEKDAYS_SHORT, weekday, daySegments, layoutDay, monthGrid, monthCell, agendaGroups,
  formatClock, chipTime, nowMinutes, overlapsDay, sortEvents, formatDay, monthShort,
} from './calendarModel';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const EARLY_HOUR = 7;

// Keyboard-and-mouse activation for non-button interactive elements (event
// blocks, day numbers). Real buttons are reserved for actions (§3.2). Each
// such element also carries the shared state layer (hover/focus/press, §1.10).
const STATE = 'pw-state-layer';
function pressable(onActivate, label) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (event) => { event.stopPropagation(); onActivate(); },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }
    },
  };
}

// Dynamic values only: computed position/size and the calendar's own colour.
const colorVar = (event) => (event.color ? { '--pw-cal-color': event.color } : undefined);
const gridVars = (count) => ({ '--pw-cal-days': count });
const blockVars = (seg) => ({
  '--pw-cal-start': seg.startMin,
  '--pw-cal-end': seg.visualEnd,
  '--pw-cal-col': seg.col,
  '--pw-cal-cols': seg.cols,
  ...colorVar(seg.event),
});
const nowVars = (minutes) => ({ '--pw-cal-start': minutes });
// Under 45 minutes the title and time share one line; under 75 the location is left out.
const blockSize = (seg) => {
  const minutes = seg.visualEnd - seg.startMin;
  if (minutes < 45) return ' is-short';
  return minutes < 75 ? ' is-compact' : '';
};

function eventClass(base, event) {
  const response = event.selfResponse;
  return [
    base,
    STATE,
    response === 'declined' ? 'is-declined' : '',
    response === 'needsAction' ? 'is-pending' : '',
    response === 'tentative' ? 'is-tentative' : '',
  ].filter(Boolean).join(' ');
}

const titleOf = (event) => event.summary || '(Tanpa judul)';

function AllDayChip({ event, onOpen }) {
  return (
    <div className={eventClass('pw-cal-chip pw-cal-chip--filled', event)} style={colorVar(event)} {...pressable(() => onOpen(event), `${titleOf(event)}, seharian`)}>
      <span className="pw-cal-chip__title" data-no-translate={event.summary ? '' : undefined}>{titleOf(event)}</span>
    </div>
  );
}

export function TimeGridView({ days, events, today, now, onOpen, onCreateAt, onOpenDay }) {
  const scrollRef = useRef(null);
  const perDay = useMemo(() => days.map((key) => ({
    key,
    allDay: sortEvents(events.filter((e) => e.spansRow && overlapsDay(e, key))),
    blocks: layoutDay(daySegments(events, key)),
  })), [days, events]);

  // Open the grid on the first event of the range (or 07.00), like Google.
  const firstKey = days[0];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const starts = perDay.flatMap((d) => d.blocks.map((b) => b.startMin));
    const minute = starts.length ? Math.min(EARLY_HOUR * 60, Math.min(...starts)) : EARLY_HOUR * 60;
    const hourPx = parseFloat(getComputedStyle(node).getPropertyValue('--pw-cal-hour')) || 48;
    node.scrollTop = Math.max(0, (minute / 60) * hourPx - 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length]);

  const createAt = (key) => (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const hourPx = rect.height / 24;
    const minutes = Math.floor(((event.clientY - rect.top) / hourPx) * 2) * 30;
    onCreateAt?.(key, minutes);
  };

  return (
    <div className={`pw-cal-time${days.length === 1 ? ' is-day' : ''}`} style={gridVars(days.length)}>
      <div className="pw-cal-time__scroll" ref={scrollRef}>
        <div className="pw-cal-time__top">
          <div className="pw-cal-time__row">
            <div className="pw-cal-time__gutter" />
            {days.map((key) => (
              <div key={key} className={`pw-cal-time__dayhead${key === today ? ' is-today' : ''}`}>
                <span className="pw-cal-time__weekday">{WEEKDAYS_SHORT[weekday(key)]}</span>
                <span className={`pw-cal-daynum ${STATE}`} {...pressable(() => onOpenDay(key), `Buka ${formatDay(key)}`)}>{Number(key.slice(8))}</span>
              </div>
            ))}
          </div>
          <div className="pw-cal-time__row pw-cal-time__allday">
            <div className="pw-cal-time__gutter pw-cal-time__gutter-label">Seharian</div>
            {perDay.map((day) => (
              <div key={day.key} className="pw-cal-time__allday-cell">
                {day.allDay.map((event) => <AllDayChip key={event.key} event={event} onOpen={onOpen} />)}
              </div>
            ))}
          </div>
        </div>
        <div className="pw-cal-time__row pw-cal-time__body">
          <div className="pw-cal-time__gutter pw-cal-time__hours" aria-hidden="true">
            {HOURS.map((h) => <span key={h} className="pw-cal-time__hour">{h === 0 ? '' : `${String(h).padStart(2, '0')}.00`}</span>)}
          </div>
          {perDay.map((day) => (
            <div key={day.key} className="pw-cal-time__col" onClick={createAt(day.key)}>
              {day.blocks.map((seg) => (
                <div
                  key={seg.event.key}
                  className={eventClass(`pw-cal-block${blockSize(seg)}`, seg.event)}
                  style={blockVars(seg)}
                  {...pressable(() => onOpen(seg.event), `${titleOf(seg.event)}, ${formatClock(seg.event.startMs)} – ${formatClock(seg.event.endMs)}`)}
                  data-no-translate={seg.event.summary ? 'attr' : undefined}
                >
                  <span className="pw-cal-block__title" data-no-translate={seg.event.summary ? '' : undefined}>{titleOf(seg.event)}</span>
                  <span className="pw-cal-block__time">{formatClock(seg.event.startMs)} – {formatClock(seg.event.endMs)}</span>
                  {seg.event.location ? <span className="pw-cal-block__meta" data-no-translate="">{seg.event.location}</span> : null}
                </div>
              ))}
              {day.key === today ? <div className="pw-cal-now" style={nowVars(nowMinutes(now))} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonthView({ anchor, events, today, onOpen, onOpenDay, onCreateAt }) {
  const weeks = useMemo(() => monthGrid(anchor, today), [anchor, today]);
  return (
    <div className="pw-cal-month" role="grid" aria-label="Kalender bulan">
      <div className="pw-cal-month__head" role="row">
        {weeks[0].map((cell) => <span key={cell.key} role="columnheader">{WEEKDAYS_SHORT[weekday(cell.key)]}</span>)}
      </div>
      {weeks.map((week) => (
        <div key={week[0].key} className="pw-cal-month__week" role="row">
          {week.map((cell) => {
            const { visible, more } = monthCell(events, cell.key);
            return (
              <div
                key={cell.key}
                role="gridcell"
                className={`pw-cal-month__cell${cell.inMonth ? '' : ' is-outside'}${cell.isToday ? ' is-today' : ''}`}
                onClick={() => onCreateAt?.(cell.key)}
              >
                <span className={`pw-cal-daynum ${STATE}`} {...pressable(() => onOpenDay(cell.key), `Buka ${formatDay(cell.key)}`)}>
                  {cell.day === 1 ? formatDay(cell.key, { weekdayStyle: null, year: false }) : cell.day}
                </span>
                {visible.map((event) => (
                  event.spansRow ? (
                    <AllDayChip key={event.key} event={event} onOpen={onOpen} />
                  ) : (
                    <div key={event.key} className={eventClass('pw-cal-chip', event)} style={colorVar(event)} {...pressable(() => onOpen(event), `${titleOf(event)}, ${formatClock(event.startMs)}`)} data-no-translate={event.summary ? 'attr' : undefined}>
                      <span className="pw-cal-chip__dot" aria-hidden="true" />
                      <span className="pw-cal-chip__time">{chipTime(event, cell.key)}</span>
                      <span className="pw-cal-chip__title" data-no-translate={event.summary ? '' : undefined}>{titleOf(event)}</span>
                    </div>
                  )
                ))}
                {more > 0 ? (
                  <span className={`pw-cal-month__more ${STATE}`} {...pressable(() => onOpenDay(cell.key), `${more} event lainnya pada ${formatDay(cell.key)}`)}>+{more} lainnya</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function AgendaView({ range, events, today, onOpen, onOpenDay }) {
  const groups = useMemo(() => agendaGroups(events, range), [events, range]);
  if (!groups.length) {
    return <EmptyState icon="event_busy" title="Tidak ada event" description="Belum ada event dalam rentang ini." />;
  }
  return (
    <div className="pw-cal-agenda">
      {groups.map((group) => (
        <section key={group.key} className={`pw-cal-agenda__day${group.key === today ? ' is-today' : ''}`} aria-label={formatDay(group.key)}>
          <div className="pw-cal-agenda__date">
            <span className={`pw-cal-daynum ${STATE}`} {...pressable(() => onOpenDay(group.key), `Buka ${formatDay(group.key)}`)}>{Number(group.key.slice(8))}</span>
            <span className="pw-cal-agenda__weekday">{monthShort(group.key)}, {WEEKDAYS_SHORT[weekday(group.key)]}</span>
          </div>
          <ul className="pw-cal-agenda__list">
            {group.events.map((event) => (
              <li key={event.key}>
                <div className={eventClass('pw-cal-agenda__row', event)} style={colorVar(event)} {...pressable(() => onOpen(event), titleOf(event))} data-no-translate={event.summary ? 'attr' : undefined}>
                  <span className="pw-cal-agenda__time">
                    {event.spansRow ? 'Seharian' : `${chipTime(event, group.key)} – ${formatClock(event.endMs)}`}
                  </span>
                  <span className="pw-cal-chip__dot" aria-hidden="true" />
                  <span className="pw-cal-agenda__text">
                    <span className="pw-cal-agenda__title" data-no-translate={event.summary ? '' : undefined}>{titleOf(event)}</span>
                    {event.location ? <span className="pw-cal-agenda__meta"><Icon name="location_on" size="sm" /><span className="pw-cal-agenda__place" data-no-translate="">{event.location}</span></span> : null}
                  </span>
                  {event.meetUrl ? <Icon name="videocam" size="md" className="pw-cal-agenda__meet" label="Ada Google Meet" /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
