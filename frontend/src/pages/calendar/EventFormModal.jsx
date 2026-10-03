import { useId, useLayoutEffect, useState } from 'react';
import api from '../../api/client';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Checkbox from '../../components/Checkbox';
import DateInput from '../../components/DateInput';
import Input from '../../components/Input';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { isValidEmail, moveStart, splitEmails, toEventPayload, validateEventForm } from './calendarModel';
import { eventPath } from './EventDetailModal';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

// Prakasa AI may fill what the event is and when; the user reviews it and
// presses the form's own button (docs/prakasa-ai-rencana.md §9.9). Guests,
// the email to them and Google Meet stay with the user: saving with them
// sends real invitations.
const eventFields = ({ allDay, editing }) => [
  f.text('summary', 'Judul', { required: true, maxLength: 300 }),
  f.text('location', 'Lokasi', { maxLength: 500 }),
  f.textarea('description', 'Deskripsi', { maxLength: 8000 }),
  f.checkbox('allDay', 'Seharian'),
  f.date('startDate', 'Tanggal mulai', { required: true }),
  ...(allDay ? [] : [f.time('startTime', 'Jam mulai', { required: true, hint: 'Zona waktu WIB (Asia/Jakarta)' })]),
  f.date('endDate', 'Tanggal selesai', { required: true }),
  ...(allDay ? [] : [f.time('endTime', 'Jam selesai', { required: true })]),
  f.userOnly('attendees', 'Tambah tamu'),
  f.userOnly('addMeet', 'Tambahkan Google Meet', 'checkbox'),
  f.userOnly('notify', editing ? 'Kirim pemberitahuan perubahan email ke tamu' : 'Kirim undangan email ke tamu', 'checkbox'),
];
const AI_EVENT = defineAIForm({
  id: 'calendar-event',
  title: 'Buat event',
  permission: 'meeting.create',
  submitLabel: 'Simpan event',
  fields: eventFields,
});
const AI_EVENT_EDIT = defineAIForm({
  id: 'calendar-event-edit',
  title: 'Ubah event',
  permission: 'meeting.create',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: eventFields,
});

