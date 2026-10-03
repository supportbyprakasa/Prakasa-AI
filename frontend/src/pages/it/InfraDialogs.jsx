import { Context } from '../../i18n/NoTranslate';
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
import Switch from '../../components/Switch';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { entryLabel } from '../people/directoryModel';
import {
  CCTV_STATUS_LABELS, ENDPOINTS, GWS_FIELDS, NETWORK_TYPE_LABELS, RECORD_LABELS, backupCheckBody, backupCheckErrors,
  cctvStatusBody, cctvStatusErrors, fieldErrorFromApi, formBody, formErrors, formFields, formValues, gwsBody, gwsErrors,
  holderBody, holderErrors, optionsFrom, phoneText, rowTitle, usesFullScreen, ADD_LABELS, AI_EDIT_TITLES, AI_RECORD_TYPES, aiRegisterFields } from './infraModel';
import { personName } from './itModel';
import { locationOptions, useDirectoryEntries, useDirectorySearch, useLocations } from './useLookups';
import './it-infra.css';

const errorOf = (error) => error?.response?.data?.error || {};
const errorMessage = (error, fallback) => errorOf(error).message || fallback;
const todayWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const conflictText = 'Data ini sudah diubah orang lain. Tutup, muat ulang, lalu ulangi perubahan Anda.';

// Prakasa AI may fill the register forms; the user reviews and presses the
// form's own button (docs/prakasa-ai-rencana.md §9.9). The field policy, the
// same as the server's catalog (backend forms/it.js; a test keeps them equal):
//   ai        descriptive fields the AI may fill
//   userOnly  listed to the AI, never filled by it, and their value is never
//             read to the model: IP address, serial number, ISP customer
//             number, vendor portal address, phone numbers, rupiah, status
const AI_POLICY = {
  network: {
    ai: ['deviceType', 'brandModel', 'locationId', 'installedYear', 'ispLinkId', 'firmwareUpdatedOn', 'notes'],
    userOnly: ['serialNumber', 'ipAddress', 'status'],
  },
  isp: {
    ai: ['providerName', 'locationId', 'vendorId', 'bandwidthMbps', 'isBackup', 'publicIpDedicated', 'contractStart', 'contractEnd', 'notes'],
    userOnly: ['customerNumber', 'monthlyCost', 'status'],
  },
  cctv: {
    ai: ['locationId', 'cameraCount', 'cameraModel', 'recorderType', 'recorderDeviceId', 'remoteAccess', 'sameNetworkAsPc', 'notes'],
    userOnly: ['serialNumber'],
  },
  backup: {
    ai: ['dataScope', 'method', 'frequency', 'storageLocation', 'locationId', 'retention', 'notes'],
    userOnly: ['status'],
  },
  phone: {
    ai: ['kind', 'extension', 'locationId', 'provider', 'planName', 'startedOn', 'deviceId', 'notes'],
    userOnly: ['number', 'monthlyCost', 'status'],
  },
  vendor: {
    ai: ['name', 'vendorKind', 'contactPerson', 'email', 'notes'],
    userOnly: ['phone', 'portalUrl'],
  },
};
// The vendor register is saved under either permission (any of); the others need it.infra.manage.
const aiRegisterPermission = ({ kind } = {}) => (kind === 'vendor' ? ['it.infra.manage', 'software_vendor.manage'] : 'it.infra.manage');
const AI_REGISTER = defineAIForm({
  id: ({ kind }) => `it-infra-${kind}`,
  title: ({ kind }) => ADD_LABELS[kind] || 'Register infrastruktur',
  permission: aiRegisterPermission,
  submitLabel: 'Simpan',
  fields: ({ kind, locations, refs }) => aiRegisterFields(kind, false, AI_POLICY[kind], { locations, refs }),
});
const AI_REGISTER_EDIT = defineAIForm({
  id: ({ kind }) => `it-infra-${kind}-edit`,
  title: ({ kind }) => AI_EDIT_TITLES[kind] || 'Ubah register infrastruktur',
  permission: aiRegisterPermission,
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: ({ kind, locations, refs }) => aiRegisterFields(kind, true, AI_POLICY[kind], { locations, refs }),
});
const BACKUP_RESULTS = [{ value: 'ok', label: 'Berhasil' }, { value: 'failed', label: 'Gagal' }];
const AI_CCTV_STATUS = defineAIForm({
  id: 'it-cctv-status',
  title: 'Ubah status CCTV',
  permission: 'it.infra.manage',
  submitLabel: 'Ubah status',
  mode: 'edit',
  fields: ({ partial, max }) => [
    f.userOnly('status', 'Status', 'select'),
    ...(partial ? [f.number('camerasOffline', 'Kamera offline', { required: true, min: 1, max, step: 1 })] : []),
    f.textarea('note', 'Catatan', { maxLength: 255, hint: 'Jangan menulis kata sandi.' }),
  ],
});
const AI_BACKUP_CHECK = defineAIForm({
  id: 'it-backup-check',
  title: 'Catat pemeriksaan backup',
  permission: 'it.infra.manage',
  submitLabel: 'Simpan pemeriksaan',
  fields: [
    f.date('checkedOn', 'Tanggal pemeriksaan', { required: true, hint: 'Tidak boleh di masa depan.' }),
    f.select('result', 'Hasil', BACKUP_RESULTS, { required: true }),
    f.checkbox('restoreTested', 'Uji restore dilakukan'),
    f.textarea('note', 'Catatan', { maxLength: 255, hint: 'Jangan menulis kata sandi.' }),
  ],
});
const AI_GWS_REVIEW = defineAIForm({
  id: 'it-gws-review',
  title: 'Catat review Google Workspace',
  permission: 'it.infra.manage',
  submitLabel: 'Simpan review',
  fields: [
    ...GWS_FIELDS.map((field) => {
      if (field.type === 'switch') return f.checkbox(field.name, field.label);
      if (field.type === 'date') return f.date(field.name, field.label, { required: true, hint: 'Tidak boleh di masa depan.' });
      return f.number(field.name, field.label, { required: true, min: 0, max: 65535, step: 1 });
    }),
    f.textarea('notes', 'Catatan', { maxLength: 500, hint: 'Jangan menulis kata sandi, nama atau email akun admin.' }),
  ],
});

