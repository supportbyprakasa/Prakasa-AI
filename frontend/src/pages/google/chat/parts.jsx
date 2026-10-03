import { useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import GoogleAvatar from '../GoogleAvatar';
import { avatarKind, driveKind } from '../chatModel';

export const errorText = (err, fallback) => err?.response?.data?.error?.message || fallback;
export const errorCode = (err) => err?.response?.data?.error?.code || null;

// The shared Google avatar (GoogleAvatar): DMs show the person's initials,
// named spaces initials on a rounded tile, group chats a people icon, apps a
// bot icon, a deleted account a muted icon. size: sm 32 | md 40.
export function Avatar({ person, space, size = 'md' }) {
  const kind = avatarKind(person ? null : space, person);
  const name = person?.displayName || space?.displayName || '';
  return <GoogleAvatar name={name} kind={kind} size={size} />;
}

const KIND_ICONS = {
  document: 'description', spreadsheet: 'table_chart', presentation: 'slideshow', form: 'list_alt', pdf: 'picture_as_pdf',
  image: 'image', video: 'video_file', audio: 'audio_file', folder: 'folder', file: 'draft',
};

// File-type icon tinted like Google Drive (blue docs, green sheets, …).
// size: sm 18 | md 20 | lg 24.
export function FileIcon({ mimeType, size = 'md' }) {
  const kind = driveKind(mimeType);
  return <Icon name={KIND_ICONS[kind] || 'draft'} size={size} className={`pw-gchat__file-icon pw-gchat__file-icon--${kind}`} />;
}

// Chat formatting rendered as React elements — the text is never HTML.
// What a person or an app wrote: every piece is record data (never translated).
export function RichNodes({ nodes }) {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case 'bold': return <span key={key} className="pw-gchat__bold"><RichNodes nodes={node.children} /></span>;
      case 'italic': return <em key={key}><RichNodes nodes={node.children} /></em>;
      case 'strike': return <s key={key}><RichNodes nodes={node.children} /></s>;
      case 'code': return <code key={key} className="pw-gchat__code">{node.value}</code>;
      case 'codeblock': return <pre key={key} className="pw-gchat__codeblock">{node.value}</pre>;
      case 'mention': return <span key={key} data-no-translate="" className="pw-gchat__mention">{node.value}</span>;
      case 'link': return <a key={key} data-no-translate="" href={node.href} target="_blank" rel="noopener noreferrer">{node.value}</a>;
      default: return <span key={key} data-no-translate="">{node.value}</span>;
    }
  });
}

// Closes a popover (the emoji picker) on outside pointer-down or Escape.
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!ref.current?.contains(event.target)) closeRef.current(); };
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return ref;
}

// Downloads an uploaded Chat attachment through our proxy (it needs the
// Prakasa token, so a plain <a href> can't be used).
export async function fetchAttachmentBlob(spaceId, messageName, index) {
  const messageId = String(messageName).split('/messages/')[1];
  const response = await api.get(`/google-chat/spaces/${spaceId}/messages/${messageId}/attachments/${index}`, { responseType: 'blob' });
  return response.data;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'lampiran';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
