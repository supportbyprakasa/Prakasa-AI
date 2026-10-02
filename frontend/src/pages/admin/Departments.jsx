import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import DataGrid from '../../components/datagrid/DataGrid';
import GridImportDialog from '../../components/datagrid/GridImportDialog';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import RecordDialog from './RecordDialog';

export default function Departments() {
  const [entities, setEntities] = useState([]);
  const [editor, setEditor] = useState(null); // { row } — row null creates
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    api.get('/entities', { params: { page: 1, limit: 100 } })
      .then((r) => setEntities(r.data.data || []))
      .catch(() => setEntities([]));
  }, []);

  const columns = useMemo(() => [
    { key: 'id', header: 'ID', editable: false, width: 72 },
    {
      key: 'entityId',
      header: 'Entitas',
      type: 'select',
      translate: false,
      required: true,
      options: entities.map((entity) => ({ value: entity.id, label: entity.name })),
      defaultValue: () => (entities.length === 1 ? entities[0].id : ''),
    },
    { key: 'name', header: 'Nama divisi', translate: true, required: true, validate: (v) => (String(v).trim().length > 150 ? 'Maksimal 150 karakter' : undefined) },
    { key: 'createdAt', header: 'Dibuat', type: 'datetime', editable: false },
  ], [entities]);

  const editing = editor?.row || null;

  return (
    <Page>
      <PageHeader
        title="Divisi"
        description="Divisi di setiap entitas. Pengguna dan peran divisi bernaung di bawahnya."
        actions={(
          <>
            <Button variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>Impor</Button>
            <Button icon="add" onClick={() => setEditor({ row: null })}>Tambah divisi</Button>
          </>
        )}
      />
      <DataGrid
        title="Semua divisi"
        exportName="divisi"
        resource="/departments"
        reloadKey={reloadKey}
        columns={columns}
        canUpdate
        canDelete
        onEditRow={(row) => setEditor({ row })}
        onRowClick={(row) => setEditor({ row })}
        empty="Belum ada divisi"
        deleteMessage={(row) => `Divisi “${row.name}” akan dihapus. Divisi yang masih dipakai pengguna atau peran tidak dapat dihapus.`}
      />

      <RecordDialog
        open={Boolean(editor)}
        title={editing ? 'Ubah divisi' : 'Tambah divisi'}
        submitLabel={editing ? 'Simpan perubahan' : 'Tambah divisi'}
        columns={columns}
        row={editing}
        onClose={() => setEditor(null)}
        onSubmit={(payload) => (editing
          ? api.patch(`/departments/${editing.id}`, payload)
          : api.post('/departments', payload))}
        onSaved={reload}
      />

      <GridImportDialog
        open={importOpen}
        columns={columns}
        baseName="divisi"
        title="Divisi"
        onClose={() => setImportOpen(false)}
        onImport={async (rows) => (await api.post('/departments/import', { rows })).data.data}
        onImported={reload}
      />
    </Page>
  );
}
