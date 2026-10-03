import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiErrorMessage as errorMessage, fieldErrorsFromApi } from '../../components/datagrid/gridModel';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import {
  formatDateTime, returnNotice, scopeLabel, stripReturnParams, tokenExpiry,
} from './accurateIntegrationModel';
import './admin-editors.css';

// Client ID / Secret of the Accurate developer app "Prakasa Workspace" (labels
// in Indonesian: ID klien, Rahasia klien, URL callback OAuth; the input names
// stay accurate-client-id / -secret / -redirect-uri). The secret is
// write-only: the server keeps it encrypted and only says whether one is
// stored.
function CredentialsCard({ status, onSaved }) {
  const creds = status.credentials || {};
  const fromEnv = creds.source === 'env';
  const [form, setForm] = useState({ clientId: '', clientSecret: '', redirectUri: creds.redirectUri || status.suggestedRedirectUri || '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!form.clientId.trim()) nextErrors.clientId = 'Isi ID klien.';
    if (!creds.hasSecret && !form.clientSecret) nextErrors.clientSecret = 'Isi rahasia klien.';
    if (!form.redirectUri.trim()) nextErrors.redirectUri = 'Isi URL callback OAuth.';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      const r = await api.put('/integrations/accurate/credentials', form);
      setForm((f) => ({ ...f, clientId: '', clientSecret: '' }));
      onSaved(r.data.data);
      toast('Kredensial Accurate disimpan (terenkripsi).', 'success');
    } catch (err) {
      const fieldErrors = fieldErrorsFromApi(err);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else toast(errorMessage(err, 'Kredensial Accurate gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };
  if (fromEnv) {
    return (
      <Card variant="panel" size="sm" title="Kredensial aplikasi Accurate" subtitle={`Diatur di backend/.env server (ID klien …${creds.clientIdEnd}). Ubah di sana bila perlu.`} />
    );
  }
  return (
    <Card
      variant="panel"
      size="sm"
      title="Kredensial aplikasi Accurate"
      subtitle="Dari aplikasi developer “Prakasa Workspace” di account.accurate.id/developer."
    >
      <form className="pw-stack" onSubmit={submit} autoComplete="off" noValidate>
        <Banner tone="info" title={creds.hasSecret ? `Tersimpan: ID klien …${creds.clientIdEnd}` : undefined}>
          Rahasia klien disimpan terenkripsi dan tidak pernah ditampilkan lagi. URL callback OAuth harus sama persis dengan yang diisi di aplikasi developer Accurate.
        </Banner>
        <div className="admin-settings-fields">
          <Input label="ID klien" name="accurate-client-id" value={form.clientId} error={errors.clientId} onChange={set('clientId')} required autoComplete="off" spellCheck={false} mono />
          <Input
            label="Rahasia klien"
            name="accurate-client-secret"
            type="password"
            value={form.clientSecret}
            error={errors.clientSecret}
            onChange={set('clientSecret')}
            required={!creds.hasSecret}
            autoComplete="new-password"
            hint={creds.hasSecret ? 'Kosongkan bila tidak diubah.' : undefined}
          />
          <Input
            label="URL callback OAuth"
            name="accurate-redirect-uri"
            value={form.redirectUri}
            error={errors.redirectUri}
            onChange={set('redirectUri')}
            required
            spellCheck={false}
            hint="Sama persis dengan di Accurate."
          />
        </div>
        <FormActions>
          <Button type="submit" icon="key" loading={saving}>Simpan kredensial</Button>
        </FormActions>
      </form>
    </Card>
  );
}

// "Integrasi Accurate" — Super Admin connects Accurate Online (read-only).
// The server keeps the tokens encrypted; this page never sees one.
// An unexpected answer shows the load error, never a crashed page.
function normalizeStatus(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Status Accurate tidak dapat dibaca.');
  const list = (v) => (Array.isArray(v) ? v : []);
  return { ...d, scopes: list(d.scopes), requestedScopes: list(d.requestedScopes), missingScopes: list(d.missingScopes) };
}

export default function AccurateIntegration() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => returnNotice(location.search));
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(null); // 'connect' | 'refresh' | 'disconnect'
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/integrations/accurate/status');
      setStatus(normalizeStatus(r.data?.data));
    } catch (e) {
      setLoadError(errorMessage(e, 'Status Accurate tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Drop ?accurate=…&reason=… from the address once it has been read.
  useEffect(() => {
    if (notice) navigate({ pathname: location.pathname, search: stripReturnParams(location.search) }, { replace: true });
    /* eslint-disable-next-line */
  }, []);

  const connect = async () => {
    setBusy('connect');
    try {
      const r = await api.post('/integrations/accurate/connect');
      window.location.assign(r.data.data.authorizeUrl);
    } catch (e) {
      toast(errorMessage(e, 'Penyambungan Accurate gagal dimulai.'), 'error');
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const r = await api.post('/integrations/accurate/refresh');
      setStatus(normalizeStatus(r.data?.data));
      toast('Token Accurate diperbarui.', 'success');
    } catch (e) {
      toast(errorMessage(e, 'Token Accurate gagal diperbarui.'), 'error');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      const r = await api.post('/integrations/accurate/disconnect');
      setStatus(normalizeStatus(r.data?.data));
      setConfirmDisconnect(false);
      toast('Accurate diputuskan. Token dihapus dari aplikasi.', 'success');
    } catch (e) {
      toast(errorMessage(e, 'Accurate gagal diputuskan.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const expiry = tokenExpiry(status?.expiresAt);
  const connected = Boolean(status?.connected);
  const canDisconnect = connected || status?.status === 'error';

  let expiryNote = null;
  if (expiry?.expired) expiryNote = <StatusBadge status="expired" />;
  else if (expiry?.soon) expiryNote = <StatusBadge status="expiring" label="Diperbarui otomatis" />;
  else if (expiry) expiryNote = <span data-translate="" className="pw-text-meta">{expiry.days} hari lagi</span>;

  return (
    <Page>
      <PageHeader
        title="Integrasi Accurate"
        description="Sambungkan Accurate Online agar data Sales (pelanggan, barang, pesanan, faktur, penerimaan) bisa dibaca aplikasi."
        actions={(
          <>
            {connected ? (
              <Button variant="secondary" icon="refresh" onClick={refresh} loading={busy === 'refresh'} disabled={Boolean(busy)}>
                Perbarui token
              </Button>
            ) : null}
            <Button variant={connected ? 'secondary' : 'primary'} icon="link" onClick={connect} loading={busy === 'connect'} disabled={!status?.configured || Boolean(busy)}>
              {connected ? 'Sambungkan ulang' : 'Sambungkan Accurate'}
            </Button>
            {canDisconnect ? (
              <ActionMenu
                label="Aksi Accurate lainnya"
                items={[{ label: 'Putuskan Accurate', icon: 'power_off', tone: 'danger', disabled: Boolean(busy), onClick: () => setConfirmDisconnect(true) }]}
              />
            ) : null}
          </>
        )}
      />

      {notice ? <Banner tone={notice.tone} title={notice.title}>{notice.message}</Banner> : null}

      <Banner tone="info" title="Hanya baca: aplikasi tidak pernah menulis ke Accurate">
        Aplikasi hanya meminta izin lihat (*_view). Token dengan izin tulis ditolak dan tidak disimpan.
        Data Accurate baru masuk ke modul Sales setelah disetujui Supervisor atau Head divisi.
      </Banner>

      {loading && !status ? <LoadingState /> : null}
      {!loading && !status && loadError ? (
        <EmptyState
          tone="error"
          title="Status Accurate gagal dimuat"
          description={loadError}
          action={<Button variant="text" type="button" onClick={load}>Coba lagi</Button>}
        />
      ) : null}

      {connected && status.missingScopes?.length ? (
        <Banner tone="warning" title={`${status.missingScopes.length} izin lihat baru belum diberikan Accurate`}>
          Aplikasi kini juga membaca data Warehouse, Procurement dan Finance. Pilih Sambungkan ulang dan setujui di Accurate; semuanya izin lihat (*_view).
        </Banner>
      ) : null}

      {status && !status.configured ? (
        <Banner tone="warning" title="Belum dikonfigurasi">
          Isi ID klien, rahasia klien dan URL callback OAuth di kartu Kredensial aplikasi Accurate di bawah. Tombol Sambungkan aktif setelah disimpan.
        </Banner>
      ) : null}

      {status ? <CredentialsCard key={status.credentials?.clientIdEnd || 'new'} status={status} onSaved={setStatus} /> : null}

      {status ? (
        <Card
          variant="panel"
          size="sm"
          title="Status koneksi"
          actions={<StatusBadge status={connected ? 'connected' : status.status === 'error' ? 'failed' : 'disconnected'} label={status.status === 'error' && !connected ? 'Bermasalah' : undefined} />}
        >
          <KeyValue
            columns={2}
            items={[
              { label: 'Database Accurate', value: status.database },
              { label: 'Database yang diizinkan', value: status.expectedDatabase },
              {
                label: 'Token berlaku sampai',
                value: connected && status.expiresAt ? (
                  <span className="pw-row">
                    {formatDateTime(status.expiresAt)}
                    {expiryNote}
                  </span>
                ) : null,
              },
              { label: 'Disambungkan oleh', value: status.connectedBy },
              { label: 'Disambungkan pada', value: formatDateTime(status.connectedAt) },
              { label: 'Terakhir diperbarui', value: formatDateTime(status.lastRefreshedAt) },
              { label: 'Masalah terakhir', value: status.lastErrorMessage },
            ]}
          />
        </Card>
      ) : null}

      {status ? (
        <Card variant="panel" size="sm" title={connected ? 'Izin yang diberikan Accurate' : 'Izin yang akan diminta'}>
          <ul className="admin-scope-list">
            {(connected ? status.scopes : status.requestedScopes).map((scope) => (
              <li key={scope}>
                <Icon name={connected ? 'check_circle' : 'radio_button_unchecked'} size="sm" className={connected ? 'admin-scope-list__icon is-granted' : 'admin-scope-list__icon'} />
                {/* A scope without a label shows its raw code: never translated. */}
                <span data-no-translate={scopeLabel(scope) === scope ? '' : undefined}>{scopeLabel(scope)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Putuskan Accurate?"
        message="Token Accurate dihapus dari aplikasi. Data di Accurate tidak disentuh. Pembacaan data berhenti sampai disambungkan lagi."
        confirmLabel="Putuskan"
        loading={busy === 'disconnect'}
        onConfirm={disconnect}
        onClose={() => { if (busy !== 'disconnect') setConfirmDisconnect(false); }}
      />
    </Page>
  );
}
