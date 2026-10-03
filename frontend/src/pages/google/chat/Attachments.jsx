import { useEffect, useRef, useState } from 'react';
import IconButton from '../../../components/IconButton';
import Spinner from '../../../components/Spinner';
import { toast } from '../../../components/Toast';
import { FileIcon, errorText, fetchAttachmentBlob, saveBlob } from './parts';

// Image preview fetched through the authenticated proxy once it scrolls into view.
function ImagePreview({ spaceId, messageName, attachment }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let url = null;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      fetchAttachmentBlob(spaceId, messageName, attachment.index)
        .then((blob) => { if (!cancelled) { url = URL.createObjectURL(blob); setSrc(url); } })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [spaceId, messageName, attachment.index]);

  return (
    <span ref={ref} className="pw-gchat__image">
      {src ? (
        <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Buka ${attachment.title}`}>
          <img src={src} alt={attachment.title} data-no-translate="attr" loading="lazy" />
        </a>
      ) : <span className="pw-gchat__image-placeholder">{failed ? 'Gambar tidak dapat dimuat' : <Spinner label="Memuat gambar" />}</span>}
    </span>
  );
}

export default function Attachments({ spaceId, message }) {
  const [busy, setBusy] = useState(null);
  const download = async (attachment) => {
    setBusy(attachment.index);
    try {
      saveBlob(await fetchAttachmentBlob(spaceId, message.name, attachment.index), attachment.title);
    } catch (err) {
      toast(errorText(err, 'Gagal mengunduh lampiran'), 'error');
    } finally {
      setBusy(null);
    }
  };

  // Drive attachments render as Drive chips (DriveChips) instead.
  const uploads = (message.attachments || []).filter((attachment) => !attachment.driveFileId);
  if (!uploads.length) return null;
  return (
    <ul className="pw-gchat__attachments">
      {uploads.map((attachment) => {
        const key = `${attachment.index}-${attachment.title}`;
        const icon = <FileIcon mimeType={attachment.contentType} size="sm" />;
        if (attachment.isImage && attachment.downloadable && !message.pending) {
          return (
            <li key={key} className="pw-gchat__attachment-image">
              <ImagePreview spaceId={spaceId} messageName={message.name} attachment={attachment} />
              <IconButton size="sm" label={`Unduh ${attachment.title}`} icon="download" onClick={() => download(attachment)} disabled={busy === attachment.index} />
            </li>
          );
        }
        if (attachment.url) {
          return (
            <li key={key}>
              <a className="pw-gchat__attachment pw-state-layer pw-ripple" href={attachment.url} target="_blank" rel="noopener noreferrer">
                {icon}<span data-no-translate="">{attachment.title}</span>
              </a>
            </li>
          );
        }
        if (attachment.downloadable && !message.pending) {
          return (
            <li key={key} className="pw-gchat__attachment">
              {icon}<span data-no-translate="">{attachment.title}</span>
              <IconButton size="sm" label={`Unduh ${attachment.title}`} icon="download" onClick={() => download(attachment)} disabled={busy === attachment.index} />
            </li>
          );
        }
        return (
          <li key={key} className="pw-gchat__attachment is-disabled">{icon}<span data-no-translate="">{attachment.title}</span></li>
        );
      })}
    </ul>
  );
}
