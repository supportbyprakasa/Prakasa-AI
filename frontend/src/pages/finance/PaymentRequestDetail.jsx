import { useCallback, useEffect, useId, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import { Mixed, NoTranslate, Translate, data, strictTranslate } from '../../i18n/NoTranslate';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import ReasonDialog from '../../components/ReasonDialog';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatDate, formatDateTime } from '../../components/format';
import PaymentRequestForm from './PaymentRequestForm';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, PAYEE_TYPES, PAYROLL_NOTE, attachmentTypeLabel, docCheck,
  financeMoney, historyParts, lastDecisionNote, requestActions, stepStatusKey, summaryLines, workflowTypeLabel,
} from './financeModel';
import './payment-requests.css';

const apiMessage = (err, fallback) => err?.response?.data?.error?.message || fallback;

// One payment request or reimbursement (detail template, docs/ui-guideline.md
// §3.2): status and the actions in the header by role and state — Ajukan for
// the requester, Setujui / Tolak / Minta revisi for the approver (through the
// approval engine), Proses / Tandai dibayar for Finance, Batalkan in ⋮.
export default function PaymentRequestDetail() {
  const { id } = useParams();
  if (id === 'new') return <Navigate to="/finance/payment-requests?baru=1" replace />;
  return <RequestDetail id={id} />;
}