// Options for the `ref` fields of a register form, fetched only while the
// form is open: ISP links (network), ISP vendors (ISP), NVR/DVR network
// devices (CCTV), phones from Perangkat (phone lines, when allowed).
// `ready`: the lookups of this opening have answered (Prakasa AI reads the
// form only then, so it sees the same choices as the user).
function useRefOptions(kind, open, canDevices) {
  const [options, setOptions] = useState({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!open) return undefined;
    let active = true;
    const load = async () => {
      const out = {};
      try {
        if (kind === 'network') {
          const r = await api.get(ENDPOINTS.isp);
          out.isp = (r.data.data || []).map((l) => ({ value: String(l.id), label: `${l.providerName}${l.locationName ? ` · ${l.locationName}` : ''}`, suffix: l.isBackup ? '(cadangan)' : undefined }));
        }
        if (kind === 'isp') {
          const r = await api.get(ENDPOINTS.vendor);
          out.ispVendor = (r.data.data || []).filter((v) => v.vendorKind === 'isp').map((v) => ({ value: String(v.id), label: v.name }));
        }
        if (kind === 'cctv') {
          const r = await api.get(ENDPOINTS.network);
          out.recorder = (r.data.data || []).filter((d) => ['nvr', 'dvr'].includes(d.deviceType))
            .map((d) => ({ value: String(d.id), data: true, label: `${tr(NETWORK_TYPE_LABELS[d.deviceType])} · ${d.brandModel}${d.locationName ? ` · ${d.locationName}` : ''}` }));
        }
        if (kind === 'phone' && canDevices) {
          const r = await api.get('/it/devices', { params: { deviceType: 'smartphone,telephone', limit: 500 } });
          out.device = (r.data.data || []).map((d) => ({ value: String(d.id), data: true, label: [tr(d.deviceTypeLabel), [d.brand, d.model].filter(Boolean).join(' '), d.assetCode].filter(Boolean).join(' · ') }));
        }
      } catch { /* the select stays empty; the field is optional */ }
      if (active) { setOptions(out); setReady(true); }
    };
    load();
    return () => { active = false; };
  }, [kind, open, canDevices]);
  return [options, ready];
}

