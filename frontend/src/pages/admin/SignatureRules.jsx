import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
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
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { RoleSelect, UserSelect } from '../../components/UserRoleSelects';
import { toast } from '../../components/Toast';
import { AI_MODULE_LABELS, aiModuleLabel } from './aiLabels';
import './admin-editors.css';
import { Translate } from '../../i18n/NoTranslate';

const FORM_ID = 'signature-rule-form';

// The AI module that runs the pre-check, by its Indonesian name; a code the
// list does not know (set before) stays selectable under its own words.
function precheckModuleOptions(current) {
  const codes = Object.keys(AI_MODULE_LABELS);
  if (current && !codes.includes(current)) codes.push(current);
  return codes.map((code) => ({ value: code, label: aiModuleLabel(code), data: !AI_MODULE_LABELS[code] }));
}

export default function SignatureRules() {
  const [rows, setRows] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
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
      const [rulesRes, docTypesRes, rolesRes, usersRes] =
        await Promise.all([
          api.get('/signature-rules'),
          api.get('/document-types', { params: { activeOnly: '1' } }).catch(() => ({ data: { data: [] } })),
          api.get('/roles').catch(() => ({ data: { data: [] } })),
          api.get('/users', { params: { limit: 100 } }).catch(() => ({ data: { data: [] } })),
        ]);

      setRows(rulesRes.data.data || []);
      setDocTypes(docTypesRes.data.data || []);
      setRoles(rolesRes.data.data || []);
      setUsers(usersRes.data.data || []);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Aturan tanda tangan tidak dapat dimuat.'));
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
      await api.delete(`/signature-rules/${deleteTarget.id}`);
      toast('Aturan tanda tangan dinonaktifkan', 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Aturan gagal dinonaktifkan.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const closeForm = () => { if (!formSaving) setFormTarget(null); };
  const editingRow = formTarget?.mode === 'edit' ? formTarget.row : null;

  const columns = [
    { key: 'scope', header: 'Tipe dokumen', translate: true, render: (row) => row.documentTypeName },
    {
      key: 'signer',
      header: 'Penanda tangan',
      // A person's name is record data; a role name or the "#id" fallback is a label.
      render: (row) => {
        if (row.requiredSignerUserName) return row.requiredSignerUserName;
        const label = row.requiredSignerRoleName
          || (row.requiredSignerUserId
            ? `Pengguna #${row.requiredSignerUserId}`
            : row.requiredSignerRoleId
              ? `Peran #${row.requiredSignerRoleId}`
              : '');
        return label ? <Translate>{label}</Translate> : '';
      },
    },
    { key: 'minApprovalLevel', header: 'Approval minimum', type: 'number' },
    { key: 'requiresAiPrecheck', header: 'Cek awal AI', translate: true, render: (row) => (row.requiresAiPrecheck ? 'Wajib' : 'Tidak') },
    { key: 'checksumAlgorithm', header: 'Checksum', render: (row) => <code className="admin-code">{row.checksumAlgorithm || 'sha256'}</code> },
    { key: 'qrRequired', header: 'QR', translate: true, render: (row) => (row.qrRequired ? 'Wajib' : 'Tidak') },
    { key: 'allowDelegation', header: 'Delegasi', translate: true, render: (row) => (row.allowDelegation ? 'Ya' : 'Tidak') },
    { key: 'isActive', header: 'Status', render: (row) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Aturan tanda tangan"
        description="Atur penanda tangan, approval minimum, cek awal AI, checksum, QR, delegasi, dan folder arsip per tipe dokumen."
        actions={<Button icon="add" onClick={() => setFormTarget({ mode: 'create' })}>Tambah aturan</Button>}
      />

      <DataGrid
        title="Semua aturan"
        exportName="signature-rules"
        columns={columns}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty="Belum ada aturan tanda tangan"
        onRowClick={(row) => setFormTarget({ mode: 'edit', row })}
        rowActions={(row) => (
          <>
            <IconButton size="sm" icon="edit" label="Ubah" onClick={() => setFormTarget({ mode: 'edit', row })} />
            <IconButton size="sm" icon="block" label="Nonaktifkan" tone="danger" onClick={() => setDeleteTarget(row)} />
          </>
        )}
      />

      <FullScreenDialog
        open={Boolean(formTarget)}
        onClose={closeForm}
        title={editingRow ? 'Ubah aturan tanda tangan' : 'Tambah aturan tanda tangan'}
        card={false}
        actions={(
          <>
            <Button variant="text" type="button" onClick={closeForm} disabled={formSaving}>Batal</Button>
            <Button type="submit" form={FORM_ID} loading={formSaving}>Simpan aturan</Button>
          </>
        )}
      >
        {formTarget ? (
          <SignatureRuleForm
            key={editingRow?.id || 'new'}
            editing={editingRow}
            docTypes={docTypes}
            roles={roles}
            users={users}
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
        title="Nonaktifkan aturan tanda tangan?"
        message={`Aturan untuk ${deleteTarget?.documentTypeName || 'tipe dokumen ini'} akan dinonaktifkan. Permintaan tanda tangan yang sudah dibuat tetap menyimpan aturan yang dipakai saat itu.`}
        confirmLabel="Nonaktifkan aturan"
        loading={deleting}
        onConfirm={remove}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
      />
    </Page>
  );
}

function SignatureRuleForm({
  editing,
  docTypes,
  roles,
  users,
  onSavingChange,
  onSaved,
}) {
  const [form, setForm] = useState({
    documentTypeId: editing?.documentTypeId || '',
    minApprovalLevel: editing?.minApprovalLevel ?? 1,
    requiredSignerRoleId: editing?.requiredSignerRoleId || '',
    requiredSignerUserId: editing?.requiredSignerUserId || '',
    requiresAiPrecheck: editing ? Boolean(editing.requiresAiPrecheck) : true,
    allowDelegation: editing ? Boolean(editing.allowDelegation) : true,
    autoGenerateVerificationCode: editing
      ? Boolean(editing.autoGenerateVerificationCode)
      : true,
    qrRequired: editing ? Boolean(editing.qrRequired) : true,
    checksumAlgorithm: editing?.checksumAlgorithm || 'sha256',
    precheckModule: editing?.precheckModule || 'signature_precheck',
    archiveFolderDriveId: editing?.archiveFolderDriveId || '',
    isActive: editing ? Boolean(editing.isActive) : true,
  });
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, signer: key.startsWith('requiredSigner') ? undefined : current.signer }));
  };

  const validate = () => {
    const next = {};
    if (!form.documentTypeId) next.documentTypeId = 'Pilih tipe dokumen.';
    if (Boolean(form.requiredSignerRoleId) === Boolean(form.requiredSignerUserId)) {
      next.signer = 'Pilih tepat satu penanda tangan: pengguna atau peran.';
    }
    if (!['sha256', 'sha512'].includes(form.checksumAlgorithm)) next.checksumAlgorithm = 'Algoritma checksum tidak valid.';
    if (form.requiresAiPrecheck && !form.precheckModule.trim()) next.precheckModule = 'Pilih modul cek awal saat cek awal AI wajib.';
    return next;
  };

  const save = async (event) => {
    event.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const payload = {
      documentTypeId: form.documentTypeId
        ? Number(form.documentTypeId)
        : null,
      minApprovalLevel: Number(form.minApprovalLevel || 0),
      requiredSignerRoleId: form.requiredSignerRoleId
        ? Number(form.requiredSignerRoleId)
        : null,
      requiredSignerUserId: form.requiredSignerUserId
        ? Number(form.requiredSignerUserId)
        : null,
      requiresAiPrecheck: Boolean(form.requiresAiPrecheck),
      allowDelegation: Boolean(form.allowDelegation),
      autoGenerateVerificationCode: Boolean(
        form.autoGenerateVerificationCode
      ),
      qrRequired: Boolean(form.qrRequired),
      checksumAlgorithm: form.checksumAlgorithm,
      precheckModule: form.precheckModule.trim() || 'signature_precheck',
      archiveFolderDriveId: form.archiveFolderDriveId.trim() || null,
      isActive: Boolean(form.isActive),
    };

    onSavingChange(true);
    try {
      if (editing) {
        await api.patch(`/signature-rules/${editing.id}`, payload);
        toast('Aturan tanda tangan diperbarui', 'success');
      } else {
        await api.post('/signature-rules', payload);
        toast('Aturan tanda tangan dibuat', 'success');
      }
      onSavingChange(false);
      await onSaved();
    } catch (error) {
      onSavingChange(false);
      const fieldErrors = fieldErrorsFromApi(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(apiErrorMessage(error, 'Aturan tanda tangan gagal disimpan.'), 'error');
    }
  };

  return (
    <form id={FORM_ID} className="admin-dialog-form" onSubmit={save} noValidate>
      <FullScreenSection title="Tipe dokumen dan penanda tangan">
        <div className="pw-fsdialog__fields">
          <Select
            label="Tipe dokumen"
            required
            value={form.documentTypeId}
            error={errors.documentTypeId}
            onChange={(event) => set('documentTypeId', event.target.value)}
            placeholder="Pilih tipe dokumen"
            options={docTypes.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Input
            label="Level approval minimum"
            type="number"
            min="0"
            inputMode="numeric"
            value={form.minApprovalLevel}
            error={errors.minApprovalLevel}
            onChange={(event) => set('minApprovalLevel', event.target.value)}
          />
          <UserSelect
            label="Penanda tangan (pengguna)"
            value={form.requiredSignerUserId}
            placeholder="Tidak ada"
            error={errors.signer || errors.requiredSignerUserId}
            hint="Isi pengguna atau peran, salah satu saja."
            onChange={(value) => {
              set('requiredSignerUserId', value);
              if (value) set('requiredSignerRoleId', '');
            }}
            users={users}
          />
          <RoleSelect
            label="Penanda tangan (peran)"
            value={form.requiredSignerRoleId}
            placeholder="Tidak ada"
            error={errors.signer || errors.requiredSignerRoleId}
            onChange={(value) => {
              set('requiredSignerRoleId', value);
              if (value) set('requiredSignerUserId', '');
            }}
            roles={roles}
          />
        </div>
      </FullScreenSection>

      <FullScreenSection title="Verifikasi dan arsip">
        <div className="pw-fsdialog__fields">
          <Select
            label="Algoritma checksum"
            value={form.checksumAlgorithm}
            error={errors.checksumAlgorithm}
            onChange={(event) => set('checksumAlgorithm', event.target.value)}
            options={[
              { value: 'sha256', label: 'SHA-256' },
              { value: 'sha512', label: 'SHA-512' },
            ]}
          />
          <Select
            label="Modul cek awal AI"
            value={form.precheckModule}
            error={errors.precheckModule}
            onChange={(event) => set('precheckModule', event.target.value)}
            disabled={!form.requiresAiPrecheck}
            options={precheckModuleOptions(form.precheckModule)}
          />
          <Input
            label="ID folder arsip Drive"
            mono
            value={form.archiveFolderDriveId}
            error={errors.archiveFolderDriveId}
            onChange={(event) => set('archiveFolderDriveId', event.target.value)}
          />
        </div>
        <div className="admin-choice-list">
          <Checkbox label="Cek awal AI wajib" checked={form.requiresAiPrecheck} onChange={(event) => set('requiresAiPrecheck', event.target.checked)} />
          <Checkbox label="Izinkan delegasi" checked={form.allowDelegation} onChange={(event) => set('allowDelegation', event.target.checked)} />
          <Checkbox label="Buat kode verifikasi otomatis" checked={form.autoGenerateVerificationCode} onChange={(event) => set('autoGenerateVerificationCode', event.target.checked)} />
          <Checkbox label="Verifikasi QR wajib" checked={form.qrRequired} onChange={(event) => set('qrRequired', event.target.checked)} />
          <Checkbox label="Rule aktif" checked={form.isActive} onChange={(event) => set('isActive', event.target.checked)} />
        </div>
        <Banner tone="info">
          Cek awal AI bersifat saran. Aturan tanda tangan di server: peringatan boleh dilanjutkan; hasil gagal atau
          dilewati butuh permission override dan alasan tertulis.
        </Banner>
      </FullScreenSection>
    </form>
  );
}
