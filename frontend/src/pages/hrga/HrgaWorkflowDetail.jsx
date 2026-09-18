import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import Modal from '../../components/Modal';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';

export default function HrgaWorkflowDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkTask, setLinkTask] = useState(null);
  const [kantorkuOpen, setKantorkuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/hrga/workflows/${id}`);
      setWf(r.data.data);
    } catch {
      toast('Workflow tidak ditemukan', 'error');
      nav('/hrga/onboarding');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const upload = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/hrga/workflows/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Lampiran diunggah', 'success');
      e.target.reset();
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const submit = async () => {
    try {
      await api.post(`/hrga/workflows/${id}/submit-approval`);
      toast('Dikirim ke approval queue', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const applyApproval = async (status) => {
    try {
      await api.post(`/hrga/workflows/${id}/apply-approval`, { status });
      toast(`Status → ${status}`, 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const updateTask = async (taskId, status) => {
    try {
      await api.patch(`/hrga/workflows/${id}/tasks/${taskId}`, { status });
      toast('Task diperbarui', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const saveTaskLink = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/hrga/workflows/${id}/tasks/${linkTask.id}/link`, {
        linkedDeviceAssignmentId: fd.get('linkedDeviceAssignmentId') ? Number(fd.get('linkedDeviceAssignmentId')) : null,
        linkedSubscriptionLicenseId: fd.get('linkedSubscriptionLicenseId') ? Number(fd.get('linkedSubscriptionLicenseId')) : null,
        linkedTaskId: fd.get('linkedTaskId') ? Number(fd.get('linkedTaskId')) : null,
      });
      toast('Link task diperbarui', 'success');
      setLinkTask(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const saveKantorku = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/hrga/workflows/${id}/kantorku-reference`, {
        kantorkuEmployeeId: fd.get('kantorkuEmployeeId') || null,
        kantorkuReferenceUrl: fd.get('kantorkuReferenceUrl') || null,
      });
      toast('Referensi KantorKu disimpan', 'success');
      setKantorkuOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/hrga/workflows/${id}`, {
        employeeFullName: fd.get('employeeFullName'),
        employeeEmail: fd.get('employeeEmail') || null,
        employeePhone: fd.get('employeePhone') || null,
        employeePosition: fd.get('employeePosition') || null,
        employeeDivision: fd.get('employeeDivision') || null,
        joinDate: fd.get('joinDate') || null,
        lastWorkingDate: fd.get('lastWorkingDate') || null,
        effectiveDate: fd.get('effectiveDate'),
        reason: fd.get('reason') || null,
        notes: fd.get('notes') || null,
      });
      toast('Workflow diperbarui', 'success');
      setEditOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={10} />;
  if (!wf) return null;

  const editable = ['draft', 'revision_requested'].includes(wf.status);
  const completedTasks = wf.tasks?.filter((t) => t.status === 'completed').length || 0;
  const totalTasks = wf.tasks?.length || 0;
  const pct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={() => nav(-1)}>
          ← Kembali
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          {editable && <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>}
          <Button variant="secondary" onClick={() => setKantorkuOpen(true)}>
            KantorKu Ref
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <h2>
          {wf.workflow_number} — {wf.employee_full_name}
        </h2>
        <Badge
          tone={
            wf.status === 'completed'
              ? 'success'
              : wf.status === 'rejected'
              ? 'error'
              : wf.status === 'pending_approval'
              ? 'warning'
              : 'info'
          }
        >
          {wf.status}
        </Badge>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {wf.workflow_type} · efektif {wf.effective_date} · PIC HRGA: {wf.hrgaPicName || '—'}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 16, marginBottom: 4, fontSize: 13 }}>
        Progres checklist: <b>{completedTasks}/{totalTasks}</b> ({pct}%)
      </div>
      <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--color-primary)',
            transition: 'width 300ms ease',
          }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <Card title="Informasi Karyawan">
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div>Nama: <b>{wf.employee_full_name}</b></div>
            <div>Email: {wf.employee_email || '—'}</div>
            <div>Telepon: {wf.employee_phone || '—'}</div>
            <div>Posisi: {wf.employee_position || '—'}</div>
            <div>Divisi: {wf.employee_division || '—'}</div>
            <div>Manager: {wf.managerName || '—'}</div>
            {wf.workflow_type === 'onboarding' && <div>Tanggal Join: {wf.join_date || '—'}</div>}
            {wf.workflow_type === 'offboarding' && (
              <>
                <div>Hari Terakhir: {wf.last_working_date || '—'}</div>
                <div>Alasan: {wf.reason || '—'}</div>
              </>
            )}
            <div>
              Referensi KantorKu:{' '}
              {wf.kantorku_employee_id ? (
                <a href={wf.kantorku_reference_url || '#'} target="_blank" rel="noreferrer">
                  {wf.kantorku_employee_id}
                </a>
              ) : (
                '—'
              )}
            </div>
          </div>
        </Card>

        <Card title={`Lampiran (${wf.attachments?.length || 0})`}>
          {wf.attachments?.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                padding: 6,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div>
                <Badge>{a.attachmentType}</Badge> <b>{a.name}</b>
              </div>
              {a.webViewLink && (
                <a href={a.webViewLink} target="_blank" rel="noreferrer">
                  <Button variant="secondary">Buka</Button>
                </a>
              )}
            </div>
          ))}
          <form
            onSubmit={upload}
            style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>Tipe</label>
              <select name="attachmentType" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="offer_letter">Offer Letter</option>
                <option value="contract">Kontrak</option>
                <option value="id_document">Identitas</option>
                <option value="resignation_letter">Surat Pengunduran Diri</option>
                <option value="handover_note">Handover Note</option>
              </select>
            </div>
            <Input label="File" name="file" type="file" style={{ margin: 0 }} />
            <Button type="submit">Unggah</Button>
          </form>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Checklist">
          {wf.tasks?.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                padding: 12,
                borderBottom: '1px solid var(--color-border)',
                fontSize: 13,
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {t.category} · {t.responsibleName || 'belum ditugaskan'} · {t.dueDate || 'tanpa due date'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {t.linkedTaskId && <>Task #{t.linkedTaskId} · </>}
                  {t.linkedDeviceAssignmentId && <>Device Assign #{t.linkedDeviceAssignmentId} · </>}
                  {t.linkedSubscriptionLicenseId && <>License #{t.linkedSubscriptionLicenseId}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="secondary" onClick={() => setLinkTask(t)}>
                  Link
                </Button>
                {t.status !== 'completed' && (
                  <>
                    {t.status !== 'in_progress' && (
                      <Button variant="secondary" onClick={() => updateTask(t.id, 'in_progress')}>
                        Mulai
                      </Button>
                    )}
                    <Button onClick={() => updateTask(t.id, 'completed')}>Selesai</Button>
                  </>
                )}
                {t.status === 'completed' && <Badge tone="success">Selesai</Badge>}
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editable && <Button onClick={submit}>Submit ke Approval Queue</Button>}
        {wf.status === 'pending_approval' && (
          <>
            <Button onClick={() => applyApproval('approved')}>Tandai Approved</Button>
            <Button variant="danger" onClick={() => applyApproval('rejected')}>
              Tandai Rejected
            </Button>
          </>
        )}
        {wf.status === 'approved' && (
          <Button onClick={() => applyApproval('in_progress')}>Mulai Proses (In Progress)</Button>
        )}
      </div>

      <Modal open={!!linkTask} onClose={() => setLinkTask(null)} title="Link Task">
        {linkTask && (
          <form onSubmit={saveTaskLink}>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              Task: <b>{linkTask.title}</b>
            </div>
            <Input
              label="Linked Task ID"
              name="linkedTaskId"
              type="number"
              defaultValue={linkTask.linkedTaskId || ''}
            />
            <Input
              label="Device Assignment ID"
              name="linkedDeviceAssignmentId"
              type="number"
              defaultValue={linkTask.linkedDeviceAssignmentId || ''}
            />
            <Input
              label="Subscription License ID"
              name="linkedSubscriptionLicenseId"
              type="number"
              defaultValue={linkTask.linkedSubscriptionLicenseId || ''}
            />
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Kosongkan field yang tidak ingin diubah.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setLinkTask(null)}>
                Batal
              </Button>
              <Button type="submit">Simpan</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={kantorkuOpen} onClose={() => setKantorkuOpen(false)} title="Referensi KantorKu HRIS">
        <form onSubmit={saveKantorku}>
          <Input
            label="KantorKu Employee ID"
            name="kantorkuEmployeeId"
            defaultValue={wf.kantorku_employee_id || ''}
          />
          <Input
            label="URL Referensi"
            name="kantorkuReferenceUrl"
            defaultValue={wf.kantorku_reference_url || ''}
            placeholder="https://..."
          />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Platform tidak menyimpan data payroll/absensi/cuti. Hanya referensi/link ke KantorKu.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setKantorkuOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Workflow">
        <form onSubmit={saveEdit}>
          <Input label="Nama Lengkap" name="employeeFullName" defaultValue={wf.employee_full_name} required />
          <Input label="Email" name="employeeEmail" type="email" defaultValue={wf.employee_email || ''} />
          <Input label="Telepon" name="employeePhone" defaultValue={wf.employee_phone || ''} />
          <Input label="Posisi" name="employeePosition" defaultValue={wf.employee_position || ''} />
          <Input label="Divisi" name="employeeDivision" defaultValue={wf.employee_division || ''} />
          {wf.workflow_type === 'onboarding' && (
            <Input label="Tanggal Join" name="joinDate" type="date" defaultValue={wf.join_date || ''} />
          )}
          {wf.workflow_type === 'offboarding' && (
            <>
              <Input
                label="Hari Terakhir"
                name="lastWorkingDate"
                type="date"
                defaultValue={wf.last_working_date || ''}
              />
              <Input label="Alasan" name="reason" defaultValue={wf.reason || ''} />
            </>
          )}
          <Input label="Tanggal Efektif" name="effectiveDate" type="date" defaultValue={wf.effective_date} required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Catatan</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={wf.notes || ''}
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--color-border)' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
