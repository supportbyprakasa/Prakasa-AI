import { tr } from '../../i18n/tr.js';
import { Mixed, Context } from '../../i18n/NoTranslate';
import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Segmented from '../../components/Segmented';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import Textarea from '../../components/Textarea';
import TimeInput from '../../components/TimeInput';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, MAX_ITEMS, addDays, agendaTime, apiErrorMessage, buildAtk, buildOther, buildRepair,
  buildRoomBooking, buildVehicleBooking, dayRange, formatWibRange, hasErrors, resourceErrors, slotLabel, stepErrors, todayWib,
} from './gaModel';
import './ga.css';

const TITLES = {
  atk: 'Permintaan ATK',
  facility_repair: 'Perbaikan fasilitas',
  room: 'Pinjam ruang',
  vehicle: 'Pinjam kendaraan',
  other: 'Permintaan lainnya',
};
const SUBMIT = {
  atk: 'Kirim permintaan', facility_repair: 'Laporkan kerusakan', room: 'Pesan ruang', vehicle: 'Ajukan peminjaman', other: 'Ajukan permintaan',
};
const emptyLine = () => ({ itemName: '', qty: '', unit: '' });

// What Prakasa AI may fill in the request forms (docs/prakasa-ai-rencana.md
// §9.8, §9.9, §9.11; the server's word on it: backend forms/ga.js). The ATK
// item lines are a `rows` field: the AI adds lines, the lines the user typed
// stay. The repair photo is an upload: the user picks it. A room booking
// (Wave C2) is filled the same way; vehicles are borrowed in TrackCar, so that
// kind is not registered.
const AI_KINDS = ['atk', 'facility_repair', 'other', 'room'];
const AI_IDS = { room: 'ga-booking-room' };
const AI_GA_REQUEST = defineAIForm({
  id: ({ kind }) => AI_IDS[kind] || `ga-request-${kind}`,
  title: ({ kind }) => TITLES[kind] || 'Permintaan GA',
  permission: 'ga.request.create',
  submitLabel: ({ kind }) => SUBMIT[kind] || 'Kirim',
  fields: ({ kind, locationOptions, resourceOptions }) => {
    if (kind === 'room') {
      return [
        f.select('resourceId', 'Ruang', resourceOptions, { required: true }),
        f.date('date', 'Tanggal', { required: true, hint: 'Hari ini atau sesudahnya.' }),
        f.time('start', 'Mulai', { required: true, hint: 'Kelipatan 15 menit.' }),
        f.time('end', 'Selesai', { required: true, hint: 'Kelipatan 15 menit, setelah jam mulai, paling lama 12 jam.' }),
        f.text('purpose', 'Keperluan', { required: true, maxLength: 255 }),
      ];
    }
    const location = f.select('locationId', 'Lokasi', locationOptions, { required: true });
    if (kind === 'atk') {
      return [
        location,
        f.rows('items', 'Daftar barang', [
          f.text('itemName', 'Nama barang', { required: true, maxLength: 120 }),
          f.number('qty', 'Jumlah', { required: true, min: 0.01, hint: 'Lebih dari 0.' }),
          f.text('unit', 'Satuan', { required: true, maxLength: 20, hint: 'rim, pcs, box' }),
        ], { required: true, maxRows: MAX_ITEMS, emptyRow: emptyLine }),
        f.textarea('note', 'Catatan', { maxLength: 2000 }),
      ];
    }
    if (kind === 'facility_repair') {
      return [
        location,
        f.text('area', 'Area atau objek', { required: true, maxLength: 120, hint: 'Contoh: AC ruang rapat lantai 2' }),
        f.textarea('description', 'Uraian kerusakan', { required: true, maxLength: 2000 }),
        f.checkbox('urgent', 'Mendesak (target 1 hari)'),
        f.userOnly('photo', 'Foto', 'text'),
      ];
    }
    if (kind === 'other') {
      return [
        location,
        f.text('title', 'Judul', { required: true, maxLength: 190 }),
        f.textarea('description', 'Uraian', { required: true, maxLength: 2000 }),
      ];
    }
    return [];
  },
});

