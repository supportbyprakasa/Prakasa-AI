import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import DateInput from '../../components/DateInput';
import { LoadingState } from '../../components/EmptyState';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { CONDITION_LABELS } from '../it/itModel';
import {
  IT_TICKET_CATEGORY_LABELS, apiErrorMessage, choiceLabel, deviceChoices, deviceOptionLabel, licenseOptions, optionsFrom, searchChoices,
  userChoices, userOptions,
} from './hrgaModel';

const taskUrl = (workflowId, taskId) => `/hrga/workflows/${workflowId}/tasks/${taskId}`;

// What Prakasa AI may fill in the task dialogs (docs/prakasa-ai-rencana.md
// §9.9). It only sets the choice or the text: pressing the dialog's button —
// which completes the task — stays with the user. Records and people are found
// in the lists the dialog already loaded (the same options its Select shows).
const AI_DEVICE_HANDOVER = defineAIForm({
  id: 'hr-task-device-handover',
  title: 'Serahkan perangkat',
  permission: 'device.assign',
  submitLabel: 'Serahkan perangkat',
  fields: ({ devices }) => [
    f.lookup('deviceId', 'Perangkat', (text) => searchChoices(devices, text), { required: true, labelOf: (value) => choiceLabel(devices, value) }),
    f.date('expectedReturnDate', 'Rencana kembali', { hint: 'Opsional. Kosongkan untuk perangkat kerja tetap.' }),
  ],
});
const AI_DEVICE_RETURN = defineAIForm({
  id: 'hr-task-device-return',
  title: 'Terima kembali perangkat',
  permission: 'device.assign',
  submitLabel: 'Terima kembali',
  fields: [
    f.select('conditionOnReturn', 'Kondisi', optionsFrom(CONDITION_LABELS), { hint: 'Kurang atau Rusak → status Rusak; lainnya → Cadangan.' }),
    f.textarea('notes', 'Catatan', { maxLength: 500 }),
  ],
});
const AI_LICENSE_ASSIGN = defineAIForm({
  id: 'hr-task-license',
  title: 'Berikan lisensi',
  permission: 'subscription.license.manage',
  submitLabel: 'Berikan lisensi',
  fields: ({ licenses }) => [
    f.lookup('licenseId', 'Lisensi', (text) => searchChoices(licenses, text), { required: true, labelOf: (value) => choiceLabel(licenses, value) }),
  ],
});
const AI_TASK_ASSIGN = defineAIForm({
  id: 'hr-task-assign',
  title: 'Tugaskan ke',
  permission: 'hrga.manage',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: ({ users }) => [
    f.person('responsibleUserId', 'Penanggung jawab', (text) => searchChoices(users, text), { labelOf: (value) => choiceLabel(users, value), hint: 'Orang yang dipilih menerima notifikasi tugas ini.' }),
  ],
});
const AI_TASK_IT_TICKET = defineAIForm({
  id: 'hr-task-it-ticket',
  title: 'Buat tiket IT',
  permission: 'hrga.view',
  submitLabel: 'Buat tiket',
  fields: [
    f.select('category', 'Kategori', optionsFrom(IT_TICKET_CATEGORY_LABELS)),
    f.text('title', 'Judul', { required: true, maxLength: 150 }),
    f.textarea('description', 'Deskripsi', { required: true, maxLength: 2000, hint: 'Jangan tulis kata sandi atau license key.' }),
  ],
});

// GET …/tasks/:taskId/options while a dialog that needs it is open.
function useTaskOptions(workflowId, task, enabled) {
  const [state, setState] = useState({ data: null, loading: false, error: '' });
  useEffect(() => {
    if (!enabled || !task) return undefined;
    let active = true;
    setState({ data: null, loading: true, error: '' });
    api.get(`${taskUrl(workflowId, task.id)}/options`)
      .then((r) => { if (active) setState({ data: r.data.data || {}, loading: false, error: '' }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: apiErrorMessage(error, 'Pilihan gagal dimuat.') }); });
    return () => { active = false; };
  }, [workflowId, task, enabled]);
  return state;
}

