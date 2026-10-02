import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/client';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import Icon from '../../../components/Icon';
import SearchField from '../../../components/SearchField';
import TabBar from '../../../components/TabBar';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import { toast } from '../../../components/Toast';
import { Mixed } from '../../../i18n/NoTranslate';
import { formatBytes, formatLastActive } from '../chatModel';
import { kindLabel } from './DriveChips';
import { rememberDriveMeta } from './driveMeta';
import { FileIcon, errorText } from './parts';

export const MAX_DRIVE_FILES = 10;

const TABS = [
  { key: 'my', label: 'Drive Saya' },
  { key: 'shared', label: 'Dibagikan ke saya' },
  { key: 'drive', label: 'Shared Drive' },
];

// Keyboard-activatable row inside a listbox (Enter / Space).
const activate = (fn) => (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fn(); }
};

// "Google Drive" in the composer's + menu: browse My Drive, files shared with
// me and Shared Drives (as the user), or search; pick up to 10 files.
export default function DrivePicker({ open, onClose, onPick }) {
  const [tab, setTab] = useState('my');
  const [path, setPath] = useState([]); // [{ id, name }] — for 'drive', path[0] is the Shared Drive
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [drives, setDrives] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState([]);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    setTab('my'); setPath([]); setQuery(''); setSearch(''); setSelected([]); setDrives(null);
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim().slice(0, 100)), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const driveId = tab === 'drive' ? path[0]?.id : undefined;
  const folderId = path.length ? path[path.length - 1].id : undefined;
  const listingDrives = tab === 'drive' && !path.length && !search;

  const paramsFor = useCallback((pageToken) => {
    const params = search ? { source: 'search', q: search } : { source: tab };
    if (!search && folderId && folderId !== driveId) params.folderId = folderId;
    if (!search && driveId) params.driveId = driveId;
    if (pageToken) params.pageToken = pageToken;
    return params;
  }, [search, tab, folderId, driveId]);

  const load = useCallback(() => {
    if (!open) return;
    const id = ++request.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setNextPageToken(null);
    const call = listingDrives
      ? api.get('/google-chat/drive/shared-drives').then((r) => { if (id === request.current) setDrives(r.data.data.drives || []); })
      : api.get('/google-chat/drive/files', { params: paramsFor() }).then((r) => {
        if (id !== request.current) return;
        setItems(r.data.data.files || []);
        setNextPageToken(r.data.data.nextPageToken || null);
      });
    call.catch((err) => { if (id === request.current) setError(errorText(err, 'Gagal memuat Google Drive')); })
      .finally(() => { if (id === request.current) setLoading(false); });
  }, [open, listingDrives, paramsFor]);

  useEffect(() => { load(); }, [load]);

  const loadMore = () => {
    if (!nextPageToken || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    api.get('/google-chat/drive/files', { params: paramsFor(nextPageToken) })
      .then((r) => {
        if (id !== request.current) return;
        setItems((current) => current.concat(r.data.data.files || []));
        setNextPageToken(r.data.data.nextPageToken || null);
      })
      .catch((err) => toast(errorText(err, 'Gagal memuat file berikutnya'), 'error'))
      .finally(() => setLoadingMore(false));
  };

  const switchTab = (key) => { setTab(key); setPath([]); setQuery(''); setSearch(''); };

  const isSelected = (file) => selected.some((f) => f.id === file.id);
  const toggle = (file) => {
    if (isSelected(file)) { setSelected((list) => list.filter((f) => f.id !== file.id)); return; }
    if (selected.length >= MAX_DRIVE_FILES) { toast(`Maksimal ${MAX_DRIVE_FILES} file sekaligus`, 'error'); return; }
    setSelected((list) => [...list, file]);
  };
  const openFolder = (file) => { setQuery(''); setSearch(''); setPath((p) => [...p, { id: file.id, name: file.name }]); };

  const confirm = () => {
    if (!selected.length) return;
    rememberDriveMeta(selected);
    onPick(selected);
  };

  const crumbs = tab === 'drive' ? [{ id: null, name: 'Shared Drive' }, ...path] : [{ id: null, name: TABS.find((t) => t.key === tab).label }, ...path];

  let body;
  if (loading) body = <LoadingState label="Memuat Google Drive…" />;
  else if (error) body = <EmptyState tone="error" title="Google Drive belum dapat dibuka" description={error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />;
  else if (listingDrives) {
    body = drives?.length ? (
      <div className="pw-gchat__drive-list" role="listbox" aria-label="Shared Drive">
        {drives.map((drive) => (
          <div
            key={drive.id}
            role="option"
            aria-selected={false}
            tabIndex={0}
            className="pw-gchat__drive-row pw-state-layer pw-ripple"
            onClick={() => setPath([{ id: drive.id, name: drive.name }])}
            onKeyDown={activate(() => setPath([{ id: drive.id, name: drive.name }]))}
          >
            <Icon name="hard_drive" size="md" className="pw-gchat__file-icon" />
            <span className="pw-gchat__drive-text"><span data-no-translate="" className="pw-gchat__drive-name">{drive.name}</span></span>
            <Icon name="chevron_right" size="md" className="pw-gchat__drive-chevron" />
          </div>
        ))}
      </div>
    ) : <EmptyState icon="hard_drive" title="Tidak ada Shared Drive" description="Anda belum menjadi anggota Shared Drive mana pun." />;
  } else if (!items.length) {
    body = <EmptyState icon={search ? 'search_off' : 'folder_open'} title={search ? 'Tidak ditemukan' : 'Folder ini kosong'} description={search ? 'Coba kata kunci lain.' : 'Tidak ada file di sini.'} />;
  } else {
    body = (
      <div className="pw-gchat__drive-list" role="listbox" aria-multiselectable="true" aria-label="File Google Drive">
        {items.map((file) => {
          const chosen = isSelected(file);
          const act = () => (file.isFolder ? openFolder(file) : toggle(file));
          return (
            <div
              key={file.id}
              role="option"
              aria-selected={file.isFolder ? false : chosen}
              tabIndex={0}
              className={`pw-gchat__drive-row pw-state-layer pw-ripple${chosen ? ' is-selected' : ''}`}
              onClick={act}
              onKeyDown={activate(act)}
            >
              {chosen ? <Icon name="check" size="md" className="pw-gchat__drive-check" /> : <FileIcon mimeType={file.mimeType} size="md" />}
              <span className="pw-gchat__drive-text">
                <span data-no-translate="" className="pw-gchat__drive-name">{file.name}</span>
                <span className="pw-gchat__muted">
                  <Mixed parts={[kindLabel(file.mimeType), file.ownerName ? `Pemilik: ${file.ownerName}` : null, formatLastActive(file.modifiedTime), file.size ? formatBytes(file.size) : null]} />
                </span>
              </span>
              {file.isFolder ? <Icon name="chevron_right" size="md" className="pw-gchat__drive-chevron" /> : null}
            </div>
          );
        })}
        {nextPageToken ? (
          <div className="pw-gchat__older"><Button variant="text" loading={loadingMore} onClick={loadMore}>Muat file lainnya</Button></div>
        ) : null}
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sisipkan dari Google Drive"
      size="md"
      footer={(
        <>
          <span className="pw-gchat__muted pw-gchat__drive-count">{selected.length ? `${selected.length} file dipilih` : 'Pilih file untuk dilampirkan'}</span>
          <Button variant="text" onClick={onClose}>Batal</Button>
          <Button onClick={confirm} disabled={!selected.length}>Lampirkan file</Button>
        </>
      )}
    >
      <div className="pw-gchat__drive-picker">
        <TabBar
          tabs={TABS.map(({ key, label }) => ({ k: key, l: label }))}
          value={tab}
          onChange={switchTab}
          label="Sumber Google Drive"
          idPrefix="pw-gchat-drive-tab"
          panelId="pw-gchat-drive-panel"
        />
        <SearchField
          variant="panel"
          label="Cari di Google Drive"
          placeholder="Cari file di semua Drive Anda"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!search ? (
          <nav className="pw-gchat__crumbs" aria-label="Lokasi folder">
            {/* The first crumb is the tab's own label (interface text); the rest are Drive and folder names. */}
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <span key={`${crumb.id}-${index}`} className="pw-gchat__crumb">
                  {index ? <Icon name="chevron_right" size="sm" /> : null}
                  {last ? <span data-no-translate={index ? '' : undefined} aria-current="location">{crumb.name}</span> : (
                    <Button variant="text" onClick={() => setPath((p) => p.slice(0, index))}><span data-no-translate={index ? '' : undefined}>{crumb.name}</span></Button>
                  )}
                </span>
              );
            })}
          </nav>
        ) : <p className="pw-gchat__muted">Hasil pencarian untuk “<span data-no-translate="">{search}</span>” di semua Drive Anda</p>}
        <div className="pw-gchat__drive-body" id="pw-gchat-drive-panel" role="tabpanel" aria-labelledby={`pw-gchat-drive-tab-${tab}`}>{body}</div>
      </div>
    </Modal>
  );
}
