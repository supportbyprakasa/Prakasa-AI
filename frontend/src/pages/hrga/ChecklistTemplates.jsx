import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

const CATEGORIES = [
  'google_workspace_access',
  'shared_drive_access',
  'device_handover',
  'device_return',
  'email_account',
  'software_license',
  'account_deactivation',
  'document_handover',
  'exit_interview',
  'custom',
];

export default function ChecklistTemplates() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get('/hrga/checklist-templates')
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lines = (fd.get('items') || '').toString().split('\n').map((l) => l.trim()).filter(Boolean);
    const items = lines.map((line) => {
      // format: category|title|description|dueOffsetDays
      const [category, title, description, dueOffsetDays] = line.split('|').map((s) => s?.trim());
      return {
        category: category || 'custom',
        title: title || line,
        description: description || null,
        dueOffsetDays: dueOffsetDays ? Number(dueOffsetDays) : null,
      };
    });
    try {
      await api.post('/hrga/checklist-templates', {
        entityId: Number(fd.get('entityId')),
        workflowType: fd.get('workflowType'),
        name: fd.get('name'),
        items,
      });
      toast('Template dibuat', 'success');
      setOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2>Checklist Templates</h2>
        <Button onClick={() => setOpen(true)}>+ Template</Button>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada template"
        columns={[
          { key: 'name', title: 'Nama' },
          {
            key: 'workflowType',
            title: 'Tipe',
            render: (r) => (
              <Badge tone={r.workflowType === 'onboarding' ? 'info' : 'warning'}>
                {r.workflowType}
              </Badge>
            ),
          },
          {
            key: 'items',
            title: 'Jumlah Item',
            render: (r) => {
              const items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items || [];
              return items.length;
            },
          },
          {
            key: 'isActive',
            title: 'Aktif',
            render: (r) => (r.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Nonaktif</Badge>),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Template Checklist Baru">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Tipe Workflow</label>
            <select
              name="workflowType"
              required
              style={{ padding: 8, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
            >
              <option value="onboarding">Onboarding</option>
              <option value="offboarding">Offboarding</option>
            </select>
          </div>
          <Input label="Nama Template" name="name" required />

          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Item (satu per baris). Format: <code>category | title | description | dueOffsetDays</code>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Category: {CATEGORIES.join(', ')}
          </div>
          <textarea
            name="items"
            rows={8}
            placeholder={
              'google_workspace_access | Buat akun email | Buat email Google Workspace | 0\nshared_drive_access | Tambah Shared Drive | | 0\ndevice_handover | Serahkan laptop | | 0'
            }
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              boxShadow: 'inset 0 0 0 1px var(--color-border)',
              fontFamily: 'monospace',
              fontSize: 12,
              marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

