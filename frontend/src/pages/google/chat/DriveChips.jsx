import { Link } from 'react-router-dom';
import Icon from '../../../components/Icon';
import { driveFilesOfMessage, driveKind, driveOpenUrl, inAppPath, safeHref } from '../chatModel';
import { useDriveMeta } from './driveMeta';
import { FileIcon } from './parts';

const KIND_LABEL = {
  document: 'Dokumen', spreadsheet: 'Spreadsheet', presentation: 'Presentasi', form: 'Formulir', pdf: 'PDF',
  image: 'Gambar', video: 'Video', audio: 'Audio', folder: 'Folder', file: 'File',
};

export const kindLabel = (mimeType) => KIND_LABEL[driveKind(mimeType)] || 'File';

// One Drive file as a chip: Docs / Sheets / Slides open inside Prakasa
// Workspace, anything else opens in Google Drive in a new tab.
export function DriveChip({ fileId, title, mimeType, meta, className = '' }) {
  const mime = mimeType || meta?.mimeType || null;
  const named = Boolean(title || meta?.name);
  const name = title || meta?.name || (meta?.accessible === false ? 'File Google Drive (tanpa akses)' : 'File Google Drive');
  const path = inAppPath(fileId, mime);
  const external = safeHref(meta?.webViewLink) || driveOpenUrl(fileId);
  const content = (
    <>
      <FileIcon mimeType={mime} size="md" />
      <span className="pw-gchat__drive-text">
        <span className="pw-gchat__drive-name" data-no-translate={named ? '' : undefined}>{name}</span>
        <span className="pw-gchat__muted">{kindLabel(mime)}{path ? '' : ' · Google Drive'}</span>
      </span>
      {path ? null : <Icon name="open_in_new" size="sm" className="pw-gchat__drive-external" />}
    </>
  );
  const classes = `pw-gchat__drive-chip pw-state-layer pw-ripple ${className}`.trim();
  if (path) return <Link to={path} className={classes} aria-label={`Buka ${name}`}>{content}</Link>;
  if (!external) return <span className={classes}>{content}</span>;
  return <a href={external} target="_blank" rel="noopener noreferrer" className={classes} aria-label={`Buka ${name} di Google Drive`}>{content}</a>;
}

export default function DriveChips({ message }) {
  const files = driveFilesOfMessage(message);
  const meta = useDriveMeta(files.filter((f) => !f.title || !f.mimeType).map((f) => f.fileId));
  if (!files.length || message.pending) return null;
  return (
    <ul className="pw-gchat__drive-chips" aria-label="File Google Drive">
      {files.map((file) => (
        <li key={file.fileId}><DriveChip {...file} meta={meta[file.fileId]} /></li>
      ))}
    </ul>
  );
}
