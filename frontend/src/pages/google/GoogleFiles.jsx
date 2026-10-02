import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Page from '../../components/Page';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import Input from '../../components/Input';
import Badge from '../../components/Badge';
import Banner from '../../components/Banner';
import Modal from '../../components/Modal';
import FormActions from '../../components/FormActions';
import ConfirmDialog from '../../components/ConfirmDialog';
import ActionMenu from '../../components/ActionMenu';
import SearchField from '../../components/SearchField';
import Segmented from '../../components/Segmented';
import EmptyState from '../../components/EmptyState';
import DataGrid from '../../components/datagrid/DataGrid';
import { Mixed, Translate, data as recordData } from '../../i18n/NoTranslate';
import { toast } from '../../components/Toast';
import GoogleKindIcon from './GoogleKindIcon';
import { cachedThumbnail, loadThumbnail } from './googleThumbnails';
import {
  SCOPES, SEARCH_MAX_LENGTH, VIEWS, VIEW_STORAGE_KEY, apiErrorMessage, editorRoute, emptyCopy, fileDateCell,
  fileDateColumn, fileDateLabel, isScope, isView, kindConfig, mergeFiles, normalizeSearch, openInGoogleUrl, ownerLabel,
} from './googleFilesModel';
import './google-files.css';

const SKELETON_CARDS = 8;
const LIST_PAGE_SIZE = 50;

function readView() {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return isView(value) ? value : 'grid';
  } catch {
    return 'grid';
  }
}

