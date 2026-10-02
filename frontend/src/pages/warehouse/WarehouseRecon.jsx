import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import SideSheet from '../../components/SideSheet';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime } from '../../components/format';
import { statusLabel } from '../../components/statusTone';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import useSalesList from '../sales/useSalesList';
import { apiError } from '../sales/salesModel';
import { DocumentModal } from './WarehouseAccurateDocs';
import { MovementStatusChip } from './WarehouseMovements';
import WarehouseReasonDialog from '../../components/ReasonDialog';
import { dateOnly, dayText, docTypeLabel } from './warehouseStockModel';
import { movementStatusLabel } from './warehouseMovementModel';
import {
  DIRECTION_FILTERS, DIRECTION_LABEL, RECON_FILTERS, RECON_STATUS, ageText, groupTitle, isDirection, isReconFilter, isReconWaiting, itemDiffText,
  lineReason, matchKindText, qtyBaseText, reconChipLabel, reconEscalates, reconFootnote, reconReasonText, reconStatusKey, readinessNotices,
  waitingNotice,
} from './warehouseReconModel';
import { Mixed, NoTranslate, Translate, data as dataPart } from '../../i18n/NoTranslate';

// Pencocokan barang masuk/keluar ↔ dokumen Accurate (program 3.2): the app's
// approved movements against approved Accurate documents, per item in base
// units. Quantities only; Accurate is only read — a difference is fixed at its
// source, paired by hand, or explained by a Supervisor/Head who did not record it.
const cell = (title, meta) => (
  <span className="pw-cell">
    <span className="pw-cell__title">{title}</span>
    {meta ? <span className="pw-cell__meta">{meta}</span> : null}
  </span>
);
// Language switch: an interface label inside a record-data cell.
const ui = (text) => (text ? <Translate>{text}</Translate> : '');
// "Aplikasi" is a label; "Accurate <nomor dokumen>" carries a document number.
const sourceCell = (l) => (l.source === 'Aplikasi' ? <Translate>{l.source}</Translate> : l.source);
// A group without a reference number says so (a label); the number itself is data.
const referenceValue = (g) => g.referenceNo || (g.status === 'acc_only' ? '—' : <Translate>tanpa referensi</Translate>);

// Age says whether the group is (or will be) in Pusat Eskalasi; a match or an explained group has none.
const groupAge = (g, graceDays) => (g.status === 'matched' || g.explained ? '—' : ageText(g.daysOpen, graceDays, reconEscalates(g)));

const columns = (graceDays) => [
  { key: 'dateTo', header: 'Tanggal', render: (r) => dayText(r.dateTo), exportValue: (r) => dateOnly(r.dateTo) },
  { key: 'direction', header: 'Arah', translate: true, render: (r) => DIRECTION_LABEL[r.direction], exportValue: (r) => DIRECTION_LABEL[r.direction] },
  {
    key: 'referenceNo', header: 'Referensi aplikasi',
    render: (r) => cell(r.referenceNo || '—', r.movementCount > 1 ? <Translate>{`${r.movementCount} pergerakan`}</Translate> : ''),
    exportValue: (r) => r.referenceNo || '',
  },
  {
    key: 'docNumbers', header: 'Dokumen Accurate',
    render: (r) => cell(r.docNumbers.length ? r.docNumbers.join(', ') : '—', r.docCount > r.docNumbers.length ? <Translate>{`+${r.docCount - r.docNumbers.length} lainnya`}</Translate> : ''),
    exportValue: (r) => r.docNumbers.join(', '),
  },
  { key: 'party', header: 'Pihak', render: (r) => r.party || '—' },
  { key: 'itemCount', header: 'Barang', align: 'end' },
  {
    key: 'status', header: 'Status', translate: true,
    render: (r) => <span className="pw-cell"><StatusBadge status={reconStatusKey(r)} /><span className="pw-cell__meta">{reconReasonText(r)}</span></span>,
    exportValue: (r) => statusLabel(reconStatusKey(r)),
  },
  { key: 'daysOpen', header: 'Umur', align: 'end', translate: true, render: (r) => groupAge(r, graceDays), exportValue: (r) => r.daysOpen },
];