// Next quarter hour from now in WIB, as the default start of a booking.
function nextSlot(now = Date.now()) {
  const step = 15 * 60e3;
  const at = new Date(Math.ceil((now + 60e3) / step) * step + 7 * 3600e3).toISOString();
  return { day: at.slice(0, 10), time: at.slice(11, 16) };
}
const plusHour = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? '23:45' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function initialValues(kind, { defaultLocationId, resourceId, day }) {
  const slot = nextSlot();
  const date = day && day > slot.day ? day : slot.day;
  const start = date === slot.day ? slot.time : '09:00';
  return {
    locationId: defaultLocationId ? String(defaultLocationId) : '',
    items: [emptyLine()],
    note: '',
    area: '',
    description: '',
    urgent: false,
    title: '',
    resourceId: resourceId ? String(resourceId) : '',
    date,
    start,
    end: plusHour(start),
    purpose: '',
    startDate: date,
    startTime: start,
    endDate: date,
    endTime: plusHour(start),
    destination: '',
    needsDriver: false,
  };
}

/**
 * The five short forms of Layanan GA (§3.5, Modal md, ≤ 5 fields each).
 * Bookings are clash-aware: the chosen resource's bookings around the chosen
 * time are loaded and a clash is shown on the field before sending (the server
 * checks again under a row lock and answers 409 with the clashing slot).
 */
