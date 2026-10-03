import { useCallback, useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Checkbox from '../../components/Checkbox';
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
import {
  BILLING_CYCLE_LABELS, CURRENCY_HINT, DEFAULT_CURRENCY, INVOICE_STATUS_HELP, INVOICE_STATUS_LABELS, LEDGER_REFERENCE_HINT, LEDGER_REFERENCE_LABEL,
  PAYMENT_STATE_LABELS, formatAmount, invoiceActions, labelFor, licenseActions, newRequestKey, optionsFrom,
  payableInvoiceOptions, renewalNotice, subscriptionAbilities,
} from './itModel';
import './it-tickets.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
// Licence keys never come from the API (only hasLicenseKey): a seat is named by its label.
const licenseName = (license) => license?.seatLabel || (license ? `Lisensi #${license.id}` : '');
const BILLING_CYCLES = optionsFrom(BILLING_CYCLE_LABELS, ['monthly', 'quarterly', 'yearly', 'multi_year', 'one_time']);
// What "Ubah langganan" may set: expiring/expired follow the renewal date.
const EDIT_STATUSES = [
  { value: '', label: 'Ikuti tanggal perpanjangan' },
  { value: 'active', label: 'Aktif' },
  { value: 'paused', label: 'Dijeda' },
  { value: 'cancelled', label: 'Berhenti berlangganan' },
];
const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');

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

// "Catat penetapan lisensi": an active account of the same company, found by
// name or work email. The id stays the internal value.
function AssignLicenseDialog({ license, busy, onClose, onSubmit }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [userId, setUserId] = useState('');
  useEffect(() => { if (license) { setQuery(''); setUserId(''); } }, [license]);
  useEffect(() => {
    if (!license) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoadingUsers(true);
      setLookupError('');
      api.get('/it/licenses/assignable-users', { params: query.trim() ? { q: query.trim() } : {} })
        .then((r) => { if (!cancelled) setUsers(r.data.data || []); })
        .catch((error) => { if (!cancelled) setLookupError(errorMessage(error, 'Daftar pengguna gagal dimuat.')); })
        .finally(() => { if (!cancelled) setLoadingUsers(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [license, query]);
  const options = users.map((u) => ({ value: String(u.id), label: `${u.name} · ${u.email}` }));
  return (
    <Modal open={!!license} onClose={onClose} title="Catat penetapan lisensi" size="sm">
      {license && (
        <form className="pw-stack" onSubmit={(event) => { event.preventDefault(); if (userId) onSubmit(Number(userId)); }}>
          <p className="pw-text-helper">{`Berikan akses ${licenseName(license)} di portal vendor, lalu catat pemegangnya di sini. Aplikasi tidak mengubah akun di vendor.`}</p>
          <Input label="Cari pengguna" value={query} onChange={(event) => setQuery(event.target.value)} hint="Nama atau email kerja. Hanya akun aktif di perusahaan ini." />
          <Select
            label="Pengguna"
            required
            placeholder={loadingUsers ? 'Mencari pengguna' : options.length ? 'Pilih pengguna' : 'Tidak ada akun aktif yang cocok'}
            options={options}
            dataOptions
            value={userId}
            error={lookupError || undefined}
            onChange={(event) => setUserId(event.target.value)}
          />
          <FormActions>
            <Button variant="text" type="button" onClick={onClose}>Batal</Button>
            <Button type="submit" loading={busy} disabled={!userId}>Catat penetapan</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}

export default function SubscriptionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const can = subscriptionAbilities(user?.permissions);
  const paymentFormId = useId();
  const editFormId = useId();
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
  const [paymentKey, setPaymentKey] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState('');
  useEffect(() => { if (paymentOpen) { setPaymentDirty(false); setPaymentKey(newRequestKey()); setPaymentInvoice(''); } }, [paymentOpen]);
  const [editOpen, setEditOpen] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  useEffect(() => { if (editOpen) setEditDirty(false); }, [editOpen]);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [vendorDone, setVendorDone] = useState(false);
  useEffect(() => { setVendorDone(false); }, [revokeTarget]);
  const [fileTarget, setFileTarget] = useState(null);
  const [verifyTarget, setVerifyTarget] = useState(null);
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

  const run = async (key, action, success, failure) => {
    setBusy(key);
    try {
      const out = await action();
      if (success) toast(typeof success === 'function' ? success(out) : success, 'success');
      return out || true;
    } catch (err) {
      toast(errorMessage(err, failure), 'error');
      return null;
    } finally {
      setBusy('');
    }
  };

  const createLicense = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const done = await run('license', () => api.post(`/it/subscriptions/${id}/licenses`, { seatLabel: fd.get('seatLabel') || null }), 'Lisensi ditambahkan', 'Lisensi gagal ditambahkan');
    if (done) { setLicOpen(false); load(); }
  };

  const doAssign = async (userId) => {
    const done = await run('assign', () => api.post(`/it/licenses/${assignLicense.id}/assign`, { userId }), 'Penetapan lisensi dicatat', 'Penetapan lisensi gagal dicatat');
    if (done) { setAssignLicense(null); load(); }
  };

  const doRevoke = async () => {
    if (!vendorDone) { toast('Centang konfirmasi portal vendor dulu.', 'error'); return; }
    const done = await run('revoke', () => api.post(`/it/licenses/${revokeTarget.id}/revoke`, { confirmedAtVendor: true }), 'Pencabutan lisensi dicatat', 'Pencabutan lisensi gagal dicatat');
    if (done) { setRevokeTarget(null); load(); }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      planName: fd.get('planName') || null,
      billingCycle: fd.get('billingCycle') || undefined,
      startDate: fd.get('startDate') || undefined,
      renewalDate: fd.get('renewalDate') || undefined,
      ...(fd.get('status') ? { status: fd.get('status') } : {}),
    };
    const done = await run('edit', () => api.patch(`/it/subscriptions/${id}`, body), 'Langganan diperbarui', 'Langganan gagal diperbarui');
    if (done) { setEditOpen(false); load(); }
  };

  const attachFile = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const done = await run('file', () => api.post(`/it/invoices/${fileTarget.id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'PDF invoice diunggah', 'PDF invoice gagal diunggah');
    if (done) { setFileTarget(null); load(); }
  };

  const decideInvoice = async () => {
    const done = await run('verify', () => api.patch(`/it/invoices/${verifyTarget.invoice.id}/verify`, { status: verifyTarget.status }),
      verifyTarget.status === 'verified' ? 'Invoice ditandai terverifikasi' : 'Invoice dibatalkan (void)', 'Status invoice gagal diubah');
    if (done) { setVerifyTarget(null); load(); }
  };

  const invoiceOptions = payableInvoiceOptions(sub?.invoices);
  const chosenInvoice = invoiceOptions.find((o) => String(o.value) === String(paymentInvoice)) || null;
  const createPayment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = Number(fd.get('amount'));
    if (!(amount > 0)) { toast('Jumlah harus lebih dari nol.', 'error'); return; }
    const done = await run('payment', () => api.post(`/it/subscriptions/${id}/payments`, {
      invoiceId: fd.get('invoiceId') ? Number(fd.get('invoiceId')) : null,
      paidAt: fd.get('paidAt') || null,
      amount,
      currency: chosenInvoice ? chosenInvoice.currency : (fd.get('currency') || sub.currency || DEFAULT_CURRENCY),
      paymentMethod: fd.get('paymentMethod') || null,
      referenceNo: fd.get('referenceNo') || null,
      jurnalReferenceId: fd.get('jurnalReferenceId') || null,
      requestKey: paymentKey,
    }), (r) => {
      const out = r?.data?.data || {};
      if (out.duplicate) return 'Pembayaran ini sudah tercatat sebelumnya';
      if (out.paymentState === 'partial') return `Pembayaran dicatat · sisa tagihan ${formatAmount(out.outstandingAmount, out.currency)}`;
      if (out.paymentState === 'paid') return 'Pembayaran dicatat · invoice lunas (tercatat)';
      return 'Pembayaran dicatat';
    }, 'Pembayaran gagal dicatat');
    if (done) { setPaymentOpen(false); load(); }
  };

  const ai = usePrakasaAIForm(AI_LICENSE, {
    enabled: licOpen && Boolean(sub),
    values: { seatLabel },
    setters: { seatLabel: setSeatLabel },
    initialValues: { seatLabel: '' },
  });
  // ?form=lisensi opens "Tambah lisensi", ?form=ubah "Ubah langganan" — only
  // for who may use them (a link, or Prakasa AI's buka_halaman).
  useOpenFromUrl('form', (name) => {
    if (name === 'lisensi' && can.license) setLicOpen(true);
    if (name === 'ubah' && can.manage) setEditOpen(true);
  }, { enabled: Boolean(sub) });

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
  const notice = renewalNotice(sub);

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
      actions={(
        <>
          {can.manage ? <Button variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>Ubah langganan</Button> : null}
          <IconButton label="Muat ulang" icon="refresh" onClick={load} />
        </>
      )}
    >
      {notice ? (
        <Banner
          tone={notice.overdue ? 'error' : 'warning'}
          action={can.manage ? <Button variant="text" onClick={() => setEditOpen(true)}>Ubah langganan</Button> : null}
        >
          {`${notice.overdue ? `Tanggal perpanjangan lewat ${-notice.days} hari.` : `Perpanjangan dalam ${notice.days} hari.`} Setelah vendor memperpanjang (di luar aplikasi), perbarui tanggal perpanjangan langganan ini. Persetujuan perpanjangan belum tersedia di Workspace.`}
        </Banner>
      ) : null}
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card
            title={`Lisensi (${licenses.length})`}
            actions={can.license ? <Button variant="secondary" icon="add" onClick={() => setLicOpen(true)}>Tambah lisensi</Button> : null}
          >
            <p className="pw-text-helper">Lisensi di sini adalah catatan Workspace. Akses pengguna diberikan dan dicabut di portal vendor oleh IT. Idle berarti masih dipegang tetapi tidak dipakai, dan tetap perlu dicabut sebelum diberikan ke orang lain.</p>
            {licenses.length ? (
              <ul className="it-lines">
                {licenses.map((l) => {
                  const actions = licenseActions(l, can);
                  return (
                    <li key={l.id} className="it-line">
                      <div className="it-line__main">
                        <span className="it-line__title" data-no-translate={l.seatLabel ? '' : undefined}>{licenseName(l)}</span>
                        <span className="it-line__meta" data-no-translate={l.assignedToName ? '' : undefined}>{l.assignedToName || 'Belum dipakai'}</span>
                      </div>
                      <StatusBadge status={l.status} />
                      {actions.includes('assign') ? (
                        <IconButton label="Catat penetapan lisensi" icon="person_add" size="sm" onClick={() => setAssignLicense(l)} />
                      ) : null}
                      {actions.includes('revoke') ? (
                        <IconButton label="Catat pencabutan lisensi" icon="person_remove" tone="danger" size="sm" onClick={() => setRevokeTarget(l)} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState compact icon="key" title="Belum ada lisensi" />}
          </Card>

          <Card title="Invoice">
            {sub.invoices?.length ? (
              <ul className="it-lines">
                {sub.invoices.map((inv) => {
                  const actions = invoiceActions(inv, can);
                  return (
                    <li key={inv.id} className="it-line">
                      <div className="it-line__main">
                        <span data-no-translate="" className="it-line__title">{inv.invoiceNumber}</span>
                        <span className="it-line__meta">
                          {`${formatAmount(inv.totalAmount, inv.currency)} · ${PAYMENT_STATE_LABELS[inv.paymentState] || EMPTY}${inv.paymentState === 'partial' ? ` · sisa ${formatAmount(inv.outstandingAmount, inv.currency)}` : ''}${inv.hasFile ? '' : ' · belum ada PDF'}`}
                        </span>
                        <span className="it-line__meta">{INVOICE_STATUS_HELP[inv.status] || ''}</span>
                      </div>
                      <StatusBadge status={inv.status} label={INVOICE_STATUS_LABELS[inv.status]} />
                      {inv.fileUrl ? <IconButton label="Buka PDF invoice" icon="open_in_new" size="sm" href={inv.fileUrl} target="_blank" rel="noreferrer" /> : null}
                      {actions.includes('attach') ? <IconButton label="Unggah PDF invoice" icon="upload_file" size="sm" onClick={() => setFileTarget(inv)} /> : null}
                      {actions.includes('verify') ? <IconButton label="Tandai terverifikasi" icon="task_alt" size="sm" onClick={() => setVerifyTarget({ invoice: inv, status: 'verified' })} /> : null}
                      {actions.includes('void') ? <IconButton label="Batalkan invoice (void)" icon="block" tone="danger" size="sm" onClick={() => setVerifyTarget({ invoice: inv, status: 'void' })} /> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState compact icon="receipt_long" title="Belum ada invoice" />}
          </Card>

          <Card title="Riwayat perpanjangan">
            <p className="pw-text-helper">Persetujuan perpanjangan belum tersedia di Workspace. Riwayat di bawah hanya berisi permintaan yang pernah tercatat.</p>
            {sub.renewals?.length ? (
              <ul className="it-lines">
                {sub.renewals.map((r) => (
                  <li key={r.id} className="it-line">
                    <span className="it-line__main">{formatDate(r.currentRenewalDate)} – {formatDate(r.proposedRenewalDate)}</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="event_repeat" title="Belum ada permintaan perpanjangan tercatat" />}
          </Card>
          <Card title="Pembayaran" actions={can.payment ? <Button variant="secondary" icon="add" onClick={() => setPaymentOpen(true)}>Catat pembayaran</Button> : null}>
            <p className="pw-text-helper">Catatan pembayaran yang sudah dilakukan di luar aplikasi. Mencatat di sini tidak mengirim dana dan tidak mengubah Accurate.</p>
            {sub.payments?.length ? (
              <ul className="it-lines">
                {sub.payments.map((p) => (
                  <li key={p.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title">{formatAmount(p.amount, p.currency)}</span>
                      <span className="it-line__meta">{`${p.paidAt ? formatDate(p.paidAt) : EMPTY} · ${p.invoiceNumber ? `invoice ${p.invoiceNumber}` : 'tanpa invoice'}`}</span>
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

      <AssignLicenseDialog license={assignLicense} busy={busy === 'assign'} onClose={() => setAssignLicense(null)} onSubmit={doAssign} />

      <FullScreenDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        dirty={editDirty}
        title="Ubah langganan"
        sectionTitle="Data langganan"
        actions={(
          <>
            <Button variant="text" type="button" onClick={() => setEditOpen(false)}>Batal</Button>
            <Button type="submit" form={editFormId} loading={busy === 'edit'}>Simpan perubahan</Button>
          </>
        )}
      >
        <Banner tone="info">Perbarui data langganan yang sama setelah pekerjaan di vendor selesai, misalnya tanggal perpanjangan baru. Ini tidak membuat pembelian, pembayaran, atau persetujuan perpanjangan.</Banner>
        <form id={editFormId} className="pw-fsdialog__fields" onSubmit={saveEdit} onChange={() => setEditDirty(true)}>
          <Input label="Paket" name="planName" defaultValue={sub.plan_name || ''} />
          <Select label="Siklus tagihan" name="billingCycle" options={BILLING_CYCLES} defaultValue={sub.billing_cycle || 'monthly'} />
          <DateInput label="Tanggal mulai" name="startDate" defaultValue={dateOnly(sub.start_date)} />
          <DateInput label="Tanggal perpanjangan" name="renewalDate" required defaultValue={dateOnly(sub.renewal_date)} hint="Status Akan berakhir kembali Aktif bila tanggal baru lebih dari 30 hari lagi." />
          <Select label="Status" name="status" options={EDIT_STATUSES} defaultValue="" />
        </form>
      </FullScreenDialog>

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
        <Banner tone="info">Catat pembayaran yang sudah dilakukan di luar aplikasi. Ini register manual, bukan pengiriman dana.</Banner>
        <form id={paymentFormId} className="pw-fsdialog__fields" onSubmit={createPayment} onChange={() => setPaymentDirty(true)}>
          <Select
            label="Invoice"
            name="invoiceId"
            placeholder="Tanpa invoice"
            options={invoiceOptions}
            value={paymentInvoice}
            onChange={(event) => setPaymentInvoice(event.target.value)}
            dataOptions
            hint={invoiceOptions.length
              ? 'Opsional. Tanpa invoice, pembayaran tercatat belum dialokasikan dan tidak melunasi invoice apa pun.'
              : 'Tidak ada invoice yang dapat dibayar. Pembayaran tanpa invoice tidak melunasi invoice apa pun.'}
          />
          <DateInput label="Tanggal bayar" name="paidAt" hint="Kosongkan untuk hari ini. Tidak boleh di masa depan." />
          <Input
            label="Jumlah"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            hint={chosenInvoice ? `Maksimal sisa tagihan ${formatAmount(chosenInvoice.outstanding, chosenInvoice.currency)}. Pembayaran sebagian membuat invoice berstatus Dibayar sebagian.` : undefined}
          />
          {chosenInvoice
            ? <Input label="Mata uang" value={chosenInvoice.currency} readOnly hint="Mengikuti invoice. Tidak ada konversi otomatis." />
            : <Input label="Mata uang" name="currency" defaultValue={sub.currency || DEFAULT_CURRENCY} maxLength={3} hint={CURRENCY_HINT} />}
          <Input label="Metode" name="paymentMethod" hint="Contoh: transfer, kartu kredit." />
          <Input label="Nomor referensi" name="referenceNo" mono />
          <Input label={LEDGER_REFERENCE_LABEL} name="jurnalReferenceId" hint={LEDGER_REFERENCE_HINT} />
        </form>
      </FullScreenDialog>

      <Modal open={!!fileTarget} onClose={() => setFileTarget(null)} title="Unggah PDF invoice" size="sm">
        {fileTarget && (
          <form className="pw-stack" onSubmit={attachFile}>
            <p className="pw-text-helper" data-no-translate="">{fileTarget.invoiceNumber}</p>
            <Input label="File invoice (PDF)" name="file" type="file" accept="application/pdf" required />
            <FormActions>
              <Button variant="text" type="button" onClick={() => setFileTarget(null)}>Batal</Button>
              <Button type="submit" loading={busy === 'file'}>Unggah PDF</Button>
            </FormActions>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!verifyTarget}
        title={verifyTarget?.status === 'void' ? 'Batalkan invoice (void)?' : 'Tandai invoice terverifikasi?'}
        message={verifyTarget?.status === 'void'
          ? `${verifyTarget?.invoice?.invoiceNumber || 'Invoice'} tidak akan bisa dibayar lagi.`
          : `${verifyTarget?.invoice?.invoiceNumber || 'Invoice'}: PDF sudah diperiksa dan nominalnya sesuai.`}
        confirmLabel={verifyTarget?.status === 'void' ? 'Batalkan invoice' : 'Tandai terverifikasi'}
        tone={verifyTarget?.status === 'void' ? 'danger' : 'primary'}
        loading={busy === 'verify'}
        onConfirm={decideInvoice}
        onClose={() => setVerifyTarget(null)}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="Catat pencabutan lisensi?"
        confirmLabel="Catat pencabutan"
        tone="danger"
        loading={busy === 'revoke'}
        onConfirm={doRevoke}
        onClose={() => setRevokeTarget(null)}
        message={(
          <div className="pw-stack pw-stack--sm">
            <span>{`Cabut akses ${revokeTarget?.assignedToName || 'pengguna'} di portal vendor dulu. Setelah dicatat, ${licenseName(revokeTarget)} tersedia di Workspace. Aplikasi tidak mengubah akun di vendor.`}</span>
            <Checkbox label="Akses sudah dicabut di portal vendor" checked={vendorDone} onChange={(event) => setVendorDone(event.target.checked)} />
          </div>
        )}
      />
    </Page>
  );
}
