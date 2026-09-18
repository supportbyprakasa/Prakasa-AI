import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function SignatureRules() {
  const [rows, setRows] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/signature-rules'),
      api.get('/document-types', { params: { activeOnly: '1' } }).catch(() => ({ data: { data: [] } })),
      api.get('/roles').catch(() => ({ data: { data: [] } })),
      api.get('/forms').catch(() => ({ data: { data: [] } })),
    ])
      .then(([r1, r2, r3, r4]) => {
        setRows(r1.data.data || []);
        setDocTypes(r2.data.data || []);
        setRoles(r3.data.data || []);
        setForms(r4.data.data || []);
      })
      .catch((e) => toast(e.response?.data?.error?.message || 'Gagal memuat', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      documentTypeId: fd.get('documentTypeId') ? Number(fd.get('documentTypeId')) : null,
      appliesToFormId: fd.get('appliesToFormId') ? Number(fd.get('appliesToFormId')) : null,
      minApprovalLevel: Number(fd.get('minApprovalLevel') || 1),
      requiredSignerRoleId: fd.get('requiredSignerRoleId') ? Number(fd.get('requiredSignerRoleId')) : null,
      requiredSignerUserId: fd.get('requiredSignerUserId') ? Number(fd.get('requiredSignerUserId')) : null,
      requiresAiPrecheck: fd.get('requiresAiPrecheck') === 'on',
      allowDelegation: fd.get('allowDelegation') === 'on',
      autoGenerateVerificationCode: fd.get('autoGenerateVerificationCode') === 'on',
      archiveFolderDriveId: fd.get('archiveFolderDriveId') || null,
      isActive: fd.get('isActive') === 'on',
    };

    try {
      if (editing) {
        await api.patch(`/signature-rules/${editing.id}`, payload);
        toast('Signature rule diperbarui', 'success');
      } else {
        await api.post('/signature-rules', payload);
        toast('Signature rule dibuat', 'success');
      }
      setOpen(false); load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/signature-rules/${del.id}`);
      toast('Dihapus', 'success');
      setDel(null); load();
    } catch (e) {
      toast(e.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Signature Rules</h2>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus size={14} /> Rule Baru
        </Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada signature rule"
        columns={[
          { key: 'documentTypeName', title: 'Document Type',
            render: (r) => r.documentTypeName || '—' },
          { key: 'formName', title: 'Form', render: (r) => r.formName || '—' },
          { key: 'minApprovalLevel', title: 'Min Level' },
          { key: 'requiredSignerRoleName', title: 'Signer Role',
            render: (r) => r.requiredSignerRoleName || '—' },
          { key: 'requiredSignerUserName', title: 'Signer User',
            render: (r) => r.requiredSignerUserName || '—' },
          {
            key: 'requiresAiPrecheck', title: 'AI Precheck',
            render: (r) => r.requiresAiPrecheck ? <Badge tone="info">Ya</Badge> : '—',
          },
          {
            key: 'isActive', title: 'Status',
            render: (r) => r.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Nonaktif</Badge>,
          },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="secondary" onClick={() => { setEditing(r); setOpen(true); }}>
                  <Pencil size={14} />
                </Button>
                <Button variant="danger" onClick={() => setDel(r)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit Signature Rule' : 'Signature Rule Baru'}>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Document Type</label>
            <select name="documentTypeId" defaultValue={editing?.documentTypeId || ''}
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="">—</option>
              {docTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Applies To Form</label>
            <select name="appliesToFormId" defaultValue={editing?.appliesToFormId || ''}
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="">—</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          <Input label="Min Approval Level" name="minApprovalLevel" type="number"
            defaultValue={editing?.minApprovalLevel ?? 1} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Required Signer Role</label>
              <select name="requiredSignerRoleId" defaultValue={editing?.requiredSignerRoleId || ''}
                style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="">—</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <Input label="Required Signer User ID" name="requiredSignerUserId" type="number"
              defaultValue={editing?.requiredSignerUserId || ''} />
          </div>

          <Input label="Archive Folder Drive ID" name="archiveFolderDriveId"
            defaultValue={editing?.archiveFolderDriveId || ''} />

          <div style={{ display: 'flex', gap: 16, marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="isActive"
                defaultChecked={editing ? !!editing.isActive : true} />
              Aktif
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="requiresAiPrecheck"
                defaultChecked={editing ? !!editing.requiresAiPrecheck : true} />
              AI precheck
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="allowDelegation"
                defaultChecked={editing ? !!editing.allowDelegation : true} />
              Allow delegation
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" name="autoGenerateVerificationCode"
                defaultChecked={editing ? !!editing.autoGenerateVerificationCode : true} />
              Auto generate verification code
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!del}
        title="Hapus signature rule?"
        message="Rule ini akan dinonaktifkan dan di-soft-delete."
        confirmLabel="Ya, nonaktifkan"
        onConfirm={doDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}
