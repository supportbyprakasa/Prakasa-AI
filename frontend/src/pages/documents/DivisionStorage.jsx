import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import Select from '../../components/Select';
import { toast } from '../../components/Toast';
import { formatDateTime } from '../../components/format';
import { Mixed, data } from '../../i18n/NoTranslate';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { FILE_KINDS, fileKindIcon, groupDriveFiles } from './documentCenterModel';
import DrivePreviewModal from './drive/DrivePreviewModal';
import FileCard from './drive/FileCard';
import FileGrid from './drive/FileGrid';
import NewMenu from './drive/NewMenu';
import './drive/drive.css';

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
const CREATABLE = FILE_KINDS.filter((entry) => entry.creatable).map((entry) => entry.kind);
const EMPTY_NEW = { name: '' };

// Prakasa AI may type the new file's name; the user presses "Buat file"
// (docs/prakasa-ai-rencana.md §9.9). Nothing is made in Google before that.
const AI_NEW_FILE = defineAIForm({
  id: 'doc-division-file',
  title: 'Buat file di folder divisi',
  permission: 'document.create',
  submitLabel: 'Buat file',
  fields: [
    f.text('name', 'Nama file', { required: true, maxLength: 200 }),
  ],
});
const fileMeta = (file) => {
  const owner = file.owners?.[0]?.displayName;
  const modified = file.modifiedTime ? formatDateTime(file.modifiedTime) : null;
  return owner || modified ? <Mixed parts={[data(owner), modified]} /> : null;
};

