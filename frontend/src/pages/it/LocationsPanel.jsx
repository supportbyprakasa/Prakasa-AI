import { useEffect, useId, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Chip from '../../components/Chip';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import Switch from '../../components/Switch';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import DataGrid from '../../components/datagrid/DataGrid';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import { LOCATION_KIND_LABELS, labelFor, optionsFrom } from './itModel';
import { useLocations } from './useLookups';

const errorOf = (error) => error?.response?.data?.error || {};

// Prakasa AI may fill a location's name, kind and note; switching a location
// off ("Aktif") stays with the user (docs/prakasa-ai-rencana.md §9.9).
const LOCATION_KINDS = optionsFrom(LOCATION_KIND_LABELS);
const AI_LOCATION = defineAIForm({
  id: 'it-location',
  title: 'Tambah lokasi',
  permission: 'device.manage',
  submitLabel: 'Tambah lokasi',
  fields: [
    f.text('name', 'Nama lokasi', { required: true, maxLength: 120, hint: 'Contoh: PFN Office, Alsut Office.' }),
    f.select('kind', 'Jenis', LOCATION_KINDS),
    f.textarea('notes', 'Catatan', { maxLength: 255 }),
  ],
});
const AI_LOCATION_EDIT = defineAIForm({
  id: 'it-location-edit',
  title: 'Ubah lokasi',
  permission: 'device.manage',
  submitLabel: 'Simpan perubahan',
  mode: 'edit',
  fields: [
    f.text('name', 'Nama lokasi', { required: true, maxLength: 120 }),
    f.select('kind', 'Jenis', LOCATION_KINDS),
    f.textarea('notes', 'Catatan', { maxLength: 255 }),
    f.userOnly('isActive', 'Aktif', 'checkbox'),
  ],
});

// Add / edit a location (≤5 fields → Modal). Locations are never deleted:
// "Aktif" off deactivates one.
export function LocationDialog({ open, location, onClose, onSaved }) {
  const formId = useId();
  const editing = Boolean(location);
  const [values, setValues] = useState({ name: '', kind: 'office', notes: '', isActive: true });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues({ name: location?.name || '', kind: location?.kind || 'office', notes: location?.notes || '', isActive: location ? location.isActive !== false : true });
    setErrors({}); setFormError('');
  }, [open, location]);
  const aiBindings = {
    values,
    setValues,
    setErrors,
    initialValues: { name: location?.name || '', kind: location?.kind || 'office', notes: location?.notes || '', isActive: location ? location.isActive !== false : true },
  };
  const aiCreate = usePrakasaAIForm(AI_LOCATION, {
    ...aiBindings,
    enabled: open && !editing,
  });
  const aiEdit = usePrakasaAIForm(AI_LOCATION_EDIT, {
    ...aiBindings,
    enabled: open && editing,
    record: { type: 'it_location', id: location?.id },
  });
  const ai = editing ? aiEdit : aiCreate;

  const submit = async (event) => {
    event.preventDefault();
    const name = values.name.trim();
    if (!name) { setErrors({ name: 'Nama lokasi wajib diisi.' }); return; }
    if (name.length > 120) { setErrors({ name: 'Nama lokasi maksimal 120 karakter.' }); return; }
    if (values.notes.trim().length > 255) { setErrors({ notes: 'Catatan maksimal 255 karakter.' }); return; }
    const body = { name, kind: values.kind, notes: values.notes.trim() || null };
    if (editing) {
      for (const key of Object.keys(body)) if (body[key] === (location[key] ?? null)) delete body[key];
      if (values.isActive !== (location.isActive !== false)) body.isActive = values.isActive;
      if (!Object.keys(body).length) { onClose(); return; }
    }
    setSaving(true);
    setFormError('');
    try {
      if (editing) await api.patch(`/it/locations/${location.id}`, body);
      else await api.post('/it/locations', body);
      toast(editing ? 'Lokasi diperbarui' : 'Lokasi ditambahkan', 'success');
      await onSaved?.();
    } catch (error) {
      const { code, message } = errorOf(error);
      if (code === 'LOCATION_EXISTS') setErrors({ name: message });
      else setFormError(message || 'Lokasi gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={editing ? 'Ubah lokasi' : 'Tambah lokasi'}
      size="sm"
      footer={(
        <>
          <Button variant="text" type="button" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" form={formId} loading={saving}>{editing ? 'Simpan perubahan' : 'Tambah lokasi'}</Button>
        </>
      )}
    >
      <form id={formId} className="pw-stack" onSubmit={submit} noValidate>
        {formError ? <Banner tone="error">{formError}</Banner> : null}
        {ai.notice}
        <Input label="Nama lokasi" required value={values.name} error={errors.name} maxLength={120} hint="Contoh: PFN Office, Alsut Office." {...ai.field('name')} onChange={(e) => { setValues({ ...values, name: e.target.value }); setErrors({}); }} />
        <Select label="Jenis" value={values.kind} options={LOCATION_KINDS} {...ai.field('kind')} onChange={(e) => setValues({ ...values, kind: e.target.value })} />
        <Textarea label="Catatan" rows={2} value={values.notes} error={errors.notes} maxLength={255} {...ai.field('notes')} onChange={(e) => { setValues({ ...values, notes: e.target.value }); setErrors({}); }} />
        {editing ? <Switch label="Aktif" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} /> : null}
      </form>
    </Modal>
  );
}

