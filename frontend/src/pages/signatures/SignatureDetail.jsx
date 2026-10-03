import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Checkbox from '../../components/Checkbox';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import { Translate } from '../../i18n/NoTranslate';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import SignaturePrecheckPanel from '../../components/SignaturePrecheckPanel';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { useAuth } from '../../context/AuthContext';
import { SIGNATURE_LEVEL_LABELS, assignedSignerLabel, signedByLabel } from './signatureModel';
import './signatures.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

export default function SignatureDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [precheckRunning, setPrecheckRunning] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

  const permissions = user?.permissions || [];
  const canRunPrecheck = permissions.includes('signature_precheck.run');
  const canOverridePrecheck = permissions.includes('signature_precheck.override');
  const canSign = permissions.includes('signature.sign');
  const canGenerateQr = permissions.includes('signature_qr.generate');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get(`/signatures/${id}`);
      setRequest(response.data.data);
    } catch (error) {
      setLoadError(errorMessage(error, 'Permintaan tanda tangan tidak ditemukan atau gagal dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const runPrecheck = async () => {
    setPrecheckRunning(true);
    try {
      await api.post(`/signatures/${id}/precheck`);
      toast('Pemeriksaan AI selesai', 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Pemeriksaan AI gagal'), 'error');
    } finally {
      setPrecheckRunning(false);
    }
  };

  const generateQr = async () => {
    if (!request) return;
    setQrLoading(true);
    try {
      const response = await api.post('/signature-qr/generate', {
        documentId: request.documentId,
        signatureRequestId: request.id,
      });
      setQrData(response.data.data);
      setQrOpen(true);
      await load();
    } catch (error) {
      toast(errorMessage(error, 'QR verifikasi gagal dibuat'), 'error');
    } finally {
      setQrLoading(false);
    }
  };

  if (loading && !request) return <Page><LoadingState label="Memuat permintaan tanda tangan…" /></Page>;
  if (loadError || !request) {
    return (
      <Page>
        <EmptyState
          tone="error"
          title="Permintaan tanda tangan tidak dapat dimuat"
          description={loadError || undefined}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const latestPrecheck = request.prechecks?.[0] || null;
  const verification = request.verification;

  return (
    <Page
      eyebrow="Permintaan tanda tangan"
      title={`Tanda tangan #${request.id}`}
      description={(
        <span className="pw-row">
          <StatusBadge status={request.status} />
          <span data-no-translate="">{request.documentTitle}</span>
        </span>
      )}
      actions={(
        <>
          {canGenerateQr && request.status === 'signed' && (
            <Button variant="secondary" icon="qr_code" onClick={generateQr} loading={qrLoading}>
              Buat QR verifikasi
            </Button>
          )}
          {canSign && request.status === 'pending' && (
            <Button icon="draw" onClick={() => setSignOpen(true)}>
              Tanda tangani dokumen
            </Button>
          )}
        </>
      )}
    >
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <SignaturePrecheckPanel
            precheck={latestPrecheck}
            onRun={runPrecheck}
            running={precheckRunning}
            canRun={canRunPrecheck && request.status === 'pending'}
          />

          <Card title="Verifikasi">
            {verification ? (
              <div className="pw-stack">
                <KeyValue items={[
                  { label: 'Kode', value: <code data-no-translate="" className="sig-code">{verification.verificationCode}</code> },
                  { label: 'Hash', value: <code className="sig-code sig-code--hash">{verification.documentHash}</code> },
                  { label: 'Algoritma', value: verification.hashAlgorithm },
                  { label: 'Ditandatangani pada', value: formatDateTime(verification.signedAt) },
                  { label: 'Berlaku sampai', translate: true, value: verification.validUntil ? formatDateTime(verification.validUntil) : 'Tidak dibatasi' },
                ]}
                />
                {verification.verificationUrl && (
                  <a className="pw-link sig-link" href={verification.verificationUrl} target="_blank" rel="noreferrer">Buka halaman verifikasi</a>
                )}
              </div>
            ) : <EmptyState compact icon="qr_code" title="Belum ada data verifikasi" />}
          </Card>
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Status', value: <StatusBadge status={request.status} /> },
              { label: 'ID dokumen', value: request.documentId },
              { label: 'Permintaan approval', value: request.approvalRequestId ? `#${request.approvalRequestId}` : null },
              { label: 'Level tanda tangan', value: SIGNATURE_LEVEL_LABELS[request.signatureType] || request.signatureType },
              { label: 'Penanda tangan ditunjuk', value: request.assignedSignerUserName || (request.assignedSignerRoleName || request.assignedSignerUserId || request.assignedSignerRoleId ? <Translate>{assignedSignerLabel(request)}</Translate> : null) },
              { label: 'Ditandatangani oleh', value: request.signedByName || (request.signedBy ? <Translate>{signedByLabel(request)}</Translate> : null) },
              { label: 'Waktu tanda tangan', value: request.signedAt ? formatDateTime(request.signedAt) : null },
            ]}
            />
          </Card>
        </aside>
      </div>

      <Modal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Tanda tangani dokumen"
        size="md"
      >
        <SignForm
          signatureRequestId={request.id}
          latestPrecheck={latestPrecheck}
          canOverride={canOverridePrecheck}
          onCancel={() => setSignOpen(false)}
          onSigned={async () => {
            setSignOpen(false);
            await load();
          }}
        />
      </Modal>

      <Modal
        open={qrOpen}
        onClose={() => {
          setQrOpen(false);
          setQrData(null);
        }}
        title="QR verifikasi"
        size="sm"
      >
        {qrData && (
          <div className="sig-qr">
            <img src={qrData.qrDataUrl} alt={`QR verifikasi ${qrData.verificationCode || ''}`.trim()} />
            <div className="sig-qr__code">
              Kode: <code data-no-translate="" className="sig-code">{qrData.verificationCode}</code>
            </div>
            <div className="sig-qr__url" data-no-translate="">{qrData.verificationUrl}</div>
            <p className="sig-note">
              Gambar QR hanya ditampilkan sekarang dan tidak disimpan di database.
            </p>
          </div>
        )}
      </Modal>
    </Page>
  );
}

function SignForm({
  signatureRequestId,
  latestPrecheck,
  canOverride,
  onCancel,
  onSigned,
}) {
  const initialBlocked = ['failed', 'skipped'].includes(latestPrecheck?.status);
  const [serverBlocked, setServerBlocked] = useState(initialBlocked);
  const [blockDetails, setBlockDetails] = useState(
    initialBlocked
      ? {
          status: latestPrecheck.status,
          findings: latestPrecheck.findings || [],
        }
      : null
  );
  const [overridePrecheck, setOverridePrecheck] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [signing, setSigning] = useState(false);

  const sign = async (event) => {
    event?.preventDefault();
    if (serverBlocked && canOverride && overridePrecheck && !overrideReason.trim()) {
      setReasonError('Alasan override wajib diisi.');
      return;
    }

    setSigning(true);
    try {
      const response = await api.post(`/signatures/${signatureRequestId}/sign`, {
        overridePrecheck: Boolean(overridePrecheck),
        overrideReason: overrideReason.trim() || null,
      });

      const code = response.data.data.verificationCode;
      toast(
        code
          ? `Dokumen ditandatangani. Kode verifikasi: ${code}`
          : 'Dokumen ditandatangani',
        'success'
      );
      onSigned();
    } catch (error) {
      const apiError = error.response?.data?.error;
      if (apiError?.code === 'PRECHECK_BLOCKED') {
        setServerBlocked(true);
        setBlockDetails(apiError.details || null);
        setOverridePrecheck(false);
        toast(apiError.message || 'Pemeriksaan AI memblokir penandatanganan', 'error');
      } else {
        toast(apiError?.message || 'Dokumen gagal ditandatangani', 'error');
      }
    } finally {
      setSigning(false);
    }
  };

  const findings = Array.isArray(blockDetails?.findings) ? blockDetails.findings : [];

  // Signing is deliberate: Enter in "Alasan override" does nothing, only the
  // "Tanda tangani" button signs (as before the redesign).
  return (
    <form className="pw-stack" onSubmit={(event) => event.preventDefault()} noValidate>
      <p className="sig-sign-intro">
        Penandatanganan tetap diperiksa server terhadap approval final, penanda tangan yang ditunjuk,
        delegasi aktif, aturan tanda tangan, dan versi dokumen saat ini.
      </p>

      {serverBlocked && (
        <Banner tone="error" title={`Pemeriksaan AI: ${statusLabel(blockDetails?.status || 'blocked')}`}>
          {findings.length > 0 && (
            <ul className="sig-findings">
              {findings.map((finding, index) => (
                <li key={index} data-no-translate="">{finding.message}</li>
              ))}
            </ul>
          )}
          {!canOverride && (
            <span className="sig-findings__note">Anda tidak punya izin untuk mengabaikan hasil pemeriksaan ini.</span>
          )}
        </Banner>
      )}

      {serverBlocked && canOverride && (
        <Checkbox
          label="Abaikan hasil pemeriksaan AI (override)"
          checked={overridePrecheck}
          onChange={(event) => { setOverridePrecheck(event.target.checked); setReasonError(''); }}
        />
      )}

      {serverBlocked && canOverride && overridePrecheck && (
        <Input
          label="Alasan override"
          required
          value={overrideReason}
          error={reasonError}
          onChange={(event) => { setOverrideReason(event.target.value); setReasonError(''); }}
          hint="Jelaskan alasan bisnis atau operasionalnya secara jelas."
        />
      )}

      <FormActions>
        <Button variant="text" type="button" onClick={onCancel} disabled={signing}>
          Batal
        </Button>
        <Button
          type="button"
          onClick={sign}
          loading={signing}
          disabled={serverBlocked && (!canOverride || !overridePrecheck)}
        >
          Tanda tangani
        </Button>
      </FormActions>
    </form>
  );
}
