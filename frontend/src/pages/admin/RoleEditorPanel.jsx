import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiErrorMessage } from '../../components/datagrid/gridModel';
import EmptyState, { LoadingState } from '../../components/EmptyState';
import FullScreenDialog, { FullScreenSection } from '../../components/FullScreenDialog';
import Icon from '../../components/Icon';
import {
  groupPermissions,
  roleDiff,
  roleLevelLabel,
} from './roleAdminModel';
import { Mixed } from '../../i18n/NoTranslate';
import './admin-editors.css';

// Edit a role's permissions: the admin console's full-screen form
// (docs/ui-guideline.md §3.3), opened from a row of the Roles list. Each
// permission group is a collapsible block with its count; saving asks for a
// confirmation that lists what is added and removed.
export default function RoleEditorPanel({ role, open, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [originalCodes, setOriginalCodes] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !role?.id) return undefined;
    let active = true;
    setLoading(true);
    setLoadError('');
    setSaveError('');

    Promise.all([
      api.get(`/roles/${role.id}`),
      api.get('/permissions'),
    ]).then(([roleResponse, permissionResponse]) => {
      if (!active) return;
      const nextDetail = roleResponse.data.data;
      const nextPermissions = permissionResponse.data.data || [];
      const codes = (nextDetail.permissions || []).map((permission) => permission.code);
      setDetail(nextDetail);
      setPermissions(nextPermissions);
      setOriginalCodes(codes);
      setSelectedCodes(new Set(codes));
    }).catch((requestError) => {
      if (!active) return;
      setLoadError(apiErrorMessage(requestError, 'Peran tidak dapat dimuat.'));
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [open, role?.id, attempt]);

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const selectedList = useMemo(() => [...selectedCodes], [selectedCodes]);
  const diff = useMemo(
    () => roleDiff(originalCodes, selectedList),
    [originalCodes, selectedList],
  );
  const permissionIdByCode = useMemo(
    () => new Map(permissions.map((permission) => [permission.code, permission.id])),
    [permissions],
  );

  const close = useCallback(() => {
    if (!saving) onClose?.();
  }, [onClose, saving]);

  const togglePermission = (code) => {
    setSelectedCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const requestSave = () => {
    if (!diff.added.length && !diff.removed.length) {
      onClose?.();
      return;
    }
    setConfirmOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const permissionIds = selectedList
        .map((code) => permissionIdByCode.get(code))
        .filter(Boolean);
      await api.patch(`/roles/${role.id}`, { permissionIds });
      setConfirmOpen(false);
      onSaved?.();
      onClose?.();
    } catch (requestError) {
      setConfirmOpen(false);
      setSaveError(apiErrorMessage(requestError, 'Perubahan peran gagal disimpan.'));
    } finally {
      setSaving(false);
    }
  };

  const name = detail?.name || role?.name || '';
  // Division name and level are two interface labels: one text node each.
  const scope = <Mixed parts={[detail?.departmentName || role?.departmentName || 'Global', roleLevelLabel(detail?.roleLevel || role?.roleLevel)]} />;
  const changed = diff.added.length > 0 || diff.removed.length > 0;
  const ready = !loading && !loadError;

  const diffMessage = (
    <div className="admin-confirm-summary">
      <p>Periksa perubahan untuk <span className="pw-strong">{name}</span>.</p>
      <div>
        <span className="pw-strong">Ditambahkan ({diff.added.length})</span>
        <span className="admin-confirm-summary__codes" data-no-translate={diff.added.length ? '' : undefined}>{diff.added.length ? diff.added.join(', ') : 'Tidak ada'}</span>
      </div>
      <div>
        <span className="pw-strong">Dihapus ({diff.removed.length})</span>
        <span className="admin-confirm-summary__codes" data-no-translate={diff.removed.length ? '' : undefined}>{diff.removed.length ? diff.removed.join(', ') : 'Tidak ada'}</span>
      </div>
    </div>
  );

  return (
    <>
      <FullScreenDialog
        open={open}
        title={name ? `Ubah akses ${name}` : 'Ubah akses peran'}
        onClose={close}
        card={false}
        actions={ready ? (
          <>
            <Button variant="text" type="button" onClick={close} disabled={saving}>Batal</Button>
            <Button type="button" onClick={requestSave} loading={saving}>Simpan perubahan</Button>
          </>
        ) : null}
      >
        {loading ? <LoadingState label="Memuat izin akses…" /> : null}
        {loadError ? (
          <EmptyState
            tone="error"
            title="Peran gagal dimuat"
            description={loadError}
            action={<Button variant="text" type="button" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button>}
          />
        ) : null}

        {ready ? (
          <div className="admin-dialog-form">
            {saveError ? <Banner tone="error">{saveError}</Banner> : null}
            <FullScreenSection title="Ringkasan">
              <div className="admin-role-summary">
                <span className="admin-role-summary__scope">{scope}</span>
                <span className="admin-role-summary__count">{selectedCodes.size} izin dipilih</span>
                <span className={`admin-role-summary__diff${changed ? ' is-changed' : ''}`}>
                  {changed ? `+${diff.added.length} / −${diff.removed.length} belum disimpan` : 'Tidak ada perubahan'}
                </span>
              </div>
            </FullScreenSection>

            <FullScreenSection title="Permission">
              {groups.length ? (
                <div className="admin-permission-groups">
                  {groups.map((group) => (
                    <details className="admin-permission-group" key={group.key} open>
                      <summary className="admin-permission-group__summary pw-state-layer">
                        <span className="admin-permission-group__label" data-no-translate="">{group.label}</span>
                        <span className="admin-permission-group__count">
                          {group.permissions.filter((permission) => selectedCodes.has(permission.code)).length}/{group.permissions.length}
                        </span>
                        <Icon name="expand_more" className="admin-permission-group__chevron" />
                      </summary>
                      <div className="admin-choice-list">
                        {group.permissions.map((permission) => (
                          <Checkbox
                            key={permission.id}
                            checked={selectedCodes.has(permission.code)}
                            onChange={() => togglePermission(permission.code)}
                            label={(
                              <span className="pw-cell">
                                <span className="pw-cell__title" data-no-translate={permission.description ? undefined : ''}>{permission.description || permission.code}</span>
                                <code data-no-translate="" className="pw-cell__meta admin-code">{permission.code}</code>
                              </span>
                            )}
                          />
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <EmptyState compact icon="key" title="Belum ada permission." />
              )}
            </FullScreenSection>
          </div>
        ) : null}
      </FullScreenDialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Simpan perubahan izin akses?"
        message={diffMessage}
        confirmLabel="Simpan perubahan"
        tone="primary"
        loading={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={save}
      />
    </>
  );
}