// The "Lokasi" tab of Perangkat: every location of the company with how many
// devices and people sit there.
export default function LocationsPanel({ canManage, createOpen, onCreateClose }) {
  const [showInactive, setShowInactive] = useState(false);
  const locations = useLocations(true, showInactive);
  const [editing, setEditing] = useState(null);
  const [toggling, setToggling] = useState(null);
  // ?tab=lokasi&ubah=<id> opens "Ubah lokasi" once the list has loaded.
  useOpenFromUrl('ubah', (id) => {
    const target = locations.rows.find((row) => String(row.id) === String(id));
    if (target && canManage) setEditing(target);
  }, { enabled: !locations.loading && locations.rows.length > 0, keepUnsaved: true });

  const toggleActive = async (row) => {
    setToggling(row.id);
    try {
      await api.patch(`/it/locations/${row.id}`, { isActive: row.isActive === false });
      toast(row.isActive === false ? 'Lokasi diaktifkan lagi' : 'Lokasi dinonaktifkan', 'success');
      await locations.reload();
    } catch (error) {
      toast(errorOf(error).message || 'Lokasi gagal diubah.', 'error');
    } finally {
      setToggling(null);
    }
  };

  return (
    <>
      <DataGrid
        title="Lokasi"
        exportName="lokasi-perusahaan"
        rows={locations.rows}
        loading={locations.loading}
        error={locations.error}
        onRetry={locations.reload}
        empty="Belum ada lokasi. Tambahkan lokasi kantor, toko, atau gudang perusahaan."
        filters={(
          <Chip selected={showInactive} onClick={() => setShowInactive((v) => !v)}>Tampilkan yang nonaktif</Chip>
        )}
        rowActions={canManage ? (row) => (
          <>
            <IconButton size="sm" icon="edit" label={`Ubah ${row.name}`} onClick={() => setEditing(row)} />
            <IconButton
              size="sm"
              icon={row.isActive === false ? 'check_circle' : 'block'}
              label={row.isActive === false ? 'Aktifkan lagi' : 'Nonaktifkan'}
              disabled={toggling === row.id}
              onClick={() => toggleActive(row)}
            />
          </>
        ) : undefined}
        columns={[
          { key: 'name', header: 'Nama' },
          { key: 'kind', header: 'Jenis', translate: true, render: (r) => labelFor(LOCATION_KIND_LABELS, r.kind), exportValue: (r) => labelFor(LOCATION_KIND_LABELS, r.kind) },
          { key: 'deviceCount', header: 'Perangkat', type: 'number' },
          { key: 'peopleCount', header: 'Orang', type: 'number' },
          {
            key: 'isActive', header: 'Status',
            render: (r) => <StatusBadge status={r.isActive === false ? 'inactive' : 'active'} label={r.isActive === false ? 'Nonaktif' : 'Aktif'} />,
            exportValue: (r) => (r.isActive === false ? 'Nonaktif' : 'Aktif'),
          },
          { key: 'notes', header: 'Catatan' },
        ]}
      />
      <LocationDialog
        open={Boolean(createOpen) || Boolean(editing)}
        location={editing}
        onClose={() => { setEditing(null); onCreateClose?.(); }}
        onSaved={async () => { setEditing(null); onCreateClose?.(); await locations.reload(); }}
      />
    </>
  );
}
