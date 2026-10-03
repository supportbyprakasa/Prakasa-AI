import { useCallback, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import DateInput from '../../components/DateInput';
import EmptyState from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import PriorityBadge from '../../components/PriorityBadge';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import TabBar from '../../components/TabBar';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { statusLabel } from '../../components/statusTone';
import DataGrid from '../../components/datagrid/DataGrid';
import { useAuth } from '../../context/AuthContext';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import MovementList from './WarehouseMovements';
import WarehouseStock from './WarehouseStock';
import WarehouseToday from './WarehouseToday';
import WarehouseShipping from './WarehouseShipping';
import WarehouseAccurateDocs from './WarehouseAccurateDocs';
import WarehouseRecon from './WarehouseRecon';
import { AccurateBatchList } from '../sales/SalesAccurateBatch';
import { todayLocal } from './warehouseMovementModel';
import { dateOnly, dayText } from './warehouseStockModel';
import './warehouse-movements.css';
import { Translate } from '../../i18n/NoTranslate';

const TABS = [
  // From approved Accurate data: the day at a glance, first for whoever may see stock.
  { k: 'today', l: 'Hari ini', permission: 'warehouse.stock.view' },
  { k: 'shipping', l: 'Jadwal kirim', permission: 'warehouse.stock.view' },
  { k: 'inbound', l: 'Barang masuk', permission: 'warehouse.movement.view' },
  { k: 'outbound', l: 'Barang keluar', permission: 'warehouse.movement.view' },
  { k: 'stock', l: 'Stok', permission: 'warehouse.stock.view' },
  { k: 'documents', l: 'Dokumen Accurate', permission: 'warehouse.stock.view' },
  { k: 'recon', l: 'Cocokkan Accurate', permission: 'warehouse.recon.view' },
  { k: 'approval', l: 'Approval Supervisor', permission: 'warehouse.movement.approve' },
  { k: 'history', l: 'Riwayat transaksi', permission: 'warehouse.movement.view' },
  { k: 'checklist', l: 'Checklist', permission: 'warehouse.checklist.view' },
  { k: 'incidents', l: 'Insiden', permission: 'warehouse.incident.view' },
  // Warehouse batches are decided by the Warehouse Supervisor or Head.
  { k: 'accurate', l: 'Data Accurate', permission: ['accurate.batch.view', 'warehouse.accurate.sync'] },
];

const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;

export default function WarehouseDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = user?.permissions || [];
  const can = (code) => (Array.isArray(code) ? code.some((c) => permissions.includes(c)) : permissions.includes(code));
  const tabs = TABS.filter((entry) => can(entry.permission));
  const requested = searchParams.get('tab');
  const tab = tabs.some((entry) => entry.k === requested) ? requested : tabs[0]?.k;
  // A link to a tab this user may not open (e.g. from an escalation) says so.
  const denied = requested && !tabs.some((entry) => entry.k === requested) ? TABS.find((entry) => entry.k === requested) : null;
  // Which create dialog the header button opened (checklist, incidents).
  const [creating, setCreating] = useState('');
  const setTab = (next) => {
    setCreating('');
    setSearchParams({ tab: next }, { replace: true });
  };

  // The one "create" action of the open tab sits in the page header (§3.1).
  const headerAction = {
    inbound: can('warehouse.movement.create') ? <Button icon="add" to="/warehouse/movements/inbound/new">Buat barang masuk</Button> : null,
    outbound: can('warehouse.movement.create') ? <Button icon="add" to="/warehouse/movements/outbound/new">Buat barang keluar</Button> : null,
    checklist: can('warehouse.checklist.manage') ? <Button icon="add" onClick={() => setCreating('checklist')}>Buat checklist</Button> : null,
    incidents: can('warehouse.incident.manage') ? <Button icon="add" onClick={() => setCreating('incidents')}>Laporkan insiden</Button> : null,
  }[tab] || null;
  // /warehouse?tab=checklist&baru=1 and ?tab=incidents&baru=1 open the tab's
  // create dialog (a link, or Prakasa AI's buka_halaman). It only opens.
  useOpenFromUrl('baru', () => {
    if (tab === 'checklist' && can('warehouse.checklist.manage')) setCreating('checklist');
    else if (tab === 'incidents' && can('warehouse.incident.manage')) setCreating('incidents');
    // One state for both create dialogs: an unsaved one is never replaced by a link (keepUnsaved).
  }, { keepUnsaved: true });

  return (
    <Page>
      <PageHeader
        title="Warehouse"
        description="Barang masuk dan keluar, stok dan dokumen dari Accurate, checklist, serta insiden gudang. Hanya jumlah barang, tanpa harga."
        actions={headerAction}
      />
      {tabs.length ? <TabBar tabs={tabs} value={tab} onChange={setTab} label="Menu Warehouse" idPrefix="wh-tab" panelId="wh-tabpanel" /> : null}
      {denied ? (
        <Banner tone="warning" title={`Anda tidak punya akses ke tab ${denied.l}`}>Yang ditampilkan adalah tab lain yang boleh Anda buka.</Banner>
      ) : null}
      <div id="wh-tabpanel" role="tabpanel" aria-labelledby={tab ? `wh-tab-${tab}` : undefined}>
        {!tab && <EmptyState title="Belum ada akses" description="Anda belum memiliki akses ke menu Warehouse." />}
        {['inbound', 'outbound', 'approval', 'history'].includes(tab) && <MovementList key={tab} mode={tab} />}
        {tab === 'checklist' && (
          <ChecklistTab createOpen={creating === 'checklist'} onCreateClose={() => setCreating('')} canManage={can('warehouse.checklist.manage')} />
        )}
        {tab === 'incidents' && (
          <IncidentsTab
            canManage={can('warehouse.incident.manage')}
            createOpen={creating === 'incidents'}
            onCreateClose={() => setCreating('')}
          />
        )}
        {tab === 'today' && <WarehouseToday />}
        {tab === 'shipping' && <WarehouseShipping />}
        {tab === 'stock' && <WarehouseStock />}
        {tab === 'documents' && <WarehouseAccurateDocs />}
        {tab === 'recon' && <WarehouseRecon />}
        {tab === 'accurate' && (
          <AccurateBatchList
            detailBase="/data-accurate"
            division="warehouse"
            canPull={can('warehouse.accurate.sync')}
            syncEndpoint="/warehouse/accurate/sync"
            note="Stok dari Accurate baru dipakai di aplikasi setelah disetujui Supervisor atau Head Warehouse. Hanya jumlah barang — tanpa harga atau biaya."
          />
        )}
      </div>
    </Page>
  );
}

