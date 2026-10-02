import { tr } from '../../i18n/tr.js';
import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Segmented from '../../components/Segmented';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  CONDITION_LABELS, DEVICE_TYPE_LABELS, WARRANTY_TYPE_LABELS, deviceBody, deviceFieldErrorFromApi, deviceFormErrors,
  deviceFormValues, deviceStatusLabel, deviceTitle, optionsFrom, personName, statusChangeBody, statusChangeErrors, statusTransitions,
} from './itModel';
import { entryLabel } from '../people/directoryModel';
import { locationOptions, useDirectoryEntries, useDirectorySearch, useLocations } from './useLookups';
import './it-assets.css';

const errorOf = (error) => error?.response?.data?.error || {};
const errorMessage = (error, fallback) => errorOf(error).message || fallback;
const TYPE_OPTIONS = Object.entries(DEVICE_TYPE_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'id'));

// Prakasa AI may fill a device's descriptive fields; the user reviews and
// presses the form's own button (docs/prakasa-ai-rencana.md §9.9). The
// purchase price (rupiah) and the identifiers of the unit (serial number,
// IMEI, MAC address) stay with the user and are never read to the model.
const deviceFields = ({ locations }) => [
  f.select('deviceType', 'Tipe', TYPE_OPTIONS, { required: true }),
  f.text('model', 'Merek / model', { maxLength: 150, hint: 'Satu isian, seperti di laporan. Contoh: Lenovo IdeaPad Slim 5.' }),
  f.userOnly('serialNumber', 'Nomor seri'),
  f.text('assetCode', 'No. aset', { maxLength: 80, hint: 'Opsional.' }),
  f.number('purchaseYear', 'Tahun beli', { min: 1990, max: 2100, step: 1 }),
  f.select('locationId', 'Lokasi', locations),
  f.number('ramGb', 'RAM (GB)', { min: 1, max: 4096, step: 1 }),
  f.number('storageGb', 'SSD (GB)', { min: 1, max: 1048576, step: 1 }),
  f.text('osVersion', 'OS', { maxLength: 80, hint: 'Contoh: Windows 11 Pro, macOS 14.' }),
  f.userOnly('imei', 'IMEI'),
  f.userOnly('macAddress', 'MAC address'),
  f.date('purchaseDate', 'Tanggal beli'),
  f.userOnly('purchasePrice', 'Harga beli', 'number'),
  f.text('supplier', 'Supplier'),
  f.select('conditionState', 'Kondisi', optionsFrom(CONDITION_LABELS)),
  f.date('warrantyStart', 'Garansi mulai'),
  f.date('warrantyEnd', 'Garansi selesai'),
  f.select('warrantyType', 'Jenis garansi', optionsFrom(WARRANTY_TYPE_LABELS)),
  f.textarea('notes', 'Catatan'),
];
const AI_DEVICE = defineAIForm({
  id: 'it-device',
  title: 'Tambah perangkat',
  permission: 'device.manage',
  submitLabel: 'Simpan perangkat',
  fields: deviceFields,
});
const AI_DEVICE_EDIT = defineAIForm({
  id: 'it-device-edit',
  title: 'Ubah perangkat',
  permission: 'device.manage',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: deviceFields,
});

