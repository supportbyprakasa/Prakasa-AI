import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { choiceLabel, searchChoices } from '../hrga/hrgaModel';
import { departmentOptions, locationOptions, useDepartments, useDirectoryEntries, useLocations } from '../it/useLookups';
import {
  PERSON_KIND_LABELS, PERSON_STATUS_LABELS, isDuplicateName, managerChoices, managerOptions, personBody, personFieldErrorFromApi,
  personFormErrors, personFormValues,
} from './directoryModel';

const optionsOf = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// What Prakasa AI may fill here (docs/prakasa-ai-rencana.md §9.9): the work
// profile only. The work phone, kind and exclusion, status, resign date and
// the People & Culture note are the user's and are never read back. Personal
// data (NIK, address, salary) lives in KantorKu and has no field here. The
// manager is found in the list the Select shows (GET /people/directory).
const aiPersonFields = ({ hasAccount, departments, locations, managers, excluded, resigned }) => [
  hasAccount ? f.readOnly('name', 'Nama') : f.text('name', 'Nama', { required: true, maxLength: 150 }),
  hasAccount ? f.readOnly('workEmail', 'Email kerja') : f.text('workEmail', 'Email kerja', { maxLength: 190, hint: 'Hanya domain perusahaan. Email pribadi ditolak.' }),
  hasAccount ? f.readOnly('departmentId', 'Divisi', 'select', { options: departments }) : f.select('departmentId', 'Divisi', departments),
  f.text('position', 'Jabatan', { maxLength: 150 }),
  f.person('managerKey', 'Atasan langsung', (text) => searchChoices(managers, text), { labelOf: (value) => choiceLabel(managers, value) }),
  f.select('locationId', 'Lokasi kerja', locations),
  f.userOnly('workPhone', 'Telepon kerja'),
  f.userOnly('kind', 'Jenis', 'select'),
  ...(excluded ? [f.userOnly('excludedReason', 'Alasan dikecualikan')] : []),
  f.userOnly('status', 'Status', 'select'),
  ...(resigned ? [f.userOnly('resignedOn', 'Tanggal resign', 'date')] : []),
  f.userOnly('notes', 'Catatan', 'textarea'),
];
const AI_PERSON = defineAIForm({
  id: 'people-person',
  title: 'Tambah orang ke direktori',
  permission: 'people.directory.manage',
  submitLabel: 'Tambah orang',
  fields: aiPersonFields,
});
const AI_PERSON_EDIT = defineAIForm({
  id: 'people-person-edit',
  title: 'Ubah profil kerja',
  permission: 'people.directory.manage',
  submitLabel: 'Simpan profil',
  mode: 'edit',
  fields: aiPersonFields,
});

