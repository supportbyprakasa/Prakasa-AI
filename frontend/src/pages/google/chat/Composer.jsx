import { useId, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import IconButton from '../../../components/IconButton';
import Menu from '../../../components/Menu';
import Textarea from '../../../components/Textarea';
import { toast } from '../../../components/Toast';
import {
  MAX_TEXT_LENGTH, UPLOAD_ACCEPT, applyFormat, encodeMentions, formatBytes, insertMention,
  mentionCandidates, mentionQuery, plainText, uploadProblem,
} from '../chatModel';
import DrivePicker, { MAX_DRIVE_FILES } from './DrivePicker';
import { Avatar, FileIcon } from './parts';

const FORMATS = [
  { kind: 'bold', label: 'Tebal (*teks*)', icon: 'format_bold' },
  { kind: 'italic', label: 'Miring (_teks_)', icon: 'format_italic' },
  { kind: 'strike', label: 'Coret (~teks~)', icon: 'strikethrough_s' },
  { kind: 'code', label: 'Kode (`teks`)', icon: 'code' },
  { kind: 'codeblock', label: 'Blok kode', icon: 'code_blocks' },
  { kind: 'list', label: 'Daftar berpoin', icon: 'format_list_bulleted' },
];

// Message box: Enter sends, Shift+Enter is a newline, "@" suggests members,
// the toolbar inserts Chat markdown, "+" attaches one uploaded file and/or up
// to 10 Google Drive files (sent as Drive links → smart chips in Chat).
// onSubmit({ text, file, driveFiles, quoted, mentions }) → resolves true when sent.
export default function Composer({ title, members = [], placeholder, quoted, onClearQuoted, replyLabel, onClearReply, onSubmit, compact = false }) {
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState([]);
  const [file, setFile] = useState(null);
  const [driveFiles, setDriveFiles] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef(null);
  const [showFormat, setShowFormat] = useState(false);
  const [mention, setMention] = useState(null); // { query, start }
  const [activeOption, setActiveOption] = useState(0);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const id = useId().replace(/:/g, '');
  const inputId = `pw-gchat-composer-${id}`;
  const listId = `${inputId}-mentions`;
  const attachMenuId = `${inputId}-attach`;

  const textarea = () => document.getElementById(inputId);
  const candidates = mention ? mentionCandidates(members, mention.query) : [];

  const updateMention = (text, caret) => {
    const q = mentionQuery(text, caret);
    setMention(q);
    setActiveOption(0);
  };

  const setSelection = (start, end) => requestAnimationFrame(() => {
    const el = textarea();
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  });

  const format = (kind) => {
    const el = textarea();
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const next = applyFormat(draft, start, end, kind);
    setDraft(next.text.slice(0, MAX_TEXT_LENGTH));
    setSelection(next.start, next.end);
  };

  const chooseMention = (member) => {
    if (!mention || !member) return;
    const next = insertMention(draft, mention, member);
    setDraft(next.text);
    setPicked((list) => [...list, { user: member.user, name: member.displayName }]);
    setMention(null);
    setSelection(next.caret, next.caret);
  };

  const pickFile = (event) => {
    const chosen = event.target.files?.[0] || null;
    event.target.value = '';
    if (!chosen) return;
    const problem = uploadProblem(chosen);
    if (problem) { toast(problem, 'error'); return; }
    setFile(chosen);
  };

  const submit = async () => {
    if (sending) return;
    const text = encodeMentions(draft, picked);
    if (!text.trim() && !file && !driveFiles.length) return;
    if (text.length > MAX_TEXT_LENGTH) { toast(`Pesan maksimal ${MAX_TEXT_LENGTH} karakter`, 'error'); return; }
    const snapshot = { draft, picked, file, driveFiles };
    setDraft('');
    setPicked([]);
    setFile(null);
    setDriveFiles([]);
    setMention(null);
    setSending(Boolean(snapshot.file || snapshot.driveFiles.length));
    const mentions = Object.fromEntries(snapshot.picked.map((p) => [p.user, p.name]));
    const sent = await onSubmit({ text: text.trim() ? text : '', file: snapshot.file, driveFiles: snapshot.driveFiles, quoted, mentions });
    setSending(false);
    if (!sent) {
      setDraft((current) => current || snapshot.draft);
      setPicked(snapshot.picked);
      setFile((current) => current || snapshot.file);
      setDriveFiles((current) => (current.length ? current : snapshot.driveFiles));
    }
  };

  const onKeyDown = (event) => {
    if (mention && candidates.length) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveOption((i) => (i + 1) % candidates.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveOption((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseMention(candidates[activeOption]); return; }
      if (event.key === 'Escape') { event.preventDefault(); setMention(null); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const remaining = MAX_TEXT_LENGTH - draft.length;

  return (
    <>
      <form className={`pw-gchat__composer${compact ? ' is-compact' : ''}`} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {replyLabel ? (
          <div className="pw-gchat__replying">
            <Icon name="subdirectory_arrow_right" size="sm" />
            <span>{replyLabel}</span>
            {onClearReply ? <IconButton size="sm" label="Batal membalas" icon="close" onClick={onClearReply} /> : null}
          </div>
        ) : null}
        {quoted ? (
          <div className="pw-gchat__replying">
            <Icon name="format_quote" size="sm" />
            <span>Mengutip {quoted.sender?.isMe || !quoted.sender?.displayName ? (quoted.sender?.isMe ? 'Anda' : 'pesan') : <span data-no-translate="">{quoted.sender.displayName}</span>}: <span data-no-translate="">{plainText(quoted.text, quoted.mentions).slice(0, 80)}</span></span>
            <IconButton size="sm" label="Batal mengutip" icon="close" onClick={onClearQuoted} />
          </div>
        ) : null}
        {file ? (
          <div className="pw-gchat__file-chip">
            <Icon name="attach_file" size="sm" />
            <span data-no-translate="">{file.name}</span>
            <span className="pw-gchat__muted">{formatBytes(file.size)}</span>
            <IconButton size="sm" label="Hapus lampiran" icon="close" onClick={() => setFile(null)} />
          </div>
        ) : null}
        {driveFiles.length ? (
          <ul className="pw-gchat__drive-draft" aria-label="File Google Drive yang akan dikirim">
            {driveFiles.map((driveFile) => (
              <li key={driveFile.id} className="pw-gchat__file-chip">
                <FileIcon mimeType={driveFile.mimeType} size="sm" />
                <span data-no-translate="">{driveFile.name}</span>
                <IconButton size="sm" label={`Hapus ${driveFile.name}`} icon="close" onClick={() => setDriveFiles((list) => list.filter((f) => f.id !== driveFile.id))} />
              </li>
            ))}
          </ul>
        ) : null}
        {showFormat ? (
          <div className="pw-gchat__format" role="toolbar" aria-label="Format teks">
            {FORMATS.map(({ kind, label, icon }) => (
              <IconButton key={kind} size="sm" label={label} icon={icon} onMouseDown={(event) => event.preventDefault()} onClick={() => format(kind)} />
            ))}
          </div>
        ) : null}
        <div className="pw-gchat__composer-row">
          {mention && candidates.length ? (
            <div className="pw-gchat__mentions" id={listId} role="listbox" aria-label="Sebut anggota">
              {candidates.map((member, index) => (
                <div
                  key={member.user}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeOption}
                  className={`pw-gchat__option pw-state-layer pw-ripple${index === activeOption ? ' is-active' : ''}`}
                  onMouseDown={(event) => { event.preventDefault(); chooseMention(member); }}
                >
                  <Avatar person={member} size="sm" />
                  <span className="pw-gchat__option-text">
                    <span data-no-translate="">{member.displayName}</span>
                    {member.email ? <span data-no-translate="" className="pw-gchat__muted">{member.email}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <IconButton label={showFormat ? 'Sembunyikan format' : 'Format teks'} icon="text_format" selected={showFormat} onClick={() => setShowFormat((v) => !v)} />
          <IconButton
            ref={attachRef}
            label="Lampirkan file"
            icon="add"
            onClick={() => setAttachOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={attachOpen}
            aria-controls={attachOpen ? attachMenuId : undefined}
          />
          <Menu
            id={attachMenuId}
            open={attachOpen}
            anchorRef={attachRef}
            onClose={() => setAttachOpen(false)}
            align="start"
            label="Lampirkan"
            items={[
              { label: 'Unggah dari komputer', icon: 'upload', disabled: Boolean(file), onClick: () => fileRef.current?.click() },
              { label: 'Google Drive', icon: 'add_to_drive', disabled: driveFiles.length >= MAX_DRIVE_FILES, onClick: () => setPickerOpen(true) },
            ]}
          />
          <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="pw-gchat__file-input" onChange={pickFile} tabIndex={-1} aria-hidden="true" />
          <Textarea
            id={inputId}
            aria-label={`Kirim pesan ke ${title}`}
            placeholder={placeholder || `Pesan ke ${title}`}
            rows={1}
            maxLength={MAX_TEXT_LENGTH}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); updateMention(event.target.value, event.target.selectionStart); }}
            onSelect={(event) => updateMention(event.target.value, event.target.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setMention(null)}
            role="combobox"
            aria-expanded={Boolean(mention && candidates.length)}
            aria-controls={mention && candidates.length ? listId : undefined}
            aria-activedescendant={mention && candidates.length ? `${listId}-${activeOption}` : undefined}
            aria-autocomplete="list"
            className="pw-gchat__input"
            fieldClassName="pw-gchat__input-field"
            hint={remaining < 300 ? `${remaining} karakter tersisa` : undefined}
          />
          <IconButton type="submit" variant="filled" label="Kirim pesan" icon="send" disabled={sending || (!draft.trim() && !file && !driveFiles.length)} />
        </div>
      </form>
      <DrivePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(files) => {
          setPickerOpen(false);
          setDriveFiles((current) => {
            const byId = new Map(current.map((f) => [f.id, f]));
            for (const f of files) byId.set(f.id, f);
            return [...byId.values()].slice(0, MAX_DRIVE_FILES);
          });
          textarea()?.focus();
        }}
      />
    </>
  );
}
