import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  DEVICE_NEED_LABELS, KANTORKU_NOTE, PHONE_NEED_LABELS, REASON_LABELS, apiErrorCode, apiErrorMessage, choiceLabel, holdingsSummary,
  optionsFrom, personChoices, personOptions, searchChoices, userChoices, userOptions, workflowAiPatch, workflowAiValues, workflowBody,
  workflowFieldErrorFromApi, workflowFormErrors, workflowFormValues,
} from './hrgaModel';
import useHrgaLookups from './useHrgaLookups';
import { SkeletonLine } from '../../components/Skeleton';
import './hrga-workflow.css';
import { NoTranslate } from '../../i18n/NoTranslate';

const NEED_SWITCHES = [
  ['google', 'Akun Google', 'needGoogle'],
  ['app', 'Akun Prakasa Workspace', 'needApp'],
  ['idCard', 'Kartu akses', 'needIdCard'],
  ['desk', 'Meja', 'needDesk'],
];

// What Prakasa AI may fill here (docs/prakasa-ai-rencana.md §9.9). The reason
// for leaving and the free-text note stay with the user; personal data is in
// KantorKu and has no field on this form. People are found in the lists the
// Selects already show (GET /hrga/lookups).
const aiWorkflowFields = ({ offboarding, editing, departments, locations, licenses, people, activePeople, users }) => {
  const pic = f.person('hrgaPicUserId', 'PIC People & Culture', (text) => searchChoices(users, text), { labelOf: (value) => choiceLabel(users, value) });
  const notes = f.userOnly('notes', 'Catatan', 'textarea');
  if (offboarding) {
    return [
      editing
        ? f.readOnly('personKey', 'Karyawan', 'person', { labelOf: (value) => choiceLabel(people, value) })
        : f.person('personKey', 'Karyawan', (text) => searchChoices(activePeople, text), { required: true, labelOf: (value) => choiceLabel(people, value) }),
      f.date('lastWorkingDate', 'Hari terakhir', { required: true }),
      f.userOnly('reasonCode', 'Alasan', 'select'),
      pic,
      notes,
    ];
  }
  return [
    f.text('employeeFullName', 'Nama lengkap', { required: true, maxLength: 150 }),
    f.text('employeePosition', 'Jabatan', { maxLength: 120 }),
    f.select('departmentId', 'Divisi', departments, { required: true }),
    f.person('managerKey', 'Atasan langsung', (text) => searchChoices(activePeople, text), { labelOf: (value) => choiceLabel(people, value) }),
    f.select('locationId', 'Lokasi kerja', locations),
    f.text('plannedWorkEmail', 'Email kerja rencana', { maxLength: 190, hint: 'Email perusahaan yang akan dibuat. Bukan email pribadi.' }),
    f.person('personKey', 'Sudah ada di direktori?', (text) => searchChoices(people, text), { labelOf: (value) => choiceLabel(people, value), hint: 'Hanya bila orang ini sudah tercatat di direktori.' }),
    f.date('joinDate', 'Tanggal mulai', { required: true }),
    f.checkbox('needGoogle', 'Akun Google'),
    f.checkbox('needApp', 'Akun Prakasa Workspace'),
    f.checkbox('needIdCard', 'Kartu akses'),
    f.checkbox('needDesk', 'Meja'),
    f.select('needDevice', 'Perangkat', optionsFrom(DEVICE_NEED_LABELS)),
    f.select('needPhone', 'Nomor perusahaan', optionsFrom(PHONE_NEED_LABELS)),
    f.multiselect('needLicenses', 'Lisensi', licenses),
    pic,
    notes,
  ];
};
const AI_WORKFLOW = defineAIForm({
  id: ({ offboarding }) => (offboarding ? 'hr-offboarding' : 'hr-onboarding'),
  title: ({ offboarding }) => (offboarding ? 'Offboarding' : 'Onboarding'),
  permission: 'hrga.request',
  submitLabel: 'Simpan draf',
  fields: aiWorkflowFields,
});
const AI_WORKFLOW_EDIT = defineAIForm({
  id: ({ offboarding }) => (offboarding ? 'hr-offboarding-edit' : 'hr-onboarding-edit'),
  title: ({ offboarding }) => (offboarding ? 'Ubah offboarding' : 'Ubah onboarding'),
  permission: 'hrga.request',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: aiWorkflowFields,
});

