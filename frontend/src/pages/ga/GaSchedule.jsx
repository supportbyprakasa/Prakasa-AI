import { Mixed, data } from '../../i18n/NoTranslate';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DateInput from '../../components/DateInput';
import EmptyState from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import { SkeletonLine } from '../../components/Skeleton';
import StatusBadge from '../../components/StatusBadge';
import {
  BOOKING_STATUS_LABELS, addDays, apiErrorMessage, bookingStatusKey, buildAgenda, dayRange, formatWibDay, todayWib,
  TRACKCAR_URL,
} from './gaModel';
import './ga.css';

// Jadwal (§3.5): one card per room or vehicle with that WIB day's bookings as
// an agenda list (not a calendar grid) and a "Pesan" button. People outside
// People & Culture see others' bookings as "Terpakai · divisi" only (S12).
export default function GaSchedule({ resources, canProcess, onBook }) {
  const kind = 'room';
  const [day, setDay] = useState(todayWib());
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const shown = (resources || []).filter((r) => r.kind === kind && r.isActive !== false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/ga/bookings', { params: { kind, ...dayRange(day) } });
      setState({ rows: r.data.data || [], loading: false, error: '' });
    } catch (error) {
      setState({ rows: [], loading: false, error: apiErrorMessage(error) });
    }
  }, [kind, day]);
  useEffect(() => { load(); }, [load]);

  const agenda = buildAgenda(shown, state.rows, day);
  const today = todayWib();

  return (
    <div className="pw-stack">
      <div className="ga-schedule__bar">
        {/* Rooms only: vehicles are borrowed in TrackCar (owner, 1 Oct 2026). */}
        <Button variant="text" icon="directions_car" href={TRACKCAR_URL} target="_blank" rel="noopener noreferrer">Pinjam kendaraan di TrackCar</Button>
        <div className="ga-schedule__day">
          <IconButton size="sm" icon="chevron_left" label="Hari sebelumnya" onClick={() => setDay((d) => addDays(d, -1))} />
          <DateInput label="Tanggal" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} fieldClassName="ga-schedule__date" />
          <IconButton size="sm" icon="chevron_right" label="Hari berikutnya" onClick={() => setDay((d) => addDays(d, 1))} />
          {day !== today ? <Button variant="text" onClick={() => setDay(today)}>Hari ini</Button> : null}
        </div>
      </div>
      <p className="pw-text-helper">
        {formatWibDay(day)} · waktu WIB{canProcess ? '' : ' · Peminjaman orang lain tampil sebagai "Terpakai" dengan divisinya saja.'}
      </p>

      {state.error ? (
        <EmptyState tone="error" title="Jadwal tidak dapat dimuat" description={state.error} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      ) : null}
      {!state.error && !shown.length ? (
        <EmptyState
          icon="meeting_room"
          title="Belum ada ruang"
          description="People & Culture menambahkannya di tab Sumber daya."
        />
      ) : null}
      {!state.error && shown.length ? (
        <div className="ga-agenda">
          {agenda.map(({ resource, items }) => (
            <Card
              key={resource.id}
              size="sm"
              title={resource.name}
              dataTitle
              subtitle={<Mixed parts={[data(resource.locationName), data(resource.plateNumber), resource.capacity ? `${resource.capacity} orang` : null]} />}
              actions={<Button variant="secondary" icon="add" data-i18n-context="booking" onClick={() => onBook(resource, day)}>Pesan</Button>}
            >
              {state.loading ? <div className="pw-stack pw-stack--sm"><SkeletonLine width="60%" /><SkeletonLine width="40%" /></div> : null}
              {!state.loading && !items.length ? <p className="pw-text-helper">Kosong sepanjang hari.</p> : null}
              {!state.loading && items.length ? (
                <ul className="ga-agenda__list">
                  {items.map((item) => (
                    <li key={item.key} className="ga-agenda__item">
                      <span className="ga-agenda__time">{item.time}</span>
                      <span className="ga-agenda__main">
                        {item.to
                          ? <Link to={item.to} className="ga-agenda__title" data-no-translate={item.titleData ? '' : undefined}>{item.title}</Link>
                          : <span className="ga-agenda__title" data-no-translate={item.titleData ? '' : undefined}>{item.title}</span>}
                        {item.sub ? <span className="pw-text-meta"><Mixed parts={item.subParts} /></span> : null}
                      </span>
                      {!item.booking.masked ? (
                        <StatusBadge
                          status={item.booking.late ? 'booking_late' : bookingStatusKey(item.booking.status)}
                          label={item.booking.late ? undefined : BOOKING_STATUS_LABELS[item.booking.status]}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
