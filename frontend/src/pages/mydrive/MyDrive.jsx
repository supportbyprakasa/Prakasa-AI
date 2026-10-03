import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import TabBar from '../../components/TabBar';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { Mixed, NoTranslate, data } from '../../i18n/NoTranslate';
import DivisionStorage from '../documents/DivisionStorage';
import { FILE_KINDS, fileKindIcon, groupDriveFiles, isFolder } from '../documents/documentCenterModel';
import DrivePreviewModal from '../documents/drive/DrivePreviewModal';
import FileCard from '../documents/drive/FileCard';
import FileGrid from '../documents/drive/FileGrid';
import NewMenu from '../documents/drive/NewMenu';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';

const ROOT = { id: null, name: 'My Drive' };
const TABS = [
  { k: 'mydrive', l: 'My Drive', icon: 'hard_drive' },
  { k: 'shared', l: 'Drive divisi', icon: 'folder_shared' },
];
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
const CREATABLE = ['folder', ...FILE_KINDS.filter((entry) => entry.creatable).map((entry) => entry.kind)];
const EMPTY_NEW = { name: '' };

// Prakasa AI may type the new folder's or file's name; the user presses the
// dialog's own button (docs/prakasa-ai-rencana.md §9.9). Uploads stay with the user.
const AI_NEW_ITEM = defineAIForm({
  id: ({ folder }) => (folder ? 'mydrive-folder' : 'mydrive-file'),
  title: ({ folder }) => (folder ? 'Buat folder di My Drive' : 'Buat file di My Drive'),
  permission: 'mydrive.manage',
  submitLabel: ({ folder }) => (folder ? 'Buat folder' : 'Buat file'),
  fields: ({ folder }) => [
    f.text('name', folder ? 'Nama folder' : 'Nama file', { required: true, maxLength: 200 }),
  ],
});
const fileMeta = (file) => {
  const owner = isFolder(file) ? null : file.owners?.[0]?.displayName;
  const modified = file.modifiedTime ? formatDateTime(file.modifiedTime) : null;
  return owner || modified ? <Mixed parts={[data(owner), modified]} /> : null;
};

