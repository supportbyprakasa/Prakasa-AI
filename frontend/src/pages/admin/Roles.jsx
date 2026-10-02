import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ConfirmDialog from '../../components/ConfirmDialog';
import DataGrid from '../../components/datagrid/DataGrid';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import EmptyState from '../../components/EmptyState';
import IconButton from '../../components/IconButton';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import { toast } from '../../components/Toast';
import FilterChips from './FilterChips';
import RoleEditorPanel from './RoleEditorPanel';
import { ROLE_LEVEL_LABELS, roleHierarchyRows, roleLevelLabel } from './roleAdminModel';
import { Mixed } from '../../i18n/NoTranslate';
import './admin-editors.css';

const LEVEL_OPTIONS = Object.entries(ROLE_LEVEL_LABELS).map(([value, label]) => ({ value, label }));
const TYPE_OPTIONS = [
  { value: 'standard', label: 'Standar' },
  { value: 'custom', label: 'Custom' },
];
const NO_FILTERS = { departmentId: '', roleLevel: '', standard: '' };

export default function Roles() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [compareMode, setCompareMode] = useState(false);
  const [editorRole, setEditorRole] = useState(null);
  const [resetRole, setResetRole] = useState(null);
  const [resetting, setResetting] = useState(false);
  const { departmentId, roleLevel, standard } = filters;

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
      setError(apiErrorMessage(requestError, 'Daftar peran tidak dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((role) => {
      if (departmentId && Number(role.departmentId) !== Number(departmentId)) return false;
      if (roleLevel && role.roleLevel !== roleLevel) return false;
      if (standard === 'standard' && !role.isSystemTemplate) return false;
      if (standard === 'custom' && role.isSystemTemplate) return false;
      if (!normalizedQuery) return true;
      return [role.name, role.roleKey, role.departmentName]
        .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [departmentId, query, roleLevel, rows, standard]);

  const comparisonDepartmentId = departmentId
    || departments.find((department) => roleHierarchyRows(rows, department.id).length)?.id
    || '';
  const comparisonRows = useMemo(
    () => roleHierarchyRows(rows, comparisonDepartmentId),
    [comparisonDepartmentId, rows],
  );
  const comparisonName = departments.find((item) => Number(item.id) === Number(comparisonDepartmentId))?.name;

  const resetDefault = async () => {
    if (!resetRole) return;
    setResetting(true);
    try {
      await api.post(`/roles/${resetRole.id}/reset-standard`);
      setResetRole(null);
      await load();
    } catch (requestError) {
      toast(apiErrorMessage(requestError, 'Standar peran gagal dipulihkan.'), 'error');
      setResetRole(null);
    } finally {
      setResetting(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Peran',
      translate: true,
      render: (role) => (
        <span className="pw-cell">
          <span className="pw-cell__title">{role.name}</span>
          <code data-no-translate="" className="pw-cell__meta admin-code">{role.roleKey || 'custom'}</code>
        </span>
      ),
    },
    { key: 'departmentName', header: 'Divisi', translate: true, render: (role) => role.departmentName || 'Global' },
    { key: 'roleLevel', header: 'Level', translate: true, render: (role) => roleLevelLabel(role.roleLevel) },
    { key: 'permissionCount', header: 'Permission', type: 'number' },
    { key: 'userCount', header: 'Pengguna', type: 'number' },
    { key: 'updatedAt', header: 'Diperbarui', type: 'date' },
  ];

  return (
    <Page>
      <PageHeader
        title="Peran"
        description="Atur akses Member, Supervisor, dan Head untuk setiap divisi."
        actions={(
          <Button
            variant={compareMode ? 'tonal' : 'secondary'}
            icon="compare_arrows"
            type="button"
            aria-pressed={compareMode}
            onClick={() => setCompareMode((current) => !current)}
          >
            {compareMode ? 'Tutup perbandingan' : 'Bandingkan peran'}
          </Button>
        )}
      />

      {compareMode ? (
        <Card
          variant="panel"
          size="sm"
          title={<Mixed parts={['Perbandingan akses', comparisonName || 'pilih divisi']} />}
          subtitle={departmentId ? undefined : 'Tambahkan filter divisi untuk mengganti divisi yang dibandingkan.'}
        >
          {comparisonRows.length ? (
            <div className="pw-cols-3 admin-compare">
              {comparisonRows.map((role) => (
                <StatCard
                  key={role.id}
                  label={role.name}
                  value={role.permissionCount}
                  note={`permission aktif · ${role.userCount} pengguna`}
                  action={<Button variant="text" icon="edit" type="button" onClick={() => setEditorRole(role)}>Ubah akses</Button>}
                />
              ))}
            </div>
          ) : (
            <EmptyState compact icon="compare_arrows" title="Belum ada peran standar untuk divisi ini." />
          )}
        </Card>
      ) : null}

      <DataGrid
        title="Semua peran"
        exportName="peran"
        columns={columns}
        rows={filteredRows}
        loading={loading}
        error={error}
        onRetry={load}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Cari peran, kode, atau divisi"
        filters={(
          <FilterChips
            label="Filter peran"
            values={filters}
            onChange={setFilters}
            fields={[
              { key: 'departmentId', label: 'Divisi', type: 'select', options: departments.map((department) => ({ value: department.id, label: department.name })) },
              { key: 'roleLevel', label: 'Level', type: 'select', options: LEVEL_OPTIONS },
              { key: 'standard', label: 'Tipe', type: 'select', options: TYPE_OPTIONS },
            ]}
          />
        )}
        empty="Tidak ada peran yang cocok dengan filter."
        onRowClick={(role) => setEditorRole(role)}
        rowActions={(role) => (role.isSystemTemplate && role.departmentId ? (
          <IconButton size="sm" icon="replay" label={`Kembalikan ${role.name} ke default`} onClick={() => setResetRole(role)} />
        ) : null)}
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
        message={`Semua penyesuaian pada ${resetRole?.name || 'peran ini'} akan diganti dengan standar Prakasa Workspace.`}
        confirmLabel="Kembalikan ke default"
        tone="warning"
        loading={resetting}
        onClose={() => setResetRole(null)}
        onConfirm={resetDefault}
      />
    </Page>
  );
}