// Add a person without an app account, or edit anyone's work profile
// (People & Culture only). For a person with an account, name, work email
// and division come from the account (Admin → Pengguna) and are read-only
// here; saving them creates the account's directory row (= reviewed).
export default function PersonFormDialog({ open, entry, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(entry);
  const hasAccount = Boolean(entry?.hasAccount);
  const [values, setValues] = useState(() => personFormValues(entry));
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [duplicate, setDuplicate] = useState('');
  const directory = useDirectoryEntries(open);
  const locations = useLocations(open);
  const departments = useDepartments(open && !hasAccount);

  useEffect(() => {
    if (!open) return;
    setValues(personFormValues(entry));
    setErrors({}); setDirty(false); setFormError(''); setDuplicate('');
  }, [open, entry]);

  const set = (field) => (event) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setDuplicate('');
    setDirty(true);
  };

  const save = async (confirmDuplicateName = false) => {
    const found = personFormErrors(values, { hasAccount });
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = personBody(values, entry || null);
    if (editing && !Object.keys(body).length) { onClose(); return; }
    if (confirmDuplicateName) body.confirmDuplicateName = true;
    setSaving(true);
    setFormError('');
    try {
      const response = editing
        ? await api.patch(`/people/directory/${entry.key}`, body)
        : await api.post('/people/directory', body);
      toast(editing ? 'Profil kerja disimpan' : 'Orang ditambahkan ke direktori', 'success');
      await onSaved?.(response.data.data || {});
    } catch (error) {
      if (!editing && isDuplicateName(error)) {
        setDuplicate(error.response.data.error.message);
        return;
      }
      const fieldErrors = personFieldErrorFromApi(error);
      if (fieldErrors) setErrors((current) => ({ ...current, ...fieldErrors }));
      else setFormError(error?.response?.data?.error?.message || 'Profil gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const submit = (event) => { event.preventDefault(); save(false); };
  const accountDepartments = hasAccount ? [{ value: values.departmentId, label: entry.departmentName || 'Tanpa divisi' }] : departmentOptions(departments.rows);
  const ai = usePrakasaAIForm(editing ? AI_PERSON_EDIT : AI_PERSON, {
    enabled: open,
    ready: !directory.loading,
    record: { type: 'directory_person', id: entry?.key },
    values,
    setValues,
    setErrors,
    onFill: () => { setDuplicate(''); setDirty(true); },
    validate: (next) => personFormErrors(next, { hasAccount }),
    initialValues: personFormValues(entry),
    context: {
      hasAccount,
      departments: accountDepartments,
      locations: locationOptions(locations.rows, entry?.locationId),
      managers: managerChoices(directory.rows, entry?.key),
      excluded: values.kind === 'excluded',
      resigned: values.status === 'resigned',
    },
  });
  const field = (name) => ({ value: values[name], onChange: set(name), error: errors[name] });
  const accountHint = hasAccount ? 'Diubah di Admin → Pengguna.' : undefined;
  const accountDepartment = hasAccount ? [{ value: values.departmentId, label: entry.departmentName || 'Tanpa divisi' }] : [];

  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Ubah profil ${entry.name}` : 'Tambah orang ke direktori'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan profil' : 'Tambah orang'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {duplicate ? (
          <Banner
            tone="warning"
            title="Nama sudah ada"
            action={<Button variant="text" type="button" loading={saving} onClick={() => save(true)}>Tetap tambahkan</Button>}
          >
            {duplicate}
          </Banner>
        ) : null}
        {!editing ? (
          <Banner tone="info">
            Untuk orang tanpa akun aplikasi (sopir, staf toko). Karyawan yang punya akun sudah ada di direktori — buka dan lengkapi profilnya.
          </Banner>
        ) : null}
        <FullScreenSection title="Profil kerja">
          <div className="pw-fsdialog__fields">
            <Input label="Nama" required={!hasAccount} disabled={hasAccount} hint={accountHint} maxLength={150} {...ai.field('name')} {...field('name')} />
            <Input label="Email kerja" type="email" disabled={hasAccount} hint={accountHint || 'Hanya domain perusahaan. Email pribadi ditolak.'} {...ai.field('workEmail')} {...field('workEmail')} />
            {hasAccount ? (
              <Select label="Divisi" disabled options={accountDepartment} value={values.departmentId} hint={accountHint} />
            ) : (
              <Select label="Divisi" placeholder="Tanpa divisi" options={departmentOptions(departments.rows)} {...ai.field('departmentId')} {...field('departmentId')} />
            )}
            <Input label="Jabatan" maxLength={150} {...ai.field('position')} {...field('position')} />
            <Select
              label="Atasan langsung"
              placeholder={directory.loading ? 'Memuat direktori' : 'Tanpa atasan'}
              disabled={directory.loading}
              options={managerOptions(directory.rows, entry?.key)}
              dataOptions
              {...ai.field('managerKey')} {...field('managerKey')}
              hint={errors.managerKey ? undefined : 'Staf grup boleh dipilih; orang yang resign atau dikecualikan tidak.'}
            />
            <Input label="Telepon kerja" type="tel" {...field('workPhone')} hint={errors.workPhone ? undefined : 'Contoh: +62 21 555 1234 ext 12.'} />
            <Select label="Lokasi kerja" placeholder="Tanpa lokasi" options={locationOptions(locations.rows, entry?.locationId)} dataOptions {...ai.field('locationId')} {...field('locationId')} />
          </div>
        </FullScreenSection>
        <FullScreenSection title="Status dan pengecualian">
          <div className="pw-fsdialog__fields">
            <Select label="Jenis" options={optionsOf(PERSON_KIND_LABELS)} {...field('kind')} hint="Dikecualikan: akun uji, akun bersama, atau akun sistem — tidak dihitung dan tidak tampil ke karyawan." />
            {values.kind === 'excluded' ? (
              <Input label="Alasan dikecualikan" required maxLength={160} {...field('excludedReason')} hint={errors.excludedReason ? undefined : 'Contoh: Akun uji.'} />
            ) : null}
            <Select label="Status" options={optionsOf(PERSON_STATUS_LABELS)} {...field('status')} />
            {values.status === 'resigned' ? <DateInput label="Tanggal resign" required {...field('resignedOn')} /> : null}
          </div>
          <Textarea label="Catatan" rows={3} maxLength={500} {...field('notes')} hint="Hanya untuk People & Culture. Jangan menulis data pribadi (NIK, alamat, gaji)." />
        </FullScreenSection>
      </form>
    </FullScreenDialog>
  );
}
