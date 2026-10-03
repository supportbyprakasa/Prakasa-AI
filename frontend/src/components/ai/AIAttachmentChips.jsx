import { useEffect, useState } from 'react';
import Banner from '../Banner';
import Icon from '../Icon';
import IconButton from '../IconButton';
import Spinner from '../Spinner';
import { attachmentKind, formatBytes } from './aiFiles';

const KIND_ICONS = { image: 'image', pdf: 'picture_as_pdf', file: 'description' };

// A small preview of an image that has not been sent yet. The object URL lives
// as long as the chip does.
function Thumbnail({ file }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') return undefined;
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return url ? <img className="ai-attachment-thumb" src={url} alt="" /> : <Icon name="image" size="sm" />;
}

// The files of a message: while it is being written (`onRemove` given: each has
// a remove button and its upload state) and under a sent message (name and
// size only). A file name is record data: never translated.
export default function AIAttachmentChips({ items, onRemove, disabled = false, sent = false }) {
  if (!items?.length) return null;
  return (
    <ul className={`ai-attachments${sent ? ' is-sent' : ''}`} aria-label={sent ? 'Lampiran pesan ini' : 'File terlampir'}>
      {items.map((item) => {
        const kind = item.kind || attachmentKind(item);
        const failed = item.status === 'error';
        const unread = item.readable === false;
        return (
          <li key={item.key || item.documentId} className={`ai-attachment-chip${failed ? ' is-error' : ''}${unread ? ' is-unread' : ''}`}>
            {item.status === 'uploading'
              ? <Spinner label={null} />
              : kind === 'image' && item.file ? <Thumbnail file={item.file} /> : <Icon name={KIND_ICONS[kind]} size="sm" />}
            <span className="pw-tooltip-anchor ai-attachment-name" data-pw-tooltip={item.name}>
              <span data-no-translate="" className="ai-attachment-text">{item.name}</span>
            </span>
            <span className="ai-attachment-size">
              {item.status === 'uploading' ? 'Membaca…' : failed ? 'Gagal' : unread ? 'Tidak terbaca' : formatBytes(item.size)}
            </span>
            {onRemove ? (
              <IconButton
                size="sm"
                label="Hapus lampiran"
                icon="close"
                onClick={() => onRemove(item.key)}
                disabled={disabled}
                aria-label={`Hapus lampiran ${item.name}`}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// Why a file was not attached, or why the message was not sent: one line per
// problem — the file name (data) and the sentence (translated) kept apart.
export function AIAttachmentErrors({ errors, onClose }) {
  if (!errors?.length) return null;
  return (
    <div className="ai-attachment-errors">
      <Banner tone="error" action={<IconButton size="sm" label="Tutup pesan" icon="close" onClick={onClose} />}>
        {errors.map((error, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index} className="ai-attachment-error">
            {error.name ? <><span data-no-translate="">{error.name}</span>{' — '}</> : null}
            <span>{error.text}</span>
          </span>
        ))}
      </Banner>
    </div>
  );
}
