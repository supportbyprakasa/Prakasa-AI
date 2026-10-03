import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import './admin-editors.css';

const COLUMNS = [
  { key: 'id', header: 'ID', type: 'number', width: 72 },
  { key: 'code', header: 'Kode', render: (row) => <code data-no-translate="" className="admin-code">{row.code}</code> },
  { key: 'description', header: 'Deskripsi', translate: true },
];

export default function Permissions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/permissions')
      .then((r) => setRows(r.data.data || []))
      .catch((requestError) => setError(apiErrorMessage(requestError, 'Daftar izin akses tidak dapat dimuat.')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Page>
      <PageHeader
        title="Izin akses"
        description="Daftar izin akses yang bisa diberikan ke peran. Atur pemberiannya di halaman Peran."
      />
      <DataGrid
        title="Semua izin akses"
        exportName="izin-akses"
        columns={COLUMNS}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        searchPlaceholder="Cari kode atau deskripsi"
        empty="Belum ada izin akses"
      />
    </Page>
  );
}