// The division's Shared Drive folder. Standalone at /division-storage, and the
// "Drive divisi" tab of My Drive (`embedded`: no page header of its own).
export default function DivisionStorage({ embedded = false }) {
  const { user } = useAuth();
  // Deleting a division file is the Head's (document.delete, what the API checks).
  const canDelete = (user?.permissions || []).includes('document.delete');
  const [divisions, setDivisions] = useState(null);
  const [divisionsError, setDivisionsError] = useState('');
  const [departmentId, setDepartmentId] = useState(null);
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openDoc, setOpenDoc] = useState(null);
  const [createKind, setCreateKind] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newValues, setNewValues] = useState(EMPTY_NEW);
  useEffect(() => { if (createKind) setNewValues(EMPTY_NEW); }, [createKind]);
  const ai = usePrakasaAIForm(AI_NEW_FILE, {
    enabled: Boolean(createKind),
    values: newValues,
    setValues: setNewValues,
    initialValues: EMPTY_NEW,
  });
  // /division-storage?baru=document|spreadsheet|presentation opens "Buat …".
  useOpenFromUrl('baru', (kind) => { if (CREATABLE.includes(kind)) setCreateKind(kind); }, { enabled: !embedded && Boolean(departmentId), keepUnsaved: true });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadDivisions = () => {
    setDivisionsError('');
    api.get('/division-storage/divisions').then((response) => {
      const data = response.data.data || {};
      const list = Array.isArray(data.divisions) ? data.divisions : [];
      setDivisions(list);
      // A user with no home department (cross-division admin) still needs a
      // starting point: the first division the list offers.
      setDepartmentId(data.defaultDepartmentId || list[0]?.id || null);
    }).catch((err) => setDivisionsError(errorMessage(err, 'Daftar divisi gagal dimuat.')));
  };
  useEffect(loadDivisions, []);

  const loadFiles = (deptId) => {
    if (!deptId) return;
    setLoading(true);
    setError(null);
    api.get('/division-storage/files', { params: { departmentId: deptId } })
      .then((response) => setFiles(response.data.data?.files || []))
      .catch((err) => setError(errorMessage(err, 'Folder divisi gagal dimuat.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFiles(departmentId); /* eslint-disable-next-line */ }, [departmentId]);

  const onDelete = async () => {
    const file = deleteTarget;
    if (!file) return;
    setDeleting(true);
    try {
      await api.delete(`/division-storage/files/${file.id}`, { params: { departmentId } });
      toast('File dihapus', 'success');
      setDeleteTarget(null);
      loadFiles(departmentId);
    } catch (err) {
      toast(errorMessage(err, 'File gagal dihapus'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const onCreate = async (event) => {
    event.preventDefault();
    const name = newValues.name.trim();
    if (!name) return;
    setCreating(true);
    try {
      const response = await api.post('/division-storage/files', { departmentId, name, kind: createKind });
      toast('File dibuat', 'success');
      setCreateKind(null);
      loadFiles(departmentId);
      setOpenDoc(response.data.data);
    } catch (err) {
      toast(errorMessage(err, 'File gagal dibuat'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const newMenu = (
    <NewMenu
      disabled={!departmentId}
      items={FILE_KINDS.filter((entry) => entry.creatable).map((entry) => ({
        label: entry.label, icon: entry.icon, onClick: () => setCreateKind(entry.kind),
      }))}
    />
  );

  const divisionSelect = divisions && divisions.length > 1 ? (
    <Select
      label="Divisi"
      fieldClassName="drive-toolbar__select"
      value={departmentId || ''}
      onChange={(event) => setDepartmentId(Number(event.target.value))}
      options={divisions.map((division) => ({ value: division.id, label: division.name }))}
    />
  ) : null;

  let content;
  if (divisionsError) {
    content = (
      <EmptyState
        tone="error"
        title="Daftar divisi gagal dimuat"
        description={divisionsError}
        action={<Button variant="secondary" onClick={loadDivisions}>Coba lagi</Button>}
      />
    );
  } else if (divisions && !departmentId) {
    content = <EmptyState icon="folder_off" title="Belum ada folder divisi" description="Akun Anda belum terhubung ke divisi yang punya Shared Drive." />;
  } else if (error) {
    content = (
      <EmptyState
        tone="error"
        title="Folder divisi gagal dimuat"
        description={error}
        action={<Button variant="secondary" onClick={() => loadFiles(departmentId)}>Coba lagi</Button>}
      />
    );
  } else if (loading || !divisions || !files) {
    content = <LoadingState label="Memuat folder divisi…" />;
  } else if (!files.length) {
    content = <EmptyState icon="folder_open" title="Folder ini masih kosong" description="Buat dokumen, spreadsheet, atau slide lewat tombol Buat baru." />;
  } else {
    content = groupDriveFiles(files).map((group) => (
      <FileGrid key={group.kind} title={group.label}>
        {group.files.map((file) => (
          <FileCard
            key={file.id}
            name={file.name}
            meta={fileMeta(file)}
            icon={fileKindIcon(file)}
            thumbnail={file.thumbnailLink}
            onOpen={() => setOpenDoc(file)}
            onDelete={canDelete ? () => setDeleteTarget(file) : undefined}
          />
        ))}
      </FileGrid>
    ));
  }

  const dialogs = (
    <>
      <Modal open={!!createKind} onClose={() => setCreateKind(null)} title={`Buat ${(FILE_KINDS.find((entry) => entry.kind === createKind)?.label || 'file').toLowerCase()}`} size="sm">
        <form onSubmit={onCreate} className="pw-stack">
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
        title="Hapus file?"
        message={`"${deleteTarget?.name || ''}" dipindahkan ke sampah Shared Drive divisi.`}
        confirmLabel="Hapus file"
        loading={deleting}
        onConfirm={onDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <DrivePreviewModal
        file={openDoc ? { name: openDoc.name, fileId: openDoc.id, mimeType: openDoc.mimeType, webViewLink: openDoc.webViewLink } : null}
        onClose={() => setOpenDoc(null)}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="pw-stack pw-stack--lg">
        <div className="drive-toolbar">
          <div className="drive-toolbar__start">
            {divisionSelect || <p className="pw-text-helper">Folder Shared Drive divisi Anda. Buat dan edit dokumen langsung dari sini.</p>}
          </div>
          {newMenu}
        </div>
        {content}
        {dialogs}
      </div>
    );
  }

  return (
    <Page
      title="Penyimpanan divisi"
      description="Folder Shared Drive divisi Anda. Buat dan edit dokumen langsung dari sini."
      actions={newMenu}
    >
      {divisionSelect ? <div className="drive-toolbar">{divisionSelect}</div> : null}
      {content}
      {dialogs}
    </Page>
  );
}