// A list loaded once from `path`, with the failure kept for the grid's retry.
function useWarehouseList(path, fallback) {
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await api.get(path);
      setState({ loading: false, error: '', rows: response.data.data || [] });
    } catch (error) {
      setState({ loading: false, error: errorMessage(error, fallback), rows: [] });
    }
  }, [path, fallback]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// A short form in a Modal (≤ 5 fields, §3.3): the <form> in the body, Batal and
// the submit button in the footer, tied to the form by its id.
function FormDialog({ open, title, submitLabel, busy, onClose, onSubmit, children }) {
  const formId = useId();
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="md"
      footer={(
        <>
          <Button type="button" variant="text" onClick={close} disabled={busy}>Batal</Button>
          <Button type="submit" form={formId} loading={busy}>{submitLabel}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={onSubmit} noValidate>{children}</form>
    </Modal>
  );
}

/* ============================ CHECKLIST ============================ */

function checklistItems(row) {
  if (Array.isArray(row.items)) return row.items;
  if (typeof row.items !== 'string') return [];
  try {
    const items = JSON.parse(row.items);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
const checklistProgress = (row) => {
  const items = checklistItems(row);
  return `${items.filter((item) => item.checked).length}/${items.length} selesai`;
};

const CHECKLIST_COLUMNS = [
  { key: 'checklistDate', header: 'Tanggal', render: (row) => dayText(row.checklistDate), exportValue: (row) => dateOnly(row.checklistDate) },
  { key: 'title', header: 'Judul' },
  { key: 'items', header: 'Item', translate: true, render: checklistProgress, exportValue: checklistProgress },
  {
    key: 'completed',
    header: 'Status',
    render: (row) => <StatusBadge status={row.completed ? 'completed' : 'pending'} label={row.completed ? 'Selesai' : 'Belum selesai'} />,
    exportValue: (row) => (row.completed ? 'Selesai' : 'Belum selesai'),
  },
];

function ChecklistTab({ createOpen, onCreateClose, canManage }) {
  const list = useWarehouseList('/warehouse/checklists', 'Checklist belum bisa dimuat.');
  const [completing, setCompleting] = useState(null);
  // Finishing a checklist ticks every item: the register records who did it
  // and when, which is what clears the "checklist terlewat" escalation.
  const complete = async (row) => {
    setCompleting(row.id);
    try {
      const items = (Array.isArray(row.items) ? row.items : []).map((item) => ({ ...item, checked: true }));
      await api.patch(`/warehouse/checklists/${row.id}/complete`, { items });
      toast('Checklist ditandai selesai', 'success');
      list.reload();
    } catch (err) {
      toast(errorMessage(err, 'Checklist gagal ditandai selesai'), 'error');
    } finally {
      setCompleting(null);
    }
  };
  return (
    <>
      <DataGrid
        title="Checklist"
        showTitle={false}
        exportName="checklist-gudang"
        columns={CHECKLIST_COLUMNS}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchPlaceholder="Cari judul checklist"
        empty="Belum ada checklist"
        rowActions={canManage ? (row) => (row.completed ? null : (
          <IconButton size="sm" icon="task_alt" label="Tandai selesai" disabled={completing === row.id} onClick={() => complete(row)} />
        )) : undefined}
      />
      <ChecklistDialog open={createOpen} onClose={onCreateClose} onCreated={list.reload} />
    </>
  );
}

const blankChecklist = () => ({ checklistDate: todayLocal(), title: '', items: '' });

// Prakasa AI may fill the checklist; the user reviews it and presses
// "Simpan checklist" (docs/prakasa-ai-rencana.md §9.9).
const AI_CHECKLIST = defineAIForm({
  id: 'warehouse-checklist',
  title: 'Buat checklist harian',
  permission: 'warehouse.checklist.manage',
  submitLabel: 'Simpan checklist',
  fields: [
    f.date('checklistDate', 'Tanggal', { required: true }),
    f.text('title', 'Judul', { required: true, maxLength: 190 }),
    f.textarea('items', 'Item', { maxLength: 4000, hint: 'Satu item per baris.' }),
  ],
});

function ChecklistDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState(blankChecklist);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setForm(blankChecklist()); setErrors({}); }
  }, [open]);
  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const ai = usePrakasaAIForm(AI_CHECKLIST, {
    enabled: open,
    values: form,
    setValues: setForm,
    setErrors,
    initialValues: blankChecklist(),
  });

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!form.checklistDate) next.checklistDate = 'Tanggal wajib diisi.';
    if (!form.title.trim()) next.title = 'Judul wajib diisi.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const labels = form.items.split('\n').map((line) => line.trim()).filter(Boolean);
    setBusy(true);
    try {
      await api.post('/warehouse/checklists', {
        checklistDate: form.checklistDate,
        title: form.title.trim(),
        items: labels.map((label) => ({ label, checked: false })),
      });
      toast('Checklist dibuat', 'success');
      onClose();
      onCreated();
    } catch (error) {
      toast(errorMessage(error, 'Checklist gagal dibuat'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} title="Buat checklist harian" submitLabel="Simpan checklist" busy={busy} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      <DateInput label="Tanggal" required value={form.checklistDate} error={errors.checklistDate} {...ai.field('checklistDate')} onChange={(event) => set('checklistDate', event.target.value)} />
      <Input label="Judul" required value={form.title} error={errors.title} placeholder="Checklist harian gudang" {...ai.field('title')} onChange={(event) => set('title', event.target.value)} />
      <Textarea
        label="Item"
        rows={6}
        value={form.items}
        hint="Satu item per baris."
        placeholder={'Sapu lantai\nCek suhu ruangan\nCek stok barang'}
        {...ai.field('items')}
        onChange={(event) => set('items', event.target.value)}
      />
    </FormDialog>
  );
}

