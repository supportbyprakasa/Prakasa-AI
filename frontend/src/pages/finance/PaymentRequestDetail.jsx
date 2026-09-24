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

export default function PaymentRequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState(null);
  const [running, setRunning] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/finance/payment-requests/${id}`);
      setWf(r.data.data);
    } catch {
      toast('Pengajuan tidak ditemukan', 'error');
      nav('/finance/payment-requests');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

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
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const runCheck = async () => {
    setRunning(true);
    setCheck(null);
    try {
      const r = await api.post(`/finance/payment-requests/${id}/document-check`);
      setCheck(r.data.data);
      toast('Document check selesai', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    } finally {
      setRunning(false);
    }
  };

  const submit = async () => {
    try {
      await api.post(`/finance/payment-requests/${id}/submit-approval`);
      toast('Dikirim ke approval queue', 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const applyApproval = async (status) => {
    try {
      await api.post(`/finance/payment-requests/${id}/apply-approval`, { status });
      toast(`Status diubah ke ${status}`, 'success');
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doCancel = async () => {
    try {
      await api.patch(`/finance/payment-requests/${id}/processing`, { status: 'cancelled' });
      toast('Pengajuan dibatalkan', 'success');
      setCancelOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const markPaid = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/finance/payment-requests/${id}/processing`, {
        status: 'paid',
        jurnalReferenceId: fd.get('jurnalReferenceId') || null,
        jurnalReferenceUrl: fd.get('jurnalReferenceUrl') || null,
      });
      toast('Ditandai paid', 'success');
      setPaidOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.patch(`/finance/payment-requests/${id}`, {
        title: fd.get('title'),
        description: fd.get('description') || null,
        category: fd.get('category') || null,
        payeeName: fd.get('payeeName') || null,
        payeeBank: fd.get('payeeBank') || null,
        payeeAccountNumber: fd.get('payeeAccountNumber') || null,
        payeeAccountName: fd.get('payeeAccountName') || null,
        amount: Number(fd.get('amount')),
        taxAmount: Number(fd.get('taxAmount') || 0),
        totalAmount: Number(fd.get('totalAmount')),
        dueDate: fd.get('dueDate') || null,
        notes: fd.get('notes') || null,
      });
      toast('Pengajuan diperbarui', 'success');
      setEditOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={10} />;
  if (!wf) return null;

  const editable = ['draft', 'revision_requested', 'pending_document_check'].includes(wf.status);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="secondary" onClick={() => nav('/finance/payment-requests')}>
          ← Kembali
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          {editable && <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>}
          {!['paid', 'cancelled'].includes(wf.status) && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              Batalkan
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <h2>
          {wf.request_number} — {wf.title}
        </h2>
        <Badge
          tone={
            wf.status === 'paid'
              ? 'success'
              : wf.status === 'rejected' || wf.status === 'cancelled'
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
        {wf.workflow_type} · diajukan oleh {wf.requesterName} pada {new Date(wf.request_date).toLocaleDateString('id-ID')}
      </div>

      <div className="prakasa-detail-columns" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <Card title="Informasi">
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div>Kategori: <b>{wf.category || '—'}</b></div>
            <div>Penerima: <b>{wf.payee_name || '—'}</b> ({wf.payee_type})</div>
            <div>Bank: {wf.payee_bank || '—'} · {wf.payee_account_number || '—'}</div>
            <div>Atas Nama: {wf.payee_account_name || '—'}</div>
            <div>Subtotal: {wf.currency} {Number(wf.amount).toLocaleString('id-ID')}</div>
            <div>Pajak: {wf.currency} {Number(wf.tax_amount || 0).toLocaleString('id-ID')}</div>
            <div><b>Total: {wf.currency} {Number(wf.total_amount).toLocaleString('id-ID')}</b></div>
            <div>Jatuh tempo: {wf.due_date || '—'}</div>
            <div>Finance PIC: {wf.financePicName || '—'}</div>
            <div>
              Referensi Jurnal.id:{' '}
              {wf.jurnal_reference_id ? (
                <a href={wf.jurnal_reference_url || '#'} target="_blank" rel="noreferrer">
                  {wf.jurnal_reference_id}
                </a>
              ) : (
                '—'
              )}
            </div>
          </div>
        </Card>

        <Card
          title="AI Document Check"
          actions={
            <Button onClick={runCheck} disabled={running}>
              {running ? 'Memeriksa…' : 'Jalankan'}
            </Button>
          }
        >
          <div style={{ fontSize: 13 }}>
            Status:{' '}
            <Badge
              tone={
                wf.document_check_status === 'passed'
                  ? 'success'
                  : wf.document_check_status === 'warning'
                  ? 'warning'
                  : wf.document_check_status === 'failed'
                  ? 'error'
                  : 'default'
              }
            >
              {wf.document_check_status}
            </Badge>
          </div>
          {wf.document_check_summary && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                background: '#f8fafc',
                padding: 10,
                borderRadius: 6,
                marginTop: 8,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {wf.document_check_summary}
            </pre>
          )}
          {check && check.missing?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-error)' }}>
              Dokumen wajib kurang: {check.missing.join(', ')}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title={`Lampiran (${wf.attachments?.length || 0})`}>
          {wf.attachments?.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                padding: 8,
                boxShadow: 'inset 0 -1px 0 0 var(--color-border)',
              }}
            >
              <div>
                <Badge tone="info">{a.attachmentType}</Badge> <b>{a.name}</b>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {a.webViewLink && (
                  <a href={a.webViewLink} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Buka</Button>
                  </a>
                )}
              </div>
            </div>
          ))}
          {!wf.attachments?.length && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: 8 }}>
              Belum ada lampiran
            </div>
          )}

          {editable && (
            <form
              onSubmit={upload}
              style={{
                marginTop: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13 }}>Tipe</label>
                <select
                  name="attachmentType"
                  style={{ padding: 8, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
                >
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
          )}
        </Card>
      </div>

      {wf.notes && (
        <div style={{ marginTop: 12 }}>
          <Card title="Catatan">
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: 0 }}>{wf.notes}</pre>
          </Card>
        </div>
      )}

      {/* Action bar */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editable && wf.document_check_status !== 'failed' && wf.document_check_status !== 'not_run' && (
          <Button onClick={submit}>Submit ke Approval Queue</Button>
        )}
        {editable && wf.document_check_status === 'not_run' && (
          <Button onClick={runCheck} disabled={running}>
            Jalankan Document Check dulu
          </Button>
        )}
        {wf.status === 'pending_approval' && (
          <>
            <Button onClick={() => applyApproval('approved')}>Tandai Approved</Button>
            <Button variant="danger" onClick={() => applyApproval('rejected')}>
              Tandai Rejected
            </Button>
            <Button variant="secondary" onClick={() => applyApproval('revision_requested')}>
              Minta Revisi
            </Button>
          </>
        )}
        {wf.status === 'approved' && <Button onClick={() => setPaidOpen(true)}>Tandai Sudah Dibayar</Button>}
      </div>

      {/* Edit modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Pengajuan">
        <form onSubmit={saveEdit}>
          <Input label="Judul" name="title" defaultValue={wf.title} required />
          <Input label="Deskripsi" name="description" defaultValue={wf.description || ''} />
          <Input label="Kategori" name="category" defaultValue={wf.category || ''} />
          <Input label="Nama Penerima" name="payeeName" defaultValue={wf.payee_name || ''} />
          <Input label="Bank" name="payeeBank" defaultValue={wf.payee_bank || ''} />
          <Input label="No. Rekening" name="payeeAccountNumber" defaultValue={wf.payee_account_number || ''} />
          <Input label="Atas Nama" name="payeeAccountName" defaultValue={wf.payee_account_name || ''} />
          <Input label="Subtotal" name="amount" type="number" defaultValue={wf.amount} required />
          <Input label="Pajak" name="taxAmount" type="number" defaultValue={wf.tax_amount || 0} />
          <Input label="Total" name="totalAmount" type="number" defaultValue={wf.total_amount} required />
          <Input label="Jatuh Tempo" name="dueDate" type="date" defaultValue={wf.due_date || ''} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>Catatan</label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={wf.notes || ''}
              style={{ padding: 10, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-border)' }}
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

      {/* Paid modal */}
      <Modal open={paidOpen} onClose={() => setPaidOpen(false)} title="Tandai Sudah Dibayar">
        <form onSubmit={markPaid}>
          <Input label="Referensi Jurnal.id (nomor jurnal)" name="jurnalReferenceId" />
          <Input label="URL Jurnal.id" name="jurnalReferenceUrl" placeholder="https://..." />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Platform tidak menyimpan data akuntansi. Referensi di atas hanya untuk deep-link ke Jurnal.id.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setPaidOpen(false)}>
              Batal
            </Button>
            <Button type="submit">Konfirmasi Paid</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title="Batalkan pengajuan?"
        message="Pengajuan akan ditandai sebagai cancelled dan tidak bisa dilanjutkan."
        confirmLabel="Ya, batalkan"
        onConfirm={doCancel}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}
