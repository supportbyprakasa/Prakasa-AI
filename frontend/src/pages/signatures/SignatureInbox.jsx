import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import Chip from '../../components/Chip';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import DataGrid from '../../components/datagrid/DataGrid';
import { Translate } from '../../i18n/NoTranslate';
import { statusLabel } from '../../components/statusTone';
import { SIGNATURE_LEVEL_LABELS, assignedSignerLabel, signedByLabel } from './signatureModel';

const STATUS_FILTERS = [
  { value: '', label: 'Semua status' },
  ...['pending', 'approved', 'rejected', 'signed', 'cancelled'].map((value) => ({ value, label: statusLabel(value) })),
];
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

export default function SignatureInbox() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/signatures', {
        params: { status: status || undefined },
      });
      setRows(response.data.data || []);
    } catch (error) {
      setLoadError(errorMessage(error, 'Permintaan tanda tangan gagal dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <Page
      title="Permintaan tanda tangan"
      description="Penanda tangan yang ditunjuk tampil terpisah dari orang yang benar-benar sudah menandatangani."
    >
      <DataGrid
        title="Permintaan tanda tangan"
        showTitle={false}
        exportName="permintaan-tanda-tangan"
        loading={loading}
        error={loadError}
        onRetry={load}
        rows={rows}
        empty="Belum ada permintaan tanda tangan"
        onRowClick={(row) => navigate(`/signatures/${row.id}`)}
        filters={STATUS_FILTERS.map((option) => (
          <Chip key={option.value || 'all'} selected={status === option.value} onClick={() => setStatus(option.value)}>
            {option.label}
          </Chip>
        ))}
        columns={[
          { key: 'id', header: 'ID', width: 64 },
          { key: 'documentTitle', header: 'Dokumen' },
          { key: 'assignedSigner', header: 'Penanda tangan ditunjuk', exportValue: assignedSignerLabel, render: (row) => (row.assignedSignerUserName ? assignedSignerLabel(row) : <Translate>{assignedSignerLabel(row)}</Translate>) },
          { key: 'signedBy', header: 'Ditandatangani oleh', exportValue: signedByLabel, render: (row) => (row.signedByName ? signedByLabel(row) : <Translate>{signedByLabel(row)}</Translate>) },
          {
            key: 'signatureType',
            header: 'Level',
            exportValue: (row) => SIGNATURE_LEVEL_LABELS[row.signatureType] || row.signatureType || '',
            render: (row) => SIGNATURE_LEVEL_LABELS[row.signatureType] || row.signatureType,
          },
          { key: 'status', header: 'Status', exportValue: (row) => statusLabel(row.status), render: (row) => <StatusBadge status={row.status} /> },
          { key: 'signedAt', header: 'Waktu tanda tangan', type: 'datetime' },
        ]}
      />
    </Page>
  );
}
