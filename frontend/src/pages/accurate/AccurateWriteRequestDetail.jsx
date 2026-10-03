import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import ReasonDialog from '../../components/ReasonDialog';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime } from '../../components/format';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { Mixed, data } from '../../i18n/NoTranslate';
import { apiError } from '../sales/salesModel';
import {
  ACTION_LABEL, RECORD_LABEL, canCancel, changeLines, nextStepText, requestStatus,
} from './accurateWriteModel';

// One proposal to Accurate: what changes, who asked, where it stands, and the
// decision (Supervisor or Head, through the approval engine). Nothing on this
// page sends anything to Accurate.
const CHANGE_COLUMNS = [
  { key: 'label', header: 'Kolom', translate: true },
  { key: 'before', header: 'Di Accurate sekarang', render: (c) => c.before ?? '—' },
  { key: 'after', header: 'Diajukan', render: (c) => c.after ?? '—' },
];

export default function AccurateWriteRequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', request: null, steps: [] });
  const [modal, setModal] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/accurate-write/requests/${id}`);
      const request = r.data.data;
      let steps = [];
      if (request.status === 'pending' && request.approvalRequestId) {
        steps = await api.get(`/approvals/${request.approvalRequestId}/my-pending-steps`).then((s) => s.data.data || []).catch(() => []);
      }
      setState({ loading: false, error: '', request, steps });
    } catch (err) {
      setState({ loading: false, error: apiError(err), request: null, steps: [] });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (action, note) => {
    setBusy(true);
    try {
      await api.post(`/approvals/${state.request.approvalRequestId}/decide`, { action, note: note || null, stepId: state.steps[0]?.id });
      toast(action === 'approve' ? 'Disetujui. Pengajuan masuk antrean kirim ke Accurate.' : 'Pengajuan ditolak; tidak ada yang dikirim ke Accurate.', 'success');
      setModal('');
      await load();
    } catch (err) {
      toast(apiError(err, 'Keputusan gagal disimpan'), 'error');
    } finally { setBusy(false); }
  };
  const cancel = async (note) => {
    setBusy(true);
    try {
      await api.post(`/accurate-write/requests/${id}/cancel`, { note });
      toast('Pengajuan dibatalkan.', 'success');
      setModal('');
      await load();
    } catch (err) {
      toast(apiError(err, 'Pengajuan gagal dibatalkan'), 'error');
    } finally { setBusy(false); }
  };

  if (state.loading) return <Page><LoadingState label="Memuat pengajuan…" /></Page>;
  if (state.error) {
    return (
      <Page>
        <EmptyState tone="error" title="Pengajuan belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={() => { setState((s) => ({ ...s, loading: true })); load(); }}>Coba lagi</Button>} />
      </Page>
    );
  }
  const { request } = state;
  const status = requestStatus(request.status);
  const mayDecide = request.status === 'pending' && state.steps.length > 0 && Number(request.requestedBy) !== Number(user?.sub ?? user?.id);
  const mayCancel = canCancel(request, user);
  const changes = changeLines(request).map((c, i) => ({ ...c, id: i }));

  return (
    <Page>
      <PageHeader
        eyebrow="Pengajuan ke Accurate"
        dataTitle
        title={request.name || request.title}
        description={(
          <span className="pw-row">
            <StatusBadge status={status.status} label={status.label} />
            <span><Mixed parts={[`${RECORD_LABEL[request.recordType] || request.recordType} · ${ACTION_LABEL[request.action] || request.action}`, data(request.number), data(request.departmentName)]} /></span>
          </span>
        )}
        actions={(mayDecide || mayCancel) ? (
          <>
            {mayCancel ? <Button variant="secondary" icon="close" onClick={() => setModal('cancel')}>Batalkan pengajuan</Button> : null}
            {mayDecide ? <Button variant="danger" icon="block" onClick={() => setModal('reject')}>Tolak</Button> : null}
            {mayDecide ? <Button icon="check" onClick={() => setModal('approve')}>Setujui</Button> : null}
          </>
        ) : null}
      />
      <Banner tone={request.status === 'failed' ? 'error' : request.status === 'confirmed' ? 'success' : 'info'}>{nextStepText(request)}</Banner>
      {request.status === 'queued' && request.sendEnabled === false ? (
        <Banner tone="warning">Saluran kirim ke Accurate belum dinyalakan, jadi pengajuan ini menunggu di antrean. Tidak ada yang dikirim sampai pemilik membukanya.</Banner>
      ) : null}
      <div className="pw-cols-sidebar">
        <div className="pw-stack pw-stack--lg">
          <DataGrid title={request.action === 'update' ? 'Yang berubah' : 'Data yang diajukan'} columns={CHANGE_COLUMNS} rows={changes} searchable={false} exportName={`pengajuan-accurate-${request.id}`} empty="Tidak ada kolom." />
        </div>
        <div className="pw-stack pw-stack--lg">
          <Card title="Riwayat">
            <KeyValue items={[
              { label: 'Diajukan oleh', value: <Mixed parts={[data(request.requestedByName), formatDateTime(request.createdAt)]} /> },
              { label: 'Divisi yang memutuskan', value: request.departmentName, translate: true },
              request.decidedAt ? { label: request.status === 'cancelled' ? 'Dibatalkan oleh' : 'Diputuskan oleh', value: <Mixed parts={[data(request.decidedByName), formatDateTime(request.decidedAt)]} /> } : null,
              request.decisionNote ? { label: 'Catatan', value: request.decisionNote } : null,
              request.sentAt ? { label: 'Dikirim ke Accurate', value: formatDateTime(request.sentAt) } : null,
              request.confirmedAt ? { label: 'Terkonfirmasi', value: formatDateTime(request.confirmedAt) } : null,
              request.attempts ? { label: 'Percobaan kirim', value: String(request.attempts) } : null,
              request.accurateId ? { label: 'ID di Accurate', value: request.accurateId } : null,
            ]}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={modal === 'approve'}
        title="Setujui pengajuan ke Accurate?"
        message="Data masuk antrean kirim ke Accurate. Belum ada yang dikirim sampai saluran kirim dinyalakan, dan data dianggap selesai setelah tarikan berikutnya menampilkannya."
        confirmLabel="Setujui"
        tone="primary"
        loading={busy}
        onConfirm={() => decide('approve')}
        onClose={() => setModal('')}
      />
      <ReasonDialog
        open={modal === 'reject'}
        title="Tolak pengajuan"
        description="Pengaju membaca alasan ini. Tidak ada yang dikirim ke Accurate."
        confirmLabel="Tolak"
        tone="danger"
        onConfirm={(note) => decide('reject', note)}
        onClose={() => setModal('')}
      />
      <ReasonDialog
        open={modal === 'cancel'}
        title="Batalkan pengajuan"
        description="Pengajuan ditarik sebelum dikirim ke Accurate."
        confirmLabel="Batalkan pengajuan"
        tone="danger"
        onConfirm={cancel}
        onClose={() => setModal('')}
      />
    </Page>
  );
}
