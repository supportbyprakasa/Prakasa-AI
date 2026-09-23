import { useEffect, useState } from 'react';
import { AlertCircle, Download, ExternalLink, FileText, FolderOpen, Link2, Loader2 } from 'lucide-react';
import api from '../../api/client';
import { toast } from '../Toast';
import { getGooglePreviewUrl } from '../../pages/ai/aiCommandCenterModel';

export default function AIDocumentWorkspace({ sessionId, refreshKey, onAttachContext }) {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [documentDetail, setDocumentDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

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
  }, [sessionId, refreshKey]);

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

  if (!sessionId) {
    return (
      <div className="ai-document-empty">
        <FolderOpen size={32} strokeWidth={1.6} />
        <strong>Workspace dokumen</strong>
        <span>Pilih percakapan untuk melihat dokumen yang menjadi konteks AI.</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ai-document-loading" role="status">
        <Loader2 className="ai-spin" size={18} />
        Memuat dokumen…
      </div>
    );
  }

  if (!documents.length) {
    return (
      <div className="ai-document-empty">
        <FileText size={32} strokeWidth={1.6} />
        <strong>Belum ada dokumen</strong>
        <span>Lampirkan dokumen sebagai konteks agar AI dapat menggunakannya dalam percakapan ini.</span>
        <button type="button" className="ai-tonal-button ai-ripple" onClick={onAttachContext}>
          <Link2 size={16} /> Lampirkan dokumen
        </button>
      </div>
    );
  }

  return (
    <div className="ai-document-workspace">
      <div className="ai-document-list" aria-label="Dokumen terhubung">
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            className={`ai-document-list-item ai-ripple${document.id === selectedId ? ' is-active' : ''}`}
            onClick={() => setSelectedId(document.id)}
          >
            <span className="ai-document-icon"><FileText size={17} /></span>
            <span>
              <strong>{document.title || `Dokumen #${document.contextId}`}</strong>
              <small>Dokumen #{document.contextId}</small>
            </span>
          </button>
        ))}
      </div>

      {selectedDocument && (
        <div className="ai-document-preview">
          <div className="ai-document-preview-toolbar">
            <div>
              <span className="ai-eyebrow">Dokumen terhubung</span>
              <h2>{selectedDocument.title || `Dokumen #${selectedDocument.contextId}`}</h2>
              {documentDetail?.extractionStatus && (
                <span className={`ai-document-read-status is-${documentDetail.extractionStatus}`}>
                  {getExtractionLabel(documentDetail.extractionStatus)}
                </span>
              )}
            </div>
            <div className="ai-document-preview-actions">
              <button
                type="button"
                className="ai-icon-button ai-ripple"
                onClick={downloadDocument}
                disabled={downloadingId === selectedDocument.id}
                aria-label="Unduh dokumen"
                title="Unduh dokumen"
              >
                {downloadingId === selectedDocument.id
                  ? <Loader2 className="ai-spin" size={17} />
                  : <Download size={17} />}
              </button>
              {documentDetail?.webViewLink && (
                <a
                  className="ai-icon-button ai-ripple"
                  href={documentDetail.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Buka dokumen di Google Workspace"
                  title="Buka di Google Workspace"
                >
                  <ExternalLink size={17} />
                </a>
              )}
            </div>
          </div>

          {detailLoading && (
            <div className="ai-document-inline-status" role="status">
              <Loader2 className="ai-spin" size={17} /> Menyiapkan preview…
            </div>
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
            <div className="ai-document-fallback">
              <div className="ai-document-preview-icon">
                {detailUnavailable ? <AlertCircle size={27} /> : <FileText size={28} />}
              </div>
              <p>
                {detailUnavailable
                  ? 'Detail dokumen tidak dapat dibuka dengan akses Anda saat ini.'
                  : 'Preview langsung belum tersedia untuk format dokumen ini.'}
              </p>
              <dl className="ai-document-metadata">
                <div><dt>ID dokumen</dt><dd>{selectedDocument.contextId}</dd></div>
                <div><dt>Relasi</dt><dd>{selectedDocument.relation || 'reference'}</dd></div>
                <div><dt>Ditambahkan</dt><dd>{formatDate(selectedDocument.createdAt)}</dd></div>
              </dl>
              <button type="button" className="ai-text-button ai-ripple" onClick={onAttachContext}>
                Kelola konteks
              </button>
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
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