export function GaCreateDialog({ kind, open, onClose, onCreated, locations = [], resources = [], defaultLocationId = null, resourceId = null, day = null }) {
  const formId = useId();
  const [values, setValues] = useState(() => initialValues(kind, { defaultLocationId, resourceId, day }));
  // The form as it opened: what Prakasa AI reads as "not typed by the user".
  const [opened, setOpened] = useState(values);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState({ rows: [], loading: false });
  const booking = kind === 'room' || kind === 'vehicle';

  useEffect(() => {
    if (!open) return;
    const fresh = initialValues(kind, { defaultLocationId, resourceId, day });
    setValues(fresh);
    setOpened(fresh);
    setErrors({}); setFormError(''); setPhoto(null);
  }, [open, kind, defaultLocationId, resourceId, day]);

  const kindResources = useMemo(() => resources.filter((r) => r.kind === kind && r.isActive !== false), [resources, kind]);
  const locationOptions = locations.filter((l) => l.isActive !== false).map((l) => ({ value: String(l.id), label: l.name }));
  const resourceOptions = kindResources.map((r) => ({
    value: String(r.id),
    // One string per <option>: the names stay as stored, the capacity is
    // translated here (i18n/tr.js). The Select below says `dataOptions`.
    label: [r.name, r.plateNumber, r.capacity ? tr(`${r.capacity} orang`) : null, r.locationName].filter(Boolean).join(' · '),
  }));

  // Bookings of the chosen resource around the chosen days (for the clash check).
  const rangeStart = kind === 'vehicle' ? values.startDate : values.date;
  const rangeEnd = kind === 'vehicle' ? (values.endDate || values.startDate) : values.date;
  useEffect(() => {
    if (!open || !booking || !values.resourceId || !rangeStart) { setBusy({ rows: [], loading: false }); return undefined; }
    let alive = true;
    const from = dayRange(rangeStart).from;
    const last = rangeEnd && rangeEnd >= rangeStart ? rangeEnd : rangeStart;
    const to = dayRange(last > addDays(rangeStart, 30) ? addDays(rangeStart, 30) : last).to;
    setBusy((b) => ({ ...b, loading: true }));
    api.get('/ga/bookings', { params: { resourceId: values.resourceId, from, to } })
      .then((r) => { if (alive) setBusy({ rows: r.data.data || [], loading: false }); })
      .catch(() => { if (alive) setBusy({ rows: [], loading: false }); });
    return () => { alive = false; };
  }, [open, booking, values.resourceId, rangeStart, rangeEnd]);

  const set = (field) => (event) => {
    const value = event?.target ? (event.target.type === 'checkbox' ? event.target.checked : event.target.value) : event;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, ...(['start', 'end', 'date', 'startDate', 'startTime', 'endDate', 'endTime', 'resourceId'].includes(field) ? { start: undefined, end: undefined } : {}) }));
  };
  const setLine = (index, field) => (event) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, items: current.items.map((line, i) => (i === index ? { ...line, [field]: value } : line)) }));
    setErrors((current) => ({ ...current, items: undefined }));
  };

  const built = () => {
    if (kind === 'atk') return buildAtk(values);
    if (kind === 'facility_repair') return buildRepair(values);
    if (kind === 'other') return buildOther(values);
    if (kind === 'room') return buildRoomBooking(values, { bookings: busy.rows });
    return buildVehicleBooking(values, { bookings: busy.rows });
  };
  const preview = booking ? built() : null;
  const liveClash = preview?.clash || null;

  // Prakasa AI may fill the three request forms and the room booking; the user
  // reviews and sends (AI_GA_REQUEST above). A room chosen from the schedule is
  // the user's choice (initial value ''), so the AI does not replace it; the
  // date and times the form proposes on opening may be replaced.
  const ai = usePrakasaAIForm(AI_GA_REQUEST, {
    enabled: open && AI_KINDS.includes(kind),
    values,
    setValues,
    setErrors,
    initialValues: {
      locationId: defaultLocationId ? String(defaultLocationId) : '', note: '', area: '', description: '', urgent: false, title: '',
      resourceId: '', date: opened.date, start: opened.start, end: opened.end, purpose: '',
    },
    context: { kind, locationOptions, resourceOptions },
    // The form's own rules (gaModel.js), for the fields of this kind.
    validate: (next) => {
      if (kind === 'room') return { ...buildRoomBooking(next, { bookings: busy.rows }).errors, ...stepErrors(next, ['start', 'end']) };
      if (kind === 'facility_repair') return buildRepair(next).errors;
      if (kind === 'other') return buildOther(next).errors;
      return buildAtk(next).errors;
    },
  });

  const submit = async (event) => {
    event.preventDefault();
    const { errors: found, body } = built();
    if (photo && (photo.size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_ACCEPT.split(',').includes(photo.type))) {
      found.photo = 'Foto atau PDF, paling besar 10 MB.';
    }
    setErrors(found);
    if (hasErrors(found)) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await api.post(booking ? '/ga/bookings' : '/ga/requests', body);
      const created = response.data.data;
      if (photo && created?.id) {
        const data = new FormData();
        data.append('file', photo);
        try { await api.post(`/ga/requests/${created.id}/attachments`, data); } catch (error) {
          toast(apiErrorMessage(error, 'Foto belum terlampir; lampirkan lagi dari halaman permintaan.'), 'error');
        }
      }
      const done = {
        atk: 'Permintaan ATK terkirim', facility_repair: 'Laporan kerusakan terkirim', other: 'Permintaan diajukan ke atasan',
        room: 'Ruang terkonfirmasi', vehicle: 'Peminjaman diajukan ke atasan',
      }[kind];
      toast(created?.warnings?.length ? `${done} · ${created.warnings[0].message}` : done, 'success');
      onCreated?.(created, booking ? 'booking' : 'request');
    } catch (error) {
      const message = apiErrorMessage(error, 'Belum terkirim. Periksa koneksi, lalu coba lagi.');
      if (error?.response?.data?.error?.code === 'BOOKING_CONFLICT') setErrors((e) => ({ ...e, end: message }));
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const noResources = booking && !kindResources.length;
  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={TITLES[kind] || 'Permintaan GA'}
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} disabled={noResources}>{SUBMIT[kind]}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        {noResources ? (
          <Banner tone="info">{kind === 'room' ? 'Belum ada ruang yang bisa dipinjam.' : 'Belum ada kendaraan yang bisa dipinjam.'} People & Culture menambahkannya di tab Sumber daya.</Banner>
        ) : null}

        {kind === 'atk' || kind === 'facility_repair' || kind === 'other' ? (
          <Select label="Lokasi *" value={values.locationId} {...ai.field('locationId')} onChange={set('locationId')} options={locationOptions} dataOptions placeholder="" error={errors.locationId} />
        ) : null}

        {kind === 'atk' ? (
          <div className="ga-lines" role="group" aria-label="Daftar barang">
            {values.items.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div className={ai.rowClass('items', index, 'ga-line')} key={index}>
                <Input label={index === 0 ? 'Nama barang *' : `Nama barang ${index + 1}`} value={line.itemName} {...ai.row('items', index)} onChange={setLine(index, 'itemName')} maxLength={120} fieldClassName="ga-line__name" />
                <Context name="quantity"><Input label="Jumlah" value={line.qty} onChange={setLine(index, 'qty')} inputMode="decimal" fieldClassName="ga-line__qty" /></Context>
                <Input label="Satuan" value={line.unit} onChange={setLine(index, 'unit')} maxLength={20} hint={index === 0 ? 'rim, pcs, box' : undefined} fieldClassName="ga-line__unit" />
                {values.items.length > 1 ? (
                  <IconButton size="sm" icon="close" label={`Hapus baris ${index + 1}`} onClick={() => setValues((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))} />
                ) : null}
              </div>
            ))}
            {errors.items ? <p className="ga-error" role="alert">{errors.items}</p> : null}
            <div>
              <Button variant="text" type="button" icon="add" disabled={values.items.length >= MAX_ITEMS} onClick={() => setValues((c) => ({ ...c, items: [...c.items, emptyLine()] }))}>Tambah baris</Button>
            </div>
          </div>
        ) : null}
        {kind === 'atk' ? <Textarea label="Catatan" value={values.note} {...ai.field('note')} onChange={set('note')} rows={2} maxLength={2000} /> : null}

        {kind === 'facility_repair' ? (
          <>
            <Input label="Area atau objek *" value={values.area} {...ai.field('area')} onChange={set('area')} maxLength={120} hint="Contoh: AC ruang rapat lantai 2" error={errors.area} />
            <Textarea label="Uraian kerusakan *" value={values.description} {...ai.field('description')} onChange={set('description')} rows={3} maxLength={2000} error={errors.description} />
            <Switch label="Mendesak (target 1 hari)" checked={values.urgent} {...ai.field('urgent')} onChange={set('urgent')} />
            <Input
              label="Foto"
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={(e) => { setPhoto(e.target.files?.[0] || null); setErrors((c) => ({ ...c, photo: undefined })); }}
              hint="Opsional. Foto atau PDF, paling besar 10 MB; disimpan di Shared Drive."
              error={errors.photo}
            />
          </>
        ) : null}

        {kind === 'other' ? (
          <>
            <Input label="Judul *" value={values.title} {...ai.field('title')} onChange={set('title')} maxLength={190} error={errors.title} />
            <Textarea label="Uraian *" value={values.description} {...ai.field('description')} onChange={set('description')} rows={3} maxLength={2000} error={errors.description} hint="Permintaan lainnya disetujui atasan dulu, lalu diproses People & Culture (target 5 hari)." />
          </>
        ) : null}

        {kind === 'room' ? (
          <>
            <Select label="Ruang *" value={values.resourceId} {...ai.field('resourceId')} onChange={set('resourceId')} options={resourceOptions} dataOptions placeholder="" error={errors.resourceId} />
            <DateInput label="Tanggal *" value={values.date} {...ai.field('date')} onChange={set('date')} min={todayWib()} error={errors.date} />
            <div className="pw-form-grid">
              <TimeInput label="Mulai *" value={values.start} {...ai.field('start')} onChange={set('start')} error={errors.start} />
              <TimeInput label="Selesai *" value={values.end} {...ai.field('end')} onChange={set('end')} error={errors.end} />
            </div>
            <Input label="Keperluan *" value={values.purpose} {...ai.field('purpose')} onChange={set('purpose')} maxLength={255} error={errors.purpose} />
          </>
        ) : null}

        {kind === 'vehicle' ? (
          <>
            <Select label="Kendaraan *" value={values.resourceId} onChange={set('resourceId')} options={resourceOptions} dataOptions placeholder="" error={errors.resourceId} />
            <div className="pw-form-grid">
              <DateInput label="Tanggal mulai *" value={values.startDate} onChange={set('startDate')} min={todayWib()} />
              <TimeInput label="Jam mulai *" value={values.startTime} onChange={set('startTime')} error={errors.start} />
            </div>
            <div className="pw-form-grid">
              <DateInput label="Tanggal selesai *" value={values.endDate} onChange={set('endDate')} min={values.startDate || todayWib()} />
              <TimeInput label="Jam selesai *" value={values.endTime} onChange={set('endTime')} error={errors.end} />
            </div>
            <Input label="Tujuan *" value={values.destination} onChange={set('destination')} maxLength={190} error={errors.destination} />
            <Switch label="Butuh sopir" checked={values.needsDriver} onChange={set('needsDriver')} />
          </>
        ) : null}

        {booking && values.resourceId ? (
          <BusySlots rows={busy.rows} loading={busy.loading} day={kind === 'vehicle' ? values.startDate : values.date} clash={liveClash} kind={kind} />
        ) : null}
      </form>
    </Modal>
  );
}

