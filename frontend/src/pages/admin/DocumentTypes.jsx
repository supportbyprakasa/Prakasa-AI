import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import './admin-editors.css';

const FORM_ID = 'document-type-form';

function formFrom(row) {
  return {
    code: row?.code || '',
    name: row?.name || '',
    category: row?.category || '',
    defaultFolderId: row?.defaultFolderId || '',
    isActive: row ? Boolean(row.isActive) : true,
    requiresSignature: Boolean(row?.requiresSignature),
    requiresAiPrecheck: Boolean(row?.requiresAiPrecheck),
  };
}

export default function DocumentTypes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(formFrom(null));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.get('/document-types')
      .then((r) => setRows(r.data.data || []))
      .catch((e) => setLoadError(apiErrorMessage(e, 'Daftar tipe dokumen tidak dapat dimuat.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEditor = (row) => {
    setEditing(row);
    setForm(formFrom(row));
    setErrors({});
    setOpen(true);
  };
  const close = () => { if (!saving) setOpen(false); };
  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!editing && !form.code.trim()) nextErrors.code = 'Isi kode tipe dokumen.';
    if (!form.name.trim()) nextErrors.name = 'Isi nama tipe dokumen.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    const payload = {
      code: form.code,
      name: form.name,
      category: form.category || null,
      defaultFolderId: form.defaultFolderId || null,
      requiresSignature: form.requiresSignature,
      requiresAiPrecheck: form.requiresAiPrecheck,
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      if (editing) {
        const { code, ...patch } = payload; // eslint-disable-line no-unused-vars
        await api.patch(`/document-types/${editing.id}`, patch);
        toast('Tipe dokumen diperbarui', 'success');
      } else {
        await api.post('/document-types', payload);
        toast('Tipe dokumen dibuat', 'success');
      }
      setOpen(false);
      load();
    } catch (error) {
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Tipe dokumen gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/document-types/${del.id}`);
      toast('Tipe dokumen dinonaktifkan', 'success');
      setDel(null);
      load();
    } catch (e) {
      toast(apiErrorMessage(e, 'Tipe dokumen gagal dinonaktifkan.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { key: 'code', header: 'Kode', render: (r) => <code data-no-translate="" className="admin-code">{r.code}</code> },
    { key: 'name', header: 'Nama', translate: true },
    { key: 'category', header: 'Kategori' },
    { key: 'requiresSignature', header: 'Tanda tangan', translate: true, render: (r) => (r.requiresSignature ? 'Wajib' : 'Tidak') },
    { key: 'requiresAiPrecheck', header: 'AI precheck', translate: true, render: (r) => (r.requiresAiPrecheck ? 'Wajib' : 'Tidak') },
    { key: 'isActive', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Jenis dokumen"
        description="Jenis dokumen, folder bawaan, dan apakah dokumen butuh tanda tangan atau cek awal AI."
        actions={<Button icon="add" onClick={() => openEditor(null)}>Tambah tipe dokumen</Button>}
      />

      <DataGrid
        title="Semua tipe dokumen"
        exportName="tipe-dokumen"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="Belum ada tipe dokumen"
        onRowClick={openEditor}
        rowActions={(r) => (
          <>
            <IconButton size="sm" icon="edit" label="Ubah" onClick={() => openEditor(r)} />
            <IconButton size="sm" icon="block" label="Nonaktifkan" tone="danger" onClick={() => setDel(r)} />
          </>
        )}
      />

      <FullScreenDialog
        open={open}
        onClose={close}
        title={editing ? `Ubah tipe dokumen ${editing.name}` : 'Tambah tipe dokumen'}
        card={false}
        actions={(
          <>
            <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
            <Button type="submit" form={FORM_ID} loading={saving}>{editing ? 'Simpan perubahan' : 'Tambah tipe dokumen'}</Button>
          </>
        )}
      >
        <form id={FORM_ID} className="admin-dialog-form" onSubmit={submit} noValidate>
          <FullScreenSection title="Informasi tipe dokumen">
            <div className="pw-fsdialog__fields">
              <Input
                label="Kode"
                mono
                value={form.code}
                error={errors.code}
                hint={editing ? 'Kode tidak bisa diubah.' : 'Contoh invoice.'}
                onChange={(event) => setField('code', event.target.value)}
                required={!editing}
                disabled={Boolean(editing)}
                autoFocus={!editing}
              />
              <Input label="Nama" value={form.name} error={errors.name} onChange={(event) => setField('name', event.target.value)} required />
              <Input label="Kategori" value={form.category} error={errors.category} onChange={(event) => setField('category', event.target.value)} />
              <Input label="ID folder Drive bawaan" mono value={form.defaultFolderId} error={errors.defaultFolderId} onChange={(event) => setField('defaultFolderId', event.target.value)} />
            </div>
          </FullScreenSection>
          <FullScreenSection title="Aturan">
            <div className="admin-choice-list">
              <Checkbox label="Aktif" checked={form.isActive} onChange={(event) => setField('isActive', event.target.checked)} />
              <Checkbox label="Butuh tanda tangan" checked={form.requiresSignature} onChange={(event) => setField('requiresSignature', event.target.checked)} />
              <Checkbox label="Butuh cek awal AI" checked={form.requiresAiPrecheck} onChange={(event) => setField('requiresAiPrecheck', event.target.checked)} />
            </div>
          </FullScreenSection>
        </form>
      </FullScreenDialog>

      <ConfirmDialog
        open={!!del}
        title="Nonaktifkan tipe dokumen?"
        message={`"${del?.name}" akan dinonaktifkan.`}
        confirmLabel="Nonaktifkan"
        loading={deleting}
        onConfirm={doDelete}
        onClose={() => { if (!deleting) setDel(null); }}
      />
    </Page>
  );
}
