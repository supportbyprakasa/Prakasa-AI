import { useCallback, useEffect, useState } from 'react';
import api from '../../../api/client';
import FullScreenDialog, { FullScreenSection } from '../../../components/FullScreenDialog';
import Button from '../../../components/Button';
import IconButton from '../../../components/IconButton';
import Input from '../../../components/Input';
import Select from '../../../components/Select';
import Switch from '../../../components/Switch';
import KeyValue from '../../../components/KeyValue';
import Textarea from '../../../components/Textarea';
import Banner from '../../../components/Banner';
import ConfirmDialog from '../../../components/ConfirmDialog';
import FormActions from '../../../components/FormActions';
import EmptyState, { LoadingState } from '../../../components/EmptyState';
import { toast } from '../../../components/Toast';
import { spaceTypeLabel } from '../chatModel';
import PeoplePicker from './PeoplePicker';
import { Avatar, errorCode, errorText } from './parts';

// Who-may-do-what settings a space manager can change through the Chat API.
const PERMISSIONS = [
  { key: 'manageMembersAndGroups', label: 'Kelola anggota' },
  { key: 'modifySpaceDetails', label: 'Ubah nama, deskripsi & pedoman' },
  { key: 'toggleHistory', label: 'Aktifkan / nonaktifkan riwayat' },
  { key: 'useAtMentionAll', label: 'Gunakan @all' },
  { key: 'replyMessages', label: 'Membalas pesan' },
];
const WHO_OPTIONS = [{ value: 'managers', label: 'Pengelola saja' }, { value: 'members', label: 'Semua anggota' }];
const whoOf = (setting) => (setting?.membersAllowed ? 'members' : 'managers');
const permissionForm = (settings) => Object.fromEntries(PERMISSIONS.filter(({ key }) => settings?.[key]).map(({ key }) => [key, whoOf(settings[key])]));

