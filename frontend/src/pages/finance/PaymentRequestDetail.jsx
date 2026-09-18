import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import { toast } from '../../components/Toast';

export default function PaymentRequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/finance/payment-requests/${id}`);
      setWf(r.data.data);
    } finally { setLoading(false); }
  };
  useEffect(load, [id]);

  const upload = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/finance/payment-requests/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast('Lampiran diunggah', 'success');
      e.target.reset();
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const runCheck = async () => {
    setRunning(true); setCheck(null);
    try {
      const r = await api.post(`/finance/payment-requests/${id}/document-check`);
      setCheck(r.data.data);
      toast('Document check selesai', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
    finally { setRunning(false); }
  };

  const submit = async () => {
    try {
      await api.post(`/finance/payment-requests/${id}/submit-approval`);
      toast('Dikirim ke approval queue', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const applyApproval = async (status) => {
    try {
      await api.post(`/finance/payment-requests/${id}/apply-approval`, { status });
      toast(`Status diubah ke ${status}`, 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  const markPaid = async () => {
    const jurnalReferenceId = prompt('Referensi Jurnal.id (nomor jurnal):');
    try {
      await api.patch(`/finance/payment-requests/${id}/processing`, {
        status: 'paid',
        jurnalReferenceId: jurnalReferenceId || null,
      });
      toast('Ditandai paid', 'success');
      load();
    } catch (err) { toast(err.response?.data?.error?.message || 'Gagal', 'error'); }
  };

  if (loading) return <div>Memuat…</div>;
  if (!wf) return <div>Tidak ditemukan.</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Button variant="secondary" onClick={() => navigate('/finance/payment-requests')}>← Kembali</Button>
          <h2 style={{ marginTop: 8 }}>{wf.request_number} — {wf.title}</h2>
        </div>
        <Badge tone="info">{wf.status}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Informasi">
          <p style={{ fontSize: 13 }}>Tipe: <b>{wf.workflow_type}</b></p>
          <p style={{ fontSize: 13 }}>Penerima: <b>{wf.payee_name}</b> ({wf.payee_bank} · {wf.payee_account_number})</p>
          <p style={{ fontSize: 13 }}>Nominal: <b>{wf.currency} {Number(wf.total_amount).toLocaleString('id-ID')}</b></p>
          <p style={{ fontSize: 13 }}>Jatuh tempo: {wf.due_date || '-'}</p>
          <p style={{ fontSize: 13 }}>Requester: {wf.requesterName}</p>
          <p style={{ fontSize: 13 }}>Referensi Jurnal.id: {wf.jurnal_reference_id || '-'}</p>
        </Card>

        <Card title="AI Document Check" actions={
          <Button onClick={runCheck} disabled={running}>
            {running ? 'Memeriksa…' : 'Jalankan'}
          </Button>
        }>
          <p style={{ fontSize: 13 }}>
            Status: <Badge tone={
              wf.document_check_status === 'passed' ? 'success' :
              wf.document_check_status === 'warning' ? 'warning' :
              wf.document_check_status === 'failed' ? 'error' : 'default'
            }>{wf.document_check_status}</Badge>
          </p>
          {wf.document_check_summary && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f8fafc',
              padding: 8, borderRadius: 6 }}>{wf.document_check_summary}</pre>
          )}
          {check && check.missing?.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-error)' }}>
              Dokumen wajib kurang: {check.missing.join(', ')}
            </p>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Lampiran">
          {wf.attachments.map((a) => (
            <div key={a.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
              <b>{a.attachmentType}</b>: {a.name}
              {a.webViewLink && <> · <a href={a.webViewLink} target="_blank" rel="noreferrer">Buka</a></>}
            </div>
          ))}
          {!wf.attachments.length && (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Belum ada lampiran</p>
          )}
          <form onSubmit={upload} style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>Tipe</label>
              <select name="attachmentType" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }}>
                <option value="invoice">Invoice</option>
                <option value="receipt">Receipt</option>
                <option value="quotation">Quotation</option>
                <option value="po">PO</option>
                <option value="bank_proof">Bukti Transfer</option>
                <option value="tax_doc">Dokumen Pajak</option>
                <option value="other">Lain-lain</option>
              </select>
            </div>
            <Input label="File" name="file" type="file" style={{ margin: 0 }} />
            <Button type="submit">Unggah</Button>
          </form>
        </Card>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['draft','revision_requested'].includes(wf.status) && wf.document_check_status !== 'failed' && (
          <Button onClick={submit}>Submit ke Approval Queue</Button>
        )}
        {wf.status === 'pending_approval' && (
          <>
            <Button onClick={() => applyApproval('approved')}>Tandai Approved</Button>
            <Button variant="danger" onClick={() => applyApproval('rejected')}>Tandai Rejected</Button>
            <Button variant="secondary" onClick={() => applyApproval('revision_requested')}>Minta Revisi</Button>
          </>
        )}
        {wf.status === 'approved' && (
          <Button onClick={markPaid}>Tandai Sudah Dibayar (isi ref Jurnal.id)</Button>
        )}
      </div>
    </div>
  );
}
