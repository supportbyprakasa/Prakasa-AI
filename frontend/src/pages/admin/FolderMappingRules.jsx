import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import { toast } from '../../components/Toast';
import './admin-editors.css';

const EMPTY_FORM = { entityId: '', departmentId: '', documentType: '', driveFolderId: '', priority: '100' };

// Entity and division show by name (the rule stores their ids); an id that
// is no longer in the list still shows, as "#id".
const nameOf = (list, id) => {
  if (id === null || id === undefined || id === '') return '';
  return list.find((item) => String(item.id) === String(id))?.name || `#${id}`;
};
const columnsFor = (entities, departments) => [
  { key: 'entityId', header: 'Entitas', render: (row) => nameOf(entities, row.entityId), sortValue: (row) => nameOf(entities, row.entityId) },
  { key: 'departmentId', header: 'Divisi', translate: true, render: (row) => (row.departmentId ? nameOf(departments, row.departmentId) : 'Semua divisi'), sortValue: (row) => nameOf(departments, row.departmentId) },
  { key: 'documentType', header: 'Tipe dokumen', render: (row) => (row.documentType ? <code className="admin-code">{row.documentType}</code> : '') },
  { key: 'driveFolderId', header: 'ID folder Drive', render: (row) => (row.driveFolderId ? <code className="admin-code">{row.driveFolderId}</code> : '') },
  { key: 'priority', header: 'Prioritas', type: 'number' },
];

function validate(form) {
  const errors = {};
  if (!form.entityId) errors.entityId = 'Pilih entitas.';
  if (!form.documentType.trim()) errors.documentType = 'Isi tipe dokumen.';
  if (!form.driveFolderId.trim()) errors.driveFolderId = 'Isi ID folder Drive.';
  return errors;
}

export default function FolderMappingRules() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [entities, setEntities] = useState([]);
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    api.get('/entities', { params: { page: 1, limit: 100 } })
      .then((r) => setEntities(r.data.data || []))
      .catch(() => setEntities([]));
    api.get('/departments', { params: { page: 1, limit: 100 } })
      .then((r) => setDepartments(r.data.data || []))
      .catch(() => setDepartments([]));
  }, []);
  const columns = useMemo(() => columnsFor(entities, departments), [entities, departments]);
  const departmentOptions = departments
    .filter((d) => !form.entityId || !d.entityId || String(d.entityId) === String(form.entityId))
    .map((d) => ({ value: d.id, label: d.name }));

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.get('/folder-mapping-rules')
      .then((r) => setRows(r.data.data || []))
      .catch((error) => setLoadError(apiErrorMessage(error, 'Daftar aturan tidak dapat dimuat.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setOpen(true);
  };
  const close = () => { if (!saving) setOpen(false); };
  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    const body = {
      entityId: Number(form.entityId),
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      documentType: form.documentType,
      driveFolderId: form.driveFolderId,
      priority: Number(form.priority || 100),
    };
    setSaving(true);
    try {
      await api.post('/folder-mapping-rules', body);
      toast('Aturan ditambahkan', 'success');
      setOpen(false);
      load();
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Aturan gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Aturan folder"
        description="Folder Shared Drive tujuan untuk setiap tipe dokumen, per entitas dan divisi."
        actions={<Button icon="add" onClick={openCreate}>Tambah aturan</Button>}
      />
      <DataGrid
        title="Semua aturan"
        exportName="folder-rules"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="Belum ada aturan folder"
      />
      <Modal open={open} onClose={close} title="Tambah aturan">
        <form className="pw-stack" onSubmit={submit} noValidate>
          <div className="pw-form-grid">
            <Select
              label="Entitas"
              placeholder="Pilih entitas"
              options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
              dataOptions
              value={form.entityId}
              error={errors.entityId}
              onChange={(event) => { setField('entityId', event.target.value); setField('departmentId', ''); }}
              required
              autoFocus
            />
            <Select
              label="Divisi"
              placeholder="Semua divisi"
              options={departmentOptions}
              hint="Opsional. Kosongkan untuk semua divisi."
              value={form.departmentId}
              error={errors.departmentId}
              onChange={(event) => setField('departmentId', event.target.value)}
            />
          </div>
          <Input label="Tipe dokumen" mono value={form.documentType} error={errors.documentType} hint="Kode tipe dokumen, contoh invoice." onChange={(event) => setField('documentType', event.target.value)} required />
          <Input label="ID folder Drive" mono value={form.driveFolderId} error={errors.driveFolderId} onChange={(event) => setField('driveFolderId', event.target.value)} required />
          <Input label="Prioritas" type="number" inputMode="numeric" hint="Angka kecil didahulukan. Default 100." value={form.priority} error={errors.priority} onChange={(event) => setField('priority', event.target.value)} />
          <FormActions>
            <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
            <Button type="submit" loading={saving}>Simpan aturan</Button>
          </FormActions>
        </form>
      </Modal>
    </Page>
  );
}
