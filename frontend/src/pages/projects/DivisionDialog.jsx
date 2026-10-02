import { useEffect, useId, useMemo, useState } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Button from '../../components/Button';
import Select from '../../components/Select';
import Banner from '../../components/Banner';
import { toast } from '../../components/Toast';
import { apiErrorMessage, unwrap } from './trackerModel';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

// Prakasa AI may pick the division; the user presses "Simpan"
// (docs/prakasa-ai-rencana.md §9.9).
const AI_DIVISION = defineAIForm({
  id: 'tracker-project-division',
  title: 'Divisi project',
  permission: 'google.chat.use',
  submitLabel: 'Simpan',
  mode: 'edit',
  fields: ({ options }) => [
    f.select('departmentId', 'Divisi', options, { hint: 'Menentukan di divisi mana project ini dihitung pada laporan manajemen.' }),
  ],
});

// Which division owns this project. It decides where the project shows up in
// the management report, and which Head is allowed to see it there — so it is
// worth correcting when the person who switched the tracker on sat elsewhere.
export default function DivisionDialog({ open, project, onClose, onSaved }) {
  const formId = useId();
  const [departments, setDepartments] = useState([]);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setValue(project?.departmentId ? String(project.departmentId) : '');
    api.get('/departments/options')
      .then((r) => setDepartments(unwrap(r) || []))
      .catch((err) => setError(apiErrorMessage(err, 'Daftar divisi gagal dimuat.')));
  }, [open, project?.departmentId]);

  const options = useMemo(() => [
    { value: '', label: 'Tanpa divisi' },
    ...departments.map((d) => ({ value: String(d.id), label: d.name })),
  ], [departments]);
  const loaded = useMemo(() => ({ departmentId: project?.departmentId ? String(project.departmentId) : '' }), [project?.departmentId]);
  const ai = usePrakasaAIForm(AI_DIVISION, {
    enabled: open,
    ready: departments.length > 0,
    record: { type: 'tracker_project', id: project?.id },
    values: { departmentId: value },
    setters: { departmentId: setValue },
    initialValues: loaded,
    context: { options },
  });

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const departmentId = value ? Number(value) : null;
      const data = unwrap(await api.patch(`/tracker/projects/${project.id}`, { departmentId }));
      toast(departmentId ? 'Divisi project disimpan' : 'Divisi project dikosongkan', 'success');
      onSaved?.(data.project || { ...project, departmentId });
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Divisi project gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Divisi project"
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>Simpan</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {ai.notice}
        <Select
          label="Divisi"
          hint="Menentukan di divisi mana project ini dihitung pada laporan manajemen."
          value={value}
          {...ai.field('departmentId')}
          onChange={(e) => setValue(e.target.value)}
          options={options}
        />
      </form>
    </Modal>
  );
}