// Pairing a movement with an Accurate document the app did not match: a
// search over the suggestions (±14 days) in a full-screen dialog.
function CandidatesDialog({ group, movements, open, onClose, onLinked }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, error: '', rows: [] });
  const [attempt, setAttempt] = useState(0);
  const [movementId, setMovementId] = useState('');
  const [reason, setReason] = useState('');
  const [pairing, setPairing] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.get(`/warehouse/recon/${group.direction}/${encodeURIComponent(group.groupKey)}/candidates`, { params: { q: q || undefined } })
      .then((r) => { if (alive) setState({ loading: false, error: '', rows: r.data.data || [] }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), rows: [] }); });
    return () => { alive = false; };
  }, [open, q, group, attempt]);
  useEffect(() => { if (open) { setMovementId(String(movements[0]?.id || '')); setReason(''); setQ(''); } }, [open, movements]);
  const pair = async (doc) => {
    setPairing(doc.id);
    try {
      await api.post('/warehouse/recon/links', {
        direction: group.direction, movementId: Number(movementId), docType: doc.docType, docId: doc.docId, ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast('Dokumen dipasangkan', 'success');
      onLinked();
    } catch (err) {
      toast(apiError(err), 'error');
    } finally {
      setPairing('');
    }
  };
  const candidateColumns = [
    { key: 'date', header: 'Tanggal', render: (d) => dayText(d.date), exportValue: (d) => dateOnly(d.date) },
    { key: 'number', header: 'Nomor', render: (d) => cell(d.number, <Translate>{docTypeLabel(d.docType)}</Translate>), exportValue: (d) => d.number },
    { key: 'party', header: 'Pihak', render: (d) => d.party || '—' },
    { key: 'sharedItems', header: 'Barang sama', align: 'end' },
    { key: 'dayGap', header: 'Selisih hari', align: 'end', render: (d) => (d.dayGap === null ? '—' : d.dayGap) },
    { key: 'assignedTo', header: 'Sudah dipasangkan ke', render: (d) => d.assignedTo || '—' },
  ];
  return (
    <Modal open={open} onClose={onClose} title={<Mixed parts={['Pasangkan dokumen Accurate', dataPart(groupTitle(group))]} />} size="lg">
      <div className="pw-stack pw-stack--lg">
        <div className="pw-fsdialog__fields">
          {movements.length > 1 ? (
            <Select label="Pergerakan" value={movementId} onChange={(e) => setMovementId(e.target.value)}
              options={movements.map((m) => ({ value: String(m.id), label: `#${m.id} · ${dayText(m.date)}` }))} dataOptions />
          ) : null}
          <Input label="Alasan" value={reason} maxLength={255} hint="Opsional; tercatat di riwayat." onChange={(e) => setReason(e.target.value)} />
        </div>
        <DataGrid
          title="Dokumen Accurate"
          columns={candidateColumns}
          rows={state.rows.map((d) => ({ ...d, id: `${d.docType}-${d.docId}` }))}
          loading={state.loading}
          error={state.error}
          onRetry={() => setAttempt((n) => n + 1)}
          search={q}
          onSearchChange={setQ}
          searchPlaceholder="Cari nomor dokumen"
          exportable={false}
          empty="Tidak ada dokumen Accurate yang cocok untuk disarankan"
          rowActions={(d) => (
            <IconButton label="Pasangkan" icon="link" size="sm" disabled={!movementId || Boolean(pairing)} onClick={() => pair(d)} />
          )}
        />
        <div className="pw-text-helper">Tanpa pencarian, tampil saran ±14 hari: diurutkan dari barang yang sama terbanyak, lalu tanggal terdekat. Satu dokumen hanya bisa dipasangkan ke satu kelompok.</div>
      </div>
    </Modal>
  );
}

// One reconciliation group: a computed comparison, so it opens as a side
// sheet (§2.2). Pairing, explaining and undoing open their own dialog on top.
function ReconSheet({ target, graceDays, onClose, onChanged }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const permissions = user?.permissions || [];
  const canOpenMovement = permissions.includes('warehouse.movement.view');
  const [state, setState] = useState({ loading: false, error: '', data: null });
  const [doc, setDoc] = useState(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [undo, setUndo] = useState(null);
  const load = useCallback(() => {
    if (!target) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    api.get(`/warehouse/recon/${target.direction}/${encodeURIComponent(target.groupKey)}`)
      .then((r) => { if (alive) setState({ loading: false, error: '', data: r.data.data }); })
      .catch((err) => { if (alive) setState({ loading: false, error: apiError(err), data: null }); });
    return () => { alive = false; };
  }, [target]);
  useEffect(() => load(), [load]);
  const reload = () => { load(); onChanged(); };
  const data = state.data;
  const g = data?.group;
  const perm = data?.permissions || {};

  const explain = async (reason) => {
    try {
      await api.post('/warehouse/recon/notes', { direction: g.direction, groupKey: g.groupKey, signature: g.signature, reason });
      toast('Ditandai sudah dijelaskan', 'success');
      setExplainOpen(false);
      reload();
    } catch (err) {
      toast(apiError(err), 'error');
      if (err.response?.data?.error?.code === 'STALE') { setExplainOpen(false); reload(); }
    }
  };
  const runUndo = async (reason) => {
    try {
      await api.post(undo.kind === 'link' ? `/warehouse/recon/links/${undo.id}/cancel` : `/warehouse/recon/notes/${undo.id}/cancel`, { reason });
      toast(undo.kind === 'link' ? 'Pasangan dilepas' : 'Penjelasan dibatalkan', 'success');
      setUndo(null);
      reload();
    } catch (err) { toast(apiError(err), 'error'); }
  };
  const recordNow = () => {
    const d = data.documents[0];
    const lines = (data.lines?.accurate || []).map((l) => ({ sku: l.itemNo || '', product: l.itemName || '', unit: l.unit || '' }));
    navigate(`/warehouse/movements/${g.direction}/new?ref=${encodeURIComponent(d?.number || '')}`, { state: { reconItems: lines } });
  };

  const itemColumns = [
    { key: 'itemName', header: 'Barang', render: (i) => cell(i.itemName || '—', i.itemKey || <Translate>tanpa kode barang</Translate>), exportValue: (i) => i.itemName },
    { key: 'appQty', header: 'Aplikasi', align: 'end', render: (i) => qtyBaseText(i.appQty, i.baseUnit), exportValue: (i) => i.appQty },
    { key: 'accQty', header: 'Accurate', align: 'end', render: (i) => qtyBaseText(i.accQty, i.baseUnit), exportValue: (i) => i.accQty },
    { key: 'diff', header: 'Selisih', align: 'end', render: itemDiffText, exportValue: (i) => i.diff },
    { key: 'state', header: 'Status', render: (i) => <StatusBadge status={RECON_STATUS[i.state]} />, exportValue: (i) => statusLabel(RECON_STATUS[i.state]) },
  ];
  const movementColumns = [
    { key: 'date', header: 'Tanggal', render: (m) => dayText(m.date), exportValue: (m) => dateOnly(m.date) },
    { key: 'referenceNo', header: 'Referensi', render: (m) => cell(m.referenceNo || '—', `#${m.id}`), exportValue: (m) => m.referenceNo },
    { key: 'status', header: 'Status', render: (m) => <MovementStatusChip status={m.status} />, exportValue: (m) => movementStatusLabel(m.status).label },
    { key: 'createdByName', header: 'Dibuat oleh', render: (m) => m.createdByName || '—' },
  ];
  const documentColumns = [
    { key: 'date', header: 'Tanggal', render: (d) => dayText(d.date), exportValue: (d) => dateOnly(d.date) },
    { key: 'number', header: 'Nomor', render: (d) => cell(d.number, <Translate>{docTypeLabel(d.docType)}</Translate>), exportValue: (d) => d.number },
    { key: 'party', header: 'Pihak', render: (d) => d.party || '—' },
    {
      key: 'matchKind', header: 'Cara cocok',
      render: (d) => cell(ui(matchKindText(d.matchKind ? [d.matchKind] : [])) || '—', d.link ? `${d.link.byName || '—'} · ${formatDateTime(d.link.at)}${d.link.reason ? ` · ${d.link.reason}` : ''}` : ''),
      exportValue: (d) => matchKindText(d.matchKind ? [d.matchKind] : []),
    },
  ];
  const unknown = data ? [
    ...(data.lines?.app || []).filter((l) => lineReason(l)).map((l) => ({ ...l, source: 'Aplikasi', id: `a-${l.movementId}-${l.lineNo}` })),
    ...(data.lines?.accurate || []).filter((l) => lineReason(l)).map((l) => ({ ...l, source: `Accurate ${l.number || ''}`, id: `d-${l.docId}-${l.lineNo}` })),
  ] : [];
  const unknownColumns = [
    { key: 'source', header: 'Sumber', render: sourceCell },
    { key: 'itemName', header: 'Barang', render: (l) => cell(l.itemName || '—', l.itemNo || '') },
    { key: 'qty', header: 'Jumlah', translateContext: 'quantity', align: 'end', render: (l) => (l.qty === null ? '—' : `${l.qty} ${l.unit || ''}`), exportValue: (l) => l.qty },
    { key: 'reason', header: 'Alasan', translate: true, render: (l) => lineReason(l), exportValue: (l) => lineReason(l) },
  ];
  const canRecordNow = g && g.status === 'acc_only' && !data.waitingMovements.length && permissions.includes('warehouse.movement.create');

  return (
    <>
      <SideSheet
        open={Boolean(target)}
        onClose={onClose}
        title={g ? <Mixed parts={[DIRECTION_LABEL[g.direction], dataPart(groupTitle(g))]} /> : 'Pencocokan'}
        footer={g && (perm.canLink || perm.canExplain || canRecordNow) ? (
          <>
            {canRecordNow ? <Button variant="secondary" onClick={recordNow}>Catat sekarang</Button> : null}
            {perm.canExplain ? <Button variant="secondary" onClick={() => setExplainOpen(true)}>Tandai sudah dijelaskan</Button> : null}
            {perm.canLink ? <Button onClick={() => setPairOpen(true)}>Pasangkan dokumen Accurate</Button> : null}
          </>
        ) : null}
      >
        {state.loading && !data ? <LoadingState label="Memuat pencocokan…" skeleton="table" /> : null}
        {state.error ? (
          <EmptyState compact tone="error" title="Pencocokan belum bisa dimuat" description={state.error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />
        ) : null}
        {data ? (
          <div className="pw-stack pw-stack--lg">
            <KeyValue items={[
              { label: 'Status', value: <StatusBadge status={reconStatusKey(g)} /> },
              { label: 'Keterangan', value: reconReasonText(g), translate: true },
              { label: 'Referensi', value: referenceValue(g) },
              { label: 'Dokumen Accurate', value: g.docNumbers.length ? g.docNumbers.join(', ') : '—' },
              g.matchKinds.length ? { label: 'Cocok lewat', value: matchKindText(g.matchKinds), translate: true } : null,
              g.status !== 'matched' ? { label: 'Umur', value: groupAge(g, graceDays), translate: true } : null,
            ]}
            />
            {isReconWaiting(g) ? (
              <Banner tone="info" title="Menunggu data Accurate">
                {`Data gudang dari Accurate baru lengkap sampai ${dayText(g.dataThrough)}: dokumennya mungkin ada di batch Warehouse yang menunggu persetujuan. Kelompok ini dicek lagi setelah datanya lengkap dan belum dieskalasi.`}
              </Banner>
            ) : null}
            {data.note ? (
              <Banner
                tone={data.note.lapsed ? 'warning' : 'info'}
                title={data.note.lapsed ? 'Penjelasan sebelumnya tidak berlaku karena data berubah' : `Dijelaskan oleh ${data.note.byName || '—'} · ${formatDateTime(data.note.at)}`}
                action={perm.canUnexplain ? <Button variant="text" onClick={() => setUndo({ kind: 'note', id: data.note.id })}>Batalkan penjelasan</Button> : null}
              >
                <NoTranslate>{data.note.reason}</NoTranslate>
              </Banner>
            ) : null}
            {perm.resolveBlockedReason ? <Banner tone="info">{perm.resolveBlockedReason}</Banner> : null}
            {data.waitingMovements.length ? (
              <Banner
                tone="info"
                title="Ada pergerakan dengan referensi ini yang belum disetujui"
                action={canOpenMovement ? <Button variant="text" to={`/warehouse/movements/${g.direction}/${data.waitingMovements[0].id}`}>Buka pergerakan</Button> : null}
              >
                <NoTranslate>{data.waitingMovements.map((w) => `#${w.id} (${w.referenceNo || '—'})`).join(', ')}</NoTranslate>
              </Banner>
            ) : null}
            {data.items.length ? (
              <DataGrid title="Per barang (satuan dasar)" columns={itemColumns} rows={data.items.map((i, n) => ({ ...i, id: `${i.itemKey || 'x'}-${n}` }))} searchable={false} exportName={`pencocokan-${g.groupKey}`} />
            ) : null}
            {data.movements.length ? (
              <DataGrid
                title="Pergerakan di aplikasi"
                columns={movementColumns}
                rows={data.movements}
                searchable={false}
                exportable={false}
                onRowClick={canOpenMovement ? (m) => navigate(`/warehouse/movements/${g.direction}/${m.id}`) : undefined}
              />
            ) : null}
            <DataGrid
              title="Dokumen Accurate"
              columns={documentColumns}
              rows={data.documents.map((d) => ({ ...d, id: `${d.docType}-${d.docId}` }))}
              searchable={false}
              exportable={false}
              empty="Belum ada dokumen Accurate yang cocok dengan referensi ini."
              onRowClick={(d) => setDoc({ type: d.docType, id: d.docId, number: d.number })}
              rowActions={perm.canUnlink ? (d) => (d.link ? (
                <IconButton label="Lepas pasangan" icon="link_off" size="sm" onClick={() => setUndo({ kind: 'link', id: d.link.id })} />
              ) : null) : undefined}
            />
            {unknown.length ? (
              <DataGrid title="Baris yang belum bisa dibandingkan" columns={unknownColumns} rows={unknown} searchable={false} exportable={false} />
            ) : null}
            <div className="pw-text-helper">Accurate hanya dibaca. Selisih diperbaiki di sumbernya (dokumen Accurate atau pergerakan di aplikasi), dipasangkan manual, atau dijelaskan oleh Supervisor/Head yang tidak mencatatnya.</div>
          </div>
        ) : null}
      </SideSheet>
      {g ? <CandidatesDialog group={g} movements={data?.movements || []} open={pairOpen} onClose={() => setPairOpen(false)} onLinked={() => { setPairOpen(false); reload(); }} /> : null}
      <WarehouseReasonDialog
        open={explainOpen}
        title="Tandai sudah dijelaskan"
        description="Penjelasan tercatat atas nama Anda dan berlaku sampai datanya berubah."
        minLength={5}
        hint="Minimal 5 karakter; tercatat di riwayat."
        confirmLabel="Simpan penjelasan"
        onClose={() => setExplainOpen(false)}
        onConfirm={explain}
      />
      <WarehouseReasonDialog
        open={Boolean(undo)}
        title={undo?.kind === 'link' ? 'Lepas pasangan manual?' : 'Batalkan penjelasan?'}
        minLength={3}
        maxLength={255}
        hint="Minimal 3 karakter; tercatat di riwayat."
        confirmLabel={undo?.kind === 'link' ? 'Lepas pasangan' : 'Batalkan penjelasan'}
        cancelLabel="Kembali"
        onClose={() => setUndo(null)}
        onConfirm={runUndo}
      />
      <DocumentModal doc={doc} onClose={() => setDoc(null)} />
    </>
  );
}

export default function WarehouseRecon() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');
  const initialDirection = searchParams.get('direction');
  const [status, setStatus] = useState(isReconFilter(initialStatus) ? initialStatus : 'open');
  const [direction, setDirection] = useState(isDirection(initialDirection) ? initialDirection : '');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const group = searchParams.get('group');
  const [open, setOpen] = useState(group && isDirection(initialDirection) ? { direction: initialDirection, groupKey: group } : null);
  const list = useSalesList('/warehouse/recon', { status, direction, q, from, to });
  const { counts, readiness } = list.meta;
  const graceDays = readiness?.graceDays;
  const gridColumns = useMemo(() => columns(graceDays), [graceDays]);
  const waiting = waitingNotice(readiness, counts);

  // The open group lives in the URL (escalation links land on it) without leaving the tab.
  const show = (row) => {
    setOpen(row ? { direction: row.direction, groupKey: row.groupKey } : null);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('tab', 'recon');
      if (row) { next.set('direction', row.direction); next.set('group', row.groupKey); } else next.delete('group');
      return next;
    }, { replace: true });
  };

  return (
    <div className="pw-stack">
      {readinessNotices(readiness).map((n) => <Banner key={n.title} tone={n.tone} title={n.title}>{n.body}</Banner>)}
      {waiting ? <Banner tone={waiting.tone} title={waiting.title}>{waiting.body}</Banner> : null}
      <DataGrid
        key={`${status}-${direction}`}
        title="Cocokkan Accurate"
        showTitle={false}
        columns={gridColumns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        meta={list.meta}
        onPageChange={list.setPage}
        search={q}
        onSearchChange={setQ}
        searchPlaceholder="Referensi, nomor dokumen Accurate, pemasok/pelanggan"
        filters={(
          <>
            {RECON_FILTERS.map((f) => <Chip key={f.key} selected={status === f.key} onClick={() => setStatus(f.key)}>{reconChipLabel(f.key, counts)}</Chip>)}
            <Select
              label="Arah"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              options={DIRECTION_FILTERS.map((d) => ({ value: d.key, label: d.label }))}
              fieldClassName="wh-filter-select"
            />
            <DateInput label="Dari" value={from} onChange={(e) => setFrom(e.target.value)} fieldClassName="wh-filter-date" />
            <DateInput label="Sampai" value={to} onChange={(e) => setTo(e.target.value)} fieldClassName="wh-filter-date" />
          </>
        )}
        exportName={`pencocokan-accurate-${status}`}
        empty={status === 'open' ? 'Tidak ada selisih yang perlu dicek' : 'Tidak ada data'}
        onRowClick={show}
      />
      <div className="pw-text-helper">{reconFootnote(readiness)}</div>
      <ReconSheet target={open} graceDays={graceDays} onClose={() => show(null)} onChanged={list.reload || (() => list.setPage(list.meta.page || 1))} />
    </div>
  );
}