function RequestDetail({ id }) {
  const navigate = useNavigate();
  const attachFormId = useId();
  const paidFormId = useId();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null); // edit | approve | decline | revise | paid | cancel | remove | attach
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState(null);
  const [upload, setUpload] = useState({ file: null, type: 'invoice', error: '' });
  const [accurateReference, setAccurateReference] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/finance/payment-requests/${id}`);
      setRequest(r.data.data);
    } catch (error) {
      setLoadError(error?.response?.status === 404 ? 'Pengajuan ini tidak ada atau bukan untuk Anda.' : apiMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Runs an action with its button in the loading state, then reloads.
  // → true when it worked.
  const run = async (key, fn, success, { reload = true } = {}) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success, 'success');
      setDialog(null);
      if (reload) await load();
      return true;
    } catch (error) {
      toast(apiMessage(error, 'Belum berhasil. Coba lagi.'), 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  if (loading && !request) return <Page><LoadingState label="Memuat pengajuan" /></Page>;
  if (loadError || !request) {
    return (
      <Page>
        <EmptyState tone="error" title="Pengajuan tidak dapat dimuat" description={loadError || undefined} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }

  const base = `/finance/payment-requests/${id}`;
  const employee = request.workflowType === 'reimbursement';
  const money = (value) => financeMoney(value || 0, request.currency);
  const decide = (action, note) => run(action, () => api.post(`/approvals/${request.approvalRequestId}/decide`, { action, note: note || null }), {
    approve: 'Pengajuan disetujui', reject: 'Pengajuan ditolak', request_revision: 'Pengajuan dikembalikan untuk revisi',
  }[action]);
  const runCheck = () => run('check', async () => {
    setCheck(null);
    const r = await api.post(`${base}/document-check`);
    setCheck(r.data.data);
  }, 'Dokumen sudah diperiksa');

  const BUTTONS = {
    approve: { label: 'Setujui', icon: 'check', onClick: () => setDialog('approve') },
    decline: { label: 'Tolak', icon: 'close', onClick: () => setDialog('decline') },
    revise: { label: 'Minta revisi', icon: 'edit_note', onClick: () => setDialog('revise') },
    submit: { label: 'Ajukan', icon: 'send', onClick: () => run('submit', () => api.post(`${base}/submit-approval`), 'Pengajuan dikirim untuk disetujui') },
    process: { label: 'Proses', icon: 'play_arrow', onClick: () => run('process', () => api.patch(`${base}/processing`, { status: 'processing' }), 'Pengajuan sedang diproses') },
    paid: { label: 'Tandai dibayar', icon: 'payments', onClick: () => { setAccurateReference(''); setDialog('paid'); } },
    edit: { label: 'Ubah', icon: 'edit', onClick: () => setDialog('edit') },
    check: { label: 'Periksa dokumen', icon: 'fact_check', onClick: runCheck },
    applyDecision: {
      label: 'Terapkan keputusan approval', icon: 'sync',
      onClick: () => run('applyDecision', () => api.post(`${base}/apply-approval`, {}), 'Keputusan approval diterapkan'),
    },
    remove: { label: 'Hapus draf', icon: 'delete', tone: 'danger', onClick: () => setDialog('remove') },
    cancel: { label: 'Batalkan pengajuan', icon: 'cancel', tone: 'danger', onClick: () => setDialog('cancel') },
  };
  const actions = requestActions(request);
  const header = (
    <>
      {actions.secondary.map((k) => (
        <Button key={k} variant="secondary" icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick} loading={busy === k} disabled={Boolean(busy) && busy !== k}>{BUTTONS[k].label}</Button>
      ))}
      {actions.primary.map((k) => (
        <Button key={k} icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick} loading={busy === k} disabled={Boolean(busy) && busy !== k}>{BUTTONS[k].label}</Button>
      ))}
      {actions.menu.length ? <ActionMenu label="Aksi lainnya" items={actions.menu.map((k) => BUTTONS[k])} /> : null}
    </>
  );

  const docStatus = docCheck(request.documentCheckStatus);
  const checkLines = summaryLines(check?.notes || request.documentCheckSummary);
  const attachments = request.attachments || [];
  const uploadedTypes = new Set(attachments.map((a) => a.attachmentType));
  const missingRequired = (request.requiredAttachments || []).filter((t) => !uploadedTypes.has(t));
  const steps = request.approvalSteps || [];
  const decisionNote = lastDecisionNote(steps);

  const sendAttachment = async (event) => {
    event.preventDefault();
    const { file, type } = upload;
    if (!file) { setUpload((u) => ({ ...u, error: 'Pilih file.' })); return; }
    if (file.size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_ACCEPT.split(',').includes(file.type)) {
      setUpload((u) => ({ ...u, error: 'PDF atau foto (PNG, JPG, WebP), paling besar 10 MB.' }));
      return;
    }
    const data = new FormData();
    data.append('attachmentType', type);
    data.append('file', file);
    await run('attach', () => api.post(`${base}/attachments`, data), 'Lampiran ditambahkan');
  };
  const openAttach = () => {
    setUpload({ file: null, type: missingRequired[0] || (request.status === 'paid' ? 'bank_proof' : 'other'), error: '' });
    setDialog('attach');
  };

  return (
    <Page
      eyebrow={workflowTypeLabel(request.workflowType)}
      title={request.title}
      dataTitle
      description={(
        <span className="pw-row">
          <StatusBadge status={request.status} />
          <span data-no-translate="">{request.requestNumber}</span>
          <span>{`Diajukan ${request.requesterName || '—'}, ${formatDate(request.requestDate)}`}</span>
        </span>
      )}
      actions={header}
    >
      {request.can?.decide ? (
        <Banner tone="info" title="Menunggu keputusan Anda">Periksa rincian dan lampiran, lalu setujui, tolak, atau minta revisi.</Banner>
      ) : null}
      {request.status === 'pending_approval' && !request.can?.decide ? (
        <Banner tone="info">Menunggu persetujuan. Pengaju dan Finance mendapat notifikasi saat sudah diputuskan.</Banner>
      ) : null}
      {request.can?.applyDecision ? (
        <Banner tone="warning" title="Approval sudah diputuskan" action={<Button variant="text" loading={busy === 'applyDecision'} onClick={BUTTONS.applyDecision.onClick}>Terapkan</Button>}>
          Keputusan approval belum tercatat di pengajuan ini.
        </Banner>
      ) : null}
      {request.status === 'revision_requested' ? (
        <Banner tone="warning" title="Perlu revisi">{decisionNote ? <NoTranslate>{decisionNote}</NoTranslate> : 'Perbaiki pengajuan, lalu ajukan lagi.'}</Banner>
      ) : null}
      {request.status === 'rejected' ? <Banner tone="error" title="Ditolak">{decisionNote ? <NoTranslate>{decisionNote}</NoTranslate> : 'Pengajuan ini ditolak penyetuju.'}</Banner> : null}
      {request.status === 'approved' ? <Banner tone="info">Disetujui. Finance akan memproses pembayarannya.</Banner> : null}
      {request.status === 'paid' ? (
        <Banner tone="success" title={`Dibayar ${formatDateTime(request.paidAt)}`}>
          {request.accurateReference ? `Nomor bukti di Accurate: ${request.accurateReference}` : 'Nomor bukti di Accurate belum dicatat.'}
        </Banner>
      ) : null}

      <div className="pw-cols-sidebar">
        <div className="pw-stack pw-stack--lg">
          <Card title="Rincian">
            <KeyValue
              columns={2}
              items={[
                { label: 'Jenis', translate: true, value: workflowTypeLabel(request.workflowType) },
                { label: 'Kategori', value: request.category },
                { label: 'Tanggal pengajuan', value: formatDate(request.requestDate) },
                { label: 'Tanggal bayar yang diminta', value: request.requestedPaymentDate ? formatDate(request.requestedPaymentDate) : null },
                employee ? null : { label: 'Jatuh tempo', value: request.dueDate ? formatDate(request.dueDate) : null },
                { label: 'Keterangan dan referensi', value: request.description ? <span className="fin-text">{request.description}</span> : null },
                request.notes ? { label: 'Catatan untuk Finance', value: <span data-no-translate="" className="fin-text">{request.notes}</span> } : null,
              ]}
            />
          </Card>

          <Card title="Penerima dan nilai">
            <KeyValue
              columns={2}
              items={employee ? [
                { label: 'Karyawan', value: request.payeeName || request.requesterName },
                { label: 'Rekening', translate: true, value: PAYROLL_NOTE },
                { label: 'Subtotal', value: money(request.amount) },
                { label: 'Pajak', value: money(request.taxAmount) },
                { label: 'Total', value: <span className="pw-strong">{money(request.totalAmount)}</span> },
              ] : [
                { label: 'Penerima', value: request.payeeName ? <>{request.payeeName}{request.payeeType ? <> (<Translate>{PAYEE_TYPES[request.payeeType] || request.payeeType}</Translate>)</> : ''}</> : null },
                { label: 'Bank', value: request.payeeBank },
                { label: 'Nomor rekening', value: request.payeeAccountNumber },
                { label: 'Atas nama', value: request.payeeAccountName },
                { label: 'Subtotal', value: money(request.amount) },
                { label: 'Pajak', value: money(request.taxAmount) },
                { label: 'Total', value: <span className="pw-strong">{money(request.totalAmount)}</span> },
              ]}
            />
          </Card>

          <Card title="Lampiran" actions={request.can?.attach ? <Button variant="secondary" icon="attach_file" onClick={openAttach}>Lampirkan</Button> : null}>
            <div className="pw-stack">
              {missingRequired.length && request.can?.submit ? (
                <Banner tone="warning">{`Wajib dilampirkan sebelum diajukan: ${missingRequired.map(attachmentTypeLabel).join(', ')}.`}</Banner>
              ) : null}
              {attachments.length ? (
                <ul className="fin-list">
                  {attachments.map((a) => (
                    <li key={a.id} className="fin-list__item">
                      {a.webViewLink ? <a href={a.webViewLink} target="_blank" rel="noreferrer" data-no-translate={a.name ? '' : undefined}>{a.name || 'Lampiran'}</a> : <span data-no-translate={a.name ? '' : undefined}>{a.name || 'Lampiran'}</span>}
                      <span className="pw-text-meta"><Mixed parts={[attachmentTypeLabel(a.attachmentType), data(a.uploadedByName), formatDateTime(a.createdAt)]} /></span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="attach_file" title="Belum ada lampiran" />}
            </div>
          </Card>

          <Card title="Pemeriksaan dokumen" actions={request.can?.check ? <Button variant="secondary" icon="fact_check" loading={busy === 'check'} onClick={runCheck}>Periksa</Button> : null}>
            <div className="pw-stack">
              <KeyValue items={[
                { label: 'Hasil', value: <StatusBadge status={docStatus.status} label={docStatus.label} /> },
                request.documentCheckAt ? { label: 'Diperiksa', value: formatDateTime(request.documentCheckAt) } : null,
              ]}
              />
              {check?.missing?.length ? (
                <Banner tone="warning" title="Dokumen wajib belum ada">{check.missing.map(attachmentTypeLabel).join(', ')}</Banner>
              ) : null}
              {checkLines.length ? (
                <ul className="fin-notes" {...strictTranslate}>
                  {checkLines.map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              ) : <p className="pw-text-helper fin-hint">Pemeriksaan melihat kelengkapan lampiran. AI hanya memberi catatan; keputusan tetap di penyetuju.</p>}
            </div>
          </Card>

          <Card title="Persetujuan">
            {steps.length ? (
              <ul className="fin-list">
                {steps.map((s) => (
                  <li key={s.id} className="fin-list__item">
                    <span className="fin-list__main">
                      <span data-no-translate={s.approverName ? '' : undefined}>{s.approverName || 'Penyetuju'}</span>
                      <StatusBadge status={stepStatusKey(s.status)} />
                    </span>
                    {s.note ? <span className="fin-text" data-no-translate="">{s.note}</span> : null}
                    <span className="pw-text-meta">
                      {s.decidedAt ? <Mixed parts={[s.decidedByName ? data(s.decidedByName) : 'Penyetuju', formatDateTime(s.decidedAt)]} /> : `Sejak ${formatDateTime(s.activatedAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="approval" title="Belum diajukan" description="Penyetuju ditentukan saat pengajuan dikirim." />}
          </Card>

          <Card title="Riwayat">
            {request.history?.length ? (
              <ul className="fin-list">
                {request.history.map((h) => (
                  <li key={h.id} className="fin-list__item">
                    <span><Mixed parts={historyParts(h)} separator=" — " /></span>
                    <span className="pw-text-meta"><Mixed parts={[h.userName ? data(h.userName) : 'Sistem', formatDateTime(h.at)]} /></span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="history" title="Belum ada riwayat" />}
          </Card>
        </div>

        <aside className="pw-stack pw-stack--lg">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Nomor', value: request.requestNumber },
              { label: 'Status', value: <StatusBadge status={request.status} /> },
              { label: 'Total', value: money(request.totalAmount) },
              { label: 'Pengaju', value: request.requesterName },
              { label: 'Divisi', translate: true, value: request.departmentName },
              { label: 'PIC Finance', value: request.financePicName },
              request.paidAt ? { label: 'Dibayar', value: <Mixed parts={[formatDateTime(request.paidAt), data(request.paidByName)]} /> } : null,
              { label: 'Nomor bukti di Accurate', value: request.accurateReference },
            ]}
            />
          </Card>
        </aside>
      </div>

      <PaymentRequestForm open={dialog === 'edit'} request={request} onClose={() => setDialog(null)} onSaved={load} />
      <ConfirmDialog
        open={dialog === 'approve'}
        title="Setujui pengajuan ini?"
        message={`${request.requestNumber} · ${money(request.totalAmount)}. Setelah disetujui, Finance memproses pembayarannya.`}
        confirmLabel="Setujui"
        tone="primary"
        loading={busy === 'approve'}
        onConfirm={() => decide('approve')}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog open={dialog === 'decline'} title="Tolak pengajuan" confirmLabel="Tolak" tone="danger" hint="Pengaju membaca alasan ini." onClose={() => setDialog(null)} onConfirm={(text) => decide('reject', text)} />
      <ReasonDialog open={dialog === 'revise'} title="Minta revisi" label="Yang perlu diperbaiki" confirmLabel="Minta revisi" hint="Pengaju memperbaiki, lalu mengajukan lagi." onClose={() => setDialog(null)} onConfirm={(text) => decide('request_revision', text)} />
      <ReasonDialog
        open={dialog === 'cancel'}
        title="Batalkan pengajuan"
        confirmLabel="Batalkan pengajuan"
        tone="danger"
        hint={request.status === 'pending_approval' ? 'Approval yang masih menunggu ikut ditarik.' : undefined}
        onClose={() => setDialog(null)}
        onConfirm={(text) => run('cancel', () => api.post(`${base}/cancel`, { reason: text }), 'Pengajuan dibatalkan')}
      />
      <ConfirmDialog
        open={dialog === 'remove'}
        title="Hapus draf ini?"
        message={`${request.requestNumber} dihapus dari daftar.`}
        confirmLabel="Hapus draf"
        tone="danger"
        loading={busy === 'remove'}
        onConfirm={async () => {
          const done = await run('remove', () => api.delete(base), 'Draf dihapus', { reload: false });
          if (done) navigate('/finance/payment-requests');
        }}
        onClose={() => setDialog(null)}
      />
      <Modal
        open={dialog === 'paid'}
        size="sm"
        title="Tandai sudah dibayar"
        onClose={busy ? undefined : () => setDialog(null)}
        footer={(
          <>
            <Button variant="text" type="button" onClick={() => setDialog(null)} disabled={Boolean(busy)}>Batal</Button>
            <Button type="submit" form={paidFormId} loading={busy === 'paid'}>Tandai dibayar</Button>
          </>
        )}
      >
        <form
          id={paidFormId}
          onSubmit={(e) => {
            e.preventDefault();
            run('paid', () => api.patch(`${base}/processing`, { status: 'paid', accurateReference: accurateReference.trim() || null }), 'Ditandai sudah dibayar');
          }}
        >
          <Input
            label="Nomor bukti di Accurate"
            value={accurateReference}
            onChange={(e) => setAccurateReference(e.target.value)}
            hint="Nomor bukti kas/bank keluar yang dicatat Finance di Accurate Online. Aplikasi tidak menulis ke Accurate."
          />
        </form>
      </Modal>
      <Modal
        open={dialog === 'attach'}
        size="sm"
        title="Lampirkan dokumen"
        onClose={busy ? undefined : () => setDialog(null)}
        footer={(
          <>
            <Button variant="text" type="button" onClick={() => setDialog(null)} disabled={Boolean(busy)}>Batal</Button>
            <Button type="submit" form={attachFormId} loading={busy === 'attach'}>Lampirkan</Button>
          </>
        )}
      >
        <form id={attachFormId} className="pw-stack" onSubmit={sendAttachment}>
          <Select label="Jenis dokumen" value={upload.type} onChange={(e) => setUpload((u) => ({ ...u, type: e.target.value }))} options={ATTACHMENT_TYPES} />
          <Input
            label="File"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            onChange={(e) => setUpload((u) => ({ ...u, file: e.target.files?.[0] || null, error: '' }))}
            error={upload.error}
            hint="PDF atau foto, paling besar 10 MB. Disimpan di Shared Drive."
          />
        </form>
      </Modal>
    </Page>
  );
}
