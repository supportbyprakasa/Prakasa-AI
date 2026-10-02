import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage as errorMessage } from '../../components/datagrid/gridModel';
import EmptyState from '../../components/EmptyState';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import Select from '../../components/Select';
import { toast } from '../../components/Toast';
import { rolesForDepartment } from './roleAdminModel';
import './admin-editors.css';

export default function WorkspaceSync() {
  const [candidates, setCandidates] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [fetching, setFetching] = useState(false);
  const [choices, setChoices] = useState({}); // { [candidateId]: { entityId, departmentId, roleId } }
  const [choiceErrors, setChoiceErrors] = useState({}); // { [candidateId]: { departmentId, roleId } }
  const [busyIds, setBusyIds] = useState(() => new Set()); // rows creating an account
  const [backfilling, setBackfilling] = useState(false);
  const [backfillConfirmOpen, setBackfillConfirmOpen] = useState(false);
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null); // { email, password }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [candidatesRes, departmentsRes, rolesRes] = await Promise.all([
        api.get('/workspace-sync/candidates', { params: { status: 'pending' } }),
        api.get('/departments', { params: { page: 1, limit: 100 } }),
        api.get('/roles', { params: { page: 1, limit: 100 } }),
      ]);
      setCandidates(candidatesRes.data.data || []);
      setDepartments(departmentsRes.data.data || []);
      setRoles(rolesRes.data.data || []);
    } catch (error) {
      setLoadError(errorMessage(error, 'Kandidat tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entityId = departments[0]?.entityId ?? 1;

  const setChoice = (candidateId, patch) => {
    setChoices((current) => ({
      ...current,
      [candidateId]: { ...current[candidateId], ...patch },
    }));
    setChoiceErrors((current) => {
      if (!current[candidateId]) return current;
      const next = { ...current[candidateId] };
      Object.keys(patch).forEach((key) => { if (patch[key]) delete next[key]; });
      return { ...current, [candidateId]: next };
    });
  };

  const fetchFromGoogle = async () => {
    setFetching(true);
    try {
      const response = await api.post('/workspace-sync/fetch');
      const { found, staged } = response.data.data;
      toast(`Ditemukan ${found} anggota Google Workspace. ${staged} orang baru ditambahkan ke daftar tinjauan.`, 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Gagal mengambil data dari Google Workspace.'), 'error');
    } finally {
      setFetching(false);
    }
  };

  const dismiss = async () => {
    const candidate = dismissTarget;
    setDismissing(true);
    try {
      await api.post(`/workspace-sync/candidates/${candidate.id}/dismiss`);
      setDismissTarget(null);
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Gagal melewati kandidat ini.'), 'error');
      setDismissTarget(null);
    } finally {
      setDismissing(false);
    }
  };

  const apply = async (candidate) => {
    const choice = choices[candidate.id] || {};
    if (!choice.departmentId || !choice.roleId) {
      setChoiceErrors((current) => ({
        ...current,
        [candidate.id]: {
          departmentId: choice.departmentId ? undefined : 'Pilih divisi terlebih dahulu.',
          roleId: choice.roleId ? undefined : 'Pilih role terlebih dahulu.',
        },
      }));
      return;
    }
    setBusyIds((current) => new Set(current).add(candidate.id));
    try {
      const response = await api.post(`/workspace-sync/candidates/${candidate.id}/apply`, {
        departmentId: Number(choice.departmentId),
        roleId: Number(choice.roleId),
      });
      // A temporary password comes back only for a Super Admin; otherwise the
      // account signs in with the office Google account.
      setCreatedAccount({ email: candidate.email, password: response.data.data.password || '' });
      await load();
    } catch (error) {
      toast(errorMessage(error, 'Gagal menerapkan kandidat ini.'), 'error');
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(candidate.id);
        return next;
      });
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(createdAccount.password);
      toast('Kata sandi sementara disalin.', 'success');
    } catch {
      toast('Kata sandi gagal disalin. Salin manual dari kolom kata sandi.', 'error');
    }
  };

  const rolesFor = useMemo(() => (departmentId) => rolesForDepartment(roles, entityId, departmentId || null), [roles, entityId]);

  const backfillDriveAccess = async () => {
    setBackfillConfirmOpen(false);
    setBackfilling(true);
    try {
      const response = await api.post('/workspace-sync/backfill-drive-access');
      const { total, granted, alreadyMember, failed } = response.data.data;
      toast(
        `Selesai memproses ${total} pengguna. Baru ditambahkan: ${granted} · Sudah jadi anggota: ${alreadyMember} · `
        + `Gagal/tidak ada mapping folder: ${failed}.`,
        failed ? 'info' : 'success',
      );
    } catch (error) {
      toast(errorMessage(error, 'Gagal menyinkronkan akses Shared Drive.'), 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Nama',
      render: (candidate) => (
        <span className="pw-cell">
          <span data-no-translate="" className="pw-cell__title">{candidate.name}</span>
          <span data-no-translate="" className="pw-cell__meta">{candidate.email}</span>
        </span>
      ),
    },
    {
      key: 'departmentId',
      header: 'Divisi',
      translate: true,
      display: true,
      render: (candidate) => {
        const choice = choices[candidate.id] || {};
        const errors = choiceErrors[candidate.id] || {};
        return (
          <Select
            dense
            label={`Divisi untuk ${candidate.name}`}
            required
            value={choice.departmentId || ''}
            error={errors.departmentId}
            onChange={(event) => setChoice(candidate.id, { departmentId: event.target.value, roleId: '' })}
            placeholder="Pilih divisi"
            options={departments.map((item) => ({ value: item.id, label: item.name }))}
          />
        );
      },
    },
    {
      key: 'roleId',
      header: 'Peran',
      translate: true,
      display: true,
      render: (candidate) => {
        const choice = choices[candidate.id] || {};
        const errors = choiceErrors[candidate.id] || {};
        return (
          <Select
            dense
            label={`Peran untuk ${candidate.name}`}
            required
            value={choice.roleId || ''}
            disabled={!choice.departmentId}
            error={errors.roleId}
            onChange={(event) => setChoice(candidate.id, { roleId: event.target.value })}
            placeholder="Pilih peran"
            options={rolesFor(choice.departmentId).map((item) => ({ value: item.id, label: item.name }))}
          />
        );
      },
    },
    { key: 'orgUnitPath', header: 'Unit organisasi' },
    {
      key: 'actions',
      header: 'Aksi',
      display: true,
      align: 'end',
      nowrap: true,
      render: (candidate) => {
        const busy = busyIds.has(candidate.id);
        return (
          <span className="admin-row-actions">
            <Button variant="text" type="button" disabled={busy} onClick={() => setDismissTarget(candidate)}>
              Lewati
            </Button>
            <Button variant="secondary" type="button" loading={busy} onClick={() => apply(candidate)}>
              Terapkan &amp; buat akun
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Sinkronisasi Workspace"
        description="Ambil daftar anggota terbaru dari Google Workspace, lalu pilih divisi dan peran tiap orang sebelum akunnya dibuat. Tidak ada akun yang dibuat otomatis."
        actions={(
          <>
            <Button variant="secondary" icon="folder_managed" onClick={() => setBackfillConfirmOpen(true)} loading={backfilling}>
              Sinkronkan akses Shared Drive
            </Button>
            <Button icon="cloud_download" onClick={fetchFromGoogle} loading={fetching}>
              Ambil data dari Google Workspace
            </Button>
          </>
        )}
      />

      <DataGrid
        title="Kandidat menunggu tinjauan"
        exportName="kandidat-workspace"
        columns={columns}
        rows={candidates}
        loading={loading}
        error={loadError}
        onRetry={load}
        exportable={false}
        empty={(
          <EmptyState
            compact
            icon="group"
            title="Tidak ada kandidat menunggu tinjauan"
            description="Pilih Ambil data dari Google Workspace untuk mengecek anggota baru."
          />
        )}
      />

      <ConfirmDialog
        open={Boolean(dismissTarget)}
        title="Lewati kandidat ini?"
        message={`Lewati ${dismissTarget?.name || ''} (${dismissTarget?.email || ''})? Tidak ada akun yang akan dibuat.`}
        confirmLabel="Lewati kandidat"
        tone="warning"
        loading={dismissing}
        onClose={() => setDismissTarget(null)}
        onConfirm={dismiss}
      />

      <ConfirmDialog
        open={backfillConfirmOpen}
        title="Sinkronkan akses Shared Drive?"
        message={'Berikan akses Shared Drive (Content Manager) ke semua pengguna aktif yang sudah punya divisi, '
          + 'bagi yang belum jadi anggota folder divisinya? Aman dijalankan berulang kali.'}
        confirmLabel="Sinkronkan akses"
        tone="primary"
        loading={backfilling}
        onClose={() => setBackfillConfirmOpen(false)}
        onConfirm={backfillDriveAccess}
      />

      <Modal
        open={Boolean(createdAccount)}
        size="sm"
        title="Akun berhasil dibuat"
        onClose={() => setCreatedAccount(null)}
        footer={(
          <>
            {createdAccount?.password ? (
              <Button variant="secondary" icon="content_copy" type="button" onClick={copyPassword}>
                Salin kata sandi
              </Button>
            ) : null}
            <Button type="button" onClick={() => setCreatedAccount(null)}>Selesai</Button>
          </>
        )}
      >
        <div className="pw-stack">
          {createdAccount?.password ? (
            <>
              <p className="admin-dialog-text">
                Akun untuk <span data-no-translate="" className="pw-strong pw-break">{createdAccount?.email}</span> berhasil dibuat.
                Sampaikan kata sandi sementara ini ke orang yang bersangkutan — wajib diganti saat pertama masuk.
              </p>
              <Input
                label="Kata sandi sementara"
                mono
                readOnly
                value={createdAccount.password}
                onFocus={(event) => event.target.select()}
              />
            </>
          ) : (
            <p className="admin-dialog-text">
              Akun untuk <span data-no-translate="" className="pw-strong pw-break">{createdAccount?.email}</span> berhasil dibuat.
              Orang ini masuk dengan akun Google kantor. Kata sandi dikelola oleh Super Admin.
            </p>
          )}
        </div>
      </Modal>
    </Page>
  );
}
