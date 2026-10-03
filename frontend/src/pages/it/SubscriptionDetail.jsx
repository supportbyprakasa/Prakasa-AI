import { useCallback, useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import FullScreenDialog from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { EMPTY, formatDate } from '../../components/format';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { BILLING_CYCLE_LABELS, INVOICE_STATUS_LABELS, formatAmount, labelFor } from './itModel';
import './it-tickets.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
// Licence keys never come from the API (only hasLicenseKey): a seat is named by its label.
const licenseName = (license) => license?.seatLabel || (license ? `Lisensi #${license.id}` : '');

// Prakasa AI may fill the seat's label — the only field of "Tambah lisensi".
// A licence key is never typed here: the app does not store one.
const AI_LICENSE = defineAIForm({
  id: 'it-license',
  title: 'Tambah lisensi',
  permission: 'subscription.license.manage',
  submitLabel: 'Simpan lisensi',
  fields: [
    f.text('seatLabel', 'Label seat', { maxLength: 150, hint: 'Contoh: Seat #5. Jangan menulis kunci lisensi: kunci tidak disimpan di aplikasi.' }),
  ],
});

export default function SubscriptionDetail() {
  const { id } = useParams();
  const paymentFormId = useId();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [licOpen, setLicOpen] = useState(false);
  const [seatLabel, setSeatLabel] = useState('');
  useEffect(() => { if (licOpen) setSeatLabel(''); }, [licOpen]);
  const [assignLicense, setAssignLicense] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  // Set by any change in the form; closing then asks before discarding.
  const [paymentDirty, setPaymentDirty] = useState(false);
  useEffect(() => { if (paymentOpen) setPaymentDirty(false); }, [paymentOpen]);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/it/subscriptions/${id}`);
      setSub(r.data.data);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const createLicense = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setBusy('license');
    try {
      await api.post(`/it/subscriptions/${id}/licenses`, {
        seatLabel: fd.get('seatLabel') || null,
      });
      toast('Lisensi ditambahkan', 'success');
      setLicOpen(false);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Lisensi gagal ditambahkan'), 'error');
    } finally {
      setBusy('');
    }
  };

  const doAssign = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setBusy('assign');
    try {
      await api.post(`/it/licenses/${assignLicense.id}/assign`, { userId: Number(fd.get('userId')) });
      toast('Pengguna lisensi ditetapkan', 'success');
      setAssignLicense(null);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Pengguna lisensi gagal ditetapkan'), 'error');
    } finally {
      setBusy('');
    }
  };

  const doRevoke = async () => {
    setBusy('revoke');
    try {
      await api.post(`/it/licenses/${revokeTarget.id}/revoke`, {});
      toast('Lisensi dicabut', 'success');
      setRevokeTarget(null);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Lisensi gagal dicabut'), 'error');
    } finally {
      setBusy('');
    }
  };

  const createPayment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setBusy('payment');
    try {
      await api.post(`/it/subscriptions/${id}/payments`, {
        invoiceId: fd.get('invoiceId') ? Number(fd.get('invoiceId')) : null,
        paidAt: fd.get('paidAt') || null,
        amount: Number(fd.get('amount')),
        paymentMethod: fd.get('paymentMethod') || null,
        referenceNo: fd.get('referenceNo') || null,
        jurnalReferenceId: fd.get('jurnalReferenceId') || null,
      });
      toast('Pembayaran dicatat', 'success');
      setPaymentOpen(false);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Pembayaran gagal dicatat'), 'error');
    } finally {
      setBusy('');
    }
  };

  const ai = usePrakasaAIForm(AI_LICENSE, {
    enabled: licOpen && Boolean(sub),
    values: { seatLabel },
    setters: { seatLabel: setSeatLabel },
    initialValues: { seatLabel: '' },
  });
  // ?form=lisensi opens "Tambah lisensi" (a link, or Prakasa AI's buka_halaman).
  useOpenFromUrl('form', (name) => { if (name === 'lisensi') setLicOpen(true); }, { enabled: Boolean(sub) });

  if (loading && !sub) return <Page><LoadingState label="Memuat langganan…" /></Page>;
  if (loadError || !sub) {
    return (
      <Page>
        <EmptyState
          tone="error"
          title="Langganan tidak dapat dimuat"
          description={loadError || undefined}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const licenses = sub.licenses || [];
  const assigned = licenses.filter((l) => l.status === 'assigned').length;
  const available = licenses.filter((l) => l.status === 'available').length;
  const idle = licenses.filter((l) => l.status === 'idle').length;
  const billing = labelFor(BILLING_CYCLE_LABELS, sub.billing_cycle);
  const invoiceOptions = (sub.invoices || []).map((inv) => ({
    value: inv.id,
    label: `${inv.invoiceNumber} · ${formatAmount(inv.totalAmount, inv.currency)}`,
  }));

  return (
    <Page
      eyebrow="Langganan software"
      title={[sub.product_name, sub.plan_name].filter(Boolean).join(' — ')}
      dataTitle
      description={(
        <span className="pw-row">
          <StatusBadge status={sub.status} />
          <span>{billing} · perpanjangan {formatDate(sub.renewal_date)}</span>
        </span>
      )}
      actions={<IconButton label="Muat ulang" icon="refresh" onClick={load} />}
    >
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card
            title={`Lisensi (${licenses.length})`}
            actions={<Button variant="secondary" icon="add" onClick={() => setLicOpen(true)}>Tambah lisensi</Button>}
          >
            {licenses.length ? (
              <ul className="it-lines">
                {licenses.map((l) => (
                  <li key={l.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title" data-no-translate={l.seatLabel ? '' : undefined}>{licenseName(l)}</span>
                      <span className="it-line__meta" data-no-translate={l.assignedToName ? '' : undefined}>{l.assignedToName || 'Belum dipakai'}</span>
                    </div>
                    <StatusBadge status={l.status} />
                    {l.status === 'available' ? (
                      <IconButton label="Tetapkan pengguna" icon="person_add" size="sm" onClick={() => setAssignLicense(l)} />
                    ) : null}
                    {l.status === 'assigned' ? (
                      <IconButton label="Cabut lisensi" icon="person_remove" tone="danger" size="sm" onClick={() => setRevokeTarget(l)} />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="key" title="Belum ada lisensi" />}
          </Card>

          <Card title="Invoice">
            {sub.invoices?.length ? (
              <ul className="it-lines">
                {sub.invoices.map((inv) => (
                  <li key={inv.id} className="it-line">
                    <div className="it-line__main">
                      <span data-no-translate="" className="it-line__title">{inv.invoiceNumber}</span>
                      <span className="it-line__meta">{formatAmount(inv.totalAmount, inv.currency)}</span>
                    </div>
                    <StatusBadge status={inv.status} label={INVOICE_STATUS_LABELS[inv.status]} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="receipt_long" title="Belum ada invoice" />}
          </Card>

          <Card title="Riwayat perpanjangan">
            {sub.renewals?.length ? (
              <ul className="it-lines">
                {sub.renewals.map((r) => (
                  <li key={r.id} className="it-line">
                    <span className="it-line__main">{formatDate(r.currentRenewalDate)} – {formatDate(r.proposedRenewalDate)}</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="event_repeat" title="Belum ada perpanjangan" />}
          </Card>
          <Card title="Pembayaran" actions={<Button variant="secondary" icon="add" onClick={() => setPaymentOpen(true)}>Catat pembayaran</Button>}>
            {sub.payments?.length ? (
              <ul className="it-lines">
                {sub.payments.map((p) => (
                  <li key={p.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title">{formatAmount(p.amount, p.currency)}</span>
                      <span className="it-line__meta">{p.paidAt ? formatDate(p.paidAt) : EMPTY}</span>
                    </div>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="payments" title="Belum ada pembayaran" />}
          </Card>
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Seat', translate: true, value: `${sub.total_seats} (${assigned} dipakai · ${available} tersedia · ${idle} idle)` },
              { label: 'Harga', translate: true, value: `${formatAmount(sub.unit_price || 0, sub.currency)} per seat` },
              { label: 'Siklus tagihan', translate: true, value: billing },
              { label: 'Mulai', value: sub.start_date ? formatDate(sub.start_date) : null },
              { label: 'Perpanjangan', value: sub.renewal_date ? formatDate(sub.renewal_date) : null },
              { label: 'Perpanjang otomatis', translate: true, value: sub.auto_renew ? 'Ya' : 'Tidak' },
              { label: 'Vendor', value: sub.vendorName },
              { label: 'PIC', value: sub.picName },
            ]}
            />
          </Card>
        </aside>
      </div>

      <Modal open={licOpen} onClose={() => setLicOpen(false)} title="Tambah lisensi">
        <form className="pw-stack" onSubmit={createLicense}>
          {ai.notice}
          <div className="pw-form-grid">
            <Input label="Label seat" name="seatLabel" value={seatLabel} {...ai.field('seatLabel')} onChange={(event) => setSeatLabel(event.target.value)} hint="Contoh: Seat #5. Kunci lisensi tidak disimpan di aplikasi — simpan di portal vendor." />
          </div>
          <FormActions>
            <Button variant="text" type="button" onClick={() => setLicOpen(false)}>Batal</Button>
            <Button type="submit" loading={busy === 'license'}>Simpan lisensi</Button>
          </FormActions>
        </form>
      </Modal>

      <Modal open={!!assignLicense} onClose={() => setAssignLicense(null)} title="Tetapkan pengguna lisensi" size="sm">
        {assignLicense && (
          <form className="pw-stack" onSubmit={doAssign}>
            <Input
              label="ID pengguna"
              name="userId"
              type="number"
              required
              hint={`Nomor ID akun pengguna yang memakai ${licenseName(assignLicense)}.`}
            />
            <FormActions>
              <Button variant="text" type="button" onClick={() => setAssignLicense(null)}>Batal</Button>
              <Button type="submit" loading={busy === 'assign'}>Tetapkan pengguna</Button>
            </FormActions>
          </form>
        )}
      </Modal>

      <FullScreenDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        dirty={paymentDirty}
        title="Catat pembayaran"
        sectionTitle="Pembayaran"
        actions={(
          <>
            <Button variant="text" type="button" onClick={() => setPaymentOpen(false)}>Batal</Button>
            <Button type="submit" form={paymentFormId} loading={busy === 'payment'}>Simpan pembayaran</Button>
          </>
        )}
      >
        <form id={paymentFormId} className="pw-fsdialog__fields" onSubmit={createPayment} onChange={() => setPaymentDirty(true)}>
          <Select
            label="Invoice"
            name="invoiceId"
            placeholder="Tanpa invoice"
            options={invoiceOptions}
            dataOptions
            hint={invoiceOptions.length ? 'Opsional.' : 'Belum ada invoice untuk langganan ini.'}
          />
          <DateInput label="Tanggal bayar" name="paidAt" />
          <Input label="Jumlah" name="amount" type="number" required />
          <Input label="Metode" name="paymentMethod" hint="Contoh: transfer, kartu kredit." />
          <Input label="Nomor referensi" name="referenceNo" mono />
          <Input label="Referensi Jurnal.id" name="jurnalReferenceId" />
        </form>
      </FullScreenDialog>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Cabut lisensi?"
        message={`${licenseName(revokeTarget)} dicabut dari ${revokeTarget?.assignedToName || 'penggunanya'} dan kembali tersedia.`}
        confirmLabel="Cabut lisensi"
        tone="danger"
        loading={busy === 'revoke'}
        onConfirm={doRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </Page>
  );
}
