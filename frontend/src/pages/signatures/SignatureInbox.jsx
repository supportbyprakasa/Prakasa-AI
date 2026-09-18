import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import DataTable from '../../components/DataTable';
import FilterBar from '../../components/FilterBar';
import { toast } from '../../components/Toast';

const STATUS_TONE = {
  pending: 'warning',
  approved: 'info',
  rejected: 'error',
  signed: 'success',
  cancelled: 'default',
};

export default function SignatureInbox() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/signatures', {
        params: { status: status || undefined },
      });
      setRows(response.data.data || []);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memuat signature request', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Signature Inbox</h2>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: 'var(--color-text-muted)',
          }}
        >
          Signature request menampilkan signer yang ditunjuk terpisah dari user
          yang benar-benar sudah menandatangani.
        </div>
      </div>

      <FilterBar
        filters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'signed', label: 'Signed' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
        ]}
        values={{ status }}
        onChange={(next) => setStatus(next.status || '')}
        onReset={() => setStatus('')}
      />

      <DataTable
        loading={loading}
        rows={rows}
        empty="Belum ada signature request"
        columns={[
          { key: 'id', title: 'ID' },
          { key: 'documentTitle', title: 'Dokumen' },
          {
            key: 'assignedSigner',
            title: 'Signer Ditunjuk',
            render: (row) =>
              row.assignedSignerUserName ||
              row.assignedSignerRoleName ||
              (row.assignedSignerUserId
                ? `User #${row.assignedSignerUserId}`
                : row.assignedSignerRoleId
                  ? `Role #${row.assignedSignerRoleId}`
                  : '—'),
          },
          {
            key: 'signedBy',
            title: 'Signed By',
            render: (row) =>
              row.signedByName ||
              (row.signedBy ? `User #${row.signedBy}` : '—'),
          },
          {
            key: 'signatureType',
            title: 'Level',
            render: (row) => row.signatureType || '—',
          },
          {
            key: 'status',
            title: 'Status',
            render: (row) => (
              <Badge tone={STATUS_TONE[row.status] || 'default'}>{row.status}</Badge>
            ),
          },
          {
            key: 'signedAt',
            title: 'Ditandatangani',
            render: (row) =>
              row.signedAt
                ? new Date(row.signedAt).toLocaleString('id-ID')
                : '—',
          },
          {
            key: 'actions',
            title: 'Aksi',
            render: (row) => (
              <Button
                variant="secondary"
                onClick={() => navigate(`/signatures/${row.id}`)}
              >
                <Eye size={14} />
                Detail
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
