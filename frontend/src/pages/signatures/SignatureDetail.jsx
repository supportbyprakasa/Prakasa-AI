import {
  ArrowLeft,
  PenTool,
  QrCode,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import SignaturePrecheckPanel from '../../components/SignaturePrecheckPanel';
import { SkeletonCard } from '../../components/Skeleton';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';

const STATUS_TONE = {
  signed: 'success',
  pending: 'warning',
  approved: 'info',
  rejected: 'error',
  cancelled: 'default',
};

export default function SignatureDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
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

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/signatures/${id}`);
      setRequest(response.data.data);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Signature request tidak ditemukan', 'error');
      navigate('/signatures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const runPrecheck = async () => {
    setPrecheckRunning(true);
    try {
      await api.post(`/signatures/${id}/precheck`);
      toast('Signature precheck selesai', 'success');
      await load();
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Precheck gagal', 'error');
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
      toast(error.response?.data?.error?.message || 'Gagal membuat QR', 'error');
    } finally {
      setQrLoading(false);
    }
  };

  if (loading) return <SkeletonCard lines={9} />;
  if (!request) return null;

  const latestPrecheck = request.prechecks?.[0] || null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Button variant="secondary" onClick={() => navigate('/signatures')}>
          <ArrowLeft size={14} />
          Signatures
        </Button>

        <div style={{ display: 'flex', gap: 8 }}>
          {canGenerateQr && request.status === 'signed' && (
            <Button
              variant="secondary"
              onClick={generateQr}
              disabled={qrLoading}
            >
              <QrCode size={14} />
              {qrLoading ? 'Memproses…' : 'QR Verifikasi'}
            </Button>
          )}

          {canSign && request.status === 'pending' && (
            <Button onClick={() => setSignOpen(true)}>
              <PenTool size={14} />
              Tanda Tangan
            </Button>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Signature #{request.id}</h2>
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 13,
              marginTop: 4,
            }}
          >
            {request.documentTitle}
          </div>
        </div>
        <Badge tone={STATUS_TONE[request.status] || 'default'}>
          {request.status}
        </Badge>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        <Card title="Signature Request">
          <Definition label="Document ID" value={request.documentId} />
          <Definition
            label="Approval Request"
            value={request.approvalRequestId ? `#${request.approvalRequestId}` : '—'}
          />
          <Definition label="Signature Type" value={request.signatureType || '—'} />
          <Definition
            label="Signer Ditunjuk"
            value={
              request.assignedSignerUserName ||
              request.assignedSignerRoleName ||
              (request.assignedSignerUserId
                ? `User #${request.assignedSignerUserId}`
                : request.assignedSignerRoleId
                  ? `Role #${request.assignedSignerRoleId}`
                  : '—')
            }
          />
          <Definition
            label="Ditandatangani Oleh"
            value={
              request.signedByName ||
              (request.signedBy ? `User #${request.signedBy}` : '—')
            }
          />
          <Definition
            label="Signed At"
            value={
              request.signedAt
                ? new Date(request.signedAt).toLocaleString('id-ID')
                : '—'
            }
          />
        </Card>

        <Card title="Verifikasi">
          {request.verification ? (
            <>
              <Definition
                label="Kode"
                value={<code>{request.verification.verificationCode}</code>}
              />
              <Definition
                label="Hash"
                value={
                  <code style={{ wordBreak: 'break-all', fontSize: 11 }}>
                    {request.verification.documentHash}
                  </code>
                }
              />
              <Definition
                label="Algoritma"
                value={request.verification.hashAlgorithm || '—'}
              />
              <Definition
                label="Signed At"
                value={
                  request.verification.signedAt
                    ? new Date(request.verification.signedAt).toLocaleString('id-ID')
                    : '—'
                }
              />
              <Definition
                label="Valid Until"
                value={
                  request.verification.validUntil
                    ? new Date(request.verification.validUntil).toLocaleString('id-ID')
                    : 'Tidak dibatasi'
                }
              />
              {request.verification.verificationUrl && (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <a
                    href={request.verification.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buka halaman verifikasi
                  </a>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              Belum ada metadata verifikasi.
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <SignaturePrecheckPanel
          precheck={latestPrecheck}
          onRun={runPrecheck}
          running={precheckRunning}
          canRun={canRunPrecheck && request.status === 'pending'}
        />
      </div>

      <Modal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Tanda Tangan Dokumen"
        maxWidth={700}
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
        title="QR Verifikasi"
        maxWidth={560}
      >
        {qrData && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={qrData.qrDataUrl}
              alt="QR verification"
              style={{
                width: 240,
                height: 240,
                boxShadow: 'inset 0 0 0 1px var(--color-border)',
                borderRadius: 8,
              }}
            />
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <b>Kode:</b> <code>{qrData.verificationCode}</code>
            </div>
            <div
              style={{
                marginTop: 4,
                wordBreak: 'break-all',
                fontSize: 12,
                color: 'var(--color-text-muted)',
              }}
            >
              {qrData.verificationUrl}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: 'var(--color-text-muted)',
              }}
            >
              QR image hanya ditampilkan sementara dan tidak disimpan sebagai
              base64 di database.
            </div>
          </div>
        )}
      </Modal>
    </div>
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
  const [signing, setSigning] = useState(false);

  const sign = async () => {
    if (serverBlocked && canOverride && overridePrecheck && !overrideReason.trim()) {
      toast('Alasan override wajib diisi', 'error');
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
        toast(apiError.message || 'AI precheck memblokir proses signing', 'error');
      } else {
        toast(apiError?.message || 'Gagal menandatangani dokumen', 'error');
      }
    } finally {
      setSigning(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        Signing tetap divalidasi backend terhadap approval final, assignment
        signer, delegation aktif, signature rule, dan versi dokumen saat ini.
      </div>

      {serverBlocked && (
        <div
          style={{
            marginTop: 12,
            boxShadow: 'inset 0 0 0 1px #fecaca',
            background: '#fef2f2',
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
          }}
        >
          <b>AI precheck: {blockDetails?.status || 'blocked'}</b>
          {Array.isArray(blockDetails?.findings) &&
            blockDetails.findings.length > 0 && (
              <ul style={{ marginBottom: 0 }}>
                {blockDetails.findings.map((finding, index) => (
                  <li key={index}>{finding.message}</li>
                ))}
              </ul>
            )}

          {!canOverride && (
            <div style={{ marginTop: 8 }}>
              Anda tidak memiliki permission untuk override precheck.
            </div>
          )}
        </div>
      )}

      {serverBlocked && canOverride && (
        <div style={{ marginTop: 14 }}>
          <label
            style={{
              display: 'flex',
              gap: 7,
              alignItems: 'center',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={overridePrecheck}
              onChange={(event) => setOverridePrecheck(event.target.checked)}
            />
            Override AI precheck
          </label>

          {overridePrecheck && (
            <div style={{ marginTop: 10 }}>
              <Input
                label="Alasan Override *"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Jelaskan alasan bisnis/operasional secara eksplisit"
              />
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 18,
        }}
      >
        <Button variant="secondary" onClick={onCancel} disabled={signing}>
          Batal
        </Button>
        <Button
          onClick={sign}
          disabled={
            signing ||
            (serverBlocked && (!canOverride || !overridePrecheck))
          }
        >
          {signing ? 'Menandatangani…' : 'Konfirmasi & Tanda Tangan'}
        </Button>
      </div>
    </div>
  );
}

function Definition({ label, value }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '145px 1fr',
        gap: 8,
        marginBottom: 8,
        fontSize: 13,
      }}
    >
      <b>{label}</b>
      <div>{value}</div>
    </div>
  );
}
