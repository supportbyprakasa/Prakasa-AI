import { useRef, useState } from 'react';
import Banner from '../Banner';
import Button from '../Button';
import Icon from '../Icon';
import Modal from '../Modal';
import { toast } from '../Toast';
import { downloadTemplate, readMatrixFromFile } from './gridFile';
import {
  apiErrorMessage, displayValue, isEditableColumn, payloadFromValues, rowsFromImportMatrix,
} from './gridModel';

const PREVIEW_LIMIT = 200;
export const MAX_IMPORT_ROWS = 1000;

function mergeServerErrors(rows, serverErrors = []) {
  const byRow = new Map();
  for (const item of serverErrors) {
    const current = byRow.get(item.rowNumber) || {};
    current[item.field || '_row'] = item.message;
    byRow.set(item.rowNumber, current);
  }
  return rows.map((row) => (byRow.has(row.rowNumber)
    ? { ...row, errors: { ...row.errors, ...byRow.get(row.rowNumber) } }
    : row));
}

export default function GridImportDialog({ open, columns, baseName, title, onClose, onImport, onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fatal, setFatal] = useState('');

  const importColumns = columns.filter((column) => isEditableColumn(column) && column.import !== false);

  const reset = () => { setFileName(''); setParsed(null); setFatal(''); if (inputRef.current) inputRef.current.value = ''; };
  const close = () => { if (submitting) return; reset(); onClose(); };

  const readFile = async (file) => {
    if (!file) return;
    setReading(true);
    setFatal('');
    setFileName(file.name);
    try {
      const result = rowsFromImportMatrix(columns, await readMatrixFromFile(file));
      if (result.rows.length > MAX_IMPORT_ROWS) {
        setFatal(`File berisi ${result.rows.length} baris. Maksimal ${MAX_IMPORT_ROWS} baris per impor — pecah menjadi beberapa file.`);
        setParsed(null);
      } else {
        setParsed(result);
      }
    } catch (error) {
      setParsed(null);
      setFatal(error.message || 'File tidak dapat dibaca.');
    } finally {
      setReading(false);
    }
  };

  const invalidRows = parsed ? parsed.rows.filter((row) => Object.keys(row.errors).length) : [];
  const blocked = !parsed || !parsed.rows.length || invalidRows.length > 0 || parsed.missingRequiredHeaders.length > 0;

  const submit = async () => {
    setSubmitting(true);
    setFatal('');
    try {
      const payload = parsed.rows.map((row) => ({
        rowNumber: row.rowNumber,
        values: payloadFromValues(importColumns, row.values),
      }));
      const result = await onImport(payload);
      toast(`${result?.created ?? payload.length} data berhasil diimpor`, 'success');
      reset();
      onClose();
      await onImported?.();
    } catch (error) {
      const rowErrors = error?.response?.data?.error?.details?.rowErrors;
      if (rowErrors?.length) {
        setParsed((current) => ({ ...current, rows: mergeServerErrors(current.rows, rowErrors) }));
        setFatal('Server menolak beberapa baris. Tidak ada data yang disimpan — perbaiki baris bertanda merah lalu impor ulang.');
      } else {
        setFatal(apiErrorMessage(error, 'Impor gagal. Tidak ada data yang disimpan.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const previewRows = parsed
    ? [...invalidRows, ...parsed.rows.filter((row) => !Object.keys(row.errors).length)].slice(0, PREVIEW_LIMIT)
    : [];

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Impor ${title || 'data'}`}
      size="lg"
      footer={(
        <>
          <Button variant="text" type="button" onClick={close} disabled={submitting}>Batal</Button>
          <Button type="button" onClick={submit} disabled={blocked || submitting} loading={submitting}>
            Impor {parsed?.rows.length || 0} baris
          </Button>
        </>
      )}
    >
      <div className="pw-grid-import">
        <p className="pw-grid-import__lead">
          Gunakan file <strong>.xlsx</strong> atau <strong>.csv</strong> dengan baris pertama berisi nama kolom.
          Impor bersifat <strong>semua-atau-tidak-sama-sekali</strong>: bila satu baris ditolak, tidak ada data yang disimpan.
        </p>

        <div className="pw-grid-import__columns">
          <span>Kolom yang dibaca:</span>
          {importColumns.map((column) => (
            <code key={column.key}>{column.header}{column.required ? ' *' : ''}</code>
          ))}
        </div>

        <div className="pw-grid-import__actions">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-label="Pilih file untuk diimpor"
            onChange={(event) => readFile(event.target.files?.[0])}
          />
          <Button type="button" variant="tonal" onClick={() => inputRef.current?.click()} loading={reading}>
            <Icon name="table_chart" size="sm" /> {fileName ? 'Ganti file' : 'Pilih file'}
          </Button>
          <Button type="button" variant="text" onClick={() => downloadTemplate(importColumns, baseName)}>
            <Icon name="download" size="sm" /> Unduh template
          </Button>
          {fileName ? <span className="pw-grid-import__file">{fileName}</span> : null}
        </div>

        {fatal ? <Banner tone="error">{fatal}</Banner> : null}

        {parsed ? (
          <>
            <div className="pw-grid-import__summary" role="status">
              {invalidRows.length || parsed.missingRequiredHeaders.length ? (
                <Icon name="warning" className="is-error" />
              ) : (
                <Icon name="check_circle" className="is-ok" />
              )}
              <span>
                {parsed.rows.length} baris terbaca · {parsed.rows.length - invalidRows.length} siap · {invalidRows.length} perlu diperbaiki
              </span>
            </div>
            {parsed.missingRequiredHeaders.length ? (
              <Banner tone="error">
                Kolom wajib tidak ditemukan di file: {parsed.missingRequiredHeaders.join(', ')}.
              </Banner>
            ) : null}
            {parsed.unknownHeaders.length ? (
              <Banner tone="info">
                Kolom diabaikan (tidak dikenal): {parsed.unknownHeaders.join(', ')}.
              </Banner>
            ) : null}
            {previewRows.length ? (
              <div className="pw-grid__scroll pw-grid-import__preview">
                <table className="pw-grid__table">
                  <thead>
                    <tr>
                      <th scope="col">Baris</th>
                      {importColumns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.rowNumber} className={Object.keys(row.errors).length ? 'is-invalid' : undefined}>
                        <td>
                          {row.rowNumber}
                          {row.errors._row ? <small className="pw-grid__error">{row.errors._row}</small> : null}
                        </td>
                        {importColumns.map((column) => (
                          <td key={column.key} className={row.errors[column.key] ? 'is-invalid' : undefined}>
                            {String(displayValue(column, row.values) ?? '') || <span className="pw-grid__muted">—</span>}
                            {row.errors[column.key] ? <small className="pw-grid__error">{row.errors[column.key]}</small> : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {parsed.rows.length > PREVIEW_LIMIT ? (
              <p className="pw-grid__muted">Menampilkan {PREVIEW_LIMIT} baris pertama (baris bermasalah ditampilkan lebih dulu).</p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
