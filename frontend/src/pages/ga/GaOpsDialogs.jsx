import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { locationOptions, useLocations } from '../it/useLookups';
import {
  ADD_LABELS, DEFAULT_INTERVAL_DAYS, ENDPOINTS, RECORD_LABELS, RESULT_LABELS, formBody, formErrors, formFields,
  formValues, logBody, logErrors, periodOptions, rowTitle,
} from './gaOpsModel';

const errorOf = (error) => error?.response?.data?.error || {};
export const todayWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const conflictText = 'Data ini sudah diubah orang lain. Tutup, muat ulang, lalu ulangi perubahan Anda.';

// What Prakasa AI may fill in each register (the server's word on it: backend
// forms/ga.js). A field of gaOpsModel.formFields that is NOT named here is the
// user's: rupiah (monthlyCost, amount), the customer / meter number, the day a
// bill was paid and the status of a schedule or contract (a decision). A bill's
// usage figure (kWh / m³ — not rupiah) is fillable: a reviewed exception to the
// money-name rule (backend fieldPolicy.js NOT_MONEY).
const AI_OPS_FILLABLE = {
  maintenance: ['name', 'category', 'locationId', 'vendorName', 'intervalDays', 'lastDoneOn', 'nextDueOn', 'notes'],
  contracts: ['vendorName', 'kind', 'description', 'locationId', 'startOn', 'endOn', 'noticeDays', 'notes'],
  bills: ['utility', 'locationId', 'period', 'usageAmount', 'dueOn', 'notes'],
};
const AI_OPS_USER_ONLY = {
  maintenance: ['status'],
  contracts: ['monthlyCost', 'status'],
  bills: ['customerNumber', 'amount', 'paidOn'],
};
const AI_OPS_NUMBER = { intervalDays: { min: 1, max: 1830, step: 1 }, noticeDays: { min: 0, max: 365, step: 1 } };
// For the model only: a new schedule takes the usual interval of its kind (the form's own rule, `set` below).
const AI_CATEGORY_HINT = 'Di jadwal baru, memilih jenis mengisi interval yang biasa bila Interval masih kosong (misalnya AC 90 hari). Untuk interval lain, isi Interval (hari) dalam panggilan yang sama.';
const AI_OPS_IDS = { maintenance: 'ga-ops-maintenance', contracts: 'ga-ops-contract', bills: 'ga-ops-bill' };
const AI_OPS_EDIT_TITLES = { maintenance: 'Ubah jadwal perawatan', contracts: 'Ubah kontrak', bills: 'Ubah tagihan' };
const AI_OPS_RECORDS = { maintenance: 'ga_maintenance_item', contracts: 'ga_contract', bills: 'ga_utility_bill' };

// The form's own field list (gaOpsModel.formFields) as Prakasa AI field specs.
function aiOpsFields({ kind, editing = false, fields = [], locationChoices = [], periodChoices = [] }) {
  if (!AI_OPS_FILLABLE[kind]) return [];
  return fields.map((field) => {
    const options = { required: Boolean(field.required), hint: kind === 'maintenance' && field.name === 'category' && !editing ? AI_CATEGORY_HINT : field.hint };
    const type = field.type === 'location' ? 'select' : field.type;
    if (AI_OPS_USER_ONLY[kind].includes(field.name) || !AI_OPS_FILLABLE[kind].includes(field.name)) return f.userOnly(field.name, field.label, type);
    if (field.type === 'location') return f.select(field.name, field.label, locationChoices, options);
    if (field.type === 'select') return f.select(field.name, field.label, field.name === 'period' ? periodChoices : field.options, options);
    if (field.type === 'date') return f.date(field.name, field.label, options);
    if (field.type === 'number') return f.number(field.name, field.label, { ...options, min: 0, ...AI_OPS_NUMBER[field.name] });
    if (field.type === 'textarea') return f.textarea(field.name, field.label, { ...options, maxLength: field.max });
    return f.text(field.name, field.label, { ...options, maxLength: field.max });
  });
}
const AI_OPS_CREATE = defineAIForm({
  id: ({ kind }) => AI_OPS_IDS[kind],
  title: ({ kind }) => ADD_LABELS[kind] || 'Operasional GA',
  permission: 'ga.ops.manage',
  submitLabel: 'Simpan',
  fields: aiOpsFields,
});
const AI_OPS_EDIT = defineAIForm({
  id: ({ kind }) => (AI_OPS_IDS[kind] ? `${AI_OPS_IDS[kind]}-edit` : undefined),
  title: ({ kind }) => AI_OPS_EDIT_TITLES[kind] || 'Operasional GA',
  permission: 'ga.ops.manage',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: aiOpsFields,
});
// "Catat perawatan": the day, the result and a note. The cost is rupiah: the user's.
const RESULT_OPTIONS = Object.entries(RESULT_LABELS).map(([value, label]) => ({ value, label }));
const AI_UPKEEP_LOG = defineAIForm({
  id: 'ga-ops-maintenance-log', title: 'Catat perawatan', permission: ['ga.ops.manage', 'ga.request.process'], submitLabel: 'Simpan',
  fields: [
    f.date('doneOn', 'Tanggal dikerjakan', { required: true, hint: 'Hari ini atau sebelumnya.' }),
    f.select('result', 'Hasil', RESULT_OPTIONS, { required: true }),
    f.userOnly('cost', 'Biaya (Rp)', 'number'),
    f.textarea('note', 'Catatan', { maxLength: 500, hint: 'Misalnya: freon ditambah, filter diganti' }),
  ],
});

