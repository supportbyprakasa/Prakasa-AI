import { useEffect, useState } from 'react';
import api from '../../api/client';
import DataTable from '../../components/DataTable';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { toast } from '../../components/Toast';

export default function SignatureInbox() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/signatures').then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const sign = async () => {
    try {
      const r = await api.post(`/signatures/${selected.id}/sign`);
      toast(`Dokumen ditandatangani. Kode verifikasi: ${r.data.data.verificationCode}`, 'success');
      if (r.data.data.webViewLink) window.open(r.data.data.webViewLink, '_blank');
      setSelected(null); load();
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Gagal', 'error');
    }
  };

  return (
    <div>
      <h2>Signature Inbox</h2>
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'documentTitle', title: 'Dokumen' },
          { key: 'signatureType', title: 'Level' },
          { key: 'status', title: 'Status' },
          { key: 'signedAt', title: 'Ditandatangani' },
          {
            key: 'actions', title: 'Aksi',
            render: (r) => r.status === 'pending'
              ? <Button onClick={() => setSelected(r)}>Tanda Tangan</Button>
              : <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
          },
        ]}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Tanda tangan: ${selected?.documentTitle || ''}`}>
        {selected && (
          <>
            <p style={{ fontSize: 14 }}>
              Dokumen akan ditandatangani secara elektronik. Tindakan ini tercatat di audit log
              dan tidak dapat dibatalkan.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" onClick={() => setSelected(null)}>Batal</Button>
              <Button onClick={sign}>Konfirmasi & Tanda Tangan</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
