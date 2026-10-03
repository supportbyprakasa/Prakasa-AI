import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import AiAssistantPanel from '../../components/AiAssistantPanel';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import FormActions from '../../components/FormActions';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { classifyFileKind } from './documentCenterModel';
import DrivePreviewModal from './drive/DrivePreviewModal';
import './document-center.css';

const CATEGORIES = [
  { key: 'all', label: 'Semua' },
  { key: 'document', label: 'Dokumen' },
  { key: 'spreadsheet', label: 'Spreadsheet' },
  { key: 'presentation', label: 'Slide' },
];
const PAGE_SIZE = 20;
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

// /documents is a closed route (decision K11): restyled only through the
// shared components. The list pages on the API (one count, every page
// reachable); the category chips narrow the rows of the page on screen.
export default function DocumentCenter() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [category, setCategory] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = { page, limit: PAGE_SIZE, ...(q ? { q } : {}), ...(documentType ? { documentType } : {}) };
      const response = await api.get('/documents', { params });
      setRows(response.data.data || []);
      setMeta({ page, limit: PAGE_SIZE, total: 0, ...(response.data.meta || {}) });
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [q, documentType]);

  useEffect(() => { load(1); }, [load]);

  const visibleRows = category === 'all' ? rows : rows.filter((row) => classifyFileKind(row.mimeType) === category);

  const onUpload = async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    setUploading(true);
    try {
      await api.post('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('Dokumen diunggah', 'success');
      setUploadOpen(false);
      load(1);
    } catch (error) {
      toast(errorMessage(error, 'Dokumen gagal diunggah'), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Page
      title="Dokumen"
      actions={<Button icon="upload" onClick={() => setUploadOpen(true)}>Unggah dokumen</Button>}
    >
      <DataGrid
        title="Dokumen"
        showTitle={false}
        columns={[
          { key: 'title', header: 'Judul' },
          { key: 'documentType', header: 'Tipe', translate: true },
          { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          { key: 'createdAt', header: 'Dibuat', type: 'datetime' },
        ]}
        rows={visibleRows}
        loading={loading}
        error={loadError}
        onRetry={() => load(meta.page || 1)}
        meta={meta}
        onPageChange={load}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Cari judul"
        filters={(
          <>
            {CATEGORIES.map((entry) => (
              <Chip key={entry.key} selected={category === entry.key} onClick={() => setCategory(entry.key)}>
                {entry.label}
              </Chip>
            ))}
            <Input
              dense
              label="Tipe dokumen"
              aria-label="Tipe dokumen"
              placeholder="Tipe dokumen, mis. proposal"
              fieldClassName="dc-filter"
              defaultValue={documentType}
              onKeyDown={(event) => { if (event.key === 'Enter') setDocumentType(event.currentTarget.value.trim()); }}
              onBlur={(event) => setDocumentType(event.currentTarget.value.trim())}
            />
          </>
        )}
        empty={category === 'all' ? 'Belum ada dokumen' : 'Tidak ada dokumen jenis ini di halaman ini'}
        onRowClick={setSelected}
        rowActions={(row) => (row.webViewLink ? (
          <>
            <IconButton label="Pratinjau" icon="visibility" size="sm" onClick={() => setPreviewDoc(row)} />
            <IconButton label="Buka di Google" icon="open_in_new" size="sm" href={row.webViewLink} target="_blank" rel="noopener noreferrer" />
          </>
        ) : null)}
      />

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Unggah dokumen">
        <form onSubmit={onUpload} className="pw-stack">
          <div className="pw-form-grid">
            <Input label="ID entitas" name="entityId" type="number" required hint="Nomor ID entitas pemilik dokumen." />
            <Input label="ID divisi" name="departmentId" type="number" hint="Opsional. Nomor ID divisi." />
            <Input label="Judul" name="title" required />
            <Input label="Tipe dokumen" name="documentType" required hint="Contoh: proposal, quotation, sop." />
          </div>
          <Input label="File" name="file" type="file" required />
          <FormActions>
            <Button variant="text" type="button" onClick={() => setUploadOpen(false)}>Batal</Button>
            <Button type="submit" loading={uploading}>Unggah dokumen</Button>
          </FormActions>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''} dataTitle>
        {selected && (
          <div className="pw-stack">
            <KeyValue
              items={[
                { label: 'Tipe', translate: true, value: selected.documentType },
                { label: 'Status', value: <StatusBadge status={selected.status} /> },
              ]}
            />
            <AiAssistantPanel documentId={selected.id} />
          </div>
        )}
      </Modal>

      <DrivePreviewModal
        file={previewDoc ? { name: previewDoc.title, fileId: previewDoc.driveFileId, mimeType: previewDoc.mimeType, webViewLink: previewDoc.webViewLink } : null}
        onClose={() => setPreviewDoc(null)}
        actions={(
          <>
            <Button variant="text" icon="draw" onClick={() => navigate('/signatures/asset')}>Tanda tangan saya</Button>
            <Button variant="text" icon="signature" onClick={() => navigate('/signatures')}>Permintaan tanda tangan</Button>
            <Button variant="text" icon="approval" onClick={() => navigate('/signatures/letterhead')}>Cap surat</Button>
          </>
        )}
      />
    </Page>
  );
}