function FieldControl({ field, value = '', error, onChange, locations, currentLocationId, currentPeriod, today, aiFilled = false }) {
  const common = { label: field.label, required: field.required, error, hint: field.hint, aiFilled };
  if (field.type === 'textarea') return <Textarea {...common} rows={3} value={value} maxLength={field.max} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'date') return <DateInput {...common} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'select') {
    const opts = field.name === 'period' ? periodOptions(today, currentPeriod) : field.options;
    return <Select {...common} value={value} options={opts} placeholder={field.required ? 'Pilih' : undefined} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'location') {
    return (
      <Select
        {...common}
        value={value}
        placeholder={field.required ? 'Pilih lokasi' : 'Tanpa lokasi'}
        options={locationOptions(locations.rows, currentLocationId)}
        dataOptions
        hint={locations.error || (!locations.loading && !locations.rows.length ? 'Belum ada lokasi. Tambahkan di IT → Perangkat → tab Lokasi.' : field.hint)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      {...common}
      type={field.type === 'number' ? 'number' : 'text'}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      maxLength={field.type === 'number' ? undefined : field.max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Add / edit one row of a register: FullScreenDialog (more than 5 fields, §3.3).
// An edit sends only what changed, with the row's version.
export function GaOpsFormDialog({ open, kind, row, onClose, onSaved }) {
  const formId = useId();
  const today = todayWib();
  const editing = Boolean(row);
  const [values, setValues] = useState(() => formValues(kind, row, today));
  // The values the dialog opened with (the loaded row, or the empty form), and for which row.
  const [opened, setOpened] = useState({ values, rowId: row?.id ?? null });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const locations = useLocations(open);

  useEffect(() => {
    if (!open) return;
    const fresh = formValues(kind, row, todayWib());
    setValues(fresh); setOpened({ values: fresh, rowId: row?.id ?? null }); setErrors({}); setFormError(''); setDirty(false);
  }, [open, kind, row]);

  // The location list is fetched when the dialog opens: Prakasa AI is told about
  // the form once that list has settled, so it never reads a Lokasi with no choices.
  const [locationsAsked, setLocationsAsked] = useState(false);
  useEffect(() => {
    if (!open) setLocationsAsked(false);
    else if (locations.loading) setLocationsAsked(true);
  }, [open, locations.loading]);
  const aiReady = open && Boolean(AI_OPS_IDS[kind]) && locationsAsked && !locations.loading;

  const fields = kind ? formFields(kind, today).filter((field) => editing || !field.editOnly) : [];
  const set = (name) => (value) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      // A new schedule offers the usual interval for its kind of upkeep.
      if (kind === 'maintenance' && !editing && name === 'category' && !current.intervalDays && DEFAULT_INTERVAL_DAYS[value]) {
        next.intervalDays = String(DEFAULT_INTERVAL_DAYS[value]);
      }
      return next;
    });
    setErrors((current) => ({ ...current, [name]: undefined }));
    setDirty(true);
  };

  // Prakasa AI fills through the form's own change handler (`set`: the usual
  // interval of a new schedule, the "ada perubahan" flag). Add and edit are two
  // forms; an edit registers once the row's values are in the form.
  const aiBinding = {
    values,
    apply: (patch) => Object.entries(patch).forEach(([name, value]) => set(name)(value)),
    initialValues: opened.values,
    context: {
      kind, editing, fields, locationChoices: locationOptions(locations.rows, row?.locationId), periodChoices: periodOptions(today, row?.period),
    },
    validate: (next) => formErrors(kind, next, editing, today),
  };
  const ai = usePrakasaAIForm(AI_OPS_CREATE, {
    ...aiBinding,
    enabled: aiReady && !editing,
  });
  const aiEdit = usePrakasaAIForm(AI_OPS_EDIT, {
    ...aiBinding,
    enabled: aiReady && editing && opened.rowId === row?.id,
    record: { type: AI_OPS_RECORDS[kind], id: row?.id },
  });
  const aiMark = (name) => (editing ? aiEdit : ai).field(name);

  if (!kind) return null;

  const submit = async (event) => {
    event.preventDefault();
    const found = formErrors(kind, values, editing, today);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = formBody(kind, values, row, today);
    if (editing && !Object.keys(body).filter((k) => k !== 'version').length) { onClose(); return; }
    setSaving(true); setFormError('');
    try {
      const response = editing ? await api.patch(`${ENDPOINTS[kind]}/${row.id}`, body) : await api.post(ENDPOINTS[kind], body);
      toast(editing ? `${RECORD_LABELS[kind]} diperbarui` : `${RECORD_LABELS[kind]} ditambahkan`, 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      const { code, message, details } = errorOf(error);
      if (code === 'VERSION_CONFLICT') setFormError(conflictText);
      else if (details?.field && fields.some((f) => f.name === details.field)) setErrors((current) => ({ ...current, [details.field]: message }));
      else setFormError(message || `${RECORD_LABELS[kind]} gagal disimpan.`);
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? `Ubah ${rowTitle(kind, row) || RECORD_LABELS[kind]}` : ADD_LABELS[kind];
  const controls = fields.map((f) => (
    <FieldControl
      key={f.name}
      field={f}
      value={values[f.name]}
      error={errors[f.name]}
      onChange={set(f.name)}
      locations={locations}
      currentLocationId={row?.locationId}
      currentPeriod={row?.period}
      today={today}
      {...aiMark(f.name)}
    />
  ));
  const notes = controls.filter((c) => c.key === 'notes');
  const rest = controls.filter((c) => c.key !== 'notes');
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={title}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        {aiEdit.notice}
        {kind === 'bills' ? <Banner tone="info">Pembayaran tetap diajukan lewat Finance. Di sini GA mencatat tagihan dan tanggal lunasnya.</Banner> : null}
        <FullScreenSection title={RECORD_LABELS[kind]}>
          <div className="pw-fsdialog__fields">{rest}</div>
        </FullScreenSection>
        <FullScreenSection title="Catatan">{notes}</FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}

// "Catat perawatan": upkeep done on an item. The schedule moves to that day +
// the interval (the server does it in the same transaction).
export function MaintenanceLogDialog({ open, row, onClose, onSaved }) {
  const formId = useId();
  const [values, setValues] = useState({ doneOn: todayWib(), result: 'ok', cost: '', note: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({ doneOn: todayWib(), result: 'ok', cost: '', note: '' }); setErrors({}); setFormError('');
  }, [open, row]);

  const ai = usePrakasaAIForm(AI_UPKEEP_LOG, {
    enabled: open && Boolean(row),
    values,
    setValues,
    setErrors,
    initialValues: { doneOn: todayWib(), result: 'ok', cost: '', note: '' },
    validate: (next) => logErrors(next, todayWib()),
  });

  if (!row) return null;
  const set = (name) => (e) => { setValues((v) => ({ ...v, [name]: e.target.value })); setErrors((v) => ({ ...v, [name]: undefined })); };
  const submit = async (event) => {
    event.preventDefault();
    const found = logErrors(values, todayWib());
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setFormError('');
    try {
      const response = await api.post(`${ENDPOINTS.maintenance}/${row.id}/logs`, logBody(values));
      toast('Perawatan dicatat', 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      const { message, details } = errorOf(error);
      if (details?.field === 'doneOn') setErrors({ doneOn: message });
      else setFormError(message || 'Perawatan gagal dicatat.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={`Catat perawatan ${row.name}`}
      size="md"
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
        <DateInput label="Tanggal dikerjakan" required value={values.doneOn} {...ai.field('doneOn')} error={errors.doneOn} onChange={set('doneOn')} hint={`Jadwal berikutnya: tanggal ini + ${row.intervalDays} hari`} />
        <Select label="Hasil" required value={values.result} {...ai.field('result')} options={RESULT_OPTIONS} onChange={set('result')} />
        <Input label="Biaya (Rp)" type="number" inputMode="decimal" value={values.cost} error={errors.cost} onChange={set('cost')} hint="Boleh dikosongkan" />
        <Textarea label="Catatan" rows={3} maxLength={500} value={values.note} {...ai.field('note')} onChange={set('note')} hint="Misalnya: freon ditambah, filter diganti" />
      </form>
    </Modal>
  );
}
