import { useEffect, useState } from 'react';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import DataTable from '../../components/DataTable';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

export default function WarehouseDashboard() {
  const [tab, setTab] = useState('queue');
  return (
    <div>
      <h2>Warehouse</h2>
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 12,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {[
          { k: 'queue', l: 'Sample Queue' },
          { k: 'delivery', l: 'Delivery Proof' },
          { k: 'checklist', l: 'Checklist' },
          { k: 'incidents', l: 'Incidents' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.k ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: tab === t.k ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t.l}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        {tab === 'queue' && <SampleQueueTab />}
        {tab === 'delivery' && <DeliveryProofTab />}
        {tab === 'checklist' && <ChecklistTab />}
        {tab === 'incidents' && <IncidentsTab />}
      </div>
    </div>
  );
}

/* ============================ SAMPLE QUEUE ============================ */

function SampleQueueTab() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assign, setAssign] = useState(null);
  const [deliver, setDeliver] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/warehouse/sample-tasks').then((r) => setTasks(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const update = async (id, status) => {
    try {
      await api.patch(`/warehouse/sample-tasks/${id}/status`, { status });
      toast(`Status → ${status}`, 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doAssign = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/warehouse/sample-tasks/${assign.id}/assign`, {
        assignedTo: Number(fd.get('assignedTo')),
      });
      toast('Ditugaskan', 'success');
      setAssign(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <>
      <DataTable
        loading={loading}
        rows={tasks}
        empty="Tidak ada sample task"
        columns={[
          { key: 'id', title: 'ID', render: (r) => `#${r.id}` },
          { key: 'customerName', title: 'Customer' },
          { key: 'productName', title: 'Produk' },
          { key: 'quantity', title: 'Qty' },
          {
            key: 'priority',
            title: 'Prioritas',
            render: (r) => <Badge tone={r.priority === 'urgent' ? 'error' : 'default'}>{r.priority}</Badge>,
          },
          {
            key: 'status',
            title: 'Status',
            render: (r) => (
              <Badge tone={r.status === 'delivered' ? 'success' : r.status === 'ready' ? 'info' : 'warning'}>
                {r.status}
              </Badge>
            ),
          },
          {
            key: 'assignedTo',
            title: 'PIC',
            render: (r) =>
              r.assignedTo ? (
                `User #${r.assignedTo}`
              ) : (
                <Button variant="secondary" onClick={() => setAssign(r)}>
                  Assign
                </Button>
              ),
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4 }}>
                {r.status === 'queued' && <Button onClick={() => update(r.id, 'preparing')}>Prepare</Button>}
                {r.status === 'preparing' && <Button onClick={() => update(r.id, 'ready')}>Ready</Button>}
                {r.status === 'ready' && <Button onClick={() => setDeliver(r)}>Deliver</Button>}
              </div>
            ),
          },
        ]}
      />

      <Modal open={!!assign} onClose={() => setAssign(null)} title="Assign ke Warehouse Staff">
        <form onSubmit={doAssign}>
          <Input label="User ID" name="assignedTo" type="number" required />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setAssign(null)}>
              Batal
            </Button>
            <Button type="submit">Assign</Button>
          </div>
        </form>
      </Modal>

      <DeliveryModal task={deliver} onClose={() => { setDeliver(null); load(); }} />
    </>
  );
}

/* ============================ DELIVERY PROOF ============================ */

