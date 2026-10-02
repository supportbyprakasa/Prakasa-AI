import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Chip from '../../components/Chip';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import KeyValue from '../../components/KeyValue';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { readSheetsFromFile } from '../../components/datagrid/gridFile';
import { formatNumber } from '../../components/format';
import {
  ACTION_LABELS, IMPORT_KIND_LABELS, PREVIEW_FILTERS, actionStatus, applyLines, defaultLocationMap, filterPreview, importBody,
  locationValues, previewCounts, readWorkbook,
} from './infraModel';
import { useLocations } from './useLookups';
import './it-infra.css';

const errorOf = (error) => error?.response?.data?.error || {};
const SKIP = '';
const LEVEL_STATUS = { error: 'issue_error', warning: 'issue_warning', info: 'issue_info' };

function RowNotes({ row }) {
  const issues = row.issues || [];
  const diffs = row.differences || [];
  if (!issues.length && !diffs.length) return null;
  return (
    <span className="it-infra__notes">
      {issues.map((issue, index) => (
        <span key={`${issue.code}-${index}`} className="it-infra__issue">
          <StatusBadge status={LEVEL_STATUS[issue.level] || 'issue_info'} />
          {' '}
          {issue.message}
        </span>
      ))}
      {diffs.map((d) => <span key={d.field} className="it-infra__diff">{`${d.label}: ${d.current ?? '—'} → ${d.incoming ?? '—'}`}</span>)}
    </span>
  );
}

