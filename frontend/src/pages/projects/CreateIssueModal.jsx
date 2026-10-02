import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import FullScreenDialog from '../../components/FullScreenDialog';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import Input from '../../components/Input';
import Select from '../../components/Select';
import Textarea from '../../components/Textarea';
import Chip from '../../components/Chip';
import Field from '../../components/Field';
import { toast } from '../../components/Toast';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { IssueTypeIcon } from './TrackerBits';
import LabelsField from './LabelsField';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  EMPTY_ISSUE_FORM, ISSUE_TYPES, PRIORITIES, activeSprintOf, allLabels, apiErrorMessage, issuePayload,
  assigneeChoices, parentOptions, plannedSprints, sortedColumns, typeLabel, validateIssueForm, unwrap,
} from './trackerModel';

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

// Prakasa AI may fill a new issue; the user reviews it and presses "Buat issue"
// (docs/prakasa-ai-rencana.md §9.9). The assignee stays with the user: saving
// with one notifies that person. A column that means "done" is the user's to
// pick, and a new label is typed by the user (the AI chooses among the
// project's existing labels).
const AI_ISSUE = defineAIForm({
  id: 'tracker-issue',
  title: 'Buat issue',
  permission: 'google.chat.use',
  submitLabel: 'Buat issue',
  fields: ({ sprintOptions, openColumnOptions, parents, labelOptions }) => [
    f.radio('type', 'Tipe', ISSUE_TYPES, { required: true }),
    f.text('title', 'Judul', { required: true, maxLength: 255 }),
    f.textarea('description', 'Deskripsi', { maxLength: 20000 }),
    f.select('priority', 'Prioritas', PRIORITY_OPTIONS),
    f.userOnly('assigneeEmail', 'Penanggung jawab', 'select'),
    f.date('startDate', 'Tanggal mulai'),
    f.date('dueDate', 'Jatuh tempo'),
    f.number('storyPoints', 'Story points', { min: 0, max: 100, step: 0.5 }),
    f.select('sprintId', 'Sprint', sprintOptions, { hint: 'Kosong: backlog.' }),
    f.select('columnId', 'Status', openColumnOptions, { hint: 'Kosong: kolom pertama board.' }),
    f.select('parentId', 'Induk (epic / parent)', parents),
    labelOptions.length
      ? f.multiselect('labels', 'Label', labelOptions, { hint: 'Hanya label yang sudah dipakai di project ini; label baru diketik pengguna.' })
      : f.userOnly('labels', 'Label'),
  ],
});

export default function CreateIssueModal({ open, onClose, project, issues, me, defaults, onCreated }) {
  const formId = useId();
  const [form, setForm] = useState(EMPTY_ISSUE_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_ISSUE_FORM, ...(defaults || {}) });
    setErrors({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sprintOptions = useMemo(() => {
    const active = activeSprintOf(project);
    return [
      ...(active ? [{ value: String(active.id), label: active.name, suffix: '(aktif)' }] : []),
      ...plannedSprints(project).map((s) => ({ value: String(s.id), label: s.name })),
    ];
  }, [project]);
  const columnOptions = useMemo(() => sortedColumns(project?.columns).map((c) => ({ value: String(c.id), label: c.name })), [project]);
  const openColumnOptions = useMemo(() => sortedColumns(project?.columns).filter((c) => c.category !== 'done').map((c) => ({ value: String(c.id), label: c.name })), [project]);
  const parents = useMemo(() => parentOptions(issues), [issues]);
  const labelSuggestions = useMemo(() => allLabels(issues), [issues]);
  const labelOptions = useMemo(() => labelSuggestions.map((label) => ({ value: label, label })), [labelSuggestions]);

  // Anything typed or picked beyond the starting values asks before discarding.
  const start = { ...EMPTY_ISSUE_FORM, ...(defaults || {}) };
  const dirty = Object.keys({ ...start, ...form }).some((key) => JSON.stringify(form[key] ?? '') !== JSON.stringify(start[key] ?? ''));

  const ai = usePrakasaAIForm(AI_ISSUE, {
    enabled: open && Boolean(project),
    values: form,
    setValues: setForm,
    setErrors,
    validate: validateIssueForm,
    initialValues: start,
    context: { sprintOptions, openColumnOptions, parents, labelOptions },
  });

  const set = (name) => (event) => {
    const value = event?.target ? event.target.value : event;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = validateIssueForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const data = unwrap(await api.post(`/tracker/projects/${project.id}/issues`, issuePayload(form)));
      toast(`${data.issue?.key || 'Issue'} dibuat`, 'success');
      onCreated?.(data.issue);
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, 'Issue gagal dibuat.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Twelve fields: the long-form dialog (docs/ui-guideline.md §3.3).
  return (
    <FullScreenDialog
      open={open}
      onClose={saving ? () => {} : onClose}
      dirty={dirty}
      title="Buat issue"
      sectionTitle="Informasi issue"
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Buat issue</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {ai.notice}
        <Field label="Tipe" {...ai.field('type')}>
          <div className="pw-row" role="group" aria-label="Tipe issue">
            {ISSUE_TYPES.map((t) => (
              <Chip key={t.value} selected={form.type === t.value} onClick={() => set('type')(t.value)}>
                <IssueTypeIcon type={t.value} withLabel />
              </Chip>
            ))}
          </div>
        </Field>
        <Input label="Judul" required value={form.title} {...ai.field('title')} onChange={set('title')} error={errors.title} maxLength={255} autoFocus placeholder={`mis. ${typeLabel(form.type) === 'Bug' ? 'Invoice tidak bisa diunduh' : 'Siapkan laporan stok bulanan'}`} />
        <Textarea label="Deskripsi" value={form.description} {...ai.field('description')} onChange={set('description')} error={errors.description} rows={4} maxLength={20000} />
        <div className="pw-form-grid">
          <Select label="Prioritas" value={form.priority} {...ai.field('priority')} onChange={set('priority')} options={PRIORITY_OPTIONS} />
          <Select label="Penanggung jawab" value={form.assigneeEmail} onChange={set('assigneeEmail')} placeholder="Belum ditugaskan" options={assigneeChoices(project, me)} dataOptions />
          <DateInput label="Tanggal mulai" value={form.startDate} {...ai.field('startDate')} onChange={set('startDate')} error={errors.startDate} max={form.dueDate || undefined} />
          <DateInput label="Jatuh tempo" value={form.dueDate} {...ai.field('dueDate')} onChange={set('dueDate')} error={errors.dueDate} min={form.startDate || undefined} />
          <Input label="Story points" type="number" min={0} max={100} step={0.5} inputMode="decimal" value={form.storyPoints} {...ai.field('storyPoints')} onChange={set('storyPoints')} error={errors.storyPoints} />
          <Select label="Sprint" value={form.sprintId} {...ai.field('sprintId')} onChange={set('sprintId')} placeholder="Backlog" options={sprintOptions} dataOptions />
          <Select label="Status" value={form.columnId} {...ai.field('columnId')} onChange={set('columnId')} placeholder="Kolom pertama" options={columnOptions} dataOptions hint="Kosong: kolom pertama board." />
          <Select
            label="Induk (epic / parent)"
            value={form.parentId}
            {...ai.field('parentId')}
            onChange={set('parentId')}
            placeholder="Tanpa induk"
            options={parents}
            dataOptions
            hint={form.type === 'subtask' ? 'Sub-task sebaiknya punya induk.' : undefined}
          />
        </div>
        <LabelsField value={form.labels} {...ai.field('labels')} onChange={set('labels')} suggestions={labelSuggestions} error={errors.labels} />
      </form>
    </FullScreenDialog>
  );
}
