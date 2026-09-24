import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import ContextMeetingTab from '../../components/ContextMeetingTab';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'samples', label: 'Sample Requests' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'activity', label: 'Activity' },
];

export default function SalesCustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/workspaces/customer/${id}`);
      setData(r.data.data);
    } catch {
      toast('Customer tidak ditemukan', 'error');
      nav('/sales/customers');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const saveEdit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/sales/customers/${id}`, {
        name: fd.get('name'),
        contactPerson: fd.get('contactPerson') || null,
        phone: fd.get('phone') || null,
        email: fd.get('email') || null,
        address: fd.get('address') || null,
        city: fd.get('city') || null,
        segment: fd.get('segment') || null,
        notes: fd.get('notes') || null,
      });
      toast('Customer diperbarui', 'success');
      setEditOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/sales/customers/${id}`);
      toast('Customer dihapus', 'success');
      nav('/sales/customers');
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const createPipeline = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/sales/pipeline', {
        entityId: data.customer.entity_id,
        departmentId: data.customer.department_id,
        customerId: data.customer.id,
        dealTitle: fd.get('dealTitle'),
        estimatedValue: fd.get('estimatedValue') ? Number(fd.get('estimatedValue')) : null,
        expectedCloseDate: fd.get('expectedCloseDate') || null,
        stage: 'new_inquiry',
      });
      toast('Pipeline dibuat', 'success');
      setPipelineOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={10} />;
  if (!data) return null;

  const { customer } = data;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={() => nav('/sales/customers')}>← Customers</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>Hapus</Button>
        </div>
      </div>

      <h2 style={{ marginTop: 12 }}>{customer.name}</h2>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {customer.contact_person} · {customer.phone} · {customer.email} · {customer.city}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 20,
          boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
          overflowX: 'auto',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              boxShadow: tab === t.key ? 'inset 0 -2px 0 0 var(--color-primary)' : 'inset 0 -2px 0 0 transparent',
              color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard label="Pipeline" value={data.pipeline?.length || 0} />
            <StatCard label="Sample Requests" value={data.samples?.length || 0} />
            <StatCard label="Quotations" value={data.quotations?.length || 0} />
            <StatCard label="Meetings" value={data.meetings?.length || 0} />
            <StatCard label="Tasks" value={data.tasks?.length || 0} />
            <StatCard label="Finance" value={data.finance?.length || 0} />
            <StatCard label="Activities" value={data.activities?.length || 0} />
            <StatCard label="Decisions" value={data.decisions?.length || 0} />
          </div>
        )}

        {tab === 'pipeline' && (
          <Card
            title={`Pipeline (${data.pipeline?.length || 0})`}
            actions={<Button onClick={() => setPipelineOpen(true)}>+ Pipeline</Button>}
          >
            {data.pipeline?.length ? (
              data.pipeline.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: 12,
                    boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
                    fontSize: 14,
                    display: 'flex',
                    justify: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.deal_title}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Owner: {p.ownerName || '—'} · {p.estimated_value ? `${p.currency || 'IDR'} ${Number(p.estimated_value).toLocaleString('id-ID')}` : 'tanpa nilai'}
                    </div>
                  </div>
                  <Badge tone="info">{p.stage}</Badge>
                </div>
              ))
            ) : (
              <EmptyBox text="Belum ada pipeline untuk customer ini" />
            )}
          </Card>
        )}

        {tab === 'samples' && (
          <Card title={`Sample Requests (${data.samples?.length || 0})`}>
            {data.samples?.length ? (
              data.samples.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: 12,
                    boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
                    fontSize: 14,
                    display: 'flex',
                    justify: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.productName} × {s.quantity} {s.unit}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {new Date(s.createdAt).toLocaleString('id-ID')} · Prioritas: {s.priority}
                      {s.warehouseStatus && <> · WH: {s.warehouseStatus}</>}
                    </div>
                  </div>
                  <Badge
                    tone={
                      s.status === 'delivered'
                        ? 'success'
                        : s.status === 'rejected'
                        ? 'error'
                        : 'info'
                    }
                  >
                    {s.status}
                  </Badge>
                </div>
              ))
            ) : (
              <EmptyBox text="Belum ada sample request" />
            )}
          </Card>
        )}

        {tab === 'quotations' && (
          <Card title={`Quotations (${data.quotations?.length || 0})`}>
            {data.quotations?.length ? (
              data.quotations.map((q) => (
                <div
                  key={q.id}
                  style={{
                    padding: 12,
                    boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
                    fontSize: 14,
                    display: 'flex',
                    justify: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{q.quotationNumber}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {q.currency} {Number(q.totalAmount).toLocaleString('id-ID')} · Valid s/d {q.validityDate || '—'}
                    </div>
                  </div>
                  <Badge tone={q.status === 'accepted' ? 'success' : q.status === 'rejected' ? 'error' : 'info'}>
                    {q.status}
                  </Badge>
                </div>
              ))
            ) : (
              <EmptyBox text="Belum ada quotation" />
            )}
          </Card>
        )}

        {tab === 'meetings' && (
          <ContextMeetingTab contextRecordId={data.contextRecordId} />
        )}

        {tab === 'activity' && (
          <Card title="Activity Timeline">
            {data.activities?.length ? (
              data.activities.map((a) => (
                <div key={a.id} style={{ padding: 8, boxShadow: 'inset 0 -1px 0 0 var(--color-border)', fontSize: 13 }}>
                  <b>{a.action}</b> · {a.subjectType} #{a.subjectId}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {new Date(a.createdAt).toLocaleString('id-ID')}
                  </div>
                </div>
              ))
            ) : (
              <EmptyBox text="Belum ada aktivitas" />
            )}
          </Card>
        )}
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Customer">
        <form onSubmit={saveEdit}>
          <Input label="Nama" name="name" defaultValue={customer.name} required />
          <Input label="Kontak" name="contactPerson" defaultValue={customer.contact_person || ''} />
          <Input label="Telepon" name="phone" defaultValue={customer.phone || ''} />
          <Input label="Email" name="email" type="email" defaultValue={customer.email || ''} />
          <Input label="Alamat" name="address" defaultValue={customer.address || ''} />
          <Input label="Kota" name="city" defaultValue={customer.city || ''} />
          <Input label="Segmen" name="segment" defaultValue={customer.segment || ''} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Catatan</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={customer.notes || ''}
              style={{ padding: 10, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={pipelineOpen} onClose={() => setPipelineOpen(false)} title="Buat Pipeline Baru">
        <form onSubmit={createPipeline}>
          <Input label="Judul Deal" name="dealTitle" required />
          <Input label="Estimasi Nilai" name="estimatedValue" type="number" />
          <Input label="Estimasi Closing" name="expectedCloseDate" type="date" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setPipelineOpen(false)}>Batal</Button>
            <Button type="submit">Buat</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Hapus customer?"
        message={`Customer "${customer.name}" akan dihapus (soft delete). Data terkait tetap tersimpan.`}
        confirmLabel="Ya, hapus"
        onConfirm={doDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <Card>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </Card>
  );
}

function EmptyBox({ text }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 13,
        boxShadow: 'inset 0 0 0 1px var(--color-border)',
        borderRadius: 8,
      }}
    >
      {text}
    </div>
  );
}

