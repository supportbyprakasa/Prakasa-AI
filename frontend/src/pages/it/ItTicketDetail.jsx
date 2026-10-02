import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PriorityBadge from '../../components/PriorityBadge';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  CATEGORY_LABELS, STATUS_LABELS, allowedNextStatuses, ticketActions, transitionLabel,
} from './itTicketModel';
import './it-tickets.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// Prakasa AI may draft the reply; the user reads it and presses "Kirim
// tanggapan". The ticket's status and its attachments are not part of this
// form and stay with the user (docs/prakasa-ai-rencana.md §9.9).
const AI_COMMENT = defineAIForm({
  id: 'it-ticket-comment',
  title: 'Tanggapan tiket IT',
  permission: 'it_ticket.comment',
  submitLabel: 'Kirim tanggapan',
  fields: [
    f.textarea('comment', 'Tanggapan', { required: true, maxLength: 4000 }),
  ],
});

export default function ItTicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions?.includes('it_ticket.manage'));
  const fileInputRef = useRef(null);

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingTo, setChangingTo] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get(`/it/tickets/${id}`);
      setTicket(response.data.data);
    } catch (error) {
      setLoadError(errorMessage(error, 'Tiket tidak dapat dimuat'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const ai = usePrakasaAIForm(AI_COMMENT, {
    enabled: Boolean(ticket),
    values: { comment },
    setters: { comment: setComment },
    initialValues: { comment: '' },
  });

  if (loading && !ticket) return <Page><LoadingState label="Memuat tiket…" /></Page>;
  if (loadError || !ticket) {
    return (
      <Page>
        <EmptyState
          tone="error"
          title="Tiket tidak dapat dimuat"
          description={loadError || undefined}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const isRequester = Number(ticket.requester_id) === Number(user?.id);
  const requesterCanCancel = isRequester && !canManage && allowedNextStatuses(ticket.status, 'requester').includes('cancelled');
  const actions = canManage ? ticketActions(ticket.status) : { primary: null, secondary: [], canCancel: false };
  const changing = Boolean(changingTo);

  const changeStatus = async (status) => {
    setChangingTo(status);
    try {
      await api.patch(`/it/tickets/${id}/status`, { status });
      toast('Status tiket diperbarui', 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Status gagal diperbarui'), 'error');
    } finally {
      setChangingTo('');
    }
  };

  // Closing is final (no way back), so it asks first like cancelling does.
  const requestStatus = (status) => {
    if (status === 'closed') setConfirmClose(true);
    else changeStatus(status);
  };

  const closeTicket = async () => {
    setConfirmClose(false);
    await changeStatus('closed');
  };

  const cancelTicket = async () => {
    setConfirmCancel(false);
    await changeStatus('cancelled');
  };

  const submitComment = async (event) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await api.post(`/it/tickets/${id}/comments`, { body: comment.trim() });
      setComment('');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Tanggapan gagal dikirim'), 'error');
    } finally {
      setPosting(false);
    }
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    try {
      await api.post(`/it/tickets/${id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('Lampiran diunggah', 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Lampiran gagal diunggah'), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deviceLabel = ticket.deviceAssetCode
    ? `${ticket.deviceAssetCode} · ${[ticket.deviceBrand, ticket.deviceModel].filter(Boolean).join(' ') || ticket.deviceType}`
    : null;
  const attachments = ticket.attachments || [];
  const comments = ticket.comments || [];

  return (
    <Page
      eyebrow="Tiket IT"
      title={ticket.title}
      dataTitle
      description={(
        <span className="pw-row">
          <StatusBadge status={ticket.status} label={STATUS_LABELS[ticket.status]} />
          <PriorityBadge priority={ticket.priority} />
          <span data-no-translate={CATEGORY_LABELS[ticket.category] ? undefined : ''}>{CATEGORY_LABELS[ticket.category] || ticket.category}</span>
        </span>
      )}
      actions={(
        <>
          {requesterCanCancel ? (
            <Button variant="danger" icon="close" onClick={() => setConfirmCancel(true)} disabled={changing}>Batalkan tiket</Button>
          ) : null}
          {actions.secondary.map((status) => (
            <Button key={status} variant="secondary" onClick={() => requestStatus(status)} loading={changingTo === status} disabled={changing}>
              {transitionLabel(ticket.status, status)}
            </Button>
          ))}
          {actions.primary ? (
            <Button onClick={() => requestStatus(actions.primary)} loading={changingTo === actions.primary} disabled={changing}>
              {transitionLabel(ticket.status, actions.primary)}
            </Button>
          ) : null}
          {actions.canCancel ? (
            <ActionMenu
              items={[{ label: 'Batalkan tiket', icon: 'close', tone: 'danger', disabled: changing, onClick: () => setConfirmCancel(true) }]}
            />
          ) : null}
        </>
      )}
    >
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card title="Deskripsi">
            <p className="it-ticket-detail__description" data-no-translate="">{ticket.description}</p>
          </Card>

          <Card
            title={`Lampiran (${attachments.length})`}
            actions={(
              <>
                <input ref={fileInputRef} type="file" className="sr-only" tabIndex={-1} aria-label="Pilih file lampiran tiket" onChange={uploadFile} />
                <Button variant="secondary" icon="attach_file" onClick={() => fileInputRef.current?.click()} loading={uploading}>
                  Lampirkan file
                </Button>
              </>
            )}
          >
            {attachments.length ? (
              <ul className="it-lines">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="it-line">
                    <a data-no-translate="" className="it-line__main pw-link" href={attachment.webViewLink} target="_blank" rel="noreferrer">{attachment.name}</a>
                    <span className="it-line__meta">{formatDateTime(attachment.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="attach_file" title="Belum ada lampiran" />}
          </Card>

          <Card title="Percakapan">
            <div className="pw-stack">
              {comments.length ? (
                <ul className="it-ticket-comments">
                  {comments.map((item) => (
                    <li key={item.id} className="it-ticket-comment">
                      <div className="it-ticket-comment__meta">
                        <span data-no-translate="" className="it-ticket-comment__author">{item.authorName}</span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                      <p data-no-translate="">{item.body}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="chat" title="Belum ada percakapan" />}
              <form className="pw-stack" onSubmit={submitComment}>
                {ai.notice}
                <Textarea
                  label="Tanggapan"
                  rows={3}
                  value={comment}
                  {...ai.field('comment')}
                  onChange={(event) => setComment(event.target.value)}
                />
                <FormActions>
                  <Button type="submit" icon="send" loading={posting} disabled={!comment.trim()}>Kirim tanggapan</Button>
                </FormActions>
              </form>
            </div>
          </Card>
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Status', value: <StatusBadge status={ticket.status} label={STATUS_LABELS[ticket.status]} /> },
              { label: 'Prioritas', value: <PriorityBadge priority={ticket.priority} /> },
              { label: 'Kategori', translate: true, value: CATEGORY_LABELS[ticket.category] || ticket.category },
              { label: 'Pengaju', value: [ticket.requesterName, ticket.requesterEmail].filter(Boolean).join(' · ') },
              { label: 'Diajukan', value: formatDateTime(ticket.created_at) },
              deviceLabel ? { label: 'Perangkat', value: deviceLabel } : null,
              canManage && ticket.trackerIssue ? {
                label: 'Project Tracker',
                value: <Link to={ticket.trackerIssue.link}>{`${ticket.trackerIssue.key} · ${ticket.trackerIssue.projectName}`}</Link>,
              } : null,
            ]}
            />
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Batalkan tiket ini?"
        message={requesterCanCancel
          ? `Tiket "${ticket.title}" ditandai dibatalkan dan tim IT diberi tahu.`
          : `Tiket "${ticket.title}" ditandai dibatalkan.`}
        confirmLabel="Batalkan tiket"
        tone="danger"
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancelTicket}
      />

      <ConfirmDialog
        open={confirmClose}
        title="Tutup tiket ini?"
        message={`Tiket "${ticket.title}" ditutup dan tidak bisa dibuka lagi.`}
        confirmLabel="Tutup tiket"
        onClose={() => setConfirmClose(false)}
        onConfirm={closeTicket}
      />
    </Page>
  );
}