// Thumbnail fetched lazily through the backend proxy once the card scrolls
// into view; falls back to the Google file-type icon.
function FileThumb({ file }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(() => (file.hasThumbnail ? cachedThumbnail(file) : null));

  useEffect(() => {
    if (!file.hasThumbnail || url !== undefined) return undefined;
    let alive = true;
    const node = ref.current;
    const start = () => loadThumbnail(file).then((value) => { if (alive) setUrl(value); });
    if (!node || typeof IntersectionObserver === 'undefined') { start(); return () => { alive = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => { alive = false; observer.disconnect(); };
  }, [file, url]);

  const bigIcon = file.iconLink ? file.iconLink.replace(/\/16\/type\//, '/64/type/') : null;
  return (
    <span ref={ref} className={`gdocs-card__thumb gdocs-card__thumb--${file.kind || 'document'}`}>
      {url
        ? <img src={url} alt="" loading="lazy" className="gdocs-card__image" />
        : bigIcon
          ? <img src={bigIcon} alt="" loading="lazy" className="gdocs-card__placeholder" />
          : <GoogleKindIcon kind={file.kind} size="xl" />}
    </span>
  );
}

// Google's own 16px file icon when Drive sends one, else the kind glyph.
function FileIcon({ file, kind }) {
  return file.iconLink
    ? <img src={file.iconLink} alt="" className="gdocs-file-icon" />
    : <GoogleKindIcon kind={file.kind || kind} size="sm" />;
}

function FileCard({ file, kind, scope, from, actions }) {
  const owner = ownerLabel(file);
  // "Saya" / "Drive bersama" are interface words; another owner's name is record data.
  const ownerPart = file.ownedByMe || file.inSharedDrive ? owner : recordData(owner);
  return (
    <li className="gdocs-card">
      <FileThumb file={file} />
      <div className="gdocs-card__body">
        {/* The link's ::after covers the whole card, so a click anywhere opens the editor. */}
        <Link to={editorRoute(file.kind || kind, file.id)} state={{ from }} className="gdocs-card__link">
          <span data-no-translate="" className="gdocs-card__name">{file.name}</span>
        </Link>
        <div className="gdocs-card__meta">
          <FileIcon file={file} kind={kind} />
          <span className="gdocs-card__meta-text">
            {owner || file.officeType ? <span><Mixed parts={[ownerPart, file.officeType]} /></span> : null}
            <span>{fileDateLabel(file, scope)}</span>
          </span>
          <span className="gdocs-card__menu">
            <ActionMenu size="sm" label={`Aksi untuk ${file.name}`} items={actions(file)} />
          </span>
        </div>
      </div>
    </li>
  );
}

function SkeletonGrid() {
  return (
    <ul className="gdocs-grid" role="status" aria-label="Memuat">
      {Array.from({ length: SKELETON_CARDS }).map((_, index) => (
        <li key={index} className="gdocs-card gdocs-card--skeleton" aria-hidden="true">
          <span className="gdocs-card__thumb pw-skel-line" />
          <div className="gdocs-card__body">
            <span className="pw-skel-line gdocs-skel-line" />
            <span className="pw-skel-line gdocs-skel-line gdocs-skel-line--short" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function GoogleFiles({ kind }) {
  const config = kindConfig(kind);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // The list the editor goes back to: this tab and search.
  const from = `${location.pathname}${location.search}`;
  const scope = isScope(params.get('tab')) ? params.get('tab') : 'recent';
  const search = normalizeSearch(params.get('q'));

  const [searchText, setSearchText] = useState(search);
  const [view, setView] = useState(readView);
  const [state, setState] = useState({ files: [], nextPageToken: null, incomplete: false, loading: true, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [trashTarget, setTrashTarget] = useState(null);
  const [trashing, setTrashing] = useState(false);
  const requestRef = useRef(0);

  const updateParams = useCallback((next) => {
    const merged = new URLSearchParams(params);
    Object.entries(next).forEach(([key, value]) => {
      if (value && !(key === 'tab' && value === 'recent')) merged.set(key, value); else merged.delete(key);
    });
    setParams(merged, { replace: true });
  }, [params, setParams]);

  // Keep the box in sync when ?q= changes from outside (browser back/forward).
  useEffect(() => {
    setSearchText((current) => (normalizeSearch(current) === search ? current : search));
  }, [search]);

  // Debounce typing into the ?q= param (which drives the request).
  useEffect(() => {
    const next = normalizeSearch(searchText);
    if (next === search) return undefined;
    const timer = setTimeout(() => updateParams({ q: next }), 350);
    return () => clearTimeout(timer);
  }, [searchText, search, updateParams]);

  const changeView = (next) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* storage disabled */ }
  };

  const fetchPage = useCallback((pageToken) => api.get('/google-docs/files', {
    params: { kind, scope, ...(search ? { q: search } : {}), ...(pageToken ? { pageToken } : {}) },
  }).then((response) => response.data.data), [kind, scope, search]);

  const load = useCallback(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    setState((current) => ({ ...current, loading: true, error: null }));
    fetchPage(null)
      .then((data) => {
        if (requestRef.current !== id) return;
        setState({ files: data.files || [], nextPageToken: data.nextPageToken || null, incomplete: Boolean(data.incompleteSearch), loading: false, error: null });
      })
      .catch((error) => {
        if (requestRef.current !== id) return;
        setState({ files: [], nextPageToken: null, incomplete: false, loading: false, error: apiErrorMessage(error, `Gagal memuat ${config.noun}.`) });
      });
  }, [fetchPage, config.noun]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    const id = requestRef.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(state.nextPageToken);
      if (requestRef.current !== id) return;
      setState((current) => ({ ...current, files: mergeFiles(current.files, data.files), nextPageToken: data.nextPageToken || null }));
    } catch (error) {
      toast(apiErrorMessage(error, 'Gagal memuat halaman berikutnya.'), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const onCreate = async () => {
    setCreating(true);
    try {
      const response = await api.post('/google-docs/files', { kind });
      const route = editorRoute(kind, response.data.data?.id);
      if (!route) throw new Error('invalid id');
      navigate(route, { state: { from } });
    } catch (error) {
      toast(apiErrorMessage(error, `Gagal membuat ${config.noun} baru.`), 'error');
      setCreating(false);
    }
  };

  const openRename = (file) => { setRenameError(''); setRenameTarget(file); };

  const onRenameSubmit = async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') || '').trim();
    if (!renameTarget) return;
    if (!name) { setRenameError('Isi nama file'); return; }
    setRenaming(true);
    try {
      const response = await api.patch(`/google-docs/files/${encodeURIComponent(renameTarget.id)}`, { name });
      const updated = response.data.data;
      setState((current) => ({ ...current, files: current.files.map((file) => (file.id === updated.id ? { ...file, ...updated } : file)) }));
      toast('Nama file diganti', 'success');
      setRenameTarget(null);
    } catch (error) {
      const invalid = error?.response?.data?.error?.code === 'VALIDATION_ERROR';
      if (invalid) setRenameError(apiErrorMessage(error, 'Nama file tidak valid.'));
      else toast(apiErrorMessage(error, 'Gagal mengganti nama file.'), 'error');
    } finally {
      setRenaming(false);
    }
  };

  const onTrashConfirm = async () => {
    if (!trashTarget) return;
    setTrashing(true);
    try {
      await api.delete(`/google-docs/files/${encodeURIComponent(trashTarget.id)}`);
      setState((current) => ({ ...current, files: current.files.filter((file) => file.id !== trashTarget.id) }));
      toast('File dipindahkan ke sampah', 'success');
      setTrashTarget(null);
    } catch (error) {
      toast(apiErrorMessage(error, 'Gagal memindahkan file ke sampah.'), 'error');
    } finally {
      setTrashing(false);
    }
  };

  // The same ⋮ menu on a card and on a list row.
  const fileActions = (file) => {
    const googleUrl = openInGoogleUrl(file.kind || kind, file.id, file.webViewLink);
    return [
      googleUrl && { label: 'Buka di tab baru', icon: 'open_in_new', onClick: () => window.open(googleUrl, '_blank', 'noopener,noreferrer') },
      file.canRename && { label: 'Ganti nama', icon: 'edit', onClick: () => openRename(file) },
      file.canTrash && (googleUrl || file.canRename) && { divider: true, key: 'divider' },
      file.canTrash && { label: 'Hapus ke sampah', icon: 'delete', tone: 'danger', onClick: () => setTrashTarget(file) },
    ];
  };

  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Nama',
      sortable: false,
      render: (file) => (
        <span className="gdocs-row__name">
          <FileIcon file={file} kind={kind} />
          <Link data-no-translate="" to={editorRoute(file.kind || kind, file.id)} state={{ from }} className="gdocs-row__link">{file.name}</Link>
          {file.officeType ? <Badge translate>{file.officeType}</Badge> : null}
        </span>
      ),
    },
    { key: 'owner', header: 'Pemilik', sortable: false, render: (file) => (file.ownedByMe || file.inSharedDrive ? <Translate>{ownerLabel(file)}</Translate> : (file.ownerName || '')) },
    { key: 'date', header: fileDateColumn(scope), sortable: false, nowrap: true, translate: true, render: (file) => fileDateCell(file, scope) },
  ], [kind, scope, from]);

  const empty = emptyCopy(kind, scope, search);
  const clearSearch = () => { setSearchText(''); updateParams({ q: '' }); };

  let content;
  if (state.error && !state.loading) {
    content = (
      <EmptyState
        tone="error"
        title={`Gagal memuat ${config.noun}`}
        description={state.error}
        action={<Button variant="text" type="button" onClick={load}>Coba lagi</Button>}
      />
    );
  } else if (!state.loading && state.files.length === 0) {
    content = (
      <EmptyState
        icon={search ? 'search_off' : 'draft'}
        title={empty.title}
        description={empty.description}
        action={search ? <Button variant="text" type="button" onClick={clearSearch}>Hapus pencarian</Button> : null}
      />
    );
  } else if (view === 'list') {
    content = (
      <DataGrid
        title={`Daftar ${config.noun}`}
        showTitle={false}
        columns={columns}
        rows={state.files}
        loading={state.loading}
        searchable={false}
        exportable={false}
        pageSize={LIST_PAGE_SIZE}
        onRowClick={(file) => { const route = editorRoute(file.kind || kind, file.id); if (route) navigate(route, { state: { from } }); }}
        rowActions={(file) => <ActionMenu size="sm" label={`Aksi untuk ${file.name}`} items={fileActions(file)} />}
      />
    );
  } else if (state.loading) {
    content = <SkeletonGrid />;
  } else {
    content = (
      <ul className="gdocs-grid" aria-label={`Daftar ${config.noun}`}>
        {state.files.map((file) => (
          <FileCard key={file.id} file={file} kind={kind} scope={scope} from={from} actions={fileActions} />
        ))}
      </ul>
    );
  }

  return (
    <Page
      className="gdocs"
      title={config.title}
      description={config.description}
      actions={<Button type="button" icon="add" onClick={onCreate} loading={creating}>{config.createLabel}</Button>}
    >
      <div className="gdocs-toolbar">
        <div className="gdocs-toolbar__chips" role="group" aria-label="Tampilkan">
          {SCOPES.map((item) => (
            <Chip key={item.id} selected={scope === item.id} onClick={() => updateParams({ tab: item.id })}>{item.label}</Chip>
          ))}
        </div>
        <div className="gdocs-toolbar__end">
          <SearchField
            className="gdocs-toolbar__search"
            label={`Cari ${config.noun}`}
            placeholder={`Cari ${config.noun}`}
            value={searchText}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => setSearchText(event.target.value)}
            onSearch={(value) => updateParams({ q: normalizeSearch(value) })}
          />
          <Segmented className="gdocs-toolbar__view" label="Tata letak" options={VIEWS} value={view} onChange={changeView} />
        </div>
      </div>

      {state.incomplete && !state.loading ? (
        <Banner tone="info" title="Sebagian hasil mungkin belum tampil">
          Google Drive tidak mencari di semua drive sekaligus. Persempit pencarian untuk hasil lengkap.
        </Banner>
      ) : null}

      {content}

      {!state.loading && !state.error && state.files.length > 0 && state.nextPageToken ? (
        <div className="gdocs-more">
          <Button variant="secondary" type="button" onClick={loadMore} loading={loadingMore}>Muat lebih banyak</Button>
        </div>
      ) : null}

      <Modal open={!!renameTarget} onClose={() => { if (!renaming) setRenameTarget(null); }} title="Ganti nama" size="sm">
        {renameTarget ? (
          <form onSubmit={onRenameSubmit} className="pw-stack" noValidate>
            <Input
              label="Nama file"
              name="name"
              required
              autoFocus
              maxLength={200}
              defaultValue={renameTarget.name}
              error={renameError}
              onChange={() => { if (renameError) setRenameError(''); }}
              onFocus={(event) => event.target.select()}
            />
            <FormActions>
              <Button variant="text" type="button" onClick={() => setRenameTarget(null)} disabled={renaming}>Batal</Button>
              <Button type="submit" loading={renaming}>Simpan</Button>
            </FormActions>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!trashTarget}
        tone="danger"
        title="Hapus ke sampah?"
        message={`"${trashTarget?.name || ''}" akan dipindahkan ke sampah Google Drive. Anda masih bisa memulihkannya dari sampah Drive.`}
        confirmLabel="Hapus ke sampah"
        loading={trashing}
        onConfirm={onTrashConfirm}
        onClose={() => setTrashTarget(null)}
      />
    </Page>
  );
}