function MyDriveBrowser() {
  const { user } = useAuth();
  // Creating, uploading and deleting need mydrive.manage (the API's check).
  const canManage = (user?.permissions || []).includes('mydrive.manage');
  const [path, setPath] = useState([ROOT]);
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openDoc, setOpenDoc] = useState(null);
  const [createKind, setCreateKind] = useState(null); // 'folder' | 'document' | 'spreadsheet' | 'presentation'
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const [newValues, setNewValues] = useState(EMPTY_NEW);
  useEffect(() => { if (createKind) setNewValues(EMPTY_NEW); }, [createKind]);
  const ai = usePrakasaAIForm(AI_NEW_ITEM, {
    enabled: Boolean(createKind),
    values: newValues,
    setValues: setNewValues,
    initialValues: EMPTY_NEW,
    context: { folder: createKind === 'folder' },
  });
  // /my-drive?baru=folder|document|spreadsheet|presentation opens "Buat …".
  useOpenFromUrl('baru', (kind) => { if (CREATABLE.includes(kind)) setCreateKind(kind); }, { keepUnsaved: true });

  const currentFolderId = path[path.length - 1].id;

  const load = (folderId) => {
    setLoading(true);
    setError(null);
    api.get('/my-drive/files', { params: folderId ? { folderId } : {} })
      .then((response) => setFiles(response.data.data?.files || []))
      .catch((err) => setError(errorMessage(err, 'My Drive gagal dimuat.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(currentFolderId); /* eslint-disable-next-line */ }, [currentFolderId]);

  const openFolder = (folder) => setPath((current) => [...current, { id: folder.id, name: folder.name }]);
  const goToCrumb = (index) => setPath((current) => current.slice(0, index + 1));

  const onDelete = async () => {
    const file = deleteTarget;
    if (!file) return;
    setDeleting(true);
    try {
      await api.delete(`/my-drive/files/${file.id}`);
      toast(isFolder(file) ? 'Folder dihapus' : 'File dihapus', 'success');
      setDeleteTarget(null);
      load(currentFolderId);
    } catch (err) {
      toast(errorMessage(err, 'File gagal dihapus'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const onCreateFolder = async (event) => {
    event.preventDefault();
    const name = newValues.name.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.post('/my-drive/folders', { name, parentId: currentFolderId });
      toast('Folder dibuat', 'success');
      setCreateKind(null);
      load(currentFolderId);
    } catch (err) {
      toast(errorMessage(err, 'Folder gagal dibuat'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const onCreateFile = async (event) => {
    event.preventDefault();
    const name = newValues.name.trim();
    if (!name) return;
    setCreating(true);
    try {
      const response = await api.post('/my-drive/files', { name, kind: createKind, parentId: currentFolderId });
      toast('File dibuat', 'success');
      setCreateKind(null);
      load(currentFolderId);
      setOpenDoc(response.data.data);
    } catch (err) {
      toast(errorMessage(err, 'File gagal dibuat'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (currentFolderId) fd.append('parentId', currentFolderId);
      await api.post('/my-drive/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('File diunggah', 'success');
      load(currentFolderId);
    } catch (err) {
      toast(errorMessage(err, 'File gagal diunggah'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const newItems = [
    { label: 'Folder', icon: 'create_new_folder', onClick: () => setCreateKind('folder') },
    { label: 'Unggah file', icon: 'upload_file', onClick: () => fileInputRef.current?.click() },
    { divider: true, key: 'kinds' },
    ...FILE_KINDS.filter((entry) => entry.creatable).map((entry) => ({
      label: entry.label, icon: entry.icon, onClick: () => setCreateKind(entry.kind),
    })),
  ];

  let content;
  if (error) {
    content = (
      <EmptyState
        tone="error"
        title="My Drive gagal dimuat"
        description={error}
        action={<Button variant="secondary" onClick={() => load(currentFolderId)}>Coba lagi</Button>}
      />
    );
  } else if (loading || !files) {
    content = <LoadingState label="Memuat My Drive…" />;
  } else if (!files.length) {
    // One empty state for an empty folder (audit 2.F), not one per group.
    content = <EmptyState icon="folder_open" title="Folder ini kosong" description="Buat folder atau file, atau unggah file lewat tombol Buat baru." />;
  } else {
    content = groupDriveFiles(files, { folders: true }).map((group) => (
      <FileGrid key={group.kind} title={group.label}>
        {group.files.map((file) => (
          <FileCard
            key={file.id}
            name={file.name}
            meta={fileMeta(file)}
            icon={fileKindIcon(file)}
            thumbnail={isFolder(file) ? null : file.thumbnailLink}
            onOpen={() => (isFolder(file) ? openFolder(file) : setOpenDoc(file))}
            onDelete={canManage ? () => setDeleteTarget(file) : undefined}
          />
        ))}
      </FileGrid>
    ));
  }

  const last = path.length - 1;
  const createLabel = FILE_KINDS.find((entry) => entry.kind === createKind)?.label || 'file';

  return (
    <div className="pw-stack pw-stack--lg">
      <div className="drive-toolbar">
        <nav className="drive-toolbar__start" aria-label="Lokasi folder">
          <ol className="drive-path">
            {path.map((crumb, index) => (
              <li key={crumb.id || 'root'} className="drive-path__step">
                {index > 0 ? <Icon name="chevron_right" size="sm" className="drive-path__sep" /> : null}
                {index === last ? (
                  <span data-no-translate={index > 0 ? '' : undefined} className="drive-path__current" aria-current="page">{crumb.name}</span>
                ) : (
                  <Button variant="text" type="button" icon={index === 0 ? 'home' : undefined} onClick={() => goToCrumb(index)}>
                    {index > 0 ? <NoTranslate>{crumb.name}</NoTranslate> : crumb.name}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <input ref={fileInputRef} type="file" hidden tabIndex={-1} aria-label="Pilih file untuk diunggah ke My Drive" onChange={onUpload} />
        {canManage ? <NewMenu items={newItems} loading={uploading} /> : null}
      </div>

      {content}

      <Modal open={createKind === 'folder'} onClose={() => setCreateKind(null)} title="Buat folder" size="sm">
        <form onSubmit={onCreateFolder} className="pw-stack">
          {createKind === 'folder' ? ai.notice : null}
          <Input label="Nama folder" name="name" required autoFocus maxLength={200} value={newValues.name} {...ai.field('name')} onChange={(event) => setNewValues({ name: event.target.value })} />
          <FormActions>
            <Button variant="text" type="button" onClick={() => setCreateKind(null)}>Batal</Button>
            <Button type="submit" loading={creating}>Buat folder</Button>
          </FormActions>
        </form>
      </Modal>

      <Modal open={!!createKind && createKind !== 'folder'} onClose={() => setCreateKind(null)} title={`Buat ${createLabel.toLowerCase()}`} size="sm">
        <form onSubmit={onCreateFile} className="pw-stack">
          {ai.notice}
          <Input label="Nama file" name="name" required autoFocus maxLength={200} value={newValues.name} {...ai.field('name')} onChange={(event) => setNewValues({ name: event.target.value })} />
          <FormActions>
            <Button variant="text" type="button" onClick={() => setCreateKind(null)}>Batal</Button>
            <Button type="submit" loading={creating}>Buat file</Button>
          </FormActions>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        tone="danger"
        title={isFolder(deleteTarget) ? 'Hapus folder?' : 'Hapus file?'}
        message={`"${deleteTarget?.name || ''}" dipindahkan ke sampah Google Drive Anda.`}
        confirmLabel={isFolder(deleteTarget) ? 'Hapus folder' : 'Hapus file'}
        loading={deleting}
        onConfirm={onDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <DrivePreviewModal
        file={openDoc ? { name: openDoc.name, fileId: openDoc.id, mimeType: openDoc.mimeType, webViewLink: openDoc.webViewLink } : null}
        onClose={() => setOpenDoc(null)}
      />
    </div>
  );
}

export default function MyDrive() {
  const { user } = useAuth();
  // The division's Shared Drive tab needs document.view (the API's check):
  // without it the tab only showed an error.
  const tabs = TABS.filter((t) => t.k !== 'shared' || (user?.permissions || []).includes('document.view'));
  const [tab, setTab] = useState('mydrive');
  return (
    <Page title="My Drive" description="Drive pribadi Anda di Google dan folder Shared Drive divisi Anda, dalam satu tempat.">
      {tabs.length > 1 ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Pilih drive" idPrefix="mydrive-tab" panelId="mydrive-panel" /> : null}
      <div id="mydrive-panel" role="tabpanel" aria-labelledby={`mydrive-tab-${tab}`}>
        {tab === 'mydrive' ? <MyDriveBrowser /> : <DivisionStorage embedded />}
      </div>
    </Page>
  );
}
