import { useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import RecordDialog from './RecordDialog';

const isHttpUrl = (value) => {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
};

export default function Entities() {
  const [editor, setEditor] = useState(null); // { row } — row null creates
  const [reloadKey, setReloadKey] = useState(0);

  const columns = useMemo(() => [
    { key: 'id', header: 'ID', editable: false, width: 72 },
    {
      key: 'name',
      header: 'Nama entitas',
      required: true,
      validate: (v) => (String(v).trim().length > 150 ? 'Maksimal 150 karakter' : undefined),
    },
    {
      key: 'brandCode',
      header: 'Kode brand',
      required: true,
      mono: true,
      validate: (v) => (String(v).trim().length > 50 ? 'Maksimal 50 karakter' : undefined),
    },
    {
      key: 'logoUrl',
      header: 'URL logo',
      hint: 'Opsional. URL lengkap, contoh https://contoh.com/logo.png',
      // Optional — but when filled the API only accepts a real URL, so catch it
      // here instead of letting the save fail with a validation error.
      validate: (v) => {
        if (!String(v ?? '').trim()) return undefined;
        return isHttpUrl(v) ? undefined : 'Isi URL lengkap, contoh https://contoh.com/logo.png';
      },
    },
    { key: 'createdAt', header: 'Dibuat', type: 'datetime', editable: false },
  ], []);

  const editing = editor?.row || null;

  return (
    <Page>
      <PageHeader
        title="Entitas"
        description="Badan usaha yang memakai Prakasa Workspace. Setiap divisi, peran, dan dokumen bernaung di bawah salah satunya."
        actions={<Button icon="add" onClick={() => setEditor({ row: null })}>Tambah entitas</Button>}
      />
      <DataGrid
        title="Semua entitas"
        exportName="entities"
        resource="/entities"
        reloadKey={reloadKey}
        columns={columns}
        canUpdate
        canDelete
        onEditRow={(row) => setEditor({ row })}
        onRowClick={(row) => setEditor({ row })}
        empty="Belum ada entitas"
        deleteMessage={(row) => `Entitas “${row.name}” akan dihapus. Entitas yang masih punya pengguna, divisi, atau peran tidak dapat dihapus.`}
      />

      <RecordDialog
        open={Boolean(editor)}
        title={editing ? 'Ubah entitas' : 'Tambah entitas'}
        submitLabel={editing ? 'Simpan perubahan' : 'Tambah entitas'}
        columns={columns}
        row={editing}
        onClose={() => setEditor(null)}
        onSubmit={(payload) => (editing
          ? api.patch(`/entities/${editing.id}`, payload)
          : api.post('/entities', payload))}
        onSaved={() => setReloadKey((key) => key + 1)}
      />
    </Page>
  );
}
