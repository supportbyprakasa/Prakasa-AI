import { useCallback, useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import { Translate, Mixed, data } from '../../i18n/NoTranslate';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import ReasonDialog from '../../components/ReasonDialog';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatQty } from '../../components/format';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  APPROVER_BASIS_LABELS, ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS,
  apiErrorMessage, formatWib, historyLabel, processorMatches, requestActions, requestStatusKey, targetText,
} from './gaModel';
import './ga.css';

// "Tugaskan permintaan" as Prakasa AI may fill it: the person is looked up in
// the list the Select already loaded (GET /ga/processors), and set only when
// exactly one name matches. The user presses Tugaskan. The decisions of this
// page (setujui, tolak, selesaikan, batalkan) and the upload are not registered.
const AI_ASSIGN = defineAIForm({
  id: 'ga-request-assign', title: 'Tugaskan permintaan', permission: 'ga.request.process', submitLabel: 'Tugaskan', mode: 'edit',
  fields: ({ searchProcessor, nameOf }) => [
    f.person('assignee', 'Penanggung jawab', searchProcessor, { required: true, labelOf: nameOf }),
  ],
});

// Detail of one GA request (§3.5, §3.2 of the admin-console guideline): actions
// in the header by role and state — Setujui/Tolak for the approver, Proses /
// Selesaikan / Tolak for People & Culture, Batalkan for the requester.
export default function GaRequestDetail() {
  const { id } = useParams();
  const attachFormId = useId();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null); // approve | decline | finish | reject | cancel | assign | attach
  const [busy, setBusy] = useState(false);
  const [processors, setProcessors] = useState([]);
  const [processorsFor, setProcessorsFor] = useState(null); // the dialog opening the list was loaded for
  const [assignee, setAssignee] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/ga/requests/${id}`);
      setRequest(r.data.data);
    } catch (error) {
      setLoadError(error?.response?.status === 404 ? 'Permintaan ini tidak ada atau bukan untuk Anda.' : apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (dialog !== 'assign') { setProcessorsFor(null); return; }
    setAssignee(request?.assignee?.id ? String(request.assignee.id) : '');
    api.get('/ga/processors').then((r) => { setProcessors(r.data.data || []); setProcessorsFor(request?.id || null); }).catch(() => setProcessors([]));
  }, [dialog, request]);

  // /ga/requests/<id>?form=tugaskan opens the dialog, when this user may assign.
  useOpenFromUrl('form', (name) => {
    if (name === 'tugaskan' && request?.can?.assign) setDialog('assign');
  }, { enabled: Boolean(request) });

  const ai = usePrakasaAIForm(AI_ASSIGN, {
    // Once the people to choose from have loaded.
    enabled: dialog === 'assign' && Boolean(request) && processorsFor === request?.id,
    record: { type: 'ga_request', id: request?.id },
    values: { assignee },
    setters: { assignee: setAssignee },
    initialValues: { assignee: request?.assignee?.id ? String(request.assignee.id) : '' },
    context: {
      searchProcessor: async (text) => processorMatches(processors, text),
      nameOf: (value) => processors.find((p) => String(p.id) === String(value))?.name || '',
    },
  });

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      toast(success, 'success');
      setDialog(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Belum berhasil. Coba lagi.'), 'error');
      if (error?.response?.data?.error?.code === 'VERSION_CONFLICT') await load();
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (status, note) => run(
    () => api.post(`/ga/requests/${id}/status`, { status, note: note || null, version: request.version }),
    { in_progress: 'Permintaan diproses', done: 'Permintaan selesai', rejected: 'Permintaan ditolak' }[status],
  );
  const decide = (action, note) => run(
    () => api.post(`/approvals/${request.approvalRequestId}/decide`, { action, note: note || null }),
    action === 'approve' ? 'Permintaan disetujui' : 'Permintaan ditolak',
  );

  if (loading && !request) return <Page><LoadingState label="Memuat permintaan" /></Page>;
  if (loadError || !request) {
    return (
      <Page>
        <EmptyState tone="error" title="Permintaan tidak dapat dimuat" description={loadError || undefined} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }

  const actions = requestActions(request);
  const BUTTONS = {
    approve: { label: 'Setujui', icon: 'check', onClick: () => setDialog('approve') },
    decline: { label: 'Tolak', icon: 'close', onClick: () => setDialog('decline') },
    start: { label: 'Proses', icon: 'play_arrow', onClick: () => setStatus('in_progress') },
    finish: { label: 'Selesaikan', icon: 'task_alt', onClick: () => setDialog('finish') },
    reject: { label: 'Tolak', icon: 'block', onClick: () => setDialog('reject') },
    assign: { label: 'Tugaskan ke…', icon: 'person', onClick: () => setDialog('assign') },
    attach: { label: 'Lampirkan foto/PDF', icon: 'attach_file', onClick: () => { setFile(null); setFileError(''); setDialog('attach'); } },
    cancel: { label: 'Batalkan permintaan', icon: 'cancel', tone: 'danger', onClick: () => setDialog('cancel') },
  };
  const header = (
    <>
      {actions.secondary.map((k) => <Button key={k} variant="secondary" icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick} disabled={busy}>{BUTTONS[k].label}</Button>)}
      {actions.primary.map((k) => <Button key={k} icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick} loading={busy && k === 'start'}>{BUTTONS[k].label}</Button>)}
      {actions.menu.length ? <ActionMenu label="Aksi lainnya" items={actions.menu.map((k) => BUTTONS[k])} /> : null}
    </>
  );

  const typeLabel = REQUEST_TYPE_LABELS[request.requestType] || request.typeLabel;
  const outcome = request.status === 'done' ? { label: 'Catatan penyelesaian', value: request.resolutionNote }
    : request.status === 'rejected' ? { label: 'Alasan ditolak', value: request.rejectedReason }
      : request.status === 'cancelled' ? { label: 'Alasan dibatalkan', value: request.cancelReason } : null;

  const upload = async (event) => {
    event.preventDefault();
    if (!file) { setFileError('Pilih file.'); return; }
    if (file.size > MAX_ATTACHMENT_BYTES || !ATTACHMENT_ACCEPT.split(',').includes(file.type)) { setFileError('Foto (PNG, JPG, WebP) atau PDF, paling besar 10 MB.'); return; }
    const data = new FormData();
    data.append('file', file);
    await run(() => api.post(`/ga/requests/${id}/attachments`, data), 'Lampiran ditambahkan');
  };

  return (
    <Page
      eyebrow={`Permintaan GA · ${typeLabel}`}
      title={request.title}
      // "ATK: <barang> (+2 barang lain)" is composed by the server; an "other"
      // request carries the title its requester typed.
      dataTitle="strict"
      description={(
        <span className="pw-row">
          <StatusBadge status={requestStatusKey(request.status)} label={REQUEST_STATUS_LABELS[request.status]} />
          {request.overdue ? <StatusBadge status="ga_overdue" /> : null}
          <span data-no-translate="">{request.requestNumber}</span>
        </span>
      )}
      actions={header}
    >
      {request.status === 'pending_approval' ? (
        <Banner tone="info">
          {`Menunggu persetujuan ${APPROVER_BASIS_LABELS[request.approverBasis]?.toLowerCase() || 'atasan'}. Target waktu 5 hari dihitung sejak disetujui.`}
        </Banner>
      ) : null}
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card title="Rincian">
            <KeyValue items={[
              { label: 'Jenis', translate: true, value: typeLabel },
              { label: 'Lokasi', value: request.locationName },
              request.area ? { label: 'Area atau objek', value: request.area } : null,
              request.requestType === 'facility_repair' ? { label: 'Mendesak', translate: true, value: request.urgency === 'urgent' ? 'Ya (target 1 hari)' : 'Tidak' } : null,
              { label: request.requestType === 'atk' ? 'Catatan' : 'Uraian', value: request.description },
            ]}
            />
            {request.items?.length ? (
              <ul className="ga-items" aria-label="Daftar barang">
                {request.items.map((item) => (
                  <li key={item.id} className="ga-items__row">
                    <span data-no-translate="">{item.itemName}</span>
                    <span className="ga-items__qty" data-no-translate="">{formatQty(item.qty, item.unit)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card title="Lampiran" actions={request.can?.attach ? <Button variant="secondary" icon="attach_file" onClick={BUTTONS.attach.onClick}>Lampirkan</Button> : null}>
            {request.attachments?.length ? (
              <ul className="ga-history">
                {request.attachments.map((a) => (
                  <li key={a.id} className="ga-history__item">
                    {a.webViewLink ? <a data-no-translate="" href={a.webViewLink} target="_blank" rel="noreferrer">{a.name}</a> : <span data-no-translate="">{a.name}</span>}
                    <span className="pw-text-meta"><Mixed parts={[data(a.uploadedByName), formatWib(a.createdAt)]} /></span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="attach_file" title="Belum ada lampiran" />}
          </Card>
          <Card title="Riwayat">
            {request.history?.length ? (
              <ul className="ga-history">
                {request.history.map((h) => (
                  <li key={h.id} className="ga-history__item">
                    <span>
                      {historyLabel(h.action)}
                      {h.metadata?.note ? <>{' — '}<span data-no-translate="">{h.metadata.note}</span></> : null}
                      {h.metadata?.reason ? <>{' — '}<span data-no-translate="">{h.metadata.reason}</span></> : null}
                    </span>
                    <span className="pw-text-meta"><Mixed parts={[h.userName ? data(h.userName) : 'Sistem', formatWib(h.at)]} /></span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="history" title="Belum ada riwayat" />}
          </Card>
        </div>
        <aside className="pw-stack">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Nomor', value: request.requestNumber },
              { label: 'Pengaju', value: request.requester?.name },
              { label: 'Divisi', translate: true, value: request.departmentName },
              { label: 'Penanggung jawab', value: request.assignee?.name || (['open', 'in_progress'].includes(request.status) ? <Translate>Belum ditugaskan</Translate> : null) },
              { label: 'Dibuat', value: formatWib(request.createdAt) },
              { label: 'Target', translate: true, value: <span className={request.overdue ? 'ga-late' : undefined}>{targetText(request)}</span> },
              request.slaDays ? { label: 'Target waktu', translate: true, value: `${request.slaDays} hari` } : null,
              request.doneAt ? { label: 'Selesai', translateContext: 'completed', value: formatWib(request.doneAt) } : null,
              request.approverBasis ? { label: 'Penyetuju', value: APPROVER_BASIS_LABELS[request.approverBasis] } : null,
              outcome,
            ]}
            />
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        title="Setujui permintaan ini?"
        message="People & Culture akan memprosesnya dengan target 5 hari sejak sekarang."
        confirmLabel="Setujui"
        tone="primary"
        loading={busy}
        onConfirm={() => decide('approve')}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog open={dialog === 'decline'} title="Tolak permintaan" confirmLabel="Tolak" tone="danger" hint="Pengaju bisa mengajukan ulang setelah membaca alasan ini." onClose={() => setDialog(null)} onConfirm={(text) => decide('reject', text)} />
      <ReasonDialog open={dialog === 'finish'} title="Selesaikan permintaan" label="Catatan penyelesaian" confirmLabel="Selesaikan" hint="Contoh: barang sudah diserahkan ke meja pengaju." onClose={() => setDialog(null)} onConfirm={(text) => setStatus('done', text)} />
      <ReasonDialog open={dialog === 'reject'} title="Tolak permintaan" confirmLabel="Tolak" tone="danger" onClose={() => setDialog(null)} onConfirm={(text) => setStatus('rejected', text)} />
      <ReasonDialog
        open={dialog === 'cancel'}
        title="Batalkan permintaan"
        confirmLabel="Batalkan permintaan"
        tone="danger"
        onClose={() => setDialog(null)}
        onConfirm={(text) => run(() => api.post(`/ga/requests/${id}/cancel`, { reason: text, version: request.version }), 'Permintaan dibatalkan')}
      />
      <Modal
        open={dialog === 'assign'}
        size="sm"
        title="Tugaskan permintaan"
        onClose={busy ? undefined : () => setDialog(null)}
        footer={(
          <>
            <Button variant="text" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</Button>
            <Button type="button" loading={busy} disabled={!assignee} onClick={() => run(() => api.post(`/ga/requests/${id}/assign`, { userId: Number(assignee) }), 'Penanggung jawab diubah')}>Tugaskan</Button>
          </>
        )}
      >
        {ai.notice}
        <Select label="Penanggung jawab" value={assignee} {...ai.field('assignee')} onChange={(e) => setAssignee(e.target.value)} placeholder="" options={processors.map((p) => ({ value: String(p.id), label: p.name }))} dataOptions />
      </Modal>
      <Modal
        open={dialog === 'attach'}
        size="sm"
        title="Lampirkan foto atau PDF"
        onClose={busy ? undefined : () => setDialog(null)}
        footer={(
          <>
            <Button variant="text" type="button" onClick={() => setDialog(null)} disabled={busy}>Batal</Button>
            <Button type="submit" form={attachFormId} loading={busy}>Lampirkan</Button>
          </>
        )}
      >
        <form id={attachFormId} onSubmit={upload}>
          <Input label="File" type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] || null); setFileError(''); }} error={fileError} hint="Paling besar 10 MB, paling banyak 3 lampiran. Disimpan di Shared Drive." />
        </form>
      </Modal>
    </Page>
  );
}
