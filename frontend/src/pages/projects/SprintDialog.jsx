import { Context } from '../../i18n/NoTranslate';
import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import Banner from '../../components/Banner';
import { toast } from '../../components/Toast';
import { addDaysIso, apiErrorMessage, dateOnly, plannedSprints, todayIso, unwrap } from './trackerModel';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

const TITLES = { create: 'Buat sprint', edit: 'Ubah sprint', start: 'Mulai sprint', complete: 'Selesaikan sprint' };
const SUBMIT = { create: 'Buat sprint', edit: 'Simpan perubahan', start: 'Mulai sprint', complete: 'Selesaikan sprint' };

const EMPTY_SPRINT = { name: '', goal: '', startDate: '', endDate: '', moveOpenIssuesTo: 'backlog' };

// The dialog's own checks for a sprint's name and dates (not for "complete").
function sprintErrors(form) {
  const found = {};
  if (!String(form.name || '').trim()) found.name = 'Nama sprint wajib diisi.';
  if (form.startDate && form.endDate && form.endDate < form.startDate) found.endDate = 'Tanggal selesai harus setelah tanggal mulai.';
  return found;
}

// Prakasa AI may fill a new sprint or change a planned one; the user presses
// the dialog's own button (docs/prakasa-ai-rencana.md §9.9). Starting and
// completing a sprint change its status — decisions, so those two modes are
// not registered.
const SPRINT_FIELDS = [
  f.text('name', 'Nama sprint', { required: true, maxLength: 100 }),
  f.textarea('goal', 'Tujuan sprint', { maxLength: 500 }),
  f.date('startDate', 'Mulai'),
  f.date('endDate', 'Selesai'),
];
const AI_SPRINT = defineAIForm({
  id: 'tracker-sprint',
  title: 'Buat sprint',
  permission: 'google.chat.use',
  submitLabel: 'Buat sprint',
  fields: SPRINT_FIELDS,
});
const AI_SPRINT_EDIT = defineAIForm({
  id: 'tracker-sprint-edit',
  title: 'Ubah sprint',
  permission: 'google.chat.use',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: SPRINT_FIELDS,
});

// mode: create | edit | start | complete. Completing asks where unfinished issues go.
export default function SprintDialog({ open, mode, sprint, project, issues, onClose, onSaved }) {
  const formId = useId();
  const [form, setForm] = useState(EMPTY_SPRINT);
  // The values the dialog opened with: what counts as "not typed by the user" for Prakasa AI.
  const [opened, setOpened] = useState(EMPTY_SPRINT);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = todayIso();
    const count = (project?.sprints || []).length + 1;
    setError('');
    setFieldErrors({});
    const next = {
      name: sprint?.name || `${project?.key || 'Sprint'} Sprint ${count}`,
      goal: sprint?.goal || '',
      startDate: dateOnly(sprint?.startDate) || (mode === 'start' || mode === 'create' ? today : ''),
      endDate: dateOnly(sprint?.endDate) || (mode === 'start' || mode === 'create' ? addDaysIso(today, 14) : ''),
      moveOpenIssuesTo: 'backlog',
    };
    setForm(next);
    setOpened(next);
  }, [open, mode, sprint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ai = usePrakasaAIForm(mode === 'edit' ? AI_SPRINT_EDIT : AI_SPRINT, {
    enabled: open && (mode === 'create' || (mode === 'edit' && Boolean(sprint))),
    record: { type: 'tracker_sprint', id: sprint?.id },
    values: form,
    setValues: setForm,
    setErrors: setFieldErrors,
    validate: sprintErrors,
    initialValues: opened,
  });

  const openIssues = useMemo(
    () => (sprint ? (issues || []).filter((i) => i.sprintId === sprint.id && i.status !== 'done') : []),
    [issues, sprint],
  );
  const moveOptions = useMemo(() => [
    { value: 'backlog', label: 'Backlog', translate: true },
    ...plannedSprints(project).filter((s) => s.id !== sprint?.id).map((s) => ({ value: String(s.id), label: s.name })),
  ], [project, sprint]);

  const set = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    if (fieldErrors[name]) setFieldErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const found = mode === 'complete' ? {} : sprintErrors(form);
    setFieldErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const dates = { startDate: form.startDate || null, endDate: form.endDate || null };
      let response;
      if (mode === 'create') {
        response = await api.post(`/tracker/projects/${project.id}/sprints`, { name, goal: form.goal.trim() || undefined, ...dates });
      } else if (mode === 'complete') {
        const target = form.moveOpenIssuesTo === 'backlog' ? 'backlog' : Number(form.moveOpenIssuesTo);
        response = await api.patch(`/tracker/sprints/${sprint.id}`, { status: 'completed', moveOpenIssuesTo: target });
      } else {
        response = await api.patch(`/tracker/sprints/${sprint.id}`, {
          name, goal: form.goal.trim(), ...dates, ...(mode === 'start' ? { status: 'active' } : {}),
        });
      }
      toast({ create: 'Sprint dibuat', edit: 'Sprint disimpan', start: 'Sprint dimulai', complete: 'Sprint selesai' }[mode], 'success');
      onSaved?.(unwrap(response).sprint);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Sprint gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={TITLES[mode] || 'Sprint'}
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{SUBMIT[mode]}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {ai.notice}
        {mode === 'complete' ? (
          <>
            <p className="tracker-dialog__text">
              <span data-no-translate="" className="pw-strong">{sprint?.name}</span> punya {openIssues.length} issue yang belum selesai.
              {openIssues.length ? ' Pilih ke mana issue tersebut dipindahkan.' : ' Semua issue sudah selesai.'}
            </p>
            {openIssues.length ? (
              <Select label="Pindahkan issue terbuka ke" value={form.moveOpenIssuesTo} onChange={set('moveOpenIssuesTo')} options={moveOptions} dataOptions />
            ) : null}
          </>
        ) : (
          <>
            <Input label="Nama sprint" required value={form.name} {...ai.field('name')} onChange={set('name')} error={fieldErrors.name} maxLength={100} autoFocus />
            <Textarea label="Tujuan sprint" value={form.goal} {...ai.field('goal')} onChange={set('goal')} rows={2} maxLength={500} />
            <div className="pw-form-grid">
              <Context name="period"><DateInput label="Mulai" value={form.startDate} {...ai.field('startDate')} onChange={set('startDate')} /></Context>
              <Context name="period"><DateInput label="Selesai" value={form.endDate} {...ai.field('endDate')} onChange={set('endDate')} error={fieldErrors.endDate} min={form.startDate || undefined} /></Context>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
