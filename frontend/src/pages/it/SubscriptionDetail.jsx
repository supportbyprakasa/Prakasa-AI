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

export default function SubscriptionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [licOpen, setLicOpen] = useState(false);
  const [assignLicense, setAssignLicense] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/it/subscriptions/${id}`);
      setSub(r.data.data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const createLicense = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/subscriptions/${id}/licenses`, {
        licenseKey: fd.get('licenseKey') || null,
        seatLabel: fd.get('seatLabel') || null,
      });
      toast('License ditambah', 'success');
      setLicOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doAssign = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/licenses/${assignLicense.id}/assign`, { userId: Number(fd.get('userId')) });
      toast('License di-assign', 'success');
      setAssignLicense(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const doRevoke = async () => {
    try {
      await api.post(`/it/licenses/${revokeTarget.id}/revoke`, {});
      toast('License dicabut', 'success');
      setRevokeTarget(null);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  const createPayment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post(`/it/subscriptions/${id}/payments`, {
        invoiceId: fd.get('invoiceId') ? Number(fd.get('invoiceId')) : null,
        paidAt: fd.get('paidAt') || null,
        amount: Number(fd.get('amount')),
        paymentMethod: fd.get('paymentMethod') || null,
        referenceNo: fd.get('referenceNo') || null,
        jurnalReferenceId: fd.get('jurnalReferenceId') || null,
      });
      toast('Payment dicatat', 'success');
      setPaymentOpen(false);
      load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  if (loading) return <SkeletonCard lines={8} />;
  if (!sub) return null;

  const assigned = sub.licenses?.filter((l) => l.status === 'assigned').length || 0;
  const available = sub.licenses?.filter((l) => l.status === 'available').length || 0;
  const idle = sub.licenses?.filter((l) => l.status === 'idle').length || 0;

  return (
    <div>
      <Button variant="secondary" onClick={() => nav('/it/subscriptions')}>← Subscriptions</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <h2>{sub.product_name} — {sub.plan_name || ''}</h2>
        <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>{sub.status}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Info Subscription">
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>Seats: <b>{sub.total_seats}</b> ({assigned} assigned · {available} available · {idle} idle)</div>
            <div>Harga: {sub.currency} {sub.unit_price || 0} / seat</div>
            <div>Billing: {sub.billing_cycle}</div>
            <div>Start: {sub.start_date || '—'}</div>
            <div>Renewal: <b>{sub.renewal_date}</b></div>
            <div>Auto renew: {sub.auto_renew ? 'Ya' : 'Tidak'}</div>
            <div>Vendor: {sub.vendorName || '—'}</div>
            <div>PIC: {sub.picName || '—'}</div>
          </div>
        </Card>

        <Card title="Invoice" actions={<Button onClick={load}>Refresh</Button>}>
          {sub.invoices?.length ? (
            sub.invoices.map((inv) => (
              <div key={inv.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                <b>{inv.invoiceNumber}</b> · {inv.currency} {Number(inv.totalAmount).toLocaleString('id-ID')} · <Badge>{inv.status}</Badge>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada invoice</div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title={`Licenses (${sub.licenses?.length || 0})`} actions={<Button onClick={() => setLicOpen(true)}>+ License</Button>}>
          {sub.licenses?.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                padding: 8,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div>
                <b>{l.seatLabel || l.licenseKey || `License #${l.id}`}</b>
                {l.assignedToName && <> · {l.assignedToName}</>}
                {' · '}
                <Badge tone={l.status === 'assigned' ? 'info' : l.status === 'idle' ? 'warning' : 'default'}>
                  {l.status}
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {l.status === 'available' && (
                  <Button variant="secondary" onClick={() => setAssignLicense(l)}>Assign</Button>
                )}
                {l.status === 'assigned' && (
                  <Button variant="danger" onClick={() => setRevokeTarget(l)}>Cabut</Button>
                )}
              </div>
            </div>
          ))}
          {!sub.licenses?.length && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada license</div>
          )}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Renewal History">
          {sub.renewals?.length ? (
            sub.renewals.map((r) => (
              <div key={r.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                {r.currentRenewalDate} → {r.proposedRenewalDate} · <Badge>{r.status}</Badge>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada renewal</div>
          )}
        </Card>
        <Card title="Payments" actions={<Button onClick={() => setPaymentOpen(true)}>+ Payment</Button>}>
          {sub.payments?.length ? (
            sub.payments.map((p) => (
              <div key={p.id} style={{ fontSize: 13, padding: 6, borderBottom: '1px solid var(--color-border)' }}>
                {p.paidAt ? new Date(p.paidAt).toLocaleDateString('id-ID') : '—'} · {p.currency} {Number(p.amount).toLocaleString('id-ID')} · <Badge>{p.status}</Badge>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Belum ada payment</div>
          )}
        </Card>
      </div>

      <Modal open={licOpen} onClose={() => setLicOpen(false)} title="Tambah License">
        <form onSubmit={createLicense}>
          <Input label="License Key (opsional)" name="licenseKey" />
          <Input label="Seat Label" name="seatLabel" placeholder="mis. Seat #5" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setLicOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!assignLicense} onClose={() => setAssignLicense(null)} title="Assign License">
        {assignLicense && (
          <form onSubmit={doAssign}>
            <Input label="User ID" name="userId" type="number" required />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setAssignLicense(null)}>Batal</Button>
              <Button type="submit">Assign</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Catat Payment">
        <form onSubmit={createPayment}>
          <Input label="Invoice ID (opsional)" name="invoiceId" type="number" />
          <Input label="Tanggal Bayar" name="paidAt" type="date" />
          <Input label="Jumlah" name="amount" type="number" required />
          <Input label="Metode" name="paymentMethod" placeholder="transfer/kartu/dll" />
          <Input label="No. Referensi" name="referenceNo" />
          <Input label="Referensi Jurnal.id" name="jurnalReferenceId" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="secondary" type="button" onClick={() => setPaymentOpen(false)}>Batal</Button>
            <Button type="submit">Simpan</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Cabut license?"
        message="License akan dikembalikan ke status available."
        confirmLabel="Ya, cabut"
        onConfirm={doRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}

