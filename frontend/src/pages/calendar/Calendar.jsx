import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Page from '../../components/Page';
import Button from '../../components/Button';
import IconButton from '../../components/IconButton';
import Chip from '../../components/Chip';
import Segmented from '../../components/Segmented';
import Banner from '../../components/Banner';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import {
  VIEWS, isView, isDayKey, todayKey, viewRange, rangeQuery, rangeTitle, shiftAnchor, prepareEvent,
  emptyForm, formFromEvent, suggestedStart, zonedParts,
} from './calendarModel';
import { AgendaView, MonthView, TimeGridView } from './CalendarViews';
import EventDetailModal from './EventDetailModal';
import EventFormModal from './EventFormModal';
import useOpenFromUrl, { hasUnsavedForm } from '../../components/ai/useOpenFromUrl';
import './calendar.css';

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches;
const VIEW_OPTIONS = VIEWS.map((v) => ({ value: v.id, label: v.label }));
const errorOf = (err, fallback) => ({
  code: err.response?.data?.error?.code || null,
  message: err.response?.data?.error?.message || fallback,
});
// A Google event id, as the server accepts it (and no longer than a route carries).
const isEventId = (value) => /^[A-Za-z0-9_-]{1,100}$/.test(String(value));
const SETUP_CODES = ['GOOGLE_ACCOUNT_NOT_LINKED', 'GOOGLE_SCOPE_NOT_GRANTED', 'GOOGLE_API_DISABLED'];

