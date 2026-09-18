import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataTable from '../../components/DataTable';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import { toast } from '../../components/Toast';
import { UserSelect } from '../../components/UserRoleSelects';

export default function ApprovalDelegations() {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formTarget, setFormTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
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
      toast(error.response?.data?.error?.message || 'Gagal memuat delegasi', 'error');
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
      await api.delete(`/approval-delegations/${deleteTarget.id}`);
      toast('Delegasi dihapus', 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menghapus delegasi', 'error');
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
          <h2 style={{ margin: 0 }}>Approval Delegations</h2>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: 'var(--color-text-muted)',
            }}
          >
            Delegasi approver berlaku hanya pada entity, scope, dan periode yang
            dikonfigurasi.
          </div>
        </div>
        <Button onClick={() => setFormTarget({ mode: 'create' })}>
          <Plus size={14} />
          Delegasi Baru
        </Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada approval delegation"
        columns={[
          { key: 'fromUserName', title: 'Dari' },
          { key: 'toUserName', title: 'Ke' },
          {
            key: 'appliesToRequestType',
            title: 'Request Type',
            render: (row) => row.appliesToRequestType || 'Semua',
          },
          {
            key: 'appliesToDocumentTypeName',
            title: 'Document Type',
            render: (row) => row.appliesToDocumentTypeName || 'Semua',
          },
          {
            key: 'startsAt',
            title: 'Mulai',
            render: (row) =>
              row.startsAt ? new Date(row.startsAt).toLocaleString('id-ID') : '—',
          },
          {
            key: 'endsAt',
            title: 'Berakhir',
            render: (row) =>
              row.endsAt ? new Date(row.endsAt).toLocaleString('id-ID') : '—',
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
                  title="Edit"
                  onClick={() => setFormTarget({ mode: 'edit', row })}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="danger"
                  title="Hapus"
                  onClick={() => setDeleteTarget(row)}
                >
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
        title={formTarget?.mode === 'edit' ? 'Edit Delegasi' : 'Delegasi Baru'}
        maxWidth={720}
      >
        {formTarget && (
          <DelegationForm
            editing={formTarget.mode === 'edit' ? formTarget.row : null}
            users={users}
            docTypes={docTypes}
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
        title="Hapus delegasi?"
        message="Delegasi akan dinonaktifkan dan di-soft-delete."
        confirmLabel="Ya, hapus"
        loading={deleting}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function DelegationForm({ editing, users, docTypes, onCancel, onSaved }) {
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
  const [saving, setSaving] = useState(false);

  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!editing && (!form.fromUserId || !form.toUserId)) {
      toast('User asal dan user penerima delegasi wajib dipilih', 'error');
      return;
    }
    if (!editing && String(form.fromUserId) === String(form.toUserId)) {
      toast('Delegasi ke diri sendiri tidak diperbolehkan', 'error');
      return;
    }
    if (!form.endsAt) {
      toast('Tanggal berakhir wajib', 'error');
      return;
    }

    const startsAt = form.startsAt
      ? new Date(form.startsAt)
      : editing
        ? new Date(editing.startsAt)
        : new Date();
    const endsAt = new Date(form.endsAt);

    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt.getTime() <= startsAt.getTime()
    ) {
      toast('Periode delegasi tidak valid', 'error');
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

    setSaving(true);
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
      onSaved();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal menyimpan delegasi', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!editing && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <UserSelect
            label="Dari User *"
            value={form.fromUserId}
            onChange={(value) => set('fromUserId', value)}
            users={users}
          />
          <UserSelect
            label="Ke User *"
            value={form.toUserId}
            onChange={(value) => set('toUserId', value)}
            users={users}
          />
        </div>
      )}

      {editing && (
        <div
          style={{
            padding: 10,
            background: '#f8fafc',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <b>{editing.fromUserName}</b> → <b>{editing.toUserName}</b>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <Input
          label="Request Type"
          value={form.appliesToRequestType}
          onChange={(event) => set('appliesToRequestType', event.target.value)}
          placeholder="Kosong = semua"
        />

        <SelectDocumentType
          value={form.appliesToDocumentTypeId}
          onChange={(value) => set('appliesToDocumentTypeId', value)}
          items={docTypes}
        />

        <Input
          label="Starts At"
          type="datetime-local"
          value={form.startsAt}
          onChange={(event) => set('startsAt', event.target.value)}
        />
        <Input
          label="Ends At *"
          type="datetime-local"
          value={form.endsAt}
          onChange={(event) => set('endsAt', event.target.value)}
        />
      </div>

      <Input
        label="Alasan"
        value={form.reason}
        onChange={(event) => set('reason', event.target.value)}
      />

      {editing && (
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set('isActive', event.target.checked)}
          />
          Delegasi aktif
        </label>
      )}

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

function SelectDocumentType({ value, onChange, items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      <label style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Document Type
      </label>
      <select
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <option value="">Semua</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
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