// The chosen resource's bookings that day, so a clash is visible before sending.
function BusySlots({ rows, loading, day, clash, kind }) {
  const active = (rows || [])
    .filter((b) => b.masked || ['pending_approval', 'confirmed', 'in_use'].includes(b.status))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (loading) return <p className="pw-text-helper">Memeriksa jadwal</p>;
  if (!active.length) return <p className="pw-text-helper">Jadwal kosong pada hari itu.</p>;
  return (
    <div className="ga-busy" aria-live="polite">
      <p className="pw-text-helper">{clash ? 'Waktu yang dipilih bentrok dengan jadwal ini:' : 'Sudah terpakai:'}</p>
      <ul className="ga-busy__list">
        {active.map((b, index) => {
          const label = slotLabel(b);
          const hit = clash && clash.startsAt === b.startsAt && clash.endsAt === b.endsAt;
          return (
            // eslint-disable-next-line react/no-array-index-key
            <li key={b.id || `m${index}`} className={hit ? 'ga-busy__item is-clash' : 'ga-busy__item'}>
              {kind === 'vehicle' ? formatWibRange(b.startsAt, b.endsAt) : agendaTime(b, day)} · <span data-no-translate={label.titleData ? '' : undefined}>{label.title}</span>{label.sub ? <>{' · '}<Mixed parts={label.subParts} /></> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const RESOURCE_EMPTY = { kind: 'room', name: '', locationId: '', capacity: '', plateNumber: '', notes: '' };

// Rooms as Prakasa AI may fill them (add and edit are two forms: an edit names
// its record). Vehicles live in TrackCar, so only a room is registered; turning
// a room off (Nonaktifkan) is a decision and is not a field here.
const resourceFields = ({ locationOptions }) => [
  f.text('name', 'Nama', { required: true, maxLength: 120, hint: 'Contoh: Ruang rapat lantai 2' }),
  f.select('locationId', 'Lokasi', locationOptions, { required: true }),
  f.number('capacity', 'Kapasitas (orang)', { min: 1, step: 1 }),
  f.text('notes', 'Catatan', { maxLength: 255 }),
];
const AI_RESOURCE = defineAIForm({
  id: 'ga-resource', title: 'Tambah ruang', permission: 'ga.resource.manage', submitLabel: 'Simpan', fields: resourceFields,
});
const AI_RESOURCE_EDIT = defineAIForm({
  id: 'ga-resource-edit', title: 'Ubah ruang', permission: 'ga.resource.manage', submitLabel: 'Simpan', mode: 'edit', fields: resourceFields,
});

/** Add / edit a room or vehicle (People & Culture Supervisor/Head). */
export function GaResourceDialog({ open, resource, kind = 'room', locations = [], onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(resource);
  const [values, setValues] = useState(RESOURCE_EMPTY);
  // The values the dialog opened with (the loaded room, or the empty form).
  const [opened, setOpened] = useState(RESOURCE_EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    const fresh = resource ? {
      kind: resource.kind, name: resource.name, locationId: String(resource.locationId), capacity: resource.capacity ?? '',
      plateNumber: resource.plateNumber || '', notes: resource.notes || '',
    } : { ...RESOURCE_EMPTY, kind, locationId: locations.length === 1 ? String(locations[0].id) : '' };
    setValues(fresh);
    setOpened(fresh);
    setErrors({}); setFormError('');
  }, [open, resource, kind, locations]);

  const locationOptions = locations.map((l) => ({ value: String(l.id), label: l.name }));
  const aiRoom = open && values.kind === 'room';
  const ai = usePrakasaAIForm(AI_RESOURCE, {
    enabled: aiRoom && !editing,
    values,
    setValues,
    setErrors,
    initialValues: opened,
    context: { locationOptions },
    validate: resourceErrors,
  });
  const aiEdit = usePrakasaAIForm(AI_RESOURCE_EDIT, {
    // Once the room's values are in the form.
    enabled: aiRoom && editing && opened.name === resource?.name,
    record: { type: 'ga_resource', id: resource?.id },
    values,
    setValues,
    setErrors,
    initialValues: opened,
    context: { locationOptions },
    validate: resourceErrors,
  });
  const mark = (name) => (editing ? aiEdit : ai).field(name);

  const set = (field) => (event) => {
    setValues((c) => ({ ...c, [field]: event.target.value }));
    setErrors((c) => ({ ...c, [field]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = resourceErrors(values);
    setErrors(found);
    if (hasErrors(found)) return;
    const body = {
      name: values.name.trim(),
      locationId: Number(values.locationId),
      notes: String(values.notes || '').trim() || null,
      ...(values.kind === 'room' ? { capacity: values.capacity === '' || values.capacity === null ? null : Number(values.capacity) } : { plateNumber: values.plateNumber.trim() }),
    };
    setSaving(true);
    setFormError('');
    try {
      const response = editing
        ? await api.patch(`/ga/resources/${resource.id}`, { ...body, version: resource.version })
        : await api.post('/ga/resources', { ...body, kind: values.kind });
      toast(editing ? 'Perubahan disimpan' : `${values.kind === 'room' ? 'Ruang' : 'Kendaraan'} ditambahkan`, 'success');
      onSaved?.(response.data.data);
    } catch (error) {
      setFormError(apiErrorMessage(error, 'Belum tersimpan. Coba lagi.'));
    } finally {
      setSaving(false);
    }
  };

  const vehicle = values.kind === 'vehicle';
  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={editing ? `Ubah ${vehicle ? 'kendaraan' : 'ruang'}` : `Tambah ${vehicle ? 'kendaraan' : 'ruang'}`}
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        {aiEdit.notice}
        <Input label="Nama *" value={values.name} {...mark('name')} onChange={set('name')} maxLength={120} error={errors.name} hint={vehicle ? 'Contoh: Avanza putih' : 'Contoh: Ruang rapat lantai 2'} />
        <Select label="Lokasi *" value={values.locationId} {...mark('locationId')} onChange={set('locationId')} placeholder="" options={locations.map((l) => ({ value: String(l.id), label: l.name, suffix: l.isActive === false ? '(nonaktif)' : undefined }))} dataOptions error={errors.locationId} />
        {vehicle
          ? <Input label="Nomor polisi *" value={values.plateNumber} onChange={set('plateNumber')} maxLength={20} error={errors.plateNumber} mono />
          : <Input label="Kapasitas (orang)" value={values.capacity} {...mark('capacity')} onChange={set('capacity')} inputMode="numeric" error={errors.capacity} />}
        <Input label="Catatan" value={values.notes} {...mark('notes')} onChange={set('notes')} maxLength={255} />
      </form>
    </Modal>
  );
}
