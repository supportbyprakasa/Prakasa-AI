import { useState } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Button from '../../components/Button';
import IconButton from '../../components/IconButton';
import Chip from '../../components/Chip';
import Icon from '../../components/Icon';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { RSVP_CHOICES, eventTimeLabel, linkify, rsvpLabel, rsvpStatus } from './calendarModel';

const errorText = (err, fallback) => err.response?.data?.error?.message || fallback;
export const eventPath = (event) => `/google-calendar/events/${encodeURIComponent(event.id)}`;

function Description({ text }) {
  return (
    <p className="pw-cal-detail__description" data-no-translate="">
      {linkify(text).map((part, i) => (part.type === 'link'
        // eslint-disable-next-line react/no-array-index-key
        ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.value}</a>
        // eslint-disable-next-line react/no-array-index-key
        : <span key={i}>{part.value}</span>))}
    </p>
  );
}

// One detail line: an 18px icon in the left column, the content beside it.
function Line({ icon, children }) {
  return (
    <div className="pw-cal-detail__line">
      <Icon name={icon} size="sm" className="pw-cal-detail__icon" />
      {children}
    </div>
  );
}

function rsvpSummary(attendees) {
  const count = (status) => attendees.filter((a) => a.responseStatus === status).length;
  return [
    `${attendees.length} tamu`,
    count('accepted') ? `${count('accepted')} ya` : null,
    count('tentative') ? `${count('tentative')} mungkin` : null,
    count('declined') ? `${count('declined')} tidak` : null,
    count('needsAction') ? `${count('needsAction')} belum membalas` : null,
  ].filter(Boolean).join(' · ');
}

export default function EventDetailModal({ event, canWrite, onClose, onEdit, onChanged, onDeleted }) {
  const [responding, setResponding] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!event) return null;

  const attendees = event.attendees || [];
  const params = { calendarId: event.calendarId };

  const respond = async (response) => {
    if (response === event.selfResponse) return;
    setResponding(response);
    try {
      await api.post(`${eventPath(event)}/respond`, { calendarId: event.calendarId, response });
      const fresh = await api.get(eventPath(event), { params });
      onChanged(fresh.data.data);
      toast(`Balasan disimpan: ${rsvpLabel(response)}`, 'success');
    } catch (err) {
      toast(errorText(err, 'Gagal menyimpan balasan'), 'error');
    } finally {
      setResponding(null);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(eventPath(event), { params });
      toast('Event dihapus', 'success');
      setConfirmOpen(false);
      onDeleted(event);
    } catch (err) {
      toast(errorText(err, 'Gagal menghapus event'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const footer = (
    <div className="pw-cal-detail__footer">
      {event.canRespond && canWrite ? (
        <div className="pw-cal-detail__rsvp" role="group" aria-label="Balas undangan">
          <span className="pw-text-helper">Hadir?</span>
          {RSVP_CHOICES.map((choice) => (
            <Chip
              key={choice.value}
              selected={event.selfResponse === choice.value}
              disabled={Boolean(responding)}
              onClick={() => respond(choice.value)}
            >
              {choice.label}
            </Chip>
          ))}
        </div>
      ) : <span />}
      <div className="pw-row">
        {event.htmlLink ? (
          <IconButton icon="open_in_new" href={event.htmlLink} target="_blank" rel="noopener noreferrer" label="Buka di Google Calendar" />
        ) : null}
        {event.canDelete && canWrite ? (
          <IconButton icon="delete" label="Hapus event" onClick={() => setConfirmOpen(true)} />
        ) : null}
        {event.canEdit && canWrite ? (
          <Button variant="secondary" icon="edit" onClick={() => onEdit(event)}>Ubah event</Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <Modal open onClose={onClose} title={event.summary || '(Tanpa judul)'} dataTitle={Boolean(event.summary)} size="md" footer={footer}>
        <div className="pw-cal-detail">
          <Line icon="schedule">
            <div>
              <div>{eventTimeLabel(event)}</div>
              {event.recurring ? <div className="pw-text-helper">Event berulang — perubahan hanya untuk kejadian ini.</div> : null}
            </div>
          </Line>

          {event.location ? (
            <Line icon="location_on">
              <div className="pw-break" data-no-translate="">{event.location}</div>
            </Line>
          ) : null}

          {event.meetUrl ? (
            <Line icon="videocam">
              <div className="pw-stack pw-stack--sm">
                <div>
                  <Button icon="videocam" href={event.meetUrl} target="_blank" rel="noopener noreferrer">Gabung dengan Google Meet</Button>
                </div>
                <span className="pw-text-helper pw-break">{event.meetUrl.replace(/^https:\/\//, '')}</span>
              </div>
            </Line>
          ) : null}

          {event.description ? (
            <Line icon="notes">
              <Description text={event.description} />
            </Line>
          ) : null}

          {event.organizer?.email ? (
            <Line icon="person">
              <div>
                <div data-no-translate="" className="pw-break">{event.organizer.displayName || event.organizer.email}</div>
                <div className="pw-text-helper">Penyelenggara{event.organizer.self ? ' (Anda)' : ''}</div>
              </div>
            </Line>
          ) : null}

          {attendees.length ? (
            <Line icon="group">
              <div className="pw-grow">
                <div className="pw-text-helper">{rsvpSummary(attendees)}</div>
                <ul className="pw-cal-attendees">
                  {attendees.map((a) => (
                    <li key={a.email} className="pw-cal-attendee">
                      <span className="pw-cal-attendee__name">
                        <span className="pw-break"><span data-no-translate="">{a.displayName || a.email}</span>{a.self ? ' (Anda)' : ''}</span>
                        {a.displayName ? <span data-no-translate="" className="pw-text-meta pw-break">{a.email}</span> : null}
                        {a.organizer ? <span className="pw-text-meta">Penyelenggara</span> : a.optional ? <span className="pw-text-meta">Opsional</span> : null}
                      </span>
                      <StatusBadge status={rsvpStatus(a.responseStatus)} label={rsvpLabel(a.responseStatus)} />
                    </li>
                  ))}
                </ul>
                {event.attendeesOmitted ? <div className="pw-text-helper">Sebagian tamu tidak ditampilkan.</div> : null}
              </div>
            </Line>
          ) : null}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="Hapus event?"
        message={`Event “${event.summary || '(Tanpa judul)'}” akan dihapus dari Google Calendar${attendees.length ? ' dan tamu akan diberi tahu' : ''}.`}
        confirmLabel="Hapus event"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
