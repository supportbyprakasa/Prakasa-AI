import { useEffect, useState } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import Banner from '../../../components/Banner';
import Segmented from '../../../components/Segmented';
import { accessSummary } from '../chatModel';
import { FileIcon } from './parts';

const ROLES = [
  { role: 'reader', label: 'Lihat', icon: 'visibility' },
  { role: 'commenter', label: 'Komentar', icon: 'chat' },
  { role: 'writer', label: 'Ubah', icon: 'edit' },
];

// Like Google Chat: some members can't open the chosen Drive files yet →
// give them view / comment / edit access, or send the links anyway.
// onDecision({ role }) | onDecision('send') | onDecision('cancel')
export default function DriveAccessDialog({ check, title, busy, onDecision }) {
  const [role, setRole] = useState('reader');
  useEffect(() => { if (check) setRole('reader'); }, [check]);
  const summary = accessSummary(check);
  const lacking = [...summary.shareable, ...summary.blocked];

  return (
    <Modal
      open={Boolean(check)}
      onClose={busy ? undefined : () => onDecision('cancel')}
      title="Bagikan file ke anggota?"
      size="sm"
      footer={(
        <>
          <Button variant="text" onClick={() => onDecision('cancel')} disabled={busy}>Batal</Button>
          <Button variant={summary.shareable.length ? 'secondary' : 'primary'} onClick={() => onDecision('send')} disabled={busy}>Kirim tanpa memberi akses</Button>
          {summary.shareable.length ? (
            <Button onClick={() => onDecision({ role })} loading={busy}>Beri akses &amp; kirim</Button>
          ) : null}
        </>
      )}
    >
      <div className="pw-stack">
        <p className="pw-gchat__dialog-text">
          {summary.people} orang di {title ? <span data-no-translate="">{title}</span> : 'percakapan ini'} belum memiliki akses ke {lacking.length} file berikut.
        </p>
        <ul className="pw-gchat__access-files">
          {lacking.map((file) => (
            <li key={file.id}>
              <FileIcon mimeType={file.mimeType} size="md" />
              <span className="pw-gchat__drive-text">
                <span data-no-translate="" className="pw-gchat__drive-name">{file.name}</span>
                <span className="pw-gchat__muted">
                  {file.canShare ? `${file.missing.length} orang belum punya akses` : 'Anda tidak dapat membagikan file ini'}
                  {file.viaGroup ? ' · sebagian mungkin sudah punya akses lewat grup' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {summary.blocked.length ? (
          <Banner tone="warning">Minta pemilik file untuk membagikan file yang tidak dapat Anda bagikan.</Banner>
        ) : null}
        {summary.shareable.length ? (
          <div className="pw-stack">
            <span className="pw-gchat__label" aria-hidden="true">Beri akses ke anggota space</span>
            <Segmented
              label="Beri akses ke anggota space"
              className="pw-gchat__mode"
              options={ROLES.map(({ role: value, label, icon }) => ({ value, label, icon }))}
              value={role}
              onChange={setRole}
            />
            <p className="pw-gchat__muted">Tanpa email pemberitahuan. Hanya akun Google Workspace perusahaan yang diberi akses.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
