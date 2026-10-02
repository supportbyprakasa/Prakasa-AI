import { useCallback, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Chip from '../../components/Chip';
import ConfirmDialog from '../../components/ConfirmDialog';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Page from '../../components/Page';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { formatDateTime } from '../../components/format';
import { useAuth } from '../../context/AuthContext';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import {
  OWNER_GROUP_LABELS, REQUIRES_LABELS, WORKFLOW_TYPE_LABELS, apiErrorMessage, choiceLabel, emptyTemplateItem, offsetLabel, optionsFrom,
  searchChoices, templateAiErrors, templateCategoryOptions, templateErrors, templateItemCount, templateItemValues, templateItemsBody, userChoices,
} from './hrgaModel';
import useHrgaLookups from './useHrgaLookups';
import './hrga-workflow.css';

const TYPES = ['onboarding', 'offboarding'];
const TYPE_OPTIONS = TYPES.map((value) => ({ value, label: WORKFLOW_TYPE_LABELS[value] }));
const MAX_TEMPLATE_ITEMS = 50;

// What Prakasa AI may fill on this page (docs/prakasa-ai-rencana.md §9.9).
// PIC: a candidate of the list the Select shows (GET /people/settings/pic).
// Template: its name and its items as rows; items the user typed stay as they
// are. Turning a template on or off is the user's.
const AI_PIC = defineAIForm({
  id: 'hr-checklist-pic',
  title: 'Penanggung jawab checklist',
  permission: 'hrga.checklist_template.manage',
  submitLabel: 'Simpan penanggung jawab',
  mode: 'edit',
  fields: ({ it, ga }) => [
    f.person('itUserId', 'PIC IT', (text) => searchChoices(it, text), { labelOf: (value) => choiceLabel(it, value), hint: 'Perlu izin serah terima perangkat.' }),
    f.person('gaUserId', 'PIC GA', (text) => searchChoices(ga, text), { labelOf: (value) => choiceLabel(ga, value), hint: 'Perlu izin memproses layanan GA.' }),
  ],
});
const aiTemplateFields = ({ editing, onboarding, departments, categories, getRows, setRows }) => [
  editing
    ? f.readOnly('workflowType', 'Jenis', 'select', { options: TYPE_OPTIONS })
    : f.select('workflowType', 'Jenis', TYPE_OPTIONS, { required: true, hint: 'Isi jenis lebih dulu: pilihan kategori item mengikuti jenis.' }),
  editing
    ? f.readOnly('departmentId', 'Divisi', 'select', { options: departments })
    : f.select('departmentId', 'Divisi', departments, { hint: 'Kosong berarti semua divisi.' }),
  f.text('name', 'Nama', { required: true, maxLength: 120 }),
  f.rows('items', 'Item checklist', [
    f.select('ownerGroup', 'Tim', optionsFrom(OWNER_GROUP_LABELS)),
    f.select('category', 'Kategori', categories),
    f.text('title', 'Judul', { required: true, maxLength: 200 }),
    f.number('offsetDays', 'Hari relatif', { min: -30, max: 30, step: 1, hint: onboarding ? 'Dihitung dari tanggal mulai.' : 'Dihitung dari hari terakhir.' }),
    ...(onboarding ? [f.select('requires', 'Hanya bila', optionsFrom(REQUIRES_LABELS))] : []),
  ], { required: true, maxRows: MAX_TEMPLATE_ITEMS, emptyRow: emptyTemplateItem, getRows, setRows }),
];
const EDITOR_FORMS = ['hr-checklist-template', 'hr-checklist-template-edit'];
const AI_TEMPLATE = defineAIForm({
  id: 'hr-checklist-template',
  title: 'Template checklist',
  permission: 'hrga.checklist_template.manage',
  submitLabel: 'Simpan template',
  fields: aiTemplateFields,
});
const AI_TEMPLATE_EDIT = defineAIForm({
  id: 'hr-checklist-template-edit',
  title: 'Ubah template checklist',
  permission: 'hrga.checklist_template.manage',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: aiTemplateFields,
});

// IT and GA PIC (GET/PUT /people/settings/pic): the people IT and GA tasks
// go to. Candidates already hold the needed permission.
function PicCard() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [values, setValues] = useState({ itUserId: '', gaUserId: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get('/people/settings/pic');
      const data = r.data.data || {};
      setState({ loading: false, error: '', data });
      setValues({ itUserId: data.itUserId ? String(data.itUserId) : '', gaUserId: data.gaUserId ? String(data.gaUserId) : '' });
    } catch (error) {
      setState({ loading: false, error: apiErrorMessage(error, 'Penanggung jawab gagal dimuat.'), data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const r = await api.put('/people/settings/pic', { itUserId: values.itUserId ? Number(values.itUserId) : null, gaUserId: values.gaUserId ? Number(values.gaUserId) : null });
      setState((s) => ({ ...s, data: { ...(s.data || {}), ...(r.data.data || {}) } }));
      toast('Penanggung jawab disimpan', 'success');
    } catch (error) {
      const data = error?.response?.data?.error || {};
      if (data.code === 'PIC_PERMISSION') {
        const field = data.details?.field === 'gaUserId' ? 'gaUserId' : (data.details?.field === 'itUserId' ? 'itUserId' : null);
        if (field) setErrors({ [field]: data.message }); else toast(data.message, 'error');
      } else toast(apiErrorMessage(error, 'Penanggung jawab gagal disimpan.'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const candidates = state.data?.candidates || { it: [], ga: [] };
  const opts = (list) => (list || []).map((u) => ({ value: String(u.id), label: u.name }));
  const ai = usePrakasaAIForm(AI_PIC, {
    enabled: !state.loading && !state.error && Boolean(state.data),
    record: { type: 'hrga_pic_setting', id: 'pic' },
    values,
    setValues,
    setErrors,
    initialValues: { itUserId: state.data?.itUserId ? String(state.data.itUserId) : '', gaUserId: state.data?.gaUserId ? String(state.data.gaUserId) : '' },
    context: { it: userChoices(candidates.it), ga: userChoices(candidates.ga) },
  });
  return (
    <Card title="Penanggung jawab" size="sm" subtitle="Tugas IT dan GA di checklist otomatis ditugaskan ke orang ini. Hanya akun yang punya izin yang sesuai yang bisa dipilih.">
      {state.error ? (
        <Banner tone="error" action={<Button variant="text" onClick={load}>Coba lagi</Button>}>{state.error}</Banner>
      ) : (
        <>
        {ai.notice}
        <form className="hrga-pic" onSubmit={save}>
          <Select
            label="PIC IT"
            fieldClassName="hrga-pic__field"
            placeholder={state.loading ? 'Memuat daftar' : 'Belum ditetapkan'}
            disabled={state.loading}
            options={opts(candidates.it)}
            dataOptions
            value={values.itUserId}
            {...ai.field('itUserId')}
            error={errors.itUserId}
            hint={errors.itUserId ? undefined : 'Perlu izin serah terima perangkat.'}
            onChange={(event) => { setValues((v) => ({ ...v, itUserId: event.target.value })); setErrors({}); }}
          />
          <Select
            label="PIC GA"
            fieldClassName="hrga-pic__field"
            placeholder={state.loading ? 'Memuat daftar' : 'Belum ditetapkan'}
            disabled={state.loading}
            options={opts(candidates.ga)}
            dataOptions
            value={values.gaUserId}
            {...ai.field('gaUserId')}
            error={errors.gaUserId}
            hint={errors.gaUserId ? undefined : 'Perlu izin memproses layanan GA.'}
            onChange={(event) => { setValues((v) => ({ ...v, gaUserId: event.target.value })); setErrors({}); }}
          />
          <span className="hrga-pic__save"><Button type="submit" variant="secondary" loading={saving} disabled={state.loading}>Simpan penanggung jawab</Button></span>
        </form>
        </>
      )}
    </Card>
  );
}

// Create / edit a template: rows Tim, Kategori, Judul, Hari relatif, Hanya bila.
function TemplateEditor({ open, template, type, builtIn, departments, departmentsLoading = false, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(template);
  const [workflowType, setWorkflowType] = useState(type);
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState(null);
  const [formError, setFormError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorkflowType(template?.workflowType || type);
    setDepartmentId(template?.departmentId ? String(template.departmentId) : '');
    setName(template?.name || '');
    setRows(Array.isArray(template?.items) ? template.items.map(templateItemValues) : []);
    setErrors(null); setFormError(''); setDirty(false);
  }, [open, template, type]);

  const touch = () => { setDirty(true); setErrors(null); };
  const setRow = (index, field, value) => { setRows((list) => list.map((row, i) => (i === index ? { ...row, [field]: value } : row))); touch(); };
  const move = (index, delta) => {
    setRows((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    touch();
  };
  const remove = (index) => { setRows((list) => list.filter((_, i) => i !== index)); touch(); };
  const fromBuiltIn = () => { setRows((builtIn?.[workflowType] || []).map(templateItemValues)); setReplaceOpen(false); touch(); };

  const submit = async (event) => {
    event.preventDefault();
    const found = templateErrors({ name, rows, workflowType });
    setErrors(found);
    if (found) return;
    setSaving(true);
    setFormError('');
    try {
      const items = templateItemsBody(rows, workflowType);
      if (editing) await api.patch(`/hrga/checklist-templates/${template.id}`, { name: name.trim(), items });
      else await api.post('/hrga/checklist-templates', { workflowType, departmentId: departmentId ? Number(departmentId) : null, name: name.trim(), items });
      toast(editing ? 'Template diperbarui' : 'Template dibuat', 'success');
      await onSaved?.(workflowType);
    } catch (error) {
      setFormError(apiErrorMessage(error, 'Template gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  const categories = templateCategoryOptions(workflowType);
  const onboarding = workflowType === 'onboarding';
  const departmentOptions = (departments || []).map((d) => ({ value: String(d.id), label: d.name }));
  const ai = usePrakasaAIForm(editing ? AI_TEMPLATE_EDIT : AI_TEMPLATE, {
    enabled: open,
    ready: !departmentsLoading,
    record: { type: 'hrga_checklist_template', id: template?.id },
    values: { workflowType, departmentId, name },
    setters: { workflowType: setWorkflowType, departmentId: setDepartmentId, name: setName },
    onFill: touch,
    validate: (next) => templateAiErrors({ name: next.name, rows: next.items, workflowType: next.workflowType }),
    initialValues: {
      workflowType: template?.workflowType || type,
      departmentId: template?.departmentId ? String(template.departmentId) : '',
      name: template?.name || '',
      items: Array.isArray(template?.items) ? template.items.map(templateItemValues) : [],
    },
    context: {
      editing, onboarding, categories, departments: departmentOptions,
      getRows: () => rows,
      setRows: (next) => { setRows(next); touch(); },
    },
  });
  return (
    <FullScreenDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Ubah ${template.name}` : 'Buat template checklist'}
      card={false}
      actions={(
        <>
          <Button variant="text" type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Simpan template'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack pw-stack--lg" onSubmit={submit} noValidate>
        {ai.notice}
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        <FullScreenSection title="Template">
          <div className="pw-fsdialog__fields">
            <Select
              label="Jenis"
              required
              disabled={editing}
              value={workflowType}
              {...ai.field('workflowType')}
              options={TYPE_OPTIONS}
              onChange={(event) => { setWorkflowType(event.target.value); touch(); }}
            />
            <Select
              label="Divisi"
              disabled={editing}
              placeholder="Semua divisi"
              value={departmentId}
              {...ai.field('departmentId')}
              options={departmentOptions}
              onChange={(event) => { setDepartmentId(event.target.value); touch(); }}
              hint="Template divisi dipakai lebih dulu daripada template semua divisi."
            />
            <Input label="Nama" required maxLength={120} value={name} {...ai.field('name')} error={errors?.name} onChange={(event) => { setName(event.target.value); touch(); }} />
          </div>
        </FullScreenSection>
        <FullScreenSection title={`Item checklist (${rows.length})`}>
          {errors?.form ? <Banner tone="error">{errors.form}</Banner> : null}
          <p className="hrga-form-note">
            {onboarding
              ? 'Hari relatif dihitung dari tanggal mulai. Pengembalian perangkat, nomor, dan lisensi dibuat otomatis dari kepemilikan, jadi tidak ada di template.'
              : 'Hari relatif dihitung dari hari terakhir. Pengembalian perangkat, nomor, dan lisensi dibuat otomatis dari kepemilikan, jadi tidak ada di template.'}
          </p>
          <ol className="hrga-items">
            {rows.map((row, index) => {
              const e = errors?.rows?.[index] || {};
              return (
                <li key={index} className={ai.rowClass('items', index, onboarding ? 'hrga-item' : 'hrga-item hrga-item--off')}>
                  <Select label="Tim" value={row.ownerGroup} error={e.ownerGroup} options={optionsFrom(OWNER_GROUP_LABELS)} onChange={(event) => setRow(index, 'ownerGroup', event.target.value)} />
                  <Select
                    label="Kategori"
                    value={row.category}
                    error={e.category}
                    options={categories.some((c) => c.value === row.category) ? categories : [...categories, { value: row.category, label: row.category, disabled: true }]}
                    onChange={(event) => setRow(index, 'category', event.target.value)}
                  />
                  <Input label="Judul" required maxLength={200} value={row.title} {...ai.row('items', index)} error={e.title} onChange={(event) => setRow(index, 'title', event.target.value)} />
                  <Input
                    label="Hari relatif"
                    type="number"
                    inputMode="numeric"
                    min={-30}
                    max={30}
                    value={row.offsetDays}
                    error={e.offsetDays}
                    hint={e.offsetDays ? undefined : offsetLabel(row.offsetDays, workflowType)}
                    onChange={(event) => setRow(index, 'offsetDays', event.target.value)}
                  />
                  {onboarding ? (
                    <Select label="Hanya bila" placeholder="Selalu" value={row.requires} options={optionsFrom(REQUIRES_LABELS)} onChange={(event) => setRow(index, 'requires', event.target.value)} />
                  ) : null}
                  <span className="hrga-item__actions">
                    <IconButton size="sm" icon="arrow_upward" label={`Naikkan item ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)} />
                    <IconButton size="sm" icon="arrow_downward" label={`Turunkan item ${index + 1}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)} />
                    <IconButton size="sm" icon="delete" label={`Hapus item ${index + 1}`} onClick={() => remove(index)} />
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="hrga-items-toolbar">
            <Button variant="secondary" type="button" icon="add" onClick={() => { setRows((list) => [...list, emptyTemplateItem()]); touch(); }}>Tambah item</Button>
            <Button
              variant="text"
              type="button"
              icon="restart_alt"
              disabled={!(builtIn?.[workflowType] || []).length}
              onClick={() => (rows.length ? setReplaceOpen(true) : fromBuiltIn())}
            >
              Mulai dari bawaan
            </Button>
          </div>
        </FullScreenSection>
      </form>
      <ConfirmDialog
        open={replaceOpen}
        tone="primary"
        title="Ganti dengan daftar bawaan?"
        message={`${rows.length} item yang ada diganti dengan daftar bawaan ${WORKFLOW_TYPE_LABELS[workflowType].toLowerCase()}.`}
        confirmLabel="Ganti item"
        onClose={() => setReplaceOpen(false)}
        onConfirm={fromBuiltIn}
      />
    </FullScreenDialog>
  );
}

// Template checklist (spec §2.1.6): templates per type + division, active or
// not (never deleted), the editor, and the IT/GA PIC card.
export default function ChecklistTemplates() {
  const { user } = useAuth();
  const canManage = (user?.permissions || []).includes('hrga.checklist_template.manage');
  const [params, setParams] = useSearchParams();
  const type = params.get('type') === 'offboarding' ? 'offboarding' : 'onboarding';
  const [rows, setRows] = useState([]);
  const [builtIn, setBuiltIn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState(undefined); // undefined closed, null new, object edit
  const lookups = useHrgaLookups(editor !== undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get('/hrga/checklist-templates', { params: { workflowType: type } });
      setRows(r.data.data || []);
      setBuiltIn(r.data.meta?.builtIn || null);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [type]);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (row) => {
    try {
      await api.patch(`/hrga/checklist-templates/${row.id}`, { isActive: !row.isActive });
      toast(row.isActive ? 'Template dinonaktifkan' : 'Template diaktifkan', 'success');
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Status template gagal diubah.'), 'error');
    }
  };

  // /hrga/checklist-templates?baru=1 opens the editor; ?ubah=<id> a template of the list shown.
  // One editor for add and change. The PIC form lives in the page itself, so only the editor's own forms count (keepUnsaved).
  useOpenFromUrl('baru', () => setEditor(null), { enabled: canManage, keepUnsaved: EDITOR_FORMS });
  useOpenFromUrl('ubah', (value) => {
    const row = rows.find((item) => String(item.id) === String(value));
    if (row) setEditor(row);
  }, { enabled: canManage && !loading, keepUnsaved: EDITOR_FORMS });

  const filterBar = TYPES.map((value) => (
    <Chip key={value} selected={type === value} onClick={() => setParams(value === 'onboarding' ? {} : { type: value }, { replace: true })}>{WORKFLOW_TYPE_LABELS[value]}</Chip>
  ));
  const columns = [
    { key: 'name', header: 'Nama' },
    { key: 'departmentName', header: 'Divisi', translate: true, render: (r) => r.departmentName || 'Semua divisi', exportValue: (r) => r.departmentName || 'Semua divisi' },
    { key: 'items', header: 'Item', align: 'end', render: (r) => templateItemCount(r.items), sortValue: (r) => templateItemCount(r.items), exportValue: (r) => templateItemCount(r.items) },
    {
      key: 'isActive', header: 'Status', nowrap: true,
      render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} label={r.isActive ? 'Aktif' : 'Nonaktif'} />,
      exportValue: (r) => (r.isActive ? 'Aktif' : 'Nonaktif'),
    },
    {
      key: 'updatedAt', header: 'Diperbarui',
      render: (r) => (
        <span className="pw-cell">
          <span>{formatDateTime(r.updatedAt)}</span>
          {r.updatedByName ? <span data-no-translate="" className="pw-cell__meta">{r.updatedByName}</span> : null}
        </span>
      ),
      exportValue: (r) => r.updatedAt || '',
    },
  ];

  return (
    <Page
      title="Template checklist"
      description="Daftar tugas onboarding dan offboarding per divisi. Tanpa template aktif, checklist memakai daftar bawaan."
      actions={canManage ? <Button icon="add" onClick={() => setEditor(null)}>Buat template</Button> : null}
    >
      {canManage ? <PicCard /> : null}
      <DataGrid
        title="Template checklist"
        showTitle={false}
        exportName={`template-${type}`}
        rows={rows}
        loading={loading}
        error={loadError}
        onRetry={load}
        filters={filterBar}
        searchPlaceholder="Cari template"
        empty={`Belum ada template ${type}. Checklist memakai daftar bawaan.`}
        onRowClick={canManage ? (r) => setEditor(r) : undefined}
        rowActions={canManage ? (r) => (
          <ActionMenu
            size="sm"
            label={`Aksi ${r.name}`}
            items={[
              { label: 'Ubah', icon: 'edit', onClick: () => setEditor(r) },
              { label: r.isActive ? 'Nonaktifkan' : 'Aktifkan', icon: r.isActive ? 'toggle_off' : 'toggle_on', onClick: () => toggleActive(r) },
            ]}
          />
        ) : undefined}
        columns={columns}
      />
      {canManage ? (
        <TemplateEditor
          open={editor !== undefined}
          template={editor || null}
          type={type}
          builtIn={builtIn}
          departments={lookups.departments}
          departmentsLoading={lookups.loading}
          onClose={() => setEditor(undefined)}
          onSaved={async (savedType) => {
            setEditor(undefined);
            if (savedType !== type) setParams(savedType === 'onboarding' ? {} : { type: savedType }, { replace: true });
            else await load();
          }}
        />
      ) : null}
    </Page>
  );
}