export default function Calendar() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.permissions?.includes('meeting.create'));
  const [params, setParams] = useSearchParams();
  const [defaultView] = useState(() => (isPhone() ? 'agenda' : 'week'));
  const [now, setNow] = useState(() => Date.now());
  const today = todayKey(now);
  const view = isView(params.get('view')) ? params.get('view') : defaultView;
  const anchor = isDayKey(params.get('date')) ? params.get('date') : today;
  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);

  const [calendars, setCalendars] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState(null);
  const [formState, setFormState] = useState(null); // { initialForm, event }
  const requestRef = useRef(0);

  const navigate = useCallback((nextView, nextDate) => {
    setParams({ view: nextView, date: nextDate }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get('/google-calendar/calendars')
      .then((res) => setCalendars(res.data.data.calendars || []))
      .catch(() => setCalendars([{ id: 'primary', summary: 'Kalender saya', fallback: true, primary: true, backgroundColor: null }]));
  }, []);

  const visibleCalendars = useMemo(() => (calendars || []).filter((c) => !hidden.has(c.id)), [calendars, hidden]);

  useEffect(() => {
    if (!calendars) return;
    const id = requestRef.current + 1;
    requestRef.current = id;
    setLoading(true);
    setError(null);
    const query = rangeQuery(range);
    Promise.allSettled(visibleCalendars.map((cal) => api.get('/google-calendar/events', { params: { calendarId: cal.id, ...query } })
      .then((res) => ({ cal, data: res.data.data }))))
      .then((results) => {
        if (requestRef.current !== id) return;
        const primaryFailed = results.find((r, i) => r.status === 'rejected' && visibleCalendars[i].primary);
        if (primaryFailed) {
          setError(errorOf(primaryFailed.reason, 'Gagal memuat Google Calendar'));
          setEvents([]);
          return;
        }
        const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        setEvents(ok.flatMap(({ cal, data }) => data.events.map((event) => ({
          ...prepareEvent(event),
          key: `${cal.id}:${event.id}`,
          color: cal.primary ? null : cal.backgroundColor,
        }))));
        const partial = ok.some(({ data }) => data.truncated || data.clamped) || ok.length < results.length;
        setNotice(partial ? 'Sebagian event tidak ditampilkan. Persempit rentang tampilan atau buka di Google Calendar.' : null);
        setLoaded(true);
      })
      .finally(() => { if (requestRef.current === id) setLoading(false); });
  }, [calendars, visibleCalendars, range, reload]);

  const refresh = () => setReload((n) => n + 1);
  const openDay = (key) => navigate('day', key);
  const defaultCreateDay = () => {
    const sameMonth = view !== 'month' || today.slice(0, 7) === anchor.slice(0, 7);
    if (range.days.includes(today) && sameMonth) return today;
    return view === 'month' ? `${anchor.slice(0, 7)}-01` : range.startKey;
  };
  const openCreate = (key, minutes) => {
    if (!canWrite) return;
    const day = key || defaultCreateDay();
    setFormState({ initialForm: emptyForm(day, minutes ?? suggestedStart(day, now)), event: null });
  };
  const openEdit = (event) => {
    setSelected(null);
    setFormState({ initialForm: formFromEvent(event), event });
  };
  const onSaved = (saved) => {
    setFormState(null);
    const start = saved.start?.date || (saved.start?.dateTime ? zonedParts(Date.parse(saved.start.dateTime)).key : null);
    if (start && !range.days.includes(start)) navigate(view, start);
    else refresh();
  };
  const onChanged = (fresh) => {
    const next = { ...prepareEvent(fresh), key: selected.key, color: selected.color };
    setSelected(next);
    setEvents((list) => list.map((e) => (e.key === next.key ? next : e)));
  };
  const onDeleted = (gone) => {
    setSelected(null);
    setEvents((list) => list.filter((e) => e.key !== gone.key));
    refresh();
  };
  // /calendar?baru=1 opens "Buat event"; /calendar?ubah=<id event> opens the
  // form of an event in the range on screen (a link, or Prakasa AI's buka_halaman).
  // One form for create and edit: an unsaved one is never replaced by a link (keepUnsaved).
  useOpenFromUrl('baru', () => openCreate(), { enabled: canWrite, keepUnsaved: true });
  // An event outside the range on screen (Prakasa AI's acara_kalender_saya lists up to
  // 31 days) is read by id from the user's own primary calendar, then opened the same way.
  useOpenFromUrl('ubah', (id) => {
    if (!canWrite) return;
    const found = events.find((item) => String(item.id) === String(id));
    if (found) { if (found.canEdit) openEdit(found); return; }
    if (!isEventId(id)) return;
    api.get(`/google-calendar/events/${encodeURIComponent(id)}`)
      .then((res) => {
        const event = { ...prepareEvent(res.data.data), key: `primary:${id}`, color: null };
        if (event.canEdit && !hasUnsavedForm()) openEdit(event);
      })
      .catch(() => {});
  }, { enabled: loaded && !loading, keepUnsaved: true });
  const toggleCalendar = (id) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const viewProps = { events, today, now, onOpen: setSelected, onOpenDay: openDay, onCreateAt: canWrite ? openCreate : undefined };

  let body;
  if (error) {
    body = SETUP_CODES.includes(error.code)
      ? <Banner tone="warning" title="Google Calendar belum bisa dibuka">{error.message}</Banner>
      : <EmptyState tone="error" title="Gagal memuat kalender" description={error.message} action={<Button variant="secondary" onClick={refresh}>Coba lagi</Button>} />;
  } else if (!loaded) {
    body = <LoadingState label="Memuat kalender…" />;
  } else if (view === 'month') {
    body = <MonthView anchor={anchor} {...viewProps} />;
  } else if (view === 'agenda') {
    body = <AgendaView range={range} {...viewProps} />;
  } else {
    body = <TimeGridView days={range.days} {...viewProps} />;
  }

  return (
    <Page
      className="pw-calendar"
      title="Kalender"
      description="Kalender Google Anda — lihat, buat, dan balas undangan event langsung di Prakasa Workspace."
      actions={(
        <>
          <IconButton icon="open_in_new" href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" label="Buka di Google Calendar" />
          {canWrite ? <Button icon="add" onClick={() => openCreate()}>Buat event</Button> : null}
        </>
      )}
    >
      <div className="pw-stack pw-stack--sm">
        <div className="pw-cal-toolbar">
          <div className="pw-cal-toolbar__nav">
            <Button variant="secondary" onClick={() => navigate(view, today)}>Hari ini</Button>
            <IconButton size="sm" icon="chevron_left" label="Sebelumnya" onClick={() => navigate(view, shiftAnchor(view, anchor, -1))} />
            <IconButton size="sm" icon="chevron_right" label="Berikutnya" onClick={() => navigate(view, shiftAnchor(view, anchor, 1))} />
            <h2 className="pw-cal-toolbar__title" aria-live="polite">{rangeTitle(view, anchor)}</h2>
          </div>
          <Segmented className="pw-cal-toolbar__views" options={VIEW_OPTIONS} value={view} onChange={(next) => navigate(next, anchor)} label="Tampilan kalender" />
        </div>

        {calendars && calendars.length > 1 ? (
          <div className="pw-row" role="group" aria-label="Kalender yang ditampilkan">
            {calendars.map((cal) => (
              <Chip data={!cal.fallback} key={cal.id} selected={!hidden.has(cal.id)} onClick={() => toggleCalendar(cal.id)}>{cal.summary}</Chip>
            ))}
          </div>
        ) : null}
      </div>

      {notice && !error ? <Banner tone="warning">{notice}</Banner> : null}

      <div className={`pw-cal-surface${loading && loaded ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
        {body}
      </div>

      {selected ? (
        <EventDetailModal
          event={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onEdit={openEdit}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      ) : null}
      <EventFormModal
        open={Boolean(formState)}
        initialForm={formState?.initialForm}
        event={formState?.event}
        onClose={() => setFormState(null)}
        onSaved={onSaved}
      />
    </Page>
  );
}
