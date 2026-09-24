import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataTable from '../../components/DataTable';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import { RoleSelect, UserSelect } from '../../components/UserRoleSelects';
import { toast } from '../../components/Toast';

export default function SignatureRules() {
  const [rows, setRows] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formTarget, setFormTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rulesRes, docTypesRes, rolesRes, usersRes, formsRes] =
        await Promise.all([
          api.get('/signature-rules'),
          api.get('/document-types', { params: { activeOnly: '1' } }).catch(() => ({ data: { data: [] } })),
          api.get('/roles').catch(() => ({ data: { data: [] } })),
          api.get('/users', { params: { limit: 100 } }).catch(() => ({ data: { data: [] } })),
          api.get('/forms').catch(() => ({ data: { data: [] } })),
        ]);

      setRows(rulesRes.data.data || []);
      setDocTypes(docTypesRes.data.data || []);
      setRoles(rolesRes.data.data || []);
      setUsers(usersRes.data.data || []);
      setForms(formsRes.data.data || []);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memuat signature rules', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/signature-rules/${deleteTarget.id}`);
      toast('Signature rule dinonaktifkan', 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menghapus rule', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Signature Rules</h2>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: 'var(--color-text-muted)',
            }}
          >
            Atur signer, approval minimum, AI precheck, checksum, QR, delegation,
            dan archive folder per document type atau form.
          </div>
        </div>

        <Button onClick={() => setFormTarget({ mode: 'create' })}>
          <Plus size={14} />
          Rule Baru
        </Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada signature rule"
        columns={[
          {
            key: 'scope',
            title: 'Scope',
            render: (row) =>
              row.documentTypeName
                ? `Document: ${row.documentTypeName}`
                : row.formName
                  ? `Form: ${row.formName}`
                  : '—',
          },
          {
            key: 'signer',
            title: 'Signer',
            render: (row) =>
              row.requiredSignerUserName ||
              row.requiredSignerRoleName ||
              (row.requiredSignerUserId
                ? `User #${row.requiredSignerUserId}`
                : row.requiredSignerRoleId
                  ? `Role #${row.requiredSignerRoleId}`
                  : '—'),
          },
          { key: 'minApprovalLevel', title: 'Min Approval' },
          {
            key: 'requiresAiPrecheck',
            title: 'AI Precheck',
            render: (row) => (
              <Badge tone={row.requiresAiPrecheck ? 'info' : 'default'}>
                {row.requiresAiPrecheck ? 'Wajib' : 'Tidak'}
              </Badge>
            ),
          },
          {
            key: 'checksumAlgorithm',
            title: 'Checksum',
            render: (row) => <code>{row.checksumAlgorithm || 'sha256'}</code>,
          },
          {
            key: 'qrRequired',
            title: 'QR',
            render: (row) => (
              <Badge tone={row.qrRequired ? 'success' : 'default'}>
                {row.qrRequired ? 'Wajib' : 'Tidak'}
              </Badge>
            ),
          },
          {
            key: 'allowDelegation',
            title: 'Delegation',
            render: (row) => (row.allowDelegation ? 'Ya' : 'Tidak'),
          },
          {
            key: 'isActive',
            title: 'Status',
            render: (row) => (
              <Badge tone={row.isActive ? 'success' : 'default'}>
                {row.isActive ? 'Aktif' : 'Nonaktif'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (row) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  variant="secondary"
                  onClick={() => setFormTarget({ mode: 'edit', row })}
                >
                  <Pencil size={14} />
                </Button>
                <Button variant="danger" onClick={() => setDeleteTarget(row)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(formTarget)}
        onClose={() => setFormTarget(null)}
        title={
          formTarget?.mode === 'edit'
            ? 'Edit Signature Rule'
            : 'Signature Rule Baru'
        }
        maxWidth={820}
      >
        {formTarget && (
          <SignatureRuleForm
            editing={formTarget.mode === 'edit' ? formTarget.row : null}
            docTypes={docTypes}
            forms={forms}
            roles={roles}
            users={users}
            onCancel={() => setFormTarget(null)}
            onSaved={async () => {
              setFormTarget(null);
              await load();
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Nonaktifkan signature rule?"
        message="Rule akan dinonaktifkan dan di-soft-delete. Signature request yang sudah dibuat tetap menyimpan rule snapshot/reference yang sudah digunakan."
        confirmLabel="Ya, nonaktifkan"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SignatureRuleForm({
  editing,
  docTypes,
  forms,
  roles,
  users,
  onCancel,
  onSaved,
}) {
  const [form, setForm] = useState({
    documentTypeId: editing?.documentTypeId || '',
    appliesToFormId: editing?.appliesToFormId || '',
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
  const [saving, setSaving] = useState(false);

  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (Boolean(form.documentTypeId) === Boolean(form.appliesToFormId)) {
      toast('Pilih tepat satu scope: Document Type atau Form', 'error');
      return;
    }

    if (
      Boolean(form.requiredSignerRoleId) ===
      Boolean(form.requiredSignerUserId)
    ) {
      toast('Pilih tepat satu signer: User atau Role', 'error');
      return;
    }

    if (!['sha256', 'sha512'].includes(form.checksumAlgorithm)) {
      toast('Checksum algorithm tidak valid', 'error');
      return;
    }

    if (form.requiresAiPrecheck && !form.precheckModule.trim()) {
      toast('Precheck module wajib jika AI precheck aktif', 'error');
      return;
    }

    const payload = {
      documentTypeId: form.documentTypeId
        ? Number(form.documentTypeId)
        : null,
      appliesToFormId: form.appliesToFormId
        ? Number(form.appliesToFormId)
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

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/signature-rules/${editing.id}`, payload);
        toast('Signature rule diperbarui', 'success');
      } else {
        await api.post('/signature-rules', payload);
        toast('Signature rule dibuat', 'success');
      }
      onSaved();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menyimpan signature rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 12,
        }}
      >
        <Select
          label="Document Type"
          value={form.documentTypeId}
          onChange={(value) => {
            set('documentTypeId', value);
            if (value) set('appliesToFormId', '');
          }}
          allowEmpty
          options={docTypes.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />

        <Select
          label="Applies To Form"
          value={form.appliesToFormId}
          onChange={(value) => {
            set('appliesToFormId', value);
            if (value) set('documentTypeId', '');
          }}
          allowEmpty
          options={forms.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />

        <Input
          label="Min Approval Level"
          type="number"
          min="0"
          value={form.minApprovalLevel}
          onChange={(event) => set('minApprovalLevel', event.target.value)}
        />

        <UserSelect
          label="Required Signer User"
          value={form.requiredSignerUserId}
          onChange={(value) => {
            set('requiredSignerUserId', value);
            if (value) set('requiredSignerRoleId', '');
          }}
          users={users}
        />

        <RoleSelect
          label="Required Signer Role"
          value={form.requiredSignerRoleId}
          onChange={(value) => {
            set('requiredSignerRoleId', value);
            if (value) set('requiredSignerUserId', '');
          }}
          roles={roles}
        />

        <Select
          label="Checksum Algorithm"
          value={form.checksumAlgorithm}
          onChange={(value) => set('checksumAlgorithm', value)}
          options={[
            { value: 'sha256', label: 'SHA-256' },
            { value: 'sha512', label: 'SHA-512' },
          ]}
        />

        <Input
          label="AI Precheck Module"
          value={form.precheckModule}
          onChange={(event) => set('precheckModule', event.target.value)}
          disabled={!form.requiresAiPrecheck}
        />

        <Input
          label="Archive Folder Drive ID"
          value={form.archiveFolderDriveId}
          onChange={(event) =>
            set('archiveFolderDriveId', event.target.value)
          }
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 8,
          marginTop: 4,
        }}
      >
        <Checkbox
          label="AI precheck wajib"
          checked={form.requiresAiPrecheck}
          onChange={(value) => set('requiresAiPrecheck', value)}
        />
        <Checkbox
          label="Allow delegation"
          checked={form.allowDelegation}
          onChange={(value) => set('allowDelegation', value)}
        />
        <Checkbox
          label="Auto generate verification code"
          checked={form.autoGenerateVerificationCode}
          onChange={(value) => set('autoGenerateVerificationCode', value)}
        />
        <Checkbox
          label="QR verification wajib"
          checked={form.qrRequired}
          onChange={(value) => set('qrRequired', value)}
        />
        <Checkbox
          label="Rule aktif"
          checked={form.isActive}
          onChange={(value) => set('isActive', value)}
        />
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          background: '#f8fafc',
          color: 'var(--color-text-muted)',
          fontSize: 12,
        }}
      >
        AI precheck bersifat advisory. Policy signing backend yang berlaku:
        warning dapat dilanjutkan; failed/skipped membutuhkan override permission
        dan alasan eksplisit.
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16,
        }}
      >
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, allowEmpty = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          boxShadow: 'inset 0 0 0 1px var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        {allowEmpty && <option value="">—</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 7,
        alignItems: 'center',
        fontSize: 13,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
