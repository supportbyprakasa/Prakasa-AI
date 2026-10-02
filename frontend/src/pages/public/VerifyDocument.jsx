import axios from 'axios';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import KeyValue from '../../components/KeyValue';
import StatusBadge from '../../components/StatusBadge';
import { SkeletonCard } from '../../components/Skeleton';
import { formatDateTime } from '../../components/format';
import { publicVerificationBaseUrl } from '../../api/endpoint';
import './verify-document.css';

// Public page behind a signature QR code (no app shell, no login): a white
// panel with the verdict and the safe verification metadata.
export default function VerifyDocument() {
  const { code } = useParams();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ loading: true, data: null, error: null });
      try {
        const response = await axios.get(
          `${publicVerificationBaseUrl}/verify/${encodeURIComponent(code)}`,
          { timeout: 15000 }
        );
        if (active) {
          setState({ loading: false, data: response.data.data, error: null });
        }
      } catch (error) {
        if (active) {
          setState({
            loading: false,
            data: null,
            error:
              error.response?.data?.error?.message ||
              'Dokumen tidak dapat diverifikasi.',
          });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [code, attempt]);

  if (state.loading) {
    return (
      <main className="verify-doc">
        <h1 className="pw-visually-hidden">Verifikasi dokumen</h1>
        <SkeletonCard lines={7} />
      </main>
    );
  }

  if (state.error) {
    return (
      <main className="verify-doc">
        <h1 className="pw-visually-hidden">Verifikasi dokumen</h1>
        <Card variant="panel">
          <EmptyState
            tone="error"
            icon="cancel"
            title="Verifikasi tidak ditemukan"
            description={state.error}
            action={<Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button>}
          />
        </Card>
      </main>
    );
  }

  const data = state.data || {};
  const valid = Boolean(data.valid);

  return (
    <main className="verify-doc">
      <Card variant="panel">
        <div className="verify-doc__body">
          <div className="verify-doc__head">
            <Icon name="verified_user" size="xl" className="verify-doc__mark" />
            <h1 className="pw-title-page">Verifikasi dokumen</h1>
          </div>

          <Banner tone={valid ? 'success' : 'error'} title={valid ? 'Tanda tangan valid' : 'Tanda tangan sudah tidak berlaku'}>
            {valid
              ? 'Dokumen ini terdaftar dan tanda tangannya masih berlaku.'
              : 'Dokumen ini terdaftar, tetapi tanda tangannya sudah tidak berlaku.'}
          </Banner>

          <KeyValue
            items={[
              { label: 'Status', value: valid ? <StatusBadge status="verified" label="Valid" /> : <StatusBadge status="expired" /> },
              { label: 'Kode verifikasi', value: data.verificationCode ? <code data-no-translate="" className="verify-doc__code">{data.verificationCode}</code> : null },
              { label: 'Judul dokumen', value: data.documentTitle },
              { label: 'Tipe dokumen', translate: true, value: data.documentType },
              { label: 'Hash dokumen', value: data.documentHash ? <code className="verify-doc__code">{data.documentHash}</code> : null },
              { label: 'Algoritma hash', value: data.hashAlgorithm },
              { label: 'Penanda tangan', value: data.signedByName },
              { label: 'Ditandatangani', value: data.signedAt ? formatDateTime(data.signedAt) : null },
              { label: 'Berlaku sampai', translate: true, value: data.validUntil ? formatDateTime(data.validUntil) : 'Tidak dibatasi' },
              { label: 'Terdaftar', value: data.registeredAt ? formatDateTime(data.registeredAt) : null },
            ]}
          />

          <p className="verify-doc__note">
            <Icon name="lock" size="sm" />
            Halaman ini hanya menampilkan metadata verifikasi yang aman.
          </p>
        </div>
      </Card>
    </main>
  );
}
