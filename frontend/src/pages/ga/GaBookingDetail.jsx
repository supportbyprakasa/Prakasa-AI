import { Mixed, data } from '../../i18n/NoTranslate';
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
import ReasonDialog from '../../components/ReasonDialog';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import {
  APPROVER_BASIS_LABELS, BOOKING_STATUS_LABELS, RESOURCE_KIND_LABELS, apiErrorMessage, bookingActions, bookingStatusKey,
  formatWib, formatWibRange, historyLabel,
} from './gaModel';
import './ga.css';

// Detail of one room/vehicle booking (§3.5): Setujui/Tolak for the approver of
// a vehicle, Serahkan kunci / Terima kembali for People & Culture, Batalkan for
// the borrower before the start (or GA at any time before it is in use).
export default function GaBookingDetail() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/ga/bookings/${id}`);
      setBooking(r.data.data);
    } catch (error) {
      setLoadError(error?.response?.status === 404 ? 'Peminjaman ini tidak ada atau bukan untuk Anda.' : apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      toast(success, 'success');
      setDialog(null);
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Belum berhasil. Coba lagi.'), 'error');
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const decide = (action, note) => run(
    () => api.post(`/approvals/${booking.approvalRequestId}/decide`, { action, note: note || null }),
    action === 'approve' ? 'Peminjaman disetujui' : 'Peminjaman ditolak',
  );

  if (loading && !booking) return <Page><LoadingState label="Memuat peminjaman" /></Page>;
  if (loadError || !booking) {
    return (
      <Page>
        <EmptyState tone="error" title="Peminjaman tidak dapat dimuat" description={loadError || undefined} action={<Button variant="secondary" onClick={load}>Coba lagi</Button>} />
      </Page>
    );
  }

  const vehicle = booking.resourceKind === 'vehicle';
  const actions = bookingActions(booking);
  const BUTTONS = {
    approve: { label: 'Setujui', icon: 'check', onClick: () => setDialog('approve') },
    decline: { label: 'Tolak', icon: 'close', onClick: () => setDialog('decline') },
    checkout: { label: 'Serahkan kunci', icon: 'key', onClick: () => setDialog('checkout') },
    return: { label: 'Terima kembali', icon: 'assignment_return', onClick: () => setDialog('return') },
    cancel: { label: 'Batalkan', icon: 'cancel', onClick: () => setDialog('cancel') },
  };

  return (
    <Page
      eyebrow={`Peminjaman ${RESOURCE_KIND_LABELS[booking.resourceKind]?.toLowerCase() || ''}`.trim()}
      title={booking.resourceName}
      dataTitle
      description={(
        <span className="pw-row">
          <StatusBadge status={booking.late ? 'booking_late' : bookingStatusKey(booking.status)} label={booking.late ? undefined : BOOKING_STATUS_LABELS[booking.status]} />
          <span><Mixed parts={[data(booking.bookingNumber), formatWibRange(booking.startsAt, booking.endsAt)]} /></span>
        </span>
      )}
      actions={(
        <>
          {actions.secondary.map((k) => <Button key={k} variant="secondary" icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick} disabled={busy}>{BUTTONS[k].label}</Button>)}
          {actions.primary.map((k) => <Button key={k} icon={BUTTONS[k].icon} onClick={BUTTONS[k].onClick}>{BUTTONS[k].label}</Button>)}
        </>
      )}
    >
      {booking.status === 'pending_approval' ? (
        <Banner tone="info">
          {`Menunggu persetujuan ${APPROVER_BASIS_LABELS[booking.approverBasis]?.toLowerCase() || 'atasan'}. Bila belum disetujui saat jam mulai, peminjaman otomatis kedaluwarsa.`}
        </Banner>
      ) : null}
      {booking.late ? <Banner tone="warning">Kendaraan belum dikembalikan setelah jam selesai.</Banner> : null}
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card title="Rincian">
            <KeyValue items={[
              { label: RESOURCE_KIND_LABELS[booking.resourceKind], value: [booking.resourceName, booking.plateNumber].filter(Boolean).join(' · ') },
              { label: 'Lokasi', value: booking.locationName },
              { label: 'Waktu', value: formatWibRange(booking.startsAt, booking.endsAt) },
              { label: vehicle ? 'Keperluan' : 'Keperluan', value: booking.purpose },
              vehicle ? { label: 'Tujuan', value: booking.destination } : null,
              vehicle ? { label: 'Sopir', translate: !(booking.needsDriver && booking.driverName), value: booking.needsDriver ? (booking.driverName || 'Dibutuhkan, belum ditentukan') : 'Tidak' } : null,
            ]}
            />
          </Card>
          <Card title="Riwayat">
            {booking.history?.length ? (
              <ul className="ga-history">
                {booking.history.map((h) => (
                  <li key={h.id} className="ga-history__item">
                    <span>{historyLabel(h.action)}</span>
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
              { label: 'Nomor', value: booking.bookingNumber },
              { label: 'Peminjam', value: booking.requester?.name },
              { label: 'Divisi', translate: true, value: booking.departmentName },
              booking.approverBasis ? { label: 'Penyetuju', value: APPROVER_BASIS_LABELS[booking.approverBasis] } : null,
              booking.checkedOutAt ? { label: 'Kunci diserahkan', value: formatWib(booking.checkedOutAt) } : null,
              booking.returnedAt ? { label: 'Dikembalikan', value: formatWib(booking.returnedAt) } : null,
              booking.returnNote ? { label: 'Catatan pengembalian', value: booking.returnNote } : null,
              booking.decisionNote ? { label: booking.status === 'expired' ? 'Alasan kedaluwarsa' : 'Catatan penyetuju', value: booking.decisionNote } : null,
              booking.cancelReason ? { label: 'Alasan dibatalkan', value: booking.cancelReason } : null,
            ]}
            />
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === 'approve'}
        title="Setujui peminjaman ini?"
        message={`${booking.resourceName} · ${formatWibRange(booking.startsAt, booking.endsAt)}`}
        confirmLabel="Setujui"
        tone="primary"
        loading={busy}
        onConfirm={() => decide('approve')}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog open={dialog === 'decline'} title="Tolak peminjaman" confirmLabel="Tolak" tone="danger" hint="Peminjam bisa mengajukan ulang." onClose={() => setDialog(null)} onConfirm={(text) => decide('reject', text)} />
      <ConfirmDialog
        open={dialog === 'checkout'}
        title="Serahkan kunci kendaraan?"
        message={`${booking.resourceName} dipinjam ${booking.requester?.name || ''} sampai ${formatWib(booking.endsAt)}.`}
        confirmLabel="Serahkan kunci"
        tone="primary"
        loading={busy}
        onConfirm={() => run(() => api.post(`/ga/bookings/${id}/checkout`, {}), 'Kunci diserahkan')}
        onClose={() => setDialog(null)}
      />
      <ReasonDialog
        open={dialog === 'return'}
        title="Terima kembali kendaraan"
        label="Catatan"
        required={false}
        hint="Opsional: bensin, kebersihan, kerusakan."
        confirmLabel="Terima kembali"
        onClose={() => setDialog(null)}
        onConfirm={(text) => run(() => api.post(`/ga/bookings/${id}/return`, { note: text || null }), 'Kendaraan diterima kembali')}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        title="Batalkan peminjaman"
        confirmLabel="Batalkan peminjaman"
        tone="danger"
        onClose={() => setDialog(null)}
        onConfirm={(text) => run(() => api.post(`/ga/bookings/${id}/cancel`, { reason: text }), 'Peminjaman dibatalkan')}
      />
    </Page>
  );
}
