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
import { Translate } from '../../i18n/NoTranslate';
import { readSheetsFromFile } from '../../components/datagrid/gridFile';
import { formatNumber } from '../../components/format';
import { deviceStatusKey } from './itModel';
import {
  ACTION_LABELS, ROW_FILTERS, SHEETS, actionStatus, applySummary, bodyTooLarge, canUpdate, companyCodeError,
  companyOptions, countRows, differenceText, filterRows, ignoredColumnsNotes, importBody, importHolderText,
  importStatusLabel, importTypeLabel, issueStatus, keepValidUpdates, pickSheet, prepareSheet, previewSummary,
  sheetProblem,
} from './reportImportModel';
import './it-assets.css';

const ENDPOINTS = {
  devices: '/it/devices/import',
  people: '/people/directory/import',
};
const errorOf = (error) => error?.response?.data?.error || {};
const errorMessage = (error, fallback) => errorOf(error).message || fallback;

function IssueList({ row }) {
  const issues = row.issues || [];
  const differences = row.differences || [];
  if (!issues.length && !differences.length) return null;
  return (
    <span className="it-import__notes">
      {issues.map((issue, index) => (
        <span key={`${issue.code}-${index}`} className="it-import__issue">
          <StatusBadge status={issueStatus(issue.level)} />
          {' '}
          {issue.message}
        </span>
      ))}
      {differences.map((d) => <span key={d.field} className="it-import__diff">{differenceText(d)}</span>)}
    </span>
  );
}