// Import from the owner's IT report (§4.3): Network Devices, ISP and CCTV
// sheets only. The browser reads the .xlsx and keeps ONLY the allow-listed
// columns (password/username/login columns are never read), every "Lokasi"
// is mapped to a company location or skipped, the server previews per row
// (Baru / Sudah ada / Berbeda / Dilewati) and applies in one transaction;
// an existing row changes only when "Perbarui" is ticked.
export default function InfraImportDialog({ open, onClose, onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [found, setFound] = useState([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [locationMap, setLocationMap] = useState({});
  const [mapTouched, setMapTouched] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [updates, setUpdates] = useState([]);
  const [filters, setFilters] = useState({ isp: 'all', network: 'all', cctv: 'all' });
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [result, setResult] = useState(null);
  const locations = useLocations(open);

  useEffect(() => {
    if (!open) return;
    setFileName(''); setFound([]); setReadError(''); setLocationMap({}); setMapTouched(false); setPreview(null); setPreviewError('');
    setUpdates([]); setFilters({ isp: 'all', network: 'all', cctv: 'all' }); setApplyError(''); setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  const values = useMemo(() => locationValues(found), [found]);
  // Locations may arrive after the file was read: default the mapping again
  // until the user has chosen something themself.
  useEffect(() => {
    if (found.length && !mapTouched) setLocationMap(defaultLocationMap(values, locations.rows));
  }, [locations.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeLocations = (locations.rows || []).filter((l) => l.isActive !== false);
  const locationChoices = [{ value: SKIP, label: 'Bukan perusahaan ini — lewati', translate: true }, ...activeLocations.map((l) => ({ value: String(l.id), label: l.name }))];
  const body = found.length ? importBody(found, locationMap) : null;
  const requestKey = body ? JSON.stringify([fileName, locationMap, previewKey]) : '';

  useEffect(() => {
    if (!open || !requestKey) return undefined;
    let active = true;
    setPreviewing(true); setPreviewError(''); setApplyError('');
    api.post('/it/infrastructure/import/preview', body)
      .then((response) => {
        if (!active) return;
        const data = response.data.data;
        setPreview(data);
        const valid = new Set(Object.values(data.rows || {}).flat().filter((r) => r.action === 'different').map((r) => r.key));
        setUpdates((current) => current.filter((k) => valid.has(k)));
      })
      .catch((error) => {
        if (!active) return;
        setPreview(null);
        setPreviewError(errorOf(error).message || 'Pratinjau gagal dibuat. Periksa koneksi, lalu coba lagi.');
      })
      .finally(() => { if (active) setPreviewing(false); });
    return () => { active = false; };
  }, [open, requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = async (file) => {
    if (!file) return;
    setReading(true); setReadError(''); setPreview(null); setResult(null); setUpdates([]); setFileName(file.name);
    try {
      const sheets = await readSheetsFromFile(file);
      const list = readWorkbook(sheets);
      setFound(list);
      setLocationMap(defaultLocationMap(locationValues(list), locations.rows));
      if (!list.length) setReadError('Tidak ada sheet Network Devices, ISP, atau CCTV yang dikenali di file ini.');
    } catch (error) {
      setFound([]);
      setReadError(error.message || 'File tidak dapat dibaca.');
    } finally {
      setReading(false);
    }
  };

  const toggle = (key) => setUpdates((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  const apply = async () => {
    setApplying(true); setApplyError('');
    try {
      const response = await api.post('/it/infrastructure/import/apply', importBody(found, locationMap, updates));
      setResult(response.data.data);
      toast('Impor selesai', 'success');
      await onImported?.();
    } catch (error) {
      setApplyError(errorOf(error).message || 'Impor gagal. Tidak ada data yang disimpan.');
    } finally {
      setApplying(false);
    }
  };

  const allRows = preview ? Object.values(preview.rows || {}).flat() : [];
  const applicable = allRows.some((r) => r.action === 'new' || (r.action === 'different' && updates.includes(r.key)));
  const close = () => { if (!applying) onClose(); };

  const columns = [
    { key: 'rowNumber', header: 'Baris', type: 'number' },
    { key: 'action', header: 'Hasil', render: (r) => <StatusBadge status={actionStatus(r.action)} label={ACTION_LABELS[r.action]} />, exportValue: (r) => ACTION_LABELS[r.action] },
    { key: 'locationText', header: 'Lokasi di file' },
    { key: 'summary', header: 'Ringkasan' },
    { key: 'notes', header: 'Catatan impor', display: true, sortable: false, render: (r) => <RowNotes row={r} /> },
    {
      key: 'update', header: 'Perbarui', display: true, sortable: false, translate: true,
      render: (r) => (r.action === 'different' ? <Checkbox aria-label={`Perbarui baris ${r.rowNumber}`} checked={updates.includes(r.key)} disabled={Boolean(result)} onChange={() => toggle(r.key)} /> : null),
    },
  ];

  let previewSection = null;
  if (result) {
    previewSection = (
      <FullScreenSection title="Hasil impor">
        <div className="pw-stack">
          <Banner tone="success" title="Impor selesai">Semua perubahan tercatat di log aktivitas.</Banner>
          <KeyValue items={applyLines(result)} columns={2} />
        </div>
      </FullScreenSection>
    );
  } else if (found.length) {
    let content = null;
    if (previewing && !preview) content = <LoadingState label="Membuat pratinjau" />;
    else if (previewError) {
      content = (
        <EmptyState tone="error" compact title="Pratinjau gagal dibuat" description={previewError}
          action={<Button variant="text" onClick={() => setPreviewKey((n) => n + 1)}>Coba lagi</Button>} />
      );
    } else if (preview) {
      content = (
        <div className="pw-stack">
          <KeyValue items={previewCounts(preview)} />
          {['isp', 'network', 'cctv'].filter((kind) => (preview.rows?.[kind] || []).length).map((kind) => {
            const rows = preview.rows[kind];
            return (
              <DataGrid
                key={kind}
                title={IMPORT_KIND_LABELS[kind]}
                idKey="key"
                rows={filterPreview(rows, filters[kind])}
                loading={previewing}
                columns={columns}
                exportable={false}
                filters={PREVIEW_FILTERS.filter((f) => f.key === 'all' || filterPreview(rows, f.key).length).map((f) => (
                  <Chip key={f.key} selected={filters[kind] === f.key} onClick={() => setFilters((c) => ({ ...c, [kind]: f.key }))}>
                    {`${f.label} (${formatNumber(filterPreview(rows, f.key).length)})`}
                  </Chip>
                ))}
                empty="Tidak ada baris"
              />
            );
          })}
        </div>
      );
    }
    previewSection = content ? <FullScreenSection title="Pratinjau">{content}</FullScreenSection> : null;
  }

  return (
    <FullScreenDialog
      open={open}
      onClose={close}
      dirty={Boolean(preview) && !result}
      title="Impor dari laporan IT"
      card={false}
      actions={result ? (
        <Button type="button" onClick={onClose}>Selesai</Button>
      ) : (
        <>
          <Button variant="text" type="button" onClick={close} disabled={applying}>Batal</Button>
          <Button type="button" onClick={apply} loading={applying} disabled={!preview || previewing || !applicable}>Terapkan impor</Button>
        </>
      )}
    >
      <FullScreenSection title="File laporan">
        <div className="pw-stack">
          <p className="it-infra__lead">
            Pilih laporan IT (.xlsx). Hanya sheet perangkat jaringan, ISP, dan CCTV yang dibaca, dan hanya kolom yang dikenal.
            Kolom kata sandi, username, atau login tidak pernah dibaca dan tidak dikirim. Tidak ada yang tersimpan sebelum Anda menekan Terapkan impor.
          </p>
          <div className="pw-row">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="File laporan IT"
              onChange={(event) => readFile(event.target.files?.[0])}
            />
            <Button type="button" variant="secondary" icon="upload_file" loading={reading} disabled={applying || Boolean(result)} onClick={() => inputRef.current?.click()}>
              {fileName ? 'Ganti file' : 'Pilih file'}
            </Button>
            {fileName ? <span className="it-infra__file">{fileName}</span> : null}
          </div>
          {readError ? <Banner tone="warning">{readError}</Banner> : null}
          {found.length ? (
            <KeyValue items={found.map((s) => ({
              label: `Sheet "${s.sheet}"`,
              value: `${IMPORT_KIND_LABELS[s.kind]} · ${formatNumber(s.rows.length)} baris`,
            }))} />
          ) : null}
          {found.filter((s) => s.secretColumns.length).map((s) => (
            <Banner key={`secret-${s.sheet}`} tone="info">{`Sheet "${s.sheet}": kolom ${s.secretColumns.map((c) => `"${c}"`).join(', ')} tidak dibaca (berisi kata sandi atau akun).`}</Banner>
          ))}
          {found.filter((s) => s.droppedSecrets).map((s) => (
            <Banner key={`dropped-${s.sheet}`} tone="warning">{`Sheet "${s.sheet}": ${formatNumber(s.droppedSecrets)} isian berisi kata sandi — tidak diimpor.`}</Banner>
          ))}
        </div>
      </FullScreenSection>

      {values.length && !result ? (
        <FullScreenSection title="Lokasi">
          <div className="pw-stack">
            <p className="it-infra__lead">Laporan tidak punya kolom perusahaan. Pilih lokasi perusahaan ini untuk setiap lokasi di file; lokasi lain dilewati.</p>
            {!activeLocations.length && !locations.loading ? (
              <Banner tone="warning">Belum ada lokasi perusahaan. Tambahkan dulu di Perangkat → Lokasi.</Banner>
            ) : null}
            <div className="pw-form-grid">
              {values.map(({ text, rows }) => (
                <Select
                  key={text}
                  label={`${text} (${formatNumber(rows)} baris)`}
                  value={locationMap[text] == null ? SKIP : String(locationMap[text])}
                  options={locationChoices}
                  dataOptions
                  onChange={(event) => { setMapTouched(true); setLocationMap((current) => ({ ...current, [text]: event.target.value ? Number(event.target.value) : null })); }}
                />
              ))}
            </div>
          </div>
        </FullScreenSection>
      ) : null}

      {previewSection}

      {preview && !result ? (
        <FullScreenSection title="Konfirmasi">
          <div className="pw-stack">
            {applyError ? <Banner tone="error">{applyError}</Banner> : null}
            {!applicable ? <Banner tone="info">Tidak ada baris yang akan diubah. Centang Perbarui pada baris yang berbeda bila ingin memperbaruinya.</Banner> : null}
            {applicable ? <Banner tone="info">Impor hanya dijalankan setelah owner menyetujui. Baris yang ada hanya berubah bila Perbarui dicentang.</Banner> : null}
          </div>
        </FullScreenSection>
      ) : null}
    </FullScreenDialog>
  );
}