/* ============================ INCIDENTS ============================ */

// The category is free text, stored exactly as typed (owner's data keeps its
// meaning); the old English codes read in Indonesian.
const CATEGORY_LABEL = { damage: 'Kerusakan', lost: 'Kehilangan', delay: 'Keterlambatan' };
const categoryText = (category) => CATEGORY_LABEL[String(category || '').toLowerCase()] || category;
const SEVERITIES = [
  { value: 'low', label: 'Rendah' },
  { value: 'medium', label: 'Sedang' },
  { value: 'high', label: 'Tinggi' },
  { value: 'critical', label: 'Kritis' },
];
const RESOLVE_STATUSES = [
  { value: 'investigating', label: 'Diselidiki' },
  { value: 'resolved', label: 'Selesai' },
  { value: 'closed', label: 'Ditutup' },
];
const shortText = (text) => {
  const value = text || '';
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
};

const INCIDENT_COLUMNS = [
  { key: 'id', header: 'Nomor', render: (row) => `#${row.id}`, exportValue: (row) => row.id },
  { key: 'incidentDate', header: 'Tanggal', render: (row) => dayText(row.incidentDate), exportValue: (row) => dateOnly(row.incidentDate) },
  { key: 'category', header: 'Kategori', render: (row) => (categoryText(row.category) === row.category ? row.category : <Translate>{categoryText(row.category)}</Translate>), exportValue: (row) => categoryText(row.category) },
  { key: 'severity', header: 'Tingkat', render: (row) => <PriorityBadge priority={row.severity} />, exportValue: (row) => SEVERITIES.find((s) => s.value === row.severity)?.label || row.severity },
  { key: 'description', header: 'Deskripsi', render: (row) => shortText(row.description), exportValue: (row) => row.description },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} />, exportValue: (row) => statusLabel(row.status) },
];