// Create / edit a device (FullScreenDialog, docs/ui-guideline.md §3.3). New
// devices start as Cadangan; the status changes only through the status
// dialog. Asset-code warnings (a code shared by several devices) are not
// errors: they come back to the page through onSaved(result).
export function DeviceFormDialog({ open, device, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(device);
  const [values, setValues] = useState(() => deviceFormValues(device));
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const locations = useLocations(open);

  useEffect(() => {
    if (!open) return;
    setValues(deviceFormValues(device));
    setErrors({}); setDirty(false); setFormError('');
  }, [open, device]);

  const set = (field) => (event) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDirty(true);
  };

  const initialValues = useMemo(() => deviceFormValues(device), [device]);
  const aiBindings = {
    values,
    setValues,
    setErrors,
    onFill: () => setDirty(true),
    initialValues,
    context: { locations: locationOptions(locations.rows, device?.locationId) },
    validate: deviceFormErrors,
  };
  const aiCreate = usePrakasaAIForm(AI_DEVICE, {
    ...aiBindings,
    enabled: open && !editing,
    ready: locations.loaded,
  });
  const aiEdit = usePrakasaAIForm(AI_DEVICE_EDIT, {
    ...aiBindings,
    enabled: open && editing,
    ready: locations.loaded,
    record: { type: 'device', id: device?.id },
  });
  const ai = editing ? aiEdit : aiCreate;

  const submit = async (event) => {
    event.preventDefault();
    const found = deviceFormErrors(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = deviceBody(values, editing ? { values: deviceFormValues(device), brand: device.brand } : null);
    if (editing && !Object.keys(body).length) { onClose(); return; }
    setSaving(true);
    setFormError('');
    try {
      const response = editing ? await api.patch(`/it/devices/${device.id}`, body) : await api.post('/it/devices', body);
      toast(editing ? 'Perangkat diperbarui' : 'Perangkat ditambahkan', 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      const fieldErrors = deviceFieldErrorFromApi(error);
      if (fieldErrors) setErrors((current) => ({ ...current, ...fieldErrors }));
      else setFormError(errorMessage(error, 'Perangkat gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  const field = (name) => ({ value: values[name], ...ai.field(name), onChange: set(name), error: errors[name] });

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Ubah ${deviceTitle(device)}` : 'Tambah perangkat'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan perangkat'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <FullScreenSection title="Informasi perangkat">
          <div className="pw-fsdialog__fields">
            <Select label="Tipe" required placeholder="Pilih tipe" options={TYPE_OPTIONS} {...field('deviceType')} />
            <Input label="Merek / model" {...field('model')} hint="Satu isian, seperti di laporan. Contoh: Lenovo IdeaPad Slim 5." />
            <Input label="Nomor seri" mono {...field('serialNumber')} hint="Unik per perusahaan; disimpan dengan huruf besar." />
            <Input label="No. aset" mono {...field('assetCode')} hint="Opsional. Boleh sama dengan perangkat lain (akan diberi peringatan)." />
            <Input label="Tahun beli" type="number" inputMode="numeric" {...field('purchaseYear')} />
            <Select
              label="Lokasi"
              placeholder="Tanpa lokasi"
              options={locationOptions(locations.rows, device?.locationId)}
              dataOptions
              {...field('locationId')}
              hint={locations.error || undefined}
            />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Spesifikasi">
          <div className="pw-fsdialog__fields">
            <Input label="RAM (GB)" type="number" inputMode="numeric" {...field('ramGb')} />
            <Input label="SSD (GB)" type="number" inputMode="numeric" {...field('storageGb')} />
            <Input label="OS" {...field('osVersion')} hint="Contoh: Windows 11 Pro, macOS 14." />
            <Input label="IMEI" mono {...field('imei')} />
            <Input label="MAC address" mono {...field('macAddress')} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Pembelian dan garansi">
          <div className="pw-fsdialog__fields">
            <DateInput label="Tanggal beli" {...field('purchaseDate')} />
            <Input label="Harga beli" type="number" inputMode="numeric" {...field('purchasePrice')} hint="Dalam rupiah." />
            <Input label="Supplier" {...field('supplier')} />
            <Select label="Kondisi" options={optionsFrom(CONDITION_LABELS)} {...field('conditionState')} />
            <DateInput label="Garansi mulai" {...field('warrantyStart')} />
            <DateInput label="Garansi selesai" {...field('warrantyEnd')} />
            <Select label="Jenis garansi" options={optionsFrom(WARRANTY_TYPE_LABELS)} {...field('warrantyType')} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Catatan">
          <Textarea label="Catatan" rows={3} {...field('notes')} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

const HOLDER_MODES = [
  { value: 'entry', label: 'Orang di direktori' },
  { value: 'label', label: 'Label tim' },
];
// The new status is the user's decision; Prakasa AI may fill who receives the
// device (found in the directory list the picker shows) and the note.
const AI_DEVICE_STATUS = defineAIForm({
  id: 'it-device-status',
  title: ({ handover }) => (handover ? 'Serahkan perangkat' : 'Ubah status perangkat'),
  permission: 'device.manage',
  submitLabel: ({ assigned }) => (assigned ? 'Serahkan perangkat' : 'Ubah status'),
  mode: 'edit',
  fields: ({ status, assigned, holderMode, noteLabel, needsReason, searchPeople, nameOf }) => [
    f.userOnly('status', 'Status baru', 'select'),
    ...(assigned ? [f.radio('holderMode', 'Jenis pemegang', HOLDER_MODES)] : []),
    ...(assigned && holderMode === 'entry' ? [f.person('entryKey', 'Pemegang', searchPeople, { required: true, labelOf: nameOf })] : []),
    ...(assigned && holderMode === 'label' ? [f.text('label', 'Label tim', { required: true, maxLength: 120, hint: 'Contoh: Ops Team, Semua karyawan.' })] : []),
    ...(status ? [f.textarea('note', noteLabel, { required: needsReason, maxLength: 500 })] : []),
  ],
});
const AI_DEVICE_RETURN = defineAIForm({
  id: 'it-device-return',
  title: 'Kembalikan perangkat',
  permission: 'device.assign',
  submitLabel: 'Kembalikan perangkat',
  mode: 'edit',
  fields: [
    f.select('condition', 'Kondisi saat kembali', optionsFrom(CONDITION_LABELS), { hint: 'Kurang atau Rusak → status Rusak; lainnya → Cadangan.' }),
    f.textarea('notes', 'Catatan'),
  ],
});

// Change a device's status (rule 14): Aktif / Cadangan / Rusak / Tidak aktif,
// plus Perawatan / Perbaikan / Hilang / Dibuang. Aktif needs exactly one
// holder (a directory person — their account when they have one — or a team
// label); Rusak, Tidak aktif, Hilang and Dibuang need a reason.
export function DeviceStatusDialog({ open, device, initialStatus = '', onClose, onChanged }) {
  const formId = useId();
  const [status, setStatus] = useState('');
  const [holderMode, setHolderMode] = useState('entry');
  const [entryKey, setEntryKey] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const directory = useDirectoryEntries(open && status === 'assigned');

  useEffect(() => {
    if (!open) return;
    setStatus(initialStatus); setHolderMode('entry'); setEntryKey(''); setLabel(''); setNote(''); setErrors({}); setFormError('');
  }, [open, initialStatus]);

  const transitions = statusTransitions(device?.status);
  const chosen = transitions.find((t) => t.status === status);
  const entry = directory.rows.find((e) => e.key === entryKey) || null;
  const noteLabel = status === 'assigned' ? 'Keperluan' : (chosen?.needsReason ? 'Alasan' : 'Catatan');
  const searchPeople = useDirectorySearch(directory);
  const ai = usePrakasaAIForm(AI_DEVICE_STATUS, {
    enabled: open && Boolean(device),
    record: { type: 'device', id: device?.id },
    values: { status, holderMode, entryKey, label, note },
    setters: { holderMode: setHolderMode, entryKey: setEntryKey, label: setLabel, note: setNote },
    setErrors,
    initialValues: { status: initialStatus, holderMode: 'entry', entryKey: '', label: '', note: '' },
    context: {
      status, assigned: status === 'assigned', handover: status === 'assigned' && initialStatus === 'assigned', holderMode, noteLabel,
      needsReason: Boolean(chosen?.needsReason), searchPeople, nameOf: (key) => personName(directory.rows, key),
    },
    validate: (next) => {
      const found = statusChangeErrors({ ...next, entry: directory.rows.find((e) => e.key === next.entryKey) || null });
      return found.entry ? { ...found, entry: undefined, entryKey: found.entry } : found;
    },
  });
  if (!device) return null;

  const submit = async (event) => {
    event.preventDefault();
    const input = { status, note, holderMode, entry, label };
    const found = statusChangeErrors(input);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await api.patch(`/it/devices/${device.id}/status`, statusChangeBody(input));
      const out = response.data.data || {};
      toast(`Status perangkat: ${out.statusLabel || deviceStatusLabel(status)}`, 'success');
      await onChanged?.(out);
    } catch (error) {
      const { code, message } = errorOf(error);
      if (['HOLDER_REQUIRED', 'HOLDER_AMBIGUOUS', 'HOLDER_NOT_FOUND', 'HOLDER_RESIGNED'].includes(code)) {
        setErrors({ [holderMode === 'label' ? 'label' : 'entry']: message });
      } else if (code === 'HOLDER_LABEL_TOO_LONG') setErrors({ label: message });
      else setFormError(message || 'Status gagal diubah.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={status === 'assigned' && initialStatus === 'assigned' ? 'Serahkan perangkat' : 'Ubah status perangkat'}
      size="md"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} variant={status === 'disposed' ? 'danger' : 'primary'} disabled={!status}>
            {status === 'assigned' ? 'Serahkan perangkat' : 'Ubah status'}
          </Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <p className="it-status__device">{`${deviceTitle(device)} · status sekarang ${deviceStatusLabel(device.status)}`}</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Select
          label="Status baru"
          required
          placeholder="Pilih status"
          value={status}
          error={errors.status}
          onChange={(event) => { setStatus(event.target.value); setErrors({}); }}
          // "Aktif — <why it is blocked>": two interface texts in one <option>,
          // translated here (i18n/tr.js) because an option holds one string.
          options={transitions.map((t) => (t.blocked
            ? { value: t.status, label: `${tr(t.label)} — ${tr(t.blocked)}`, data: true, disabled: true }
            : { value: t.status, label: t.label }))}
        />
        {status === 'disposed' ? <Banner tone="warning">Dibuang bersifat final: status perangkat ini tidak bisa diubah lagi.</Banner> : null}
        {device.status === 'assigned' && status && status !== 'assigned' ? (
          <Banner tone="info">{`Penugasan ke ${device.holder?.name || 'pemegangnya'} ditutup (dikembalikan hari ini).`}</Banner>
        ) : null}
        {status === 'assigned' ? (
          <>
            <Segmented label="Jenis pemegang" options={HOLDER_MODES} value={holderMode} {...ai.field('holderMode')} onChange={(value) => { setHolderMode(value); setErrors({}); }} />
            {holderMode === 'entry' ? (
              <Select
                label="Pemegang"
                required
                placeholder={directory.loading ? 'Memuat direktori' : 'Pilih orang'}
                disabled={directory.loading}
                value={entryKey}
                error={errors.entry || directory.error || undefined}
                hint="Orang yang punya akun menerima notifikasi."
                {...ai.field('entryKey')}
                onChange={(event) => { setEntryKey(event.target.value); setErrors({}); }}
                options={directory.rows.map((e) => ({ value: e.key, label: entryLabel(e) }))}
                dataOptions
              />
            ) : (
              <Input
                label="Label tim"
                required
                value={label}
                maxLength={120}
                error={errors.label}
                hint="Contoh: Ops Team, Semua karyawan."
                {...ai.field('label')}
                onChange={(event) => { setLabel(event.target.value); setErrors({}); }}
              />
            )}
          </>
        ) : null}
        {status ? (
          <Textarea
            label={noteLabel}
            required={Boolean(chosen?.needsReason)}
            rows={2}
            maxLength={500}
            value={note}
            error={errors.note}
            {...ai.field('note')}
            onChange={(event) => { setNote(event.target.value); setErrors((current) => ({ ...current, note: undefined })); }}
          />
        ) : null}
      </form>
    </Modal>
  );
}

// Return a device from its holder (PATCH /it/assignments/:id/return).
// Returned Kurang/Rusak → Rusak, otherwise Cadangan. Without an assignment
// given, the active one is read from the device detail.
export function DeviceReturnDialog({ open, device, assignment, onClose, onReturned }) {
  const formId = useId();
  const [target, setTarget] = useState(null);
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open || !device) return undefined;
    setCondition('good'); setNotes(''); setFormError('');
    if (assignment) { setTarget(assignment); return undefined; }
    let active = true;
    setTarget(null);
    api.get(`/it/devices/${device.id}`)
      .then((r) => {
        if (!active) return;
        const found = (r.data.data?.assignments || []).find((a) => a.status === 'active');
        if (found) setTarget(found); else setFormError('Perangkat ini tidak sedang dipegang siapa pun.');
      })
      .catch((error) => { if (active) setFormError(errorMessage(error, 'Data perangkat gagal dimuat.')); });
    return () => { active = false; };
  }, [open, device, assignment]);

  const ai = usePrakasaAIForm(AI_DEVICE_RETURN, {
    enabled: open && Boolean(device) && Boolean(target),
    record: { type: 'device_assignment', id: target?.id },
    values: { condition, notes },
    setters: { condition: setCondition, notes: setNotes },
    initialValues: { condition: 'good', notes: '' },
  });
  if (!device) return null;
  const submit = async (event) => {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await api.patch(`/it/assignments/${target.id}/return`, { conditionOnReturn: condition, notes: notes.trim() || null });
      const newStatus = response.data.data?.newStatus;
      toast(newStatus ? `Perangkat dikembalikan · ${deviceStatusLabel(newStatus)}` : 'Perangkat dikembalikan', 'success');
      await onReturned?.(response.data.data || {});
    } catch (error) {
      setFormError(errorMessage(error, 'Perangkat gagal dikembalikan.'));
    } finally {
      setSaving(false);
    }
  };
  const holder = target?.holderName || target?.assignedToName || device.holder?.name || 'pemegangnya';
  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Kembalikan perangkat"
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} disabled={!target}>Kembalikan perangkat</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <p className="it-status__device">{`${deviceTitle(device)} dikembalikan oleh ${holder}.`}</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Select
          label="Kondisi saat kembali"
          value={condition}
          {...ai.field('condition')}
          onChange={(event) => setCondition(event.target.value)}
          options={optionsFrom(CONDITION_LABELS)}
          hint="Kurang atau Rusak → status Rusak; lainnya → Cadangan."
        />
        <Textarea label="Catatan" rows={2} value={notes} {...ai.field('notes')} onChange={(event) => setNotes(event.target.value)} />
      </form>
    </Modal>
  );
}