function FieldControl({ field, value: rawValue, error, onChange, locations, refOptions, currentLocationId, aiFilled = false }) {
  // Always controlled: the first render after opening may not have the values yet.
  const value = rawValue ?? (field.type === 'switch' ? false : '');
  const common = { label: field.label, required: field.required, error, hint: field.hint, aiFilled };
  if (field.type === 'switch') {
    return <Switch label={field.label} checked={Boolean(value)} aiFilled={aiFilled} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (field.type === 'textarea') {
    return <Textarea {...common} rows={3} value={value} maxLength={field.max} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'date') return <DateInput {...common} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'select') {
    return <Select {...common} value={value} options={field.options} placeholder={field.required ? 'Pilih' : undefined} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'location') {
    return (
      <Select
        {...common}
        value={value}
        placeholder={field.required ? 'Pilih lokasi' : 'Tanpa lokasi'}
        options={locationOptions(locations.rows, currentLocationId)}
        dataOptions
        hint={locations.error || field.hint}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'ref') {
    return <Select {...common} value={value} placeholder="Tidak ada" options={refOptions[field.ref] || []} dataOptions onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Input
      {...common}
      type={field.type === 'number' ? 'number' : 'text'}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      mono={field.mono}
      maxLength={field.type === 'number' ? undefined : field.max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Add / edit one register row. More than 5 fields → FullScreenDialog, else
// Modal (§3.3). Edits send only what changed, with the row's version.
export function RegisterFormDialog({ open, kind, row, onClose, onSaved, canDevices = false }) {
  const formId = useId();
  const editing = Boolean(row);
  const [values, setValues] = useState(() => formValues(kind, row));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const locations = useLocations(open);
  const [refOptions, refsReady] = useRefOptions(kind, open, canDevices);

  useEffect(() => {
    if (!open) return;
    setValues(formValues(kind, row)); setErrors({}); setFormError(''); setDirty(false);
  }, [open, kind, row]);

  // Prakasa AI: one registration for "Tambah", one for "Ubah" (the record it
  // changes is named for the audit). The options are the ones the selects show.
  const aiContext = { kind, locations: locationOptions(locations.rows, row?.locationId), refs: refOptions };
  const initialValues = useMemo(() => formValues(kind, row), [kind, row]);
  const aiCreate = usePrakasaAIForm(AI_REGISTER, {
    enabled: open && Boolean(kind) && !editing,
    ready: locations.loaded && refsReady,
    values,
    setValues,
    setErrors,
    onFill: () => setDirty(true),
    initialValues,
    context: aiContext,
    validate: (next) => formErrors(kind, next, false),
  });
  const aiEdit = usePrakasaAIForm(AI_REGISTER_EDIT, {
    enabled: open && Boolean(kind) && editing,
    ready: locations.loaded && refsReady,
    record: { type: AI_RECORD_TYPES[kind], id: row?.id },
    values,
    setValues,
    setErrors,
    onFill: () => setDirty(true),
    initialValues,
    context: aiContext,
    validate: (next) => formErrors(kind, next, true),
  });
  const ai = editing ? aiEdit : aiCreate;

  if (!kind) return null;
  const fields = formFields(kind, editing);
  const set = (name) => (value) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setDirty(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = formErrors(kind, values, editing);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = formBody(kind, values, row);
    if (editing && !Object.keys(body).filter((k) => k !== 'version').length) { onClose(); return; }
    const url = kind === 'vendor' ? '/it/vendors' : ENDPOINTS[kind];
    setSaving(true); setFormError('');
    try {
      const response = editing ? await api.patch(`${url}/${row.id}`, body) : await api.post(url, body);
      toast(editing ? `${RECORD_LABELS[kind]} diperbarui` : `${RECORD_LABELS[kind]} ditambahkan`, 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      const { code } = errorOf(error);
      const fieldErrors = fieldErrorFromApi(error);
      if (code === 'VERSION_CONFLICT') setFormError(conflictText);
      else if (fieldErrors) setErrors((current) => ({ ...current, ...fieldErrors }));
      else setFormError(errorMessage(error, `${RECORD_LABELS[kind]} gagal disimpan.`));
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? `Ubah ${rowTitle(kind, row) || RECORD_LABELS[kind]}` : (ADD_LABELS[kind] || `Tambah ${RECORD_LABELS[kind]}`);
  const actions = (
    <>
      <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
      <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan'}</Button>
    </>
  );
  const controls = fields.map((field) => (
    <FieldControl
      key={field.name}
      field={field}
      value={values[field.name]}
      error={errors[field.name]}
      onChange={set(field.name)}
      locations={locations}
      refOptions={refOptions}
      currentLocationId={row?.locationId}
      aiFilled={ai.isFilled(field.name)}
    />
  ));

  if (usesFullScreen(kind, editing)) {
    const notes = controls.filter((c) => c.key === 'notes');
    const rest = controls.filter((c) => c.key !== 'notes');
    return (
      <FullScreenDialog open={open} onClose={onClose} dirty={dirty} title={title} card={false} actions={actions}>
        <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
          {formError ? <Banner tone="error">{formError}</Banner> : null}
          {ai.notice}
          {kind === 'phone' ? <Banner tone="info">Hanya nomor milik perusahaan. Jangan mencatat nomor pribadi, PIN, PUK, atau nomor SIM (ICCID).</Banner> : null}
          <FullScreenSection title={RECORD_LABELS[kind]}>
            <div className="pw-fsdialog__fields">{rest}</div>
          </FullScreenSection>
          {notes.length ? <FullScreenSection title="Catatan">{notes}</FullScreenSection> : null}
        </form>
      </FullScreenDialog>
    );
  }
  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={title} size="md" footer={actions}>
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        {controls}
      </form>
    </Modal>
  );
}

// CCTV "Ubah status" (Modal sm): status, cameras offline (Sebagian offline), note.
export function CctvStatusDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState({ status: '', camerasOffline: '', note: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !row) return;
    setValues({ status: row.status, camerasOffline: row.status === 'partial' ? String(row.camerasOffline || '') : '', note: '' });
    setErrors({}); setFormError('');
  }, [open, row]);
  // Prakasa AI: the note and the number of cameras offline; the status itself
  // is the user's choice.
  const ai = usePrakasaAIForm(AI_CCTV_STATUS, {
    enabled: open && Boolean(row),
    record: { type: 'it_cctv', id: row?.id },
    values,
    setValues,
    setErrors,
    initialValues: { status: row?.status, camerasOffline: row?.status === 'partial' ? String(row?.camerasOffline || '') : '', note: '' },
    context: { partial: values.status === 'partial', max: Math.max((row?.cameraCount || 0) - 1, 1) },
    validate: (next) => cctvStatusErrors(next, row),
  });
  if (!row) return null;

  const submit = async (event) => {
    event.preventDefault();
    const found = cctvStatusErrors(values, row);
    if (String(values.note || '').length > 255) found.note = 'Catatan maksimal 255 karakter.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const response = await api.post(`${ENDPOINTS.cctv}/${row.id}/status`, cctvStatusBody(values, row));
      toast(`Status CCTV: ${CCTV_STATUS_LABELS[values.status]}`, 'success');
      await onSaved?.(response.data.data);
    } catch (error) {
      const { code } = errorOf(error);
      const fieldErrors = fieldErrorFromApi(error);
      if (code === 'VERSION_CONFLICT') setFormError(conflictText);
      else if (fieldErrors) setErrors(fieldErrors);
      else setFormError(errorMessage(error, 'Status gagal diubah.'));
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Ubah status CCTV"
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Ubah status</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <p className="it-infra__subject">{`${rowTitle('cctv', row)} · ${row.cameraCount} kamera`}</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Select label="Status" required value={values.status} error={errors.status} options={optionsFrom(CCTV_STATUS_LABELS)} onChange={(e) => { setValues({ ...values, status: e.target.value }); setErrors({}); }} />
        {values.status === 'partial' ? (
          <Input label="Kamera offline" required type="number" inputMode="numeric" value={values.camerasOffline} error={errors.camerasOffline} {...ai.field('camerasOffline')} onChange={(e) => { setValues({ ...values, camerasOffline: e.target.value }); setErrors({}); }} />
        ) : null}
        <Textarea label="Catatan" rows={2} maxLength={255} value={values.note} error={errors.note} hint="Jangan menulis kata sandi." {...ai.field('note')} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      </form>
    </Modal>
  );
}

// Backup "Catat pemeriksaan" (Modal sm): date, result, restore tested, note.
export function BackupCheckDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState({ checkedOn: '', result: 'ok', restoreTested: false, note: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues({ checkedOn: todayWib(), result: 'ok', restoreTested: false, note: '' }); setErrors({}); setFormError('');
  }, [open]);
  const ai = usePrakasaAIForm(AI_BACKUP_CHECK, {
    enabled: open && Boolean(row),
    values,
    setValues,
    setErrors,
    initialValues: { checkedOn: todayWib(), result: 'ok', restoreTested: false, note: '' },
    validate: (next) => backupCheckErrors(next, todayWib()),
  });
  if (!row) return null;

  const submit = async (event) => {
    event.preventDefault();
    const found = backupCheckErrors(values, todayWib());
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const response = await api.post(`${ENDPOINTS.backup}/${row.id}/checks`, backupCheckBody(values));
      toast('Pemeriksaan backup dicatat', 'success');
      await onSaved?.(response.data.data);
    } catch (error) {
      const fieldErrors = fieldErrorFromApi(error);
      if (fieldErrors) setErrors(fieldErrors);
      else setFormError(errorMessage(error, 'Pemeriksaan gagal dicatat.'));
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Catat pemeriksaan backup"
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan pemeriksaan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <p className="it-infra__subject">{row.dataScope}</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <DateInput label="Tanggal pemeriksaan" required value={values.checkedOn} error={errors.checkedOn} max={todayWib()} {...ai.field('checkedOn')} onChange={(e) => setValues({ ...values, checkedOn: e.target.value })} />
        <Select label="Hasil" required value={values.result} error={errors.result} options={BACKUP_RESULTS} {...ai.field('result')} onChange={(e) => setValues({ ...values, result: e.target.value })} />
        <Switch label="Uji restore dilakukan" checked={values.restoreTested} {...ai.field('restoreTested')} onChange={(e) => setValues({ ...values, restoreTested: e.target.checked })} />
        <Textarea label="Catatan" rows={2} maxLength={255} value={values.note} error={errors.note} hint="Jangan menulis kata sandi." {...ai.field('note')} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      </form>
    </Modal>
  );
}

const HOLDER_MODES = [
  { value: 'entry', label: 'Orang' },
  { value: 'label', label: 'Tim' },
  { value: 'none', label: 'Tanpa pemegang' },
];
// The person is found in the directory list the picker shows (useDirectorySearch).
const AI_PHONE_HOLDER = defineAIForm({
  id: 'it-phone-holder',
  title: 'Ganti pemegang',
  permission: 'it.infra.manage',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: ({ mode, searchPeople, nameOf }) => [
    f.radio('mode', 'Pemegang', HOLDER_MODES, { hint: 'Orang: lalu isi "Orang di direktori". Tim: lalu isi "Nama tim". Kolom berikutnya muncul setelah pilihan ini dibaca lagi.' }),
    ...(mode === 'entry' ? [f.person('entryKey', 'Orang di direktori', searchPeople, { required: true, labelOf: nameOf })] : []),
    ...(mode === 'label' ? [f.text('label', 'Nama tim', { required: true, maxLength: 120, hint: 'Contoh: Tim Sales, Resepsionis.' })] : []),
  ],
});

// Phone "Ganti pemegang" (Modal sm): a directory person, a team label, or
// nobody (the line becomes Cadangan).
export function PhoneHolderDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const [mode, setMode] = useState('entry');
  const [entryKey, setEntryKey] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const directory = useDirectoryEntries(open && mode === 'entry');
  useEffect(() => {
    if (!open || !row) return;
    setMode(row.holderLabel ? 'label' : 'entry');
    setEntryKey(row.personId ? `p${row.personId}` : '');
    setLabel(row.holderLabel || '');
    setErrors({}); setFormError('');
  }, [open, row]);
  const entries = (directory.rows || []).filter((e) => e.status !== 'resigned');
  const entry = entries.find((e) => e.key === entryKey) || null;
  const searchPeople = useDirectorySearch(directory, entries);
  const ai = usePrakasaAIForm(AI_PHONE_HOLDER, {
    enabled: open && Boolean(row),
    record: { type: 'it_phone_line', id: row?.id },
    values: { mode, entryKey, label },
    setters: { mode: setMode, entryKey: setEntryKey, label: setLabel },
    setErrors,
    initialValues: { mode: row?.holderLabel ? 'label' : 'entry', entryKey: row?.personId ? `p${row.personId}` : '', label: row?.holderLabel || '' },
    context: { mode, searchPeople, nameOf: (key) => personName(entries, key) },
    validate: (next) => {
      const found = holderErrors({ mode: next.mode, entry: next.mode === 'entry' ? (entries.find((e) => e.key === next.entryKey) || null) : null, label: next.label });
      return found.entry ? { entryKey: found.entry } : found;
    },
  });
  if (!row) return null;

  const submit = async (event) => {
    event.preventDefault();
    const input = { mode, entry, label };
    const found = holderErrors(input);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const response = await api.post(`${ENDPOINTS.phone}/${row.id}/holder`, holderBody(input, row));
      toast(mode === 'none' ? 'Nomor dikembalikan menjadi cadangan' : 'Pemegang nomor diganti', 'success');
      await onSaved?.(response.data.data);
    } catch (error) {
      const { code, message } = errorOf(error);
      if (code === 'VERSION_CONFLICT') setFormError(conflictText);
      else if (['PERSON_INVALID', 'PERSON_EXCLUDED', 'PERSON_RESIGNED'].includes(code)) setErrors({ entry: message });
      else setFormError(message || 'Pemegang gagal diganti.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title="Ganti pemegang"
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        <p className="it-infra__subject">{`${phoneText(row)}${row.holderName ? ` · sekarang ${row.holderName}` : ''}`}</p>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Context name="holder"><Segmented label="Pemegang" options={HOLDER_MODES} value={mode} {...ai.field('mode')} onChange={(value) => { setMode(value); setErrors({}); }} /></Context>
        {mode === 'entry' ? (
          <Select
            label="Orang di direktori" required
            placeholder={directory.loading ? 'Memuat direktori' : 'Pilih orang'}
            disabled={directory.loading}
            value={entryKey}
            error={errors.entry || directory.error || undefined}
            options={entries.map((e) => ({ value: e.key, label: entryLabel(e) }))}
            dataOptions
            {...ai.field('entryKey')}
            onChange={(e) => { setEntryKey(e.target.value); setErrors({}); }}
          />
        ) : null}
        {mode === 'label' ? (
          <Input label="Nama tim" required value={label} maxLength={120} error={errors.label} hint="Contoh: Tim Sales, Resepsionis." {...ai.field('label')} onChange={(e) => { setLabel(e.target.value); setErrors({}); }} />
        ) : null}
        {mode === 'none' ? <Banner tone="info">Nomor menjadi Cadangan dan tidak dipegang siapa pun.</Banner> : null}
      </form>
    </Modal>
  );
}

// Google Workspace "Catat review" (FullScreenDialog): a new snapshot each time.
export function GwsReviewDialog({ open, latest, onClose, onSaved }) {
  const formId = useId();
  const blank = () => ({
    reviewedOn: todayWib(),
    activeUsers: latest ? String(latest.activeUsers) : '',
    superAdmins: latest ? String(latest.superAdmins) : '',
    exUsersActive: '0',
    mfaEnforced: latest ? latest.mfaEnforced : false,
    externalSharingRestricted: latest ? latest.externalSharingRestricted : false,
    sharedAccountsUsed: latest ? latest.sharedAccountsUsed : false,
    notes: '',
  });
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues(blank()); setErrors({}); setFormError(''); setDirty(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name) => (value) => { setValues((c) => ({ ...c, [name]: value })); setErrors((c) => ({ ...c, [name]: undefined })); setDirty(true); };
  const ai = usePrakasaAIForm(AI_GWS_REVIEW, {
    enabled: open,
    values,
    setValues,
    setErrors,
    onFill: () => setDirty(true),
    initialValues: blank(),
    validate: (next) => gwsErrors(next, todayWib()),
  });
  const submit = async (event) => {
    event.preventDefault();
    const found = gwsErrors(values, todayWib());
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const response = await api.post(ENDPOINTS.gws, gwsBody(values));
      toast('Review Google Workspace dicatat', 'success');
      await onSaved?.(response.data.data);
    } catch (error) {
      const fieldErrors = fieldErrorFromApi(error);
      if (fieldErrors) setErrors(fieldErrors);
      else setFormError(errorMessage(error, 'Review gagal dicatat.'));
    } finally { setSaving(false); }
  };

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title="Catat review Google Workspace"
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan review</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Banner tone="info">Isi dari konsol admin Google. Jangan mencatat nama atau email akun admin, kode pemulihan, atau kata sandi.</Banner>
        <FullScreenSection title="Hasil review">
          <div className="pw-fsdialog__fields">
            {GWS_FIELDS.map((field) => {
              if (field.type === 'switch') return <Switch key={field.name} label={field.label} checked={Boolean(values[field.name])} {...ai.field(field.name)} onChange={(e) => set(field.name)(e.target.checked)} />;
              if (field.type === 'date') return <DateInput key={field.name} label={field.label} required value={values[field.name]} max={todayWib()} error={errors[field.name]} {...ai.field(field.name)} onChange={(e) => set(field.name)(e.target.value)} />;
              return <Input key={field.name} label={field.label} required type="number" inputMode="numeric" value={values[field.name]} error={errors[field.name]} {...ai.field(field.name)} onChange={(e) => set(field.name)(e.target.value)} />;
            })}
          </div>
        </FullScreenSection>
        <FullScreenSection title="Catatan">
          <Textarea label="Catatan" rows={3} maxLength={500} value={values.notes} error={errors.notes} hint="Jangan menulis kata sandi." {...ai.field('notes')} onChange={(e) => set('notes')(e.target.value)} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}