// Shared shape: a small form Modal posting one body, the server's message on
// failure inside the dialog.
function TaskFormModal({ open, title, size = 'sm', submitLabel, saving, disabled, formId, onClose, onSubmit, children }) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={title}
      size={size}
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          {submitLabel ? <Button type="submit" form={formId} loading={saving} disabled={disabled}>{submitLabel}</Button> : null}
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={onSubmit} noValidate>{children}</form>
    </Modal>
  );
}

function usePost(onDone) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const run = async (request, success, fallback) => {
    setSaving(true);
    setError('');
    try {
      const response = await request();
      toast(success, 'success');
      await onDone?.(response.data?.data || {});
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, setError, run };
}

// Serahkan perangkat: a Cadangan device from the task's options + expected return.
export function DeviceHandoverDialog({ open, workflowId, task, employeeName, onClose, onDone }) {
  const formId = useId();
  const options = useTaskOptions(workflowId, task, open);
  const [deviceId, setDeviceId] = useState('');
  const [expected, setExpected] = useState('');
  const [fieldError, setFieldError] = useState('');
  const post = usePost(onDone);
  useEffect(() => { if (open) { setDeviceId(''); setExpected(''); setFieldError(''); post.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const devices = options.data?.devices || [];
  const ai = usePrakasaAIForm(AI_DEVICE_HANDOVER, {
    enabled: open && Boolean(task),
    ready: !options.loading,
    values: { deviceId, expectedReturnDate: expected },
    setters: { deviceId: (value) => { setDeviceId(value); setFieldError(''); }, expectedReturnDate: setExpected },
    initialValues: { deviceId: '', expectedReturnDate: '' },
    context: { devices: deviceChoices(devices) },
  });
  const submit = (event) => {
    event.preventDefault();
    if (!deviceId) { setFieldError('Pilih perangkat.'); return; }
    post.run(
      () => api.post(`${taskUrl(workflowId, task.id)}/device-handover`, { deviceId: Number(deviceId), ...(expected ? { expectedReturnDate: expected } : {}) }),
      'Perangkat diserahkan',
      'Perangkat gagal diserahkan.',
    );
  };
  return (
    <TaskFormModal open={open} title="Serahkan perangkat" size="md" submitLabel="Serahkan perangkat" saving={post.saving} formId={formId} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      <p className="hrga-dialog-intro">{`Perangkat untuk ${employeeName || 'karyawan ini'}. Hanya perangkat berstatus Cadangan yang bisa dipilih.`}</p>
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      {options.loading ? <LoadingState compact label="Memuat perangkat" /> : (
        <Select
          label="Perangkat"
          required
          placeholder={devices.length ? 'Pilih perangkat' : 'Tidak ada perangkat Cadangan'}
          value={deviceId}
          {...ai.field('deviceId')}
          error={fieldError || options.error || undefined}
          onChange={(event) => { setDeviceId(event.target.value); setFieldError(''); }}
          options={devices.map((d) => ({ value: String(d.id), label: deviceOptionLabel(d) }))}
          dataOptions
        />
      )}
      <DateInput label="Rencana kembali" value={expected} {...ai.field('expectedReturnDate')} onChange={(event) => setExpected(event.target.value)} hint="Opsional. Kosongkan untuk perangkat kerja tetap." />
    </TaskFormModal>
  );
}

// Terima kembali: condition + note; Kurang/Rusak → device status Rusak.
export function DeviceReturnTaskDialog({ open, workflowId, task, onClose, onDone }) {
  const formId = useId();
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');
  const post = usePost(onDone);
  useEffect(() => { if (open) { setCondition('good'); setNotes(''); post.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ai = usePrakasaAIForm(AI_DEVICE_RETURN, {
    enabled: open && Boolean(task),
    values: { conditionOnReturn: condition, notes },
    setters: { conditionOnReturn: setCondition, notes: setNotes },
    initialValues: { conditionOnReturn: 'good', notes: '' },
  });
  const submit = (event) => {
    event.preventDefault();
    post.run(
      () => api.post(`${taskUrl(workflowId, task.id)}/device-return`, { conditionOnReturn: condition, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      'Perangkat diterima kembali',
      'Perangkat gagal diterima kembali.',
    );
  };
  return (
    <TaskFormModal open={open} title="Terima kembali perangkat" submitLabel="Terima kembali" saving={post.saving} formId={formId} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      {task?.linkedDeviceName ? <p data-no-translate="" className="hrga-dialog-intro">{task.linkedDeviceName}</p> : null}
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      <Select label="Kondisi" options={optionsFrom(CONDITION_LABELS)} value={condition} {...ai.field('conditionOnReturn')} onChange={(event) => setCondition(event.target.value)} hint="Kurang atau Rusak → status Rusak; lainnya → Cadangan." />
      <Textarea label="Catatan" rows={2} maxLength={500} value={notes} {...ai.field('notes')} onChange={(event) => setNotes(event.target.value)} />
    </TaskFormModal>
  );
}

// Berikan lisensi: a free seat of the task's subscription.
export function LicenseAssignDialog({ open, workflowId, task, onClose, onDone }) {
  const formId = useId();
  const options = useTaskOptions(workflowId, task, open);
  const [licenseId, setLicenseId] = useState('');
  const [fieldError, setFieldError] = useState('');
  const post = usePost(onDone);
  useEffect(() => { if (open) { setLicenseId(''); setFieldError(''); post.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = licenseOptions(options.data?.licenses, task?.linkedSubscriptionId);
  const ai = usePrakasaAIForm(AI_LICENSE_ASSIGN, {
    enabled: open && Boolean(task),
    ready: !options.loading,
    values: { licenseId },
    setters: { licenseId: (value) => { setLicenseId(value); setFieldError(''); } },
    initialValues: { licenseId: '' },
    context: { licenses: choices },
  });
  const submit = (event) => {
    event.preventDefault();
    if (!licenseId) { setFieldError('Pilih lisensi.'); return; }
    post.run(() => api.post(`${taskUrl(workflowId, task.id)}/license-assign`, { licenseId: Number(licenseId) }), 'Lisensi diberikan', 'Lisensi gagal diberikan.');
  };
  return (
    <TaskFormModal open={open} title="Berikan lisensi" submitLabel="Berikan lisensi" saving={post.saving} formId={formId} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      {task?.linkedSubscriptionName ? <p data-no-translate="" className="hrga-dialog-intro">{task.linkedSubscriptionName}</p> : null}
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      {options.loading ? <LoadingState compact label="Memuat lisensi" /> : (
        <Select
          label="Lisensi"
          required
          placeholder={choices.length ? 'Pilih lisensi' : 'Tidak ada lisensi kosong'}
          value={licenseId}
          {...ai.field('licenseId')}
          error={fieldError || options.error || undefined}
          onChange={(event) => { setLicenseId(event.target.value); setFieldError(''); }}
          options={choices}
          dataOptions
        />
      )}
    </TaskFormModal>
  );
}

// Serahkan nomor / Terima kembali nomor. Until the phone register exists
// (options.phoneLines === null) the dialog points to Infrastruktur IT.
export function PhoneLineDialog({ open, workflowId, task, mode = 'assign', onClose, onDone }) {
  const formId = useId();
  const options = useTaskOptions(workflowId, task, open);
  const [lineId, setLineId] = useState('');
  const [fieldError, setFieldError] = useState('');
  const post = usePost(onDone);
  useEffect(() => { if (open) { setLineId(''); setFieldError(''); post.setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const returning = mode === 'return';
  const unavailable = !options.loading && !options.error && options.data && options.data.phoneLines === null;
  const lines = options.data?.phoneLines || [];
  const submit = (event) => {
    event.preventDefault();
    if (returning) {
      post.run(() => api.post(`${taskUrl(workflowId, task.id)}/phone-line-return`, {}), 'Nomor diterima kembali', 'Nomor gagal diterima kembali.');
      return;
    }
    if (!lineId) { setFieldError('Pilih nomor.'); return; }
    post.run(() => api.post(`${taskUrl(workflowId, task.id)}/phone-line`, { phoneLineId: Number(lineId) }), 'Nomor diserahkan', 'Nomor gagal diserahkan.');
  };
  const title = returning ? 'Terima kembali nomor' : 'Serahkan nomor';
  return (
    <TaskFormModal
      open={open}
      title={title}
      submitLabel={unavailable || options.loading ? null : title}
      saving={post.saving}
      formId={formId}
      onClose={onClose}
      onSubmit={submit}
    >
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      {options.loading ? <LoadingState compact label="Memuat nomor" /> : null}
      {options.error ? <Banner tone="error">{options.error}</Banner> : null}
      {unavailable ? (
        <Banner tone="info" action={<Button variant="text" to="/it/infrastructure">Buka Infrastruktur IT</Button>}>
          Register nomor telepon dan HP perusahaan belum tersedia. Catat nomornya di Infrastruktur IT, lalu kembali ke sini.
        </Banner>
      ) : null}
      {!options.loading && !unavailable && !options.error && returning ? (
        <p className="hrga-dialog-intro">{`${task?.linkedPhoneLineLabel || 'Nomor perusahaan'} dikembalikan dan dilepas dari karyawan ini.`}</p>
      ) : null}
      {!options.loading && !unavailable && !options.error && !returning ? (
        <Select
          label="Nomor"
          required
          placeholder={lines.length ? 'Pilih nomor' : 'Tidak ada nomor cadangan'}
          value={lineId}
          error={fieldError || undefined}
          onChange={(event) => { setLineId(event.target.value); setFieldError(''); }}
          options={lines.map((l) => ({ value: String(l.id), label: l.label }))}
          dataOptions
        />
      ) : null}
    </TaskFormModal>
  );
}

// Offboarding licence task: the access is removed in the vendor portal by IT,
// confirmed here; the app records the seat as released (it changes nothing at
// the vendor) — the same clarity as the Google account tasks.
export function LicenseRevokeDialog({ open, workflowId, task, employeeName, onClose, onDone }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setChecked(false); setError(''); } }, [open]);
  const confirm = async () => {
    if (!checked) { setError('Centang konfirmasi dulu.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post(`${taskUrl(workflowId, task.id)}/license-revoke`, { confirmedAtVendor: true });
      toast('Pencabutan lisensi dicatat', 'success');
      await onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, 'Pencabutan lisensi gagal dicatat.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      tone="primary"
      title="Catat pencabutan lisensi?"
      confirmLabel="Catat pencabutan"
      loading={saving}
      onClose={onClose}
      onConfirm={confirm}
      message={(
        <div className="pw-stack pw-stack--sm">
          <span>{`Cabut akses ${task?.linkedSubscriptionName || 'lisensi'} milik ${employeeName || 'karyawan ini'} di portal vendor. Setelah dicatat, seat tersedia di Workspace. Aplikasi tidak mengubah akun di vendor.`}</span>
          <Checkbox label="Akses sudah dicabut di portal vendor" checked={checked} onChange={(event) => { setChecked(event.target.checked); setError(''); }} />
          {error ? <span className="hrga-error-text" role="alert">{error}</span> : null}
        </div>
      )}
    />
  );
}

// Google account tasks: done in the admin console, confirmed here.
export function GoogleCompleteDialog({ open, workflowId, task, onClose, onDone }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setChecked(false); setError(''); } }, [open]);
  const confirm = async () => {
    if (!checked) { setError('Centang konfirmasi dulu.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.patch(taskUrl(workflowId, task.id), { status: 'completed', confirmedInAdminConsole: true });
      toast('Tugas ditandai selesai', 'success');
      await onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, 'Tugas gagal diperbarui.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ConfirmDialog
      open={open}
      tone="primary"
      title="Tandai selesai?"
      confirmLabel="Tandai selesai"
      loading={saving}
      onClose={onClose}
      onConfirm={confirm}
      message={(
        <div className="pw-stack pw-stack--sm">
          <span>{`${task?.title || 'Tugas ini'} dikerjakan di konsol admin Google. Aplikasi tidak mengubah akun Google.`}</span>
          <Checkbox label="Sudah dilakukan di konsol admin Google" checked={checked} onChange={(event) => { setChecked(event.target.checked); setError(''); }} />
          {error ? <span className="hrga-error-text" role="alert">{error}</span> : null}
        </div>
      )}
    />
  );
}

// Tugaskan ke…: an app user, or nobody.
export function AssignDialog({ open, workflowId, task, users, onClose, onDone }) {
  const formId = useId();
  const [userId, setUserId] = useState('');
  const post = usePost(onDone);
  useEffect(() => { if (open) { setUserId(task?.responsibleUserId ? String(task.responsibleUserId) : ''); post.setError(''); } }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps
  const ai = usePrakasaAIForm(AI_TASK_ASSIGN, {
    enabled: open && Boolean(task),
    ready: (users || []).length > 0,
    record: { type: 'hrga_task', id: task?.id },
    values: { responsibleUserId: userId },
    setters: { responsibleUserId: setUserId },
    initialValues: { responsibleUserId: task?.responsibleUserId ? String(task.responsibleUserId) : '' },
    context: { users: userChoices(users) },
  });
  const submit = (event) => {
    event.preventDefault();
    post.run(
      () => api.patch(`${taskUrl(workflowId, task.id)}/assign`, { responsibleUserId: userId ? Number(userId) : null }),
      userId ? 'Penanggung jawab diubah' : 'Penanggung jawab dikosongkan',
      'Penanggung jawab gagal diubah.',
    );
  };
  return (
    <TaskFormModal open={open} title="Tugaskan ke" submitLabel="Simpan" saving={post.saving} formId={formId} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      {task ? <p className="hrga-dialog-intro">{task.title}</p> : null}
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      <Select label="Penanggung jawab" placeholder="Belum ada penanggung jawab" value={userId} {...ai.field('responsibleUserId')} onChange={(event) => setUserId(event.target.value)} options={userOptions(users)} dataOptions hint="Orang yang dipilih menerima notifikasi tugas ini." />
    </TaskFormModal>
  );
}

// The ticket dialog as it opens: category from the task, title from task + employee.
const itTicketValues = (task, employeeName) => ({
  category: task?.category === 'device_handover' ? 'new_device_request' : 'access_software',
  title: [task?.title, employeeName].filter(Boolean).join(' — ').slice(0, 150),
  description: '',
});

// Buat tiket IT from an IT task (category, title, description).
export function ItTicketDialog({ open, workflowId, task, employeeName, onClose, onDone }) {
  const formId = useId();
  const [values, setValues] = useState({ category: 'new_device_request', title: '', description: '' });
  const [errors, setErrors] = useState({});
  const post = usePost(onDone);
  useEffect(() => {
    if (!open || !task) return;
    setValues(itTicketValues(task, employeeName));
    setErrors({}); post.setError('');
  }, [open, task, employeeName]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (field) => (event) => { const value = event.target.value; setValues((v) => ({ ...v, [field]: value })); setErrors((e) => ({ ...e, [field]: undefined })); };
  const ai = usePrakasaAIForm(AI_TASK_IT_TICKET, {
    enabled: open && Boolean(task),
    values,
    setValues,
    setErrors,
    initialValues: itTicketValues(task, employeeName),
  });
  const submit = (event) => {
    event.preventDefault();
    const found = {};
    if (!values.title.trim()) found.title = 'Judul wajib diisi.';
    if (!values.description.trim()) found.description = 'Jelaskan kebutuhannya.';
    setErrors(found);
    if (Object.keys(found).length) return;
    post.run(
      () => api.post(`${taskUrl(workflowId, task.id)}/it-ticket`, { category: values.category, title: values.title.trim(), description: values.description.trim() }),
      'Tiket IT dibuat',
      'Tiket IT gagal dibuat.',
    );
  };
  return (
    <TaskFormModal open={open} title="Buat tiket IT" size="md" submitLabel="Buat tiket" saving={post.saving} formId={formId} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      {post.error ? <Banner tone="error">{post.error}</Banner> : null}
      <Select label="Kategori" options={optionsFrom(IT_TICKET_CATEGORY_LABELS)} value={values.category} {...ai.field('category')} onChange={set('category')} />
      <Input label="Judul" required maxLength={150} value={values.title} {...ai.field('title')} error={errors.title} onChange={set('title')} />
      <Textarea label="Deskripsi" required rows={4} maxLength={2000} value={values.description} {...ai.field('description')} error={errors.description} onChange={set('description')} hint={errors.description ? undefined : 'Jangan tulis kata sandi atau license key.'} />
    </TaskFormModal>
  );
}
