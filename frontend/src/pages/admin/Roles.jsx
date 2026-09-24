import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataTable from '../../components/DataTable';
import RoleEditorPanel from './RoleEditorPanel';
import { roleHierarchyRows } from './roleAdminModel';

const LEVEL_LABELS = {
  member: 'Member',
  supervisor: 'Supervisor',
  head: 'Head',
  admin: 'Admin',
  custom: 'Custom',
};

function RoleLevelChip({ level }) {
  return (
    <span className={`role-level-chip role-level-chip--${level}`}>
      {LEVEL_LABELS[level] || level || 'Custom'}
    </span>
  );
}

export default function Roles() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleLevel, setRoleLevel] = useState('');
  const [standard, setStandard] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [editorRole, setEditorRole] = useState(null);
  const [resetRole, setResetRole] = useState(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rolesResponse, departmentsResponse] = await Promise.all([
        api.get('/roles', { params: { page: 1, limit: 100 } }),
        api.get('/departments', { params: { page: 1, limit: 100 } }),
      ]);
      setRows(rolesResponse.data.data || []);
      setDepartments(departmentsResponse.data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Daftar role tidak dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('id-ID');
    return rows.filter((role) => {
      if (departmentId && Number(role.departmentId) !== Number(departmentId)) return false;
      if (roleLevel && role.roleLevel !== roleLevel) return false;
      if (standard === 'standard' && !role.isSystemTemplate) return false;
      if (standard === 'custom' && role.isSystemTemplate) return false;
      if (!normalizedQuery) return true;
      return [role.name, role.roleKey, role.departmentName]
        .some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(normalizedQuery));
    });
  }, [departmentId, query, roleLevel, rows, standard]);

  const comparisonDepartmentId = departmentId
    || departments.find((department) => roleHierarchyRows(rows, department.id).length)?.id
    || '';
  const comparisonRows = useMemo(
    () => roleHierarchyRows(rows, comparisonDepartmentId),
    [comparisonDepartmentId, rows],
  );

  const resetDefault = async () => {
    if (!resetRole) return;
    setResetting(true);
    setError('');
    try {
      await api.post(`/roles/${resetRole.id}/reset-standard`);
      setResetRole(null);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || 'Default role gagal dipulihkan.');
      setResetRole(null);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="role-admin-page">
      <header className="role-admin-header">
        <div>
          <span className="role-admin-eyebrow"><ShieldCheck size={16} /> Kontrol akses</span>
          <h1>Role & permission</h1>
          <p>Atur akses Member, Supervisor, dan Head untuk setiap divisi.</p>
        </div>
        <Button
          variant={compareMode ? 'primary' : 'secondary'}
          type="button"
          onClick={() => setCompareMode((current) => !current)}
        >
          <GitCompareArrows size={18} />
          {compareMode ? 'Tutup perbandingan' : 'Bandingkan role'}
        </Button>
      </header>

      <section className="role-admin-filters" aria-label="Filter role">
        <label className="role-admin-search">
          <span className="sr-only">Cari role</span>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Cari nama atau key role"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Divisi</span>
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">Semua divisi</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Level</span>
          <select value={roleLevel} onChange={(event) => setRoleLevel(event.target.value)}>
            <option value="">Semua level</option>
            {Object.entries(LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Tipe</span>
          <select value={standard} onChange={(event) => setStandard(event.target.value)}>
            <option value="">Semua tipe</option>
            <option value="standard">Standar</option>
            <option value="custom">Custom</option>
          </select>
        </label>
      </section>

      {error ? <div className="role-admin-alert" role="alert">{error}</div> : null}

      {compareMode ? (
        <section className="role-comparison" aria-label="Perbandingan role divisi">
          <div className="role-comparison__heading">
            <div>
              <span>Perbandingan akses</span>
              <h2>{departments.find((item) => Number(item.id) === Number(comparisonDepartmentId))?.name || 'Pilih divisi'}</h2>
            </div>
            {!departmentId ? <small>Pilih divisi pada filter untuk mengganti perbandingan.</small> : null}
          </div>
          <div className="role-comparison__grid">
            {comparisonRows.map((role) => (
              <article key={role.id} className={`role-comparison-card role-comparison-card--${role.roleLevel}`}>
                <RoleLevelChip level={role.roleLevel} />
                <h3>{role.name}</h3>
                <strong>{role.permissionCount}</strong>
                <span>permission aktif</span>
                <small>{role.userCount} pengguna</small>
                <Button variant="secondary" type="button" onClick={() => setEditorRole(role)}>
                  Edit akses
                </Button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <DataTable
        loading={loading}
        rows={filteredRows}
        empty="Tidak ada role yang cocok dengan filter."
        columns={[
          {
            key: 'name',
            title: 'Role',
            render: (role) => (
              <div className="role-name-cell">
                <strong>{role.name}</strong>
                <code>{role.roleKey || 'custom'}</code>
              </div>
            ),
          },
          { key: 'departmentName', title: 'Divisi', render: (role) => role.departmentName || 'Global' },
          { key: 'roleLevel', title: 'Level', render: (role) => <RoleLevelChip level={role.roleLevel} /> },
          { key: 'permissionCount', title: 'Permission' },
          { key: 'userCount', title: 'Pengguna' },
          {
            key: 'updatedAt',
            title: 'Diperbarui',
            render: (role) => role.updatedAt ? new Date(role.updatedAt).toLocaleDateString('id-ID') : '—',
          },
          {
            key: 'actions',
            title: 'Tindakan',
            render: (role) => (
              <div className="role-row-actions">
                <Button variant="secondary" type="button" onClick={() => setEditorRole(role)}>
                  Edit
                </Button>
                {role.isSystemTemplate && role.departmentId ? (
                  <button
                    type="button"
                    className="role-reset-button"
                    onClick={() => setResetRole(role)}
                    aria-label={`Reset ${role.name} ke default`}
                  >
                    <RotateCcw size={17} />
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <RoleEditorPanel
        role={editorRole}
        open={Boolean(editorRole)}
        onClose={() => setEditorRole(null)}
        onSaved={load}
      />

      <ConfirmDialog
        open={Boolean(resetRole)}
        title="Kembalikan permission default?"
        message={`Semua penyesuaian pada ${resetRole?.name || 'role ini'} akan diganti dengan standar Prakasa Workspace.`}
        confirmLabel="Reset ke default"
        tone="warning"
        loading={resetting}
        onClose={() => setResetRole(null)}
        onConfirm={resetDefault}
      />
    </div>
  );
}