// Create (event = null) or edit an event in the user's own Google Calendar.
// A long form (9 fields), so it is the full-screen dialog of §3.3: three
// cards (detail, time, guests) and Batal + Simpan bottom-right.
export default function EventFormModal({ open, initialForm, event, onClose, onSaved }) {
  const formId = useId();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [guestDraft, setGuestDraft] = useState('');
  const [guestError, setGuestError] = useState('');
  const [saving, setSaving] = useState(false);

  // Before paint, so a reopened dialog never shows the previous form for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    setForm(initialForm);
    setErrors({});
    setGuestDraft('');
    setGuestError('');
  }, [open, initialForm]);

  const editing = Boolean(event);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setStart = (patch) => setForm((current) => moveStart(current, patch));

  // The AI's values go in as given (it names the end itself); the form's own
  // check says when the end no longer follows the start.
  const ai = usePrakasaAIForm(editing ? AI_EVENT_EDIT : AI_EVENT, {
    enabled: Boolean(open && form),
    record: { type: 'calendar_event', id: event?.id },
    values: form || {},
    setValues: setForm,
    setErrors,
    validate: validateEventForm,
    initialValues: initialForm,
    context: { allDay: Boolean(form?.allDay), editing },
  });

  // Adds every valid email typed so far; keeps invalid text in the box.
  const addGuests = (text = guestDraft) => {
    const emails = splitEmails(text);
    if (!emails.length) return true;
    const invalid = emails.filter((email) => !isValidEmail(email));
    const valid = emails.filter((email) => isValidEmail(email));
    if (valid.length) setForm((current) => ({ ...current, attendees: [...new Set([...current.attendees, ...valid])] }));
    setGuestDraft(invalid.join(', '));
    setGuestError(invalid.length ? `Email tidak valid: ${invalid.join(', ')}` : '');
    return invalid.length === 0;
  };

  const onGuestKey = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addGuests();
    } else if (e.key === 'Backspace' && !guestDraft && form?.attendees.length) {
      set({ attendees: form.attendees.slice(0, -1) });
    }
  };

  // The first field with an error takes focus (the button may be far below it).
  const focusFirstError = (formNode) => window.requestAnimationFrame(() => {
    formNode?.querySelector('[aria-invalid="true"]')?.focus();
  });

  const submit = async (e) => {
    e.preventDefault();
    const formNode = e.currentTarget;
    if (!addGuests()) { focusFirstError(formNode); return; }
    const pending = splitEmails(guestDraft).filter(isValidEmail);
    const next = { ...form, attendees: [...new Set([...form.attendees, ...pending])] };
    const found = validateEventForm(next);
    setErrors(found);
    if (Object.keys(found).length) { focusFirstError(formNode); return; }
    setSaving(true);
    try {
      const payload = toEventPayload(next);
      const response = editing
        ? await api.patch(eventPath(event), { ...payload, calendarId: event.calendarId })
        : await api.post('/google-calendar/events', payload);
      toast(editing ? 'Perubahan event disimpan' : 'Event dibuat', 'success');
      onSaved(response.data.data);
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal menyimpan event', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Typed or picked changes (a half-typed guest too) ask before discarding.
  const dirty = Boolean(guestDraft.trim()) || (Boolean(form) && JSON.stringify(form) !== JSON.stringify(initialForm));

  const removeGuest = (email) => set({ attendees: form.attendees.filter((x) => x !== email) });

  return (
    <FullScreenDialog
      open={Boolean(open && form)}
      onClose={saving ? undefined : onClose}
      dirty={dirty}
      title={editing ? 'Ubah event' : 'Buat event'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan event'}</Button>
        </>
      )}
    >
      {form ? (
        <form id={formId} className="pw-cal-form" onSubmit={submit} noValidate>
          {ai.notice}
          <FullScreenSection title="Detail event">
            <div className="pw-fsdialog__fields">
              <Input
                label="Judul"
                required
                autoFocus
                maxLength={300}
                value={form.summary}
                error={errors.summary}
                placeholder="mis. Rapat mingguan tim"
                fieldClassName="pw-cal-form__wide"
                {...ai.field('summary')}
                onChange={(e) => set({ summary: e.target.value })}
              />
              <Input
                label="Lokasi"
                maxLength={500}
                value={form.location}
                placeholder="mis. Ruang rapat lt. 2"
                fieldClassName="pw-cal-form__wide"
                {...ai.field('location')}
                onChange={(e) => set({ location: e.target.value })}
              />
              <Textarea
                label="Deskripsi"
                rows={4}
                maxLength={8000}
                value={form.description}
                fieldClassName="pw-cal-form__wide"
                {...ai.field('description')}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
          </FullScreenSection>

          <FullScreenSection title="Waktu">
            <div className="pw-cal-form__group">
              <Checkbox label="Seharian" checked={form.allDay} {...ai.field('allDay')} onChange={(e) => setStart({ allDay: e.target.checked })} />
              <div className="pw-fsdialog__fields">
                <DateInput label="Tanggal mulai" required value={form.startDate} error={errors.startDate} {...ai.field('startDate')} onChange={(e) => setStart({ startDate: e.target.value })} />
                {!form.allDay ? <DateInput type="time" label="Jam mulai" required step={300} value={form.startTime} error={errors.startTime} hint="Zona waktu WIB (Asia/Jakarta)" {...ai.field('startTime')} onChange={(e) => setStart({ startTime: e.target.value })} /> : null}
                <DateInput label="Tanggal selesai" required value={form.endDate} error={errors.endDate} {...ai.field('endDate')} onChange={(e) => set({ endDate: e.target.value })} />
                {!form.allDay ? <DateInput type="time" label="Jam selesai" required step={300} value={form.endTime} error={errors.endTime} {...ai.field('endTime')} onChange={(e) => set({ endTime: e.target.value })} /> : null}
              </div>
            </div>
          </FullScreenSection>

          <FullScreenSection title="Tamu dan Google Meet">
            <div className="pw-cal-form__group">
              <div className="pw-fsdialog__fields">
                <Input
                  type="email"
                  label="Tambah tamu"
                  value={guestDraft}
                  placeholder="nama@prakasafoods.com"
                  hint="Tekan Enter atau koma untuk menambahkan email."
                  error={guestError || errors.attendees}
                  onChange={(e) => { setGuestDraft(e.target.value); setGuestError(''); }}
                  onKeyDown={onGuestKey}
                  onBlur={() => addGuests()}
                />
              </div>
              {form.attendees.length ? (
                <ul className="pw-cal-guests" aria-label="Daftar tamu">
                  {form.attendees.map((email) => (
                    <li key={email}>
                      <Chip data trailingIcon="close" tooltip="Hapus tamu" aria-label={`Hapus ${email}`} onClick={() => removeGuest(email)}>{email}</Chip>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Checkbox
                label={form.meetLocked ? 'Google Meet sudah terpasang' : 'Tambahkan Google Meet'}
                checked={form.addMeet}
                disabled={form.meetLocked}
                onChange={(e) => set({ addMeet: e.target.checked })}
              />
              <Checkbox
                label={`Kirim ${editing ? 'pemberitahuan perubahan' : 'undangan'} email ke tamu`}
                checked={form.notify}
                onChange={(e) => set({ notify: e.target.checked })}
              />
            </div>
          </FullScreenSection>
        </form>
      ) : null}
    </FullScreenDialog>
  );
}
