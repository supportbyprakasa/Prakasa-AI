import { Mixed, data } from '../../i18n/NoTranslate';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client';
import ActionMenu from '../../components/ActionMenu';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import Input from '../../components/Input';
import KeyValue from '../../components/KeyValue';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import ProgressBar from '../../components/ProgressBar';
import ReasonDialog from '../../components/ReasonDialog';
import Select from '../../components/Select';
import StatusBadge from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { formatDate, formatDateTime } from '../../components/format';
import { allowedLink } from '../../components/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  APPROVER_BASIS_LABELS, ATTACHMENT_TYPES, WORKFLOW_TYPE_LABELS, adminConsoleLink, apiErrorMessage, attachmentTypeLabel,
  checklistProgress, groupTasks, headerActions, holdingsCounts, isDraftLike, isTaskLate, needsSummary,
  previewGroups, reasonLabel, taskLinkNote, taskMenuActions, taskMeta, taskPrimaryAction, workflowBadge,
} from './hrgaModel';
import {
  AssignDialog, DeviceHandoverDialog, DeviceReturnTaskDialog, GoogleCompleteDialog, ItTicketDialog, LicenseAssignDialog, LicenseRevokeDialog, PhoneLineDialog,
} from './TaskDialogs';
import useOpenFromUrl from '../../components/ai/useOpenFromUrl';
import WorkflowFormDialog from './WorkflowFormDialog';
import useHrgaLookups from './useHrgaLookups';
import './hrga-workflow.css';
import { safeExternalHref } from '../../components/safeHref.js';

// Task dialogs that hold a form (the rest are confirmations).
const TASK_FORMS = ['assign', 'it_ticket', 'device_handover', 'device_return', 'license_assign'];
const DIRECTORY_RESULT = {
  excluded: 'Orang ini ditandai Dikecualikan di direktori.',
  reverted: 'Tanggal resign di direktori dikembalikan.',
  untouched: 'Direktori tidak diubah karena datanya sudah diubah orang lain.',
};

function WorkflowBadge({ status }) {
  const b = workflowBadge(status);
  return <StatusBadge status={b.status} label={b.label} />;
}

function TaskRow({ task, workflow, permissions, onAction, onMenu, busy }) {
  const action = taskPrimaryAction(task, workflow, permissions);
  const menu = taskMenuActions(task, workflow);
  const consoleUrl = action ? adminConsoleLink(task) : null;
  const late = isTaskLate(task);
  const link = taskLinkNote(task);
  const ticketLink = task.linkedItTicketId ? allowedLink(`/it/tickets/${task.linkedItTicketId}`, permissions) : null;
  const menuLabels = { skip: ['Lewati dengan alasan', 'skip_next'], assign: ['Tugaskan ke…', 'person'], it_ticket: ['Buat tiket IT', 'support'] };
  return (
    <li className="hrga-line">
      <div className="hrga-line__main">
        <span className="hrga-line__title">{task.title}</span>
        <span className="hrga-line__meta">
          <Mixed parts={taskMeta(task)} />
          {task.dueDate ? (
            <>
              {' · '}
              <span className={late ? 'hrga-late' : undefined}>{late ? `Lewat tenggat ${formatDate(task.dueDate)}` : `Tenggat ${formatDate(task.dueDate)}`}</span>
            </>
          ) : null}
        </span>
        {link.length ? (
          <span className="hrga-line__meta">
            {link.map((note, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={index}>{index > 0 ? ' · ' : ''}<Mixed parts={note} separator=" " /></span>
            ))}
          </span>
        ) : null}
        {task.linkedItTicketId ? (
          <span className="hrga-line__meta">
            {ticketLink ? <Link className="pw-link" to={ticketLink}>{`Tiket IT #${task.linkedItTicketId}`}</Link> : `Tiket IT #${task.linkedItTicketId}`}
          </span>
        ) : null}
      </div>
      <span className="hrga-line__side">
        <StatusBadge status={task.status} />
        {consoleUrl ? <IconButton size="sm" icon="open_in_new" label="Buka konsol admin" href={consoleUrl} target="_blank" rel="noreferrer" /> : null}
        {action ? (
          <Button
            variant="secondary"
            icon={action.icon}
            disabled={!action.allowed || busy === task.id}
            loading={busy === task.id}
            tooltip={action.blockedReason || undefined}
            onClick={() => onAction(action.key, task)}
          >
            {action.label}
          </Button>
        ) : null}
        <ActionMenu
          size="sm"
          label={`Aksi lain untuk ${task.title}`}
          items={menu.map((key) => ({ label: menuLabels[key][0], icon: menuLabels[key][1], onClick: () => onMenu(key, task) }))}
        />
      </span>
    </li>
  );
}

