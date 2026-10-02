import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Banner from '../../../components/Banner';
import Button from '../../../components/Button';
import Chip from '../../../components/Chip';
import DataGrid from '../../../components/datagrid/DataGrid';
import IconButton from '../../../components/IconButton';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import { toast } from '../../../components/Toast';
import { Translate } from '../../../i18n/NoTranslate';
import {
  FILE_FILTERS, driveOpenUrl, fileTitle, filterFiles, inAppPath, messageFiles, safeHref,
} from '../chatModel';
import { kindLabel } from './DriveChips';
import { useDriveMeta } from './driveMeta';
import { FileIcon, errorText, fetchAttachmentBlob, saveBlob } from './parts';

// "File" tab of a space, like Google Chat's: every upload and Drive file
// shared in the messages loaded so far, newest first; older pages on demand.
export default function FilesTab({ spaceId, messages, loading, nextPageToken, loadingOlder, onLoadOlder }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState('all');
  const [busy, setBusy] = useState(null);
  const items = useMemo(() => messageFiles(messages), [messages]);
  const meta = useDriveMeta(items.filter((i) => i.type === 'drive' && (!i.title || !i.mimeType)).map((i) => i.fileId));
  const known = useMemo(() => Object.fromEntries(Object.entries(meta).map(([id, m]) => [id, { name: m.name, mimeType: m.mimeType }])), [meta]);

  const rows = useMemo(() => filterFiles(items, { kind }, known).map((item) => {
    const mimeType = item.mimeType || known[item.fileId]?.mimeType || null;
    return {
      id: item.key,
      name: fileTitle(item, known),
      // Without a title the cell shows "File Google Drive" / "Lampiran" (interface text).
      named: Boolean(item.title || known[item.fileId]?.name),
      sender: item.message.sender?.isMe ? 'Anda' : (item.message.sender?.displayName || 'Pengguna'),
      // "Anda" / "Pengguna" are interface words; a sender's name is record data.
      senderNamed: !item.message.sender?.isMe && Boolean(item.message.sender?.displayName),
      date: item.message.createTime,
      kind: `${kindLabel(mimeType)}${item.type === 'drive' ? ' · Drive' : ''}`,
      mimeType,
      item,
    };
  }), [items, kind, known]);

  const open = async (row) => {
    const { item } = row;
    if (item.type === 'drive') {
      const path = inAppPath(item.fileId, row.mimeType);
      if (path) { navigate(path); return; }
      const href = safeHref(meta[item.fileId]?.webViewLink) || driveOpenUrl(item.fileId);
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (item.downloadable) {
      setBusy(row.id);
      try {
        saveBlob(await fetchAttachmentBlob(spaceId, item.message.name, item.index), row.name);
      } catch (err) {
        toast(errorText(err, 'Gagal mengunduh lampiran'), 'error');
      } finally {
        setBusy(null);
      }
      return;
    }
    const href = safeHref(item.url);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  const columns = [
    {
      key: 'name',
      header: 'Nama',
      render: (row) => (
        <span className="pw-gchat__file-cell"><FileIcon mimeType={row.mimeType} size="md" /><span data-no-translate={row.named ? '' : undefined} data-translate={row.named ? undefined : ''}>{row.name}</span></span>
      ),
    },
    { key: 'sender', header: 'Dibagikan oleh', render: (row) => (row.senderNamed ? row.sender : <Translate>{row.sender}</Translate>) },
    { key: 'date', header: 'Tanggal', type: 'datetime' },
    { key: 'kind', header: 'Jenis', translate: true },
  ];

  if (loading && !messages.length) return <div className="pw-gchat__tab-panel"><LoadingState label="Memuat file…" /></div>;

  return (
    <div className="pw-gchat__tab-panel pw-gchat__files">
      <Banner tone="info">
        File dari {messages.length} pesan terakhir yang sudah dimuat.
        {nextPageToken ? ' Muat pesan lebih lama untuk melihat file sebelumnya.' : ' Semua pesan sudah dimuat.'}
      </Banner>
      {items.length ? (
        <DataGrid
          title="File di space ini"
          columns={columns}
          rows={rows}
          exportable={false}
          pageSize={20}
          empty="Tidak ada file dengan jenis ini."
          onRowClick={open}
          filters={(
            <div className="pw-gchat__filters" role="group" aria-label="Jenis file">
              {FILE_FILTERS.map((f) => <Chip key={f.key} selected={kind === f.key} onClick={() => setKind(f.key)}>{f.label}</Chip>)}
            </div>
          )}
          rowActions={(row) => (
            row.item.type === 'drive' || !row.item.downloadable ? (
              <IconButton size="sm" label={`Buka ${row.name}`} icon="open_in_new" onClick={(event) => { event.stopPropagation(); open(row); }} />
            ) : (
              <IconButton size="sm" label={`Unduh ${row.name}`} icon="download" disabled={busy === row.id} onClick={(event) => { event.stopPropagation(); open(row); }} />
            )
          )}
        />
      ) : (
        <EmptyState icon="folder_open" title="Belum ada file" description={nextPageToken ? 'Belum ada file di pesan yang dimuat. Coba muat pesan lebih lama.' : 'Belum ada file yang dibagikan di space ini.'} />
      )}
      {nextPageToken ? (
        <div className="pw-gchat__older">
          <Button variant="secondary" loading={loadingOlder} onClick={onLoadOlder}>Muat pesan lebih lama</Button>
        </div>
      ) : null}
    </div>
  );
}