export default function SpaceDetails({ open, spaceId, onClose, onChanged, onGone }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ displayName: '', description: '', guidelines: '' });
  const [perms, setPerms] = useState({});
  const [permsBusy, setPermsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState([]);
  const [addBusy, setAddBusy] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'remove'|'leave'|'delete', member? }
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/google-chat/spaces/${spaceId}/details`)
      .then((response) => {
        const data = response.data.data;
        setDetails(data);
        setForm({ displayName: data.space.displayName || '', description: data.space.description || '', guidelines: data.space.guidelines || '' });
        setPerms(permissionForm(data.space.permissionSettings));
      })
      .catch((err) => setError(errorText(err, 'Gagal memuat detail percakapan')))
      .finally(() => setLoading(false));
  }, [spaceId]);

  useEffect(() => {
    if (!open) return;
    setAdding([]);
    setDeleteBlocked(false);
    load();
  }, [open, load]);

  const space = details?.space;
  const isRoom = space?.spaceType === 'SPACE';
  const dirty = space && (form.displayName.trim() !== (space.displayName || '')
    || form.description.trim() !== (space.description || '')
    || form.guidelines.trim() !== (space.guidelines || ''));
  const permsDirty = space && Object.entries(perms).some(([key, value]) => value !== whoOf(space.permissionSettings?.[key]));

  // Chat answers settings changes with the updated space.
  const applySpace = (updated) => {
    setDetails((d) => ({ ...d, space: { ...d.space, ...updated } }));
    onChanged?.(updated);
  };

  const settingError = (err, fallback) => (errorCode(err) === 'GOOGLE_SCOPE_NOT_GRANTED'
    ? 'Pengaturan ini perlu izin admin Google Workspace untuk aplikasi ini.'
    : errorText(err, fallback));

  const toggleHistory = async () => {
    setHistoryBusy(true);
    try {
      const response = await api.patch(`/google-chat/spaces/${spaceId}/settings`, { historyOff: !space.historyOff });
      applySpace(response.data.data);
      toast(response.data.data.historyOff ? 'Riwayat dinonaktifkan' : 'Riwayat diaktifkan', 'success');
    } catch (err) {
      toast(settingError(err, 'Gagal mengubah riwayat'), 'error');
    } finally {
      setHistoryBusy(false);
    }
  };

  const savePermissions = async () => {
    const changed = Object.fromEntries(Object.entries(perms).filter(([key, value]) => value !== whoOf(space.permissionSettings?.[key])));
    if (!Object.keys(changed).length) return;
    setPermsBusy(true);
    try {
      const response = await api.patch(`/google-chat/spaces/${spaceId}/settings`, { permissions: changed });
      applySpace(response.data.data);
      setPerms(permissionForm(response.data.data.permissionSettings || space.permissionSettings));
      toast('Izin space disimpan', 'success');
    } catch (err) {
      toast(settingError(err, 'Gagal menyimpan izin'), 'error');
    } finally {
      setPermsBusy(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.displayName.trim()) return;
    setSaving(true);
    try {
      const response = await api.patch(`/google-chat/spaces/${spaceId}`, {
        displayName: form.displayName.trim(), description: form.description.trim(), guidelines: form.guidelines.trim(),
      });
      applySpace(response.data.data);
      toast('Detail space disimpan', 'success');
    } catch (err) {
      toast(settingError(err, 'Gagal menyimpan detail space'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleMute = async () => {
    setMuteBusy(true);
    try {
      const response = await api.put(`/google-chat/spaces/${spaceId}/notification`, { muted: !details.notifications.muted });
      setDetails((d) => ({ ...d, notifications: { ...d.notifications, muted: response.data.data.muted } }));
      toast(response.data.data.muted ? 'Notifikasi dibisukan' : 'Notifikasi diaktifkan', 'success');
    } catch (err) {
      toast(errorText(err, 'Gagal mengubah notifikasi'), 'error');
    } finally {
      setMuteBusy(false);
    }
  };

  const addPeople = async () => {
    if (!adding.length) return;
    setAddBusy(true);
    try {
      const response = await api.post(`/google-chat/spaces/${spaceId}/members`, { emails: adding.map((p) => p.email) });
      const { added, failed } = response.data.data;
      if (added.length) toast(`${added.length} orang ditambahkan`, 'success');
      if (failed.length) toast(`${failed.length} orang gagal ditambahkan`, 'error');
      setAdding([]);
      load();
    } catch (err) {
      toast(errorText(err, 'Gagal menambahkan orang'), 'error');
    } finally {
      setAddBusy(false);
    }
  };

  const runConfirm = async () => {
    const { kind, member } = confirm;
    setConfirmBusy(true);
    try {
      if (kind === 'remove') {
        await api.delete(`/google-chat/spaces/${spaceId}/members/${member.name.split('/members/')[1]}`);
        toast(`${member.displayName} dikeluarkan`, 'success');
        setConfirm(null);
        load();
      } else if (kind === 'leave') {
        await api.delete(`/google-chat/spaces/${spaceId}/membership`);
        toast('Anda keluar dari space', 'success');
        setConfirm(null);
        onGone?.();
      } else if (kind === 'delete') {
        await api.delete(`/google-chat/spaces/${spaceId}`);
        toast('Space dihapus', 'success');
        setConfirm(null);
        onGone?.();
      }
    } catch (err) {
      if (kind === 'delete' && errorCode(err) === 'GOOGLE_SCOPE_NOT_GRANTED') {
        setDeleteBlocked(true);
        toast('Menghapus space perlu izin admin Google Workspace.', 'error');
      } else toast(errorText(err, 'Aksi gagal'), 'error');
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  let body;
  if (loading && !details) body = <FullScreenSection><LoadingState label="Memuat detail…" /></FullScreenSection>;
  else if (error && !details) {
    body = (
      <FullScreenSection>
        <EmptyState tone="error" title="Gagal memuat detail" description={error} action={<Button variant="text" onClick={load}>Coba lagi</Button>} />
      </FullScreenSection>
    );
  } else if (details) {
    const { members, canManage, canAddMembers, canLeave, notifications, canToggleHistory } = details;
    const settings = space.permissionSettings;
    const nameMissing = !form.displayName.trim();
    body = (
      <>
        <FullScreenSection title="Info">
          <div className="pw-gchat__details-head">
            <Avatar space={space} />
            <div>
              <span data-no-translate="" className="pw-gchat__details-name">{space.displayName}</span>
              <span className="pw-gchat__muted">{spaceTypeLabel(space)}</span>
            </div>
          </div>
          {isRoom && canManage ? (
            <form className="pw-stack" noValidate onSubmit={save}>
              <Input
                label="Nama space"
                required
                maxLength={128}
                value={form.displayName}
                error={nameMissing ? 'Nama space wajib diisi' : undefined}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
              <Textarea label="Deskripsi" rows={2} maxLength={150} value={form.description} hint={`${form.description.length}/150`} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <Textarea label="Pedoman space" rows={3} maxLength={5000} value={form.guidelines} hint="Aturan yang tampil untuk semua anggota (maks. 5000 karakter)." onChange={(e) => setForm((f) => ({ ...f, guidelines: e.target.value }))} />
              <FormActions>
                <Button type="submit" variant="secondary" loading={saving} disabled={!dirty || nameMissing}>Simpan perubahan</Button>
              </FormActions>
            </form>
          ) : isRoom && (space.description || space.guidelines) ? (
            <KeyValue items={[
              space.description ? { label: 'Deskripsi', value: <span className="pw-gchat__description">{space.description}</span> } : null,
              space.guidelines ? { label: 'Pedoman', value: <span className="pw-gchat__description">{space.guidelines}</span> } : null,
            ]}
            />
          ) : null}
        </FullScreenSection>

        <FullScreenSection title="Pengaturan">
          <div className="pw-gchat__setting">
            <div>
              <span id="pw-gchat-setting-notif" className="pw-gchat__setting-label">Notifikasi</span>
              <span className="pw-gchat__muted" id="pw-gchat-setting-notif-hint">
                {!notifications.available ? 'Perlu izin admin Google Workspace' : notifications.muted ? 'Dibisukan' : 'Aktif'}
              </span>
            </div>
            <Switch
              aria-labelledby="pw-gchat-setting-notif"
              aria-describedby="pw-gchat-setting-notif-hint"
              checked={notifications.available && !notifications.muted}
              disabled={!notifications.available || muteBusy}
              onChange={toggleMute}
            />
          </div>
          <div className="pw-gchat__setting">
            <div>
              <span id="pw-gchat-setting-history" className="pw-gchat__setting-label">Riwayat percakapan</span>
              <span className="pw-gchat__muted" id="pw-gchat-setting-history-hint">
                {space.historyOff ? 'Nonaktif — pesan terhapus otomatis setelah 24 jam' : 'Aktif — pesan disimpan'}
                {!canToggleHistory ? ' · hanya pengelola yang dapat mengubah' : ''}
              </span>
            </div>
            <Switch
              aria-labelledby="pw-gchat-setting-history"
              aria-describedby="pw-gchat-setting-history-hint"
              checked={!space.historyOff}
              disabled={!canToggleHistory || historyBusy}
              onChange={toggleHistory}
            />
          </div>
        </FullScreenSection>

        {isRoom && canManage ? (
          <FullScreenSection title="Izin space">
            {settings ? (
              <>
                <div className="pw-form-grid">
                  {PERMISSIONS.filter(({ key }) => settings[key]).map(({ key, label }) => (
                    <Select key={key} label={label} options={WHO_OPTIONS} value={perms[key] || 'managers'} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.value }))} />
                  ))}
                </div>
                {settings.postMessages ? (
                  <KeyValue items={[{
                    label: 'Kirim pesan',
                    translate: true,
                    value: `${whoOf(settings.postMessages) === 'members' ? 'Semua anggota' : 'Pengelola saja'} (hanya dapat diubah di Google Chat)`,
                  }]}
                  />
                ) : null}
                <FormActions>
                  <Button variant="secondary" onClick={savePermissions} loading={permsBusy} disabled={!permsDirty}>Simpan izin</Button>
                </FormActions>
              </>
            ) : (
              <Banner tone="info">Google tidak mengirim pengaturan izin untuk space ini, jadi belum dapat diubah dari sini.</Banner>
            )}
          </FullScreenSection>
        ) : null}

        <FullScreenSection title={`Anggota (${members.length})`}>
          {canAddMembers ? (
            <div className="pw-gchat__add-people">
              <PeoplePicker label="Tambahkan orang" selected={adding} onChange={setAdding} exclude={members.map((m) => m.email).filter(Boolean)} />
              {adding.length ? (
                <FormActions>
                  <Button variant="secondary" icon="person_add" onClick={addPeople} loading={addBusy}>{`Tambahkan ${adding.length} orang`}</Button>
                </FormActions>
              ) : null}
            </div>
          ) : null}
          <ul className="pw-gchat__members">
            {members.map((member) => (
              <li key={member.name} className="pw-gchat__member">
                <Avatar person={member} size="sm" />
                <span className="pw-gchat__option-text">
                  <span><span data-no-translate="">{member.displayName}</span>{member.isMe ? ' (Anda)' : ''}</span>
                  <span className="pw-gchat__muted" data-no-translate={member.email ? '' : undefined}>{member.email || (member.type === 'BOT' ? 'Aplikasi' : '')}</span>
                </span>
                {member.role === 'ROLE_MANAGER' ? <span className="pw-gchat__role">Pengelola</span> : null}
                {canManage && !member.isMe && member.type === 'HUMAN' ? (
                  <IconButton label={`Keluarkan ${member.displayName}`} tone="danger" icon="person_remove" onClick={() => setConfirm({ kind: 'remove', member })} />
                ) : null}
              </li>
            ))}
          </ul>
        </FullScreenSection>

        {canLeave || (isRoom && canManage) ? (
          <FullScreenSection title="Tindakan">
            {deleteBlocked ? (
              <Banner tone="warning" title="Hapus space belum diizinkan">
                Admin Google Workspace perlu menambahkan cakupan chat.delete untuk aplikasi ini di Admin Console.
              </Banner>
            ) : null}
            <div className="pw-gchat__danger">
              {canLeave ? <Button variant="secondary" icon="logout" onClick={() => setConfirm({ kind: 'leave' })}>{isRoom ? 'Keluar dari space' : 'Keluar dari grup'}</Button> : null}
              {isRoom && canManage ? <Button variant="danger" icon="delete" onClick={() => setConfirm({ kind: 'delete' })}>Hapus space</Button> : null}
            </div>
          </FullScreenSection>
        ) : null}
      </>
    );
  }

  const confirmCopy = {
    remove: { title: 'Keluarkan anggota?', message: `${confirm?.member?.displayName || ''} akan dikeluarkan dari "${space?.displayName}".`, label: 'Keluarkan anggota' },
    leave: { title: 'Keluar dari percakapan?', message: `Anda tidak akan menerima pesan dari "${space?.displayName}" lagi sampai ditambahkan kembali.`, label: isRoom ? 'Keluar dari space' : 'Keluar dari grup' },
    delete: { title: 'Hapus space?', message: `"${space?.displayName}" beserta semua pesannya akan dihapus permanen untuk semua anggota.`, label: 'Hapus space' },
  }[confirm?.kind] || {};

  return (
    <>
      <FullScreenDialog open={open} onClose={onClose} title="Detail percakapan" card={false}>{body}</FullScreenDialog>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.label}
        tone="danger"
        loading={confirmBusy}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