// Import of the owner's IT device report (rule 18, API contract §4): pick the
// .xlsx, choose the sheet ("Device Inventory", optionally the hidden "User
// List"), preview per row on the server, tick "Perbarui" for differences,
// confirm the company code, apply. kind="people" imports only the User List
// into the directory (§2, directory import).
export default function ReportImportDialog({ open, onClose, kind = 'devices', canImportPeople = false, onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [deviceSheet, setDeviceSheet] = useState('');
  const [peopleSheet, setPeopleSheet] = useState('');
  const [includePeople, setIncludePeople] = useState(false);
  const [createLocations, setCreateLocations] = useState(false);
  const [personChoices, setPersonChoices] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [updates, setUpdates] = useState([]);
  const [companyCode, setCompanyCode] = useState('');
  const [companyError, setCompanyError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [result, setResult] = useState(null);
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [peopleFilter, setPeopleFilter] = useState('all');

  const peopleKind = kind === 'people';
  const reset = () => {
    setFileName(''); setSheets([]); setReadError(''); setDeviceSheet(''); setPeopleSheet(''); setIncludePeople(false);
    setCreateLocations(false); setPersonChoices({}); setPreview(null); setPreviewError(''); setUpdates([]);
    setCompanyCode(''); setCompanyError(''); setApplyError(''); setResult(null); setDeviceFilter('all'); setPeopleFilter('all');
    if (inputRef.current) inputRef.current.value = '';
  };
  useEffect(() => { if (open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetOptions = sheets.map((s) => ({ value: s.sheet, label: s.sheet }));
  const sheetData = (name) => sheets.find((s) => s.sheet === name)?.data || null;

  const prepared = useMemo(() => ({
    devices: !peopleKind && deviceSheet ? prepareSheet(sheetData(deviceSheet), 'devices') : null,
    people: (peopleKind || includePeople) && peopleSheet ? prepareSheet(sheetData(peopleSheet), 'people') : null,
  }), [sheets, deviceSheet, peopleSheet, includePeople, peopleKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = [
    !peopleKind && deviceSheet ? sheetProblem(prepared.devices, deviceSheet) : null,
    (peopleKind || includePeople) && peopleSheet ? sheetProblem(prepared.people, peopleSheet) : null,
  ].filter(Boolean);
  const ready = sheets.length > 0 && (peopleKind ? Boolean(prepared.people) : Boolean(prepared.devices))
    && (!includePeople || peopleKind || Boolean(prepared.people)) && !problems.length;
  const baseBody = ready ? importBody({
    kind,
    devices: prepared.devices?.matrix,
    people: prepared.people?.matrix,
    createLocations,
    personChoices,
  }) : null;
  const tooLarge = baseBody ? bodyTooLarge(baseBody) : false;
  const requestKey = baseBody && !tooLarge ? JSON.stringify([fileName, deviceSheet, peopleSheet, includePeople, createLocations, personChoices, previewKey]) : '';

  // The preview follows every choice that changes it (sheet, "buat lokasi
  // baru", link/new per name-only person): the fingerprint confirmed on apply
  // must be the one of the choices on screen.
  useEffect(() => {
    if (!open || !requestKey) return undefined;
    let active = true;
    setPreviewing(true);
    setPreviewError('');
    setApplyError('');
    api.post(`${ENDPOINTS[kind]}/preview`, baseBody)
      .then((response) => {
        if (!active) return;
        const data = response.data.data;
        setPreview(data);
        setCompanyCode((current) => current || data.companyCode || '');
        setUpdates((current) => keepValidUpdates(current, [...(data.devices || []), ...(data.people || [])]));
      })
      .catch((error) => {
        if (!active) return;
        setPreview(null);
        setPreviewError(errorMessage(error, 'Pratinjau gagal dibuat. Periksa koneksi, lalu coba lagi.'));
      })
      .finally(() => { if (active) setPreviewing(false); });
    return () => { active = false; };
  }, [open, requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = async (file) => {
    if (!file) return;
    setReading(true);
    setReadError('');
    setPreview(null);
    setResult(null);
    setUpdates([]);
    setPersonChoices({});
    setFileName(file.name);
    try {
      const list = await readSheetsFromFile(file);
      const names = list.map((s) => s.sheet);
      setSheets(list);
      const devicesName = pickSheet(names, 'devices');
      const peopleName = pickSheet(names, 'people');
      setDeviceSheet(peopleKind ? '' : devicesName || names[0] || '');
      setPeopleSheet(peopleName || (peopleKind ? names[0] || '' : ''));
      setIncludePeople(!peopleKind && canImportPeople && Boolean(peopleName));
      if (!peopleKind && !devicesName) setReadError(`Sheet "${SHEETS.devices.name}" tidak ditemukan. Pilih sheet perangkat di bawah.`);
      if (peopleKind && !peopleName) setReadError(`Sheet "${SHEETS.people.name}" tidak ditemukan. Pilih sheet orang di bawah.`);
    } catch (error) {
      setSheets([]);
      setReadError(error.message || 'File tidak dapat dibaca.');
    } finally {
      setReading(false);
    }
  };

  const toggleUpdate = (key) => setUpdates((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  const setChoice = (key, value) => setPersonChoices((current) => {
    const next = { ...current };
    if (value === 'link') delete next[key]; else next[key] = value;
    return next;
  });

  const apply = async () => {
    const codeError = companyCodeError(companyCode, preview);
    setCompanyError(codeError);
    if (codeError) return;
    setApplying(true);
    setApplyError('');
    try {
      const body = importBody({
        kind,
        devices: prepared.devices?.matrix,
        people: prepared.people?.matrix,
        createLocations,
        personChoices,
        apply: { companyCode, fingerprint: preview.fingerprint, updates },
      });
      const response = await api.post(`${ENDPOINTS[kind]}/apply`, body);
      setResult(response.data.data);
      toast('Impor selesai', 'success');
      await onImported?.();
    } catch (error) {
      const { code } = errorOf(error);
      if (code === 'COMPANY_CODE_MISMATCH') setCompanyError(errorMessage(error, 'Kode perusahaan tidak cocok.'));
      else if (code === 'IMPORT_STALE') {
        setApplyError(errorMessage(error, 'Data berubah sejak pratinjau. Pratinjau dimuat ulang.'));
        setPreviewKey((n) => n + 1);
      } else setApplyError(errorMessage(error, 'Impor gagal. Tidak ada data yang disimpan.'));
    } finally {
      setApplying(false);
    }
  };

  const deviceRows = preview?.devices || [];
  const peopleRows = preview?.people || [];
  const dropped = { devices: prepared.devices?.credentialColumns || [], people: prepared.people?.credentialColumns || [] };
  const notes = ignoredColumnsNotes(preview, dropped);
  const applicable = [...deviceRows, ...peopleRows].some((row) => row.action !== 'skip' && (row.action !== 'exists' || updates.includes(row.key)));
  const canApply = Boolean(preview) && !previewing && !result && applicable;

  const deviceColumns = [
    { key: 'rowNumber', header: 'Baris', type: 'number' },
    { key: 'action', header: 'Hasil', render: (r) => <StatusBadge status={actionStatus(r.action)} label={ACTION_LABELS[r.action]} />, exportValue: (r) => ACTION_LABELS[r.action] || r.action },
    { key: 'deviceType', header: 'Tipe', translate: true, render: importTypeLabel, sortValue: importTypeLabel },
    { key: 'model', header: 'Merek / model' },
    { key: 'serialNumber', header: 'Nomor seri' },
    { key: 'assetCode', header: 'No. aset' },
    { key: 'status', header: 'Status', render: (r) => (r.status ? <StatusBadge status={deviceStatusKey(r.status)} label={importStatusLabel(r)} /> : r.reportStatus), sortValue: importStatusLabel },
    { key: 'holder', header: 'Pemakai', render: importHolderText, sortValue: importHolderText },
    { key: 'locationText', header: 'Lokasi', render: (r) => (r.locationText ? <>{r.locationText}{r.locationNew ? <Translate>{' (baru)'}</Translate> : ''}</> : '') },
    { key: 'issues', header: 'Catatan impor', display: true, sortable: false, render: (r) => <IssueList row={r} /> },
    {
      key: 'update', header: 'Perbarui', display: true, sortable: false, translate: true,
      render: (r) => (canUpdate(r) ? <Checkbox aria-label={`Perbarui baris ${r.rowNumber}`} checked={updates.includes(r.key)} onChange={() => toggleUpdate(r.key)} /> : null),
    },
  ];
  const peopleColumns = [
    { key: 'rowNumber', header: 'Baris', type: 'number' },
    { key: 'action', header: 'Hasil', render: (r) => <StatusBadge status={actionStatus(r.action)} label={ACTION_LABELS[r.action]} /> },
    { key: 'fullName', header: 'Nama' },
    { key: 'position', header: 'Jabatan' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status === 'resigned' ? 'person_resigned' : 'person_active'} /> },
    { key: 'workEmail', header: 'Email kerja' },
    { key: 'match', header: 'Cocok dengan', render: (r) => (r.match ? [r.match.name, r.match.email].filter(Boolean).join(' · ') : '') },
    {
      key: 'choice', header: 'Pilihan', display: true, sortable: false, translate: true,
      render: (r) => (r.nameOnly ? (
        <Select
          dense
          label={`Pilihan baris ${r.rowNumber}`}
          value={personChoices[r.key] || 'link'}
          onChange={(event) => setChoice(r.key, event.target.value)}
          options={[{ value: 'link', label: 'Tautkan ke akun' }, { value: 'new', label: 'Orang baru' }]}
        />
      ) : null),
    },
    { key: 'issues', header: 'Catatan impor', display: true, sortable: false, render: (r) => <IssueList row={r} /> },
    {
      key: 'update', header: 'Perbarui', display: true, sortable: false, translate: true,
      render: (r) => (canUpdate(r) ? <Checkbox aria-label={`Perbarui baris ${r.rowNumber}`} checked={updates.includes(r.key)} onChange={() => toggleUpdate(r.key)} /> : null),
    },
  ];

  const chips = (rows, value, set) => ROW_FILTERS.filter((f) => f.key === 'all' || countRows(rows, f.key) > 0).map((f) => (
    <Chip key={f.key} selected={value === f.key} onClick={() => set(f.key)}>{`${f.label} (${formatNumber(countRows(rows, f.key))})`}</Chip>
  ));

  const title = peopleKind ? 'Impor direktori dari laporan' : 'Impor laporan perangkat';
  const close = () => { if (!applying) onClose(); };

  let previewSection = null;
  if (result) {
    previewSection = (
      <FullScreenSection title="Hasil impor">
        <div className="pw-stack">
          <Banner tone="success" title="Impor selesai">Semua perubahan tercatat di log aktivitas.</Banner>
          <KeyValue items={applySummary(result, kind)} columns={2} />
        </div>
      </FullScreenSection>
    );
  } else if (sheets.length) {
    let body;
    if (previewing && !preview) body = <LoadingState label="Membuat pratinjau" />;
    else if (previewError) {
      body = (
        <EmptyState
          tone="error"
          compact
          title="Pratinjau gagal dibuat"
          description={previewError}
          action={<Button variant="text" onClick={() => setPreviewKey((n) => n + 1)}>Coba lagi</Button>}
        />
      );
    } else if (preview) {
      body = (
        <div className="pw-stack">
          <KeyValue items={previewSummary(preview)} />
          {notes.map((note) => <Banner key={note} tone="info">{note}</Banner>)}
          {!peopleKind && preview.newLocations?.length ? (
            <Checkbox
              label={`Buat lokasi baru: ${preview.newLocations.join(', ')}`}
              checked={createLocations}
              disabled={previewing}
              onChange={(event) => setCreateLocations(event.target.checked)}
            />
          ) : null}
          {!peopleKind ? (
            <DataGrid
              title="Perangkat di file"
              idKey="key"
              rows={filterRows(deviceRows, deviceFilter)}
              loading={previewing}
              columns={deviceColumns}
              exportable={false}
              filters={chips(deviceRows, deviceFilter, setDeviceFilter)}
              empty="Tidak ada perangkat perusahaan ini di sheet"
            />
          ) : null}
          {peopleRows.length || peopleKind ? (
            <DataGrid
              title="Orang di file"
              idKey="key"
              rows={filterRows(peopleRows, peopleFilter)}
              loading={previewing}
              columns={peopleColumns}
              exportable={false}
              filters={chips(peopleRows, peopleFilter, setPeopleFilter)}
              empty="Tidak ada orang perusahaan ini di sheet"
            />
          ) : null}
        </div>
      );
    }
    previewSection = body ? <FullScreenSection title="Pratinjau">{body}</FullScreenSection> : null;
  }

  return (
    <FullScreenDialog
      open={open}
      onClose={close}
      dirty={Boolean(preview) && !result}
      title={title}
      card={false}
      actions={result ? (
        <Button type="button" onClick={onClose}>Selesai</Button>
      ) : (
        <>
          <Button variant="text" type="button" onClick={close} disabled={applying}>Batal</Button>
          <Button type="button" onClick={apply} loading={applying} disabled={!canApply}>Terapkan impor</Button>
        </>
      )}
    >
      <FullScreenSection title="File laporan">
        <div className="pw-stack">
          <p className="it-import__lead">
            {peopleKind
              ? 'Pilih laporan perangkat IT (.xlsx). Hanya sheet "User List" yang dibaca: nama, jabatan, status, dan email kerja karyawan perusahaan ini.'
              : 'Pilih laporan perangkat IT (.xlsx). Sheet "Device Inventory" dibaca per baris; sheet "User List" (tersembunyi di laporan) boleh ikut untuk direktori.'}
            {' '}Kolom berisi kata sandi, username, atau kredensial tidak dibaca dan tidak dikirim. Tidak ada yang tersimpan sebelum Anda menekan Terapkan impor.
          </p>
          <div className="pw-row">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="File laporan perangkat"
              onChange={(event) => readFile(event.target.files?.[0])}
            />
            <Button type="button" variant="secondary" icon="upload_file" loading={reading} disabled={applying || Boolean(result)} onClick={() => inputRef.current?.click()}>
              {fileName ? 'Ganti file' : 'Pilih file'}
            </Button>
            {fileName ? <span className="it-import__file">{fileName}</span> : null}
          </div>
          {readError ? <Banner tone="warning">{readError}</Banner> : null}
          {sheets.length ? (
            <div className="pw-form-grid">
              {!peopleKind ? (
                <Select label="Sheet perangkat" value={deviceSheet} options={sheetOptions} dataOptions disabled={Boolean(result)} onChange={(event) => setDeviceSheet(event.target.value)} />
              ) : null}
              {peopleKind || includePeople ? (
                <Select label="Sheet orang (User List)" value={peopleSheet} placeholder="Pilih sheet" options={sheetOptions} dataOptions disabled={Boolean(result)} onChange={(event) => setPeopleSheet(event.target.value)} />
              ) : null}
            </div>
          ) : null}
          {sheets.length && !peopleKind && canImportPeople ? (
            <Checkbox
              label="Sertakan sheet User List untuk direktori (orang baru dan tautan akun)"
              checked={includePeople}
              disabled={Boolean(result)}
              onChange={(event) => setIncludePeople(event.target.checked)}
            />
          ) : null}
          {problems.map((problem) => <Banner key={problem} tone="error">{problem}</Banner>)}
          {tooLarge ? <Banner tone="error">File terlalu besar untuk sekali impor (batas 1 MB data). Hapus sheet atau baris yang tidak dipakai, lalu pilih file lagi.</Banner> : null}
        </div>
      </FullScreenSection>

      {previewSection}

      {preview && !result ? (
        <FullScreenSection title="Konfirmasi">
          <div className="pw-stack">
            <div className="pw-form-grid">
              <Select
                label="Kode perusahaan"
                required
                value={companyCode}
                options={companyOptions(preview)}
                error={companyError || undefined}
                hint="Hanya baris dengan kode ini yang diimpor."
                onChange={(event) => { setCompanyCode(event.target.value); setCompanyError(companyCodeError(event.target.value, preview)); }}
              />
            </div>
            {applyError ? <Banner tone="error">{applyError}</Banner> : null}
            {!applicable ? <Banner tone="info">Tidak ada baris yang akan diubah. Centang Perbarui pada baris yang berbeda bila ingin memperbaruinya.</Banner> : null}
          </div>
        </FullScreenSection>
      ) : null}
    </FullScreenDialog>
  );
}
