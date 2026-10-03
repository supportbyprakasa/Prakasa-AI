import { useCallback, useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import DateInput from '../../components/DateInput';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FormActions from '../../components/FormActions';
import FullScreenDialog from '../../components/FullScreenDialog';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import { Translate, Mixed, data } from '../../i18n/NoTranslate';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PriorityBadge from '../../components/PriorityBadge';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import Textarea from '../../components/Textarea';
import { toast } from '../../components/Toast';
import { EMPTY, formatDate, formatDateTime } from '../../components/format';
import { PRIORITY_LABELS } from '../../components/statusTone';
import { useAuth } from '../../context/AuthContext';
import IconButton from '../../components/IconButton';
import { defineAIForm, f } from '../../components/ai/aiFormFields';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import usePrakasaAIForm from '../../components/ai/usePrakasaAIForm';
import BastDialog from './BastDialog';
import { DeviceFormDialog, DeviceReturnDialog, DeviceStatusDialog } from './DeviceDialogs';
import {
  ASSIGNABLE_FROM, CONDITION_LABELS, DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS, HOLDER_KIND_LABELS, WARRANTY_TYPE_LABELS,
  brandModel, deviceStatusKey, deviceTitle, deviceTitleParts, formatAmount, holderName, labelFor,
} from './itModel';
import './it-tickets.css';
import './it-assets.css';

const SEVERITIES = ['low', 'medium', 'high', 'critical'].map((value) => ({ value, label: PRIORITY_LABELS[value] }));
const errorMessage = (error, fallback) => error.response?.data?.error?.message || fallback;
const dateRange = (from, to) => (from || to ? `${formatDate(from)} – ${formatDate(to)}` : null);
const sizeText = (gb) => (gb ? `${gb} GB` : null);

// Prakasa AI may fill the two log forms; the cost (rupiah) stays with the user
// and the user presses the form's own button (docs/prakasa-ai-rencana.md §9.9).
const MAINTENANCE_EMPTY = { maintenanceDate: '', maintenanceType: '', description: '', performedBy: '', nextMaintenanceDate: '' };
const REPAIR_EMPTY = { reportedDate: '', severity: 'low', issueDescription: '', vendorName: '' };
const AI_MAINTENANCE = defineAIForm({
  id: 'it-device-maintenance',
  title: 'Catat perawatan',
  permission: 'device.log.manage',
  submitLabel: 'Simpan perawatan',
  fields: [
    f.date('maintenanceDate', 'Tanggal', { required: true }),
    f.text('maintenanceType', 'Jenis', { required: true, maxLength: 80, hint: 'Contoh: rutin, pembersihan, pembaruan.' }),
    f.text('description', 'Deskripsi'),
    f.text('performedBy', 'Pelaksana', { maxLength: 190 }),
    f.userOnly('cost', 'Biaya', 'number'),
    f.date('nextMaintenanceDate', 'Jadwal berikutnya'),
  ],
});
const AI_REPAIR = defineAIForm({
  id: 'it-device-repair',
  title: 'Catat perbaikan di vendor',
  permission: 'device.log.manage',
  submitLabel: 'Catat perbaikan',
  fields: [
    f.date('reportedDate', 'Tanggal dilaporkan', { required: true }),
    f.select('severity', 'Tingkat kerusakan', SEVERITIES),
    f.textarea('issueDescription', 'Deskripsi masalah', { required: true }),
    f.text('vendorName', 'Vendor', { maxLength: 190 }),
  ],
});

export default function DeviceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const canManage = permissions.includes('device.manage');
  // Maintenance and repair logs: the API checks device.log.manage (it.routes.js).
  const canLog = permissions.includes('device.log.manage');
  const canAssign = permissions.includes('device.assign');
  // BAST: IT (device.handover.manage) and GA (ga.ops.manage) both make them.
  const canBast = permissions.includes('device.handover.manage') || permissions.includes('ga.ops.manage');
  const maintenanceFormId = useId();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  // Set by any change in the form; closing then asks before discarding.
  const [maintenanceDirty, setMaintenanceDirty] = useState(false);
  // The fields Prakasa AI may fill are held in state; the form is still read
  // with FormData when it is sent (the inputs keep their names).
  const [maintenance, setMaintenance] = useState(MAINTENANCE_EMPTY);
  useEffect(() => { if (maintenanceOpen) { setMaintenanceDirty(false); setMaintenance(MAINTENANCE_EMPTY); } }, [maintenanceOpen]);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repair, setRepair] = useState(REPAIR_EMPTY);
  useEffect(() => { if (repairOpen) setRepair(REPAIR_EMPTY); }, [repairOpen]);
  const [busy, setBusy] = useState('');
  const [bast, setBast] = useState(null); // { kind, assignment }
  const [bastDocs, setBastDocs] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/it/devices/${id}`);
      setDevice(r.data.data);
    } catch (error) {
      setLoadError(errorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // BAST made for this device's assignments (People & Culture's documents).
  const assignmentIds = (device?.assignments || []).map((a) => a.id).join(',');
  const loadBastDocs = useCallback(async () => {
    if (!assignmentIds) { setBastDocs([]); return; }
    try {
      const r = await api.get('/doc-templates/generated', { params: { subjectType: 'device_assignment', subjectIds: assignmentIds } });
      setBastDocs(r.data.data || []);
    } catch { setBastDocs([]); }
  }, [assignmentIds]);
  useEffect(() => { loadBastDocs(); }, [loadBastDocs]);

  const createMaintenance = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setBusy('maintenance');
    try {
      await api.post(`/it/devices/${id}/maintenance`, {
        maintenanceDate: fd.get('maintenanceDate'),
        maintenanceType: fd.get('maintenanceType'),
        description: fd.get('description') || null,
        performedBy: fd.get('performedBy') || null,
        cost: fd.get('cost') ? Number(fd.get('cost')) : null,
        nextMaintenanceDate: fd.get('nextMaintenanceDate') || null,
      });
      toast('Perawatan dicatat', 'success');
      setMaintenanceOpen(false);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Perawatan gagal dicatat'), 'error');
    } finally {
      setBusy('');
    }
  };

  const createRepair = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    setBusy('repair');
    try {
      await api.post(`/it/devices/${id}/repairs`, {
        reportedDate: fd.get('reportedDate'),
        issueDescription: fd.get('issueDescription'),
        severity: fd.get('severity') || 'medium',
        vendorName: fd.get('vendorName') || null,
      });
      toast('Perbaikan dicatat · status Perbaikan', 'success');
      setRepairOpen(false);
      load();
    } catch (err) {
      toast(errorMessage(err, 'Perbaikan gagal dicatat'), 'error');
    } finally {
      setBusy('');
    }
  };

  const setMaintenanceField = (name) => (event) => { const { value } = event.target; setMaintenance((current) => ({ ...current, [name]: value })); };
  const setRepairField = (name) => (event) => { const { value } = event.target; setRepair((current) => ({ ...current, [name]: value })); };
  // `ai` is the maintenance form's registration, `aiRepair` the repair form's.
  const ai = usePrakasaAIForm(AI_MAINTENANCE, {
    enabled: maintenanceOpen && Boolean(device),
    values: maintenance,
    setValues: setMaintenance,
    onFill: () => setMaintenanceDirty(true),
    initialValues: MAINTENANCE_EMPTY,
  });
  const aiRepair = usePrakasaAIForm(AI_REPAIR, {
    enabled: repairOpen && Boolean(device),
    values: repair,
    setValues: setRepair,
    initialValues: REPAIR_EMPTY,
  });

  // Dialogs opened from the URL (a link, or Prakasa AI's buka_halaman), under
  // the same permissions and conditions as the buttons. Opening saves nothing.
  //   ?ubah=1 · ?form=status | serahkan | kembalikan | perawatan | perbaikan
  //   ?form=bast-serah-terima | bast-pengembalian
  // Several dialogs, one at a time: an unsaved one is never replaced or covered by a link (keepUnsaved).
  useOpenFromUrl('ubah', () => { if (canManage) setEditOpen(true); }, { enabled: Boolean(device), keepUnsaved: true });
  useOpenFromUrl('form', (name) => {
    const list = device.assignments || [];
    const active = list.find((a) => a.status === 'active');
    const disposed = device.status === 'disposed';
    if (name === 'status' && canManage && !disposed) setStatusOpen('');
    if (name === 'serahkan' && canManage && ASSIGNABLE_FROM.includes(device.status)) setStatusOpen('assigned');
    if (name === 'kembalikan' && canAssign && device.status === 'assigned' && active) setReturnOpen(true);
    if (name === 'perawatan' && canManage) setMaintenanceOpen(true);
    if (name === 'perbaikan' && canManage && !disposed) setRepairOpen(true);
    // BAST: the holder in hand (or the latest one) for a handover, the latest returned one for a return.
    const handoverFor = active || list[0];
    const returnFor = list.find((a) => a.status !== 'active');
    if (name === 'bast-serah-terima' && canBast && handoverFor) setBast({ kind: 'handover', assignment: handoverFor });
    if (name === 'bast-pengembalian' && canBast && returnFor) setBast({ kind: 'return', assignment: returnFor });
  }, { enabled: Boolean(device), keepUnsaved: true });

  if (loading && !device) return <Page><LoadingState label="Memuat perangkat" /></Page>;
  if (loadError || !device) {
    return (
      <Page>
        <EmptyState
          tone="error"
          title="Perangkat tidak dapat dimuat"
          description={loadError || undefined}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const activeAssignment = device.assignments?.find((a) => a.status === 'active');
  const typeLabel = device.deviceTypeLabel || labelFor(DEVICE_TYPE_LABELS, device.deviceType);
  const holder = holderName(device);
  const assignable = canManage && ASSIGNABLE_FROM.includes(device.status);
  const returnable = canAssign && device.status === 'assigned' && Boolean(activeAssignment);
  const final = device.status === 'disposed';

  let primary = null;
  if (returnable) primary = <Button icon="assignment_return" onClick={() => setReturnOpen(true)}>Kembalikan perangkat</Button>;
  else if (assignable) primary = <Button icon="person_add" onClick={() => setStatusOpen('assigned')}>Serahkan perangkat</Button>;

  return (
    <Page
      eyebrow="Perangkat"
      title={<Mixed parts={deviceTitleParts(device)} separator=" " />}
      description={(
        <span className="pw-row">
          <StatusBadge status={deviceStatusKey(device.status)} label={device.statusLabel || DEVICE_STATUS_LABELS[device.status]} />
          {device.holder?.resigned ? <StatusBadge status="holder_resigned" /> : null}
          <span data-no-translate={device.assetCode || device.serialNumber ? '' : undefined}>{[device.assetCode, device.serialNumber].filter(Boolean).join(' · ') || typeLabel}</span>
        </span>
      )}
      actions={canManage || canAssign || canLog ? (
        <>
          {canManage ? <Button variant="secondary" icon="swap_horiz" disabled={final} onClick={() => setStatusOpen('')}>Ubah status</Button> : null}
          {canManage ? <Button variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>Ubah perangkat</Button> : null}
          {primary}
          {canLog ? (
            <ActionMenu
              label="Aksi perangkat lainnya"
              items={[
                { label: 'Catat perawatan', icon: 'build', onClick: () => setMaintenanceOpen(true) },
                { label: 'Catat perbaikan di vendor', icon: 'report', disabled: final, onClick: () => setRepairOpen(true) },
              ]}
            />
          ) : null}
        </>
      ) : null}
    >
      {device.holder?.resigned ? (
        <Banner tone="warning" title="Pemegang sudah resign">
          {`${holder} sudah resign atau akunnya nonaktif. Kembalikan perangkat ini atau serahkan ke orang lain.`}
        </Banner>
      ) : null}
      {warnings.length ? (
        <Banner tone="warning" title="Perangkat tersimpan dengan catatan" action={<Button variant="text" onClick={() => setWarnings([])}>Tutup</Button>}>
          {warnings.map((w) => w.message).join(' · ')}
        </Banner>
      ) : null}
      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          <Card title="Riwayat pemakaian">
            {device.assignments?.length ? (
              <ul className="it-lines">
                {device.assignments.map((a) => (
                  <li key={a.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title" data-no-translate="">{a.holderName || a.assignedToName || EMPTY}</span>
                      <span className="it-line__meta">
                        <Mixed
                          parts={[
                            HOLDER_KIND_LABELS[a.holderKind],
                            `${formatDate(a.assignedAt)}${a.actualReturnDate ? ` – ${formatDate(a.actualReturnDate)}` : ''}`,
                            data(a.purpose),
                          ]}
                        />
                      </span>
                      {bastDocs.filter((d) => d.subjectId === a.id).map((d) => (
                        <a key={d.id} className="it-line__doc" href={d.webViewLink || undefined} target="_blank" rel="noreferrer"><Mixed parts={[data(d.number), data(d.templateName || d.title)]} /></a>
                      ))}
                    </div>
                    <StatusBadge status={a.status} />
                    {canBast ? (
                      <span className="it-line__actions">
                        <IconButton size="sm" icon="contract" label={`Buat BAST serah terima untuk ${a.holderName || 'pemegang'}`} onClick={() => setBast({ kind: 'handover', assignment: a })} />
                        {a.status !== 'active' ? (
                          <IconButton size="sm" icon="assignment_return" label={`Buat BAST pengembalian dari ${a.holderName || 'pemegang'}`} onClick={() => setBast({ kind: 'return', assignment: a })} />
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="person" title="Belum pernah dipakai" />}
          </Card>

          <Card title="Log perawatan">
            {device.maintenance?.length ? (
              <ul className="it-lines">
                {device.maintenance.map((m) => (
                  <li key={m.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title" data-no-translate="">{m.maintenanceType}</span>
                      <span className="it-line__meta">{formatDate(m.maintenanceDate)} · {formatAmount(m.cost || 0, device.currency)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="build" title="Belum ada perawatan" />}
          </Card>
          <Card title="Log perbaikan">
            {device.repairs?.length ? (
              <ul className="it-lines">
                {device.repairs.map((r) => (
                  <li key={r.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title" data-no-translate="">{r.issueDescription || formatDate(r.reportedDate)}</span>
                      <span className="it-line__meta">{formatDate(r.reportedDate)} · <PriorityBadge priority={r.severity} /></span>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="report" title="Belum ada perbaikan" />}
          </Card>
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan">
            <KeyValue items={[
              { label: 'Tipe', value: typeLabel },
              { label: 'Merek / model', value: brandModel(device) },
              { label: 'Nomor seri', value: device.serialNumber },
              { label: 'No. aset', value: device.assetCode },
              { label: 'Tahun beli', value: device.purchaseYear },
              { label: 'RAM', value: sizeText(device.ramGb) },
              { label: 'SSD', value: sizeText(device.storageGb) },
              { label: 'OS', value: device.osVersion },
              { label: 'Pemakai', value: holder ? <>{holder}{device.holder?.kind ? <> · <Translate>{HOLDER_KIND_LABELS[device.holder.kind]}</Translate></> : ''}</> : <Translate>Belum ada</Translate> },
              { label: 'Lokasi', value: device.locationName || device.currentLocation },
              { label: 'Status sejak', value: device.statusChangedAt ? formatDateTime(device.statusChangedAt) : null },
              { label: 'Kondisi', translate: true, value: device.conditionState ? labelFor(CONDITION_LABELS, device.conditionState) : null },
              { label: 'Catatan', value: device.notes },
            ]}
            />
          </Card>
          <Card title="Pembelian dan garansi">
            <KeyValue items={[
              { label: 'Tanggal beli', value: device.purchaseDate ? formatDate(device.purchaseDate) : null },
              { label: 'Harga beli', value: device.purchasePrice != null ? formatAmount(device.purchasePrice, device.currency) : null },
              { label: 'Supplier', value: device.supplier },
              { label: 'Garansi', value: dateRange(device.warrantyStart, device.warrantyEnd) },
              { label: 'Jenis garansi', translate: true, value: device.warrantyType ? labelFor(WARRANTY_TYPE_LABELS, device.warrantyType) : null },
              { label: 'IMEI', value: device.imei },
              { label: 'MAC address', value: device.macAddress },
            ]}
            />
          </Card>
          <Card title="Riwayat garansi">
            {device.warranties?.length ? (
              <ul className="it-lines">
                {device.warranties.map((w) => (
                  <li key={w.id} className="it-line">
                    <div className="it-line__main">
                      <span className="it-line__title">{labelFor(WARRANTY_TYPE_LABELS, w.warrantyType)}</span>
                      <span className="it-line__meta">{dateRange(w.startDate, w.endDate) || EMPTY} · <span data-no-translate="">{w.provider || EMPTY}</span></span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="verified_user" title="Belum ada data garansi" />}
          </Card>
        </aside>
      </div>

      <DeviceFormDialog
        open={editOpen}
        device={device}
        onClose={() => setEditOpen(false)}
        onSaved={async (result) => { setEditOpen(false); setWarnings(result?.warnings || []); await load(); }}
      />
      <DeviceStatusDialog
        open={statusOpen !== null}
        device={device}
        initialStatus={statusOpen || ''}
        onClose={() => setStatusOpen(null)}
        onChanged={async () => { setStatusOpen(null); await load(); }}
      />
      <BastDialog
        open={Boolean(bast)}
        subject="device"
        kind={bast?.kind}
        target={bast?.assignment}
        onClose={() => setBast(null)}
        onMade={loadBastDocs}
      />
      <DeviceReturnDialog
        open={returnOpen}
        device={device}
        assignment={activeAssignment}
        onClose={() => setReturnOpen(false)}
        onReturned={async () => { setReturnOpen(false); await load(); }}
      />

      <FullScreenDialog
        open={maintenanceOpen}
        onClose={() => setMaintenanceOpen(false)}
        dirty={maintenanceDirty}
        title="Catat perawatan"
        sectionTitle="Perawatan"
        actions={(
          <>
            <Button variant="text" type="button" onClick={() => setMaintenanceOpen(false)}>Batal</Button>
            <Button type="submit" form={maintenanceFormId} loading={busy === 'maintenance'}>Simpan perawatan</Button>
          </>
        )}
      >
        {ai.notice}
        <form id={maintenanceFormId} className="pw-fsdialog__fields" onSubmit={createMaintenance} onChange={() => setMaintenanceDirty(true)}>
          <DateInput label="Tanggal" name="maintenanceDate" required value={maintenance.maintenanceDate} {...ai.field('maintenanceDate')} onChange={setMaintenanceField('maintenanceDate')} />
          <Input label="Jenis" name="maintenanceType" required hint="Contoh: rutin, pembersihan, pembaruan." value={maintenance.maintenanceType} {...ai.field('maintenanceType')} onChange={setMaintenanceField('maintenanceType')} />
          <Input label="Deskripsi" name="description" value={maintenance.description} {...ai.field('description')} onChange={setMaintenanceField('description')} />
          <Input label="Pelaksana" name="performedBy" value={maintenance.performedBy} {...ai.field('performedBy')} onChange={setMaintenanceField('performedBy')} />
          <Input label="Biaya" name="cost" type="number" />
          <DateInput label="Jadwal berikutnya" name="nextMaintenanceDate" value={maintenance.nextMaintenanceDate} {...ai.field('nextMaintenanceDate')} onChange={setMaintenanceField('nextMaintenanceDate')} />
        </form>
      </FullScreenDialog>

      <Modal open={repairOpen} onClose={() => setRepairOpen(false)} title="Catat perbaikan di vendor">
        <form className="pw-stack" onSubmit={createRepair}>
          <p className="it-status__device">Perangkat berstatus Perbaikan sampai perbaikannya selesai. Kerusakan yang belum dikirim ke vendor cukup diubah statusnya menjadi Rusak.</p>
          {aiRepair.notice}
          <div className="pw-form-grid">
            <DateInput label="Tanggal dilaporkan" name="reportedDate" required value={repair.reportedDate} {...aiRepair.field('reportedDate')} onChange={setRepairField('reportedDate')} />
            <Select label="Tingkat kerusakan" name="severity" options={SEVERITIES} value={repair.severity} {...aiRepair.field('severity')} onChange={setRepairField('severity')} />
          </div>
          <Textarea label="Deskripsi masalah" name="issueDescription" rows={3} required value={repair.issueDescription} {...aiRepair.field('issueDescription')} onChange={setRepairField('issueDescription')} />
          <Input label="Vendor" name="vendorName" value={repair.vendorName} {...aiRepair.field('vendorName')} onChange={setRepairField('vendorName')} />
          <FormActions>
            <Button variant="text" type="button" onClick={() => setRepairOpen(false)}>Batal</Button>
            <Button type="submit" loading={busy === 'repair'}>Catat perbaikan</Button>
          </FormActions>
        </form>
      </Modal>
    </Page>
  );
}
