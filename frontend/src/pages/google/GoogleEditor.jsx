import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import api from '../../api/client';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import Banner from '../../components/Banner';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import GoogleKindIcon from './GoogleKindIcon';
import {
  LOAD_TIMEOUT_MS, apiErrorMessage, editorFrameUrl, editorRoute, frameHint,
  isValidFileId, kindConfig, openInGoogleUrl,
} from './googleFilesModel';
import './google-files.css';

// The Google editor itself, framed inside Prakasa Workspace. The frame works
// when this browser is signed in to the same Google account and allows
// Google's cookies inside a frame; otherwise we offer a new tab instead.
function EditorFrame({ kind, file }) {
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const src = editorFrameUrl(kind, file.id);
  const googleUrl = openInGoogleUrl(kind, file.id, file.webViewLink);

  useEffect(() => {
    setLoaded(false);
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [src]);

  const hint = frameHint({ loaded, timedOut });
  return (
    <>
      {hint === 'not-loaded' ? (
        <Banner
          tone="warning"
          title="Editor belum tampil?"
          action={googleUrl ? <Button variant="text" icon="open_in_new" href={googleUrl} target="_blank" rel="noopener noreferrer">Buka di tab baru</Button> : null}
        >
          Masuk ke akun Google di browser ini untuk mengedit di sini. Jika browser memblokir cookie pihak ketiga, buka file di tab baru.
        </Banner>
      ) : null}
      <div className="gdocs-editor__frame">
        {hint === 'loading' ? <div className="gdocs-editor__loading"><LoadingState label={`Membuka ${kindConfig(kind).noun}…`} /></div> : null}
        {src ? (
          <iframe
            key={src}
            title={`Editor ${file.name || kindConfig(kind).noun}`}
            src={src}
            onLoad={() => setLoaded(true)}
            allow="clipboard-read; clipboard-write; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : null}
      </div>
    </>
  );
}

// /docs/:fileId, /sheets/:fileId, /slides/:fileId. PageTrail (Docs › Detail)
// leads to the list's home; opened from a list, "Kembali ke daftar" returns to
// that list with its tab and search (location.state.from).
export default function GoogleEditor({ kind }) {
  const { fileId } = useParams();
  const location = useLocation();
  const from = location.state?.from;
  const config = kindConfig(kind);
  const validId = isValidFileId(fileId);
  const [state, setState] = useState({ file: null, loading: validId, error: null });

  const load = useCallback(() => {
    if (!validId) return undefined;
    let alive = true;
    setState({ file: null, loading: true, error: null });
    api.get(`/google-docs/files/${encodeURIComponent(fileId)}`)
      .then((response) => { if (alive) setState({ file: response.data.data, loading: false, error: null }); })
      .catch((error) => { if (alive) setState({ file: null, loading: false, error: apiErrorMessage(error, `Gagal membuka ${config.noun}.`) }); });
    return () => { alive = false; };
  }, [fileId, validId, config.noun]);

  useEffect(() => load(), [load]);

  const { file } = state;
  // A sheet opened under /docs/… (old link, typo) moves to its proper route.
  if (file?.kind && file.kind !== kind) {
    const route = editorRoute(file.kind, file.id);
    if (route) return <Navigate to={route} replace state={location.state} />;
  }

  const googleUrl = validId ? openInGoogleUrl(kind, fileId, file?.webViewLink) : null;
  const backTo = typeof from === 'string' && from.startsWith(config.route) && !from.startsWith('//') ? from : null;
  return (
    <Page className="gdocs-editor">
      <PageHeader
        eyebrow={config.recordLabel}
        title={(
          <span className="gdocs-editor__title">
            <GoogleKindIcon kind={kind} size="lg" />
            <span className="gdocs-editor__name" data-no-translate={file?.name ? '' : undefined}>{file?.name || config.title}</span>
          </span>
        )}
        description={file?.officeType ? `File ${file.officeType}, disimpan dalam format aslinya` : undefined}
        actions={backTo || googleUrl ? (
          <>
            {backTo ? <Button variant="text" icon="arrow_back" to={backTo}>Kembali ke daftar</Button> : null}
            {googleUrl ? (
              <Button variant="secondary" icon="open_in_new" href={googleUrl} target="_blank" rel="noopener noreferrer">Buka di tab baru</Button>
            ) : null}
          </>
        ) : null}
      />

      {!validId ? (
        <EmptyState
          tone="error"
          title="Tautan file tidak valid"
          description={`Periksa kembali tautannya, atau pilih ${config.noun} dari daftar.`}
          action={<Button variant="text" to={config.route}>{config.listLink}</Button>}
        />
      ) : null}
      {validId && state.loading ? <LoadingState label={`Membuka ${config.noun}…`} /> : null}
      {validId && state.error ? (
        <EmptyState
          tone="error"
          title={`Gagal membuka ${config.noun}`}
          description={state.error}
          action={<Button variant="text" type="button" onClick={load}>Coba lagi</Button>}
        />
      ) : null}
      {file ? <EditorFrame kind={file.kind || kind} file={file} /> : null}
    </Page>
  );
}