function ChecklistGroups({ groups, renderItem }) {
  return groups.map((g) => (
    <section key={g.group} className="hrga-group" aria-label={g.label}>
      <h4 className="pw-overline hrga-group__title">{`${g.label} (${g.tasks.length})`}</h4>
      <ul className="hrga-lines">{g.tasks.map(renderItem)}</ul>
    </section>
  ));
}

// Detail of one onboarding/offboarding (spec §2.1.6, detail template §3.2).
// Readers without hrga.view (a manager with a task, a division Head) get the
// limited DTO: checklist and summary only.
export default function HrgaWorkflowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const kantorkuFormId = useId();
  const uploadFormId = useId();
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [preview, setPreview] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, task? }
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const lookups = useHrgaLookups(dialog?.kind === 'assign');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await api.get(`/hrga/workflows/${id}`);
      const data = r.data.data;
      setWf(data);
      if (data && (isDraftLike(data) || data.status === 'pending_approval')) {
        api.get(`/hrga/workflows/${id}/checklist-preview`)
          .then((p) => setPreview(p.data.data?.items || []))
          .catch(() => setPreview(null));
      } else setPreview(null);
    } catch (error) {
      setLoadError(error.response?.status === 404
        ? 'Onboarding/offboarding ini tidak ditemukan, atau Anda tidak punya akses.'
        : apiErrorMessage(error, 'Periksa koneksi, lalu coba lagi.'));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const close = () => setDialog(null);
  const done = async () => { setDialog(null); await load(); };
  const run = async (key, request, success, fallback) => {
    setBusy(key);
    try {
      const response = await request();
      if (success) toast(typeof success === 'function' ? success(response.data?.data || {}) : success, 'success');
      return response.data?.data || {};
    } catch (error) {
      toast(apiErrorMessage(error, fallback), 'error');
      return null;
    } finally {
      setBusy('');
    }
  };

  // Dialogs a link (or Prakasa AI) may open — only the ones this viewer is
  // offered on the page itself: ?ubah=1 the draft's form, ?form=<aksi>.<id tugas>
  // a task dialog (assign, it_ticket, device_handover, device_return, license_assign).
  // A dialog the user opened that Prakasa AI cannot see (a decision with its reason, a
  // confirmation) is never replaced by a link either: those are not registered forms.
  const fromUrl = (next) => (current) => (current && current.kind !== 'edit' && !TASK_FORMS.includes(current.kind) ? current : next);
  useOpenFromUrl('ubah', () => {
    if (headerActions(wf).menu.includes('edit')) setDialog(fromUrl({ kind: 'edit' }));
    // One dialog state for the draft form and every task dialog: an unsaved one is never replaced by a link (keepUnsaved).
  }, { enabled: Boolean(wf) && !loading, keepUnsaved: true });
  useOpenFromUrl('form', (value) => {
    const [kind, taskId] = String(value).split('.');
    const task = (wf.tasks || []).find((item) => String(item.id) === String(taskId));
    if (!task || !TASK_FORMS.includes(kind)) return;
    const primary = taskPrimaryAction(task, wf, permissions);
    const offered = (primary?.key === kind && primary.allowed) || taskMenuActions(task, wf).includes(kind);
    if (offered) setDialog(fromUrl({ kind, task }));
  }, { enabled: Boolean(wf) && !loading, keepUnsaved: true });

  if (loading && !wf) return <Page><LoadingState label="Memuat onboarding/offboarding" /></Page>;
  if (loadError || !wf) {
    return (
      <Page>
        <EmptyState
          tone="error"
          title="Tidak dapat dibuka"
          description={loadError || undefined}
          action={<Button variant="secondary" onClick={load}>Coba lagi</Button>}
        />
      </Page>
    );
  }

  const offboarding = wf.workflowType === 'offboarding';
  const limited = Boolean(wf.limited);
  const viewer = wf.viewer || {};
  const tasks = wf.tasks || [];
  const progress = checklistProgress(tasks);
  const actions = headerActions(wf);
  const approvalId = wf.approvalRequestId;

  const decide = (action) => async (note) => {
    const out = await run(action, () => api.post(`/approvals/${approvalId}/decide`, { action, note: note || null }),
      { approve: 'Disetujui. Checklist dibuat.', reject: 'Ditolak', request_revision: 'Dikembalikan untuk revisi' }[action], 'Keputusan gagal disimpan.');
    if (out) await done();
  };
  const submit = async () => {
    const out = await run('submit', () => api.post(`/hrga/workflows/${id}/submit`), (d) => (d.approverName ? `Diajukan ke ${d.approverName}` : 'Diajukan'), 'Gagal mengajukan.');
    if (out) await load();
  };
  const completeTask = async (task) => {
    setBusy(task.id);
    try {
      await api.patch(`/hrga/workflows/${id}/tasks/${task.id}`, { status: 'completed' });
      toast('Tugas ditandai selesai', 'success');
      await load();
    } catch (error) {
      toast(apiErrorMessage(error, 'Tugas gagal diperbarui.'), 'error');
    } finally {
      setBusy('');
    }
  };
  const onTaskAction = (key, task) => {
    if (key === 'complete') { completeTask(task); return; }
    setDialog({ kind: key, task });
  };
  const linkPerson = async (personKey) => {
    const out = await run('link', () => api.patch(`/hrga/workflows/${id}`, { version: wf.version, personKey }), 'Ditautkan ke orang di direktori', 'Gagal menautkan.');
    if (out) await load();
  };
  const syncHoldings = async () => {
    const out = await run('sync', () => api.post(`/hrga/workflows/${id}/holdings-sync`), (d) => (Number(d.added) ? `${d.added} tugas ditambahkan ke checklist` : 'Tidak ada kepemilikan baru'), 'Gagal menambahkan kepemilikan.');
    if (out) await load();
  };
  const upload = async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (!(data.get('file') instanceof File) || !data.get('file').size) { toast('Pilih file dulu.', 'error'); return; }
    const out = await run('upload', () => api.post(`/hrga/workflows/${id}/attachments`, data, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Lampiran diunggah', 'Lampiran gagal diunggah.');
    if (out) { form.reset(); await load(); }
  };
  const saveKantorku = async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const out = await run('kantorku', () => api.patch(`/hrga/workflows/${id}/kantorku-reference`, {
      kantorkuEmployeeId: String(data.get('kantorkuEmployeeId') || '').trim() || null,
      kantorkuReferenceUrl: String(data.get('kantorkuReferenceUrl') || '').trim() || null,
    }), 'Referensi KantorKu disimpan', 'Referensi KantorKu gagal disimpan.');
    if (out) await done();
  };

  // ---------------------------------------------------------------- header
  const BUTTONS = {
    approve: { label: 'Setujui', icon: 'check', onClick: () => setDialog({ kind: 'approve' }) },
    reject: { label: 'Tolak', icon: 'close', onClick: () => setDialog({ kind: 'reject' }) },
    request_revision: { label: 'Minta revisi', icon: 'undo', onClick: () => setDialog({ kind: 'request_revision' }) },
    submit: { label: 'Ajukan', icon: 'send', onClick: submit },
    withdraw: { label: 'Tarik pengajuan', icon: 'undo', onClick: () => setDialog({ kind: 'withdraw' }) },
  };
  const MENU = {
    edit: { label: 'Ubah', icon: 'edit', onClick: () => setDialog({ kind: 'edit' }) },
    holdings_sync: { label: 'Tambah kepemilikan ke checklist', icon: 'playlist_add', onClick: syncHoldings },
    kantorku: { label: 'Referensi KantorKu', icon: 'link', onClick: () => setDialog({ kind: 'kantorku' }) },
    cancel: { label: 'Batalkan workflow', icon: 'cancel', tone: 'danger', onClick: () => setDialog({ kind: 'cancel' }) },
    delete: { label: 'Hapus draf', icon: 'delete', tone: 'danger', onClick: () => setDialog({ kind: 'delete' }) },
  };
  const header = (
    <>
      {actions.secondary.map((key) => (
        <Button key={key} variant="secondary" icon={BUTTONS[key].icon} loading={busy === key} onClick={BUTTONS[key].onClick}>{BUTTONS[key].label}</Button>
      ))}
      {actions.primary.map((key) => (
        <Button key={key} icon={BUTTONS[key].icon} loading={busy === key} onClick={BUTTONS[key].onClick}>{BUTTONS[key].label}</Button>
      ))}
      <ActionMenu label="Aksi lainnya" items={actions.menu.map((key) => (BUTTONS[key] ? { ...BUTTONS[key] } : MENU[key]))} />
    </>
  );

  // ---------------------------------------------------------------- summary
  const summary = [
    { label: 'Nomor', value: wf.workflowNumber },
    { label: 'Status', value: <WorkflowBadge status={wf.status} /> },
    { label: 'Karyawan', value: wf.employeeName },
    { label: 'Jabatan', value: wf.position },
    { label: 'Divisi', translate: true, value: wf.departmentName },
    { label: 'Atasan langsung', value: wf.managerName },
    !offboarding ? { label: 'Lokasi kerja', value: wf.locationName } : null,
    !offboarding ? { label: 'Email kerja rencana', value: wf.plannedWorkEmail } : null,
    { label: offboarding ? 'Hari terakhir' : 'Tanggal mulai', value: (offboarding ? wf.lastWorkingDate : wf.joinDate) ? formatDate(offboarding ? wf.lastWorkingDate : wf.joinDate) : null },
    offboarding ? { label: 'Alasan', translate: true, value: reasonLabel(wf.reasonCode) } : null,
    !offboarding ? { label: 'Kebutuhan', translate: true, value: needsSummary(wf.needs, wf.needLicenses) } : null,
    { label: 'PIC People & Culture', value: wf.picName },
    { label: 'Diajukan oleh', value: wf.requesterName },
    wf.approverBasis ? { label: 'Penyetuju', translate: true, value: APPROVER_BASIS_LABELS[wf.approverBasis] } : null,
    wf.submittedAt ? { label: 'Diajukan', value: formatDateTime(wf.submittedAt) } : null,
    wf.approvedAt ? { label: 'Disetujui', value: formatDateTime(wf.approvedAt) } : null,
    wf.completedAt ? { label: 'Selesai', translateContext: 'completed', value: formatDateTime(wf.completedAt) } : null,
    wf.cancelledAt ? { label: 'Dibatalkan', value: [formatDateTime(wf.cancelledAt), wf.cancelReason].filter(Boolean).join(' · ') } : null,
    !limited ? {
      label: 'Referensi KantorKu',
      value: wf.kantorkuEmployeeId || wf.kantorkuReferenceUrl ? (
        safeExternalHref(wf.kantorkuReferenceUrl)
          ? <a className="pw-link" href={safeExternalHref(wf.kantorkuReferenceUrl)} target="_blank" rel="noreferrer" data-translate={wf.kantorkuEmployeeId ? undefined : ''}>{wf.kantorkuEmployeeId || 'Buka di KantorKu'}</a>
          : wf.kantorkuEmployeeId || wf.kantorkuReferenceUrl
      ) : null,
    } : null,
    !limited && wf.notes ? { label: 'Catatan', value: wf.notes } : null,
  ];

  const matches = !limited && viewer.canEdit && wf.workflowType === 'onboarding' && isDraftLike(wf) && !wf.personKey ? (wf.possibleMatches || []) : [];
  const counts = holdingsCounts(wf.holdings);
  const preparedPreview = preview ? previewGroups(preview) : null;
  // Whole sentences (never "label + value" glued in one template).
  const dateText = offboarding
    ? (wf.lastWorkingDate ? `Hari terakhir ${formatDate(wf.lastWorkingDate)}` : null)
    : (wf.joinDate ? `Mulai ${formatDate(wf.joinDate)}` : null);

  return (
    <Page
      eyebrow={WORKFLOW_TYPE_LABELS[wf.workflowType] || 'Onboarding/offboarding'}
      title={wf.employeeName}
      dataTitle
      description={(
        <span className="pw-row">
          <WorkflowBadge status={wf.status} />
          <span><Mixed parts={[data(wf.workflowNumber), dateText]} /></span>
        </span>
      )}
      actions={header}
    >
      {notice ? <Banner tone="warning" title={notice.title} action={<Button variant="text" onClick={() => setNotice(null)}>Tutup</Button>}>{notice.body}</Banner> : null}
      {limited ? <Banner tone="info">Anda melihat checklist dan ringkasan. Detail lain hanya untuk People & Culture.</Banner> : null}
      {matches.length ? (
        <Banner
          tone="info"
          title={`Kemungkinan sama dengan ${matches.map((m) => m.name).join(', ')}`}
          action={(
            <span className="pw-row">
              {matches.map((m) => (
                <Button key={m.key} variant="text" loading={busy === 'link'} onClick={() => linkPerson(m.key)}>{matches.length > 1 ? `Tautkan ke ${m.name}` : 'Tautkan'}</Button>
              ))}
            </span>
          )}
        >
          {`${matches.map((m) => [m.departmentName, m.status === 'resigned' ? 'resign' : 'aktif'].filter(Boolean).join(', ')).join('; ')}. Tautkan bila orangnya sama (misalnya bekerja lagi), supaya direktori tidak ganda.`}
        </Banner>
      ) : null}

      <div className="pw-cols-sidebar">
        <div className="pw-stack">
          {tasks.length || !preparedPreview ? (
            <Card title="Checklist">
              {tasks.length ? (
                <>
                  <div className="hrga-progress">
                    <p className="hrga-progress__label">{`${progress.done} dari ${progress.total} tugas selesai (${progress.pct}%)`}</p>
                    <ProgressBar value={progress.pct} label="Progres checklist" />
                  </div>
                  <ChecklistGroups
                    groups={groupTasks(tasks)}
                    renderItem={(task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        workflow={wf}
                        permissions={permissions}
                        busy={busy}
                        onAction={onTaskAction}
                        onMenu={(key, t) => setDialog({ kind: key, task: t })}
                      />
                    )}
                  />
                </>
              ) : (
                <EmptyState compact icon="checklist" title="Belum ada checklist" description="Checklist dibuat saat pengajuan disetujui." />
              )}
            </Card>
          ) : null}

          {preparedPreview ? (
            <Card title="Pratinjau checklist" subtitle="Dibuat saat disetujui. Tenggat dihitung dari tanggal di pengajuan, paling awal hari disetujui.">
              {preparedPreview.total ? (
                <ChecklistGroups
                  groups={preparedPreview.groups}
                  renderItem={(item, index) => (
                    <li key={`${item.category}-${index}`} className="hrga-line">
                      <div className="hrga-line__main">
                        <span className="hrga-line__title">{item.title}</span>
                        <span className="hrga-line__meta">
                          <Mixed parts={[item.responsibleName ? data(item.responsibleName) : 'Belum ada penanggung jawab', item.dueDate ? `Tenggat ${formatDate(item.dueDate)}` : null]} />
                        </span>
                      </div>
                    </li>
                  )}
                />
              ) : <EmptyState compact icon="checklist" title="Tidak ada item" description="Template dan kebutuhan tidak menghasilkan tugas." />}
            </Card>
          ) : null}

          {!limited && wf.approval?.steps?.length ? (
            <Card title="Riwayat approval">
              <ul className="hrga-lines">
                {wf.approval.steps.map((s) => (
                  <li key={s.id} className="hrga-line">
                    <div className="hrga-line__main">
                      <span className="hrga-line__title" data-no-translate={s.approverName ? '' : undefined}>{s.approverName || s.approverRoleName || 'Penyetuju'}</span>
                      <span className="hrga-line__meta">
                        {[
                          s.escalatedToRoleName ? `Dieskalasi ke ${s.escalatedToRoleName}` : null,
                          s.decidedByName ? `Diputuskan ${s.decidedByName}` : null,
                          s.decidedAt ? formatDateTime(s.decidedAt) : null,
                          !s.decidedAt && s.deadlineAt ? `Batas ${formatDateTime(s.deadlineAt)}` : null,
                        ].filter(Boolean).join(' · ') || '—'}
                      </span>
                      {s.note ? <span className="hrga-line__meta">{`Catatan: ${s.note}`}</span> : null}
                    </div>
                    <span className="hrga-line__side"><StatusBadge status={s.status} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="pw-stack">
          <Card title="Ringkasan" size="sm">
            <KeyValue items={summary} />
          </Card>
          {offboarding && wf.holdings ? (
            <Card title="Kepemilikan" size="sm" subtitle={`${counts.devices} perangkat · ${counts.licenses} lisensi · ${counts.phoneLines} nomor`}>
              {counts.devices + counts.licenses + counts.phoneLines ? (
                <ul className="hrga-lines">
                  {wf.holdings.devices.map((d) => (
                    <li key={`d${d.assignmentId}`} className="hrga-line"><div className="hrga-line__main"><span data-no-translate="" className="hrga-line__title">{d.name}</span><span className="hrga-line__meta">Perangkat</span></div></li>
                  ))}
                  {wf.holdings.licenses.map((l) => (
                    <li key={`l${l.licenseId}`} className="hrga-line"><div className="hrga-line__main"><span data-no-translate="" className="hrga-line__title">{l.productName}</span><span className="hrga-line__meta">Lisensi</span></div></li>
                  ))}
                  {wf.holdings.phoneLines.map((p) => (
                    <li key={`p${p.id}`} className="hrga-line"><div className="hrga-line__main"><span data-no-translate="" className="hrga-line__title">{p.label}</span><span className="hrga-line__meta">Nomor perusahaan</span></div></li>
                  ))}
                </ul>
              ) : <span className="pw-text-helper">Tidak memegang perangkat, lisensi, atau nomor perusahaan.</span>}
            </Card>
          ) : null}
          {!limited ? (
            <Card title={`Lampiran (${(wf.attachments || []).length})`} size="sm">
              <div className="pw-stack">
                {(wf.attachments || []).length ? (
                  <ul className="hrga-lines">
                    {wf.attachments.map((a) => (
                      <li key={a.id} className="hrga-line">
                        <div className="hrga-line__main">
                          <span data-no-translate="" className="hrga-line__title">{a.name}</span>
                          <span className="hrga-line__meta">{[attachmentTypeLabel(a.attachmentType), a.createdAt ? formatDate(a.createdAt) : null].filter(Boolean).join(' · ')}</span>
                        </div>
                        {a.webViewLink ? <IconButton size="sm" icon="open_in_new" label={`Buka ${a.name}`} href={a.webViewLink} target="_blank" rel="noreferrer" /> : null}
                      </li>
                    ))}
                  </ul>
                ) : <span className="pw-text-helper">Belum ada lampiran.</span>}
                {viewer.canAttach ? (
                  <form id={uploadFormId} className="pw-stack pw-stack--sm" onSubmit={upload}>
                    <Banner tone="info">Kontrak, KTP, offer letter, dan surat resign disimpan di KantorKu, jangan diunggah di sini.</Banner>
                    <Select label="Jenis lampiran" name="attachmentType" options={ATTACHMENT_TYPES} defaultValue="handover_note" />
                    <Input label="File" name="file" type="file" />
                    <span><Button variant="secondary" type="submit" icon="upload" loading={busy === 'upload'}>Unggah lampiran</Button></span>
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>

      {/* ------------------------------------------------ dialogs */}
      <ReasonDialog
        open={dialog?.kind === 'approve'}
        title="Setujui pengajuan ini?"
        description={`Checklist ${offboarding ? 'offboarding' : 'onboarding'} ${wf.employeeName} dibuat dan penanggung jawab diberi tahu.`}
        label="Catatan"
        required={false}
        confirmLabel="Setujui"
        onClose={close}
        onConfirm={decide('approve')}
      />
      <ReasonDialog open={dialog?.kind === 'reject'} title="Tolak pengajuan ini?" tone="danger" confirmLabel="Tolak" onClose={close} onConfirm={decide('reject')} />
      <ReasonDialog open={dialog?.kind === 'request_revision'} title="Minta revisi" label="Yang perlu diperbaiki" confirmLabel="Minta revisi" onClose={close} onConfirm={decide('request_revision')} />
      <ReasonDialog
        open={dialog?.kind === 'withdraw'}
        title="Tarik pengajuan?"
        description="Pengajuan kembali menjadi draf dan bisa diubah lalu diajukan lagi."
        label="Catatan"
        confirmLabel="Tarik pengajuan"
        onClose={close}
        onConfirm={async (note) => { const out = await run('withdraw', () => api.post(`/hrga/workflows/${id}/withdraw`, { note }), 'Pengajuan ditarik', 'Gagal menarik pengajuan.'); if (out) await done(); }}
      />
      <ReasonDialog
        open={dialog?.kind === 'cancel'}
        title="Batalkan workflow?"
        description="Tugas yang belum selesai berhenti. Data yang sudah tercatat tidak dihapus."
        tone="danger"
        confirmLabel="Batalkan workflow"
        onClose={close}
        onConfirm={async (reason) => {
          const out = await run('cancel', () => api.post(`/hrga/workflows/${id}/cancel`, { reason }), 'Workflow dibatalkan', 'Gagal membatalkan.');
          if (!out) return;
          const open = out.openAssignments || [];
          const lines = [DIRECTORY_RESULT[out.directory], open.length ? `Perangkat masih dipegang: ${open.map((a) => a.deviceName).join(', ')}. Terima kembali lewat halaman Perangkat.` : null].filter(Boolean);
          if (lines.length) setNotice({ title: 'Workflow dibatalkan', body: lines.join(' ') });
          await done();
        }}
      />
      <ReasonDialog
        open={dialog?.kind === 'skip'}
        title="Lewati tugas ini?"
        description={dialog?.task?.title}
        confirmLabel="Lewati"
        onClose={close}
        onConfirm={async (reason) => {
          const out = await run('skip', () => api.patch(`/hrga/workflows/${id}/tasks/${dialog.task.id}`, { status: 'skipped', skippedReason: reason }), 'Tugas dilewati', 'Tugas gagal dilewati.');
          if (out) await done();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title="Hapus draf ini?"
        message={`${wf.workflowNumber} — ${wf.employeeName} dihapus. Draf yang belum diajukan tidak tercatat di mana pun.`}
        confirmLabel="Hapus draf"
        loading={busy === 'delete'}
        onClose={close}
        onConfirm={async () => {
          const out = await run('delete', () => api.delete(`/hrga/workflows/${id}`), 'Draf dihapus', 'Draf gagal dihapus.');
          if (out) navigate(offboarding ? '/hrga/offboarding' : '/hrga/onboarding');
        }}
      />
      <LicenseRevokeDialog open={dialog?.kind === 'license_revoke'} workflowId={id} task={dialog?.task} employeeName={wf.employeeName} onClose={close} onDone={done} />
      <Modal
        open={dialog?.kind === 'kantorku'}
        onClose={close}
        title="Referensi KantorKu"
        size="sm"
        footer={(
          <>
            <Button variant="text" type="button" onClick={close}>Batal</Button>
            <Button type="submit" form={kantorkuFormId} loading={busy === 'kantorku'}>Simpan referensi</Button>
          </>
        )}
      >
        <form id={kantorkuFormId} className="pw-stack" onSubmit={saveKantorku}>
          <Input label="ID karyawan KantorKu" name="kantorkuEmployeeId" maxLength={64} defaultValue={wf.kantorkuEmployeeId || ''} />
          <Input
            label="URL referensi"
            name="kantorkuReferenceUrl"
            type="url"
            maxLength={500}
            defaultValue={wf.kantorkuReferenceUrl || ''}
            hint="Hanya tautan. Absensi, cuti, dan payroll tetap di KantorKu."
          />
        </form>
      </Modal>

      <WorkflowFormDialog
        open={dialog?.kind === 'edit'}
        workflow={wf}
        onClose={close}
        onSaved={done}
      />
      {dialog?.task ? (
        <>
          <DeviceHandoverDialog open={dialog.kind === 'device_handover'} workflowId={id} task={dialog.task} employeeName={wf.employeeName} onClose={close} onDone={done} />
          <DeviceReturnTaskDialog open={dialog.kind === 'device_return'} workflowId={id} task={dialog.task} onClose={close} onDone={done} />
          <LicenseAssignDialog open={dialog.kind === 'license_assign'} workflowId={id} task={dialog.task} onClose={close} onDone={done} />
          <PhoneLineDialog open={dialog.kind === 'phone_line' || dialog.kind === 'phone_line_return'} mode={dialog.kind === 'phone_line_return' ? 'return' : 'assign'} workflowId={id} task={dialog.task} onClose={close} onDone={done} />
          <GoogleCompleteDialog open={dialog.kind === 'google_complete'} workflowId={id} task={dialog.task} onClose={close} onDone={done} />
          <AssignDialog open={dialog.kind === 'assign'} workflowId={id} task={dialog.task} users={lookups.users} onClose={close} onDone={done} />
          <ItTicketDialog open={dialog.kind === 'it_ticket'} workflowId={id} task={dialog.task} employeeName={wf.employeeName} onClose={close} onDone={done} />
        </>
      ) : null}
    </Page>
  );
}
