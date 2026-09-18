import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

export default function DeviceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/it/devices/${id}`);
      setDevice(r.data.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const assign = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/it/assignments', {
        entityId: device.entity_id,
        departmentId: device.department_id,
        deviceId: device.id,
        assignedTo: Number(fd.get('assignedTo')),
        expectedReturnDate: fd.get('expectedReturnDate') || null,
        location: fd.get('location') || null,
        purpose: fd.get('purpose') || null,
      });
      toast('Device di-assign', 'success');
      setAssignOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doReturn = async () => {
    try {
      await api.patch(`/it/assignments/${returnTarget.id}/return`, {});
      toast('Device dikembalikan', 'success');
      setReturnTarget(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const createMaintenance = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/devices/${id}/maintenance`, {
        maintenanceDate: fd.get('maintenanceDate'),
        maintenanceType: fd.get('maintenanceType'),
        description: fd.get('description') || null,
        performedBy: fd.get('performedBy') || null,
        cost: fd.get('cost') ? Number(fd.get('cost')) : null,
        nextMaintenanceDate: fd.get('nextMaintenanceDate') || null,
      });
      toast('Maintenance dicatat', 'success');
      setMaintenanceOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const createRepair = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/devices/${id}/repairs`, {
        reportedDate: fd.get('reportedDate'),
        issueDescription: fd.get('issueDescription'),
        severity: fd.get('severity') || 'medium',
        vendorName: fd.get('vendorName') || null,
      });
      toast('Repair dilaporkan', 'success');
      setRepairOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={8} />;
  if (!device) return null;

  const activeAssignment = device.assignments?.find((a) => a.status === 'active');

  return (
    <div>
      <Button variant="secondary" onClick={() => nav('/it/devices')}>← Devices</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <h2>{device.asset_code} — {device.brand} {device.model}</h2>
        <Badge tone={device.status === 'assigned' ? 'info' : device.status === 'available' ? 'success' : 'warning'}>
          {device.status}
        </Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Info Device">
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>Tipe: <b>{device.device_type}</b></div>
            <div>Serial: {device.serial_number || '—'}</div>
            <div>Kondisi: <b>{device.condition_state}</b></div>
            <div>Warranty: {device.warranty_start || '—'} → {device.warranty_end || '—'}</div>
            <div>Pembelian: {device.purchase_date || '—'} · {device.currency} {device.purchase_price || 0}</div>
            <div>PIC: <b>{device.assigneeName || 'Belum ada'}</b></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {device.status === 'available' && <Button onClick={() => setAssignOpen(true)}>Assign</Button>}
            {activeAssignment && (
              <Button variant="danger" onClick={() => setReturnTarget(activeAssignment)}>Kembalikan</Button>
            )}
            <Button variant="secondary" onClick={() => setMaintenanceOpen(true)}>+ Maintenance</Button>
            <Button variant="secondary" onClick={() => setRepairOpen(true)}>+ Repair</Button>
          </div>
        </Card>

        <Card title="Warranty History">
          {device.warranties?.length ? (
            device.warranties.map((w) => (
              <div key={w.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                <b>{w.warrantyType}</b> · {w.startDate} → {w.endDate} · {w.provider || '—'}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada data warranty</div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Riwayat Assignment">
          {device.assignments?.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                justify: 'space-between',
                fontSize: 13,
                padding: 8,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div>
                <b>{a.assignedToName}</b> · {new Date(a.assignedAt).toLocaleDateString('id-ID')}
                {a.actualReturnDate && <> → {new Date(a.actualReturnDate).toLocaleDateString('id-ID')}</>}
              </div>
              <Badge tone={a.status === 'active' ? 'info' : 'default'}>{a.status}</Badge>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Maintenance Log">
          {device.maintenance?.length ? (
            device.maintenance.map((m) => (
              <div key={m.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                {m.maintenanceDate} · {m.maintenanceType} · {m.cost || 0}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada maintenance</div>
          )}
        </Card>
        <Card title="Repair Log">
          {device.repairs?.length ? (
            device.repairs.map((r) => (
              <div key={r.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                {r.reportedDate} · {r.severity} · <Badge>{r.status}</Badge>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada repair</div>
          )}
        </Card>
      </div>

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Device">
        <form onSubmit={assign}>
          <Input label="User ID" name="assignedTo" type="number" required />
          <Input label="Batas Kembali (opsional)" name="expectedReturnDate" type="date" />
          <Input label="Lokasi" name="location" />
          <Input label="Tujuan" name="purpose" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setAssignOpen(false)}>Batal</Button>
            <Button type="submit">Assign</Button>
          </div>
        </form>
      </Modal>

      <Modal open={maintenanceOpen} onClose={() => setMaintenanceOpen(false)} title="Catat Maintenance">
        <form onSubmit={createMaintenance}>
          <Input label="Tanggal" name="maintenanceDate" type="date" required />
          <Input label="Jenis" name="maintenanceType" placeholder="routine/cleaning/update" required />
          <Input label="Deskripsi" name="description" />
          <Input label="Pelaksana" name="performedBy" />
          <Input label="Biaya" name="cost" type="number" />
          <Input label="Jadwal Berikutnya" name="nextMaintenanceDate" type="date" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setMaintenanceOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={repairOpen} onClose={() => setRepairOpen(false)} title="Laporkan Repair">
        <form onSubmit={createRepair}>
          <Input label="Tanggal Dilaporkan" name="reportedDate" type="date" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Deskripsi Masalah</label>
            <textarea
              name="issueDescription"
              rows={3}
              required
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Severity</label>
            <select name="severity" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              {['low', 'medium', 'high', 'critical'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <Input label="Vendor" name="vendorName" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setRepairOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!returnTarget}
        title="Kembalikan device?"
        message={`Device ${device.asset_code} akan ditandai sebagai dikembalikan.`}
        confirmLabel="Ya, kembalikan"
        onConfirm={doReturn}
        onClose={() => setReturnTarget(null)}
      />
    </div>
  );
}

