import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function HrgaWorkflowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/hrga/workflows/${id}`);
      setWf(r.data.data);
    } finally { setLoading(false); }
  };
  useEffect(load, [id]);

  const upload = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/hrga/workflows/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Lampiran diunggah', 'success');
      e.target.reset(); load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const submit = async () => {
    try {
      await api.post(`/hrga/workflows/${id}/submit-approval`);
      toast('Dikirim ke approval queue', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const applyApproval = async (status) => {
    try {
      await api.post(`/hrga/workflows/${id}/apply-approval`, { status });
      toast(`Status → ${status}`, 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const updateTask = async (taskId, status) => {
    try {
      await api.patch(`/hrga/workflows/${id}/tasks/${taskId}`, { status });
      toast('Task diperbarui', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  if (loading) return <div>Memuat…</div>;
  if (!wf) return <div>Tidak ditemukan.</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Button variant="secondary" onClick={() => navigate(-1)}>← Kembali</Button>
          <h2 style={{ marginTop: 8 }}>{wf.workflow_number} — {wf.employee_full_name}</h2>
        </div>
        <Badge tone="info">{wf.status}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Informasi">
          <p style={{ fontSize: 13 }}>Tipe: <b>{wf.workflow_type}</b></p>
          <p style={{ fontSize: 13 }}>Email: {wf.employee_email || '-'}</p>
          <p style={{ fontSize: 13 }}>Posisi: {wf.employee_position || '-'}</p>
          <p style={{ fontSize: 13 }}>Efektif: {wf.effective_date}</p>
          <p style={{ fontSize: 13 }}>Referensi KantorKu: {wf.kantorku_employee_id || '-'}</p>
        </Card>
        <Card title="Lampiran">
          {wf.attachments.map((a) => (
            <div key={a.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
              <b>{a.attachmentType}</b>: {a.name}
              {a.webViewLink && <> · <a href={a.webViewLink} target="_blank" rel="noreferrer">Buka</a></>}
            </div>
          ))}
          <form onSubmit={upload} style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'end' }}>
            <select name="attachmentType" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <option value="offer_letter">Offer Letter</option>
              <option value="contract">Kontrak</option>
              <option value="id_document">Identitas</option>
              <option value="resignation_letter">Surat Pengunduran Diri</option>
              <option value="handover_note">Handover Note</option>
            </select>
            <Input name="file" type="file" style={{ margin: 0 }} />
            <Button type="submit">Unggah</Button>
          </form>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Checklist">
          {wf.tasks.map((t) => (
            <div key={t.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: 10, borderBottom: '1px solid var(--color-border)', fontSize: 13,
            }}>
              <div>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                  {t.category} · {t.responsibleName || 'belum ditugaskan'} · {t.dueDate || 'tanpa due date'}
                  {t.linkedTaskId && <> · Task #{t.linkedTaskId}</>}
                  {t.linkedDeviceAssignmentId && <> · Device Assign #{t.linkedDeviceAssignmentId}</>}
                  {t.linkedSubscriptionLicenseId && <> · License #{t.linkedSubscriptionLicenseId}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {t.status !== 'completed' && (
                  <>
                    <Button variant="secondary" onClick={() => updateTask(t.id, 'in_progress')}>Mulai</Button>
                    <Button onClick={() => updateTask(t.id, 'completed')}>Selesai</Button>
                  </>
                )}
                {t.status === 'completed' && <Badge tone="success">Selesai</Badge>}
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['draft','revision_requested'].includes(wf.status) && (
          <Button onClick={submit}>Submit ke Approval Queue</Button>
        )}
        {wf.status === 'pending_approval' && (
          <>
            <Button onClick={() => applyApproval('approved')}>Tandai Approved</Button>
            <Button variant="danger" onClick={() => applyApproval('rejected')}>Tandai Rejected</Button>
          </>
        )}
        {wf.status === 'approved' && (
          <Button onClick={() => applyApproval('in_progress')}>Mulai Proses (In Progress)</Button>
        )}
      </div>
    </div>
  );
}
