import Button from '../../../components/Button';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import { getGoogleEditUrl, getGooglePreviewUrl } from '../documentCenterModel';
import './drive.css';

// A Drive file opened inside the app: the Google editor (Docs, Sheets, Slides
// and their Office formats) or Google's read-only preview, in the full-screen
// dialog. `file` = { name, fileId, mimeType, webViewLink }; `actions` are
// extra buttons shown before "Buka di Google".
export default function DrivePreviewModal({ file, onClose, actions }) {
  const src = file ? (getGoogleEditUrl(file.fileId, file.mimeType) || getGooglePreviewUrl(file.webViewLink)) : null;
  const footer = file ? (
    <>
      {actions}
      {file.webViewLink ? (
        <Button variant="secondary" icon="open_in_new" href={file.webViewLink} target="_blank" rel="noreferrer">
          Buka di Google
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <Modal open={Boolean(file)} onClose={onClose} title={file?.name || ''} dataTitle size="lg" footer={footer}>
      {file && src ? (
        <div className="drive-preview">
          <iframe
            title={`Pratinjau ${file.name || ''}`}
            src={src}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
      {file && !src ? (
        <EmptyState
          icon="visibility_off"
          title="Pratinjau tidak tersedia"
          description="File ini tidak bisa ditampilkan di aplikasi. Buka di Google untuk melihat isinya."
        />
      ) : null}
    </Modal>
  );
}