// Create / edit an onboarding or offboarding draft (FullScreenDialog,
// spec §2.1.6). No personal data: no personal phone, no free-text reason, a
// KantorKu banner. Edit sends the version; a conflict asks to reload.
export default function WorkflowFormDialog({ open, type, workflow, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(workflow);
  const kind = workflow?.workflowType || type || 'onboarding';
  const offboarding = kind === 'offboarding';
  const [values, setValues] = useState(() => workflowFormValues(workflow, kind));
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const lookups = useHrgaLookups(open);

  useEffect(() => {
    if (!open) return;
    setValues(workflowFormValues(workflow, kind));
    setErrors({}); setDirty(false); setFormError(''); setConflict(false);
  }, [open, workflow, kind]);

  // "Buat offboarding": what the picked person still holds, before submitting.
  const [picked, setPicked] = useState({ key: '', holdings: null, loading: false });
  useEffect(() => {
    if (!open || !offboarding || editing || !values.personKey) { setPicked({ key: '', holdings: null, loading: false }); return undefined; }
    let alive = true;
    const key = values.personKey;
    setPicked({ key, holdings: null, loading: true });
    api.get('/hrga/holdings', { params: { personKey: key } })
      .then((r) => { if (alive) setPicked({ key, holdings: r.data?.data || null, loading: false }); })
      .catch(() => { if (alive) setPicked({ key, holdings: null, loading: false }); });
    return () => { alive = false; };
  }, [open, offboarding, editing, values.personKey]);

  const change = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDirty(true);
  };
  const changeNeed = (field, value) => {
    setValues((current) => ({ ...current, needs: { ...current.needs, [field]: value } }));
    setDirty(true);
  };
  const toggleLicense = (id, checked) => {
    const set = new Set(values.needs.licenses || []);
    if (checked) set.add(String(id)); else set.delete(String(id));
    changeNeed('licenses', [...set]);
  };
  const field = (name) => ({ value: values[name], error: errors[name], onChange: (event) => change(name, event.target.value) });

  const submit = async (event) => {
    event.preventDefault();
    const found = workflowFormErrors(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setFormError('');
    try {
      const body = workflowBody(values, editing ? { version: workflow.version } : undefined);
      const response = editing
        ? await api.patch(`/hrga/workflows/${workflow.id}`, body)
        : await api.post('/hrga/workflows', body);
      const out = response.data.data || {};
      const label = offboarding ? 'Offboarding' : 'Onboarding';
      toast(editing ? 'Draf diperbarui' : [label, out.workflowNumber, 'dibuat sebagai draf'].filter(Boolean).join(' '), 'success');
      await onSaved?.(out);
    } catch (error) {
      if (apiErrorCode(error) === 'VERSION_CONFLICT') {
        setConflict(true);
        setFormError(apiErrorMessage(error, 'Data ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru.'));
      } else {
        const fieldErrors = workflowFieldErrorFromApi(error);
        if (fieldErrors) setErrors((current) => ({ ...current, ...fieldErrors }));
        else setFormError(apiErrorMessage(error, 'Data gagal disimpan.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const departments = lookups.departments.map((d) => ({ value: String(d.id), label: d.name }));
  const locations = lookups.locations.map((l) => ({ value: String(l.id), label: l.name }));
  const users = userOptions(lookups.users);
  // Prakasa AI fills through the form's own state; the user presses the button.
  const ai = usePrakasaAIForm(editing ? AI_WORKFLOW_EDIT : AI_WORKFLOW, {
    enabled: open,
    ready: !lookups.loading,
    record: { type: 'hrga_workflow', id: workflow?.id },
    values: workflowAiValues(values),
    apply: (patch) => { setValues((current) => workflowAiPatch(current, patch)); setDirty(true); },
    setErrors,
    validate: workflowFormErrors,
    initialValues: workflowAiValues(workflowFormValues(workflow, kind)),
    context: {
      offboarding, editing, departments, locations,
      licenses: lookups.subscriptions.map((s) => ({ value: String(s.id), label: [s.productName, s.planName].filter(Boolean).join(' · ') })),
      people: personChoices(lookups.people),
      activePeople: personChoices(lookups.people, { activeOnly: true }),
      users: userChoices(lookups.users),
    },
  });
  const aiNeed = (name) => ai.field(name);
  const lookupHint = lookups.error || undefined;
  const title = editing
    ? `Ubah ${offboarding ? 'offboarding' : 'onboarding'} ${workflow.workflowNumber || ''}`.trim()
    : `Buat ${offboarding ? 'offboarding' : 'onboarding'}`;

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={title}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving} disabled={conflict}>{editing ? 'Simpan perubahan' : 'Simpan draf'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        <Banner tone="info">{KANTORKU_NOTE}</Banner>
        {formError ? (
          <Banner
            tone="error"
            action={conflict ? <Button variant="text" type="button" onClick={async () => { await onSaved?.({ reload: true }); }}>Muat ulang</Button> : null}
          >
            {formError}
          </Banner>
        ) : null}
        {offboarding ? (
          <>
            <FullScreenSection title="Karyawan">
              <div className="pw-fsdialog__fields">
                <Select
                  label="Karyawan"
                  required
                  placeholder={lookups.loading ? 'Memuat direktori' : 'Pilih orang di direktori'}
                  options={personOptions(lookups.people, { activeOnly: true })}
                  disabled={editing || lookups.loading}
                  dataOptions
                  {...ai.field('personKey')} {...field('personKey')}
                  hint={errors.personKey ? undefined : (lookupHint || 'Perangkat, lisensi, dan nomor yang dipegangnya masuk checklist otomatis saat disetujui.')}
                />
              </div>
              {editing && workflow.holdings ? (
                <p className="hrga-form-note">{`Kepemilikan: ${holdingsSummary(workflow.holdings)}`}</p>
              ) : null}
              {!editing && picked.key ? (
                <p className="hrga-form-note" aria-live="polite">
                  {picked.loading ? 'Memeriksa kepemilikan…' : (picked.holdings ? `Kepemilikan: ${holdingsSummary(picked.holdings)}` : 'Kepemilikan belum bisa dimuat; tetap masuk checklist saat disetujui.')}
                </p>
              ) : null}
            </FullScreenSection>
            <FullScreenSection title="Hari terakhir dan alasan">
              <div className="pw-fsdialog__fields">
                <DateInput label="Hari terakhir" required {...ai.field('lastWorkingDate')} {...field('lastWorkingDate')} />
                <Select label="Alasan" required placeholder="Pilih alasan" options={optionsFrom(REASON_LABELS)} {...field('reasonCode')} />
              </div>
            </FullScreenSection>
          </>
        ) : (
          <>
            <FullScreenSection title="Karyawan">
              <div className="pw-fsdialog__fields">
                <Input label="Nama lengkap" required maxLength={150} {...ai.field('employeeFullName')} {...field('employeeFullName')} />
                <Input label="Jabatan" maxLength={120} {...ai.field('employeePosition')} {...field('employeePosition')} />
                <Select label="Divisi" required placeholder="Pilih divisi" options={departments} {...ai.field('departmentId')} {...field('departmentId')} hint={errors.departmentId ? undefined : lookupHint} />
                <Select
                  label="Atasan langsung"
                  placeholder="Pilih atasan"
                  options={personOptions(lookups.people, { activeOnly: true })}
                  {...ai.field('managerKey')} {...field('managerKey')}
                  dataOptions
                  hint={errors.managerKey ? undefined : 'Atasan menyetujui onboarding ini bila punya akun aplikasi.'}
                />
                <Select label="Lokasi kerja" placeholder="Pilih lokasi" options={locations} dataOptions {...ai.field('locationId')} {...field('locationId')} />
                <Input label="Email kerja rencana" type="email" maxLength={190} {...ai.field('plannedWorkEmail')} {...field('plannedWorkEmail')} hint={errors.plannedWorkEmail ? undefined : 'Email perusahaan yang akan dibuat. Bukan email pribadi.'} />
                <Select
                  label="Sudah ada di direktori?"
                  placeholder="Belum ada (orang baru)"
                  options={personOptions(lookups.people)}
                  dataOptions
                  {...ai.field('personKey')} {...field('personKey')}
                  hint={errors.personKey ? undefined : 'Pilih bila orang ini pernah bekerja di sini atau sudah tercatat di direktori.'}
                />
              </div>
            </FullScreenSection>
            <FullScreenSection title="Jadwal">
              <div className="pw-fsdialog__fields">
                <DateInput label="Tanggal mulai" required {...ai.field('joinDate')} {...field('joinDate')} hint={errors.joinDate ? undefined : 'Tenggat checklist dihitung dari tanggal ini.'} />
              </div>
            </FullScreenSection>
            <FullScreenSection title="Kebutuhan">
              <div className="hrga-needs">
                {NEED_SWITCHES.map(([key, label, aiName]) => (
                  <Switch key={key} label={label} checked={Boolean(values.needs[key])} {...aiNeed(aiName)} onChange={(event) => changeNeed(key, event.target.checked)} />
                ))}
              </div>
              <div className="pw-fsdialog__fields">
                <Select label="Perangkat" options={optionsFrom(DEVICE_NEED_LABELS)} value={values.needs.device} {...ai.field('needDevice')} onChange={(event) => changeNeed('device', event.target.value)} />
                <Select label="Nomor perusahaan" options={optionsFrom(PHONE_NEED_LABELS)} value={values.needs.phone} {...ai.field('needPhone')} onChange={(event) => changeNeed('phone', event.target.value)} />
              </div>
              <fieldset className="hrga-licenses">
                <legend className="pw-overline">Lisensi</legend>
                {lookups.subscriptions.length ? lookups.subscriptions.map((s) => (
                  <Checkbox
                    key={s.id}
                    label={<><NoTranslate>{[s.productName, s.planName].filter(Boolean).join(' · ')}</NoTranslate> {`(${Number(s.availableLicenses) || 0} tersedia)`}</>}
                    checked={(values.needs.licenses || []).includes(String(s.id))}
                    aiFilled={ai.isFilled('needLicenses') && (values.needs.licenses || []).includes(String(s.id))}
                    onChange={(event) => toggleLicense(s.id, event.target.checked)}
                  />
                )) : lookups.loading ? (
                  <span role="status" aria-label="Memuat langganan"><SkeletonLine width="40%" height={12} /></span>
                ) : <span className="pw-text-helper">Belum ada langganan aktif.</span>}
              </fieldset>
            </FullScreenSection>
          </>
        )}
        <FullScreenSection title="People & Culture">
          <div className="pw-fsdialog__fields">
            <Select label="PIC People & Culture" placeholder="Belum dipilih" options={users} dataOptions {...ai.field('hrgaPicUserId')} {...field('hrgaPicUserId')} />
          </div>
          <Textarea label="Catatan" rows={3} maxLength={1000} {...field('notes')} hint={errors.notes ? undefined : 'Catatan kerja saja. Jangan tulis data pribadi atau kata sandi.'} />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}
