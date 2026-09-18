import axios from 'axios';
import { CheckCircle2, Clock3, FileCheck2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Badge from '../../components/Badge';
import Card from '../../components/Card';
import { SkeletonCard } from '../../components/Skeleton';

function publicApiRoot() {
  const configured = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
  return configured.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

export default function VerifyDocument() {
  const { code } = useParams();
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
          `${publicApiRoot()}/verify/${encodeURIComponent(code)}`,
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
  }, [code]);

  if (state.loading) {
    return (
      <div style={{ maxWidth: 760, margin: '56px auto', padding: '0 20px' }}>
        <SkeletonCard lines={7} />
      </div>
    );
  }

  if (state.error) {
    return (
      <div style={{ maxWidth: 760, margin: '56px auto', padding: '0 20px' }}>
        <Card>
          <div style={{ textAlign: 'center', padding: '28px 12px' }}>
            <XCircle size={44} color="var(--color-error)" />
            <h2 style={{ marginBottom: 8 }}>Verifikasi tidak ditemukan</h2>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
              {state.error}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const data = state.data;
  const valid = Boolean(data?.valid);

  return (
    <div style={{ maxWidth: 760, margin: '56px auto', padding: '0 20px' }}>
      <Card>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {valid ? (
            <CheckCircle2 size={48} color="#166534" />
          ) : (
            <Clock3 size={48} color="#92400e" />
          )}
          <h1 style={{ margin: '10px 0 6px', fontSize: 24 }}>
            Verifikasi Dokumen
          </h1>
          <Badge tone={valid ? 'success' : 'warning'}>
            {valid ? 'Valid' : 'Expired'}
          </Badge>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(150px, 220px) 1fr',
            gap: '10px 16px',
            fontSize: 14,
          }}
        >
          <b>Kode Verifikasi</b>
          <code>{data.verificationCode}</code>

          <b>Judul Dokumen</b>
          <span>{data.documentTitle || '—'}</span>

          <b>Tipe Dokumen</b>
          <span>{data.documentType || '—'}</span>

          <b>Document Hash</b>
          <code style={{ wordBreak: 'break-all', fontSize: 12 }}>
            {data.documentHash || '—'}
          </code>

          <b>Hash Algorithm</b>
          <span>{data.hashAlgorithm || '—'}</span>

          <b>Signer</b>
          <span>{data.signedByName || '—'}</span>

          <b>Ditandatangani</b>
          <span>
            {data.signedAt
              ? new Date(data.signedAt).toLocaleString('id-ID')
              : '—'}
          </span>

          <b>Berlaku Sampai</b>
          <span>
            {data.validUntil
              ? new Date(data.validUntil).toLocaleString('id-ID')
              : 'Tidak dibatasi'}
          </span>

          <b>Terdaftar</b>
          <span>
            {data.registeredAt
              ? new Date(data.registeredAt).toLocaleString('id-ID')
              : '—'}
          </span>
        </div>

        <div
          style={{
            marginTop: 22,
            paddingTop: 16,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 12,
          }}
        >
          <FileCheck2 size={15} />
          Halaman ini hanya menampilkan metadata verifikasi yang aman.
        </div>
      </Card>
    </div>
  );
}