function DeliveryModal({ task, onClose }) {
  const [submitting, setSubmitting] = useState(false);
  if (!task) return null;

  const submit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    fd.append('sampleTaskId', task.id);
    fd.append('entityId', task.entityId || 1);
    setSubmitting(true);
    try {
      await api.post('/warehouse/delivery-proofs', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Delivery proof tersimpan · Follow-up otomatis ke Sales', 'success');
      onClose();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={`Delivery Proof — ${task.productName}`}>
      <form onSubmit={submit}>
        <Input label="Nama Penerima" name="recipientName" required />
        <Input label="Telepon Penerima" name="recipientPhone" />
        <Input label="Tanggal/Waktu Terkirim" name="deliveredAt" type="datetime-local" />
        <Input label="Alamat" name="address" />
        <Input label="Catatan" name="notes" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          <label style={{ fontSize: 13 }}>Foto Bukti (opsional)</label>
          <input type="file" name="photo" accept="image/*" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Mengunggah…' : 'Simpan & Tandai Delivered'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeliveryProofTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/warehouse/delivery-proofs').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, []);

  return (
    <DataTable
      loading={loading}
      rows={rows}
      empty="Belum ada delivery proof"
      columns={[
        { key: 'id', title: 'ID', render: (r) => `#${r.id}` },
        { key: 'customerName', title: 'Customer' },
        { key: 'productName', title: 'Produk' },
        { key: 'recipientName', title: 'Penerima' },
        {
          key: 'deliveredAt',
          title: 'Terkirim',
          render: (r) => (r.deliveredAt ? new Date(r.deliveredAt).toLocaleString('id-ID') : '—'),
        },
        { key: 'deliveredByName', title: 'Di-deliver oleh' },
        {
          key: 'photoWebViewLink',
          title: 'Foto',
          render: (r) =>
            r.photoWebViewLink ? (
              <a href={r.photoWebViewLink} target="_blank" rel="noreferrer">
                Lihat
              </a>
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}

/* ============================ CHECKLIST ============================ */

function ChecklistTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/warehouse/checklists').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const itemLabels = (fd.get('items') || '').toString().split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      await api.post('/warehouse/checklists', {
        entityId: Number(fd.get('entityId')),
        checklistDate: fd.get('checklistDate'),
        title: fd.get('title'),
        items: itemLabels.map((label) => ({ label, checked: false })),
      });
      toast('Checklist dibuat', 'success');
      setOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={() => setOpen(true)}>+ Checklist</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada checklist"
        columns={[
          { key: 'checklistDate', title: 'Tanggal' },
          { key: 'title', title: 'Judul' },
          {
            key: 'items',
            title: 'Item',
            render: (r) => {
              const items = typeof r.items === 'string' ? JSON.parse(r.items) : r.items || [];
              const done = items.filter((i) => i.checked).length;
              return `${done}/${items.length} selesai`;
            },
          },
          {
            key: 'completed',
            title: 'Status',
            render: (r) => (
              <Badge tone={r.completed ? 'success' : 'warning'}>
                {r.completed ? 'Selesai' : 'Pending'}
              </Badge>
            ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Buat Checklist Harian">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input
            label="Tanggal"
            name="checklistDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Input label="Judul" name="title" required placeholder="Checklist Harian Gudang" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Item (satu per baris)</label>
            <textarea
              name="items"
              rows={6}
              placeholder={'Sapu lantai\nCek suhu ruangan\nCek stok sample'}
              style={{
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ============================ INCIDENTS ============================ */

function IncidentsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [resolve, setResolve] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/warehouse/incidents').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/warehouse/incidents', {
        entityId: Number(fd.get('entityId')),
        incidentDate: fd.get('incidentDate'),
        category: fd.get('category'),
        severity: fd.get('severity'),
        description: fd.get('description'),
      });
      toast('Incident dilaporkan', 'success');
      setOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doResolve = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/warehouse/incidents/${resolve.id}/resolve`, {
        status: fd.get('status'),
        resolution: fd.get('resolution'),
      });
      toast('Incident di-resolve', 'success');
      setResolve(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={() => setOpen(true)}>+ Laporkan Incident</Button>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada incident"
        columns={[
          { key: 'id', title: 'ID', render: (r) => `#${r.id}` },
          { key: 'incidentDate', title: 'Tanggal' },
          { key: 'category', title: 'Kategori' },
          {
            key: 'severity',
            title: 'Severity',
            render: (r) => (
              <Badge tone={r.severity === 'critical' ? 'error' : r.severity === 'high' ? 'warning' : 'info'}>
                {r.severity}
              </Badge>
            ),
          },
          {
            key: 'description',
            title: 'Deskripsi',
            render: (r) =>
              (r.description || '').slice(0, 60) + ((r.description || '').length > 60 ? '…' : ''),
          },
          {
            key: 'status',
            title: 'Status',
            render: (r) => (
              <Badge tone={r.status === 'resolved' || r.status === 'closed' ? 'success' : 'warning'}>
                {r.status}
              </Badge>
            ),
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (r) =>
              ['resolved', 'closed'].includes(r.status) ? (
                <span style={{ color: 'var(--color-text-muted)' }}>—</span>
              ) : (
                <Button onClick={() => setResolve(r)}>Resolve</Button>
              ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Laporkan Incident">
        <form onSubmit={create}>
          <Input label="Entity ID" name="entityId" type="number" required />
          <Input
            label="Tanggal"
            name="incidentDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Input label="Kategori" name="category" placeholder="damage/lost/delay" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Severity</label>
            <select name="severity" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              {['low', 'medium', 'high', 'critical'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Deskripsi</label>
            <textarea
              name="description"
              rows={4}
              required
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Laporkan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resolve} onClose={() => setResolve(null)} title={`Resolve Incident #${resolve?.id || ''}`}>
        {resolve && (
          <form onSubmit={doResolve}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>Status</label>
              <select name="status" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="investigating">Investigating</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>Resolusi</label>
              <textarea
                name="resolution"
                rows={4}
                required
                style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setResolve(null)}>
                Batal
              </Button>
              <Button type="submit">Simpan</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
