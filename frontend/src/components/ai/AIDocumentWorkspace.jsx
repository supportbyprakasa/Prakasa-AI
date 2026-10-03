import { useEffect, useId, useRef, useState } from 'react';
import api from '../../api/client';
import Button from '../Button';
import EmptyState, { LoadingState } from '../EmptyState';
import Icon from '../Icon';
import IconButton from '../IconButton';
import KeyValue from '../KeyValue';
import Menu from '../Menu';
import Spinner from '../Spinner';
import StatusBadge from '../StatusBadge';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { getGooglePreviewUrl } from '../../pages/ai/aiCommandCenterModel';
import { artifactMessage, conversionMenuItems, isNativeFormat } from './aiConversionModel';
import './ai-components.css';
import { dateLocale } from '../../i18n/language.js';

export default function AIDocumentWorkspace({ sessionId, refreshKey, onAttachContext, onConverted }) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [documentDetail, setDocumentDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  // "Konversi ke…" (Wave 1): the formats the server allows for the selected
  // document; the result is a new document of this conversation.
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const convertRef = useRef(null);
  const convertMenuId = useId();
  const canConvert = (user?.permissions || []).includes('document.create');

  useEffect(() => {
    if (!sessionId) {
      setDocuments([]);
      setSelectedId(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    api.get(`/ai-command/sessions/${sessionId}/contexts`)
      .then((response) => {
        if (cancelled) return;
        const nextDocuments = (response.data.data || [])
          .filter((context) => context.contextType === 'document');
        setDocuments(nextDocuments);
        setSelectedId((current) => (
          nextDocuments.some((document) => document.id === current)
            ? current
            : nextDocuments[0]?.id || null
        ));
      })
      .catch((error) => {
        if (!cancelled) {
          setDocuments([]);
          toast(error.response?.data?.error?.message || 'Gagal memuat dokumen sesi', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId, refreshKey, localRefresh]);

  const selectedDocument = documents.find((document) => document.id === selectedId);

  useEffect(() => {
    if (!selectedDocument?.contextId) {
      setDocumentDetail(null);
      setDetailUnavailable(false);
      return undefined;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailUnavailable(false);
    api.get(`/ai-command/sessions/${sessionId}/artifacts/${selectedDocument.contextId}`)
      .then((response) => {
        if (!cancelled) setDocumentDetail(response.data.data || null);
      })
      .catch(() => {
        if (!cancelled) {
          setDocumentDetail(null);
          setDetailUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedDocument?.contextId, sessionId]);

  const previewUrl = documentDetail?.compressionMethod === 'gzip'
    ? null
    : getGooglePreviewUrl(documentDetail?.webViewLink);

  const downloadDocument = async () => {
    if (!selectedDocument || !sessionId) return;
    setDownloadingId(selectedDocument.id);
    try {
      const response = await api.get(
        `/ai-command/sessions/${sessionId}/artifacts/${selectedDocument.contextId}/download`,
        { responseType: 'blob' },
      );
      const header = response.headers?.['content-disposition'] || '';
      const encodedName = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName
        ? decodeURIComponent(encodedName)
        : selectedDocument.title || `document-${selectedDocument.contextId}`;
      downloadBlob(response.data, fileName);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengunduh dokumen', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const convertDocument = async (format) => {
    if (!selectedDocument || !sessionId || converting) return;
    setConverting(true);
    try {
      const response = await api.post(
        `/ai-command/sessions/${sessionId}/artifacts/${selectedDocument.contextId}/convert`,
        { format },
      );
      const artifact = response.data.data;
      if (!isNativeFormat(format) || !artifact.native) {
        const download = await api.get(artifact.downloadUrl, { responseType: 'blob' });
        downloadBlob(download.data, artifact.originalName || `${selectedDocument.title || 'dokumen'}.${format}`);
      }
      toast(artifactMessage(artifact.native ? format : (isNativeFormat(format) ? 'docx' : format), { converted: true }), 'success');
      setLocalRefresh((current) => current + 1);
      setSelectedId(null);
      onConverted?.(artifact);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal mengonversi dokumen', 'error');
    } finally {
      setConverting(false);
    }
  };
  const conversionItems = conversionMenuItems(documentDetail?.conversions);

  if (!sessionId) {
    return (
      <div className="ai-document-state">
        <EmptyState
          icon="folder_open"
          title="Workspace dokumen"
          description="Pilih percakapan untuk melihat dokumen yang menjadi konteks AI."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ai-document-state">
        <LoadingState label="Memuat dokumen…" />
      </div>
    );
  }

  if (!documents.length) {
    return (
      <div className="ai-document-state">
        <EmptyState
          icon="description"
          title="Belum ada dokumen"
          description="Lampirkan dokumen sebagai konteks agar AI dapat menggunakannya dalam percakapan ini."
          action={(
            <Button variant="secondary" icon="link" onClick={onAttachContext}>
              Lampirkan dokumen
            </Button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="ai-document-workspace">
      <div className="ai-document-list" role="listbox" aria-label="Dokumen terhubung">
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            role="option"
            aria-selected={document.id === selectedId}
            className={`ai-document-list-item pw-state-layer${document.id === selectedId ? ' is-active' : ''}`}
            onClick={() => setSelectedId(document.id)}
          >
            <span className="ai-document-icon"><Icon name="description" /></span>
            <span className="ai-document-text">
              <span className="ai-document-name" data-no-translate={document.title ? '' : undefined}>{document.title || `Dokumen #${document.contextId}`}</span>
              <span className="ai-document-meta">Dokumen #{document.contextId}</span>
            </span>
          </button>
        ))}
      </div>

      {selectedDocument && (
        <div className="ai-document-preview">
          <div className="ai-document-preview-toolbar">
            <div>
              <span className="ai-overline">Dokumen terhubung</span>
              <h2 data-no-translate={selectedDocument.title ? '' : undefined}>{selectedDocument.title || `Dokumen #${selectedDocument.contextId}`}</h2>
              {documentDetail?.extractionStatus && (
                <StatusBadge
                  status={EXTRACTION_TONE_KEY[documentDetail.extractionStatus] || 'processing'}
                  label={getExtractionLabel(documentDetail.extractionStatus)}
                />
              )}
            </div>
            <div className="ai-document-preview-actions">
              <IconButton
                label="Unduh dokumen"
                icon={downloadingId === selectedDocument.id ? <Spinner label={null} /> : 'download'}
                onClick={downloadDocument}
                disabled={downloadingId === selectedDocument.id}
              />
              {canConvert && conversionItems.length > 0 && (
                <>
                  <IconButton
                    ref={convertRef}
                    label="Konversi ke…"
                    icon={converting ? <Spinner label={null} /> : 'swap_horiz'}
                    aria-haspopup="menu"
                    aria-expanded={convertOpen}
                    aria-controls={convertOpen ? convertMenuId : undefined}
                    disabled={converting || detailLoading}
                    onClick={() => setConvertOpen((current) => !current)}
                  />
                  <Menu
                    id={convertMenuId}
                    open={convertOpen}
                    anchorRef={convertRef}
                    onClose={() => setConvertOpen(false)}
                    label="Konversi dokumen ke"
                    align="end"
                    items={conversionItems.map((item) => ({
                      key: item.value,
                      label: item.label,
                      description: item.description,
                      onClick: () => { setConvertOpen(false); convertDocument(item.value); },
                    }))}
                  />
                </>
              )}
              {documentDetail?.webViewLink && (
                // A link, not an action: keeps open-in-new-tab semantics.
                <IconButton
                  href={documentDetail.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  label="Buka di Google Workspace"
                  aria-label="Buka dokumen di Google Workspace"
                  icon="open_in_new"
                />
              )}
            </div>
          </div>

          {detailLoading && (
            <LoadingState compact label="Menyiapkan preview…" />
          )}

          {!detailLoading && previewUrl && (
            <iframe
              className="ai-document-frame"
              src={previewUrl}
              title={`Preview ${selectedDocument.title || `dokumen ${selectedDocument.contextId}`}`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}

          {!detailLoading && !previewUrl && (
            <div className="ai-document-fallback pw-stack">
              <EmptyState
                compact
                tone={detailUnavailable ? 'error' : 'default'}
                icon={detailUnavailable ? 'error' : 'description'}
                description={detailUnavailable
                  ? 'Detail dokumen tidak dapat dibuka dengan akses Anda saat ini.'
                  : 'Preview langsung belum tersedia untuk format dokumen ini.'}
              />
              <KeyValue
                items={[
                  { label: 'ID dokumen', value: selectedDocument.contextId },
                  { label: 'Relasi', value: selectedDocument.relation || 'reference' },
                  { label: 'Ditambahkan', value: formatDate(selectedDocument.createdAt) },
                ]}
              />
              <div>
                <Button variant="text" onClick={onAttachContext}>Kelola konteks</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// Extraction states mapped to their statusTone() equivalent (§3.4).
const EXTRACTION_TONE_KEY = {
  ready: 'completed',
  no_text: 'needs_review',
  unsupported: 'needs_review',
  failed: 'failed',
};

function getExtractionLabel(status) {
  if (status === 'ready') return 'Siap dibaca AI';
  if (status === 'no_text') return 'Tidak ada teks · OCR diperlukan untuk scan/gambar';
  if (status === 'unsupported') return 'Tersimpan · format belum dapat dibaca AI';
  if (status === 'failed') return 'Tersimpan · pembacaan teks gagal';
  return 'Pembacaan dokumen diproses';
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
