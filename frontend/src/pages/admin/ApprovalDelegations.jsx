import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import DateInput from '../../components/DateInput';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { UserSelect } from '../../components/UserRoleSelects';
import './admin-editors.css';
import { Translate } from '../../i18n/NoTranslate';

const FORM_ID = 'approval-delegation-form';

// Retired route (navigation.js BLOCKED_ROUTES); kept on the shared components
// so it looks like the rest of Administrasi if it is opened again.
export default function ApprovalDelegations() {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formTarget, setFormTarget] = useState(null);
  const [formSaving, setFormSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [delegationsRes, usersRes, docTypesRes] = await Promise.all([
        api.get('/approval-delegations'),
        api.get('/users', { params: { limit: 100 } }).catch(() => ({ data: { data: [] } })),
        api.get('/document-types').catch(() => ({ data: { data: [] } })),
      ]);

      setRows(delegationsRes.data.data || []);
      setUsers(usersRes.data.data || []);
      setDocTypes(docTypesRes.data.data || []);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Delegasi tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/approval-delegations/${deleteTarget.id}`);
      toast('Delegasi dihapus', 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Delegasi gagal dihapus.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const closeForm = () => { if (!formSaving) setFormTarget(null); };
  const editingRow = formTarget?.mode === 'edit' ? formTarget.row : null;

  const columns = [
    { key: 'fromUserName', header: 'Dari' },
    { key: 'toUserName', header: 'Ke' },
    { key: 'appliesToRequestType', header: 'Jenis permintaan', render: (row) => row.appliesToRequestType || <Translate>Semua</Translate> },
    { key: 'appliesToDocumentTypeName', header: 'Tipe dokumen', translate: true, render: (row) => row.appliesToDocumentTypeName || 'Semua' },
    { key: 'startsAt', header: 'Mulai', type: 'datetime' },
    { key: 'endsAt', header: 'Berakhir', type: 'datetime' },
    { key: 'isActive', header: 'Status', render: (row) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Approval Delegations"
        description="Delegasi approver berlaku hanya pada entitas, cakupan, dan periode yang diatur."
        actions={<Button icon="add" onClick={() => setFormTarget({ mode: 'create' })}>Tambah delegasi</Button>}
      />

      <DataGrid
        title="Semua delegasi"
        exportName="delegasi-approval"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="Belum ada delegasi approval"
        onRowClick={(row) => setFormTarget({ mode: 'edit', row })}
        rowActions={(row) => (
          <>
            <IconButton size="sm" icon="edit" label="Ubah" onClick={() => setFormTarget({ mode: 'edit', row })} />
            <IconButton size="sm" icon="delete" label="Hapus" tone="danger" onClick={() => setDeleteTarget(row)} />
          </>
        )}
      />

      <FullScreenDialog
        open={Boolean(formTarget)}
        onClose={closeForm}
        title={editingRow ? 'Ubah delegasi' : 'Tambah delegasi'}
        card={false}
        actions={(
          <>
            <Button variant="text" type="button" onClick={closeForm} disabled={formSaving}>Batal</Button>
            <Button type="submit" form={FORM_ID} loading={formSaving}>Simpan delegasi</Button>
          </>
        )}
      >
        {formTarget ? (
          <DelegationForm
            key={editingRow?.id || 'new'}
            editing={editingRow}
            users={users}
            docTypes={docTypes}
            onSavingChange={setFormSaving}
            onSaved={async () => {
              setFormTarget(null);
              await load();
            }}
          />
        ) : null}
      </FullScreenDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus delegasi?"
        message={`Delegasi ${deleteTarget?.fromUserName || ''} → ${deleteTarget?.toUserName || ''} akan dinonaktifkan dan dihapus.`}
        confirmLabel="Hapus delegasi"
        loading={deleting}
        onConfirm={remove}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
      />
    </Page>
  );
}

function DelegationForm({ editing, users, docTypes, onSavingChange, onSaved }) {
  const [form, setForm] = useState({
    fromUserId: editing?.fromUserId || '',
    toUserId: editing?.toUserId || '',
    appliesToRequestType: editing?.appliesToRequestType || '',
    appliesToDocumentTypeId: editing?.appliesToDocumentTypeId || '',
    startsAt: editing?.startsAt ? toLocalInput(editing.startsAt) : '',
    endsAt: editing?.endsAt ? toLocalInput(editing.endsAt) : '',
    reason: editing?.reason || '',
    isActive: editing ? Boolean(editing.isActive) : true,
  });
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!editing && !form.fromUserId) nextErrors.fromUserId = 'Pilih pengguna asal.';
    if (!editing && !form.toUserId) nextErrors.toUserId = 'Pilih pengguna penerima.';
    if (!editing && form.fromUserId && String(form.fromUserId) === String(form.toUserId)) {
      nextErrors.toUserId = 'Delegasi ke diri sendiri tidak diperbolehkan.';
    }
    if (!form.endsAt) nextErrors.endsAt = 'Isi waktu berakhir.';

    const startsAt = form.startsAt
      ? new Date(form.startsAt)
      : editing
        ? new Date(editing.startsAt)
        : new Date();
    const endsAt = new Date(form.endsAt);
    if (form.endsAt && (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime())) {
      nextErrors.endsAt = 'Waktu berakhir harus setelah waktu mulai.';
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const payload = {
      appliesToRequestType: form.appliesToRequestType.trim() || null,
      appliesToDocumentTypeId: form.appliesToDocumentTypeId
        ? Number(form.appliesToDocumentTypeId)
        : null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason: form.reason.trim() || null,
    };

    onSavingChange(true);
    try {
      if (editing) {
        await api.patch(`/approval-delegations/${editing.id}`, {
          ...payload,
          isActive: Boolean(form.isActive),
        });
        toast('Delegasi diperbarui', 'success');
      } else {
        await api.post('/approval-delegations', {
          ...payload,
          fromUserId: Number(form.fromUserId),
          toUserId: Number(form.toUserId),
        });
        toast('Delegasi dibuat', 'success');
      }
      onSavingChange(false);
      onSaved();
    } catch (error) {
      onSavingChange(false);
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Delegasi gagal disimpan.'), 'error');
    }
  };

  return (
    <form id={FORM_ID} className="admin-dialog-form" onSubmit={save} noValidate>
      <FullScreenSection title="Pengguna">
        {editing ? (
          <KeyValue
            items={[
              { label: 'Dari', value: editing.fromUserName },
              { label: 'Ke', value: editing.toUserName },
            ]}
          />
        ) : (
          <div className="pw-fsdialog__fields">
            <UserSelect label="Dari pengguna" required placeholder="Pilih pengguna" value={form.fromUserId} error={errors.fromUserId} onChange={(value) => set('fromUserId', value)} users={users} />
            <UserSelect label="Ke pengguna" required placeholder="Pilih pengguna" value={form.toUserId} error={errors.toUserId} onChange={(value) => set('toUserId', value)} users={users} />
          </div>
        )}
      </FullScreenSection>

      <FullScreenSection title="Cakupan dan periode">
        <div className="pw-fsdialog__fields">
          <Input
            label="Jenis permintaan"
            mono
            value={form.appliesToRequestType}
            hint="Kosongkan untuk semua jenis."
            onChange={(event) => set('appliesToRequestType', event.target.value)}
          />
          <Select
            label="Tipe dokumen"
            value={form.appliesToDocumentTypeId || ''}
            onChange={(event) => set('appliesToDocumentTypeId', event.target.value)}
            placeholder="Semua tipe dokumen"
            options={docTypes.map((item) => ({ value: item.id, label: item.name }))}
          />
          <DateInput
            label="Mulai"
            type="datetime-local"
            value={form.startsAt}
            error={errors.startsAt}
            hint="Kosongkan untuk mulai sekarang."
            onChange={(event) => set('startsAt', event.target.value)}
          />
          <DateInput
            label="Berakhir"
            required
            type="datetime-local"
            value={form.endsAt}
            error={errors.endsAt}
            onChange={(event) => set('endsAt', event.target.value)}
          />
          <Input
            label="Alasan"
            value={form.reason}
            error={errors.reason}
            onChange={(event) => set('reason', event.target.value)}
          />
        </div>
        {editing ? <Checkbox label="Delegasi aktif" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} /> : null}
      </FullScreenSection>
    </form>
  );
}

function toLocalInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