function IncidentsTab({ canManage, createOpen, onCreateClose }) {
  const list = useWarehouseList('/warehouse/incidents', 'Insiden belum bisa dimuat.');
  const [resolving, setResolving] = useState(null);
  return (
    <>
      <DataGrid
        title="Insiden"
        showTitle={false}
        exportName="insiden-gudang"
        columns={INCIDENT_COLUMNS}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        searchPlaceholder="Cari kategori atau deskripsi"
        empty="Belum ada insiden"
        rowActions={canManage ? (row) => (['resolved', 'closed'].includes(row.status) ? null : (
          <IconButton label="Selesaikan insiden" icon="task_alt" size="sm" onClick={() => setResolving(row)} />
        )) : undefined}
      />
      <IncidentDialog open={createOpen} onClose={onCreateClose} onCreated={list.reload} />
      <ResolveDialog incident={resolving} onClose={() => setResolving(null)} onResolved={list.reload} />
    </>
  );
}

const blankIncident = () => ({ incidentDate: todayLocal(), category: '', severity: 'low', description: '' });

// Prakasa AI may fill the incident report; the user reviews it and presses
// "Laporkan insiden". Closing an incident (ResolveDialog) is a decision: not registered.
const AI_INCIDENT = defineAIForm({
  id: 'warehouse-incident',
  title: 'Laporkan insiden',
  permission: 'warehouse.incident.manage',
  submitLabel: 'Laporkan insiden',
  fields: [
    f.date('incidentDate', 'Tanggal', { required: true }),
    f.text('category', 'Kategori', { required: true, maxLength: 80, hint: 'Mis. kerusakan, kehilangan, keterlambatan' }),
    f.select('severity', 'Tingkat', SEVERITIES),
    f.textarea('description', 'Deskripsi', { required: true, maxLength: 4000 }),
  ],
});

function IncidentDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState(blankIncident);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setForm(blankIncident()); setErrors({}); }
  }, [open]);
  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const ai = usePrakasaAIForm(AI_INCIDENT, {
    enabled: open,
    values: form,
    setValues: setForm,
    setErrors,
    initialValues: blankIncident(),
  });

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!form.incidentDate) next.incidentDate = 'Tanggal wajib diisi.';
    if (!form.category) next.category = 'Kategori wajib diisi.';
    if (!form.description.trim()) next.description = 'Deskripsi wajib diisi.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api.post('/warehouse/incidents', {
        incidentDate: form.incidentDate,
        category: form.category,
        severity: form.severity,
        description: form.description.trim(),
      });
      toast('Insiden dilaporkan', 'success');
      onClose();
      onCreated();
    } catch (error) {
      toast(errorMessage(error, 'Insiden gagal dilaporkan'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} title="Laporkan insiden" submitLabel="Laporkan insiden" busy={busy} onClose={onClose} onSubmit={submit}>
      {ai.notice}
      <div className="pw-form-grid">
        <DateInput label="Tanggal" required value={form.incidentDate} error={errors.incidentDate} {...ai.field('incidentDate')} onChange={(event) => set('incidentDate', event.target.value)} />
        <Input label="Kategori" required value={form.category} error={errors.category} hint="Mis. kerusakan, kehilangan, keterlambatan" {...ai.field('category')} onChange={(event) => set('category', event.target.value)} />
        <Select label="Tingkat" value={form.severity} options={SEVERITIES} {...ai.field('severity')} onChange={(event) => set('severity', event.target.value)} />
      </div>
      <Textarea label="Deskripsi" required rows={4} value={form.description} error={errors.description} {...ai.field('description')} onChange={(event) => set('description', event.target.value)} />
    </FormDialog>
  );
}

function ResolveDialog({ incident, onClose, onResolved }) {
  // "Selesaikan insiden" means resolve: the dialog starts on Selesai, so
  // saving without touching the status closes the incident.
  const [status, setStatus] = useState('resolved');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (incident) { setStatus('resolved'); setResolution(''); setError(''); }
  }, [incident]);

  const submit = async (event) => {
    event.preventDefault();
    if (!resolution.trim()) { setError('Resolusi wajib diisi.'); return; }
    setBusy(true);
    try {
      await api.patch(`/warehouse/incidents/${incident.id}/resolve`, { status, resolution: resolution.trim() });
      toast('Insiden diperbarui', 'success');
      onClose();
      onResolved();
    } catch (err) {
      toast(errorMessage(err, 'Insiden gagal diperbarui'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={Boolean(incident)}
      title={`Selesaikan insiden #${incident?.id || ''}`}
      submitLabel="Simpan resolusi"
      busy={busy}
      onClose={onClose}
      onSubmit={submit}
    >
      <Select label="Status" value={status} options={RESOLVE_STATUSES} onChange={(event) => setStatus(event.target.value)} />
      <Textarea
        label="Resolusi"
        required
        rows={4}
        value={resolution}
        error={error}
        onChange={(event) => { setResolution(event.target.value); setError(''); }}
      />
    </FormDialog>
  );
}
